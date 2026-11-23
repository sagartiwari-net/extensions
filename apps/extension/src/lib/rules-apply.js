/** Session DNR id for UA override (launch-scoped). */
export const UA_RULE_ID = 899999;

/** Dynamic DNR id ranges for persistent block/redirect (old DigitaVision style). */
export const REDIRECT_ID_BASE = 30000;
export const BLOCK_ID_BASE = 40000;
export const URL_RULE_ID_SPAN = 10000;

/** @deprecated kept for kill-switch clear of legacy session URL rules */
export const RULE_ID_BASE = 900000;
export const RULE_ID_MAX = 901000;

export const RULES_STORAGE_KEY = 'oneclk_active_rules';
const RULES_SESSION_KEY = RULES_STORAGE_KEY;

/**
 * Convert admin pattern → DNR urlFilter.
 * Handles: https://app.x.com/, *://*.x.com/*, bare domain, path fragments.
 * @param {string} pattern
 */
export function toUrlFilter(pattern) {
  const p = String(pattern || '').trim();
  if (!p) return null;
  if (p.startsWith('||') || p.startsWith('|') || p.includes('^')) return p;

  // Full URL
  if (/^https?:\/\//i.test(p)) {
    try {
      const u = new URL(p);
      const path = u.pathname || '/';
      if (path === '/' && !u.search) return `||${u.hostname}^`;
      // left-anchor exact origin+path prefix
      return `|${u.origin}${path}`;
    } catch {
      /* fall through */
    }
  }

  const m = p.match(/^\*:\/\/([^/]+)(\/.*)?$/);
  if (m) {
    let host = m[1];
    if (host.startsWith('*.')) host = host.slice(2);
    if (host === '*') return '*';
    const path = m[2] || '';
    if (!path || path === '/*' || path === '/') return `||${host}^`;
    return `||${host}${path.replace(/\*$/, '')}`;
  }

  // bare domain
  if (/^[a-z0-9.-]+$/i.test(p)) return `||${p.replace(/^\./, '')}^`;

  // path fragment (e.g. sso/logout) — DNR substring match
  return p.replace(/\*:\/\//g, '');
}

/**
 * Match admin url_pattern against a real page URL.
 * Bare `semrush.com` must match `https://www.semrush.com/home/`.
 * @param {string} pattern
 * @param {string} url
 */
export function matchUrlPattern(pattern, url) {
  try {
    const p = String(pattern || '').trim();
    if (!p || p === '*://*/*' || p === '<all_urls>') return true;
    if (!url || !/^https?:/i.test(url)) return false;

    const u = new URL(url);
    const host = u.hostname.toLowerCase();

    // bare domain / host
    if (/^[a-z0-9.-]+$/i.test(p)) {
      const d = p.toLowerCase().replace(/^\./, '');
      return host === d || host.endsWith(`.${d}`) || host.includes(d);
    }

    // full URL prefix
    if (/^https?:\/\//i.test(p)) {
      try {
        const want = new URL(p);
        if (host !== want.hostname && !host.endsWith(`.${want.hostname}`)) return false;
        const wantPath = want.pathname || '/';
        if (wantPath === '/') return true;
        return u.pathname.startsWith(wantPath.replace(/\/$/, '')) || u.href.startsWith(p);
      } catch {
        return u.href.includes(p);
      }
    }

    // path fragment without scheme
    if (!p.includes('://') && (p.includes('/') || p.length >= 3)) {
      return u.href.toLowerCase().includes(p.toLowerCase());
    }

    // Chrome-style match pattern → regex
    const escaped = p
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\*/g, '.*');
    return new RegExp(`^${escaped}$`, 'i').test(url);
  } catch {
    return false;
  }
}

/**
 * If admin pasted full HTML, extract #id or .class as a real CSS selector.
 * @param {string} raw
 */
export function sanitizeCssSelector(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (!s.startsWith('<')) return s;
  const id = s.match(/\bid\s*=\s*["']([^"']+)["']/i);
  if (id?.[1]) return `#${id[1].replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const cls = s.match(/\bclass\s*=\s*["']([^"']+)["']/i);
  if (cls?.[1]) {
    const first = cls[1].trim().split(/\s+/).find(Boolean);
    if (first) return `.${first.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  }
  const tag = s.match(/^<\s*([a-z0-9]+)/i);
  return tag ? tag[1].toLowerCase() : s;
}

/** @param {{ selector: string, action: string, value?: string | null }[]} cssRules */
export function cssRulesToText(cssRules) {
  const parts = [];
  for (const r of cssRules) {
    const selector = sanitizeCssSelector(r.selector);
    if (!selector) continue;
    if (r.action === 'hide') {
      parts.push(
        `${selector}{display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important;}`,
      );
    } else if (r.action === 'replace' && r.value) {
      parts.push(`${selector}{visibility:hidden!important;}`);
      parts.push(
        `${selector}::after{content:${JSON.stringify(String(r.value))};visibility:visible!important;}`,
      );
    } else if (r.action === 'custom' && r.value) {
      if (!selector || selector === '*') parts.push(String(r.value));
      else parts.push(`${selector}{${r.value}}`);
    }
  }
  return parts.join('\n');
}

/** Clear legacy session URL rules (900000+) if any remain. */
export async function clearLaunchSessionRules() {
  if (!chrome.declarativeNetRequest?.getSessionRules) return;
  try {
    const existing = await chrome.declarativeNetRequest.getSessionRules();
    const ids = existing
      .filter((r) => r.id >= RULE_ID_BASE && r.id < RULE_ID_MAX)
      .map((r) => r.id);
    if (ids.length) {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids });
    }
  } catch (err) {
    console.warn('[1clk-v2] clear session DNR failed', err);
  }
}

