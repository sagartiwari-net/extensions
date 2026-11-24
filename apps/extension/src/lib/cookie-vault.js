/**
 * Cookie vault handling on the extension side.
 *
 * IMPORTANT (speed + security split):
 * - DB stores compress+AES (OC1Z / v2). Server opens that on launch.
 * - Extension receives already-decoded session JSON over /api/session/data.
 * - We do NOT re-decrypt AES here — that would need the vault password on the
 *   wire (stealable) and add CPU for no size win (HTTP can gzip the JSON).
 */

function hasKeys(obj) {
  return !!(obj && typeof obj === 'object' && Object.keys(obj).length);
}

/**
 * @param {unknown} data — full /api/session/data payload or nested session
 * @returns {Record<string, unknown>}
 */
export function unwrapLaunchSession(data) {
  if (!data || typeof data !== 'object') return {};

  // Cookie-Editor bare array
  if (Array.isArray(data)) {
    return { cookies: data, localStorage: {}, sessionStorage: {}, includedFormats: ['cookies'] };
  }

  const root = /** @type {Record<string, unknown>} */ (data);

  if (Array.isArray(root.session)) {
    return {
      cookies: root.session,
      localStorage: {},
      sessionStorage: {},
      includedFormats: ['cookies'],
    };
  }
  if (root.session && typeof root.session === 'object') {
    return /** @type {Record<string, unknown>} */ (root.session);
  }

  // Vault blob (cookies / LS / SS / indexedDB / referer)
  if (
    Array.isArray(root.cookies) ||
    root.Cookies ||
    hasKeys(root.localStorage) ||
    hasKeys(root.LocalStorage) ||
    hasKeys(root.sessionStorage) ||
    hasKeys(root.indexedDB) ||
    hasKeys(root.IndexedDB)
  ) {
    return root;
  }

  return {};
}

/**
 * Cheap structural check — cookies OR page storage OR indexedDB.
 * @param {Record<string, unknown>} session
 */
export function sessionLooksUsable(session) {
  if (!session || typeof session !== 'object') return false;
  const cookies = session.cookies || session.Cookies;
  if (Array.isArray(cookies) && cookies.length > 0) return true;
  const nested = session.storage && typeof session.storage === 'object' ? session.storage : {};
  const ls = session.localStorage || session.LocalStorage || nested.localStorage;
  const ss = session.sessionStorage || session.SessionStorage || nested.sessionStorage;
  const idb = session.indexedDB || session.IndexedDB || nested.indexedDB;
  if (hasKeys(ls)) return true;
  if (hasKeys(ss)) return true;
  if (hasKeys(idb)) return true;
  return false;
}
