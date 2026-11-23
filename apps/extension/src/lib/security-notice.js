/**
 * Light-theme animated security notice (data: URL so it survives self-disable).
 */

const REASON_COPY = {
  docked_devtools: {
    title: 'Developer Tools detected',
    detail:
      'Inspect Element / DevTools was opened on a protected page. For account safety the session was cleared and this extension turned itself off.',
  },
  popup_devtools: {
    title: 'DevTools window detected',
    detail:
      'A separate DevTools window was opened. Protected cookies were wiped and the extension disabled itself.',
  },
  service_worker: {
    title: 'Extension inspect detected',
    detail:
      'Someone opened the extension service worker or background inspector. That is not allowed — session data was cleared and the extension is now off.',
  },
  keyboard_shortcut: {
    title: 'Inspect shortcut blocked',
    detail:
      'A DevTools keyboard shortcut (F12 / Ctrl+Shift+I) was used. The session was wiped and the extension disabled for security.',
  },
  console_trap: {
    title: 'Console inspection detected',
    detail:
      'Browser console inspection was detected on a protected page. Cookies and storage were cleared and the extension turned off.',
  },
  page_detect: {
    title: 'Page inspection detected',
    detail:
      'Inspection activity was detected on a tool page. The session was cleared and this extension disabled itself.',
  },
};

