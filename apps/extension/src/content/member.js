import { CLIENT_CONFIG } from '../config.gen.js';

(() => {
  if (!document.getElementById(CLIENT_CONFIG.INDICATOR_ID)) {
    const el = document.createElement('div');
    el.id = CLIENT_CONFIG.INDICATOR_ID;
    el.dataset.oneclk = CLIENT_CONFIG.SLUG;
    el.style.display = 'none';
    document.documentElement.appendChild(el);
  }
})();

window.addEventListener('1clk-launch', (ev) => {
  const { token, client, requestId } = ev.detail || {};
  if (!token) return;
  // Fail closed: client must be present and match this pack (prevents wrong pack burning token)
  if (!client || client !== CLIENT_CONFIG.SLUG) return;

  chrome.runtime.sendMessage({ type: 'LAUNCH', token, client: CLIENT_CONFIG.SLUG, requestId }, (res) => {
    window.dispatchEvent(
      new CustomEvent('1clk-launch-result', {
        detail: {
          requestId,
          res,
          lastError: chrome.runtime.lastError?.message || null,
        },
      }),
    );
  });
});
