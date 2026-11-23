/**
 * Client-side block/redirect fallback (DigitaVision / old 1Clk style).
 * DNR misses SPA hops — blank or redirect every 500ms from local rules.
 */
(function blockGuard() {
  if (window.__oneclk_block_guard) return;
  window.__oneclk_block_guard = true;

  const KEY = 'oneclk_active_rules';
  let timer = null;

  function alive() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  function patternHits(pattern, href) {
    const p = String(pattern || '').trim();
    if (!p) return false;
    try {
      const u = new URL(href);
      const host = u.hostname.toLowerCase();
      if (/^[a-z0-9.-]+$/i.test(p)) {
        const d = p.toLowerCase().replace(/^\./, '');
        return host === d || host.endsWith(`.${d}`) || host.includes(d);
      }
      if (/^https?:\/\//i.test(p)) {
        const want = p.toLowerCase().replace(/\/$/, '');
        return href.toLowerCase().startsWith(want) || href.toLowerCase().includes(want);
      }
      return href.toLowerCase().includes(p.toLowerCase());
    } catch {
      return href.includes(p);
    }
  }

  function enforce(rules) {
    if (!rules || !alive()) return;
    const href = location.href;

    for (const b of rules.blocks || []) {
      if (!patternHits(b.url_pattern, href)) continue;
      if (b.action === 'redirect' && b.redirect_url) {
        if (!href.startsWith(b.redirect_url)) location.replace(b.redirect_url);
        return;
      }
      document.documentElement.innerHTML = '';
      try {
        document.open();
        document.write('<!doctype html><title>Blocked</title><body></body>');
        document.close();
      } catch {
        /* */
      }
      return;
    }

    for (const r of rules.redirects || []) {
      if (!patternHits(r.source_url, href)) continue;
      if (r.destination_url && !href.startsWith(r.destination_url)) {
        location.replace(r.destination_url);
      }
      return;
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
    readRules(enforce);
  }

  tick();
  timer = setInterval(tick, 500);
})();
