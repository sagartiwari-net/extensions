/** Friend / reseller build example — copy & edit per client. */
export const CLIENT_CONFIG = {
  SLUG: 'toolsmandi',
  RESELLER_SLUG: 'toolsmandi',
  NAME: 'ToolsMandi Access',
  API_BASE: 'https://api.example.com/api',
  MEMBER_MATCHES: [
    'https://toolsmember.example.com/*',
    'https://*.toolsmember.example.com/*',
  ],
  /** Admin /launch handoff — must match ADMIN_ORIGIN in prod */
  BRIDGE_MATCHES: ['https://admin.example.com/*'],
  MEMBERSHIP_HOME: 'https://toolsmember.example.com/',
  EXTERNALLY_CONNECTABLE: [
    'https://admin.example.com/*',
    'https://toolsmember.example.com/*',
  ],
  INDICATOR_ID: 'oneclk-v2-toolsmandi',
};
