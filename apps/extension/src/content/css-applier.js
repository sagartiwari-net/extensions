/**
 * Content CSS applier — keeps hide/replace rules alive on SPA pages.
 */
(function cssApplier() {
  if (window.__oneclk_css_applier) return;
  window.__oneclk_css_applier = true;

  const KEY = 'oneclk_active_rules';
  const STYLE_ID = '__oneclk_css_rules';
  let timer = null;
  let lastText = '';

  function alive() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  function sanitizeSelector(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (!s.startsWith('<')) return s;
    const id = s.match(/\bid\s*=\s*["']([^"']+)["']/i);
    if (id?.[1]) return `#${id[1].replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const cls = s.match(/\bclass\s*=\s*["']([^"']+)["']/i);
    if (cls?.[1]) {
      const first = cls[1].trim().split(/\s+/).find(Boolean);
      if (first) return `.${first.replace(/[^a-zA-Z0-9_-]/g, '')}`;
    }
    return s;
  }

  function patternHits(pattern, href) {
    const p = String(pattern || '').trim();
    if (!p || p === '*://*/*') return true;
    try {
      const u = new URL(href);
      const host = u.hostname.toLowerCase();
      if (/^[a-z0-9.-]+$/i.test(p)) {
        const d = p.toLowerCase().replace(/^\./, '');
        return host === d || host.endsWith(`.${d}`) || host.includes(d);
      }
      if (/^https?:\/\//i.test(p)) {
        return href.toLowerCase().includes(p.toLowerCase().replace(/\/$/, ''));
      }
      return href.toLowerCase().includes(p.toLowerCase());
    } catch {
      return false;
    }
  }

  function cssText(rules) {
    const parts = [];
    for (const r of rules || []) {
      if (!patternHits(r.url_pattern, location.href)) continue;
      const sel = sanitizeSelector(r.selector);
      if (!sel) continue;
      if (r.action === 'hide') {
        parts.push(
          `${sel}{display:none!important;visibility:hidden!important;opacity:0!important;height:0!important;overflow:hidden!important;pointer-events:none!important;}`,
        );
      } else if (r.action === 'replace' && r.value) {
        parts.push(`${sel}{visibility:hidden!important;}`);
        parts.push(
          `${sel}::after{content:${JSON.stringify(String(r.value))};visibility:visible!important;}`,
        );
      } else if (r.action === 'custom' && r.value) {
        parts.push(sel === '*' ? String(r.value) : `${sel}{${r.value}}`);
      }
    }
    return parts.join('\n');
  }

  function apply(rules) {
    const text = cssText(rules?.css);
    let el = document.getElementById(STYLE_ID);
    if (!text) {
      if (el) el.remove();
      lastText = '';
      return;
    }
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      (document.documentElement || document.head || document.body)?.appendChild(el);
    }
    if (el.textContent !== text) el.textContent = text;
    lastText = text;

    // Also force-hide matched nodes (inline) for stubborn SPA styles
    for (const r of rules?.css || []) {
      if (r.action !== 'hide') continue;
      if (!patternHits(r.url_pattern, location.href)) continue;
      const sel = sanitizeSelector(r.selector);
      if (!sel) continue;
      try {
        document.querySelectorAll(sel).forEach((node) => {
          node.style.setProperty('display', 'none', 'important');
          node.style.setProperty('visibility', 'hidden', 'important');
        });
      } catch {
        /* bad selector */
      }
    }
  }

  function readRules(cb) {
    try {
      chrome.storage.local.get(KEY, (data) => {
        void chrome.runtime.lastError;
        if (data?.[KEY]) {
          cb(data[KEY]);
          return;
        }
        chrome.storage.session.get(KEY, (sess) => {
          void chrome.runtime.lastError;
          cb(sess?.[KEY] || null);
        });
      });
    } catch {
      cb(null);
    }
  }

  function tick() {
    if (!alive()) {
      if (timer) clearInterval(timer);
      return;
    }
    readRules(apply);
  }

  tick();
  timer = setInterval(tick, 1000);
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' && area !== 'session') return;
      if (!changes[KEY]) return;
      apply(changes[KEY].newValue || null);
    });
  } catch {
    /* */
  }
})();
