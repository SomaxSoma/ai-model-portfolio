import { monthlyCost } from '@pf/domain';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createPool, type Db } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { seed } from '../src/seed.js';
import { config } from '../src/config.js';

let db: Db;
let app: FastifyInstance;
let userToken: string;
let otherToken: string;
let adminToken: string;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, token?: string, payload?: unknown) {
  const res = await app.inject({ method, url, headers: token ? auth(token) : {}, payload: payload as any });
  return { status: res.statusCode, body: res.body ? res.json() : null };
}

const supportBot = {
  name: 'Support bot',
  inputTokens: 2000,
  outputTokens: 500,
  requestsPerMonth: 100_000,
  budget: '100000',
  requiredCapabilities: ['tool_use'],
};

beforeAll(async () => {
  db = createPool(inject('databaseUrl'));
  await migrate(db);
  await seed(db);
  app = await buildApp({ db });
  userToken = (await call('POST', '/auth/register', undefined, { name: 'Uma User', email: 'uma@example.test', password: 'password-123' })).body.token;
  otherToken = (await call('POST', '/auth/register', undefined, { name: 'Oscar Other', email: 'oscar@example.test', password: 'password-123' })).body.token;
  adminToken = (await call('POST', '/auth/login', undefined, { email: config.seedAdmin.email, password: config.seedAdmin.password })).body.token;
});

afterAll(async () => {
  await app?.close();
  await db?.end();
});

describe('Step 1 — schema + seed', () => {
  it('GET /models returns the eight sample models with decimal-string prices and scores', async () => {
    const { status, body } = await call('GET', '/models', userToken);
    expect(status).toBe(200);
    expect(body).toHaveLength(8);
    for (const m of body) {
      expect(m.inputPrice).toMatch(/^\d+\.\d{4}$/);
      expect(m.outputPrice).toMatch(/^\d+\.\d{4}$/);
      expect(typeof m.codingScore).toBe('number');
      expect(typeof m.reasoningScore).toBe('number');
    }
  });

  it('seeding twice is idempotent', async () => {
    await seed(db);
    expect((await call('GET', '/models', userToken)).body).toHaveLength(8);
  });

  it('filters by capability, search and status', async () => {
    expect((await call('GET', '/models?capability=audio', userToken)).body.map((m: any) => m.name).sort()).toEqual(['Flash Lite', 'Long-Context Ultra']);
    expect((await call('GET', '/models?search=northwind', userToken)).body).toHaveLength(2);
    expect((await call('GET', '/models?status=RETIRED', userToken)).body).toHaveLength(1);
  });

  it('model detail includes pricing and benchmark history', async () => {
    const id = (await call('GET', '/models', userToken)).body[0].id;
    const { body } = await call('GET', `/models/${id}`, userToken);
    expect(body.history.pricing).toHaveLength(1);
    expect(body.history.benchmarks).toHaveLength(1);
  });
});

