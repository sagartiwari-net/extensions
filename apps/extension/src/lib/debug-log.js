import { CLIENT_CONFIG } from '../config.gen.js';

const LOG_KEY = 'oneclk_debug_logs';
const MAX = 80;

export function isDebugBuild() {
  return !!(CLIENT_CONFIG.DEBUG || CLIENT_CONFIG.DEBUG_SKIP_INTEGRITY);
}

/** Persist + console — open SW DevTools to watch live. */
export async function debugLog(tag, payload) {
  const line = {
    t: new Date().toISOString(),
    tag: String(tag),
    ...(payload && typeof payload === 'object' ? payload : { msg: payload }),
  };
  console.log(`[1clk-debug] ${tag}`, payload);
  if (!isDebugBuild()) return;
  try {
    const { [LOG_KEY]: prev = [] } = await chrome.storage.session.get(LOG_KEY);
    const next = [...prev, line].slice(-MAX);
    await chrome.storage.session.set({ [LOG_KEY]: next });
  } catch {
    /* */
  }
}

export async function getDebugLogs() {
  const { [LOG_KEY]: prev = [] } = await chrome.storage.session.get(LOG_KEY);
  return prev;
}

export async function clearDebugLogs() {
  await chrome.storage.session.remove(LOG_KEY);
}

/** Safe vault shape for logs (no token values). */
export function summarizeSession(session) {
  if (!session || typeof session !== 'object') return { empty: true };
  const nested = session.storage && typeof session.storage === 'object' ? session.storage : {};
  const ls = session.localStorage || session.LocalStorage || nested.localStorage || {};
  const ss = session.sessionStorage || session.SessionStorage || nested.sessionStorage || {};
  const idb = session.indexedDB || session.IndexedDB || session.indexed_db || nested.indexedDB || null;
  const cookies = session.cookies || session.Cookies || [];
  const idbKeys = idb && typeof idb === 'object' ? Object.keys(idb) : [];
  const storePreview = {};
  for (const db of idbKeys.slice(0, 5)) {
    const def = idb[db] || {};
    const stores = def.stores || def;
    const names = stores && typeof stores === 'object' ? Object.keys(stores) : [];
    storePreview[db] = names.map((n) => {
      const raw = stores[n];
      const items = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
      const sample = items[0];
      return {
        store: n,
        items: items.length,
        hasFbaseKey: !!(sample && sample.fbase_key != null),
        keys: sample && typeof sample === 'object' ? Object.keys(sample).slice(0, 8) : [],
      };
    });
  }
  return {
    cookies: Array.isArray(cookies) ? cookies.length : 0,
    localStorage: ls && typeof ls === 'object' ? Object.keys(ls).length : 0,
    sessionStorage: ss && typeof ss === 'object' ? Object.keys(ss).length : 0,
    indexedDB_dbs: idbKeys,
    indexedDB_preview: storePreview,
    formats: session.includedFormats || session.included_formats || null,
    referer: !!(session.referer || session.referrer),
  };
}
