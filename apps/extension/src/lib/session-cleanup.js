/**
 * Disable / emergency cleanup.
 *
 * Important: page JS CANNOT survive extension disable (Chrome kills content scripts).
 * Closed-tab logout relies on:
 *   1) in-memory wipe targets (no async storage read on suspend)
 *   2) durable apex/host list in storage.local
 *   3) short jar lease (backup if suspend wipe races)
 * Membership / panel hosts are whitelisted and never wiped.
 */
import { CLIENT_CONFIG } from '../config.gen.js';
import {
  clearCookiesBySnapshot,
  clearCookiesForApexDomain,
  clearCookiesForHost,
} from './cookies.js';
import {
  apexFromHost,
  clearDnrCookieSession,
  clearDnrCookieSessionForApex,
} from './dnr-cookies.js';
import { relatedApexes } from './launch-tab.js';

const SESSION_KEY = 'oneclk_launch_cleanup';
const HOSTS_KEY = 'oneclk_last_launch_hosts';
const APEX_KEY = 'oneclk_last_launch_apexes';
const DISABLE_PENDING_KEY = 'extension_disable_pending';

const CLEANUP_PREFIXES = [
  'www',
  'app',
  'auth',
  'api',
  'pro',
  'secure',
  'members',
  'login',
  'account',
  'accounts',
  'dashboard',
  'sso',
  'suite',
  'id',
  'coda',
  'chat',
  'openai',
];

/** Hot mirror for onSuspend — storage.get is too slow when SW is dying. */
const wipeMemory = {
  apexes: [],
  hosts: [],
  cookies: [],
  origins: [],
};

function membershipWhitelist() {
  const set = new Set();
  const addHost = (host) => {
    const h = String(host || '')
      .replace(/^www\./, '')
      .toLowerCase();
    if (!h) return;
    set.add(h);
    const parts = h.split('.');
    if (parts.length >= 2) set.add(parts.slice(-2).join('.'));
  };
  try {
    addHost(new URL(CLIENT_CONFIG.API_BASE).hostname);
  } catch {
    /* */
  }
  for (const m of CLIENT_CONFIG.MEMBER_MATCHES || []) {
    try {
      const cleaned = String(m)
        .replace(/^\*:\/\//, 'https://')
        .replace(/\*\./g, '')
        .replace(/\*$/g, '')
        .replace(/\*/g, '');
      if (cleaned.startsWith('http')) addHost(new URL(cleaned).hostname);
      else addHost(cleaned.split('/')[0]);
    } catch {
      /* */
    }
  }
  // Local panel defaults
  set.add('127.0.0.1');
  set.add('localhost');
  return set;
}

function isWhitelistedHost(host) {
  const wl = membershipWhitelist();
  const h = String(host || '')
    .replace(/^www\./, '')
    .toLowerCase();
  if (!h) return false;
  if (wl.has(h)) return true;
  for (const w of wl) {
    if (h === w || h.endsWith(`.${w}`) || w.endsWith(`.${h}`)) return true;
  }
  return false;
}

function filterHosts(hosts = []) {
  return (hosts || []).filter((h) => h && !isWhitelistedHost(h));
}

function filterApexes(apexes = []) {
  return (apexes || []).filter((a) => a && !isWhitelistedHost(a));
}

function syncWipeMemory({ apexes = [], hosts = [], cookies = [] } = {}) {
  const ax = filterApexes([
    ...new Set([...(wipeMemory.apexes || []), ...apexes].filter(Boolean)),
  ]);
  const hs = filterHosts([
    ...new Set([...(wipeMemory.hosts || []), ...hosts].filter(Boolean)),
  ]);
  const origins = [];
  for (const host of hs) {
    const h = String(host).replace(/^www\./, '').toLowerCase();
    if (!h || isWhitelistedHost(h)) continue;
    origins.push(`https://${h}`, `http://${h}`, `https://www.${h}`, `http://www.${h}`);
  }
  wipeMemory.apexes = ax;
  wipeMemory.hosts = hs;
  wipeMemory.cookies = [...(wipeMemory.cookies || []), ...(cookies || [])];
  wipeMemory.origins = [...new Set(origins)];
}

export function collectCleanupHosts(url, cookies = []) {
  const hosts = new Set();
  let apex = '';
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    hosts.add(hostname);
    apex = apexFromHost(hostname);
    hosts.add(apex);
  } catch {
    /* */
  }
  if (apex) {
    for (const p of CLEANUP_PREFIXES) hosts.add(`${p}.${apex}`);
  }
  for (const c of cookies) {
    if (!c?.domain) continue;
    const d = String(c.domain).replace(/^\./, '').toLowerCase();
    hosts.add(d);
    hosts.add(apexFromHost(d));
  }
  return filterHosts([...hosts]);
}

