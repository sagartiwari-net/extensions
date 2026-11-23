import bcrypt from 'bcryptjs';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../db.js';
import { env } from '../env.js';

async function main() {
  const [existing] = await pool.query<RowDataPacket[]>(
    'SELECT id FROM admin_users WHERE username = ? LIMIT 1',
    [env.seedMasterUser],
  );
  if (existing[0]) {
    console.log('Seed skipped: master already exists →', env.seedMasterUser);
    process.exit(0);
  }

  const hash = await bcrypt.hash(env.seedMasterPassword, 10);
  const [res] = await pool.query<ResultSetHeader>(
    `INSERT INTO admin_users (username, password_hash, role, reseller_id, is_active)
     VALUES (?, ?, 'master', NULL, 1)`,
    [env.seedMasterUser, hash],
  );
  console.log('Seeded master user', env.seedMasterUser, 'id=', res.insertId);
  console.log('Password:', env.seedMasterPassword);
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});