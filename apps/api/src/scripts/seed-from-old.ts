/**
 * Demo seed: map a subset of old/extensionsystem.sql → oneclk_v2.
 * Temporary for UI/dev — remove or replace when production migration is ready.
 *
 * Usage: npm run db:seed:old -w @oneclk/api
 */
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../db.js';
import { env } from '../env.js';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const DUMP = resolve(root, '../old/extensionsystem.sql');
const OLD_DB = 'oneclk_old_src';

const TABLES = [
  'tenants',
  'tools',
  'proxy_profiles',
  'user_agent_profiles',
  'rule_groups',
  'redirect_rules',
  'block_rules',
  'css_rules',
  'text_replacement_rules',
  'registered_extensions',
] as const;

function slugKey(name: string, id: number) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return `${base || 'tool'}-${id}`;
}

function mapStrategy(cookieType: string | null): 'cookies' | 'storage_reload' {
  if (!cookieType) return 'cookies';
  const t = cookieType.toLowerCase();
  if (t.includes('local') || t.includes('session') || t.includes('all')) return 'storage_reload';
  return 'cookies';
}

async function rootConn() {
  // parse DATABASE_URL → talk to same host as root
  const u = new URL(env.databaseUrl);
  return mysql.createConnection({
    host: u.hostname,
    port: Number(u.port || 3306),
    user: 'root',
    password: process.env.MYSQL_ROOT_PASSWORD || 'oneclk_root',
    multipleStatements: true,
  });
}

