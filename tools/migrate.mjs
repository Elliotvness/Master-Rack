#!/usr/bin/env node
/**
 * migrate — apply the SQL migrations in filename order.
 *
 * Deliberately small. Migrations run as the OWNER role; the application runs as
 * a non-owning role with no BYPASSRLS. That separation is what makes the RLS
 * policies more than decoration, so the two must never share a connection
 * string by accident.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIGRATIONS = join(ROOT, 'packages', 'db', 'migrations');

const CONNECTION =
  process.env.DATABASE_ADMIN_URL ??
  'postgresql://postgres:postgres@localhost:55432/rms';

async function main() {
  const files = readdirSync(MIGRATIONS)
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .sort();

  if (files.length === 0) {
    console.error('migrate: no migration files matched. Refusing to report success.');
    process.exitCode = 1;
    return;
  }

  const client = new pg.Client({ connectionString: CONNECTION });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migration (
        filename   text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query('SELECT filename FROM public.schema_migration');
    const applied = new Set(rows.map((r) => r.filename));

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  skip   ${file} (already applied)`);
        continue;
      }

      const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
      // Each migration is one transaction: a half-applied schema is worse than
      // an unapplied one.
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO public.schema_migration (filename) VALUES ($1)', [
          file,
        ]);
        await client.query('COMMIT');
        console.log(`  apply  ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`\nmigrate: FAILED on ${file}`);
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
        return;
      }
    }

    console.log(`migrate: OK — ${files.length} migration(s) present.`);
  } finally {
    await client.end();
  }
}

await main();
