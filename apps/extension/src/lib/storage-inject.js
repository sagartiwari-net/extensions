/** Runs in page world via chrome.scripting.executeScript */
export function applyStorageReload(session) {
  const ls = session.localStorage || session.LocalStorage || {};
  const ss = session.sessionStorage || session.SessionStorage || {};

  try {
    localStorage.clear();
  } catch { /* */ }
  try {
    sessionStorage.clear();
  } catch { /* */ }

  for (const [k, v] of Object.entries(ls)) {
    try {
      localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    } catch { /* */ }
  }
  for (const [k, v] of Object.entries(ss)) {
    try {
      sessionStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    } catch { /* */ }
  }
  location.reload();
}