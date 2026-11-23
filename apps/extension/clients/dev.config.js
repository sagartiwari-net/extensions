export const CLIENT_CONFIG = {
  SLUG: 'dev',
  /** Rules/owner reseller when build slug ≠ DB reseller slug */
  RESELLER_SLUG: 'toolsmandi',
  NAME: '1Clk Dev',
  API_BASE: 'http://127.0.0.1:4000/api',
  MEMBER_MATCHES: ['http://127.0.0.1/*', 'http://localhost/*'],
  /** Admin /launch handoff */
  BRIDGE_MATCHES: ['http://127.0.0.1:3000/*', 'http://localhost:3000/*'],
  /** Kept open + cookie-safe on DevTools kill */
  MEMBERSHIP_HOME: 'http://127.0.0.1:3000/',
  EXTERNALLY_CONNECTABLE: ['http://127.0.0.1/*', 'http://localhost/*'],
  INDICATOR_ID: 'oneclk-v2-installed',
};