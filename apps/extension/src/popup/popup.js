const status = document.getElementById('status');
const logsEl = document.getElementById('logs');
const title = document.getElementById('title');

function loadLogs() {
  chrome.runtime.sendMessage({ type: 'DEBUG_LOGS' }, (res) => {
    if (chrome.runtime.lastError) {
      logsEl.textContent = chrome.runtime.lastError.message;
      return;
    }
    const lines = res?.logs || [];
    if (!lines.length) {
      logsEl.textContent =
        'No logs yet. Open panel → Access Jasper, then click Refresh.\nAlso: chrome://extensions → this extension → Service worker → Console';
      return;
    }
    logsEl.textContent = lines
      .map((l) => `${l.t}  [${l.tag}]  ${JSON.stringify(l, null, 0).replace(/"t":"[^"]+",?/, '')}`)
      .join('\n');
  });
}

chrome.runtime.sendMessage({ type: 'PING' }, (res) => {
  if (chrome.runtime.lastError) {
    status.textContent = chrome.runtime.lastError.message;
    return;
  }
  const dbg = res?.debug ? ' · DEBUG' : '';
  status.textContent = res?.ok ? `OK · ${res.slug}${dbg}\n${res.api || ''}` : 'No response';
  if (title && res?.debug) title.textContent = '1Clk DEBUG (local)';
  if (res?.debug) loadLogs();
});

document.getElementById('btnLogs')?.addEventListener('click', loadLogs);
document.getElementById('btnCopy')?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(logsEl.textContent || '');
    status.textContent = 'Logs copied to clipboard';
  } catch (e) {
    status.textContent = String(e);
  }
});