/** Clear persistent block/redirect dynamic rules in our id ranges. */
export async function clearDynamicUrlRules() {
  if (!chrome.declarativeNetRequest?.getDynamicRules) return;
  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const ids = existing
      .filter(
        (r) =>
          (r.id >= REDIRECT_ID_BASE && r.id < REDIRECT_ID_BASE + URL_RULE_ID_SPAN) ||
          (r.id >= BLOCK_ID_BASE && r.id < BLOCK_ID_BASE + URL_RULE_ID_SPAN),
      )
      .map((r) => r.id);
    if (ids.length) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ids });
    }
  } catch (err) {
    console.warn('[1clk-v2] clear dynamic URL DNR failed', err);
  }
}

/**
 * Apply block + redirect via persistent dynamic DNR (survives SW sleep).
 * @param {{ blocks?: any[], redirects?: any[] }} rules
 * @param {number} [securityTier]
 */
export async function applyNetworkRules(rules, securityTier = 1) {
  await clearLaunchSessionRules();
  await clearDynamicUrlRules();
  if (!chrome.declarativeNetRequest?.updateDynamicRules) return 0;

  const addRules = [];
  const resourceTypes = [
    'main_frame',
    'sub_frame',
    'xmlhttprequest',
    'script',
    'image',
    'stylesheet',
    'other',
  ];
  void securityTier;

  if (Array.isArray(rules?.blocks)) {
    for (const b of rules.blocks) {
      const urlFilter = toUrlFilter(b.url_pattern);
      if (!urlFilter) continue;
      const id = BLOCK_ID_BASE + (Number(b.id) || addRules.length + 1);
      if (id >= BLOCK_ID_BASE + URL_RULE_ID_SPAN) continue;
      if (b.action === 'redirect' && b.redirect_url) {
        addRules.push({
          id,
          priority: 3,
          action: { type: 'redirect', redirect: { url: b.redirect_url } },
          condition: { urlFilter, resourceTypes: ['main_frame', 'sub_frame'] },
        });
      } else {
        addRules.push({
          id,
          priority: 3,
          action: { type: 'block' },
          condition: { urlFilter, resourceTypes },
        });
      }
    }
  }

  if (Array.isArray(rules?.redirects)) {
    for (const r of rules.redirects) {
      const urlFilter = toUrlFilter(r.source_url);
      if (!urlFilter) continue;
      const id = REDIRECT_ID_BASE + (Number(r.id) || addRules.length + 1);
      if (id >= REDIRECT_ID_BASE + URL_RULE_ID_SPAN) continue;
      addRules.push({
        id,
        priority: 2,
        action: { type: 'redirect', redirect: { url: r.destination_url } },
        condition: { urlFilter, resourceTypes: ['main_frame', 'sub_frame'] },
      });
    }
  }

  if (!addRules.length) return 0;
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ addRules, removeRuleIds: [] });
    return addRules.length;
  } catch (err) {
    console.warn('[1clk-v2] DNR rules failed', err, addRules);
    let ok = 0;
    for (const rule of addRules) {
      try {
        await chrome.declarativeNetRequest.updateDynamicRules({
          addRules: [rule],
          removeRuleIds: [],
        });
        ok += 1;
      } catch (e2) {
        console.warn('[1clk-v2] DNR rule skipped', rule, e2);
      }
    }
    return ok;
  }
}

/**
 * @param {number} tabId
 * @param {string} pageUrl
 * @param {{ css?: any[] }} rules
 */
export async function applyCssRules(tabId, pageUrl, rules) {
  const list = Array.isArray(rules?.css) ? rules.css : [];
  const matched = list.filter((c) => matchUrlPattern(c.url_pattern, pageUrl));
  const text = cssRulesToText(matched);
  if (!text || !tabId) return 0;
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, css: text });
    return matched.length;
  } catch (err) {
    console.warn('[1clk-v2] CSS inject failed', err);
    return 0;
  }
}

export async function storeActiveRules(rules) {
  const payload = rules || { blocks: [], redirects: [], css: [] };
  // local = content scripts + survives SW sleep; session = fast launch path
  await Promise.all([
    chrome.storage.local.set({ [RULES_STORAGE_KEY]: payload }),
    chrome.storage.session.set({ [RULES_SESSION_KEY]: payload }),
  ]);
}

export async function clearActiveRules() {
  await Promise.all([
    chrome.storage.local.remove(RULES_STORAGE_KEY),
    chrome.storage.session.remove(RULES_SESSION_KEY),
  ]);
  await clearDynamicUrlRules().catch(() => {});
}

/** Re-apply CSS for a tab using stored rules + current URL. */
export async function reapplyCssForTab(tabId, pageUrl) {
  if (!tabId || !pageUrl?.startsWith('http')) return 0;
  const local = await chrome.storage.local.get(RULES_STORAGE_KEY);
  const rules = local[RULES_STORAGE_KEY];
  if (!rules?.css?.length) {
    const sess = await chrome.storage.session.get(RULES_SESSION_KEY);
    if (!sess[RULES_SESSION_KEY]?.css?.length) return 0;
    return applyCssRules(tabId, pageUrl, sess[RULES_SESSION_KEY]);
  }
  return applyCssRules(tabId, pageUrl, rules);
}

let cssNavHooked = false;

/** Keep CSS alive across SPA navigations for the whole session. */
export function startCssNavigationHook() {
  if (cssNavHooked) return;
  cssNavHooked = true;
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (info.status !== 'complete') return;
    const url = tab?.url || info.url || '';
    if (!url.startsWith('http')) return;
    void reapplyCssForTab(tabId, url);
  });
}