describe('Step 2 — auth', () => {
  it('rejects unauthenticated catalogue reads', async () => {
    expect((await call('GET', '/models')).status).toBe(401);
  });

  it('a USER token is rejected by POST /providers', async () => {
    const r = await call('POST', '/providers', userToken, { name: 'Sneaky Inc' });
    expect(r.status).toBe(403);
  });

  it('an ADMIN token can add a provider; duplicates conflict', async () => {
    const r = await call('POST', '/providers', adminToken, { name: 'Tidewater', website: 'https://example.com/tide' });
    expect(r.status).toBe(201);
    expect((await call('POST', '/providers', adminToken, { name: 'tidewater' })).status).toBe(409);
  });

  it('registration ignores a role in the body', async () => {
    const r = await call('POST', '/auth/register', undefined, { name: 'Eve', email: 'eve@example.test', password: 'password-123', role: 'ADMIN' });
    expect(r.status).toBe(201);
    expect(r.body.user.role).toBe('USER');
    expect((await call('POST', '/providers', r.body.token, { name: 'Eve Corp' })).status).toBe(403);
  });

  it('validates registration and login', async () => {
    const bad = await call('POST', '/auth/register', undefined, { name: 'E', email: 'nope', password: 'short' });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.errors).sort()).toEqual(['email', 'name', 'password']);
    expect((await call('POST', '/auth/register', undefined, { name: 'Uma Again', email: 'UMA@example.test', password: 'password-123' })).status).toBe(409);
    expect((await call('POST', '/auth/login', undefined, { email: 'uma@example.test', password: 'wrong-password' })).status).toBe(401);
  });

  it('a forged token is rejected', async () => {
    expect((await call('GET', '/me', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.bad')).status).toBe(401);
  });
});

describe('Step 5 — workload + recommendation', () => {
  it('validates workloads server-side with per-field errors', async () => {
    const r = await call('POST', '/workloads', userToken, { name: '', inputTokens: 0, outputTokens: -1, requestsPerMonth: 'lots', budget: '0' });
    expect(r.status).toBe(400);
    expect(Object.keys(r.body.errors).sort()).toEqual(['budget', 'inputTokens', 'name', 'outputTokens', 'requestsPerMonth']);
  });

  it('recommends, persists, and re-opens without recomputing', async () => {
    const w = (await call('POST', '/workloads', userToken, supportBot)).body;
    const r = await call('POST', `/workloads/${w.id}/recommendation`, userToken);
    expect(r.status).toBe(201);
    expect(r.body.withinBudget).toBe(true);
    expect(r.body.allocations).toHaveLength(3);
    expect(r.body.allocations.reduce((a: number, l: any) => a + l.allocationPercentage, 0)).toBe(100);
    expect(r.body.estimatedCost).toMatch(/^\d+\.\d{4}$/);
    // Every cost equals the shared cost function's output.
    for (const l of r.body.allocations) {
      expect(l.estimatedCost).toBe(monthlyCost(l.model, supportBot, l.allocationPercentage).toFixed(4));
    }
    const again = await call('GET', `/recommendations/${r.body.id}`, userToken);
    expect(again.body.estimatedCost).toBe(r.body.estimatedCost);
    expect((await call('GET', `/recommendations/${r.body.id}`, otherToken)).status).toBe(404);
  });

  it('an impossible budget returns a helpful reason, not an error', async () => {
    const w = (await call('POST', '/workloads', userToken, { ...supportBot, name: 'Tiny budget', budget: '1' })).body;
    const r = await call('POST', `/workloads/${w.id}/recommendation`, userToken);
    expect(r.status).toBe(201);
    expect(r.body.withinBudget).toBe(false);
    expect(r.body.allocations.length).toBeGreaterThan(0);
    expect(r.body.reason).toMatch(/Nothing fits your \$1\.00 budget/);
  });

  it('no eligible model explains which constraint to relax', async () => {
    const w = (await call('POST', '/workloads', userToken, { ...supportBot, name: 'Huge', inputTokens: 2_000_000 })).body;
    const r = await call('POST', `/workloads/${w.id}/recommendation`, userToken);
    expect(r.status).toBe(201);
    expect(r.body.allocations).toEqual([]);
    expect(r.body.reason).toMatch(/tokens per request/);
  });

  it('users cannot see each other’s workloads', async () => {
    expect((await call('GET', '/workloads', otherToken)).body).toEqual([]);
  });
});

describe('Step 6 — portfolio save (server re-checks)', () => {
  let workloadId: number;
  let recId: number;
  let models: any[];

  beforeAll(async () => {
    workloadId = (await call('POST', '/workloads', userToken, { ...supportBot, name: 'Portfolio test', budget: '500' })).body.id;
    recId = (await call('POST', `/workloads/${workloadId}/recommendation`, userToken)).body.id;
    models = (await call('GET', '/models', userToken)).body;
  });

  const id = (name: string) => models.find((m) => m.name === name).id;

  it('rejects an allocation that does not total 100%', async () => {
    const r = await call('POST', '/portfolios', userToken, {
      workloadId, recommendationId: recId, name: 'P', budget: '500',
      allocations: [{ modelId: id('Open 70B'), allocationPercentage: 60 }, { modelId: id('GPT-class Mini'), allocationPercentage: 39 }],
    });
    expect(r.status).toBe(422);
    expect(r.body.errors.allocations).toMatch(/total exactly 100% — they currently total 99%/);
  });

  it('rejects an over-budget allocation, recomputing cost itself', async () => {
    // GPT-class Frontier at 100% costs $2,000 for this workload.
    const r = await call('POST', '/portfolios', userToken, {
      workloadId, name: 'P', budget: '500',
      allocations: [{ modelId: id('GPT-class Frontier'), allocationPercentage: 100, estimatedCost: '1.00' }],
    });
    expect(r.status).toBe(422);
    expect(r.body.errors.budget).toMatch(/\$2,000\.00 is over the \$500\.00 budget/);
  });

  it('rejects ineligible models (retired / missing capability)', async () => {
    const r = await call('POST', '/portfolios', userToken, {
      workloadId, name: 'P', budget: '500',
      allocations: [{ modelId: id('Flash Lite'), allocationPercentage: 100 }],
    });
    expect(r.status).toBe(422);
    expect(r.body.errors.allocations).toMatch(/Flash Lite doesn’t meet/);
  });

  it('saves a valid portfolio, links the recommendation, then patches and deletes', async () => {
    const r = await call('POST', '/portfolios', userToken, {
      workloadId, recommendationId: recId, name: 'Support mix', budget: '500',
      allocations: [{ modelId: id('Open 70B'), allocationPercentage: 70 }, { modelId: id('GPT-class Mini'), allocationPercentage: 30 }, { modelId: id('Swift'), allocationPercentage: 0 }],
    });
    expect(r.status).toBe(201);
    expect(r.body.allocations).toHaveLength(2); // the 0% line is dropped
    expect(r.body.estimatedCost).toBe('153.0000'); // 0.7*150 + 0.3*160
    expect(r.body.recommendationId).toBe(recId);

    const linked = await db.query('SELECT portfolio_id FROM recommendation WHERE recommendation_id = $1', [recId]);
    expect(linked.rows[0].portfolio_id).toBe(r.body.id);

    expect((await call('GET', `/portfolios/${r.body.id}`, otherToken)).status).toBe(404);
    expect((await call('PATCH', `/portfolios/${r.body.id}`, userToken, { budget: '100' })).status).toBe(422);
    const patched = await call('PATCH', `/portfolios/${r.body.id}`, userToken, { name: 'Renamed', allocations: [{ modelId: id('Open 70B'), allocationPercentage: 100 }] });
    expect(patched.status).toBe(200);
    expect(patched.body.name).toBe('Renamed');
    expect(patched.body.estimatedCost).toBe('150.0000');

    expect((await call('GET', '/portfolios', userToken)).body).toHaveLength(1);
    expect((await call('DELETE', `/portfolios/${r.body.id}`, userToken)).status).toBe(204);
    const lines = await db.query('SELECT count(*)::int AS n FROM portfolio_model WHERE portfolio_id = $1', [r.body.id]);
    expect(lines.rows[0].n).toBe(0);
  });
});

describe('Step 7 — admin edits', () => {
  it('changing an input price writes history, updates the model, and changes the next recommendation', async () => {
    const w = (await call('POST', '/workloads', userToken, { ...supportBot, name: 'Price change' })).body;
    const before = (await call('POST', `/workloads/${w.id}/recommendation`, userToken)).body;
    const mini = before.allocations.find((a: any) => a.model.name === 'GPT-class Mini');
    expect(mini).toBeDefined();

    expect((await call('PATCH', `/models/${mini.modelId}`, userToken, { inputPrice: '40' })).status).toBe(403);
    const patched = await call('PATCH', `/models/${mini.modelId}`, adminToken, { inputPrice: '40' });
    expect(patched.status).toBe(200);
    expect(patched.body.inputPrice).toBe('40.0000');

    const detail = (await call('GET', `/models/${mini.modelId}`, userToken)).body;
    expect(detail.history.pricing).toHaveLength(2);
    expect(detail.history.pricing[0].inputPrice).toBe('40.0000');
    expect(detail.history.benchmarks).toHaveLength(1); // scores unchanged → no benchmark row

    const after = (await call('POST', `/workloads/${w.id}/recommendation`, userToken)).body;
    expect(after.estimatedCost).not.toBe(before.estimatedCost);
    expect(after.allocations.map((a: any) => a.model.name)).not.toContain('GPT-class Mini');
  });

  it('a no-op price patch writes no history row', async () => {
    const m = (await call('GET', '/models?search=Swift', userToken)).body[0];
    await call('PATCH', `/models/${m.id}`, adminToken, { inputPrice: m.inputPrice, outputPrice: '4' });
    expect((await call('GET', `/models/${m.id}`, userToken)).body.history.pricing).toHaveLength(1);
  });

  it('validates admin edits', async () => {
    const m = (await call('GET', '/models', userToken)).body[0];
    const r = await call('PATCH', `/models/${m.id}`, adminToken, { codingScore: 101, inputPrice: '-1' });
    expect(r.status).toBe(400);
    expect(Object.keys(r.body.errors).sort()).toEqual(['codingScore', 'inputPrice']);
  });

  it('retiring a model removes it from recommendations', async () => {
    const all = (await call('GET', '/models', userToken)).body;
    const open70 = all.find((m: any) => m.name === 'Open 70B');
    await call('PATCH', `/models/${open70.id}`, adminToken, { status: 'RETIRED' });
    const w = (await call('POST', '/workloads', userToken, { ...supportBot, name: 'After retire' })).body;
    const r = (await call('POST', `/workloads/${w.id}/recommendation`, userToken)).body;
    expect(r.allocations.map((a: any) => a.modelId)).not.toContain(open70.id);
  });
});

describe('error copy', () => {
  it('never leaks schema wording for missing or mistyped fields', async () => {
    const r = await call('POST', '/auth/login', undefined, {});
    expect(r.body.errors.email).toBe('Enter your email address.');
    const p = await call('POST', '/portfolios', userToken, { workloadId: 1, name: 'x', budget: '1', allocations: [{ modelId: 'abc', allocationPercentage: 50 }] });
    expect(p.status).toBe(400);
    for (const msg of Object.values(p.body.errors) as string[]) expect(msg).not.toMatch(/expected|received|Invalid input/);
  });
});
