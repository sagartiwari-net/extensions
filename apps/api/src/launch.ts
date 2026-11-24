import { randomBytes } from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { decryptCookieData } from '@oneclk/crypto';
import { pool } from './db.js';
import { env } from './env.js';
import { loadLaunchRules } from './launch-rules.js';
import { parseBrandSettings } from './lib/extension-packager.js';
import { hasCookieJarModeColumn } from './lib/schema-flags.js';
import { normalizeVault, vaultLooksUsable } from './lib/vault-normalize.js';

/** Flatten DigitaVision / Cookie-Editor vault shapes for launch. */
export function normalizeSession(raw: unknown): Record<string, unknown> {
  return normalizeVault(raw).raw;
}

export async function createLaunchToken(input: {
  resellerId: number;
  toolId: number;
  source: 'amember' | 'admin_access' | 'other';
  payload?: Record<string, unknown> | null;
}): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + env.tokenTtlSeconds * 1000);
  await pool.query<ResultSetHeader>(
    `INSERT INTO session_tokens (token, reseller_id, tool_id, source, payload, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      token,
      input.resellerId,
      input.toolId,
      input.source,
      input.payload ? JSON.stringify(input.payload) : null,
      expires,
    ],
  );
  return token;
}

type TokenJoin = RowDataPacket & {
  token_id: number;
  reseller_id: number;
  tool_id: number;
  expires_at: Date;
  consumed_at: Date | null;
  payload: unknown;
  reseller_slug: string;
  tool_key: string;
  name: string;
  web_url: string;
  status: string;
  inject_strategy: string;
  cookie_jar_mode: string | null;
  cookie_payload: string | null;
  cookie_password: string | null;
  cookie_formats: unknown;
  pool_id: number | null;
  pool_payload: string | null;
  pool_password: string | null;
  security_tier: number;
  proxy_enabled: number;
  proxy_profile_id: number | null;
  user_agent_profile_id: number | null;
  custom_user_agent: string | null;
  proxy_host: string | null;
  proxy_port: number | null;
  proxy_scheme: string | null;
  proxy_username: string | null;
  proxy_password: string | null;
  ua_string: string | null;
};

/** Public bridge UI only — does not consume the one-time token */
export async function peekLaunchToken(token: string): Promise<{
  username: string | null;
  product_id: string | null;
  client: string;
  site: string;
  tool_name: string;
  tool_key: string;
  expires_in: number;
}> {
  const [rows] = await pool.query<
    (RowDataPacket & {
      expires_at: Date;
      consumed_at: Date | null;
      payload: unknown;
      reseller_slug: string;
      reseller_name: string;
      reseller_settings: unknown;
      tool_name: string;
      tool_key: string;
    })[]
  >(
    `SELECT st.expires_at, st.consumed_at, st.payload,
            r.slug AS reseller_slug, r.name AS reseller_name, r.settings AS reseller_settings,
            t.name AS tool_name, t.tool_key
     FROM session_tokens st
     JOIN resellers r ON r.id = st.reseller_id
     JOIN tools t ON t.id = st.tool_id AND t.reseller_id = st.reseller_id
     WHERE st.token = ?
     LIMIT 1`,
    [token],
  );
  const row = rows[0];
  if (!row) {
    const err = new Error('Invalid token') as Error & { statusCode: number };
    err.statusCode = 404;
    throw err;
  }
  if (row.consumed_at) {
    const err = new Error('Token already used') as Error & { statusCode: number };
    err.statusCode = 410;
    throw err;
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    const err = new Error('Token expired') as Error & { statusCode: number };
    err.statusCode = 410;
    throw err;
  }

  let meta: Record<string, unknown> = {};
  if (row.payload) {
    try {
      meta =
        typeof row.payload === 'string'
          ? JSON.parse(row.payload)
          : (row.payload as Record<string, unknown>);
    } catch {
      meta = {};
    }
  }

  const brand = parseBrandSettings(row.reseller_settings, row.reseller_slug, row.reseller_name);
  const site = brand.name || row.reseller_name || row.reseller_slug;

  return {
    username: typeof meta.username === 'string' ? meta.username : null,
    product_id: typeof meta.product_id === 'string' ? meta.product_id : null,
    client: row.reseller_slug,
    site,
    tool_name: row.tool_name,
    tool_key: row.tool_key,
    expires_in: Math.max(0, Math.floor((new Date(row.expires_at).getTime() - Date.now()) / 1000)),
  };
}

export async function consumeSessionToken(token: string) {
  const jarCol = (await hasCookieJarModeColumn()) ? ', t.cookie_jar_mode' : '';
  const [rows] = await pool.query<TokenJoin[]>(
    `SELECT st.id AS token_id, st.reseller_id, st.tool_id, st.expires_at, st.consumed_at, st.payload,
            r.slug AS reseller_slug,
            t.tool_key, t.name, t.web_url, t.status, t.inject_strategy${jarCol}, t.security_tier,
            t.cookie_payload, t.cookie_password, t.cookie_formats, t.pool_id,
            t.proxy_enabled, t.proxy_profile_id, t.user_agent_profile_id, t.custom_user_agent,
            p.cookie_payload AS pool_payload, p.cookie_password AS pool_password,
            px.host AS proxy_host, px.port AS proxy_port, px.scheme AS proxy_scheme,
            px.username AS proxy_username, px.password AS proxy_password,
            ua.user_agent AS ua_string
     FROM session_tokens st
     JOIN resellers r ON r.id = st.reseller_id
     JOIN tools t ON t.id = st.tool_id AND t.reseller_id = st.reseller_id
     LEFT JOIN cookie_sync_pools p ON p.id = t.pool_id
     LEFT JOIN proxy_profiles px ON px.id = t.proxy_profile_id
     LEFT JOIN user_agent_profiles ua ON ua.id = t.user_agent_profile_id
     WHERE st.token = ?
     LIMIT 1`,
    [token],
  );
  const row = rows[0];
  if (!row) {
    const err = new Error('Invalid token') as Error & { statusCode: number };
    err.statusCode = 404;
    throw err;
  }
  if (row.consumed_at) {
    const err = new Error('Token already used') as Error & { statusCode: number };
    err.statusCode = 410;
    throw err;
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    const err = new Error('Token expired') as Error & { statusCode: number };
    err.statusCode = 410;
    throw err;
  }
  if (row.status === 'disabled') {
    const err = new Error('Tool disabled') as Error & { statusCode: number };
    err.statusCode = 400;
    throw err;
  }

  // Decrypt vault BEFORE claiming — empty/bad cookie must not burn the one-time token
  const cipher = row.pool_id ? row.pool_payload : row.cookie_payload;
  const password = row.pool_id ? row.pool_password : row.cookie_password;
  if (!cipher || !password) {
    const err = new Error('No cookie data for tool') as Error & { statusCode: number };
    err.statusCode = 400;
    throw err;
  }

  let session: Record<string, unknown>;
  try {
    const plain = decryptCookieData(cipher, password);
    const vault = normalizeVault(JSON.parse(plain) as unknown);
    if (!vaultLooksUsable(vault)) {
      const err = new Error(
        'Session vault empty (need cookies, localStorage, sessionStorage, or indexedDB) — re-save Jasper/Quillbot vault from admin',
      ) as Error & { statusCode: number };
      err.statusCode = 400;
      throw err;
    }
    session = vault.raw;
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode === 400) throw err;
    const e = new Error('Cookie decrypt failed') as Error & { statusCode: number };
    e.statusCode = 500;
    throw e;
  }

  // Atomic claim — only after vault is ready + usable
  const [claim] = await pool.query<ResultSetHeader>(
    `UPDATE session_tokens SET consumed_at = NOW()
     WHERE id = ? AND consumed_at IS NULL AND expires_at > NOW()`,
    [row.token_id],
  );
  if (!claim.affectedRows) {
    const err = new Error('Token already used or expired') as Error & { statusCode: number };
    err.statusCode = 410;
    throw err;
  }

  const proxy =
    row.proxy_enabled && row.proxy_host
      ? {
          scheme: row.proxy_scheme || 'http',
          host: row.proxy_host,
          port: row.proxy_port,
          username: row.proxy_username,
          password: row.proxy_password,
        }
      : null;

  const rules = await loadLaunchRules(row.reseller_id);

  let meta: Record<string, unknown> = {};
  if (row.payload) {
    try {
      meta = typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload as Record<string, unknown>);
    } catch {
      meta = {};
    }
  }

  return {
    reseller_id: row.reseller_id,
    reseller_slug: row.reseller_slug,
    tool_id: row.tool_id,
    tool_key: row.tool_key,
    tool_name: row.name,
    web_url: row.web_url,
    inject_strategy: row.inject_strategy,
    cookie_jar_mode: row.cookie_jar_mode || 'auto',
    security_tier: row.security_tier,
    cookie_formats: row.cookie_formats,
    proxy,
    user_agent: row.custom_user_agent || row.ua_string || null,
    rules,
    session,
    username: typeof meta.username === 'string' ? meta.username : null,
    product_id: typeof meta.product_id === 'string' ? meta.product_id : null,
    client_ip: typeof meta.client_ip === 'string' ? meta.client_ip : null,
  };
}