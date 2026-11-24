/**
 * DigitaVision / old page_no: inject LS/SS/IDB at navigation commit on the tool
 * origin — before the SPA boots and races Firebase IDB (Jasper, Quillbot, …).
 */
import { applyPageStorageMainWorld, sessionNeedsPageStorage } from './idb-inject.js';

const BUNDLE_KEY = 'oneclk_page_no_bundle';
const INJECTED_KEY = 'oneclk_page_no_injected';

function hostKey(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export async function savePageNoBundle(tabId, webUrl, session) {
  if (!sessionNeedsPageStorage(session) || !tabId) return;
  const { [BUNDLE_KEY]: map = {} } = await chrome.storage.session.get(BUNDLE_KEY);
  map[String(tabId)] = {
    webUrl,
    host: hostKey(webUrl),
    session,
    at: Date.now(),
  };
  await chrome.storage.session.set({ [BUNDLE_KEY]: map });
}

export async function clearPageNoBundle(tabId) {
  const { [BUNDLE_KEY]: map = {}, [INJECTED_KEY]: inj = {} } = await chrome.storage.session.get([
    BUNDLE_KEY,
    INJECTED_KEY,
  ]);
  delete map[String(tabId)];
  delete inj[String(tabId)];
  await chrome.storage.session.set({ [BUNDLE_KEY]: map, [INJECTED_KEY]: inj });
}

async function markInjected(tabId, host) {
  const { [INJECTED_KEY]: inj = {} } = await chrome.storage.session.get(INJECTED_KEY);
  const key = `${tabId}:${host}`;
  inj[key] = Date.now();
  await chrome.storage.session.set({ [INJECTED_KEY]: inj });
}

async function wasInjected(tabId, host) {
  const { [INJECTED_KEY]: inj = {} } = await chrome.storage.session.get(INJECTED_KEY);
  return !!inj[`${tabId}:${host}`];
}

export async function tryPageNoInject(tabId, url) {
  if (!url?.startsWith('http') || !tabId) return false;
  const pageHost = hostKey(url);
  if (!pageHost) return false;

  const { [BUNDLE_KEY]: map = {} } = await chrome.storage.session.get(BUNDLE_KEY);
  const bundle = map[String(tabId)];
  if (!bundle?.session) return false;

  const toolHost = bundle.host || hostKey(bundle.webUrl);
  if (!toolHost || pageHost !== toolHost) return false;
  if (await wasInjected(tabId, pageHost)) return true;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: applyPageStorageMainWorld,
      args: [bundle.session],
    });
    await markInjected(tabId, pageHost);
    return true;
  } catch (err) {
    console.warn('[page_no] inject failed', pageHost, err);
    return false;
  }
}

/** Block until first tool-origin inject or timeout. */
export function waitForPageNoInject(tabId, toolUrl, timeoutMs = 20000) {
  const origin = hostKey(toolUrl);
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try {
        chrome.webNavigation.onCommitted.removeListener(onCommit);
      } catch {
        /* */
      }
      clearTimeout(timer);
      resolve(!!ok);
    };

    const onCommit = (details) => {
      if (details.tabId !== tabId || details.frameId !== 0) return;
      if (!details.url?.startsWith('http')) return;
      if (hostKey(details.url) !== origin) return;
      void tryPageNoInject(tabId, details.url).then((ok) => {
        if (ok) finish(true);
      });
    };

    const timer = setTimeout(() => finish(false), timeoutMs);
    chrome.webNavigation.onCommitted.addListener(onCommit);

    // Tab may already be loading
    void chrome.tabs.get(tabId).then((t) => {
      if (t?.url?.startsWith('http')) void tryPageNoInject(tabId, t.url).then((ok) => ok && finish(true));
    });
  });
}

let hooked = false;
export function startPageNoNavigationHook() {
  if (hooked) return;
  hooked = true;
  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId !== 0) return;
    void tryPageNoInject(details.tabId, details.url);
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    void clearPageNoBundle(tabId);
  });
}