function hostsToOrigins(hosts = []) {
  const origins = new Set();
  for (const raw of filterHosts(hosts)) {
    const host = String(raw || '')
      .replace(/^www\./, '')
      .toLowerCase();
    if (!host) continue;
    for (const scheme of ['https', 'http']) {
      origins.add(`${scheme}://${host}`);
      origins.add(`${scheme}://www.${host}`);
    }
  }
  return [...origins];
}

export async function clearBrowsingDataForHosts(hosts = []) {
  if (!chrome.browsingData?.remove) return;
  const origins = hostsToOrigins(hosts);
  if (!origins.length) return;
  await chrome.browsingData.remove(
    { origins },
    {
      cookies: true,
      cacheStorage: true,
      serviceWorkers: true,
      localStorage: true,
      indexedDB: true,
    },
  );
}

export function cookieCleanupSnapshot(cookies = []) {
  return (cookies || [])
    .filter((c) => c?.name)
    .map((c) => ({ name: c.name, domain: c.domain || '' }));
}

export async function saveLaunchCleanup(tabId, url, cookies = []) {
  let apex = '';
  try {
    apex = apexFromHost(new URL(url).hostname);
  } catch {
    /* */
  }
  if (isWhitelistedHost(apex)) return null;

  const entry = {
    url,
    apex,
    cookies: cookieCleanupSnapshot(cookies),
    hosts: collectCleanupHosts(url, cookies),
    savedAt: Date.now(),
  };
  const { [SESSION_KEY]: map = {} } = await chrome.storage.local.get(SESSION_KEY);
  map[String(tabId)] = entry;
  const { [HOSTS_KEY]: prevHosts = [] } = await chrome.storage.local.get(HOSTS_KEY);
  const { [APEX_KEY]: prevApex = [] } = await chrome.storage.local.get(APEX_KEY);
  const related = relatedApexes(apex);
  const hosts = filterHosts([
    ...new Set([...(prevHosts || []), ...entry.hosts, ...related.flatMap((r) => [r, `www.${r}`, `auth.${r}`, `api.${r}`, `chat.${r}`, `coda.${r}`, `app.${r}`])]),
  ]);
  const apexes = filterApexes([...new Set([...(prevApex || []), apex, ...related].filter(Boolean))]);

  await chrome.storage.local.set({
    [SESSION_KEY]: map,
    [HOSTS_KEY]: hosts,
    [APEX_KEY]: apexes,
  });

  // Keep suspend wipe hot — no storage read needed when extension dies
  syncWipeMemory({
    apexes,
    hosts,
    cookies: entry.cookies,
  });
  return entry;
}

export async function markDisablePending() {
  await chrome.storage.local.set({ [DISABLE_PENDING_KEY]: Date.now() });
}

/** Known Grammarly auth names — remove without waiting for getAll (SW dies mid-async). */
const GRAMMARLY_COOKIE_NAMES = [
  'grauth',
  'gac',
  'csrf-token',
  'csrf_token',
  'isGrammarlyUser',
  'last_authn_event',
  'tdi',
  'gnar_containerId',
  'redirect_location',
  'FunnelId',
  'variant_user',
];

const GRAMMARLY_HOSTS = [
  'grammarly.com',
  'www.grammarly.com',
  'app.grammarly.com',
  'auth.grammarly.com',
  'coda.grammarly.com',
  'gnar.grammarly.com',
  'data.grammarly.com',
  'subscription.grammarly.com',
];

const CANVA_COOKIE_NAMES = ['ASI', 'CCDA', 'CDI', 'CL', 'CSession', 'cs_session'];

const CANVA_HOSTS = [
  'canva.com',
  'www.canva.com',
  'api.canva.com',
  'content.canva.com',
  'export.canva.com',
  'media.canva.com',
  'document.canva.com',
  'static.canva.com',
];

