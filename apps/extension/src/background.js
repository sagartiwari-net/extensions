import { CLIENT_CONFIG } from './config.gen.js';
import { sessionLooksUsable, unwrapLaunchSession } from './lib/cookie-vault.js';
import { clearCookiesForApexDomain, cookiesForInject } from './lib/cookies.js';
import {
  apexFromHost,
  clearDnrCookieSession,
  resolveCookieTransport,
  restoreDnrCookieSessionIfNeeded,
  setupExtensionOnlyCookieSession,
  setupSetCookieStrip,
} from './lib/dnr-cookies.js';
import { sessionNeedsPageStorage } from './lib/idb-inject.js';
import {
  clearPageNoBundle,
  getPageNoBundle,
  isPageNoInjected,
  savePageNoBundle,
  startPageNoNavigationHook,
  tryPageNoInject,
  waitForPageNoInject,
} from './lib/page-no-launch.js';
import { applyLaunchReferer, clearLaunchRefererRule } from './lib/referer-dnr.js';
import { startExtensionEnforcement, syncAndEnforceExtensions } from './lib/enforcement.js';
import { checkIntegrity, getIntegrityAction, startIntegrityWatch } from './lib/integrity.js';
import {
  registerJarScrubKeepalive,
  renewJarLeaseFromActiveLaunch,
  startJarAuthScrub,
  stopJarAuthScrub,
} from './lib/jar-scrub.js';
import {
  JAR_LEASE_SECONDS,
  seedJarCookiesMultiHost,
  syncJarCookiesForUrl,
} from './lib/multi-host-cookies.js';
import { pageWatchdogMainWorld, pageWatchdogSource } from './content/page-watchdog.js';
import {
  isLaunchUrl,
  markLaunchTabIsolated,
  notifyLaunchTab,
  relatedApexes,
} from './lib/launch-tab.js';
import {
  applyCssRules,
  applyNetworkRules,
  startCssNavigationHook,
  storeActiveRules,
} from './lib/rules-apply.js';
import { startRulesSync } from './lib/rules-sync.js';
import { rememberMemberIdentity } from './lib/member-identity.js';
import {
  onDevtoolsDetectedFromPage,
  scanDevtoolsNow,
  snapshotDevtoolsWindows,
  startDevtoolsMonitor,
} from './lib/devtools-monitor.js';
import {
  emergencyWipeByUrl,
  markDisablePending,
  purgeAllLaunchCleanups,
  fireDisableWipeSync,
  hydrateWipeMemoryFromStorage,
  recoverAfterDisableIfNeeded,
  runDisableCleanup,
  saveLaunchCleanup,
  wipeDurableLaunchCookies,
} from './lib/session-cleanup.js';
import { applyUserAgent } from './lib/ua-apply.js';

async function injectPageWatchdog(tabId, launchUrl, cookieNames = []) {
  if (!tabId) return;
  // ISOLATED markers first — kill-switch content script cannot see MAIN sessionStorage
  await markLaunchTabIsolated(tabId, launchUrl);
  await chrome.storage.local.set({ oneclk_active_cookie_names: cookieNames || [] });
  // Pass watchdog source as arg — pageWatchdogMainWorld cannot import modules in MAIN world
  await chrome.scripting
    .executeScript({
      target: { tabId },
      world: 'MAIN',
      func: pageWatchdogMainWorld,
      args: [pageWatchdogSource(), launchUrl || '', cookieNames || []],
    })
    .catch(() => {});
  await notifyLaunchTab(tabId, launchUrl, cookieNames);
}

const ACTIVE_LAUNCH_KEY = 'oneclk_active_launch';

async function boot() {
  const recovered = await recoverAfterDisableIfNeeded().catch(() => false);
  if (!recovered) {
    await restoreDnrCookieSessionIfNeeded().catch(() => {});
  }
  await hydrateWipeMemoryFromStorage().catch(() => {});
  startIntegrityWatch();
  startExtensionEnforcement();
  startMultiHostNavSync();
  registerJarScrubKeepalive();
  startCssNavigationHook();
  startDevtoolsMonitor();
  startRulesSync();
  startPageNoNavigationHook();
}