export function reasonLabel(reason) {
  return REASON_COPY[reason] || {
    title: 'Security lockout',
    detail:
      'A security check failed (inspect / DevTools). Protected data was cleared and the extension disabled itself.',
  };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {{ reason?: string, brand?: string, pageUrl?: string | null, username?: string | null }} opts
 */
export function buildSecurityNoticeHtml(opts = {}) {
  const copy = reasonLabel(opts.reason || 'devtools');
  const brand = escapeHtml(opts.brand || '1Clk Access');
  const title = escapeHtml(copy.title);
  const detail = escapeHtml(copy.detail);
  const code = escapeHtml(String(opts.reason || 'devtools'));
  const pageUrl = String(opts.pageUrl || '').trim();
  const pageRow = pageUrl
    ? `<div class="row"><span>Page URL</span><span title="${escapeHtml(pageUrl)}">${escapeHtml(pageUrl.length > 72 ? `${pageUrl.slice(0, 69)}…` : pageUrl)}</span></div>`
    : '';
  const userRow = opts.username
    ? `<div class="row"><span>User</span><span>${escapeHtml(opts.username)}</span></div>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title} — ${brand}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Outfit:wght@400;500;600&display=swap" rel="stylesheet"/>
<style>
  :root {
    --bg0: #f4f7fb;
    --bg1: #e8eef6;
    --card: #ffffff;
    --ink: #152033;
    --muted: #5b6b82;
    --line: #d7e0ec;
    --accent: #0d9488;
    --accent-soft: #ccfbf1;
    --warn: #b45309;
    --warn-soft: #fff7ed;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; min-height: 100%;
    font-family: Outfit, system-ui, sans-serif;
    color: var(--ink);
    background:
      radial-gradient(1200px 600px at 10% -10%, #dbeafe 0%, transparent 55%),
      radial-gradient(900px 500px at 100% 0%, #ccfbf1 0%, transparent 50%),
      linear-gradient(165deg, var(--bg0), var(--bg1));
  }
  body {
    display: grid;
    place-items: center;
    padding: 32px 20px;
    overflow-x: hidden;
  }
  .wrap {
    width: min(520px, 100%);
    opacity: 0;
    transform: translateY(28px) scale(.98);
    animation: rise .7s cubic-bezier(.22,1,.36,1) .08s forwards;
  }
  @keyframes rise {
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  .card {
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 24px;
    padding: 36px 32px 28px;
    box-shadow:
      0 1px 0 rgba(255,255,255,.8) inset,
      0 24px 48px -28px rgba(21,32,51,.28);
    position: relative;
    overflow: hidden;
  }
  .card::before {
    content: "";
    position: absolute;
    inset: 0 auto auto 0;
    width: 100%; height: 3px;
    background: linear-gradient(90deg, var(--accent), #38bdf8, var(--accent));
    background-size: 200% 100%;
    animation: shimmer 2.4s linear infinite;
  }
  @keyframes shimmer {
    0% { background-position: 0% 0; }
    100% { background-position: 200% 0; }
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: .06em;
    text-transform: uppercase;
    color: var(--warn);
    background: var(--warn-soft);
    border: 1px solid #fed7aa;
    border-radius: 999px;
    padding: 6px 12px;
    margin-bottom: 20px;
    opacity: 0;
    animation: fade .5s ease .25s forwards;
  }
  @keyframes fade { to { opacity: 1; } }
  .icon {
    width: 64px; height: 64px;
    border-radius: 18px;
    display: grid; place-items: center;
    background: var(--accent-soft);
    color: var(--accent);
    margin-bottom: 18px;
    position: relative;
    opacity: 0;
    animation: fade .5s ease .32s forwards;
  }
  .icon::after {
    content: "";
    position: absolute;
    inset: -6px;
    border-radius: 22px;
    border: 2px solid rgba(13,148,136,.35);
    animation: pulse 1.8s ease-out infinite;
  }
  @keyframes pulse {
    0% { transform: scale(.92); opacity: .7; }
    100% { transform: scale(1.18); opacity: 0; }
  }
  h1 {
    font-family: Fraunces, Georgia, serif;
    font-size: clamp(1.55rem, 3vw, 1.9rem);
    font-weight: 700;
    line-height: 1.2;
    margin: 0 0 12px;
    letter-spacing: -0.02em;
    opacity: 0;
    animation: fade .55s ease .4s forwards;
  }
  .detail {
    margin: 0 0 22px;
    font-size: 1.02rem;
    line-height: 1.55;
    color: var(--muted);
    opacity: 0;
    animation: fade .55s ease .52s forwards;
  }
  .meta {
    display: grid;
    gap: 10px;
    padding: 14px 16px;
    border-radius: 14px;
    background: #f8fafc;
    border: 1px solid var(--line);
    opacity: 0;
    animation: fade .55s ease .64s forwards;
  }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 13px;
  }
  .row span:first-child { color: var(--muted); font-weight: 500; }
  .row span:last-child {
    color: var(--ink);
    font-weight: 600;
    text-align: right;
    word-break: break-word;
  }
  .foot {
    margin-top: 22px;
    font-size: 13px;
    color: var(--muted);
    text-align: center;
    opacity: 0;
    animation: fade .55s ease .76s forwards;
  }
  .brand {
    font-weight: 600;
    color: var(--ink);
  }
</style>
</head>
<body>
  <main class="wrap">
    <section class="card" role="alert">
      <div class="badge">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 3l8 4v5c0 5-3.4 9.4-8 10-4.6-.6-8-5-8-10V7l8-4z" stroke="currentColor" stroke-width="1.8"/>
        </svg>
        Security lockout
      </div>
      <div class="icon" aria-hidden="true">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
          <path d="M12 3l8 4v5c0 5-3.4 9.4-8 10-4.6-.6-8-5-8-10V7l8-4z" stroke="currentColor" stroke-width="1.8"/>
          <path d="M9.5 12.5l1.8 1.8 3.7-3.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <h1>${title}</h1>
      <p class="detail">${detail}</p>
      <div class="meta">
        <div class="row"><span>Reason code</span><span>${code}</span></div>
        ${pageRow}
        ${userRow}
        <div class="row"><span>What happened</span><span>Cookies cleared · other tabs closed · extension off</span></div>
        <div class="row"><span>Membership</span><span>Kept open (whitelist)</span></div>
      </div>
      <p class="foot">Protected by <span class="brand">${brand}</span>. Re-enable the extension from your membership site when ready.</p>
    </section>
  </main>
</body>
</html>`;
}

/** Open notice in a new tab (survives extension disable). */
export async function openSecurityNoticeTab({ reason, brand, pageUrl, username } = {}) {
  const html = buildSecurityNoticeHtml({ reason, brand, pageUrl, username });
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  const tab = await chrome.tabs.create({ url, active: true });
  return tab?.id || null;
}
