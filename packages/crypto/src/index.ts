import { gunzipSync, gzipSync } from 'node:zlib';
import CryptoJS from 'crypto-js';

/**
 * Wire format (AES ciphertext, CryptoJS OpenSSL-compatible U2FsdGVkX1…):
 *
 *   v2 (new): AES( "OC1Z:" + base64(gzip(minified JSON)) )
 *   v1 (legacy): AES( raw JSON string )
 *
 * Decrypt accepts both. Encrypt always writes v2 (compress → encrypt).
 */
export const COOKIE_VAULT_MAGIC = 'OC1Z:';
const COMPRESS_MAGIC = COOKIE_VAULT_MAGIC;

/**
 * Strip JSON whitespace before compress — smaller ciphertext, same data.
 * Cookie-Editor often exports a bare array — wrap as { cookies: [...] }.
 */
function minifyCookiePlain(plain: string): string {
  const trimmed = plain.trim();
  if (!trimmed) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return JSON.stringify({ cookies: parsed, localStorage: {}, sessionStorage: {} });
    }
    return JSON.stringify(parsed);
  } catch {
    return trimmed;
  }
}

/**
 * Compress + AES encrypt cookie vault for storage / transfer.
 * Smaller than AES-only; still decryptable with the same password.
 */
export function encryptCookieData(plain: string, password: string): string {
  const normalized = minifyCookiePlain(plain);
  const compressed = gzipSync(Buffer.from(normalized, 'utf8'), { level: 9 });
  const wrapped = COMPRESS_MAGIC + compressed.toString('base64');
  return CryptoJS.AES.encrypt(wrapped, password).toString();
}

/**
 * AES decrypt, then gunzip if v2 magic present; otherwise return legacy plain JSON.
 */
export function decryptCookieData(ciphertext: string, password: string): string {
  const bytes = CryptoJS.AES.decrypt(ciphertext, password);
  const plain = bytes.toString(CryptoJS.enc.Utf8);
  if (!plain) throw new Error('Decrypt failed');

  if (plain.startsWith(COMPRESS_MAGIC)) {
    try {
      const gz = Buffer.from(plain.slice(COMPRESS_MAGIC.length), 'base64');
      return gunzipSync(gz).toString('utf8');
    } catch {
      throw new Error('Decrypt failed (decompress)');
    }
  }

  return plain;
}

/** @deprecated alias — same as encryptCookieData (compress + AES). */
export function sealCookiePayload(plain: string, password: string): string {
  return encryptCookieData(plain, password);
}

/** @deprecated alias — same as decryptCookieData. */
export function openCookiePayload(ciphertext: string, password: string): string {
  return decryptCookieData(ciphertext, password);
}

/**
 * Size stats for admin/debug — does not change stored format.
 * ratio < 1 means smaller than raw plain.
 */
export function cookiePayloadStats(plain: string, password: string) {
  const raw = Buffer.byteLength(plain, 'utf8');
  const legacy = CryptoJS.AES.encrypt(plain, password).toString().length;
  const sealed = encryptCookieData(plain, password);
  return {
    plainBytes: raw,
    legacyCipherChars: legacy,
    sealedCipherChars: sealed.length,
    ratioVsPlain: sealed.length / Math.max(raw, 1),
    ratioVsLegacyAes: sealed.length / Math.max(legacy, 1),
  };
}

export function sha256Hex(input: string): string {
  return CryptoJS.SHA256(input).toString(CryptoJS.enc.Hex);
}

/** True if ciphertext already uses compress+AES (v2) inner payload. */
export function isCookieVaultV2(ciphertext: string, password: string): boolean {
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, password);
    const plain = bytes.toString(CryptoJS.enc.Utf8);
    return !!plain && plain.startsWith(COMPRESS_MAGIC);
  } catch {
    return false;
  }
}

/**
 * Decrypt (v1 or v2) → re-encrypt as v2. Returns null if password/cipher invalid.
 * Use for one-shot DB migration of legacy AES-only rows.
 */
export function resealCookiePayload(
  ciphertext: string,
  password: string,
): { cipher: string; plainBytes: number; beforeChars: number; afterChars: number; skipped: boolean } | null {
  try {
    const beforeChars = ciphertext.length;
    if (isCookieVaultV2(ciphertext, password)) {
      return {
        cipher: ciphertext,
        plainBytes: 0,
        beforeChars,
        afterChars: beforeChars,
        skipped: true,
      };
    }
    const plain = decryptCookieData(ciphertext, password);
    const cipher = encryptCookieData(plain, password);
    return {
      cipher,
      plainBytes: Buffer.byteLength(plain, 'utf8'),
      beforeChars,
      afterChars: cipher.length,
      skipped: false,
    };
  } catch {
    return null;
  }
}
