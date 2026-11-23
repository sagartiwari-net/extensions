/**
 * Copy encrypted cookie_data (+ password) from oneclk_old_src.tools → oneclk_v2.tools.
 * Matches by reseller slug (tenant) + tool name (case-insensitive).
 *
 * Usage: npm run db:import-cookies -w @oneclk/api
 */
import mysql from 'mysql2/promise';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { decryptCookieData, sha256Hex } from '@oneclk/crypto';
import { pool } from '../db.js';
import { env } from '../env.js';

const OLD_DB = 'oneclk_old_src';

function storageBag(obj: unknown): Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  if (Object.keys(o).length > 0) return o;
  return null;
}

function hasUsableSession(plain: string): boolean {
  try {
    const j = JSON.parse(plain) as Record<string, unknown>;
    const cookies = (j.cookies || j.Cookies || []) as unknown[];
    if (Array.isArray(cookies) && cookies.length > 0) return true;
    const nested = (j.storage || {}) as Record<string, unknown>;
    const ls =
      storageBag(j.localStorage) ||
      storageBag(j.LocalStorage) ||
      storageBag(nested.localStorage) ||
      storageBag(nested.LocalStorage);
    const ss =
      storageBag(j.sessionStorage) ||
      storageBag(j.SessionStorage) ||
      storageBag(nested.sessionStorage) ||
      storageBag(nested.SessionStorage);
    if (ls || ss) return true;
    return false;
  } catch {
    return false;
  }
}

async function main() {
  const u = new URL(env.databaseUrl);
  const root = await mysql.createConnection({
    host: u.hostname,
    port: Number(u.port || 3306),
    user: 'root',
    password: process.env.MYSQL_ROOT_PASSWORD || 'oneclk_root',
  });

  const [tenants] = await root.query<RowDataPacket[]>(
    `SELECT id, slug FROM \`${OLD_DB}\`.tenants`,
  );
  const tenantSlug = new Map<number, string>(tenants.map((t) => [t.id as number, String(t.slug)]));

  const [resellers] = await pool.query<RowDataPacket[]>('SELECT id, slug FROM resellers');
  const slugToReseller = new Map<string, number>(resellers.map((r) => [String(r.slug), r.id as number]));

  const [oldTools] = await root.query<RowDataPacket[]>(
    `SELECT id, tenant_id, tool_name, web_url, cookie_type, password, cookie_data
     FROM \`${OLD_DB}\`.tools
     WHERE cookie_data IS NOT NULL AND cookie_data <> ''`,
  );

  let updated = 0;
  let skippedEmpty = 0;
  let skippedNoMatch = 0;
  let decryptFail = 0;

  for (const ot of oldTools) {
    const slug = tenantSlug.get(ot.tenant_id as number);
    if (!slug) {
      skippedNoMatch += 1;
      continue;
    }
    const resellerId = slugToReseller.get(slug);
    if (!resellerId) {
      skippedNoMatch += 1;
      continue;
    }

    let plain: string;
    try {
      plain = decryptCookieData(String(ot.cookie_data), String(ot.password));
    } catch {
      decryptFail += 1;
      continue;
    }
    if (!hasUsableSession(plain)) {
      skippedEmpty += 1;
      continue;
    }

    // Prefer same reseller + name; else any tool with same name still missing cookie
    const [matches] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM tools
       WHERE LOWER(name) = LOWER(?)
         AND (cookie_payload IS NULL OR cookie_payload = '')
       ORDER BY (reseller_id = ?) DESC, id ASC
       LIMIT 20`,
      [ot.tool_name, resellerId],
    );

    let targets = matches.map((m) => m.id as number);
    if (!targets.length) {
      let host = '';
      try {
        host = new URL(String(ot.web_url)).hostname.replace(/^www\./, '').toLowerCase();
      } catch {
        host = '';
      }
      if (host) {
        const [byUrl] = await pool.query<RowDataPacket[]>(
          `SELECT id FROM tools
           WHERE (cookie_payload IS NULL OR cookie_payload = '')
             AND (LOWER(web_url) LIKE ? OR LOWER(web_url) LIKE ?)
           ORDER BY (reseller_id = ?) DESC, id ASC
           LIMIT 5`,
          [`%://${host}/%`, `%://%.${host}/%`, resellerId],
        );
        targets = byUrl.map((m) => m.id as number);
      }
    }

    if (!targets.length) {
      skippedNoMatch += 1;
      continue;
    }

    const cipher = String(ot.cookie_data);
    const ctype = String(ot.cookie_type || '');
    const strategy =
      /local|session|all/i.test(ctype) ? 'storage_reload' : null;

    for (const targetId of targets) {
      await pool.query<ResultSetHeader>(
        `UPDATE tools
         SET cookie_payload = ?, cookie_password = ?, cookie_formats = ?
             ${strategy ? `, inject_strategy = '${strategy}'` : ''}
         WHERE id = ? AND (cookie_payload IS NULL OR cookie_payload = '')`,
        [
          cipher,
          String(ot.password),
          JSON.stringify({ source: 'old_import', sha256: sha256Hex(cipher), old_tool_id: ot.id }),
          targetId,
        ],
      );
      updated += 1;
    }
  }

  const [stats] = await pool.query<RowDataPacket[]>(
    `SELECT
       SUM(cookie_payload IS NOT NULL AND cookie_payload <> '') AS with_cookie,
       SUM(cookie_payload IS NULL OR cookie_payload = '') AS without_cookie,
       COUNT(*) AS total
     FROM tools`,
  );

  console.log({
    scanned: oldTools.length,
    updated,
    skippedEmpty,
    skippedNoMatch,
    decryptFail,
    toolsNow: stats[0],
  });

  await root.end();
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
