/** ToolsMandi production friend pack — packager may override from reseller brand. */
export const CLIENT_CONFIG = {
  SLUG: 'toolsmandi',
  RESELLER_SLUG: 'toolsmandi',
  NAME: 'ToolsMandi Access',
  API_BASE: 'https://panel.1clkaccess.store/api',
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
  INDICATOR_ID: 'oneclk-v2-toolsmandi',
};
