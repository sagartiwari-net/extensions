/**
 * Cookie vault handling on the extension side.
 *
 * IMPORTANT (speed + security split):
 * - DB stores compress+AES (OC1Z / v2). Server opens that on launch.
 * - Extension receives already-decoded session JSON over /api/session/data.
 * - We do NOT re-decrypt AES here — that would need the vault password on the
 *   wire (stealable) and add CPU for no size win (HTTP can gzip the JSON).
 *
 * This helper only normalizes the session object so launch stays a few ms.
 * Future binding (extension-only usable cookies) will wrap HERE without
 * putting long-lived AES passwords in the page.
 */

/**
 * @param {unknown} data — full /api/session/data payload or nested session
 * @returns {Record<string, unknown>}
 */
export function unwrapLaunchSession(data) {
  if (!data || typeof data !== 'object') return {};

  // Rare: API/session itself is a Cookie-Editor array
  if (Array.isArray(data)) {
    return { cookies: data, localStorage: {}, sessionStorage: {} };
  }

  const root = /** @type {Record<string, unknown>} */ (data);

  // Current API: { session: { cookies, localStorage, ... }, ... }
  if (Array.isArray(root.session)) {
    return { cookies: root.session, localStorage: {}, sessionStorage: {} };
  }
  if (root.session && typeof root.session === 'object') {
    const sess = /** @type {Record<string, unknown>} */ (root.session);
    if (Array.isArray(sess.cookies) || sess.Cookies || sess.localStorage) return sess;
    return sess;
  }

  // Already a session blob
  if (Array.isArray(root.cookies) || root.Cookies || root.localStorage) {
    return root;
  }

  return {};
}

/**
 * Cheap structural check — no crypto. Rejects empty / garbage payloads fast.
 * @param {Record<string, unknown>} session
 */
export function sessionLooksUsable(session) {
  if (!session || typeof session !== 'object') return false;
  const cookies = session.cookies || session.Cookies;
  if (Array.isArray(cookies) && cookies.length > 0) return true;
  const ls = session.localStorage || session.LocalStorage;
  const ss = session.sessionStorage || session.SessionStorage;
  if (ls && typeof ls === 'object' && Object.keys(ls).length) return true;
  if (ss && typeof ss === 'object' && Object.keys(ss).length) return true;
  return false;
}
