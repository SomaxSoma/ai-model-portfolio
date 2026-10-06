// Starts a local PostgreSQL for development (real Postgres binaries via the
// embedded-postgres package — no system install or Docker needed).
// Data persists in ./.pgdata. Any other PostgreSQL works too: point
// DATABASE_URL at it and skip this script.
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const port = Number(process.env.PGPORT ?? 5433);
const databaseDir = resolve(import.meta.dirname, '..', '.pgdata');
const pg = new EmbeddedPostgres({ databaseDir, user: 'postgres', password: 'postgres', port, persistent: true });

if (!existsSync(databaseDir)) await pg.initialise();
await pg.start();

for (const name of ['portfolio']) {
  try {
    await pg.createDatabase(name);
    console.log(`created database ${name}`);
  } catch {
    // already exists
  }
}

console.log(`PostgreSQL ready: postgres://postgres:postgres@localhost:${port}/portfolio  (Ctrl+C to stop)`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
