import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { env } from '../env.js';

async function main() {
  const sql = await readFile(env.schemaPath, 'utf8');
  // Strip CREATE DATABASE / USE — docker already created DB; migrate targets DATABASE_URL db
  const cleaned = sql
    .split('\n')
    .filter((line) => !/^\s*CREATE DATABASE/i.test(line) && !/^\s*USE\s+/i.test(line))
    .join('\n');

  const conn = await mysql.createConnection({
    uri: env.databaseUrl,
    multipleStatements: true,
  });
  try {
    await conn.query(cleaned);
    console.log('Migrate OK:', env.schemaPath);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});