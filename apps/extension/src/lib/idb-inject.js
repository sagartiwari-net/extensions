/**
 * Restore DigitaVision / Cookie-Editor indexedDB dumps into the page.
 *
 * Expected shape:
 * {
 *   "firebaseLocalStorageDb": {
 *     "stores": {
 *       "firebaseLocalStorage": [{ "fbase_key": "...", "value": {...} }]
 *     }
 *   }
 * }
 *
 * Runs in MAIN world via chrome.scripting.executeScript.
 */

function guessKeyPath(rows) {
  const sample = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!sample || typeof sample !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(sample, 'fbase_key')) return 'fbase_key';
  if (Object.prototype.hasOwnProperty.call(sample, 'id')) return 'id';
  if (Object.prototype.hasOwnProperty.call(sample, 'key')) return 'key';
  return null;
}

function deleteDatabase(name) {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

function openWithStores(dbName, storeSpecs) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [storeName, rows] of Object.entries(storeSpecs)) {
        if (db.objectStoreNames.contains(storeName)) continue;
        const keyPath = guessKeyPath(rows);
        if (keyPath) db.createObjectStore(storeName, { keyPath });
        else db.createObjectStore(storeName, { autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error(`open ${dbName} failed`));
  });
}

function putAll(db, storeName, rows) {
  return new Promise((resolve) => {
    try {
      if (!db.objectStoreNames.contains(storeName)) {
        resolve(0);
        return;
      }
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      let n = 0;
      for (const row of rows || []) {
        try {
          store.put(row);
          n += 1;
        } catch {
          try {
            store.add(row);
            n += 1;
          } catch {
            /* skip bad row */
          }
        }
      }
      tx.oncomplete = () => resolve(n);
      tx.onerror = () => resolve(n);
      tx.onabort = () => resolve(n);
    } catch {
      resolve(0);
    }
  });
}

/**
 * @param {Record<string, { stores?: Record<string, unknown[]> }>} idbDump
 * @returns {Promise<{ dbs: number, rows: number }>}
 */
export async function restoreIndexedDbDump(idbDump) {
  if (!idbDump || typeof idbDump !== 'object') return { dbs: 0, rows: 0 };
  let dbs = 0;
  let rows = 0;
  for (const [dbName, spec] of Object.entries(idbDump)) {
    const stores = spec?.stores && typeof spec.stores === 'object' ? spec.stores : null;
    if (!stores || !Object.keys(stores).length) continue;
    await deleteDatabase(dbName);
    let db;
    try {
      db = await openWithStores(dbName, stores);
    } catch {
      continue;
    }
    dbs += 1;
    for (const [storeName, storeRows] of Object.entries(stores)) {
      rows += await putAll(db, storeName, Array.isArray(storeRows) ? storeRows : []);
    }
    try {
      db.close();
    } catch {
      /* */
    }
  }
  return { dbs, rows };
}

/**
 * MAIN-world entry: write LS + SS + indexedDB from a vault session, then optional reload.
 * Passed to executeScript as `func`.
 */
export function applyPageStorageMainWorld(session, opts = {}) {
  const reload = opts.reload !== false;
  const nested = session?.storage || {};
  const ls = session?.localStorage || session?.LocalStorage || nested.localStorage || {};
  const ss = session?.sessionStorage || session?.SessionStorage || nested.sessionStorage || {};
  const idb = session?.indexedDB || nested.indexedDB || null;

  try {
    localStorage.clear();
  } catch {
    /* */
  }
  try {
    sessionStorage.clear();
  } catch {
    /* */
  }
  for (const [k, v] of Object.entries(ls || {})) {
    try {
      localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    } catch {
      /* */
    }
  }
  for (const [k, v] of Object.entries(ss || {})) {
    try {
      sessionStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    } catch {
      /* */
    }
  }

  const finish = () => {
    if (reload) {
      try {
        location.reload();
      } catch {
        /* */
      }
    }
  };

  if (!idb || typeof idb !== 'object' || !Object.keys(idb).length) {
    finish();
    return;
  }

  // Inline restore so executeScript does not need module imports in MAIN world
  (async () => {
    const guessKeyPathInner = (rows) => {
      const sample = Array.isArray(rows) && rows.length ? rows[0] : null;
      if (!sample || typeof sample !== 'object') return null;
      if (Object.prototype.hasOwnProperty.call(sample, 'fbase_key')) return 'fbase_key';
      if (Object.prototype.hasOwnProperty.call(sample, 'id')) return 'id';
      if (Object.prototype.hasOwnProperty.call(sample, 'key')) return 'key';
      return null;
    };
    const del = (name) =>
      new Promise((resolve) => {
        try {
          const req = indexedDB.deleteDatabase(name);
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
          req.onblocked = () => resolve();
        } catch {
          resolve();
        }
      });
    for (const [dbName, spec] of Object.entries(idb)) {
      const stores = spec?.stores && typeof spec.stores === 'object' ? spec.stores : null;
      if (!stores) continue;
      await del(dbName);
      await new Promise((resolve) => {
        try {
          const req = indexedDB.open(dbName, 1);
          req.onupgradeneeded = () => {
            const db = req.result;
            for (const [storeName, rows] of Object.entries(stores)) {
              if (db.objectStoreNames.contains(storeName)) continue;
              const keyPath = guessKeyPathInner(rows);
              if (keyPath) db.createObjectStore(storeName, { keyPath });
              else db.createObjectStore(storeName, { autoIncrement: true });
            }
          };
          req.onsuccess = () => {
            const db = req.result;
            const names = Object.keys(stores);
            let i = 0;
            const next = () => {
              if (i >= names.length) {
                try {
                  db.close();
                } catch {
                  /* */
                }
                resolve();
                return;
              }
              const storeName = names[i++];
              const rows = Array.isArray(stores[storeName]) ? stores[storeName] : [];
              try {
                if (!db.objectStoreNames.contains(storeName)) {
                  next();
                  return;
                }
                const tx = db.transaction(storeName, 'readwrite');
                const store = tx.objectStore(storeName);
                for (const row of rows) {
                  try {
                    store.put(row);
                  } catch {
                    try {
                      store.add(row);
                    } catch {
                      /* */
                    }
                  }
                }
                tx.oncomplete = () => next();
                tx.onerror = () => next();
                tx.onabort = () => next();
              } catch {
                next();
              }
            };
            next();
          };
          req.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    }
    finish();
  })();
}

export function sessionNeedsPageStorage(session) {
  if (!session || typeof session !== 'object') return false;
  const nested = session.storage || {};
  const ls = session.localStorage || session.LocalStorage || nested.localStorage || {};
  const ss = session.sessionStorage || session.SessionStorage || nested.sessionStorage || {};
  const idb = session.indexedDB || nested.indexedDB || null;
  if (ls && typeof ls === 'object' && Object.keys(ls).length) return true;
  if (ss && typeof ss === 'object' && Object.keys(ss).length) return true;
  if (idb && typeof idb === 'object' && Object.keys(idb).length) return true;
  return false;
}
