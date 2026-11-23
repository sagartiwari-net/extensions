/**
 * DigitaVision / ToolsMandi cookie transport:
 *
 * extension_only (set_to_browser: No) — PHP + ChatGPT/NextAuth:
 *   Cookie header via DNR only. Do NOT write chrome.cookies jar.
 *   Strip Set-Cookie so server cannot re-seed auth into the jar.
 *   Disable/uninstall → DNR rules vanish → requests have no auth → logout.
 *
 * jar — Grammarly multi-API SPA (DNR Cookie-set caused refresh loops).
 */

import { relatedApexes } from './launch-tab.js';

const RULE_BASE = 880000;
const STRIP_OFFSET = 400;
const MAX_HOST_RULES = 40;

const AUTH_COOKIE_NAMES = new Set([
  'grauth',
  'gac',
  'csrf-token',
  'csrf_token',
  'isGrammarlyUser',
  'last_authn_event',
  'tdi',
  'gnar_containerId',
  'redirect_location',
  'PHPSESSID',
  'sell_the_trend_session',
  'laravel_session',
  'XSRF-TOKEN',
  'amember_login',
  'amember_pass',
  'amember_ru',
  'amember_auth',
]);

const STRIP_EXCLUDED_PREFIXES = [
  'auth',
  'coda',
  'api',
  'gateway',
  'pro',
  'secure',
  'members',
  'login',
  'sso',
  'suite',
  'socket',
  'account',
  'accounts',
  'id',
];

const COMMON_PREFIXES = [
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
  'my',
  'portal',
  'sso',
  'suite',
  'id',
  'coda',
];

const INJECT_TYPES = [
  'main_frame',
  'sub_frame',
  'xmlhttprequest',
  'websocket',
  'other',
  'image',
  'script',
  'stylesheet',
  'font',
  'ping',
  'csp_report',
  'media',
  'webtransport',
];

const STRIP_TYPES = ['main_frame', 'sub_frame', 'xmlhttprequest', 'other', 'websocket'];

export function apexFromHost(hostname) {
  const h = String(hostname || '')
    .replace(/^www\./, '')
    .toLowerCase();
  const parts = h.split('.');
  if (parts.length >= 2) return parts.slice(-2).join('.');
  return h;
}

export function collectAuthHosts(toolUrl, cookies = []) {
  const hosts = new Set();
  let apex = '';
  try {
    apex = apexFromHost(new URL(toolUrl).hostname);
  } catch {
    return [];
  }
  const apexList = relatedApexes(apex);
  for (const a of apexList) {
    hosts.add(a);
    hosts.add(`www.${a}`);
    for (const p of COMMON_PREFIXES) hosts.add(`${p}.${a}`);
  }
  for (const c of cookies || []) {
    const d = String(c.domain || '')
      .replace(/^\./, '')
      .toLowerCase();
    if (d) {
      hosts.add(d);
      hosts.add(apexFromHost(d));
      for (const a of relatedApexes(apexFromHost(d))) {
        hosts.add(a);
        hosts.add(`www.${a}`);
      }
    }
  }
  return [...hosts].slice(0, MAX_HOST_RULES);
}

function isChatGptApex(apex) {
  const a = String(apex || '')
    .replace(/^www\./, '')
    .toLowerCase();
  return a === 'chatgpt.com' || a === 'openai.com' || a === 'chat.openai.com';
}

function hostRuleId(hostKey) {
  let h = 0;
  const s = String(hostKey || '');
  for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i) * 31) % 999;
  return RULE_BASE + h;
}

function stripRuleId(apex) {
  return hostRuleId(apex) + STRIP_OFFSET;
}

function cookieAppliesToHost(cookie, host) {
  const h = host.toLowerCase();
  const raw = (cookie.domain || '').toLowerCase();
  if (!raw) return true;
  if (raw.startsWith('.')) {
    const apex = raw.slice(1);
    return h === apex || h.endsWith(raw) || h === `www.${apex}`;
  }
  if (h === raw || h === `www.${raw}`) return true;
  return apexFromHost(raw) === apexFromHost(h);
}

