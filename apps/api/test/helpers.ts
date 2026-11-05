import pg from 'pg';
import { inject } from 'vitest';

/**
 * A fresh, empty database on the shared test server, so each test file starts
 * from the same state regardless of order.
 */
export async function freshDatabase(prefix: string): Promise<string> {
  const base = inject('databaseUrl');
  const name = `${prefix}_${process.pid}_${Date.now().toString(36)}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
}