function purgeNamedOnHosts(names, hosts) {
  for (const name of names) {
    for (const host of hosts) {
      try {
        chrome.cookies.remove(
          { url: `https://${host}/`, name },
          () => void chrome.runtime.lastError,
        );
      } catch {
        /* */
      }
    }
  }
}

/** Origins always wiped on disable — works with ZERO open tabs (Jasper IDB + jar). */
const ALWAYS_WIPE_ORIGINS = [
  'https://grammarly.com',
  'http://grammarly.com',
  'https://www.grammarly.com',
  'https://app.grammarly.com',
  'https://auth.grammarly.com',
  'https://coda.grammarly.com',
  'https://canva.com',
  'http://canva.com',
  'https://www.canva.com',
  'https://api.canva.com',
  'https://content.canva.com',
  'https://export.canva.com',
  'https://media.canva.com',
  'https://document.canva.com',
  'https://app.jasper.ai',
  'https://jasper.ai',
  'https://www.jasper.ai',
  'https://chatgpt.com',
  'https://www.chatgpt.com',
  'https://chat.openai.com',
  'https://openai.com',
  'https://www.openai.com',
  'https://semrush.com',
  'https://www.semrush.com',
];

const ALWAYS_WIPE_APEXES = [
  'grammarly.com',
  'canva.com',
  'jasper.ai',
  'chatgpt.com',
  'openai.com',
  'semrush.com',
];

/** Immediate named removes — no getAll race (Grammarly / Canva jar leave-behind). */
function fireNamedCookiePurge(apexes = []) {
  const list = (apexes || []).map((a) => String(a || '').toLowerCase());
  const all = !list.length;
  if (all || list.some((a) => a.includes('grammarly'))) {
    purgeNamedOnHosts(GRAMMARLY_COOKIE_NAMES, GRAMMARLY_HOSTS);
  }
  if (all || list.some((a) => a.includes('canva'))) {
    purgeNamedOnHosts(CANVA_COOKIE_NAMES, CANVA_HOSTS);
  }
}

function wipeApexCookiesFireForget(apexes = []) {
  fireNamedCookiePurge(apexes);
  for (const apex of filterApexes(apexes)) {
    try {
      for (const domain of [apex, `.${apex}`]) {
        chrome.cookies.getAll({ domain }, (list) => {
          for (const c of list || []) {
            const host = (c.domain || apex).replace(/^\./, '');
            if (isWhitelistedHost(host)) continue;
            const path = c.path || '/';
            for (const url of [
              `https://${host}${path}`,
              `https://www.${host}${path}`,
              `http://${host}${path}`,
            ]) {
              try {
                chrome.cookies.remove({ url, name: c.name }, () => void chrome.runtime.lastError);
              } catch {
                /* */
              }
            }
          }
        });
      }
    } catch {
      /* */
    }
  }
}

function wipeOriginsFireForget(origins = []) {
  if (!origins.length || !chrome.browsingData?.remove) return;
  try {
    chrome.browsingData.remove(
      { origins },
      {
        cookies: true,
        cacheStorage: true,
        serviceWorkers: true,
        localStorage: true,
        indexedDB: true,
      },
      () => void chrome.runtime.lastError,
    );
  } catch {
    /* */
  }
}

function blankLaunchTabsFireForget(apexes = [], hosts = []) {
  try {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs || []) {
        if (!tab?.id || !tab.url?.startsWith('http')) continue;
        let apex = '';
        try {
          apex = apexFromHost(new URL(tab.url).hostname);
        } catch {
          continue;
        }
        if (isWhitelistedHost(apex)) continue;
        const hit =
          apexes.includes(apex) ||
          apexes.some((a) => relatedApexes(a).includes(apex)) ||
          hosts.some(
            (h) => tab.url.includes(h) || apex === h || apex.endsWith(`.${h}`),
          );
        if (hit) {
          chrome.tabs.update(tab.id, { url: 'about:blank' }, () => void chrome.runtime.lastError);
        }
      }
    });
  } catch {
    /* */
  }
}

/**
 * Fire-and-forget wipe for onSuspend / disable (tab open OR closed).
 * MUST NOT depend on open tabs or warm wipeMemory — MV3 kills SW before async storage.
 */
