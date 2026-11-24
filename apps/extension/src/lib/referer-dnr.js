/**
 * Optional Referer header for tools that check document referrer / Referer.
 * Session rule — cleared on next launch / disable.
 */

const REFERER_RULE_ID = 912001;

export async function clearLaunchRefererRule() {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [REFERER_RULE_ID],
      addRules: [],
    });
  } catch {
    /* */
  }
}

/**
 * @param {string} toolUrl
 * @param {string | null | undefined} referer
 */
export async function applyLaunchReferer(toolUrl, referer) {
  await clearLaunchRefererRule();
  const ref = String(referer || '').trim();
  if (!ref || !/^https?:\/\//i.test(ref) || !toolUrl) return false;

  let host = '';
  try {
    host = new URL(toolUrl).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return false;
  }
  if (!host) return false;

  const domains = [...new Set([host, `www.${host}`, new URL(toolUrl).hostname.toLowerCase()])];

  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [REFERER_RULE_ID],
      addRules: [
        {
          id: REFERER_RULE_ID,
          priority: 80,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [{ header: 'Referer', operation: 'set', value: ref }],
          },
          condition: {
            requestDomains: domains,
            resourceTypes: [
              'main_frame',
              'sub_frame',
              'xmlhttprequest',
              'other',
              'websocket',
              'ping',
            ],
          },
        },
      ],
    });
    return true;
  } catch (err) {
    console.warn('[1clk-v2] referer DNR failed', err);
    return false;
  }
}
