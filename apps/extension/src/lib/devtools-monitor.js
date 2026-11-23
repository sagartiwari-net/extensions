/**
 * Poll chrome.debugger targets + DevTools windows.
 * Always armed while extension is enabled (SW / popup / page inspect → kill).
 */
import { executeDevtoolsKillSwitch } from './devtools-kill.js';
import { reportDevtoolsDetection } from './devtools-report.js';

const POLL_MS = 400;
const LAUNCH_DEVTOOLS_WINS_KEY = 'devtools_windows_at_launch';

let pollTimer = null;
let probing = false;
let violationSent = false;
let windowListenerRegistered = false;

function targetUrl(t, extId) {
  return t.url || `chrome-extension://${extId}/`;
}

function isOurExtensionTarget(t, extId) {
  if (t.extensionId === extId) return true;
  const url = t.url || '';
  return url.startsWith(`chrome-extension://${extId}`);
}

function isPageTarget(t) {
  return (t.type === 'page' || t.type === 'tab') && !!t.tabId;
}

function isWorkerTarget(t) {
  const type = String(t.type || '').toLowerCase();
  return type.includes('worker') || type === 'background_page' || type === 'service_worker';
}

/** Kill is always on unless admin explicitly disables via session policy. */
async function isDevtoolsArmed() {
  const store = await chrome.storage.session.get(['devtools_policy']);
  if (store.devtools_policy && store.devtools_policy.enabled === false) return false;
  return true;
}

async function pageDetectionType() {
  try {
    if (!chrome.windows?.getAll) return 'docked_devtools';
    const wins = await chrome.windows.getAll({ windowTypes: ['devtools'] });
    return wins.length > 0 ? 'popup_devtools' : 'docked_devtools';
  } catch {
    return 'docked_devtools';
  }
}

async function getKnownDevtoolsWindowIds() {
  const stored = await chrome.storage.session.get(LAUNCH_DEVTOOLS_WINS_KEY);
  return new Set(stored[LAUNCH_DEVTOOLS_WINS_KEY] || []);
}

async function handleViolation(detectionType, pageUrl) {
  if (violationSent) return;
  violationSent = true;
  console.warn('[devtools-monitor] violation', detectionType, pageUrl);
  // Report to admin BEFORE wipe/disable (network must still work)
  const report = await reportDevtoolsDetection({
    detection_type: detectionType,
    page_url: pageUrl || null,
  }).catch(() => null);
  await executeDevtoolsKillSwitch(detectionType, {
    pageUrl: pageUrl || null,
    username: report?.username || report?.identity?.username || null,
  });
}

async function checkExtensionInspect(targets, extId) {
  const extTarget = targets.find(
    (t) =>
      t.attached &&
      isOurExtensionTarget(t, extId) &&
      (isWorkerTarget(t) || t.type === 'background_page' || !t.tabId),
  );
  // Also: any attached target under our extension id (SW / popup inspect)
  const anyOurs = extTarget || targets.find((t) => t.attached && isOurExtensionTarget(t, extId));
  if (!anyOurs) return false;
  await handleViolation('service_worker', targetUrl(anyOurs, extId));
  return true;
}

async function checkAnyPageInspect(targets) {
  for (const t of targets) {
    if (!t.attached || !isPageTarget(t)) continue;
    // Ignore chrome:// and extension pages — focus real http(s) tool sites
    const url = t.url || '';
    if (url && !/^https?:/i.test(url)) continue;
    const detectionType = await pageDetectionType();
    await handleViolation(detectionType, url || `tab:${t.tabId}`);
    return true;
  }
  return false;
}

async function checkNewDevtoolsWindowSw(targets, extId) {
  const known = await getKnownDevtoolsWindowIds();
  let wins = [];
  try {
    if (!chrome.windows?.getAll) return false;
    wins = await chrome.windows.getAll({ windowTypes: ['devtools'] });
  } catch {
    return false;
  }
  const fresh = wins.filter((w) => w.id && !known.has(w.id));
  if (!fresh.length) return false;

  const pageAttached = targets.some((t) => t.attached && isPageTarget(t) && /^https?:/i.test(t.url || ''));
  if (pageAttached) return false;

  const ourTarget = targets.find((t) => isOurExtensionTarget(t, extId));
  await handleViolation(
    'service_worker',
    ourTarget ? targetUrl(ourTarget, extId) : `chrome-extension://${extId}/`,
  );
  return true;
}

async function runDevtoolsScan() {
  if (probing || violationSent) return;
  probing = true;
  try {
    if (!(await isDevtoolsArmed())) {
      violationSent = false;
      return;
    }
    if (!chrome.debugger?.getTargets) return;

    const extId = chrome.runtime.id;
    const targets = await chrome.debugger.getTargets();
    if (await checkExtensionInspect(targets, extId)) return;
    if (await checkAnyPageInspect(targets)) return;
    await checkNewDevtoolsWindowSw(targets, extId);
  } catch (e) {
    console.warn('[devtools-monitor] scan failed', e);
  } finally {
    probing = false;
  }
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function handleDevtoolsWindowOpened(windowId) {
  if (violationSent) return;
  const known = await getKnownDevtoolsWindowIds();
  if (known.has(windowId)) return;
  if (!(await isDevtoolsArmed())) return;

  const extId = chrome.runtime.id;
  for (let i = 0; i < 5; i += 1) {
    if (violationSent) return;
    await delay(200);
    if (!chrome.debugger?.getTargets) return;
    const targets = await chrome.debugger.getTargets();
    if (await checkExtensionInspect(targets, extId)) return;
    if (await checkAnyPageInspect(targets)) return;
  }
  const targets = await chrome.debugger.getTargets();
  await checkNewDevtoolsWindowSw(targets, extId);
}

function registerDevtoolsWindowListener() {
  if (windowListenerRegistered) return;
  windowListenerRegistered = true;
  if (!chrome.windows?.onCreated) return;
  chrome.windows.onCreated.addListener((win) => {
    if (win.type !== 'devtools' || !win.id) return;
    handleDevtoolsWindowOpened(win.id).catch(() => {});
  });
}

export async function snapshotDevtoolsWindows() {
  violationSent = false;
  try {
    if (!chrome.windows?.getAll) {
      await chrome.storage.session.set({ [LAUNCH_DEVTOOLS_WINS_KEY]: [] });
      return;
    }
    const wins = await chrome.windows.getAll({ windowTypes: ['devtools'] });
    await chrome.storage.session.set({
      [LAUNCH_DEVTOOLS_WINS_KEY]: wins.map((w) => w.id).filter((id) => typeof id === 'number'),
    });
  } catch {
    await chrome.storage.session.set({ [LAUNCH_DEVTOOLS_WINS_KEY]: [] });
  }
}

export async function scanDevtoolsNow() {
  await runDevtoolsScan();
}

export function startDevtoolsMonitor() {
  registerDevtoolsWindowListener();
  void chrome.storage.session.get('devtools_policy').then((s) => {
    if (s.devtools_policy == null) {
      return chrome.storage.session.set({
        devtools_policy: { enabled: true, always: true },
      });
    }
  });
  if (pollTimer) return;
  runDevtoolsScan().catch(() => {});
  pollTimer = setInterval(() => {
    runDevtoolsScan().catch(() => {});
  }, POLL_MS);
}

/** Content-script / popup report path — always armed */
export async function onDevtoolsDetectedFromPage(detectionType, pageUrl) {
  if (!(await isDevtoolsArmed())) return { ok: false, skipped: true };
  await handleViolation(detectionType || 'page_detect', pageUrl || '');
  return { ok: true };
}
