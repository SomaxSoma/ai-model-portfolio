import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createPool, type Db } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { apiPath } from '../src/serverless.js';
import { freshDatabase } from './helpers.js';

describe('Vercel path recovery', () => {
  it('restores the API path from the rewrite query, keeping other parameters', () => {
    expect(apiPath('/api?__pf_path=models&status=ACTIVE')).toBe('/models?status=ACTIVE');
    expect(apiPath('/api?__pf_path=admin%2Fingestion%2Fsources%2F1%2Frun')).toBe('/admin/ingestion/sources/1/run');
    expect(apiPath('/api?__pf_path=')).toBe('/');
  });

  it('falls back to stripping the /api prefix when the platform passes the original URL', () => {
    expect(apiPath('/api/models/3?x=1')).toBe('/models/3?x=1');
    expect(apiPath('/api')).toBe('/');
    expect(apiPath('/apiary')).toBe('/apiary');
  });
});

describe('scheduled work endpoint (Vercel Cron)', () => {
  let db: Db;
  let app: FastifyInstance;
  let disabled: FastifyInstance;

  beforeAll(async () => {
    db = createPool(await freshDatabase('cron'));
    await migrate(db);
    app = await buildApp({ db, cronSecret: 'test-cron-secret' });
    disabled = await buildApp({ db });
  });
  afterAll(async () => {
    await app.close();
    await disabled.close();
    await db.end();
  });

  it('refuses callers without the shared secret', async () => {
    expect((await app.inject({ url: '/cron/run' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/cron/run', headers: { authorization: 'Bearer wrong' } })).statusCode).toBe(401);
  });

  it('runs due sources and the freshness check with the secret', async () => {
    const res = await app.inject({ url: '/cron/run', headers: { authorization: 'Bearer test-cron-secret' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ingested: 0 });
  });

  it('does not exist when no secret is configured', async () => {
    if (process.env.CRON_SECRET) return; // an ambient secret would enable it
    expect((await disabled.inject({ url: '/cron/run', headers: { authorization: 'Bearer anything' } })).statusCode).toBe(404);
  });
});
