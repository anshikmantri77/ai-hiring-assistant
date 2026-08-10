// Applies schema.sql. Idempotent — safe to re-run.
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.');
  process.exit(1);
}

// Matches lib/db.ts: hosted Postgres requires TLS, a local server usually has none.
const sql = postgres(url, { ssl: /localhost|127\.0\.0\.1/.test(url) ? false : 'require' });
try {
  await sql.unsafe(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  console.log('Schema applied.');
} catch (err) {
  console.error('Schema push failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
