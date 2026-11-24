/**
 * DigitaVision / old page_no: inject LS/SS/IDB at navigation commit on the tool
 * origin — before the SPA boots and races Firebase IDB (Jasper, Quillbot, …).
 *
 * executeScript uses a self-contained MAIN-world func (see idb-inject.js).
 */
import { debugLog, summarizeSession } from './debug-log.js';
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

/** app.jasper.ai ↔ jasper.ai */
function hostsMatch(pageHost, toolHost) {
  if (!pageHost || !toolHost) return false;
  if (pageHost === toolHost) return true;
  if (pageHost.endsWith(`.${toolHost}`)) return true;
  if (toolHost.endsWith(`.${pageHost}`)) return true;
  return false;
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
  for (const k of Object.keys(inj)) {
    if (k.startsWith(`${tabId}:`)) delete inj[k];
  }
  await chrome.storage.session.set({ [BUNDLE_KEY]: map, [INJECTED_KEY]: inj });
}

async function markInjected(tabId, host) {
  const { [INJECTED_KEY]: inj = {} } = await chrome.storage.session.get(INJECTED_KEY);
  inj[`${tabId}:${host}`] = Date.now();
  await chrome.storage.session.set({ [INJECTED_KEY]: inj });
}

export async function isPageNoInjected(tabId, host) {
  const { [INJECTED_KEY]: inj = {} } = await chrome.storage.session.get(INJECTED_KEY);
  return !!inj[`${tabId}:${host}`];
}

export async function getPageNoBundle(tabId) {
  const { [BUNDLE_KEY]: map = {} } = await chrome.storage.session.get(BUNDLE_KEY);
  return map[String(tabId)] || null;
}

/** MAIN-world: count firebase / IDB rows after inject (self-contained). */
function verifyIdbMainWorld() {
  return new Promise((resolve) => {
    if (!indexedDB?.databases) {
      resolve({ ok: false, reason: 'no_databases_api' });
      return;
    }
    indexedDB
      .databases()
      .then(async (dbs) => {
        const out = { ok: true, databases: [] };
        for (const info of dbs || []) {
          const name = info?.name;
          if (!name) continue;
          try {
            const detail = await new Promise((res) => {
              const req = indexedDB.open(name);
              req.onerror = () => res({ name, error: true });
              req.onsuccess = (e) => {
                const db = e.target.result;
                const stores = [...db.objectStoreNames];
                const counts = {};
                if (!stores.length) {
                  db.close();
                  res({ name, stores, counts });
                  return;
                }
                const tx = db.transaction(stores, 'readonly');
                let pending = stores.length;
                for (const s of stores) {
                  const cReq = tx.objectStore(s).count();
                  cReq.onsuccess = () => {
                    counts[s] = cReq.result;
                    pending -= 1;
                    if (pending <= 0) {
                      db.close();
                      res({ name, stores, counts });
                    }
                  };
                  cReq.onerror = () => {
                    counts[s] = -1;
                    pending -= 1;
                    if (pending <= 0) {
                      db.close();
                      res({ name, stores, counts });
                    }
                  };
                }
              };
            });
            out.databases.push(detail);
          } catch (e) {
            out.databases.push({ name, error: String(e) });
          }
        }
        resolve(out);
      })
      .catch((e) => resolve({ ok: false, reason: String(e) }));
  });
}

export async function tryPageNoInject(tabId, url, opts = {}) {
  if (!url?.startsWith('http') || !tabId) return false;
  const pageHost = hostKey(url);
  if (!pageHost) return false;

  const bundle = await getPageNoBundle(tabId);
  if (!bundle?.session) {
    // Panel /launch + member tabs hit content backup with no tool bundle — ignore noise
    if (!/1clkaccess\.store$|toolsmandi\.com$/i.test(pageHost)) {
      await debugLog('page_no.skip', { tabId, pageHost, reason: 'no_bundle' });
    }
    return false;
  }

  const toolHost = bundle.host || hostKey(bundle.webUrl);
  if (!hostsMatch(pageHost, toolHost)) {
    await debugLog('page_no.skip', { tabId, pageHost, toolHost, reason: 'host_mismatch' });
    return false;
  }
  if (await isPageNoInjected(tabId, pageHost)) {
    await debugLog('page_no.skip', { tabId, pageHost, reason: 'already_injected' });
    return true;
  }

  await debugLog('page_no.inject_start', {
    tabId,
    pageHost,
    toolHost,
    url,
    vault: summarizeSession(bundle.session),
  });

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: applyPageStorageMainWorld,
      args: [bundle.session],
    });
    const result = results?.[0]?.result;
    await debugLog('page_no.inject_result', { tabId, pageHost, result });

    let verify = null;
    try {
      const v = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: verifyIdbMainWorld,
      });
      verify = v?.[0]?.result;
      await debugLog('page_no.verify_idb', { tabId, pageHost, verify });
    } catch (verr) {
      await debugLog('page_no.verify_fail', { tabId, pageHost, err: String(verr) });
    }

    await markInjected(tabId, pageHost);

    // Firebase Auth reads IDB once at boot — if SPA already painted login, force one reload
    if (opts.reload !== false && sessionNeedsPageStorage(bundle.session)) {
      const { [INJECTED_KEY]: inj = {} } = await chrome.storage.session.get(INJECTED_KEY);
      const reloadKey = `${tabId}:reloaded`;
      if (!inj[reloadKey]) {
        inj[reloadKey] = Date.now();
        await chrome.storage.session.set({ [INJECTED_KEY]: inj });
        await debugLog('page_no.reload', { tabId, pageHost });
        await chrome.tabs.reload(tabId, { bypassCache: true }).catch(() => {});
      }
    }
    return true;
  } catch (err) {
    await debugLog('page_no.inject_failed', {
      tabId,
      pageHost,
      err: String(err?.message || err),
    });
    return false;
  }
}

/** Block until first tool-origin inject or timeout. */
export function waitForPageNoInject(tabId, toolUrl, timeoutMs = 25000) {
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
      if (!hostsMatch(hostKey(details.url), origin)) return;
      void tryPageNoInject(tabId, details.url).then((ok) => {
        if (ok) finish(true);
      });
    };

    const timer = setTimeout(() => finish(false), timeoutMs);
    chrome.webNavigation.onCommitted.addListener(onCommit);

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
    void chrome.storage.session.get('oneclk_active_launches').then((store) => {
      const launches = store.oneclk_active_launches || {};
      if (!launches[String(tabId)]) return;
      delete launches[String(tabId)];
      void chrome.storage.session.set({ oneclk_active_launches: launches });
    });
  });
}