export function fireDisableWipeSync() {
  try {
    chrome.storage.local.set({ [DISABLE_PENDING_KEY]: Date.now() });
  } catch {
    /* */
  }

  const apexes = filterApexes([
    ...ALWAYS_WIPE_APEXES,
    ...(wipeMemory.apexes || []),
  ]);
  const hosts = filterHosts(wipeMemory.hosts || []);
  const origins = [
    ...ALWAYS_WIPE_ORIGINS,
    ...(wipeMemory.origins?.length ? wipeMemory.origins : hostsToOrigins(hosts)),
  ];
  const snaps = wipeMemory.cookies || [];

  try {
    void clearDnrCookieSession();
  } catch {
    /* */
  }

  // Closed-tab path: always purge known jar tools (no storage / memory required)
  fireNamedCookiePurge(ALWAYS_WIPE_APEXES);
  wipeOriginsFireForget([...new Set(origins)]);
  wipeApexCookiesFireForget(apexes);

  for (const snap of snaps) {
    if (!snap?.name) continue;
    const domain = String(snap.domain || '')
      .replace(/^\./, '')
      .toLowerCase();
    if (!domain || isWhitelistedHost(domain)) continue;
    try {
      chrome.cookies.remove({ url: `https://${domain}/`, name: snap.name }, () => void chrome.runtime.lastError);
      chrome.cookies.remove(
        { url: `https://www.${domain}/`, name: snap.name },
        () => void chrome.runtime.lastError,
      );
      chrome.cookies.remove(
        { url: `https://app.${domain}/`, name: snap.name },
        () => void chrome.runtime.lastError,
      );
    } catch {
      /* */
    }
  }

  blankLaunchTabsFireForget(apexes, hosts);

  // SW may have woken empty — also wipe from durable storage (callback, no await)
  try {
    chrome.storage.local.get([APEX_KEY, HOSTS_KEY, SESSION_KEY], (store) => {
      if (chrome.runtime.lastError) return;
      const moreApex = filterApexes(store?.[APEX_KEY] || []);
      const moreHosts = filterHosts(store?.[HOSTS_KEY] || []);
      wipeOriginsFireForget(hostsToOrigins(moreHosts));
      wipeApexCookiesFireForget(moreApex);
      blankLaunchTabsFireForget(moreApex, moreHosts);
      for (const entry of Object.values(store?.[SESSION_KEY] || {})) {
        for (const snap of entry?.cookies || []) {
          if (!snap?.name) continue;
          const domain = String(snap.domain || '')
            .replace(/^\./, '')
            .toLowerCase();
          if (!domain || isWhitelistedHost(domain)) continue;
          try {
            chrome.cookies.remove(
              { url: `https://${domain}/`, name: snap.name },
              () => void chrome.runtime.lastError,
            );
            chrome.cookies.remove(
              { url: `https://app.${domain}/`, name: snap.name },
              () => void chrome.runtime.lastError,
            );
          } catch {
            /* */
          }
        }
      }
    });
  } catch {
    /* */
  }
}

async function wipePageContext(tabId) {
  if (!tabId) return;
  await chrome.scripting
    .executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        try {
          localStorage.clear();
        } catch {
          /* */
        }
        try {
          sessionStorage.clear();
        } catch {
          /* */
        }
      },
    })
    .catch(() => {});
}

export async function cleanupEntry(entry) {
  if (!entry) return;
  if (entry.apex && !isWhitelistedHost(entry.apex)) {
    await clearCookiesForApexDomain(entry.apex).catch(() => {});
  }
  const hosts = filterHosts(entry.hosts || []);
  if (hosts.length) {
    await clearBrowsingDataForHosts(hosts).catch(() => {});
  }
  await clearCookiesBySnapshot(entry.cookies || []).catch(() => {});
  for (const host of hosts) {
    await clearCookiesForHost(host).catch(() => {});
  }
}

