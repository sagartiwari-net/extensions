/**
 * Unpacked local debug build — talks to production panel/API so Jasper vault works,
 * but skips integrity block and logs heavily. Load via chrome://extensions → Load unpacked.
 */
export const CLIENT_CONFIG = {
  SLUG: 'toolsmandi',
  RESELLER_SLUG: 'toolsmandi',
  NAME: 'ToolsMandi DEBUG (local)',
  DESCRIPTION: 'Local unpacked debug — verbose page_no / IDB logs',
  API_BASE: 'https://api.1clkaccess.store/api',
  MEMBER_MATCHES: [
    'https://toolsmandi.com/*',
    'https://*.toolsmandi.com/*',
  ],
  BRIDGE_MATCHES: ['https://panel.1clkaccess.store/*'],
  MEMBERSHIP_HOME: 'https://toolsmandi.com/member',
  EXTERNALLY_CONNECTABLE: [
    'https://panel.1clkaccess.store/*',
    'https://toolsmandi.com/*',
    'https://*.toolsmandi.com/*',
  ],
  // Same prefix as prod so launch page detects the pack; DEBUG name still shows in UI
  INDICATOR_ID: 'oneclk-v2-toolsmandi',
  /** Local unpacked: never block launch on hash mismatch vs server ZIP */
  DEBUG: true,
  DEBUG_SKIP_INTEGRITY: true,
};
