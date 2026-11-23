import { CLIENT_CONFIG } from '../config.gen.js';

const STORAGE_KEY = 'oneclk_policy';
const ALARM_NAME = 'ext_enforcement_scan';

/** Permissions that can read or modify sessions/cookies. */
const SESSION_STEAL_PERMS = new Set([
  'cookies',
  'webRequest',
  'webRequestBlocking',
  'declarativeNetRequest',
  'declarativeNetRequestWithHostAccess',
  'declarativeNetRequestFeedback',
  'browsingData',
  'debugger',
  'proxy',
]);

function normalizePolicy(raw) {
  if (!raw) return null;
  return {
    version: raw.version || 0,
    allow_mode: raw.allow_mode || raw.mode || 'off',
    allowed: Array.isArray(raw.allowed)
      ? raw.allowed
      : Array.isArray(raw.allowed_ids)
        ? raw.allowed_ids
        : [],
    blocked: Array.isArray(raw.blocked)
      ? raw.blocked
      : Array.isArray(raw.blocked_ids)
        ? raw.blocked_ids
        : [],
    integrity_mode: raw.integrity_mode || 'off',
  };
}

export function hasSessionStealCapability(ext) {
  const perms = [...(ext.permissions || []), ...(ext.hostPermissions || [])];
  if (perms.includes('<all_urls>')) return true;
  if (perms.some((p) => typeof p === 'string' && (p.includes('://') || p.includes('*')))) {
    return true;
  }
  return perms.some((p) => SESSION_STEAL_PERMS.has(p));
}

function shouldSkipExtension(ext, selfId) {
  if (!ext?.id || ext.id === selfId) return true;
  if (ext.type && ext.type !== 'extension') return true;
  if (ext.installType === 'admin') return true;
  return false;
}

function shouldDisableExtension(ext, policy, selfId) {
  if (shouldSkipExtension(ext, selfId)) return false;
  if (!hasSessionStealCapability(ext)) return false;

  const allowed = new Set([selfId, ...policy.allowed]);
  const blocked = new Set(policy.blocked);

  if (blocked.has(ext.id)) return true;
  if (policy.allow_mode === 'whitelist') return !allowed.has(ext.id);
  return false;
}

export async function getStoredPolicy() {
  const { [STORAGE_KEY]: raw } = await chrome.storage.local.get(STORAGE_KEY);
  return normalizePolicy(raw);
}

export async function fetchExtensionPolicy() {
  try {
    const url = `${CLIENT_CONFIG.API_BASE}/extensions/policy?client_slug=${encodeURIComponent(CLIENT_CONFIG.SLUG)}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!res.ok || !json?.success) return getStoredPolicy();
    const policy = normalizePolicy(json);
    if (policy) {
      await chrome.storage.local.set({ [STORAGE_KEY]: policy });
    }
    return policy;
  } catch {
    return getStoredPolicy();
  }
}

export async function enforceExtensionPolicy(policy = null) {
  const active = policy || (await getStoredPolicy());
  if (!active || active.allow_mode !== 'whitelist') {
    return { disabled: 0, scanned: 0, mode: active?.allow_mode || 'off' };
  }

  const selfId = chrome.runtime.id;
  let extensions = [];
  try {
    extensions = await chrome.management.getAll();
  } catch (err) {
    console.warn('[enforcement] management.getAll failed', err);
    return { disabled: 0, scanned: 0, mode: active.allow_mode };
  }

  let disabled = 0;
  for (const ext of extensions) {
    if (!shouldDisableExtension(ext, active, selfId)) continue;
    try {
      if (ext.enabled) {
        await chrome.management.setEnabled(ext.id, false);
        disabled += 1;
        console.warn('[enforcement] disabled unauthorized extension:', ext.name, ext.id);
      }
    } catch (e) {
      console.warn('[enforcement] could not disable', ext.id, e?.message || e);
    }
  }

  await chrome.storage.local.set({
    oneclk_last_enforce: {
      at: Date.now(),
      disabled,
      scanned: extensions.length,
      mode: active.allow_mode,
    },
  });

  return { disabled, scanned: extensions.length, mode: active.allow_mode };
}

function shouldReportExtension(ext, selfId) {
  if (!ext?.id || ext.id === selfId) return false;
  if (ext.installType === 'admin') return false;
  if (ext.type && ext.type !== 'extension') return false;
  return true;
}

export async function reportInstalledExtensions() {
  const selfId = chrome.runtime.id;
  let all = [];
  try {
    all = await chrome.management.getAll();
  } catch {
    return;
  }
  const extensions = all
    .filter((ext) => shouldReportExtension(ext, selfId))
    .map((ext) => ({
      id: ext.id,
      name: ext.name,
      install_type: ext.installType,
      enabled: ext.enabled,
      uses_cookies: hasSessionStealCapability(ext),
    }));

  try {
    await fetch(`${CLIENT_CONFIG.API_BASE}/extensions/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reporter_id: selfId,
        client_slug: CLIENT_CONFIG.SLUG,
        extensions,
      }),
    });
  } catch (e) {
    console.warn('[enforcement] extension scan report failed:', e?.message || e);
  }
}

export async function syncAndEnforceExtensions() {
  await reportInstalledExtensions();
  const policy = await fetchExtensionPolicy();
  if (!policy) return { disabled: 0, scanned: 0, mode: 'off' };
  return enforceExtensionPolicy(policy);
}

let enforcing = false;

async function runEnforcement() {
  if (enforcing) return;
  enforcing = true;
  try {
    const result = await syncAndEnforceExtensions();
    if (result.disabled > 0) {
      console.log('[enforcement] blocked', result.disabled, 'extension(s)');
    }
  } finally {
    enforcing = false;
  }
}

export function startExtensionEnforcement() {
  void runEnforcement();

  if (chrome.management?.onInstalled) {
    chrome.management.onInstalled.addListener(() => {
      void runEnforcement();
    });
  }
  if (chrome.management?.onEnabled) {
    chrome.management.onEnabled.addListener(() => {
      void runEnforcement();
    });
  }

  try {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  } catch {
    /* alarms may be unavailable in some hosts */
  }
  chrome.alarms?.onAlarm?.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) void runEnforcement();
  });
}
