import EmbeddedPostgres from 'embedded-postgres';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A throwaway real PostgreSQL for the integration suite.
export default async function setup({ provide }: { provide: (key: string, value: string) => void }) {
  if (process.env.TEST_DATABASE_URL) {
    provide('databaseUrl', process.env.TEST_DATABASE_URL);
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'pf-test-pg-'));
  const port = 55000 + Math.floor(Math.random() * 1000);
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port, persistent: false, onLog: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('pf_test');
  provide('databaseUrl', `postgres://postgres:postgres@localhost:${port}/pf_test`);
  return async () => {
    await pg.stop();
    rmSync(dir, { recursive: true, force: true });
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
