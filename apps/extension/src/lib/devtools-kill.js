/**
 * DevTools / inspect kill — DigitaVision / old-extension style.
 *
 * Timeline (≈2s + notice):
 *  1st second — wipe cookies/storage EXCEPT membership whitelist
 *  2nd second — close non-membership tabs (refresh membership), show reason notice, self-disable
 */
import { CLIENT_CONFIG } from '../config.gen.js';
import { clearDnrCookieSession } from './dnr-cookies.js';
import { markDisablePending, wipeDurableLaunchCookies } from './session-cleanup.js';
import { stopJarAuthScrub } from './jar-scrub.js';
import { clearActiveRules, clearDynamicUrlRules, clearLaunchSessionRules } from './rules-apply.js';
import { openSecurityNoticeTab } from './security-notice.js';

const LOCK_KEY = 'oneclk_devtools_kill_lock';
const ACTIVE_LAUNCH_KEY = 'oneclk_active_launch';

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function membershipHosts() {
  const set = new Set();
  const add = (host) => {
    const h = String(host || '')
      .replace(/^www\./i, '')
      .toLowerCase();
    if (h && h !== '*' && !h.includes('*')) set.add(h);
  };
  try {
    add(new URL(CLIENT_CONFIG.API_BASE).hostname);
  } catch {
    /* */
  }
  for (const m of CLIENT_CONFIG.MEMBER_MATCHES || []) {
    try {
      const cleaned = String(m)
        .replace(/^\*:\/\//, 'https://')
        .replace(/\*\./g, '')
        .replace(/\*/g, '');
      if (cleaned.startsWith('http')) add(new URL(cleaned).hostname);
      else add(cleaned.split('/')[0]);
    } catch {
      /* */
    }
  }
  if (CLIENT_CONFIG.MEMBERSHIP_HOME) {
    try {
      add(new URL(CLIENT_CONFIG.MEMBERSHIP_HOME).hostname);
    } catch {
      /* */
    }
  }
  return set;
}

function isMembershipHost(host, whitelist) {
  const h = String(host || '')
    .replace(/^www\./i, '')
    .toLowerCase();
  if (!h) return false;
  if (whitelist.has(h)) return true;
  for (const w of whitelist) {
    if (h === w || h.endsWith(`.${w}`)) return true;
  }
  return false;
}

function isMembershipTab(tab, whitelist) {
  const url = tab?.url || '';
  if (!url.startsWith('http')) return false;
  return isMembershipHost(hostFromUrl(url), whitelist);
}

function isClosableTab(tab) {
  const url = tab?.url || '';
  if (!url) return false;
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return false;
  if (url.startsWith('data:')) return false;
  if (url === 'about:blank') return true;
  return url.startsWith('http://') || url.startsWith('https://');
}

function membershipHomeUrl() {
  if (CLIENT_CONFIG.MEMBERSHIP_HOME) return CLIENT_CONFIG.MEMBERSHIP_HOME;
  for (const m of CLIENT_CONFIG.MEMBER_MATCHES || []) {
    try {
      const cleaned = String(m).replace(/\*$/, '').replace(/\*\./g, '');
      if (cleaned.startsWith('http')) {
        const u = new URL(cleaned.includes('://') ? cleaned : `https://${cleaned}`);
        if (u.hostname && !u.hostname.includes('*')) return `${u.protocol}//${u.host}/`;
      }
    } catch {
      /* */
    }
  }
  try {
    const u = new URL(CLIENT_CONFIG.API_BASE);
    return `${u.protocol}//${u.hostname}/`;
  } catch {
    return null;
  }
}

function originFromUrl(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Wipe browser data for non-membership origins only. */
async function wipeNonMembershipData(whitelist) {
  const origins = new Set();

  try {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      if (!t.url?.startsWith('http')) continue;
      if (isMembershipTab(t, whitelist)) continue;
      const o = originFromUrl(t.url);
      if (o) origins.add(o);
    }
  } catch {
    /* */
  }

  try {
    const all = await chrome.cookies.getAll({});
    for (const c of all) {
      const host = String(c.domain || '')
        .replace(/^\./, '')
        .toLowerCase();
      if (isMembershipHost(host, whitelist)) continue;
      const scheme = c.secure ? 'https' : 'http';
      origins.add(`${scheme}://${host}`);
      // also common apex form
      const parts = host.split('.');
      if (parts.length >= 2) {
        origins.add(`${scheme}://${parts.slice(-2).join('.')}`);
      }
    }
  } catch {
    /* */
  }

  const list = [...origins].filter(Boolean).slice(0, 80);
  if (list.length && chrome.browsingData?.remove) {
    try {
      await chrome.browsingData.remove(
        { origins: list },
        {
          cookies: true,
          localStorage: true,
          indexedDB: true,
          serviceWorkers: true,
          cacheStorage: true,
          fileSystems: true,
          webSQL: true,
          pluginData: true,
        },
      );
    } catch (err) {
      console.warn('[devtools-kill] origins wipe failed', err);
    }
  }

  // Cookie jar pass — skip membership
  try {
    const all = await chrome.cookies.getAll({});
    await Promise.all(
      all.map(async (c) => {
        const host = String(c.domain || '')
          .replace(/^\./, '')
          .toLowerCase();
        if (isMembershipHost(host, whitelist)) return;
        const scheme = c.secure ? 'https' : 'http';
        const url = `${scheme}://${host}${c.path || '/'}`;
        try {
          await chrome.cookies.remove({ url, name: c.name });
        } catch {
          /* */
        }
      }),
    );
  } catch (err) {
    console.warn('[devtools-kill] cookie wipe failed', err);
  }

  await clearDnrCookieSession().catch(() => {});
  await wipeDurableLaunchCookies().catch(() => {});
  await stopJarAuthScrub().catch(() => {});
  await clearLaunchSessionRules().catch(() => {});
  await clearDynamicUrlRules().catch(() => {});
  await clearActiveRules().catch(() => {});
}

/** Close tool tabs; keep one membership tab and refresh it. */
async function closeOtherTabsKeepMembership(whitelist) {
  const tabs = await chrome.tabs.query({});
  let membershipTabId = null;
  const toClose = [];

  for (const tab of tabs) {
    if (isMembershipTab(tab, whitelist)) {
      if (membershipTabId == null) membershipTabId = tab.id;
      else if (tab.id) toClose.push(tab.id);
      continue;
    }
    if (tab?.id && isClosableTab(tab)) toClose.push(tab.id);
  }

  if (toClose.length) {
    // Brief reload signal on survivors is membership-only; others close
    await chrome.tabs.remove(toClose).catch(() => {});
  }

  if (membershipTabId != null) {
    await chrome.tabs.reload(membershipTabId, { bypassCache: true }).catch(() => {});
    await chrome.tabs.update(membershipTabId, { active: false }).catch(() => {});
  } else {
    const home = membershipHomeUrl();
    if (home) {
      try {
        const created = await chrome.tabs.create({ url: home, active: false });
        membershipTabId = created?.id ?? null;
      } catch {
        /* */
      }
    }
  }

  return membershipTabId;
}

/**
 * @param {string} reason
 * @param {{ pageUrl?: string | null, username?: string | null }} [extra]
 */
export async function executeDevtoolsKillSwitch(reason = 'devtools', extra = {}) {
  const { [LOCK_KEY]: locked } = await chrome.storage.session.get(LOCK_KEY);
  if (locked) return { skipped: true, reason: 'already_running' };
  await chrome.storage.session.set({
    [LOCK_KEY]: Date.now(),
    oneclk_devtools_reason: reason,
    oneclk_devtools_page_url: extra.pageUrl || null,
  });

  console.warn('[1clk-v2] DevTools kill start:', reason, extra.pageUrl || '');
  const whitelist = membershipHosts();

  // --- second 1: clear non-membership data ---
  const t0 = Date.now();
  await markDisablePending().catch(() => {});
  await wipeNonMembershipData(whitelist).catch((e) => console.warn('[devtools-kill] wipe', e));
  const left1 = Math.max(0, 1000 - (Date.now() - t0));
  if (left1) await delay(left1);

  // --- second 2: close other tabs, show why-notice, self-disable ---
  const t1 = Date.now();
  await closeOtherTabsKeepMembership(whitelist).catch(() => {});

  let noticeTabId = null;
  try {
    noticeTabId = await openSecurityNoticeTab({
      reason,
      brand: CLIENT_CONFIG.NAME || '1Clk Access',
      pageUrl: extra.pageUrl || null,
      username: extra.username || null,
    });
  } catch (err) {
    console.warn('[devtools-kill] notice tab failed', err);
  }

  await chrome.storage.session.remove([ACTIVE_LAUNCH_KEY, LOCK_KEY]).catch(() => {});
  const left2 = Math.max(0, 1000 - (Date.now() - t1));
  if (left2) await delay(left2);
  // Let animation play briefly before extension dies (data: URL keeps the page)
  await delay(900);

  try {
    await chrome.management.setEnabled(chrome.runtime.id, false);
    return { ok: true, disabled: true, reason, noticeTabId };
  } catch (e) {
    console.warn('[devtools-kill] self-disable failed', e);
    return { ok: false, disabled: false, error: e?.message || 'disable_failed', reason };
  }
}
