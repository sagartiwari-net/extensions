/**
 * Universal session guardian (all tools) — lightweight + fast kill.
 *
 * Security (no long window):
 *   chrome.runtime.connect port dies the instant extension is disabled →
 *   stop beats immediately → MAIN watchdog wipes then blanks (~12s dead timeout).
 *
 * Performance (no client CPU melt):
 *   - Idle on normal websites (no 50× boot retry storm)
 *   - Watchdog injected once
 *   - Cheap postMessage beats only on launch tabs
 *   - Backup ping rare (port disconnect is the primary signal)
 */
import { pageWatchdogSource } from './page-watchdog.js';

(function killSwitch() {
  const MARKER = '__1clk_launch_tab';
  const WAS_LAUNCH = '__1clk_was_launch';
  const LAUNCH_URL = '__1clk_launch_url';
  const APEX_COOKIE = '__1clk_launch';
  const BEAT_MS = 1000;
  const BACKUP_PING_MS = 15000;
  const BOOT_RETRY_MS = 800;
  const BOOT_RETRY_MAX = 3;

  if (window.__oneclk_kill_switch) return;
  window.__oneclk_kill_switch = true;

  let port = null;
  let killing = false;
  let activated = false;
  let beatTimer = null;
  let backupTimer = null;
  let isLaunch = false;
  let bootAttempts = 0;
  let cookieNames = [];
  let watchdogInjected = false;
  const watchdogSrc = pageWatchdogSource();

  function swallowLastError() {
    try {
      void chrome.runtime.lastError;
    } catch {
      /* */
    }
  }

  function extensionAlive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  function hasApexCookie() {
    try {
      return document.cookie.split(';').some((part) => part.trim().startsWith(`${APEX_COOKIE}=`));
    } catch {
      return false;
    }
  }

  function wasLaunchTab() {
    try {
      return (
        isLaunch ||
        sessionStorage.getItem(MARKER) === '1' ||
        sessionStorage.getItem(WAS_LAUNCH) === '1' ||
        hasApexCookie()
      );
    } catch {
      return isLaunch || hasApexCookie();
    }
  }

  function launchUrl() {
    try {
      return sessionStorage.getItem(LAUNCH_URL) || location.href;
    } catch {
      return location.href;
    }
  }

  function markLocal(url) {
    try {
      sessionStorage.setItem(MARKER, '1');
      sessionStorage.setItem(WAS_LAUNCH, '1');
      if (url) sessionStorage.setItem(LAUNCH_URL, url);
    } catch {
      /* */
    }
    try {
      const href = url || location.href;
      const h = new URL(href).hostname.replace(/^www\./, '').toLowerCase();
      const parts = h.split('.');
      const apex = parts.length >= 2 ? parts.slice(-2).join('.') : h;
      if (apex) {
        document.cookie = `${APEX_COOKIE}=1;path=/;max-age=86400;SameSite=Lax;domain=.${apex}`;
      }
      document.cookie = `${APEX_COOKIE}=1;path=/;max-age=86400;SameSite=Lax`;
    } catch {
      /* */
    }
  }

  function pageApex() {
    try {
      const host = location.hostname.replace(/^www\./, '').toLowerCase();
      const parts = host.split('.');
      return parts.length >= 2 ? parts.slice(-2).join('.') : host;
    } catch {
      return '';
    }
  }

  function extPingUrl() {
    try {
      // web_accessible ping — MAIN world can fetch; fails when extension disabled
      return chrome.runtime.getURL('ping.txt');
    } catch {
      return '';
    }
  }

  /** Inject MAIN watchdog once — re-inject on every beat was melting CPU. */
  function injectMainWatchdog(url, force = false) {
    if (watchdogInjected && !force) return;
    watchdogInjected = true;
    const targetUrl = url || location.href;
    const ping = extPingUrl();
    try {
      chrome.runtime.sendMessage(
        {
          type: 'ENSURE_WATCHDOG',
          url: targetUrl,
          cookieNames: cookieNames || [],
          extPingUrl: ping,
        },
        () => void chrome.runtime.lastError,
      );
    } catch {
      /* */
    }
    try {
      const s = document.createElement('script');
      s.textContent = `(${watchdogSrc})(${JSON.stringify(targetUrl)}, ${JSON.stringify(
        cookieNames || [],
      )}, ${JSON.stringify(ping)});`;
      (document.documentElement || document.head || document.body).appendChild(s);
      s.remove();
    } catch {
      /* */
    }
  }

  function postBeat() {
    if (killing || !activated) return;
    try {
      window.postMessage({ type: '__1clk_beat', t: Date.now(), ping: extPingUrl() }, '*');
    } catch {
      /* */
    }
  }

  function startBeats() {
    postBeat();
    if (!beatTimer) beatTimer = setInterval(postBeat, BEAT_MS);
  }

  function stopBeats() {
    if (beatTimer) {
      clearInterval(beatTimer);
      beatTimer = null;
    }
  }

  function requestBackgroundCleanup() {
    const url = launchUrl();
    try {
      chrome.storage.local.set({ extension_disable_pending: Date.now() });
    } catch {
      /* */
    }
    try {
      chrome.runtime.sendMessage(
        { type: 'EMERGENCY_COOKIE_CLEANUP', url, soft: false },
        swallowLastError,
      );
    } catch {
      /* */
    }
  }

  function wipePageData() {
    try {
      localStorage.clear();
    } catch {
      /* */
    }
    try {
      const apex = pageApex();
      const names = new Set(
        (cookieNames || []).concat([
          'grauth',
          'gac',
          'csrf-token',
          'isGrammarlyUser',
          'last_authn_event',
          'gnar_containerId',
          APEX_COOKIE,
        ]),
      );
      try {
        for (const part of document.cookie.split(';')) {
          const name = (part.split('=')[0] || '').trim();
          if (name) names.add(name);
        }
      } catch {
        /* */
      }
      const domains = [null, location.hostname, `.${location.hostname}`];
      if (apex) domains.push(apex, `.${apex}`);
      for (const name of names) {
        for (const path of ['/', location.pathname || '/']) {
          for (const domain of domains) {
            let s = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=${path};Max-Age=0`;
            if (domain) s += `;domain=${domain}`;
            try {
              document.cookie = s;
            } catch {
              /* */
            }
          }
        }
      }
    } catch {
      /* */
    }
    try {
      sessionStorage.removeItem(MARKER);
      sessionStorage.removeItem(WAS_LAUNCH);
      sessionStorage.removeItem(LAUNCH_URL);
      sessionStorage.clear();
    } catch {
      /* */
    }
    // Jasper / Firebase — kick IDB deletes while still on origin (before about:blank)
    try {
      indexedDB.deleteDatabase('firebaseLocalStorageDb');
      indexedDB.deleteDatabase('firebase-heartbeat-database');
      if (indexedDB.databases) {
        indexedDB.databases().then((dbs) => {
          (dbs || []).forEach((db) => {
            try {
              if (db?.name) indexedDB.deleteDatabase(db.name);
            } catch {
              /* */
            }
          });
        });
      }
    } catch {
      /* */
    }
  }

  function finalizeKill() {
    if (killing || !wasLaunchTab()) return;
    killing = true;
    activated = false;
    stopBeats();
    if (backupTimer) {
      clearInterval(backupTimer);
      backupTimer = null;
    }
    // Wipe on origin FIRST — blanking cancels IDB clears (Jasper/Grammarly stay logged in)
    requestBackgroundCleanup();
    wipePageData();
    const goBlank = () => {
      try {
        window.stop();
      } catch {
        /* */
      }
      try {
        if (location.href !== 'about:blank') window.location.replace('about:blank');
      } catch {
        try {
          window.location.href = 'about:blank';
        } catch {
          /* */
        }
      }
    };
    setTimeout(goBlank, 120);
    setTimeout(goBlank, 500);
    setTimeout(goBlank, 1500);
  }

  function onExtensionGone() {
    if (killing || !wasLaunchTab()) return;
    // Instant path — do not wait for ping retries (security window stays ~2s)
    finalizeKill();
  }

  function connectPort() {
    if (port || killing || !extensionAlive() || !activated) return;
    try {
      port = chrome.runtime.connect({ name: 'oneclk_keepalive' });
      port.onDisconnect.addListener(() => {
        swallowLastError();
        port = null;
        // Extension disabled/reloaded OR SW killed. Prefer kill if runtime is gone.
        if (!extensionAlive()) {
          onExtensionGone();
          return;
        }
        // SW sleep — reconnect quietly (not a disable)
        setTimeout(() => {
          if (killing || !activated || !extensionAlive()) return;
          connectPort();
        }, 500);
      });
    } catch {
      port = null;
      if (!extensionAlive()) onExtensionGone();
    }
  }

  function backupPing() {
    if (killing || !activated) return;
    // Only kill when extension is actually gone — never on slow SW / failed PING
    if (!extensionAlive()) {
      onExtensionGone();
      return;
    }
    try {
      chrome.runtime.sendMessage({ type: 'PING' }, (resp) => {
        swallowLastError();
        if (!extensionAlive()) {
          onExtensionGone();
          return;
        }
        if (resp?.ok) {
          connectPort();
          try {
            port?.postMessage({ type: 'RENEW_LEASE' });
          } catch {
            /* */
          }
        } else {
          // Transient SW sleep — reconnect, do NOT blank the page
          connectPort();
        }
      });
    } catch {
      if (!extensionAlive()) onExtensionGone();
    }
  }

  function activateLaunchTab(url, names) {
    if (Array.isArray(names) && names.length) cookieNames = names;
    markLocal(url || location.href);
    isLaunch = true;
    if (activated) {
      // Already armed — only refresh markers / ensure port
      connectPort();
      startBeats();
      return;
    }
    activated = true;
    injectMainWatchdog(url || location.href, true);
    connectPort();
    startBeats();
    if (!backupTimer) {
      backupTimer = setInterval(backupPing, BACKUP_PING_MS);
    }
  }

  function askIsLaunchTab(cb) {
    if (!extensionAlive()) {
      cb(false, null);
      return;
    }
    try {
      chrome.runtime.sendMessage({ type: 'IS_LAUNCH_TAB', url: location.href }, (resp) => {
        if (chrome.runtime.lastError) {
          swallowLastError();
          cb(false, null);
          return;
        }
        cb(!!resp?.yes, resp || null);
      });
    } catch {
      cb(false, null);
    }
  }

  function matchesDurableStore(store) {
    try {
      const host = location.hostname.replace(/^www\./, '').toLowerCase();
      const apex = pageApex();
      const apexes = store.oneclk_last_launch_apexes || [];
      const hosts = store.oneclk_last_launch_hosts || [];
      return (
        apexes.includes(apex) ||
        hosts.some((h) => host === h || host.endsWith(`.${h}`) || String(h).endsWith(`.${host}`))
      );
    } catch {
      return false;
    }
  }

  function boot() {
    if (wasLaunchTab()) {
      activateLaunchTab(launchUrl());
      return;
    }
    // Cheap gate: only talk to SW if this apex was recently launched (or few retries after Open)
    try {
      chrome.storage.local.get(
        ['oneclk_last_launch_apexes', 'oneclk_last_launch_hosts', 'oneclk_active_cookie_names'],
        (store) => {
          if (chrome.runtime.lastError) swallowLastError();
          const durableHit = store && matchesDurableStore(store);
          if (durableHit) {
            activateLaunchTab(location.href, store.oneclk_active_cookie_names || []);
            return;
          }
          // Not a known tool host — ask SW once (Open may race markers), then stop.
          askIsLaunchTab((yes, resp) => {
            if (yes) {
              activateLaunchTab(location.href, resp?.cookieNames || []);
              return;
            }
            bootAttempts += 1;
            if (bootAttempts < BOOT_RETRY_MAX) {
              setTimeout(boot, BOOT_RETRY_MS);
            }
            // else: idle forever until __1clk_mark_launch
          });
        },
      );
    } catch {
      bootAttempts += 1;
      if (bootAttempts < BOOT_RETRY_MAX) setTimeout(boot, BOOT_RETRY_MS);
    }
  }

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === '__1clk_mark_launch') {
        activateLaunchTab(msg.url || location.href, msg.cookieNames || []);
      }
    });
  } catch {
    /* */
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && activated) {
      postBeat();
      connectPort();
    }
  });

  boot();
})();
