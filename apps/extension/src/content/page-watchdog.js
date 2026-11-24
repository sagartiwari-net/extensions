/**
 * MAIN-world watchdog — blank ONLY when the extension is actually gone.
 *
 * Beats alone are NOT enough: content-script death (reload / SPA race) used to
 * blank tools while the extension was still enabled → false about:blank, and
 * Grammarly HttpOnly cookies survived (Jasper IDB did not).
 *
 * Kill path: no beats for DEAD_MS → fetch(ext ping URL) fails → wipe then blank.
 */
export function pageWatchdogSource() {
  return String(function installOneClkWatchdog(launchUrl, cookieNames, extPingUrl) {
    if (window.__oneclk_page_watchdog) {
      try {
        window.__oneclk_watchdog_names = Array.isArray(cookieNames) ? cookieNames : [];
        window.__oneclk_last_beat = Date.now();
        window.__oneclk_watchdog_armed = true;
        if (extPingUrl) window.__oneclk_ext_ping = extPingUrl;
      } catch (e) {
        /* */
      }
      return;
    }
    window.__oneclk_page_watchdog = true;
    window.__oneclk_watchdog_names = Array.isArray(cookieNames) ? cookieNames : [];
    window.__oneclk_last_beat = Date.now();
    window.__oneclk_watchdog_armed = false;
    if (extPingUrl) window.__oneclk_ext_ping = extPingUrl;

    var DEAD_MS = 8000;
    var APEX_COOKIE = '__1clk_launch';
    var killing = false;
    var probing = false;

    function apexFromHref(href) {
      try {
        var h = new URL(href || location.href).hostname.replace(/^www\./, '').toLowerCase();
        var parts = h.split('.');
        return parts.length >= 2 ? parts.slice(-2).join('.') : h;
      } catch (e) {
        return '';
      }
    }

    function markLaunch() {
      try {
        sessionStorage.setItem('__1clk_launch_tab', '1');
        sessionStorage.setItem('__1clk_was_launch', '1');
        if (launchUrl) sessionStorage.setItem('__1clk_launch_url', launchUrl);
      } catch (e) {
        /* */
      }
      try {
        var apex = apexFromHref(launchUrl || location.href);
        if (apex) {
          document.cookie =
            APEX_COOKIE + '=1;path=/;max-age=86400;SameSite=Lax;domain=.' + apex;
        }
        document.cookie = APEX_COOKIE + '=1;path=/;max-age=86400;SameSite=Lax';
      } catch (e2) {
        /* */
      }
    }

    markLaunch();

    window.addEventListener('message', function (event) {
      if (event.source !== window) return;
      if (event.data && event.data.type === '__1clk_beat') {
        window.__oneclk_last_beat = Date.now();
        window.__oneclk_watchdog_armed = true;
        if (event.data.ping) window.__oneclk_ext_ping = event.data.ping;
      }
    });

    function wipeVisibleCookies() {
      var apex = apexFromHref(launchUrl || location.href);
      try {
        apex =
          apexFromHref(sessionStorage.getItem('__1clk_launch_url') || launchUrl || location.href) ||
          apex;
      } catch (e) {
        /* */
      }
      var host = location.hostname;
      var names = {
        grauth: 1,
        gac: 1,
        'csrf-token': 1,
        isGrammarlyUser: 1,
        last_authn_event: 1,
        gnar_containerId: 1,
      };
      var list = window.__oneclk_watchdog_names || [];
      for (var i = 0; i < list.length; i++) names[list[i]] = 1;
      try {
        var parts = document.cookie.split(';');
        for (var j = 0; j < parts.length; j++) {
          var name = (parts[j].split('=')[0] || '').trim();
          if (name) names[name] = 1;
        }
      } catch (e3) {
        /* */
      }
      names[APEX_COOKIE] = 1;

      var domains = [null, host, '.' + host];
      if (apex) {
        domains.push('.' + apex);
        domains.push(apex);
      }
      var nameKeys = Object.keys(names);
      for (var n = 0; n < nameKeys.length; n++) {
        for (var p = 0; p < 2; p++) {
          var path = p === 0 ? '/' : location.pathname || '/';
          for (var d = 0; d < domains.length; d++) {
            var s =
              nameKeys[n] +
              '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=' +
              path +
              ';Max-Age=0';
            if (domains[d]) s += ';domain=' + domains[d];
            try {
              document.cookie = s;
            } catch (e4) {
              /* */
            }
          }
        }
      }
    }

    function wipeStorageSync() {
      try {
        localStorage.clear();
      } catch (e) {
        /* */
      }
      try {
        sessionStorage.clear();
      } catch (e5) {
        /* */
      }
      try {
        if (indexedDB && indexedDB.databases) {
          indexedDB.databases().then(function (dbs) {
            (dbs || []).forEach(function (db) {
              try {
                if (db && db.name) indexedDB.deleteDatabase(db.name);
              } catch (e6) {
                /* */
              }
            });
          });
        }
      } catch (e7) {
        /* */
      }
      try {
        indexedDB.deleteDatabase('firebaseLocalStorageDb');
        indexedDB.deleteDatabase('firebase-heartbeat-database');
      } catch (e8) {
        /* */
      }
    }

    function nextAuthSignOut() {
      return fetch('/api/auth/csrf', { credentials: 'include' })
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          var csrf = (data && data.csrfToken) || '';
          var body = new URLSearchParams();
          body.set('csrfToken', csrf);
          body.set('json', 'true');
          body.set('callbackUrl', location.origin);
          return fetch('/api/auth/signout', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
            keepalive: true,
          });
        })
        .catch(function () {
          /* */
        });
    }

    function fireSignoutBeacons() {
      var paths = [
        '/api/auth/signout',
        '/auth/signout',
        '/auth/logout',
        '/logout',
        '/signout',
        '/api/logout',
      ];
      for (var i = 0; i < paths.length; i++) {
        var url = location.origin + paths[i];
        try {
          navigator.sendBeacon(url, '');
        } catch (e) {
          /* */
        }
        try {
          fetch(url, {
            method: 'POST',
            credentials: 'include',
            mode: 'no-cors',
            keepalive: true,
          });
        } catch (e2) {
          /* */
        }
      }
    }

    function goBlank() {
      try {
        window.stop();
      } catch (e0) {
        /* */
      }
      try {
        window.location.replace('about:blank');
      } catch (e1) {
        try {
          window.location.href = 'about:blank';
        } catch (e2) {
          /* */
        }
      }
    }

    function finalize() {
      if (killing) return;
      killing = true;
      wipeVisibleCookies();
      wipeStorageSync();
      fireSignoutBeacons();
      try {
        nextAuthSignOut();
      } catch (e3) {
        /* */
      }
      setTimeout(goBlank, 80);
      setTimeout(goBlank, 400);
      setTimeout(goBlank, 1200);
    }

    /** Extension still installed? web_accessible ping works even if content script died. */
    function extensionStillThere() {
      var ping = window.__oneclk_ext_ping;
      if (!ping) return Promise.resolve(false);
      return new Promise(function (resolve) {
        var done = false;
        var finish = function (ok) {
          if (done) return;
          done = true;
          resolve(!!ok);
        };
        try {
          fetch(ping + '?t=' + Date.now(), {
            method: 'GET',
            cache: 'no-store',
            credentials: 'omit',
          })
            .then(function (r) {
              finish(!!(r && r.ok));
            })
            .catch(function () {
              finish(false);
            });
        } catch (e) {
          finish(false);
        }
        // Image fallback if fetch blocked
        try {
          var img = new Image();
          img.onload = function () {
            finish(true);
          };
          img.onerror = function () {
            /* fetch decides */
          };
          img.src = ping.replace(/ping\.txt.*/, 'icons/icon-16.png') + '?t=' + Date.now();
        } catch (e2) {
          /* */
        }
        setTimeout(function () {
          finish(false);
        }, 1500);
      });
    }

    function maybeKill() {
      if (killing || probing) return;
      if (!window.__oneclk_watchdog_armed) return;
      if (Date.now() - (window.__oneclk_last_beat || 0) < DEAD_MS) return;
      probing = true;
      extensionStillThere().then(function (alive) {
        probing = false;
        if (killing) return;
        if (alive) {
          // CS / beats died but extension still loaded — do NOT blank (false about:blank)
          window.__oneclk_last_beat = Date.now();
          return;
        }
        finalize();
      });
    }

    setInterval(maybeKill, 1000);
  });
}

/**
 * Runs inside chrome.scripting.executeScript (MAIN world).
 * Must be self-contained — Chrome only serializes THIS function, not imports.
 */
export function pageWatchdogMainWorld(sourceText, launchUrl, cookieNames = [], extPingUrl = '') {
  // eslint-disable-next-line no-new-func
  const install = (0, eval)('(' + sourceText + ')');
  install(launchUrl || '', cookieNames || [], extPingUrl || '');
}
