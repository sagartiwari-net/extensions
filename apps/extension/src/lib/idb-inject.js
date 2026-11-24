/**
 * Restore DigitaVision / old-ToolsMandi indexedDB dumps (Jasper Firebase, etc.).
 * Ported from old/Extension/src/core/injector.js — open existing DB, create missing
 * stores on upgrade, put items. Prefer inject at navigation commit (page_no),
 * not after SPA boot.
 */

/**
 * MAIN-world async function for chrome.scripting.executeScript.
 * Chrome waits for the returned Promise.
 */
export async function injectIndexedDbMainWorld(databases) {
  if (!indexedDB || !databases || typeof databases !== 'object') return { dbs: 0, rows: 0 };
  let dbs = 0;
  let rows = 0;

  for (const dbName of Object.keys(databases)) {
    try {
      await new Promise((res, rej) => {
        const req = indexedDB.open(dbName);

        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          const dbDef = databases[dbName] || {};
          const incomingStores = dbDef.stores || dbDef;

          for (const storeName of Object.keys(incomingStores || {})) {
            if (db.objectStoreNames.contains(storeName)) continue;
            const storeData = incomingStores[storeName];
            const opts = {};
            if (storeData && !Array.isArray(storeData) && typeof storeData === 'object') {
              if (storeData.keyPath) opts.keyPath = storeData.keyPath;
              if (storeData.autoIncrement) opts.autoIncrement = storeData.autoIncrement;
            }
            if (!opts.keyPath && !opts.autoIncrement) {
              const sample = Array.isArray(storeData)
                ? storeData[0]
                : Array.isArray(storeData?.items)
                  ? storeData.items[0]
                  : null;
              if (sample && sample.fbase_key != null) opts.keyPath = 'fbase_key';
              else if (sample && sample.id != null) opts.keyPath = 'id';
              else opts.autoIncrement = true;
            }
            try {
              const store = db.createObjectStore(storeName, opts);
              if (storeData?.indexes && Array.isArray(storeData.indexes)) {
                for (const idx of storeData.indexes) {
                  try {
                    store.createIndex(idx.name, idx.keyPath, idx.options || {});
                  } catch {
                    /* */
                  }
                }
              }
            } catch {
              /* */
            }
          }
        };

        req.onsuccess = (e) => {
          const db = e.target.result;
          const dbDef = databases[dbName] || {};
          const incomingStores = dbDef.stores || dbDef;
          const storeNames = Object.keys(incomingStores || {});
          if (!storeNames.length) {
            db.close();
            res();
            return;
          }

          // If stores are missing, bump version and recreate
          const missing = storeNames.filter((n) => !db.objectStoreNames.contains(n));
          if (missing.length) {
            const nextVersion = (db.version || 1) + 1;
            db.close();
            const req2 = indexedDB.open(dbName, nextVersion);
            req2.onupgradeneeded = (ev) => {
              const db2 = ev.target.result;
              for (const storeName of missing) {
                if (db2.objectStoreNames.contains(storeName)) continue;
                const storeData = incomingStores[storeName];
                const sample = Array.isArray(storeData)
                  ? storeData[0]
                  : Array.isArray(storeData?.items)
                    ? storeData.items[0]
                    : null;
                const opts = {};
                if (sample?.fbase_key != null) opts.keyPath = 'fbase_key';
                else if (sample?.id != null) opts.keyPath = 'id';
                else opts.autoIncrement = true;
                try {
                  db2.createObjectStore(storeName, opts);
                } catch {
                  /* */
                }
              }
            };
            req2.onsuccess = (ev) => {
              writeStores(ev.target.result, incomingStores, storeNames, () => {
                dbs += 1;
                res();
              });
            };
            req2.onerror = () => res();
            return;
          }

          writeStores(db, incomingStores, storeNames, () => {
            dbs += 1;
            res();
          });
        };

        req.onerror = () => rej(req.error);
      });
    } catch {
      /* skip db */
    }
  }

  function writeStores(db, incomingStores, storeNames, done) {
    const validStores = storeNames.filter((n) => db.objectStoreNames.contains(n));
    if (!validStores.length) {
      try {
        db.close();
      } catch {
        /* */
      }
      done();
      return;
    }
    try {
      const tx = db.transaction(validStores, 'readwrite');
      for (const storeName of validStores) {
        const storeData = incomingStores[storeName];
        let items = [];
        if (Array.isArray(storeData)) items = storeData;
        else if (storeData?.items) items = storeData.items;
        try {
          const store = tx.objectStore(storeName);
          for (const it of items) {
            try {
              store.put(it);
              rows += 1;
            } catch {
              /* */
            }
          }
        } catch {
          /* */
        }
      }
      tx.oncomplete = () => {
        try {
          db.close();
        } catch {
          /* */
        }
        done();
      };
      tx.onerror = () => {
        try {
          db.close();
        } catch {
          /* */
        }
        done();
      };
    } catch {
      try {
        db.close();
      } catch {
        /* */
      }
      done();
    }
  }

  return { dbs, rows };
}

/** Write localStorage + sessionStorage in MAIN world. */
export function applyLocalSessionStorageMainWorld(session) {
  const nested = session?.storage || {};
  const ls = session?.localStorage || session?.LocalStorage || nested.localStorage || {};
  const ss = session?.sessionStorage || session?.SessionStorage || nested.sessionStorage || {};
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
}

/**
 * Full page storage inject (LS + SS + IDB). Async — scripting waits for Promise.
 */
export async function applyPageStorageMainWorld(session) {
  applyLocalSessionStorageMainWorld(session);
  const nested = session?.storage || {};
  const idb = session?.indexedDB || session?.IndexedDB || nested.indexedDB || null;
  if (idb && typeof idb === 'object' && Object.keys(idb).length) {
    await injectIndexedDbMainWorld(idb);
  }
  return true;
}

export function sessionNeedsPageStorage(session) {
  if (!session || typeof session !== 'object') return false;
  const nested = session.storage || {};
  const ls = session.localStorage || session.LocalStorage || nested.localStorage || {};
  const ss = session.sessionStorage || session.SessionStorage || nested.sessionStorage || {};
  const idb = session.indexedDB || session.IndexedDB || nested.indexedDB || null;
  if (ls && typeof ls === 'object' && Object.keys(ls).length) return true;
  if (ss && typeof ss === 'object' && Object.keys(ss).length) return true;
  if (idb && typeof idb === 'object' && Object.keys(idb).length) return true;
  return false;
}

export function sessionIsIdbOrStorageAuth(session) {
  if (!sessionNeedsPageStorage(session)) return false;
  const cookies = session.cookies || session.Cookies || [];
  const hasCookies = Array.isArray(cookies) && cookies.some((c) => c?.name);
  return !hasCookies;
}
