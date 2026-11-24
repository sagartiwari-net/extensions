/**
 * Normalize Cookie-Editor / DigitaVision vault pastes into a single shape.
 *
 * Accepted inputs:
 * - bare cookie array: [{ domain, name, value, ... }, ...]
 * - object with cookies + optional referer / localStorage / sessionStorage / indexedDB
 * - DigitaVision-style { includedFormats, referer, cookies|indexedDB|... }
 */

export type NormalizedVault = {
  cookies: unknown[];
  localStorage: Record<string, unknown>;
  sessionStorage: Record<string, unknown>;
  indexedDB: Record<string, unknown> | null;
  referer: string | null;
  includedFormats: string[];
  raw: Record<string, unknown>;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function nonEmptyObject(v: unknown): Record<string, unknown> | null {
  const o = asRecord(v);
  if (!o) return null;
  return Object.keys(o).length > 0 ? o : null;
}

export function normalizeVault(raw: unknown, refererOverride?: string | null): NormalizedVault {
  if (Array.isArray(raw)) {
    const referer = refererOverride?.trim() || null;
    return {
      cookies: raw,
      localStorage: {},
      sessionStorage: {},
      indexedDB: null,
      referer,
      includedFormats: ['cookies'],
      raw: {
        cookies: raw,
        localStorage: {},
        sessionStorage: {},
        ...(referer ? { referer } : {}),
        includedFormats: ['cookies'],
      },
    };
  }

  if (!raw || typeof raw !== 'object') {
    return {
      cookies: [],
      localStorage: {},
      sessionStorage: {},
      indexedDB: null,
      referer: refererOverride?.trim() || null,
      includedFormats: [],
      raw: {},
    };
  }

  const obj = raw as Record<string, unknown>;
  const nested = asRecord(obj.storage) || {};

  const cookiesRaw = obj.cookies ?? obj.Cookies ?? [];
  const cookies = Array.isArray(cookiesRaw) ? cookiesRaw : [];

  const localStorage =
    nonEmptyObject(obj.localStorage) ||
    nonEmptyObject(obj.LocalStorage) ||
    nonEmptyObject(nested.localStorage) ||
    nonEmptyObject(nested.LocalStorage) ||
    {};

  const sessionStorage =
    nonEmptyObject(obj.sessionStorage) ||
    nonEmptyObject(obj.SessionStorage) ||
    nonEmptyObject(nested.sessionStorage) ||
    nonEmptyObject(nested.SessionStorage) ||
    {};

  let indexedDB =
    nonEmptyObject(obj.indexedDB) ||
    nonEmptyObject(obj.IndexedDB) ||
    nonEmptyObject(obj.indexed_db) ||
    nonEmptyObject(nested.indexedDB) ||
    nonEmptyObject(nested.indexed_db) ||
    null;
  // DigitaVision sometimes stores indexedDB as a JSON string
  if (!indexedDB && typeof obj.indexedDB === 'string') {
    try {
      indexedDB = nonEmptyObject(JSON.parse(obj.indexedDB as string));
    } catch {
      /* */
    }
  }
  if (!indexedDB && typeof obj.indexed_db === 'string') {
    try {
      indexedDB = nonEmptyObject(JSON.parse(obj.indexed_db as string));
    } catch {
      /* */
    }
  }

  const refererFromPaste =
    typeof obj.referer === 'string'
      ? obj.referer.trim()
      : typeof obj.referrer === 'string'
        ? obj.referrer.trim()
        : '';
  const referer = (refererOverride?.trim() || refererFromPaste || null) as string | null;

  const formatsFromPaste = Array.isArray(obj.includedFormats)
    ? (obj.includedFormats as unknown[]).filter((f): f is string => typeof f === 'string')
    : [];
  const includedFormats = formatsFromPaste.length
    ? formatsFromPaste
    : [
        ...(cookies.length ? ['cookies'] : []),
        ...(Object.keys(localStorage).length ? ['localStorage'] : []),
        ...(Object.keys(sessionStorage).length ? ['sessionStorage'] : []),
        ...(indexedDB ? ['indexedDB'] : []),
      ];

  const rawOut: Record<string, unknown> = {
    ...obj,
    cookies,
    localStorage,
    sessionStorage,
    includedFormats,
  };
  if (indexedDB) rawOut.indexedDB = indexedDB;
  else delete rawOut.indexedDB;
  if (referer) rawOut.referer = referer;

  return {
    cookies,
    localStorage,
    sessionStorage,
    indexedDB,
    referer,
    includedFormats,
    raw: rawOut,
  };
}

export function vaultLooksUsable(v: NormalizedVault): boolean {
  if (v.cookies.length > 0) return true;
  if (Object.keys(v.localStorage).length > 0) return true;
  if (Object.keys(v.sessionStorage).length > 0) return true;
  if (v.indexedDB && Object.keys(v.indexedDB).length > 0) return true;
  return false;
}

/**
 * Label only — extension ignores this and injects whatever is in the vault.
 * Prefer idb when present, else storage_reload if LS/SS, else cookies.
 */
export function injectStrategyFromVault(
  v: NormalizedVault,
): 'cookies' | 'storage_reload' | 'idb' {
  if (v.indexedDB && Object.keys(v.indexedDB).length > 0) return 'idb';
  if (Object.keys(v.localStorage).length > 0 || Object.keys(v.sessionStorage).length > 0) {
    return 'storage_reload';
  }
  return 'cookies';
}

/** Parse paste text → normalized JSON string ready to encrypt. */
export function normalizeVaultPlain(plain: string, refererOverride?: string | null): string {
  const trimmed = plain.trim();
  if (!trimmed) return trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
  const norm = normalizeVault(parsed, refererOverride);
  return JSON.stringify(norm.raw);
}