function buildCookieHeaderForHost(cookies, host, maxLen = 12000) {
  let filtered = (cookies || []).filter((c) => c?.name && cookieAppliesToHost(c, host));
  if (!filtered.length) {
    // Same-apex fallback: send all vault cookies (Grammarly grauth is .grammarly.com)
    const apex = apexFromHost(host);
    filtered = (cookies || []).filter((c) => {
      if (!c?.name) return false;
      const d = String(c.domain || '')
        .replace(/^\./, '')
        .toLowerCase();
      return !d || apexFromHost(d) === apex;
    });
  }
  if (!filtered.length) return '';

  const isAuth = (name) =>
    AUTH_COOKIE_NAMES.has(name) ||
    name.includes('next-auth') ||
    /(?:Refresh|Access)Token$/i.test(name) ||
    name.startsWith('__Secure-') ||
    name.startsWith('__Host-');

  filtered = [...filtered].sort((a, b) => (isAuth(a.name) ? 0 : 1) - (isAuth(b.name) ? 0 : 1));

  const parts = [];
  let len = 0;
  for (const c of filtered) {
    const part = `${c.name}=${c.value}`;
    const next = len ? len + 2 + part.length : part.length;
    if (next > maxLen) break;
    parts.push(part);
    len = next;
  }
  return parts.join('; ');
}

function sessionHasPhpSessionCookies(cookies = []) {
  return cookies.some((c) =>
    ['PHPSESSID', 'sell_the_trend_session', 'laravel_session', 'XSRF-TOKEN'].includes(c?.name),
  );
}

function sessionHasNextAuthCookies(cookies = []) {
  return cookies.some(
    (c) =>
      String(c?.name || '').includes('next-auth') ||
      String(c?.name || '').startsWith('__Host-next-auth') ||
      String(c?.name || '').startsWith('__Secure-next-auth'),
  );
}

function sessionHasPageStorage(session = {}) {
  const nested = session.storage || {};
  const ls = session.localStorage || session.LocalStorage || nested.localStorage || {};
  const ss = session.sessionStorage || session.SessionStorage || nested.sessionStorage || {};
  const idb = session.indexedDB || nested.indexedDB || null;
  return (
    Object.keys(ls || {}).length > 0 ||
    Object.keys(ss || {}).length > 0 ||
    (idb && Object.keys(idb).length > 0)
  );
}

function isMultiApiSpaCookies(cookies = []) {
  // Grammarly / similar: apex-scoped auth that spans app/coda/auth.
  return cookies.some((c) =>
    ['grauth', 'gac', 'isGrammarlyUser', 'gnar_containerId', 'last_authn_event'].includes(c?.name),
  );
}

/**
 * Transport (from launch_events A/B):
 * - #52 mode=jar → Grammarly opens
 * - #51/#53 mode=extension_only (+strip/scrub) → spinner/refresh loop
 *
 * Grammarly = jar + short lease (renew while extension alive; expires after disable).
 * PHP = extension_only (true set_to_browser: No).
 *
 * @returns {{
 *   mode: 'extension_only' | 'jar',
 *   useDnrCookies: boolean,
 *   writeJar: boolean,
 *   stripSetCookie: boolean,
 *   scrubJar: boolean,
 *   leaseJar: boolean,
 * }}
 */
