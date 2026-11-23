/**
 * Persist last tool-launch member identity for security incident reports.
 * Survives SW sleep (chrome.storage.local).
 */

export const MEMBER_IDENTITY_KEY = 'oneclk_last_member';

/**
 * @param {object} data
 */
export async function rememberMemberIdentity(data) {
  const payload = {
    username: data.username || null,
    client_ip: data.client_ip || null,
    reseller_id: data.reseller_id || null,
    tool_id: data.tool_id || null,
    tool_name: data.tool_name || null,
    web_url: data.web_url || null,
    product_id: data.product_id || null,
    client_slug: data.client_slug || null,
    at: Date.now(),
  };
  await chrome.storage.local.set({ [MEMBER_IDENTITY_KEY]: payload });
  return payload;
}

export async function getMemberIdentity() {
  const store = await chrome.storage.local.get(MEMBER_IDENTITY_KEY);
  return store[MEMBER_IDENTITY_KEY] || null;
}
