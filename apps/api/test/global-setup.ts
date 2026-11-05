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
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port, persistent: false, onLog: () => {}, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('pf_test');
  provide('databaseUrl', `postgres://postgres:postgres@localhost:${port}/pf_test`);
  return async () => {
    // On Windows the embedded server can be slow to stop or reject with no reason; the tests
    // have already finished, so a slow shutdown must not fail the run (or leave the dir).
    await Promise.race([pg.stop().catch(() => {}), new Promise((r) => setTimeout(r, 8000))]);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // still locked by a stopping server; the OS temp cleaner will remove it
    }
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
