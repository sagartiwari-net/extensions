/**
 * DigitaVision-style launch tab markers.
 * CRITICAL: content-script kill-switch uses ISOLATED sessionStorage —
 * MAIN-world sessionStorage is a different store and will NOT activate the kill-switch.
 */
const MARKER = '__1clk_launch_tab';
const WAS = '__1clk_was_launch';
const URL_KEY = '__1clk_launch_url';
const APEX_COOKIE = '__1clk_launch';

function stampIsolated(launchUrl) {
  try {
    sessionStorage.setItem(MARKER, '1');
    sessionStorage.setItem(WAS, '1');
    if (launchUrl) sessionStorage.setItem(URL_KEY, launchUrl);
  } catch {
    /* */
  }
  try {
    const href = launchUrl || location.href;
    const h = new URL(href).hostname.replace(/^www\./, '').toLowerCase();
    const parts = h.split('.');
    const apex = parts.length >= 2 ? parts.slice(-2).join('.') : h;
    if (apex) {
      document.cookie = `${APEX_COOKIE}=1;path=/;max-age=86400;SameSite=Lax;domain=.${apex}`;
    }
    document.cookie = `${APEX_COOKIE}=1;path=/;max-age=86400;SameSite=Lax`;
  } catch {
    /* */
  }
}

export async function markLaunchTabIsolated(tabId, launchUrl) {
  if (!tabId) return;
  await chrome.scripting
    .executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: stampIsolated,
      args: [launchUrl || ''],
    })
    .catch(() => {});
}

export async function notifyLaunchTab(tabId, launchUrl = '', cookieNames = []) {
  for (let i = 0; i < 8; i += 1) {
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: '__1clk_mark_launch',
        url: launchUrl || '',
        cookieNames: cookieNames || [],
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

export function apexFromUrl(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    const parts = h.split('.');
    return parts.length >= 2 ? parts.slice(-2).join('.') : h;
  } catch {
    return '';
  }
}

/** Related apexes that must wipe together (ChatGPT ↔ OpenAI, etc.). */
export function relatedApexes(apex) {
  const a = String(apex || '')
    .replace(/^www\./, '')
    .toLowerCase();
  const set = new Set([a]);
  if (a === 'chatgpt.com' || a === 'openai.com' || a === 'chat.openai.com') {
    set.add('chatgpt.com');
    set.add('openai.com');
  }
  if (a === 'grammarly.com') set.add('grammarly.com');
  return [...set].filter(Boolean);
}

/** True if page URL belongs to an active/durable launch apex. */
export async function isLaunchUrl(pageUrl) {
  if (!pageUrl?.startsWith('http')) return { yes: false, cookieNames: [] };
  const pageApex = apexFromUrl(pageUrl);
  if (!pageApex) return { yes: false, cookieNames: [] };

  const { oneclk_active_launch: active } = await chrome.storage.session.get('oneclk_active_launch');
  const { oneclk_active_cookie_names: names = [] } = await chrome.storage.local.get(
    'oneclk_active_cookie_names',
  );
  const cookieNames = active?.cookieNames || names || [];

  if (active?.webUrl) {
    const activeApex = apexFromUrl(active.webUrl);
    const related = relatedApexes(activeApex);
    if (related.includes(pageApex) || relatedApexes(pageApex).includes(activeApex)) {
      return { yes: true, cookieNames };
    }
  }

  const { oneclk_last_launch_apexes: apexes = [] } = await chrome.storage.local.get(
    'oneclk_last_launch_apexes',
  );
  for (const a of apexes || []) {
    if (relatedApexes(a).includes(pageApex)) return { yes: true, cookieNames };
  }

  const { oneclk_last_launch_hosts: hosts = [] } = await chrome.storage.local.get(
    'oneclk_last_launch_hosts',
  );
  try {
    const host = new URL(pageUrl).hostname.toLowerCase();
    if ((hosts || []).some((h) => host === h || host.endsWith(`.${h}`) || h.endsWith(`.${host}`))) {
      return { yes: true, cookieNames };
    }
  } catch {
    /* */
  }
  return { yes: false, cookieNames: [] };
}
