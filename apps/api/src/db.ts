import mysql from 'mysql2/promise';
import { env } from './env.js';

export const pool = mysql.createPool(env.databaseUrl);

export async function pingDb(): Promise<boolean> {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
    return true;
  } finally {
    conn.release();
  }
}