/** Immediate apex wipe — used by kill-switch while SW can still run. */
export async function emergencyWipeByUrl(url) {
  if (!url?.startsWith('http')) return;
  let apex = '';
  try {
    apex = apexFromHost(new URL(url).hostname);
  } catch {
    return;
  }
  if (isWhitelistedHost(apex)) return;

  await clearDnrCookieSession().catch(() => {});
  const apexes = filterApexes(relatedApexes(apex));
  for (const a of apexes) {
    await clearCookiesForApexDomain(a).catch(() => {});
  }
  const hosts = collectCleanupHosts(url);
  for (const a of apexes) {
    hosts.push(a, `www.${a}`, `auth.${a}`, `api.${a}`, `chat.${a}`, `coda.${a}`, `app.${a}`);
  }
  const uniqHosts = filterHosts([...new Set(hosts)]);
  syncWipeMemory({ apexes, hosts: uniqHosts });
  await clearBrowsingDataForHosts(uniqHosts).catch(() => {});
  for (const host of uniqHosts) {
    await clearCookiesForHost(host).catch(() => {});
  }
  // Blank matching open tabs
  fireDisableWipeSync();
}

export async function wipeDurableLaunchCookies() {
  const store = await chrome.storage.local.get([APEX_KEY, HOSTS_KEY, SESSION_KEY]);
  const apexes = filterApexes(store[APEX_KEY] || []);
  const hosts = filterHosts(store[HOSTS_KEY] || []);
  const map = store[SESSION_KEY] || {};

  syncWipeMemory({ apexes, hosts });

  const snapshots = [];
  for (const entry of Object.values(map)) {
    if (entry?.cookies?.length) snapshots.push(...entry.cookies);
  }
  if (snapshots.length) {
    await clearCookiesBySnapshot(snapshots).catch(() => {});
  }

  await Promise.all(apexes.map((apex) => clearCookiesForApexDomain(apex).catch(() => {})));

  for (const entry of Object.values(map)) {
    await cleanupEntry(entry).catch(() => {});
  }

  if (hosts.length) {
    await clearBrowsingDataForHosts(hosts).catch(() => {});
    await Promise.all(hosts.map((h) => clearCookiesForHost(h).catch(() => {})));
  }

  return { apexes: apexes.length, hosts: hosts.length };
}

export async function purgeAllLaunchCleanups({ blankTabs = true } = {}) {
  await clearDnrCookieSession().catch(() => {});
  const store = await chrome.storage.local.get([SESSION_KEY, HOSTS_KEY, APEX_KEY]);
  const map = store[SESSION_KEY] || {};
  const durableHosts = filterHosts(store[HOSTS_KEY] || []);
  const durableApexes = filterApexes(store[APEX_KEY] || []);
  const entries = Object.entries(map);

  syncWipeMemory({ apexes: durableApexes, hosts: durableHosts });

  for (const [tabIdStr, entry] of entries) {
    await cleanupEntry(entry).catch(() => {});
    const tabId = Number(tabIdStr);
    if (blankTabs && Number.isFinite(tabId)) {
      await wipePageContext(tabId);
      try {
        const tab = await chrome.tabs.get(tabId);
        if ((tab.url || '').startsWith('http') && !isWhitelistedHost(apexFromHost(new URL(tab.url).hostname))) {
          await chrome.tabs.update(tabId, { url: 'about:blank' });
        }
      } catch {
        /* tab gone */
      }
    }
  }

  for (const apex of durableApexes) {
    await clearCookiesForApexDomain(apex).catch(() => {});
  }

  if (durableHosts.length) {
    await clearBrowsingDataForHosts(durableHosts).catch(() => {});
    for (const host of durableHosts) {
      await clearCookiesForHost(host).catch(() => {});
    }
  }

  if (blankTabs) {
    fireDisableWipeSync();
  }

  await chrome.storage.local.remove([SESSION_KEY, HOSTS_KEY, APEX_KEY]);
  wipeMemory.apexes = [];
  wipeMemory.hosts = [];
  wipeMemory.cookies = [];
  wipeMemory.origins = [];
}

export async function runDisableCleanup() {
  await markDisablePending();
  fireDisableWipeSync();
  await purgeAllLaunchCleanups({ blankTabs: true });
}

export async function recoverAfterDisableIfNeeded() {
  const { [DISABLE_PENDING_KEY]: pending } = await chrome.storage.local.get(DISABLE_PENDING_KEY);
  const { [APEX_KEY]: apexes = [] } = await chrome.storage.local.get(APEX_KEY);
  const { [HOSTS_KEY]: hosts = [] } = await chrome.storage.local.get(HOSTS_KEY);
  if (!pending && !apexes?.length && !hosts?.length) return false;
  await purgeAllLaunchCleanups({ blankTabs: true });
  await chrome.storage.local.remove(DISABLE_PENDING_KEY);
  return true;
}

