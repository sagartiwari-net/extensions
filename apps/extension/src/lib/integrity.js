import { CLIENT_CONFIG } from '../config.gen.js';
import { getMemberIdentity } from './member-identity.js';

/**
 * Live-hash packaged files and compare against **server-stored** hashes.
 * No integrity.json in the ZIP — file list comes from API (paths only, not hashes).
 */

/** Fallback if API unreachable — baked at build (paths only). */
const BUILTIN_PATHS = CLIENT_CONFIG.INTEGRITY_FILES || [
  'manifest.json',
  'background.js',
  'popup/popup.html',
  'popup/popup.js',
  'content/member.js',
  'content/guard.js',
  'icons/icon-16.png',
  'icons/icon-48.png',
  'icons/icon-128.png',
];

async function sha256Hex(buf) {
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Paths to hash — from server (no expected hashes leaked). */
async function fetchIntegrityPaths() {
  try {
    const res = await fetch(
      `${CLIENT_CONFIG.API_BASE}/extensions/integrity-files?client_slug=${encodeURIComponent(CLIENT_CONFIG.SLUG)}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return BUILTIN_PATHS;
    const json = await res.json();
    const files = Array.isArray(json.files) ? json.files.filter((p) => typeof p === 'string' && p) : [];
    return files.length ? files : BUILTIN_PATHS;
  } catch {
    return BUILTIN_PATHS;
  }
}

/** Hash each packaged file (actual bytes on disk right now). */
export async function computeLiveFileHashes() {
  const paths = await fetchIntegrityPaths();
  const file_hashes = {};
  for (const path of paths) {
    try {
      const res = await fetch(chrome.runtime.getURL(path));
      if (!res.ok) {
        file_hashes[path] = '';
        continue;
      }
      const buf = await res.arrayBuffer();
      file_hashes[path] = await sha256Hex(buf);
    } catch {
      file_hashes[path] = '';
    }
  }
  return file_hashes;
}

async function reportTamper(result) {
  if (!result?.mismatches?.length) return;
  const identity = (await getMemberIdentity().catch(() => null)) || {};
  try {
    await fetch(`${CLIENT_CONFIG.API_BASE}/security/devtools-report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_slug: CLIENT_CONFIG.RESELLER_SLUG || CLIENT_CONFIG.SLUG,
        detection_type: 'integrity_tamper',
        page_url: null,
        website_url: identity.web_url || null,
        tool_id: identity.tool_id || null,
        tool_name: identity.tool_name || null,
        username: identity.username || null,
        client_ip: identity.client_ip || null,
        reseller_id: identity.reseller_id || null,
        extension_id: chrome.runtime.id,
        product_id: identity.product_id || null,
        mismatches: result.mismatches,
        meta: {
          status: result.status,
          action: result.action,
          mismatch_count: result.mismatches.length,
        },
      }),
      cache: 'no-store',
    });
  } catch (err) {
    console.warn('[integrity] tamper report failed', err);
  }
}

/**
 * @returns {Promise<{ action: 'allow' | 'warn' | 'block', status: string, mismatches: string[] }>}
 */
export async function checkIntegrity() {
  const file_hashes = await computeLiveFileHashes();

  try {
    const res = await fetch(`${CLIENT_CONFIG.API_BASE}/extensions/check-integrity`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_slug: CLIENT_CONFIG.SLUG,
        extension_id: chrome.runtime.id,
        file_hashes,
      }),
    });
    const json = await res.json();
    const result = {
      action: json.action || 'allow',
      status: json.status || 'unknown',
      mismatches: json.mismatches || [],
    };
    await chrome.storage.local.set({ oneclk_integrity: { ...result, checked_at: Date.now() } });

    if (result.mismatches.length && result.action !== 'allow') {
      console.warn('[1clk-v2] integrity mismatch', result.action, result.mismatches);
      await reportTamper(result);
      if (result.action === 'block' && chrome.management?.setEnabled) {
        try {
          await chrome.management.setEnabled(chrome.runtime.id, false);
        } catch (e) {
          console.warn('[integrity] self-disable failed', e);
        }
      }
    }
    return result;
  } catch (err) {
    console.warn('[1clk-v2] integrity check failed', err);
    const fallback = { action: 'allow', status: 'error', mismatches: [] };
    await chrome.storage.local.set({ oneclk_integrity: { ...fallback, checked_at: Date.now() } });
    return fallback;
  }
}

/** @returns {Promise<'allow' | 'warn' | 'block'>} */
export async function getIntegrityAction() {
  const stored = await chrome.storage.local.get('oneclk_integrity');
  const row = stored.oneclk_integrity;
  if (!row) {
    const fresh = await checkIntegrity();
    return fresh.action;
  }
  if (Date.now() - (row.checked_at || 0) > 15 * 60 * 1000) {
    const fresh = await checkIntegrity();
    return fresh.action;
  }
  return row.action || 'allow';
}

export function startIntegrityWatch() {
  void checkIntegrity();
  try {
    chrome.alarms.create('oneclk_integrity', { periodInMinutes: 30 });
  } catch {
    /* */
  }
  if (!globalThis.__oneclk_integrity_alarm) {
    globalThis.__oneclk_integrity_alarm = true;
    chrome.alarms.onAlarm.addListener((a) => {
      if (a?.name === 'oneclk_integrity') void checkIntegrity();
    });
  }
}