/** Re-stamp missing jar cookies on SPA subdomain hops (jar mode only). Debounced. */
function startMultiHostNavSync() {
  if (globalThis.__oneclk_nav_sync) return;
  globalThis.__oneclk_nav_sync = true;
  let lastNavAt = 0;
  chrome.webNavigation?.onCommitted?.addListener((details) => {
    if (details.frameId !== 0 || !details.url?.startsWith('http')) return;
    const now = Date.now();
    if (now - lastNavAt < 1500) return;
    lastNavAt = now;
    void (async () => {
      const { [ACTIVE_LAUNCH_KEY]: active } = await chrome.storage.session.get(ACTIVE_LAUNCH_KEY);
      if (!active?.tabId || active.tabId !== details.tabId) return;
      if (!active.webUrl) return;
      // extension_only: auth lives in DNR rules — do not write jar on navigate
      if (active.transport !== 'extension_only' && active.session) {
        const lease = active.leaseSeconds > 0 ? active.leaseSeconds : 0;
        await syncJarCookiesForUrl(active.session, details.url, active.webUrl, lease).catch(
          () => {},
        );
      }
      // Re-mark launch + light watchdog ensure (Grammarly app→coda hops)
      await markLaunchTabIsolated(details.tabId, active.webUrl).catch(() => {});
      await notifyLaunchTab(details.tabId, active.webUrl, active.cookieNames || []).catch(() => {});
    })();
  });
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[1clk-v2] installed', CLIENT_CONFIG.SLUG);
  void boot();
});

chrome.runtime.onStartup?.addListener?.(() => {
  void boot();
});

// Service worker wake
void boot();

/** Best-effort wipe when Chrome disables/unloads this extension (tab open OR closed). */
// MV3 service workers: onSuspend is NOT available (throws if called → SW never boots).
try {
  chrome.runtime.onSuspend?.addListener?.(() => {
    // Sync path first — no await/storage (SW dies mid-async otherwise → Grammarly leak)
    fireDisableWipeSync();
    void markDisablePending();
    void wipeDurableLaunchCookies();
    void runDisableCleanup();
  });
} catch {
  /* MV3 SW */
}

try {
  globalThis.addEventListener?.('unload', () => {
    fireDisableWipeSync();
    void markDisablePending();
    void wipeDurableLaunchCookies();
  });
} catch {
  /* */
}

async function fetchSession(token) {
  const url = `${CLIENT_CONFIG.API_BASE}/session/data?token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.message || `HTTP ${res.status}`);
  }
  return json.data;
}

function waitForTabComplete(tabId, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    if (!tabId) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timeout'));
    }, timeoutMs);

    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab?.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }).catch(() => {});
  });
}

async function reportLaunch(payload) {
  try {
    await fetch(`${CLIENT_CONFIG.API_BASE}/launch-events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    /* ignore */
  }
}

async function applyProxy(proxy) {
  if (!proxy?.host || !proxy?.port) {
    try {
      await chrome.proxy.settings.clear({ scope: 'regular' });
    } catch {
      /* ignore */
    }
    return;
  }
  const config = {
    mode: 'fixed_servers',
    rules: {
      singleProxy: {
        scheme: proxy.scheme === 'socks5' ? 'socks5' : proxy.scheme === 'https' ? 'https' : 'http',
        host: proxy.host,
        port: Number(proxy.port),
      },
      bypassList: ['<local>'],
    },
  };
  await chrome.proxy.settings.set({ value: config, scope: 'regular' });
  if (proxy.username && chrome.webRequest?.onAuthRequired) {
    const onAuth = (details, asyncCallback) => {
      if (!details.isProxy) {
        if (asyncCallback) asyncCallback({});
        return {};
      }
      const creds = {
        authCredentials: { username: proxy.username, password: proxy.password || '' },
      };
      if (asyncCallback) asyncCallback(creds);
      return creds;
    };
    try {
      chrome.webRequest.onAuthRequired.addListener(onAuth, { urls: ['<all_urls>'] }, [
        'asyncBlocking',
      ]);
    } catch {
      /* MV3 host may reject; proxy still applied without auth */
    }
  }
}

