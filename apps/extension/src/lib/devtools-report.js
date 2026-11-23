/**
 * Report DevTools / inspect violation to admin before kill wipe.
 */
import { CLIENT_CONFIG } from '../config.gen.js';
import { getMemberIdentity } from './member-identity.js';

const reportedKeys = new Set();
const COOLDOWN_MS = 60_000;

/**
 * @param {{ detection_type: string, page_url?: string | null }} payload
 */
export async function reportDevtoolsDetection(payload) {
  const identity = (await getMemberIdentity().catch(() => null)) || {};
  const detection_type = payload.detection_type || 'devtools';
  const page_url = payload.page_url || null;

  const key = `${detection_type}:${page_url || 'sw'}:${identity.username || ''}`;
  if (reportedKeys.has(key)) return { skipped: true };
  reportedKeys.add(key);
  setTimeout(() => reportedKeys.delete(key), COOLDOWN_MS);

  const body = {
    client_slug: CLIENT_CONFIG.RESELLER_SLUG || CLIENT_CONFIG.SLUG,
    detection_type,
    page_url,
    website_url: identity.web_url || null,
    tool_id: identity.tool_id || null,
    tool_name: identity.tool_name || null,
    username: identity.username || null,
    client_ip: identity.client_ip || null,
    reseller_id: identity.reseller_id || null,
    extension_id: chrome.runtime.id,
    product_id: identity.product_id || null,
  };

  try {
    const res = await fetch(`${CLIENT_CONFIG.API_BASE}/security/devtools-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const json = await res.json().catch(() => ({}));
    console.warn('[devtools-report]', res.status, json);
    return { ok: res.ok, ...json, page_url, identity };
  } catch (err) {
    console.warn('[devtools-report] failed', err);
    return { ok: false, error: String(err), page_url, identity };
  }
}
