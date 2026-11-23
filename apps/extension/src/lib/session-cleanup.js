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
import { apexFromHost, clearDnrCookieSession } from './dnr-cookies.js';
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
    { cookies: true, cacheStorage: true, serviceWorkers: true, localStorage: true },
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

/**
 * Fire-and-forget wipe for onSuspend (tab open OR closed).
 * Must not await storage — use wipeMemory.
 */
export function fireDisableWipeSync() {
  try {
    chrome.storage.local.set({ [DISABLE_PENDING_KEY]: Date.now() });
  } catch {
    /* */
  }

  const apexes = filterApexes(wipeMemory.apexes || []);
  const hosts = filterHosts(wipeMemory.hosts || []);
  const origins = wipeMemory.origins?.length
    ? wipeMemory.origins
    : hostsToOrigins(hosts);
  const snaps = wipeMemory.cookies || [];

  try {
    void clearDnrCookieSession();
  } catch {
    /* */
  }

  if (origins.length && chrome.browsingData?.remove) {
    try {
      chrome.browsingData.remove(
        { origins },
        { cookies: true, cacheStorage: true, serviceWorkers: true, localStorage: true },
        () => void chrome.runtime.lastError,
      );
    } catch {
      /* */
    }
  }

  for (const snap of snaps) {
    if (!snap?.name) continue;
    const domain = String(snap.domain || '')
      .replace(/^\./, '')
      .toLowerCase();
    if (!domain || isWhitelistedHost(domain)) continue;
    const url = `https://${domain}/`;
    try {
      chrome.cookies.remove({ url, name: snap.name }, () => void chrome.runtime.lastError);
      chrome.cookies.remove(
        { url: `https://www.${domain}/`, name: snap.name },
        () => void chrome.runtime.lastError,
      );
    } catch {
      /* */
    }
  }

  for (const apex of apexes) {
    try {
      chrome.cookies.getAll({ domain: apex }, (list) => {
        for (const c of list || []) {
          const host = (c.domain || apex).replace(/^\./, '');
          if (isWhitelistedHost(host)) continue;
          chrome.cookies.remove(
            { url: `https://${host}${c.path || '/'}`, name: c.name },
            () => void chrome.runtime.lastError,
          );
        }
      });
      chrome.cookies.getAll({ domain: `.${apex}` }, (list) => {
        for (const c of list || []) {
          const host = (c.domain || apex).replace(/^\./, '');
          if (isWhitelistedHost(host)) continue;
          chrome.cookies.remove(
            { url: `https://${host}${c.path || '/'}`, name: c.name },
            () => void chrome.runtime.lastError,
          );
        }
      });
    } catch {
      /* */
    }
  }

  // Blank any open tool tabs (ChatGPT often skipped page blank when CSRF fetch hung)
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
            (h) =>
              tab.url.includes(h) ||
              apex === h ||
              apex.endsWith(`.${h}`),
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
