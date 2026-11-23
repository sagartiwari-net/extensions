/**
 * Keepalive:
 * - jar mode (Grammarly): renew short leases so cookies don't die mid-session
 * - extension_only (ChatGPT): rare jar-leak scrub
 *
 * Uses chrome.alarms so SW sleep cannot skip renew (port-only renew was breaking Grammarly).
 */
import { apexFromHost } from './dnr-cookies.js';
import { relatedApexes } from './launch-tab.js';
import { JAR_LEASE_SECONDS, renewJarCookieLease } from './multi-host-cookies.js';

const ACTIVE_LAUNCH_KEY = 'oneclk_active_launch';
const LEASE_KEY = 'oneclk_jar_lease';
const SCRUB_KEY = 'oneclk_ext_only_scrub';
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
  await chrome.storage.session.set({
    [LEASE_KEY]: { apex, toolUrl, leaseSeconds: JAR_LEASE_SECONDS, at: Date.now() },
    [SCRUB_KEY]: {
      apex,
      toolUrl,
      names: (extraNames || []).filter(Boolean),
      at: Date.now(),
    },
  });
  try {
    await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });
  } catch {
    // Chrome may clamp to 1 min — still better than nothing
    await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 }).catch(() => {});
  }
}

export async function stopJarAuthScrub() {
  await chrome.storage.session.remove([LEASE_KEY, SCRUB_KEY]);
  try {
    await chrome.alarms.clear(ALARM_NAME);
  } catch {
    /* */
  }
}

export async function scrubExtensionOnlyJarLeaks() {
  const { [ACTIVE_LAUNCH_KEY]: active } = await chrome.storage.session.get(ACTIVE_LAUNCH_KEY);
  const { [SCRUB_KEY]: scrub } = await chrome.storage.session.get(SCRUB_KEY);
  if (!active?.webUrl || active.transport !== 'extension_only') return 0;

  let apex = '';
  try {
    apex = apexFromHost(new URL(active.webUrl).hostname);
  } catch {
    return 0;
  }
  const apexes = relatedApexes(apex);
  const nameSet = new Set([...(scrub?.names || []), ...(active.cookieNames || [])].filter(Boolean));

  let removed = 0;
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
    const { [ACTIVE_LAUNCH_KEY]: active } = await chrome.storage.session.get(ACTIVE_LAUNCH_KEY);
    if (!active?.webUrl) return 0;
    if (active.transport === 'extension_only') {
      return scrubExtensionOnlyJarLeaks();
    }
    if (!active.session) return 0;
    const lease = active.leaseSeconds > 0 ? active.leaseSeconds : JAR_LEASE_SECONDS;
    return renewJarCookieLease(active.session, active.webUrl, lease);
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

    // Critical: renew immediately on connect — delayed-only tick let Grammarly leases expire
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
