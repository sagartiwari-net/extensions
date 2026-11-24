const status = document.getElementById('status');
const logsEl = document.getElementById('logs');
const title = document.getElementById('title');

function formatLogs(lines) {
  return (lines || [])
    .map((l) => {
      const { t, tag, ...rest } = l;
      return `${t}  [${tag}]  ${JSON.stringify(rest)}`;
    })
    .join('\n');
}

function loadLogs() {
  chrome.runtime.sendMessage({ type: 'DEBUG_LOGS' }, (res) => {
    if (chrome.runtime.lastError) {
      logsEl.textContent = chrome.runtime.lastError.message;
      return;
    }
    const lines = res?.logs || [];
    if (!lines.length) {
      logsEl.textContent =
        'No logs yet.\n1) Panel se Jasper Access\n2) Refresh / Save log file\n(SW console mat kholo — debug build mein bhi zarurat nahi)';
      return;
    }
    logsEl.textContent = formatLogs(lines);
  });
}

function saveLogFile() {
  chrome.runtime.sendMessage({ type: 'DEBUG_LOGS' }, (res) => {
    if (chrome.runtime.lastError) {
      status.textContent = chrome.runtime.lastError.message;
      return;
    }
    const lines = res?.logs || [];
    const body = [
      `ToolsMandi DEBUG log`,
      `saved: ${new Date().toISOString()}`,
      `slug: ${res?.slug || ''}`,
      `api: ${res?.api || ''}`,
      ``,
      formatLogs(lines) || '(empty)',
      ``,
    ].join('\n');
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `toolsmandi-debug-${stamp}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    status.textContent = `Saved toolsmandi-debug-${stamp}.txt (Downloads)`;
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
  loadLogs();
});

document.getElementById('btnLogs')?.addEventListener('click', loadLogs);
document.getElementById('btnSave')?.addEventListener('click', saveLogFile);
document.getElementById('btnCopy')?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(logsEl.textContent || '');
    status.textContent = 'Copied';
  } catch (e) {
    status.textContent = String(e);
  }
});
document.getElementById('btnClear')?.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'DEBUG_CLEAR' }, () => {
    void chrome.runtime.lastError;
    loadLogs();
    status.textContent = 'Logs cleared';
  });
});
