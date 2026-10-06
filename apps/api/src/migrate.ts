import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import { createPool, withTransaction, type Db } from './db.js';

const MIGRATIONS_DIR = resolve(import.meta.dirname, '..', 'migrations');

/** Applies pending migrations in filename order, each in its own transaction. */
export async function migrate(db: Db, log: (msg: string) => void = () => {}): Promise<string[]> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migration (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migration')).rows.map((r) => r.name));
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    await withTransaction(db, async (tx) => {
      await tx.query(sql);
      await tx.query('INSERT INTO schema_migration (name) VALUES ($1)', [file]);
    });
    log(`applied ${file}`);
    ran.push(file);
  }
  return ran;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const db = createPool(config.databaseUrl);
  const ran = await migrate(db, console.log);
  console.log(ran.length ? `${ran.length} migration(s) applied` : 'schema up to date');
  await db.end();
}
