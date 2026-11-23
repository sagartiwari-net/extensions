/**
 * Import CSS / redirect / block (+ rule groups, text, overlay) from
 * old/extensionsystem.sql → oneclk_v2 without wiping tools/cookies.
 *
 * Usage: npm run db:import-rules -w @oneclk/api
 *
 * Maps old tenants → resellers by slug. Rules that lived on tenant 1
 * (toolsmandi) are also copied onto every other reseller so each admin
 * view can manage them (old dump only stored them on one tenant).
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../db.js';
import { env } from '../env.js';

const rootDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const DUMP = resolve(rootDir, '../old/extensionsystem.sql');
const OLD_DB = 'oneclk_old_src';

const RULE_TABLES = [
  'rule_groups',
  'redirect_rules',
  'block_rules',
  'css_rules',
  'text_replacement_rules',
  'content_overlay_rules',
] as const;

async function rootConn() {
  const u = new URL(env.databaseUrl);
  return mysql.createConnection({
    host: u.hostname,
    port: Number(u.port || 3306),
    user: 'root',
    password: process.env.MYSQL_ROOT_PASSWORD || 'oneclk_root',
    multipleStatements: true,
  });
}

async function extractRuleTables(conn: mysql.Connection) {
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${OLD_DB}\``);
  await conn.query(`USE \`${OLD_DB}\``);
  for (const t of [...RULE_TABLES].reverse()) {
    await conn.query(`DROP TABLE IF EXISTS \`${t}\``);
  }

  console.log('Extracting rule tables from dump…', DUMP);
  const rl = createInterface({
    input: createReadStream(DUMP, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  const wanted = new Set<string>(RULE_TABLES);
  let current: string | null = null;
  let buf: string[] = [];
  let capturing = false;

  async function flush() {
    if (!current || !buf.length) return;
    const sql = buf.join('\n');
    buf = [];
    try {
      await conn.query(sql);
      console.log('  loaded', current);
    } catch (err) {
      console.warn(
        '  skip/warn',
        current,
        err instanceof Error ? err.message.slice(0, 160) : err,
      );
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
    buf.push(line);
    if (line.startsWith('UNLOCK TABLES;') || line.startsWith('COMMIT;')) {
      await flush();
      capturing = false;
      current = null;
    }
  }
  await flush();
}

async function mapResellers(conn: mysql.Connection) {
  const [tenants] = await conn.query<RowDataPacket[]>(
    `SELECT id, slug FROM \`${OLD_DB}\`.tenants WHERE is_active = 1`,
  );
  const [resellers] = await pool.query<RowDataPacket[]>(
    'SELECT id, slug FROM resellers WHERE is_active = 1',
  );
  const bySlug = new Map(resellers.map((r) => [String(r.slug), Number(r.id)]));
  const map = new Map<number, number>();
  for (const t of tenants) {
    const rid = bySlug.get(String(t.slug));
    if (rid) map.set(Number(t.id), rid);
  }
  return { map, allResellerIds: resellers.map((r) => Number(r.id)) };
}

async function clearRules() {
  await pool.query('SET FOREIGN_KEY_CHECKS=0');
  for (const t of [
    'css_rules',
    'redirect_rules',
    'block_url_rules',
    'overlay_rules',
    'text_rules',
    'rule_groups',
  ]) {
    await pool.query(`TRUNCATE TABLE \`${t}\``);
  }
  await pool.query('SET FOREIGN_KEY_CHECKS=1');
}

type GroupMaps = Map<number, Map<number, number>>; // oldGroupId → (resellerId → newGroupId)

async function importGroups(
  conn: mysql.Connection,
  resellerMap: Map<number, number>,
  allResellerIds: number[],
): Promise<GroupMaps> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT * FROM \`${OLD_DB}\`.rule_groups ORDER BY id`,
  );
  const groupMaps: GroupMaps = new Map();
  let n = 0;

  for (const g of rows) {
    const sourceRid = g.tenant_id ? resellerMap.get(Number(g.tenant_id)) : null;
    // Place on source reseller + every reseller (old dump only stored on tenant 1)
    const targets = new Set<number>(allResellerIds);
    if (sourceRid) targets.add(sourceRid);

    const perReseller = new Map<number, number>();
    for (const rid of targets) {
      const [res] = await pool.query<ResultSetHeader>(
        `INSERT INTO rule_groups (reseller_id, name, url_pattern, is_active)
         VALUES (?, ?, ?, ?)`,
        [rid, g.name, g.url_pattern, g.is_active ? 1 : 0],
      );
      perReseller.set(rid, res.insertId);
      n += 1;
    }
    groupMaps.set(Number(g.id), perReseller);
  }
  console.log('rule_groups inserted', n, '(from', rows.length, 'old rows)');
  return groupMaps;
}

async function importCss(conn: mysql.Connection, groupMaps: GroupMaps) {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT * FROM \`${OLD_DB}\`.css_rules ORDER BY id`,
  );
  let n = 0;
  for (const c of rows) {
    const per = groupMaps.get(Number(c.group_id));
    if (!per) continue;
    const action =
      c.action === 'hide' || c.action === 'replace' || c.action === 'custom' ? c.action : 'hide';
    for (const [rid, gid] of per) {
      await pool.query(
        `INSERT INTO css_rules (reseller_id, group_id, selector, action, value, is_active)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [rid, gid, c.selector, action, c.value ?? null, c.is_active ? 1 : 0],
      );
      n += 1;
    }
  }
  console.log('css_rules inserted', n, '(from', rows.length, 'old rows)');
}

async function importRedirects(
  conn: mysql.Connection,
  resellerMap: Map<number, number>,
  allResellerIds: number[],
  groupMaps: GroupMaps,
) {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT * FROM \`${OLD_DB}\`.redirect_rules ORDER BY id`,
  );
  let n = 0;
  for (const r of rows) {
    const sourceRid = r.tenant_id ? resellerMap.get(Number(r.tenant_id)) : null;
    const targets = new Set<number>(allResellerIds);
    if (sourceRid) targets.add(sourceRid);
    const per = r.group_id ? groupMaps.get(Number(r.group_id)) : null;

    for (const rid of targets) {
      const gid = per?.get(rid) ?? null;
      await pool.query(
        `INSERT INTO redirect_rules
          (reseller_id, group_id, source_url, destination_url, description, is_active)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          rid,
          gid,
          r.source_url,
          r.destination_url,
          r.description ?? null,
          r.is_active ? 1 : 0,
        ],
      );
      n += 1;
    }
  }
  console.log('redirect_rules inserted', n, '(from', rows.length, 'old rows)');
}

async function importBlocks(
  conn: mysql.Connection,
  resellerMap: Map<number, number>,
  allResellerIds: number[],
  groupMaps: GroupMaps,
) {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT * FROM \`${OLD_DB}\`.block_rules ORDER BY id`,
  );
  let n = 0;
  for (const b of rows) {
    const sourceRid = b.tenant_id ? resellerMap.get(Number(b.tenant_id)) : null;
    const targets = new Set<number>(allResellerIds);
    if (sourceRid) targets.add(sourceRid);
    const per = b.group_id ? groupMaps.get(Number(b.group_id)) : null;

    for (const rid of targets) {
      const gid = per?.get(rid) ?? null;
      await pool.query(
        `INSERT INTO block_url_rules
          (reseller_id, group_id, url_pattern, action, redirect_url, is_active)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          rid,
          gid,
          b.url_to_block,
          b.redirect_to ? 'redirect' : 'blank',
          b.redirect_to ?? null,
          b.is_active ? 1 : 0,
        ],
      );
      n += 1;
    }
  }
  console.log('block_url_rules inserted', n, '(from', rows.length, 'old rows)');
}

async function importText(
  conn: mysql.Connection,
  resellerMap: Map<number, number>,
  allResellerIds: number[],
  groupMaps: GroupMaps,
) {
  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT * FROM \`${OLD_DB}\`.text_replacement_rules ORDER BY id`,
    );
    let n = 0;
    for (const t of rows) {
      const sourceRid = t.tenant_id ? resellerMap.get(Number(t.tenant_id)) : null;
      const targets = new Set<number>(allResellerIds);
      if (sourceRid) targets.add(sourceRid);
      const per = t.group_id ? groupMaps.get(Number(t.group_id)) : null;
      for (const rid of targets) {
        const gid = per?.get(rid) ?? null;
        await pool.query(
          `INSERT INTO text_rules (reseller_id, group_id, find_text, replace_text, is_active)
           VALUES (?, ?, ?, ?, ?)`,
          [
            rid,
            gid,
            String(t.find_text).slice(0, 500),
            String(t.replace_text).slice(0, 500),
            t.is_active ? 1 : 0,
          ],
        );
        n += 1;
      }
    }
    console.log('text_rules inserted', n, '(from', rows.length, 'old rows)');
  } catch (err) {
    console.warn('text_rules skip', err instanceof Error ? err.message : err);
  }
}

async function importOverlay(conn: mysql.Connection, groupMaps: GroupMaps) {
  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT * FROM \`${OLD_DB}\`.content_overlay_rules ORDER BY id`,
    );
    let n = 0;
    for (const o of rows) {
      const per = groupMaps.get(Number(o.group_id));
      if (!per) continue;
      const html =
        o.overlay_html ||
        `<div><strong>${o.overlay_title || ''}</strong><p>${o.overlay_message || ''}</p></div>`;
      for (const [rid, gid] of per) {
        await pool.query(
          `INSERT INTO overlay_rules (reseller_id, group_id, trigger_text, html_content, is_active)
           VALUES (?, ?, ?, ?, ?)`,
          [rid, gid, String(o.rule_value).slice(0, 500), html, o.is_active ? 1 : 0],
        );
        n += 1;
      }
    }
    console.log('overlay_rules inserted', n, '(from', rows.length, 'old rows)');
  } catch (err) {
    console.warn('overlay_rules skip', err instanceof Error ? err.message : err);
  }
}

async function main() {
  const conn = await rootConn();
  try {
    // Need tenants table for slug map — load if missing
    const [dbs] = await conn.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM information_schema.tables
       WHERE table_schema = ? AND table_name = 'tenants'`,
      [OLD_DB],
    );
    if (!Number(dbs[0]?.c)) {
      throw new Error(
        `${OLD_DB}.tenants missing — run npm run db:seed:old once first (loads tenants), then re-run this.`,
      );
    }

    await extractRuleTables(conn);
    const { map, allResellerIds } = await mapResellers(conn);
    if (!allResellerIds.length) {
      throw new Error('No resellers in oneclk_v2 — seed resellers first');
    }
    console.log('reseller map (old tenant → new)', Object.fromEntries(map));
    console.log('copy targets', allResellerIds);

    await clearRules();
    const groupMaps = await importGroups(conn, map, allResellerIds);
    await importCss(conn, groupMaps);
    await importRedirects(conn, map, allResellerIds, groupMaps);
    await importBlocks(conn, map, allResellerIds, groupMaps);
    await importText(conn, map, allResellerIds, groupMaps);
    await importOverlay(conn, groupMaps);

    const [sum] = await pool.query<RowDataPacket[]>(
      `SELECT
         (SELECT COUNT(*) FROM rule_groups) AS rule_groups,
         (SELECT COUNT(*) FROM css_rules) AS css,
         (SELECT COUNT(*) FROM redirect_rules) AS redirects,
         (SELECT COUNT(*) FROM block_url_rules) AS blocks,
         (SELECT COUNT(*) FROM text_rules) AS text_rules,
         (SELECT COUNT(*) FROM overlay_rules) AS overlays`,
    );
    console.log('Done. oneclk_v2 totals:', sum[0]);
  } finally {
    await conn.end();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
