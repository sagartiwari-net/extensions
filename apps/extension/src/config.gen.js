export const CLIENT_CONFIG = {
  "SLUG": "dev",
  "RESELLER_SLUG": "toolsmandi",
  "NAME": "1Clk Dev",
  "API_BASE": "http://127.0.0.1:4000/api",
  "MEMBER_MATCHES": [
    "http://127.0.0.1/*",
    "http://localhost/*"
  ],
  "BRIDGE_MATCHES": [
    "http://127.0.0.1:3000/*",
    "http://localhost:3000/*"
  ],
  "MEMBERSHIP_HOME": "http://127.0.0.1:3000/",
  "EXTERNALLY_CONNECTABLE": [
    "http://127.0.0.1/*",
    "http://localhost/*"
  ],
  "INDICATOR_ID": "oneclk-v2-installed",
  "INTEGRITY_FILES": [
    "manifest.json",
    "background.js",
    "popup/popup.html",
    "popup/popup.js",
    "content/member.js",
    "content/guard.js",
    "icons/icon-16.png",
    "icons/icon-48.png",
    "icons/icon-128.png"
  ]
};