/** In-flight launch lock — prevents parallel LAUNCH messages from racing one-time token */
let launchInFlight = null;
let launchInFlightToken = '';

async function processLaunch(token, askedClient) {
  const started = Date.now();

  const asked = String(askedClient || '').trim();
  if (!asked) {
    throw new Error('Wrong extension — missing client slug on launch');
  }
  if (asked !== CLIENT_CONFIG.SLUG) {
    throw new Error(`Wrong extension (got ${CLIENT_CONFIG.SLUG}, need ${asked})`);
  }

  const integrityAction = await getIntegrityAction();
  if (integrityAction === 'block') {
    throw new Error('Integrity check failed — launch blocked. Re-register hashes in admin.');
  }

  // Slug checked before consume — wrong pack never burns the token
  const data = await fetchSession(token);
  const sessionSlug = String(data.reseller_slug || '').trim();
  if (sessionSlug && sessionSlug !== CLIENT_CONFIG.SLUG) {
    throw new Error(
      `This pack is for “${CLIENT_CONFIG.SLUG}” — token belongs to “${sessionSlug}”. Install the matching reseller extension.`,
    );
  }
  // Vault (compress+AES) is opened on the API — extension gets plain session (fast path).
  const session = unwrapLaunchSession(data);
  if (!sessionLooksUsable(session)) {
    throw new Error('Session has no cookies/storage — check tool vault');
  }
  const strategy = data.inject_strategy || 'cookies';
  const webUrl = data.web_url;
  const rules = data.rules || { blocks: [], redirects: [], css: [] };

  // Remember member for security incident reports (username / IP / tool)
  await rememberMemberIdentity({
    username: data.username || null,
    client_ip: data.client_ip || null,
    reseller_id: data.reseller_id || null,
    tool_id: data.tool_id || null,
    tool_name: data.tool_name || null,
    web_url: webUrl,
    product_id: data.product_id || null,
    client_slug: data.reseller_slug || CLIENT_CONFIG.RESELLER_SLUG || CLIENT_CONFIG.SLUG,
  }).catch(() => {});

  try {
    await applyProxy(data.proxy || null);
  } catch (err) {
    console.warn('[1clk-v2] proxy apply failed', err);
  }

  let dnrCount = 0;
  try {
    await storeActiveRules(rules);
    dnrCount = await applyNetworkRules(rules, data.security_tier ?? 1);
  } catch (err) {
    console.warn('[1clk-v2] network rules failed', err);
  }

  // Baseline open DevTools windows, then arm inspect monitor for this launch
  await snapshotDevtoolsWindows().catch(() => {});
  startDevtoolsMonitor();
  void scanDevtoolsNow();

  try {
    await applyUserAgent(data.user_agent || null);
  } catch (err) {
    console.warn('[1clk-v2] UA apply failed', err);
  }

  const cookieList = cookiesForInject(session.cookies || session.Cookies || []);
  const transport = resolveCookieTransport(session, webUrl);
  await clearDnrCookieSession().catch(() => {});
  await clearLaunchRefererRule().catch(() => {});

  // Always wipe leftover jar auth for this apex + related (ChatGPT↔OpenAI).
  try {
    const launchApex = apexFromHost(new URL(webUrl).hostname);
    for (const a of relatedApexes(launchApex)) {
      await clearCookiesForApexDomain(a).catch(() => {});
    }
  } catch {
    /* */
  }

  let seeded = { attempted: cookieList.length, set: 0, hosts: [] };
  let strip = false;
  let dnrHosts = 0;

  const leaseSeconds = transport.leaseJar ? JAR_LEASE_SECONDS : 0;

  if (transport.mode === 'extension_only') {
    // PHP + ChatGPT/NextAuth: Cookie header via DNR only — never write browser jar.
    const dnr = await setupExtensionOnlyCookieSession(webUrl, cookieList, {
      stripSetCookie: transport.stripSetCookie,
      aggressiveStrip: !!transport.aggressiveStrip,
    });
    dnrHosts = dnr.hosts?.length || 0;
    strip = !!transport.stripSetCookie;
    seeded = { attempted: cookieList.length, set: 0, hosts: dnr.hosts || [] };
    // Scrub any Set-Cookie leaks so jar stays empty while extension is on.
    if (transport.scrubJar) {
      await startJarAuthScrub(webUrl, cookieList.map((c) => c.name).filter(Boolean));
    } else {
      await stopJarAuthScrub().catch(() => {});
    }
  } else {
    // Grammarly: jar + short lease (launch #52 worked; #53 extension_only+scrub spun).
    seeded = await seedJarCookiesMultiHost(session, webUrl, { leaseSeconds });
    if (transport.leaseJar) {
      await startJarAuthScrub(webUrl);
    } else {
      await stopJarAuthScrub().catch(() => {});
    }
    if (transport.stripSetCookie) {
      try {
        await setupSetCookieStrip(webUrl, { includeApp: false });
        strip = true;
      } catch (err) {
        console.warn('[1clk-v2] set-cookie strip failed', err);
      }
    }
  }

  // Tools that check Referer (paste referer or panel override in vault)
  const launchReferer =
    (typeof session.referer === 'string' && session.referer) ||
    (typeof session.referrer === 'string' && session.referrer) ||
    null;
  await applyLaunchReferer(webUrl, launchReferer).catch(() => {});

  const needsPageStorage =
    sessionNeedsPageStorage(session) || strategy === 'storage_reload' || strategy === 'idb';

  // page_no: open blank first, register vault, then navigate — inject at commit before SPA
  const tab = await chrome.tabs.create({
    url: needsPageStorage ? 'about:blank' : webUrl,
    active: true,
  });
  const cookieNames = cookieList.map((c) => c.name).filter(Boolean);

  // Mark active launch immediately so kill-switch / watchdog can attach without waiting for load.
  if (tab.id) {
    await saveLaunchCleanup(tab.id, webUrl, cookieList).catch(() => {});
    await chrome.storage.session.set({
      [ACTIVE_LAUNCH_KEY]: {
        tabId: tab.id,
        webUrl,
        session: transport.writeJar ? session : { ...session, cookies: [] },
        transport: transport.mode,
        leaseSeconds,
        cookieNames,
        at: Date.now(),
      },
    });
    if (needsPageStorage) {
      await savePageNoBundle(tab.id, webUrl, session);
      const navReady = waitForPageNoInject(tab.id, webUrl, 25000);
      await chrome.tabs.update(tab.id, { url: webUrl });
      // Member bridge returns ASAP — IDB inject continues in background
      void navReady.then(async (injected) => {
        try {
          await markLaunchTabIsolated(tab.id, webUrl).catch(() => {});
          await notifyLaunchTab(tab.id, webUrl, cookieNames).catch(() => {});
          if (transport.writeJar) {
            await syncJarCookiesForUrl(session, webUrl, webUrl, leaseSeconds).catch(() => {});
          }
          await injectPageWatchdog(tab.id, webUrl, cookieNames);
          const pageUrl = (await chrome.tabs.get(tab.id).catch(() => null))?.url || webUrl;
          const cssCount = await applyCssRules(tab.id, pageUrl, rules);
          const warnNote = integrityAction === 'warn' ? ';integrity=warn' : '';
          await reportLaunch({
            reseller_id: data.reseller_id,
            tool_id: data.tool_id,
            success: true,
            reason: `mode=${transport.mode};jar=${seeded.set}/${seeded.attempted};dnrHosts=${dnrHosts || seeded.hosts.length};strip=${strip ? 1 : 0};lease=${leaseSeconds};rules=${dnrCount};css=${cssCount};page_no=1;idb=${injected ? 1 : 0}${warnNote}`,
            inject_strategy: strategy,
            duration_ms: Date.now() - started,
            extension_id: chrome.runtime.id,
            username: data.username || null,
            client_ip: data.client_ip || null,
            product_id: data.product_id || null,
          });
        } catch (err) {
          console.warn('[1clk-v2] page_no finish failed', err);
        } finally {
          // Keep bundle briefly so document_start backup / post-reload can still see it
          setTimeout(() => void clearPageNoBundle(tab.id), 60000);
        }
      });
    }
  }

  // Cookie-only path: finish inject async without blocking member bridge
  void (async () => {
    if (needsPageStorage) return; // handled above
    try {
      await waitForTabComplete(tab.id, 45000).catch(() => {});

      if (transport.writeJar) {
        await syncJarCookiesForUrl(session, webUrl, webUrl, leaseSeconds).catch(() => {});
      }

      // extension_only: re-wipe jar after first paint — catches Set-Cookie races before strip.
      if (!transport.writeJar && tab.id) {
        try {
          const launchApex = apexFromHost(new URL(webUrl).hostname);
          for (const a of relatedApexes(launchApex)) {
            await clearCookiesForApexDomain(a).catch(() => {});
          }
        } catch {
          /* */
        }
      }

      if (tab.id) {
        await injectPageWatchdog(tab.id, webUrl, cookieNames);
      }

      let cssCount = 0;
      if (tab.id) {
        const pageUrl = (await chrome.tabs.get(tab.id).catch(() => null))?.url || webUrl;
        cssCount = await applyCssRules(tab.id, pageUrl, rules);
        for (const ms of [400, 1200, 3000]) {
          setTimeout(() => {
            void chrome.tabs
              .get(tab.id)
              .then((t) => applyCssRules(tab.id, t?.url || webUrl, rules))
              .catch(() => {});
          }, ms);
        }
      }

      const warnNote = integrityAction === 'warn' ? ';integrity=warn' : '';
      const pageNoNote = needsPageStorage ? ';page_no=1' : '';
      await reportLaunch({
        reseller_id: data.reseller_id,
        tool_id: data.tool_id,
        success: true,
        reason: `mode=${transport.mode};jar=${seeded.set}/${seeded.attempted};dnrHosts=${dnrHosts || seeded.hosts.length};strip=${strip ? 1 : 0};lease=${leaseSeconds};rules=${dnrCount};css=${cssCount}${warnNote}${pageNoNote}`,
        inject_strategy: strategy,
        duration_ms: Date.now() - started,
        extension_id: chrome.runtime.id,
        username: data.username || null,
        client_ip: data.client_ip || null,
        product_id: data.product_id || null,
      });
    } catch (err) {
      console.warn('[1clk-v2] post-open launch finish failed', err);
    } finally {
      if (tab.id) void clearPageNoBundle(tab.id);
    }
  })();

  return {
    success: true,
    tool_name: data.tool_name,
    username: data.username || null,
    client: data.reseller_slug || CLIENT_CONFIG.SLUG,
    web_url: webUrl,
    strategy,
    cookieCount: seeded.set,
    cookieAttempted: seeded.attempted,
    integrity: integrityAction,
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'PING' || msg?.type === '__1clk_ping') {
    // Cheap liveness only — lease renew is port/alarm driven (PING used to thrash CPU)
    sendResponse({ ok: true, slug: CLIENT_CONFIG.SLUG, api: CLIENT_CONFIG.API_BASE });
    return true;
  }
  if (msg?.type === 'IS_LAUNCH_TAB') {
    const url = msg.url || _sender?.tab?.url || '';
    const tabId = _sender?.tab?.id;
    Promise.all([
      isLaunchUrl(url),
      tabId ? getPageNoBundle(tabId) : Promise.resolve(null),
      chrome.storage.session.get(ACTIVE_LAUNCH_KEY),
    ])
      .then(([res, bundle, store]) => {
        const active = store?.[ACTIVE_LAUNCH_KEY];
        const yes =
          !!res?.yes ||
          !!bundle ||
          (active && tabId && Number(active.tabId) === Number(tabId));
        sendResponse({ yes, cookieNames: res?.cookieNames || [] });
      })
      .catch(() => sendResponse({ yes: false, cookieNames: [] }));
    return true;
  }
  if (msg?.type === 'PAGE_NO_CHECK') {
    const tabId = _sender?.tab?.id;
    const host = String(msg.toolHost || '')
      .replace(/^www\./, '')
      .toLowerCase();
    if (!tabId || !host) {
      sendResponse({ done: false });
      return false;
    }
    isPageNoInjected(tabId, host)
      .then((done) => sendResponse({ done }))
      .catch(() => sendResponse({ done: false }));
    return true;
  }
  if (msg?.type === 'PAGE_NO_BACKUP_INJECT') {
    const tabId = _sender?.tab?.id;
    const pageUrl = msg.pageUrl || _sender?.tab?.url || '';
    if (!tabId || !pageUrl) {
      sendResponse({ ok: false });
      return false;
    }
    tryPageNoInject(tabId, pageUrl)
      .then((ok) => sendResponse({ ok }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg?.type === 'ENSURE_WATCHDOG') {
    const tabId = _sender?.tab?.id;
    const url = msg.url || _sender?.tab?.url || '';
    const names = msg.cookieNames || [];
    if (tabId) {
      injectPageWatchdog(tabId, url, names)
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));
      return true;
    }
    sendResponse({ ok: false });
    return true;
  }
  if (msg?.type === 'MARK_DISABLE_PENDING') {
    void markDisablePending().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === 'EMERGENCY_COOKIE_CLEANUP' || msg?.type === 'KILL_SWITCH_CLEANUP') {
    // Full wipe only — soft wipe on ping/port miss caused auto-logout.
    const url = msg.url || '';
    fireDisableWipeSync(); // blank tool tabs + cookie remove without awaiting storage
    Promise.resolve()
      .then(() => markDisablePending())
      .then(() => stopJarAuthScrub())
      .then(() => wipeDurableLaunchCookies())
      .then(() => (url ? emergencyWipeByUrl(url) : Promise.resolve()))
      .then(() => clearDnrCookieSession())
      .then(() => clearLaunchRefererRule())
      .then(() => chrome.storage.session.remove(ACTIVE_LAUNCH_KEY))
      .then(() => purgeAllLaunchCleanups({ blankTabs: true }))
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg?.type === 'CHECK_INTEGRITY') {
    checkIntegrity()
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ action: 'allow', status: 'error', message: String(err) }));
    return true;
  }
  if (msg?.type === 'ENFORCE_NOW') {
    syncAndEnforceExtensions()
      .then((res) => sendResponse({ success: true, ...res }))
      .catch((err) => sendResponse({ success: false, message: String(err) }));
    return true;
  }
  if (msg?.type === 'DEVTOOLS_DETECTED') {
    onDevtoolsDetectedFromPage(msg.detection_type, msg.page_url || _sender?.tab?.url || '')
      .then((res) => sendResponse(res))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg?.type === 'LAUNCH') {
    const token = String(msg.token || '').trim();
    const asked = String(msg.client || '').trim();
    if (!token) {
      sendResponse({ success: false, message: 'Missing launch token' });
      return false;
    }
    if (launchInFlight && launchInFlightToken === token) {
      // Same token already launching — wait for that promise instead of double-consume
      launchInFlight
        .then((res) => sendResponse(res))
        .catch((err) =>
          sendResponse({
            success: false,
            message: err instanceof Error ? err.message : 'Launch failed',
          }),
        );
      return true;
    }
    if (launchInFlight) {
      sendResponse({ success: false, message: 'Another launch is in progress — try again' });
      return false;
    }
    launchInFlightToken = token;
    launchInFlight = processLaunch(token, asked)
      .then((res) => {
        launchInFlight = null;
        launchInFlightToken = '';
        return res;
      })
      .catch((err) => {
        launchInFlight = null;
        launchInFlightToken = '';
        throw err;
      });
    launchInFlight
      .then((res) => sendResponse(res))
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Launch failed';
        sendResponse({ success: false, message });
      });
    return true;
  }
  return false;
});
