import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { createPool, type Db } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { insertPasswordReset } from '../src/repositories/users.js';
import { seed } from '../src/seed.js';
import { housekeeping } from '../src/services/digest.js';
import { freshDatabase } from './helpers.js';

let db: Db;
let app: FastifyInstance;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, token?: string, payload?: unknown) {
  const res = await app.inject({ method, url, headers: token ? auth(token) : {}, payload: payload as any });
  return { status: res.statusCode, body: res.body ? res.json() : null, headers: res.headers };
}
const register = async (email: string, password = 'password-123') => (await call('POST', '/auth/register', undefined, { name: 'Test Person', email, password })).body.token as string;

beforeAll(async () => {
  db = createPool(await freshDatabase('account'));
  await migrate(db);
  await seed(db, { sample: true });
  app = await buildApp({ db, authRateLimit: 1000 });
});
afterAll(async () => {
  await app.close();
  await db.end();
});

describe('sign-in options', () => {
  it('reports what this deployment offers (no email or providers configured in tests)', async () => {
    const r = await call('GET', '/auth/options');
    expect(r.body).toEqual({ passwordReset: false, emailAlerts: false, providers: [], demo: true });
    expect((await call('GET', '/auth/oauth/github/start')).status).toBe(404);
  });
});

describe('demo accounts', () => {
  it('creates a fresh, password-less account with a saved sample portfolio', async () => {
    const r = await call('POST', '/auth/demo');
    expect(r.status).toBe(201);
    expect(r.body.user).toMatchObject({ isDemo: true, hasPassword: false, role: 'USER' });
    const portfolios = await call('GET', '/portfolios', r.body.token);
    expect(portfolios.body).toHaveLength(1);
    expect(portfolios.body[0].allocations.length).toBeGreaterThan(0);
    // No password: it can't be logged into, only used through its token.
    expect((await call('POST', '/auth/login', undefined, { email: r.body.user.email, password: 'anything-at-all' })).status).toBe(401);
  });

  it('expired demo accounts are removed with everything they own', async () => {
    const r = await call('POST', '/auth/demo');
    await db.query(`UPDATE app_user SET created_at = now() - interval '2 days' WHERE user_id = $1`, [r.body.user.id]);
    const { demoAccountsRemoved } = await housekeeping(db);
    expect(demoAccountsRemoved).toBeGreaterThanOrEqual(1);
    expect((await call('GET', '/me', r.body.token)).status).toBe(401);
    expect((await db.query('SELECT count(*)::int AS n FROM workload WHERE user_id = $1', [r.body.user.id])).rows[0].n).toBe(0);
  });
});

describe('password reset', () => {
  it('answers the same whether or not the account exists', async () => {
    await register('reset-a@example.test');
    const known = await call('POST', '/auth/forgot', undefined, { email: 'reset-a@example.test' });
    const unknown = await call('POST', '/auth/forgot', undefined, { email: 'nobody@example.test' });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
  });

  it('a valid token sets the password once, and signs out every earlier session', async () => {
    const oldToken = await register('reset-b@example.test', 'old-password-1');
    const userId = (await call('GET', '/me', oldToken)).body.id;
    const token = 'known-test-token-0123456789abcdef';
    await insertPasswordReset(db, userId, createHash('sha256').update(token).digest('hex'), 30);

    const reset = await call('POST', '/auth/reset', undefined, { token, password: 'new-password-2' });
    expect(reset.status).toBe(200);
    expect((await call('GET', '/me', reset.body.token)).status).toBe(200);
    expect((await call('GET', '/me', oldToken)).status).toBe(401); // signed out everywhere
    expect((await call('POST', '/auth/login', undefined, { email: 'reset-b@example.test', password: 'old-password-1' })).status).toBe(401);
    expect((await call('POST', '/auth/login', undefined, { email: 'reset-b@example.test', password: 'new-password-2' })).status).toBe(200);
    // Single use.
    expect((await call('POST', '/auth/reset', undefined, { token, password: 'another-pass-3' })).status).toBe(400);
  });

  it('rejects expired and unknown tokens', async () => {
    const t = await register('reset-c@example.test');
    const userId = (await call('GET', '/me', t)).body.id;
    const token = 'expired-test-token-0123456789abcd';
    await insertPasswordReset(db, userId, createHash('sha256').update(token).digest('hex'), -1);
    expect((await call('POST', '/auth/reset', undefined, { token, password: 'new-password-2' })).status).toBe(400);
    expect((await call('POST', '/auth/reset', undefined, { token: 'never-issued-token-0123456789abcd', password: 'new-password-2' })).status).toBe(400);
  });
});

describe('the account itself', () => {
  it('updates the name; email alerts need email to be set up', async () => {
    const t = await register('profile@example.test');
    const r = await call('PATCH', '/me', t, { name: 'Renamed Person' });
    expect(r.body.name).toBe('Renamed Person');
    expect((await call('PATCH', '/me', t, { emailAlerts: true })).status).toBe(400);
    expect((await call('PATCH', '/me', t, { role: 'ADMIN' })).status).toBe(400); // never settable
  });

  it('deleting needs the password and removes everything the account owns', async () => {
    const t = await register('leaver@example.test');
    const w = await call('POST', '/workloads', t, { name: 'Bye', inputTokens: 100, outputTokens: 100, requestsPerMonth: 10, budget: '50', requiredCapabilities: [] });
    expect((await call('DELETE', '/me', t, {})).status).toBe(400);
    expect((await call('DELETE', '/me', t, { password: 'wrong-password' })).status).toBe(400);
    expect((await call('DELETE', '/me', t, { password: 'password-123' })).status).toBe(204);
    expect((await call('GET', '/me', t)).status).toBe(401);
    expect((await db.query('SELECT count(*)::int AS n FROM workload WHERE workload_id = $1', [w.body.id])).rows[0].n).toBe(0);
  });

  it('the last administrator cannot delete their account', async () => {
    const admin = (await call('POST', '/auth/login', undefined, { email: config.seedAdmin.email, password: config.seedAdmin.password })).body.token;
    const r = await call('DELETE', '/me', admin, { password: config.seedAdmin.password });
    expect(r.status).toBe(400);
  });

  it('a token whose subject is not a user id is refused', async () => {
    const forged = app.jwt.sign({ sub: 'oauth' } as never);
    expect((await call('GET', '/me', forged)).status).toBe(401);
  });
});
