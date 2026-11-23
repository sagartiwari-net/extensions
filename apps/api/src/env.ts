import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
config({ path: resolve(root, '.env') });
config({ path: resolve(root, '.env.example') });

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProd = nodeEnv === 'production';

const sessionSecret = req('SESSION_SECRET', 'change-me-local-session-secret-32chars');
const cookieCryptoFallback = process.env.COOKIE_CRYPTO_FALLBACK_KEY ?? 'change-me-local-aes-fallback-key!!';

if (isProd) {
  const weak = [
    'change-me',
    'oneclk_pass',
    'admin123',
    'local-session',
    'local-aes',
  ];
  if (sessionSecret.length < 32 || weak.some((w) => sessionSecret.includes(w))) {
    throw new Error('SESSION_SECRET must be a strong unique value (≥32 chars) in production');
  }
  if (weak.some((w) => cookieCryptoFallback.includes(w))) {
    throw new Error('COOKIE_CRYPTO_FALLBACK_KEY must be changed for production');
  }
}

/** Comma-separated origins allowed for CORS (admin + optional extras). */
const corsOrigins = (process.env.CORS_ORIGINS ?? process.env.ADMIN_ORIGIN ?? 'http://127.0.0.1:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const env = {
  nodeEnv,
  isProd,
  host: process.env.API_HOST ?? '0.0.0.0',
  port: Number(process.env.API_PORT ?? 4000),
  databaseUrl: req('DATABASE_URL', 'mysql://oneclk:oneclk_pass@127.0.0.1:3307/oneclk_v2'),
  redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  sessionSecret,
  cookieSecure: process.env.COOKIE_SECURE === 'true' || isProd,
  /** lax (default) | none — use none+secure when admin and API are different sites */
  cookieSameSite: (process.env.COOKIE_SAMESITE === 'none' ? 'none' : 'lax') as 'lax' | 'none',
  corsOrigins,
  adminOrigin: process.env.ADMIN_ORIGIN ?? corsOrigins[0] ?? 'http://127.0.0.1:3000',
  tokenTtlSeconds: Number(process.env.TOKEN_TTL_SECONDS ?? 60),
  seedMasterUser: process.env.SEED_MASTER_USER ?? 'admin',
  seedMasterPassword: process.env.SEED_MASTER_PASSWORD ?? 'admin123',
  schemaPath: resolve(root, 'docs/schema-v1.sql'),
  trustProxy: process.env.TRUST_PROXY === 'true' || isProd,
  /** Public API base baked into reseller extension builds (include /api). */
  extensionApiBase: (() => {
    const v =
      process.env.EXTENSION_API_BASE ??
      (isProd ? '' : `http://127.0.0.1:${Number(process.env.API_PORT ?? 4000)}/api`);
    if (isProd && (!v || v.includes('127.0.0.1') || v.includes('localhost'))) {
      throw new Error(
        'EXTENSION_API_BASE must be set to the public API URL (…/api) in production',
      );
    }
    return v;
  })(),
  extensionSourcePath:
    process.env.EXTENSION_SOURCE_PATH ?? resolve(root, 'apps/extension'),
  uploadsDir: process.env.UPLOADS_DIR ?? resolve(root, 'apps/api/uploads'),
  // Panel ZIP: obfuscate unless explicitly EXTENSION_BUILD_OBFUSCATE=false
  extensionBuildObfuscate: process.env.EXTENSION_BUILD_OBFUSCATE !== 'false',
  /**
   * Extra origins baked into extension externally_connectable (comma-separated).
   * Not editable by resellers — system-controlled with ADMIN_ORIGIN / CORS_ORIGINS.
   */
  extensionConnectableOrigins: (process.env.EXTENSION_CONNECTABLE_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};
