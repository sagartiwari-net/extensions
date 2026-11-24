/**
 * Keepalive for MULTIPLE open tools:
 * - jar mode (Grammarly): renew short leases so cookies don't die mid-session
 * - extension_only (ChatGPT): rare jar-leak scrub per apex
 *
 * Uses chrome.alarms so SW sleep cannot skip renew.
 */
import { apexFromHost } from './dnr-cookies.js';
import { relatedApexes } from './launch-tab.js';
import { JAR_LEASE_SECONDS, renewJarCookieLease } from './multi-host-cookies.js';

const ACTIVE_LAUNCH_KEY = 'oneclk_active_launch';
const LAUNCHES_KEY = 'oneclk_active_launches';
const LEASES_KEY = 'oneclk_jar_leases';
const SCRUBS_KEY = 'oneclk_ext_only_scrubs';
const ALARM_NAME = 'oneclk_jar_keepalive';
const MIN_TICK_MS = 25000;
const PORT_INTERVAL_MS = 30000;

let lastTickAt = 0;
let tickInFlight = false;

function isAuthLeakName(name) {
  const n = String(name || '');
  return (
    n.includes('next-auth') ||
    n.startsWith('__Host-next-auth') ||
    n.startsWith('__Secure-next-auth') ||
    n === 'grauth' ||
    n === 'gac' ||
    n === 'PHPSESSID' ||
    n === 'laravel_session' ||
    n === 'sell_the_trend_session'
  );
}

export async function startJarAuthScrub(toolUrl, extraNames = []) {
  let apex = '';
  try {
    apex = apexFromHost(new URL(toolUrl).hostname);
  } catch {
    return;
  }
  const { [LEASES_KEY]: leases = {}, [SCRUBS_KEY]: scrubs = {} } =
    await chrome.storage.session.get([LEASES_KEY, SCRUBS_KEY]);
  leases[apex] = { apex, toolUrl, leaseSeconds: JAR_LEASE_SECONDS, at: Date.now() };
  scrubs[apex] = {
    apex,
    toolUrl,
    names: (extraNames || []).filter(Boolean),
    at: Date.now(),
  };
  await chrome.storage.session.set({ [LEASES_KEY]: leases, [SCRUBS_KEY]: scrubs });
  try {
    await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });
  } catch {
    await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 }).catch(() => {});
  }
}

export async function stopJarAuthScrub(toolUrl = null) {
  if (!toolUrl) {
    await chrome.storage.session.remove([LEASES_KEY, SCRUBS_KEY, 'oneclk_jar_lease', 'oneclk_ext_only_scrub']);
    try {
      await chrome.alarms.clear(ALARM_NAME);
    } catch {
      /* */
    }
    return;
  }
  let apex = '';
  try {
    apex = apexFromHost(new URL(toolUrl).hostname);
  } catch {
    return;
  }
  const { [LEASES_KEY]: leases = {}, [SCRUBS_KEY]: scrubs = {} } =
    await chrome.storage.session.get([LEASES_KEY, SCRUBS_KEY]);
  delete leases[apex];
  delete scrubs[apex];
  await chrome.storage.session.set({ [LEASES_KEY]: leases, [SCRUBS_KEY]: scrubs });
}

export async function scrubExtensionOnlyJarLeaks() {
  const { [LAUNCHES_KEY]: launches = {}, [SCRUBS_KEY]: scrubs = {} } =
    await chrome.storage.session.get([LAUNCHES_KEY, SCRUBS_KEY]);
  const list = Object.values(launches).filter((l) => l?.transport === 'extension_only' && l.webUrl);
  if (!list.length) {
    // Fallback: legacy single active launch
    const { [ACTIVE_LAUNCH_KEY]: active } = await chrome.storage.session.get(ACTIVE_LAUNCH_KEY);
    if (active?.webUrl && active.transport === 'extension_only') list.push(active);
  }

  let removed = 0;
  for (const active of list) {
    let apex = '';
    try {
      apex = apexFromHost(new URL(active.webUrl).hostname);
    } catch {
      continue;
    }
    const scrub = scrubs[apex] || {};
    const apexes = relatedApexes(apex);
    const nameSet = new Set([...(scrub.names || []), ...(active.cookieNames || [])].filter(Boolean));

    for (const a of apexes) {
      const batches = await Promise.all([
        chrome.cookies.getAll({ domain: a }).catch(() => []),
        chrome.cookies.getAll({ domain: `.${a}` }).catch(() => []),
      ]);
      const jobs = [];
      for (const batch of batches) {
        for (const c of batch || []) {
          if (!c?.name) continue;
          if (!nameSet.has(c.name) && !isAuthLeakName(c.name)) continue;
          const url = `https://${(c.domain || a).replace(/^\./, '')}${c.path || '/'}`;
          jobs.push(
            chrome.cookies
              .remove({ url, name: c.name })
              .then(() => {
                removed += 1;
              })
              .catch(() => {}),
          );
        }
      }
      if (jobs.length) await Promise.all(jobs);
    }
  }
  return removed;
}

export async function runJarAuthScrubTick() {
  return scrubExtensionOnlyJarLeaks();
}

export async function renewJarLeaseFromActiveLaunch() {
  const now = Date.now();
  if (tickInFlight || now - lastTickAt < MIN_TICK_MS) return 0;
  tickInFlight = true;
  lastTickAt = now;
  try {
    const { [LAUNCHES_KEY]: launches = {}, [ACTIVE_LAUNCH_KEY]: active } =
      await chrome.storage.session.get([LAUNCHES_KEY, ACTIVE_LAUNCH_KEY]);
    const list = Object.values(launches);
    if (!list.length && active?.webUrl) list.push(active);

    let renewed = 0;
    for (const launch of list) {
      if (!launch?.webUrl) continue;
      if (launch.transport === 'extension_only') {
        renewed += await scrubExtensionOnlyJarLeaks();
        continue;
      }
      if (launch.transport === 'page_storage') continue;
      if (!launch.session) continue;
      const lease = launch.leaseSeconds > 0 ? launch.leaseSeconds : JAR_LEASE_SECONDS;
      renewed += await renewJarCookieLease(launch.session, launch.webUrl, lease);
    }
    return renewed;
  } finally {
    tickInFlight = false;
  }
}

export async function softWipeLaunchCookies() {
  return;
}

export function registerJarScrubKeepalive() {
  if (globalThis.__oneclk_scrub_port) return;
  globalThis.__oneclk_scrub_port = true;

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM_NAME) return;
    void renewJarLeaseFromActiveLaunch();
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'oneclk_keepalive' && port.name !== 'kill_switch_link') return;

    void renewJarLeaseFromActiveLaunch();

    let timer = null;
    const tick = () => {
      void renewJarLeaseFromActiveLaunch();
    };
    timer = setInterval(tick, PORT_INTERVAL_MS);

    port.onMessage.addListener((msg) => {
      if (msg?.type === 'SCRUB_NOW' || msg?.type === 'RENEW_LEASE') tick();
    });

    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (timer) clearInterval(timer);
    });
  });
}