/** Hydrate wipeMemory after SW restart while launch still active. */
export async function hydrateWipeMemoryFromStorage() {
  const store = await chrome.storage.local.get([APEX_KEY, HOSTS_KEY, SESSION_KEY]);
  const apexes = filterApexes(store[APEX_KEY] || []);
  const hosts = filterHosts(store[HOSTS_KEY] || []);
  const cookies = [];
  for (const entry of Object.values(store[SESSION_KEY] || {})) {
    if (entry?.cookies?.length) cookies.push(...entry.cookies);
  }
  syncWipeMemory({ apexes, hosts, cookies });
}

/** True if any open http(s) tab still belongs to this apex (or related). */
export async function anyOpenTabForApex(apex) {
  const targets = new Set(filterApexes(relatedApexes(apex)));
  if (!targets.size) return false;
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs || []) {
      if (!tab?.url?.startsWith('http')) continue;
      let tabApex = '';
      try {
        tabApex = apexFromHost(new URL(tab.url).hostname);
      } catch {
        continue;
      }
      if (!tabApex || isWhitelistedHost(tabApex)) continue;
      if (targets.has(tabApex)) return true;
      for (const t of targets) {
        if (relatedApexes(t).includes(tabApex)) return true;
      }
    }
  } catch {
    /* */
  }
  return false;
}

/**
 * Backup layer (2nd): last tab of a launched tool apex closed → wipe cookies/IDB.
 * Primary layer stays: disable / kill-switch / inspect / refresh (unchanged).
 * Only runs while extension is still alive (SW can await).
 */
export async function wipeLaunchOnTabClosed(tabId, webUrl = '') {
  let url = webUrl;
  let cookies = [];
  try {
    const { [SESSION_KEY]: map = {} } = await chrome.storage.local.get(SESSION_KEY);
    const entry = map[String(tabId)];
    if (entry?.url) url = entry.url;
    if (entry?.cookies?.length) cookies = entry.cookies;
    if (entry) {
      delete map[String(tabId)];
      await chrome.storage.local.set({ [SESSION_KEY]: map });
    }
  } catch {
    /* */
  }

  let apex = '';
  try {
    if (url?.startsWith('http')) apex = apexFromHost(new URL(url).hostname);
  } catch {
    apex = '';
  }
  if (!apex || isWhitelistedHost(apex)) return false;

  // Same-site tab still open (launch OR manual) → wait
  if (await anyOpenTabForApex(apex)) return false;

  const apexes = filterApexes(relatedApexes(apex));
  const hosts = collectCleanupHosts(url || `https://${apex}/`, cookies);
  syncWipeMemory({ apexes, hosts, cookies });

  fireNamedCookiePurge(apexes);
  await clearDnrCookieSessionForApex(apex).catch(() => {});
  for (const a of apexes) {
    await clearCookiesForApexDomain(a).catch(() => {});
  }
  await clearBrowsingDataForHosts(hosts).catch(() => {});
  await clearCookiesBySnapshot(cookies).catch(() => {});
  for (const host of hosts) {
    await clearCookiesForHost(host).catch(() => {});
  }
  return true;
}

/**
 * After any tab close: wipe each durable/launch apex that now has zero open tabs.
 * Covers manual same-site tabs + browser-close (tabs drain → last apex wipe).
 */
export async function wipeOrphanedLaunchApexesAfterTabClose() {
  const store = await chrome.storage.local.get([APEX_KEY, SESSION_KEY]);
  const found = [...(store[APEX_KEY] || [])];
  // Apexes still referenced by leftover session entries
  for (const entry of Object.values(store[SESSION_KEY] || {})) {
    if (entry?.apex) found.push(entry.apex);
    try {
      if (entry?.url) found.push(apexFromHost(new URL(entry.url).hostname));
    } catch {
      /* */
    }
  }
  const unique = filterApexes([...new Set(found)]);
  let wiped = 0;
  for (const apex of unique) {
    if (await anyOpenTabForApex(apex)) continue;
    const ok = await wipeLaunchOnTabClosed(0, `https://${apex}/`);
    if (ok) wiped += 1;
  }
  return wiped;
}