export function resolveCookieTransport(session = {}, toolUrl = '') {
  const cookies = session.cookies || session.Cookies || [];
  const hasPageStorage = sessionHasPageStorage(session);
  const cookieOnly = !hasPageStorage;
  const nextAuth = sessionHasNextAuthCookies(cookies);
  const phpSession = cookieOnly && sessionHasPhpSessionCookies(cookies);
  const multiApiSpa = isMultiApiSpaCookies(cookies);
  let apex = '';
  try {
    apex = toolUrl ? apexFromHost(new URL(toolUrl).hostname) : '';
  } catch {
    apex = '';
  }
  const chatGpt = isChatGptApex(apex) || nextAuth;

  // Grammarly: jar + lease (extension_only+scrub caused refresh loops).
  if (multiApiSpa) {
    return {
      mode: 'jar',
      useDnrCookies: false,
      writeJar: true,
      stripSetCookie: false,
      scrubJar: false,
      leaseJar: true,
      aggressiveStrip: false,
    };
  }

  // ChatGPT / NextAuth / OpenAI: set_to_browser No — cookies stay in DNR only.
  // Disable removes DNR → no jar leak → logout without relying on SW wipe.
  if (chatGpt) {
    return {
      mode: 'extension_only',
      useDnrCookies: true,
      writeJar: false,
      stripSetCookie: true,
      scrubJar: true,
      leaseJar: false,
      aggressiveStrip: true,
    };
  }

  if (phpSession || cookieOnly) {
    return {
      mode: 'extension_only',
      useDnrCookies: true,
      writeJar: false,
      stripSetCookie: true,
      scrubJar: false,
      leaseJar: false,
      aggressiveStrip: false,
    };
  }

  if (hasPageStorage) {
    return {
      mode: 'jar',
      useDnrCookies: false,
      writeJar: true,
      stripSetCookie: true,
      scrubJar: false,
      leaseJar: true,
      aggressiveStrip: false,
    };
  }

  return {
    mode: 'jar',
    useDnrCookies: false,
    writeJar: true,
    stripSetCookie: false,
    scrubJar: false,
    leaseJar: true,
    aggressiveStrip: false,
  };
}

/** @deprecated — use resolveCookieTransport */
export function shouldStripSetCookie(session = {}) {
  return resolveCookieTransport(session).stripSetCookie;
}

/**
 * Strip Set-Cookie on apex + www + app so auth cannot land in the jar.
 * Exclude coda/auth/api so handshake Set-Cookie still works.
 */
export async function setupSetCookieStrip(toolUrl, { includeApp = true } = {}) {
  const apex = apexFromHost(new URL(toolUrl).hostname);
  const id = stripRuleId(apex);
  const requestDomains = [apex];
  if (!apex.startsWith('www.')) requestDomains.push(`www.${apex}`);
  if (includeApp) requestDomains.push(`app.${apex}`);
  const excludedRequestDomains = STRIP_EXCLUDED_PREFIXES.map((p) => `${p}.${apex}`);

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [id],
    addRules: [
      {
        id,
        priority: 50,
        action: {
          type: 'modifyHeaders',
          responseHeaders: [{ header: 'Set-Cookie', operation: 'remove' }],
        },
        condition: {
          requestDomains,
          excludedRequestDomains,
          resourceTypes: STRIP_TYPES,
        },
      },
    ],
  });

  return { apex, ruleIds: [id] };
}

/**
 * set_to_browser: No — Cookie on the wire via DNR; jar stays empty of vault auth.
 * @param {{ stripSetCookie?: boolean }} options
 *   Grammarly: stripSetCookie=false (strip caused refresh loops); use jar scrub instead.
 */
