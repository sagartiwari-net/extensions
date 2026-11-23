import { UA_RULE_ID } from './rules-apply.js';

/**
 * Override User-Agent for the browsing session via DNR modifyHeaders.
 * @param {string | null | undefined} userAgent
 */
export async function applyUserAgent(userAgent) {
  if (!chrome.declarativeNetRequest?.updateSessionRules) return;

  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [UA_RULE_ID],
    });
  } catch {
    /* ignore */
  }

  const ua = String(userAgent || '').trim();
  if (!ua) return;

  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [
        {
          id: UA_RULE_ID,
          priority: 100,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'User-Agent', operation: 'set', value: ua },
            ],
          },
          condition: {
            urlFilter: '*',
            resourceTypes: [
              'main_frame',
              'sub_frame',
              'xmlhttprequest',
              'script',
              'stylesheet',
              'image',
              'font',
              'other',
            ],
          },
        },
      ],
    });
  } catch (err) {
    console.warn('[1clk-v2] UA DNR failed', err);
  }
}
