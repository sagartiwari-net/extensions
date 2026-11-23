/**
 * Re-seal all tool + pool cookie vaults to compress+AES (v2).
 * Legacy AES-only rows shrink; already-v2 rows are skipped.
 *
 *   npm run db:reseal-cookies -w @oneclk/api
 */
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { resealCookiePayload, sha256Hex } from '@oneclk/crypto';
import { pool } from '../db.js';

type CookieRow = RowDataPacket & {
  id: number;
  cookie_payload: string;
  cookie_password: string;
};

async function resealTable(
  label: string,
  selectSql: string,
  updateFn: (id: number, cipher: string, password: string) => Promise<void>,
) {
  const [rows] = await pool.query<CookieRow[]>(selectSql);
  let sealed = 0;
  let skipped = 0;
  let failed = 0;
  let savedChars = 0;

  for (const row of rows) {
    const result = resealCookiePayload(row.cookie_payload, row.cookie_password);
    if (!result) {
      failed += 1;
      console.warn(`[reseal] ${label}#${row.id} decrypt failed — left unchanged`);
      continue;
    }
    if (result.skipped) {
      skipped += 1;
      continue;
    }
    await updateFn(row.id, result.cipher, row.cookie_password);
    sealed += 1;
    savedChars += Math.max(0, result.beforeChars - result.afterChars);
    console.log(
      `[reseal] ${label}#${row.id} ${result.beforeChars} → ${result.afterChars} chars (−${result.beforeChars - result.afterChars})`,
    );
  }

  return { total: rows.length, sealed, skipped, failed, savedChars };
}

async function main() {
  console.log('[reseal] starting compress+AES migration…');

  const tools = await resealTable(
    'tool',
    `SELECT id, cookie_payload, cookie_password FROM tools
     WHERE cookie_payload IS NOT NULL AND cookie_payload <> ''
       AND cookie_password IS NOT NULL AND cookie_password <> ''`,
    async (id, cipher) => {
      await pool.query<ResultSetHeader>(
        `UPDATE tools
         SET cookie_payload = ?, config_version = config_version + 1
         WHERE id = ?`,
        [cipher, id],
      );
    },
  );

  const pools = await resealTable(
    'pool',
    `SELECT id, cookie_payload, cookie_password FROM cookie_sync_pools
     WHERE cookie_payload IS NOT NULL AND cookie_payload <> ''
       AND cookie_password IS NOT NULL AND cookie_password <> ''`,
    async (id, cipher, password) => {
      await pool.query<ResultSetHeader>(
        `UPDATE cookie_sync_pools
         SET cookie_payload = ?, payload_sha256 = ?, updated_at = NOW()
         WHERE id = ?`,
        [cipher, sha256Hex(cipher), id],
      );
      // Keep member tools in sync with pool vault
      await pool.query<ResultSetHeader>(
        `UPDATE tools
         SET cookie_payload = ?, cookie_password = ?, config_version = config_version + 1
         WHERE pool_id = ?`,
        [cipher, password, id],
      );
    },
  );

  console.log('[reseal] tools', tools);
  console.log('[reseal] pools', pools);
  console.log(
    `[reseal] done — resealed ${tools.sealed + pools.sealed}, skipped ${tools.skipped + pools.skipped}, failed ${tools.failed + pools.failed}, ~${tools.savedChars + pools.savedChars} chars saved`,
  );
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch {
    /* */
  }
  process.exit(1);
});