export async function setupExtensionOnlyCookieSession(toolUrl, cookies = [], options = {}) {
  const { stripSetCookie = true, aggressiveStrip = false } = options;
  const apex = apexFromHost(new URL(toolUrl).hostname);
  const apexList = relatedApexes(apex);
  const dnrHosts = collectAuthHosts(toolUrl, cookies);

  const removeRuleIds = new Set();
  for (const a of apexList) removeRuleIds.add(stripRuleId(a));
  for (const host of dnrHosts) removeRuleIds.add(hostRuleId(host));

  const rules = [];

  for (const host of dnrHosts) {
    const cookieHeader = buildCookieHeaderForHost(cookies, host);
    if (!cookieHeader) continue;
    rules.push({
      id: hostRuleId(host),
      priority: 100,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'Cookie', operation: 'set', value: cookieHeader }],
      },
      condition: {
        requestDomains: [host],
        resourceTypes: INJECT_TYPES,
      },
    });
  }

  if (stripSetCookie) {
    // ChatGPT: strip api/auth too — otherwise NextAuth Set-Cookie re-seeds the jar.
    const excludePrefixes = aggressiveStrip
      ? STRIP_EXCLUDED_PREFIXES.filter((p) => !['api', 'auth', 'account', 'accounts', 'id'].includes(p))
      : STRIP_EXCLUDED_PREFIXES;
    for (const a of apexList) {
      const stripDomains = [a, `www.${a}`, `app.${a}`, `chat.${a}`];
      if (aggressiveStrip) stripDomains.push(`api.${a}`, `auth.${a}`);
      const excludedRequestDomains = excludePrefixes.map((p) => `${p}.${a}`);
      rules.push({
        id: stripRuleId(a),
        priority: 90,
        action: {
          type: 'modifyHeaders',
          responseHeaders: [{ header: 'Set-Cookie', operation: 'remove' }],
        },
        condition: {
          requestDomains: [...new Set(stripDomains)],
          excludedRequestDomains,
          resourceTypes: STRIP_TYPES,
        },
      });
    }
  }

  const SAFE_INJECT = ['main_frame', 'sub_frame', 'xmlhttprequest', 'other', 'websocket'];
  const apply = async (injectTypes) => {
    const normalized = rules.map((r) => {
      if (r.action?.requestHeaders) {
        return {
          ...r,
          condition: { ...r.condition, resourceTypes: injectTypes },
        };
      }
      return r;
    });
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [...removeRuleIds],
      addRules: normalized,
    });
  };

  try {
    await apply(INJECT_TYPES);
  } catch {
    await apply(SAFE_INJECT);
  }

  const meta = {
    mode: 'extension_only',
    apex,
    apexes: apexList,
    toolUrl,
    hosts: dnrHosts,
    ruleIds: rules.map((r) => r.id),
    strip: stripSetCookie,
    aggressiveStrip: !!aggressiveStrip,
    at: Date.now(),
  };
  await chrome.storage.session.set({ oneclk_dnr_cookie: meta });
  await chrome.storage.local.set({ oneclk_dnr_cookie_durable: meta });
  return meta;
}

export async function clearDnrCookieSession() {
  const { oneclk_dnr_strip: s } = await chrome.storage.session.get('oneclk_dnr_strip');
  const { oneclk_dnr_strip_durable: d } = await chrome.storage.local.get('oneclk_dnr_strip_durable');
  const { oneclk_dnr_cookie: legacy } = await chrome.storage.session.get('oneclk_dnr_cookie');
  const { oneclk_dnr_cookie_durable: legacyD } = await chrome.storage.local.get(
    'oneclk_dnr_cookie_durable',
  );

  const ids = new Set([
    ...(s?.ruleIds || []),
    ...(d?.ruleIds || []),
    ...(legacy?.ruleIds || []),
    ...(legacyD?.ruleIds || []),
  ]);
  for (const meta of [s, d, legacy, legacyD]) {
    const apexes = [
      ...(meta?.apex ? [meta.apex] : []),
      ...((meta?.apexes || []).length ? meta.apexes : relatedApexes(meta?.apex || '')),
    ];
    for (const a of apexes) {
      if (!a) continue;
      ids.add(stripRuleId(a));
      ids.add(hostRuleId(a));
    }
    for (const host of meta?.hosts || []) ids.add(hostRuleId(host));
  }
  if (ids.size) {
    await chrome.declarativeNetRequest
      .updateDynamicRules({ removeRuleIds: [...ids] })
      .catch(() => {});
  }
  await chrome.storage.session.remove(['oneclk_dnr_strip', 'oneclk_dnr_cookie']);
  await chrome.storage.local.remove(['oneclk_dnr_strip_durable', 'oneclk_dnr_cookie_durable']);
}

/** SW idle restart — DNR dynamic rules already persist; only re-apply jar strip if needed. */
export async function restoreDnrCookieSessionIfNeeded() {
  const { oneclk_dnr_cookie_durable: cookieMeta } = await chrome.storage.local.get(
    'oneclk_dnr_cookie_durable',
  );
  if (cookieMeta?.mode === 'extension_only') {
    // Cookie header rules live in declarativeNetRequest (survive SW sleep).
    // Extension disable removes them automatically → jar stays empty → logout.
    return true;
  }

  const { oneclk_dnr_strip_durable: meta } = await chrome.storage.local.get(
    'oneclk_dnr_strip_durable',
  );
  if (!meta?.toolUrl) return false;
  await setupSetCookieStrip(meta.toolUrl);
  return true;
}

/** @deprecated */
export async function setupDnrCookieSession(toolUrl, cookies = [], _options = {}) {
  return setupExtensionOnlyCookieSession(toolUrl, cookies);
}
