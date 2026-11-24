/**
 * DigitaVision page-injector: document_start backup if onCommitted race lost.
 */
(async function pageInjector() {
  if (typeof chrome === 'undefined' || !chrome.runtime?.id) return;

  const hostKey = location.hostname.replace(/^www\./, '').toLowerCase();

  function sendBg(payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (resp) => {
          resolve(chrome.runtime.lastError ? null : resp);
        });
      } catch {
        resolve(null);
      }
    });
  }

  async function isLaunchTab() {
    try {
      if (sessionStorage.getItem('__1clk_launch_tab') === '1') return true;
    } catch {
      /* */
    }
    const resp = await sendBg({ type: 'IS_LAUNCH_TAB', url: location.href });
    return !!resp?.yes;
  }

  if (!(await isLaunchTab())) return;

  const already = await sendBg({ type: 'PAGE_NO_CHECK', toolHost: hostKey });
  if (already?.done) return;

  try {
    await sendBg({
      type: 'PAGE_NO_BACKUP_INJECT',
      toolHost: hostKey,
      pageUrl: location.href,
    });
  } catch (e) {
    console.warn('[page_no] content backup failed', e);
  }
})();
