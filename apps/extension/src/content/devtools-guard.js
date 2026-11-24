/**
 * Page-side DevTools guard — always on for http(s) pages.
 * Docked size delta + F12 / Ctrl+Shift+I + console trap.
 */
import { CLIENT_CONFIG } from '../config.gen.js';

(function devtoolsGuard() {
  if (CLIENT_CONFIG.DEBUG || CLIENT_CONFIG.DEBUG_SKIP_INTEGRITY) return;
  if (window.__oneclk_devtools_guard) return;
  window.__oneclk_devtools_guard = true;

  const CHECK_MS = 450;
  const DIM_THRESHOLD = 80;

  let reported = false;

  function extensionAlive() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  function notify(detectionType) {
    if (reported || !extensionAlive()) return;
    reported = true;
    try {
      chrome.runtime.sendMessage(
        {
          type: 'DEVTOOLS_DETECTED',
          detection_type: detectionType,
          page_url: location.href,
        },
        () => {
          void chrome.runtime.lastError;
        },
      );
    } catch {
      /* */
    }
  }

  function isDevtoolsShortcut(ev) {
    const k = (ev.key || '').toLowerCase();
    if (k === 'f12' || ev.keyCode === 123) return true;
    if (ev.ctrlKey && ev.shiftKey && ['i', 'j', 'c', 'k'].includes(k)) return true;
    if (ev.metaKey && ev.altKey && ['i', 'j', 'c'].includes(k)) return true;
    return false;
  }

  function onKey(ev) {
    if (isDevtoolsShortcut(ev)) {
      ev.preventDefault();
      ev.stopPropagation();
      notify('keyboard_shortcut');
    }
  }

  function onContext(ev) {
    ev.preventDefault();
    ev.stopPropagation();
  }

  function checkDocked() {
    if (reported) return;
    const w = window.outerWidth - window.innerWidth;
    const h = window.outerHeight - window.innerHeight;
    if (w > DIM_THRESHOLD || h > DIM_THRESHOLD) {
      notify('docked_devtools');
    }
  }

  function startConsoleTrap() {
    try {
      const bait = new Image();
      let trips = 0;
      Object.defineProperty(bait, 'id', {
        get() {
          trips += 1;
          if (trips >= 2) notify('console_trap');
        },
      });
      setInterval(() => {
        if (reported || !extensionAlive()) return;
        try {
          console.log('%c', bait);
          console.clear();
        } catch {
          /* */
        }
      }, 1100);
    } catch {
      /* */
    }
  }

  window.addEventListener('keydown', onKey, true);
  window.addEventListener('contextmenu', onContext, true);
  setInterval(checkDocked, CHECK_MS);
  checkDocked();
  startConsoleTrap();
})();
