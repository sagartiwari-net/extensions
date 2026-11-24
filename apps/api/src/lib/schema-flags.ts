import type { RowDataPacket } from 'mysql2';
import { pool } from '../db.js';

let jarModeColumn: boolean | null = null;

/** True once `tools.cookie_jar_mode` exists (after docs/alter-cookie-jar-mode.sql). */
export async function hasCookieJarModeColumn(): Promise<boolean> {
  if (jarModeColumn != null) return jarModeColumn;
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 1 AS ok
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'tools'
         AND COLUMN_NAME = 'cookie_jar_mode'
       LIMIT 1`,
    );
    jarModeColumn = rows.length > 0;
  } catch {
    jarModeColumn = false;
  }
  return jarModeColumn;
}

export function resetSchemaFlags() {
  jarModeColumn = null;
}
