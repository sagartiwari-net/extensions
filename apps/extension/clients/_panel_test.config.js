export const CLIENT_CONFIG = {
  SLUG: 'toolsmandi',
  RESELLER_SLUG: 'toolsmandi',
  NAME: 'ToolsMandi Access',
  DESCRIPTION: 'Member tools launcher',
  API_BASE: 'https://panel.1clkaccess.store/api', // not api.1clkaccess.store — that host has no DNS
  MEMBER_MATCHES: ['https://toolsmandi.com/*', 'https://*.toolsmandi.com/*'],
  BRIDGE_MATCHES: ['https://panel.1clkaccess.store/*'],
  MEMBERSHIP_HOME: 'https://toolsmandi.com/member',
  EXTERNALLY_CONNECTABLE: ['https://panel.1clkaccess.store/*', 'https://toolsmandi.com/*'],
  INDICATOR_ID: 'oneclk-v2-toolsmandi',
};
