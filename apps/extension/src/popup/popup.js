const status = document.getElementById('status');

chrome.runtime.sendMessage({ type: 'PING' }, (res) => {
  if (chrome.runtime.lastError) {
    status.textContent = chrome.runtime.lastError.message;
    return;
  }
  status.textContent = res?.ok ? `OK · ${res.slug}` : 'No response';
});