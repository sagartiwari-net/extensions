export const INJECT_STRATEGIES = [
  'cookies',
  'storage_reload',
  'idb',
  'dnr_headers',
  'custom',
] as const;

export type InjectStrategy = (typeof INJECT_STRATEGIES)[number];

export const COOKIE_FORMATS = [
  'cookies',
  'localStorage',
  'sessionStorage',
  'indexedDB',
] as const;

export type CookieFormat = (typeof COOKIE_FORMATS)[number];