async function extractAndLoadOld(conn: mysql.Connection) {
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${OLD_DB}\``);
  await conn.query(`USE \`${OLD_DB}\``);

  // Drop target tables so re-run is clean
  for (const t of [...TABLES].reverse()) {
    await conn.query(`DROP TABLE IF EXISTS \`${t}\``);
  }

  console.log('Extracting tables from dump (streaming)…', DUMP);
  const rl = createInterface({ input: createReadStream(DUMP, { encoding: 'utf8' }), crlfDelay: Infinity });

  let current: string | null = null;
  let buf: string[] = [];
  let capturing = false;
  const wanted = new Set<string>(TABLES);

  async function flush() {
    if (!current || !buf.length) return;
    const sql = buf.join('\n');
    buf = [];
    try {
      await conn.query(sql);
      console.log('  loaded', current);
    } catch (err) {
      console.warn('  skip/warn', current, err instanceof Error ? err.message.slice(0, 120) : err);
    }
  }

  for await (const line of rl) {
    const create = line.match(/^CREATE TABLE `([^`]+)`/);
    if (create) {
      await flush();
      current = create[1];
      capturing = wanted.has(current);
      buf = capturing ? [line] : [];
      continue;
    }
    if (!capturing || !current) continue;

    // stop at next unlock/alter section markers that end table data in phpMyAdmin dumps
    if (
      line.startsWith('-- --------------------------------------------------------') ||
      line.startsWith('--') && line.includes('Table structure for table')
    ) {
      // keep going until we see CREATE for another table; structure lines for same table already passed
    }

    buf.push(line);

    // End of inserts for a table often followed by empty line then unlock — flush when we see
    // ALTER TABLE for THIS table completing, or when buffer gets huge after INSERT ends.
    if (line.startsWith('UNLOCK TABLES;') || line.startsWith('COMMIT;')) {
      await flush();
      capturing = false;
      current = null;
    }
  }
  await flush();
}

async function ensureMaster() {
  const [existing] = await pool.query<RowDataPacket[]>(
    'SELECT id FROM admin_users WHERE username = ? LIMIT 1',
    [env.seedMasterUser],
  );
  if (existing[0]) return existing[0].id as number;
  const hash = await bcrypt.hash(env.seedMasterPassword, 10);
  const [res] = await pool.query<ResultSetHeader>(
    `INSERT INTO admin_users (username, password_hash, role, reseller_id, is_active)
     VALUES (?, ?, 'master', NULL, 1)`,
    [env.seedMasterUser, hash],
  );
  return res.insertId;
}

async function main() {
  const root = await rootConn();
  try {
    await extractAndLoadOld(root);
  } finally {
    // keep connection for queries
  }

  console.log('Mapping into oneclk_v2…');
  await ensureMaster();

  // Clear demo-ish rows but keep master
  await pool.query('SET FOREIGN_KEY_CHECKS=0');
  for (const t of [
    'launch_events',
    'session_tokens',
    'cookie_sync_members',
    'cookie_sync_pools',
    'css_rules',
    'redirect_rules',
    'block_url_rules',
    'overlay_rules',
    'text_rules',
    'rule_groups',
    'extension_allow_entries',
    'extension_allow_policies',
    'extension_registrations',
    'tools',
    'proxy_profiles',
    'user_agent_profiles',
    'audit_logs',
    'admin_users',
    'resellers',
  ]) {
    if (t === 'admin_users') {
      await pool.query(`DELETE FROM admin_users WHERE role <> 'master'`);
      continue;
    }
    await pool.query(`TRUNCATE TABLE \`${t}\``);
  }
  await pool.query('SET FOREIGN_KEY_CHECKS=1');
  await ensureMaster();

  // Proxies / UA (global library)
  const [oldProxies] = await root.query<RowDataPacket[]>(
    `SELECT id, name, host, port, scheme, username, password, bypass_list, is_active
     FROM \`${OLD_DB}\`.proxy_profiles WHERE is_active = 1 LIMIT 50`,
  );
  const proxyMap = new Map<number, number>();
  for (const p of oldProxies) {
    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO proxy_profiles
        (owner_reseller_id, name, host, port, scheme, username, password, bypass_list, is_active)
       VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        p.name,
        p.host,
        p.port,
        p.scheme || 'http',
        p.username,
        p.password,
        p.bypass_list ? JSON.stringify(p.bypass_list) : null,
      ],
    );
    proxyMap.set(p.id, res.insertId);
  }
  console.log('proxies', proxyMap.size);

  const [oldUa] = await root.query<RowDataPacket[]>(
    `SELECT id, name, user_agent, is_active FROM \`${OLD_DB}\`.user_agent_profiles WHERE is_active = 1 LIMIT 50`,
  );
  const uaMap = new Map<number, number>();
  for (const u of oldUa) {
    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO user_agent_profiles (owner_reseller_id, name, user_agent, is_active)
       VALUES (NULL, ?, ?, 1)`,
      [u.name, u.user_agent],
    );
    uaMap.set(u.id, res.insertId);
  }
  console.log('user-agents', uaMap.size);

  // Resellers from tenants (skip pure master row? keep toolsmandi as reseller too)
  const [tenants] = await root.query<RowDataPacket[]>(
    `SELECT id, slug, display_name, is_active FROM \`${OLD_DB}\`.tenants WHERE is_active = 1 ORDER BY id LIMIT 20`,
  );
  const resellerMap = new Map<number, number>();
  for (const t of tenants) {
    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO resellers (slug, name, member_secret, is_active)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = VALUES(is_active)`,
      [t.slug, t.display_name, randomBytes(16).toString('hex'), t.is_active ? 1 : 0],
    );
    let id = res.insertId;
    if (!id) {
      const [found] = await pool.query<RowDataPacket[]>(
        'SELECT id FROM resellers WHERE slug = ? LIMIT 1',
        [t.slug],
      );
      id = found[0].id;
    }
    resellerMap.set(t.id, id);
  }
  console.log('resellers', resellerMap.size);

  // Tools — metadata only here; cookies via: npm run db:import-cookies
  // (first 80 tools)
  const [oldTools] = await root.query<RowDataPacket[]>(
    `SELECT id, tenant_id, tool_name, web_url, cookie_type, tool_status,
            proxy_enabled, proxy_profile_id, user_agent_profile_id, custom_user_agent,
            (cookie_data IS NOT NULL AND cookie_data <> '') AS has_cookie
     FROM \`${OLD_DB}\`.tools
     ORDER BY id
     LIMIT 80`,
  );
  const toolMap = new Map<number, number>();
  for (const t of oldTools) {
    const rid = resellerMap.get(t.tenant_id);
    if (!rid) continue;
    const toolKey = slugKey(t.tool_name, t.id);
    try {
      const [res] = await pool.query<ResultSetHeader>(
        `INSERT INTO tools
          (reseller_id, tool_key, name, web_url, status, inject_strategy,
           proxy_enabled, proxy_profile_id, user_agent_profile_id, custom_user_agent, security_tier)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          rid,
          toolKey,
          t.tool_name,
          t.web_url,
          t.tool_status || 'active',
          mapStrategy(t.cookie_type),
          t.proxy_enabled ? 1 : 0,
          t.proxy_profile_id ? proxyMap.get(t.proxy_profile_id) ?? null : null,
          t.user_agent_profile_id ? uaMap.get(t.user_agent_profile_id) ?? null : null,
          t.custom_user_agent,
        ],
      );
      toolMap.set(t.id, res.insertId);
    } catch (err) {
      console.warn('tool skip', t.tool_name, err instanceof Error ? err.message : err);
    }
  }
  console.log('tools', toolMap.size);

  // Rule groups + redirects + blocks for mapped resellers (no LIMIT — full dump)
  const groupMap = new Map<number, number>();
  const [oldGroups] = await root.query<RowDataPacket[]>(
    `SELECT * FROM \`${OLD_DB}\`.rule_groups ORDER BY id`,
  );
  for (const g of oldGroups) {
    const rid = resellerMap.get(g.tenant_id);
    if (!rid) continue;
    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO rule_groups (reseller_id, name, url_pattern, is_active) VALUES (?, ?, ?, ?)`,
      [rid, g.name, g.url_pattern, g.is_active ? 1 : 0],
    );
    groupMap.set(g.id, res.insertId);
  }
  console.log('rule_groups', groupMap.size);

  const [oldRedirects] = await root.query<RowDataPacket[]>(
    `SELECT * FROM \`${OLD_DB}\`.redirect_rules ORDER BY id`,
  );
  let redirectCount = 0;
  for (const r of oldRedirects) {
    const rid = resellerMap.get(r.tenant_id);
    if (!rid) continue;
    await pool.query(
      `INSERT INTO redirect_rules
        (reseller_id, group_id, source_url, destination_url, description, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        rid,
        r.group_id ? groupMap.get(r.group_id) ?? null : null,
        r.source_url,
        r.destination_url,
        r.description,
        r.is_active ? 1 : 0,
      ],
    );
    redirectCount++;
  }
  console.log('redirects', redirectCount);

  const [oldBlocks] = await root.query<RowDataPacket[]>(
    `SELECT * FROM \`${OLD_DB}\`.block_rules ORDER BY id`,
  );
  let blockCount = 0;
  for (const b of oldBlocks) {
    const rid = resellerMap.get(b.tenant_id);
    if (!rid) continue;
    await pool.query(
      `INSERT INTO block_url_rules
        (reseller_id, group_id, url_pattern, action, redirect_url, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        rid,
        b.group_id ? groupMap.get(b.group_id) ?? null : null,
        b.url_to_block,
        b.redirect_to ? 'redirect' : 'blank',
        b.redirect_to,
        b.is_active ? 1 : 0,
      ],
    );
    blockCount++;
  }
  console.log('blocks', blockCount);

  const [oldCss] = await root.query<RowDataPacket[]>(
    `SELECT c.*, g.tenant_id
     FROM \`${OLD_DB}\`.css_rules c
     JOIN \`${OLD_DB}\`.rule_groups g ON g.id = c.group_id
     ORDER BY c.id`,
  );
  let cssCount = 0;
  for (const c of oldCss) {
    const rid = resellerMap.get(c.tenant_id);
    const gid = c.group_id ? groupMap.get(c.group_id) : null;
    if (!rid || !gid) continue;
    const action =
      c.action === 'hide' || c.action === 'replace' || c.action === 'custom' ? c.action : 'hide';
    await pool.query(
      `INSERT INTO css_rules (reseller_id, group_id, selector, action, value, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [rid, gid, c.selector, action, c.value ?? null, c.is_active ? 1 : 0],
    );
    cssCount++;
  }
  console.log('css', cssCount);

  const [oldText] = await root.query<RowDataPacket[]>(
    `SELECT * FROM \`${OLD_DB}\`.text_replacement_rules ORDER BY id`,
  );
  let textCount = 0;
  for (const t of oldText) {
    const rid = resellerMap.get(t.tenant_id);
    if (!rid) continue;
    await pool.query(
      `INSERT INTO text_rules (reseller_id, group_id, find_text, replace_text, is_active)
       VALUES (?, ?, ?, ?, 1)`,
      [
        rid,
        t.group_id ? groupMap.get(t.group_id) ?? null : null,
        String(t.find_text).slice(0, 500),
        String(t.replace_text).slice(0, 500),
      ],
    );
    textCount++;
  }
  console.log('text_rules', textCount);

  // Extensions
  const [oldExt] = await root.query<RowDataPacket[]>(
    `SELECT * FROM \`${OLD_DB}\`.registered_extensions LIMIT 20`,
  );
  let extCount = 0;
  for (const e of oldExt) {
    const rid = resellerMap.get(e.tenant_id);
    if (!rid) continue;
    const hashes =
      typeof e.file_hashes === 'string'
        ? e.file_hashes
        : e.file_hashes
          ? JSON.stringify(e.file_hashes)
          : '{}';
    await pool.query(
      `INSERT INTO extension_registrations
        (reseller_id, client_slug, extension_id, file_hashes, secret, integrity_mode, is_active)
       VALUES (?, ?, ?, ?, ?, 'warn', ?)
       ON DUPLICATE KEY UPDATE
         extension_id = VALUES(extension_id),
         file_hashes = VALUES(file_hashes),
         is_active = VALUES(is_active)`,
      [
        rid,
        e.slug,
        e.extension_id,
        hashes,
        e.extension_secret || randomBytes(16).toString('hex'),
        e.status === 'blocked' ? 0 : 1,
      ],
    );
    extCount++;
  }
  console.log('extensions', extCount);

  // Synthetic launch rows from imported tools (access_logs dump is huge — skip full import)
  const [newTools] = await pool.query<RowDataPacket[]>(
    'SELECT id, reseller_id, name, inject_strategy FROM tools ORDER BY id LIMIT 40',
  );
  let launchCount = 0;
  for (const t of newTools) {
    await pool.query(
      `INSERT INTO launch_events
        (reseller_id, tool_id, success, reason, inject_strategy, duration_ms, extension_id)
       VALUES (?, ?, 1, ?, ?, ?, NULL)`,
      [
        t.reseller_id,
        t.id,
        `seeded demo launch · ${t.name}`,
        t.inject_strategy || 'cookies',
        180 + Math.floor(Math.random() * 900),
      ],
    );
    launchCount++;
  }
  console.log('launch_events', launchCount);

  await root.end();
  await pool.end();
  console.log('Done. Login admin / admin123 — demo data mapped from old dump (subset).');
  console.log('Hash note:', createHash('sha256').update('seed-from-old').digest('hex').slice(0, 8));
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});
