/**
 * Global rules sync — DigitaVision/old style.
 * Fetches reseller CSS/block/redirect on boot + alarm; applies dynamic DNR + local storage.
 */
import { CLIENT_CONFIG } from '../config.gen.js';
import { applyCssRules, applyNetworkRules, storeActiveRules } from './rules-apply.js';

const ALARM = 'oneclk_rules_sync';
const VERSION_KEY = 'oneclk_rules_version';

function resellerSlug() {
  return String(CLIENT_CONFIG.RESELLER_SLUG || CLIENT_CONFIG.SLUG || '').trim();
}

/** Push CSS into every open http(s) tab after rules land in storage. */
async function injectCssIntoOpenTabs(rules) {
  if (!rules?.css?.length || !chrome.tabs?.query) return;
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return;
  }
  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab?.id || !tab.url?.startsWith('http')) return;
      try {
        await applyCssRules(tab.id, tab.url, rules);
      } catch {
        /* restricted page */
      }
    }),
  );
}

export async function fetchAndApplyClientRules({ force = false } = {}) {
  const slug = resellerSlug();
  if (!slug || !CLIENT_CONFIG.API_BASE) return { ok: false, reason: 'no_slug' };

  const url = new URL(`${CLIENT_CONFIG.API_BASE}/client/rules`);
  url.searchParams.set('client_slug', CLIENT_CONFIG.SLUG || slug);
  url.searchParams.set('reseller_slug', CLIENT_CONFIG.RESELLER_SLUG || slug);

  let json;
  try {
    const res = await fetch(url.toString(), { method: 'GET', cache: 'no-store' });
    if (!res.ok) {
      console.warn('[rules-sync] HTTP', res.status);
      return { ok: false, reason: `http_${res.status}` };
    }
    json = await res.json();
  } catch (err) {
    console.warn('[rules-sync] fetch failed', err);
    return { ok: false, reason: 'fetch' };
  }

  if (!json?.success || !json.rules) {
    console.warn('[rules-sync] bad response', json);
    return { ok: false, reason: 'bad_response' };
  }

  const version = String(json.version || '');
  if (!force) {
    const prev = await chrome.storage.local.get(VERSION_KEY);
    if (prev[VERSION_KEY] && prev[VERSION_KEY] === version) {
      const stored = await chrome.storage.local.get('oneclk_active_rules');
      if (stored.oneclk_active_rules) {
        await storeActiveRules(stored.oneclk_active_rules);
        await applyNetworkRules(stored.oneclk_active_rules);
        await injectCssIntoOpenTabs(stored.oneclk_active_rules);
        return { ok: true, skipped: true, version };
      }
    }
  }

  const rules = json.rules;
  await storeActiveRules(rules);
  const dnrCount = await applyNetworkRules(rules);
  await chrome.storage.local.set({ [VERSION_KEY]: version });
  await injectCssIntoOpenTabs(rules);
  console.log(
    '[rules-sync] applied',
    'blocks',
    rules.blocks?.length || 0,
    'redirects',
    rules.redirects?.length || 0,
    'css',
    rules.css?.length || 0,
    'dnr',
    dnrCount,
    'v',
    version,
  );
  return { ok: true, dnrCount, version };
}

export function startRulesSync() {
  void fetchAndApplyClientRules({ force: true });
  try {
    chrome.alarms.create(ALARM, { periodInMinutes: 2 });
  } catch {
    /* */
  }
  if (!globalThis.__oneclk_rules_alarm) {
    globalThis.__oneclk_rules_alarm = true;
    chrome.alarms.onAlarm.addListener((a) => {
      if (a?.name === ALARM) void fetchAndApplyClientRules();
    });
  }
}
