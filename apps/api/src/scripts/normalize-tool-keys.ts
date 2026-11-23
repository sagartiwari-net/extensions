/**
 * One-shot: tm-spyfu-80 → tmspyfu (no dash / no trailing seed id).
 * Duplicates get 1,2,3 suffix.
 *
 * Usage: npx tsx src/scripts/normalize-tool-keys.ts
 */
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { env } from '../env.js';
import {
  applyToolKeyPrefix,
  nextUniqueToolKey,
  siteCodeFromLegacyKey,
} from '../lib/tool-key.js';

type ResellerRow = RowDataPacket & { id: number; key_prefix: string; slug: string };
type ToolRow = RowDataPacket & { id: number; tool_key: string };

async function main() {
  const conn = await mysql.createConnection({ uri: env.databaseUrl });
  try {
    const [resellers] = await conn.query<ResellerRow[]>('SELECT id, key_prefix, slug FROM resellers');

    for (const r of resellers) {
      const prefix = r.key_prefix;
      const [tools] = await conn.query<ToolRow[]>(
        'SELECT id, tool_key FROM tools WHERE reseller_id = ? ORDER BY id ASC',
        [r.id],
      );
      const used = new Set<string>();
      let changed = 0;
      for (const t of tools) {
        const site = siteCodeFromLegacyKey(prefix, t.tool_key);
        if (!site) {
          console.warn('skip empty', r.slug, t.id, t.tool_key);
          continue;
        }
        const base = applyToolKeyPrefix(prefix, site);
        const next = nextUniqueToolKey(base, used);
        used.add(next);
        if (next !== t.tool_key) {
          await conn.query('UPDATE tools SET tool_key = ? WHERE id = ?', [next, t.id]);
          changed += 1;
          console.log(`${r.slug}: ${t.tool_key} → ${next}`);
        }
      }
      console.log(`done ${r.slug}: ${changed}/${tools.length}`);
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
