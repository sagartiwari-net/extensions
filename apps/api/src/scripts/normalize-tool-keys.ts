/**
 * One-shot: tm-spyfu-80 → tmspyfu (no dash / no trailing seed id).
 * Duplicates get 1,2,3 suffix.
 *
 * Usage: npx tsx src/scripts/normalize-tool-keys.ts
 */
import mysql from 'mysql2/promise';
import { env } from '../env.js';
import {
  applyToolKeyPrefix,
  nextUniqueToolKey,
  siteCodeFromLegacyKey,
} from '../lib/tool-key.js';

async function main() {
  const conn = await mysql.createConnection({ uri: env.databaseUrl });
  try {
    const [resellers] = await conn.query<
      { id: number; key_prefix: string; slug: string }[]
    >('SELECT id, key_prefix, slug FROM resellers');

    for (const r of resellers as unknown as { id: number; key_prefix: string; slug: string }[]) {
      const prefix = r.key_prefix;
      const [tools] = await conn.query<{ id: number; tool_key: string }[]>(
        'SELECT id, tool_key FROM tools WHERE reseller_id = ? ORDER BY id ASC',
        [r.id],
      );
      const used = new Set<string>();
      let changed = 0;
      for (const t of tools as unknown as { id: number; tool_key: string }[]) {
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
      console.log(`done ${r.slug}: ${changed}/${(tools as unknown as unknown[]).length}`);
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
