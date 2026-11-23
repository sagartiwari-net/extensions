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

function handleLaunchDetail(detail) {
  const { token, client, requestId } = detail || {};
  if (!token) return;
  // Fail closed: client must match this pack
  if (!client || client !== CLIENT_CONFIG.SLUG) return;

  chrome.runtime.sendMessage({ type: 'LAUNCH', token, client: CLIENT_CONFIG.SLUG, requestId }, (res) => {
    const payload = {
      requestId,
      res,
      lastError: chrome.runtime.lastError?.message || null,
    };
    // Shared DOM target — page JS and content script both see these
    document.dispatchEvent(new CustomEvent('1clk-launch-result', { detail: payload }));
    window.postMessage({ source: 'oneclk-extension', type: '1clk-launch-result', ...payload }, '*');
  });
}

// Preferred: document CustomEvent (shared DOM EventTarget across isolated worlds)
document.addEventListener('1clk-launch', (ev) => {
  handleLaunchDetail(ev.detail);
});

// Fallback: postMessage from page
window.addEventListener('message', (ev) => {
  const data = ev.data;
  if (!data || data.source !== 'oneclk-page' || data.type !== '1clk-launch') return;
  handleLaunchDetail(data);
});
