import type { FastifyInstance } from 'fastify';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { createPool, type Db } from '../src/db.js';
import { startScheduler } from '../src/jobs.js';
import { migrate } from '../src/migrate.js';
import { seed } from '../src/seed.js';
import { checkFreshness } from '../src/services/ingestion.js';
import { freshDatabase } from './helpers.js';

/**
 * Proposal features beyond the original handoff: performance/lifecycle data,
 * configurable scoring, provider risk, what-if simulation, ingestion with
 * data-quality checks, alerts, analytics, ops and evaluation metrics, security.
 */
let db: Db;
let app: FastifyInstance;
let uma: string;
let otto: string;
let admin: string;
let models: Record<string, any>;

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
async function call(method: Method, url: string, token?: string, payload?: unknown, target: FastifyInstance = app) {
  const res = await target.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: payload as any });
  return { status: res.statusCode, body: res.body ? res.json() : null, headers: res.headers };
}

const isoInDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
// 1,000 requests of 1K in + 1K out: a model's full monthly cost = inputPrice + outputPrice.
const chat = { name: 'Chat', inputTokens: 1000, outputTokens: 1000, requestsPerMonth: 1000, budget: '30', requiredCapabilities: [] as string[] };

let workloadId: number;
let recommendationId: number;
let portfolioId: number;

beforeAll(async () => {
  db = createPool(await freshDatabase('proposal'));
  await migrate(db);
  await seed(db);
  app = await buildApp({ db, authRateLimit: 1000 });
  uma = (await call('POST', '/auth/register', undefined, { name: 'Uma User', email: 'uma@example.test', password: 'password-123' })).body.token;
  otto = (await call('POST', '/auth/register', undefined, { name: 'Otto Other', email: 'otto@example.test', password: 'password-123' })).body.token;
  admin = (await call('POST', '/auth/login', undefined, { email: config.seedAdmin.email, password: config.seedAdmin.password })).body.token;
  models = Object.fromEntries((await call('GET', '/models', uma)).body.map((m: any) => [m.name, m]));

  workloadId = (await call('POST', '/workloads', uma, chat)).body.id;
  recommendationId = (await call('POST', `/workloads/${workloadId}/recommendation`, uma)).body.id;
  // Atlas Labs 80%, Meridian 20% → concentrated on one provider.
  const p = await call('POST', '/portfolios', uma, {
    workloadId,
    recommendationId,
    name: 'Uma portfolio',
    budget: '30',
    allocations: [
      { modelId: models['GPT-class Frontier'].id, allocationPercentage: 50 },
      { modelId: models['GPT-class Mini'].id, allocationPercentage: 30 },
      { modelId: models['Flash Lite'].id, allocationPercentage: 20 },
    ],
  });
  expect(p.status).toBe(201);
  portfolioId = p.body.id;
});

afterAll(async () => {
  await app?.close();
  await db?.end();
});

describe('catalogue: performance, lifecycle, pagination', () => {
  it('exposes latency, reliability and deprecation date (null when unpublished)', () => {
    expect(models['Swift']).toMatchObject({ latencyMs: 520, reliability: 99.7, deprecationDate: '2027-01-31' });
    expect(models['Open 70B'].reliability).toBeNull();
    expect(typeof models['Swift'].lastVerifiedAt).toBe('string');
  });

  it('paginates with limit/offset and X-Total-Count', async () => {
    const r = await call('GET', '/models?limit=3&offset=2', uma);
    expect(r.body).toHaveLength(3);
    expect(r.headers['x-total-count']).toBe('8');
    const h = await call('GET', `/models/${models['Swift'].id}/history?limit=1`, uma);
    expect(h.body.pricing).toHaveLength(1);
    expect(h.body.totals).toEqual({ pricing: 1, benchmarks: 1 });
  });

  it('admin can create a model with performance and lifecycle fields', async () => {
    const r = await call('POST', '/models', admin, {
      providerId: models['Swift'].providerId,
      name: 'Swift Next',
      version: '5.0',
      contextWindow: 256000,
      inputPrice: '0.7',
      outputPrice: '3.5',
      codingScore: 82,
      reasoningScore: 76,
      capabilities: ['tool_use'],
      latencyMs: 480,
      reliability: 99.8,
      deprecationDate: null,
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ latencyMs: 480, reliability: 99.8, inputPrice: '0.7000' });
    const bad = await call('POST', '/models', admin, { ...r.body, name: 'X', latencyMs: -5, reliability: 120, deprecationDate: '2027-13-45' });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.errors)).toEqual(expect.arrayContaining(['latencyMs', 'reliability', 'deprecationDate']));
    // keep the rest of the suite on the original eight
    await db.query(`UPDATE ai_model SET status = 'RETIRED' WHERE model_id = $1`, [r.body.id]);
    await app.cache.invalidate('catalogue:');
  });
});

describe('configurable scoring weights', () => {
  it('ranks by the workload’s priorities and explains them', async () => {
    const w = (await call('POST', '/workloads', uma, { ...chat, name: 'Fast', scoringWeights: { quality: 0, cost: 0, latency: 100, reliability: 0 } })).body;
    expect(w.scoringWeights).toEqual({ quality: 0, cost: 0, latency: 1, reliability: 0 });
    const r = (await call('POST', `/workloads/${w.id}/recommendation`, uma)).body;
    expect(r.reason).toMatch(/latency \(100%\) alone/);
    expect(r.allocations[0].model.name).toBe('Flash Lite'); // 380 ms, the fastest available
    expect(r.scoringWeights).toEqual({ quality: 0, cost: 0, latency: 1, reliability: 0 });
  });

  it('rejects invalid weights with a field message', async () => {
    const r = await call('POST', '/workloads', uma, { ...chat, scoringWeights: { quality: 0, cost: 0 } });
    expect(r.status).toBe(400);
    expect(r.body.errors.scoringWeights).toBe('Give at least one scoring priority some weight.');
  });
});

describe('provider risk analyzer', () => {
  it('reports concentration with HHI and provider shares', async () => {
    const r = await call('GET', `/portfolios/${portfolioId}/risk`, uma);
    expect(r.status).toBe(200);
    expect(r.body.hhi).toBe(6800); // 80² + 20²
    expect(r.body.concentration).toBe('HIGH');
    expect(r.body.providers[0]).toMatchObject({ provider: 'Atlas Labs', trafficShare: 80 });
    expect((await call('GET', `/portfolios/${portfolioId}/risk`, otto)).status).toBe(404);
  });
});

describe('what-if simulator', () => {
  it('price increase: keeps the allocation, recomputes cost, re-optimises', async () => {
    const r = await call('POST', `/portfolios/${portfolioId}/simulate`, uma, { scenario: { kind: 'PRICE_CHANGE', modelId: models['GPT-class Frontier'].id, percent: 100 } });
    expect(r.status).toBe(200);
    expect(r.body.description).toBe('Prices for GPT-class Frontier rise by 100%.');
    expect(r.body.baseline.estimatedCost).toBe('13.2000'); // 12.5 + 0.6 + 0.1
    expect(r.body.kept.estimatedCost).toBe('25.7000'); // 25 + 0.6 + 0.1
    expect(r.body.kept.withinBudget).toBe(true);
    expect(r.body.reoptimised.lines.length).toBeGreaterThan(0);
  });

  it('provider outage: lost share is spread over survivors', async () => {
    const r = await call('POST', `/portfolios/${portfolioId}/simulate`, uma, { scenario: { kind: 'PROVIDER_OUTAGE', providerName: 'Atlas Labs' } });
    expect(r.body.kept.lostShare).toBe(80);
    expect(r.body.kept.lines.map((l: any) => [l.model.name, l.allocationPercentage])).toEqual([['Flash Lite', 100]]);
    expect(r.body.reoptimised.lines.every((l: any) => l.model.providerName !== 'Atlas Labs')).toBe(true);
  });

  it('validates the scenario and ownership', async () => {
    const bad = await call('POST', `/portfolios/${portfolioId}/simulate`, uma, { scenario: { kind: 'PRICE_CHANGE', percent: 10 } });
    expect(bad.status).toBe(400);
    expect(bad.body.errors.target).toBe('Choose either one model or one provider.');
    expect((await call('POST', `/portfolios/${portfolioId}/simulate`, otto, { scenario: { kind: 'MODEL_DEPRECATION', modelId: 1 } })).status).toBe(404);
  });
});

describe('data ingestion and data quality', () => {
  let sourceId: number;

  it('admin-only, and FILE sources are confined to the data folder', async () => {
    expect((await call('GET', '/admin/ingestion/sources', uma)).status).toBe(403);
    const escape = await call('POST', '/admin/ingestion/sources', admin, { name: 'Escape', kind: 'FILE', location: '../../../package.json' });
    expect(escape.status).toBe(400);
    expect(escape.body.errors.location).toMatch(/inside the data folder/);
  });

  it('applies a feed: creates, updates, rejects, flags, and writes history', async () => {
    await call('GET', '/models', uma); // warm the cache to prove invalidation
    const src = await call('POST', '/admin/ingestion/sources', admin, { name: 'Test feed', kind: 'FILE', location: 'update-feed.json', scheduleMinutes: 30 });
    expect(src.status).toBe(201);
    sourceId = src.body.id;

    const run = await call('POST', `/admin/ingestion/sources/${sourceId}/run`, admin);
    expect(run.status).toBe(201);
    expect(run.body).toMatchObject({ status: 'PARTIAL', recordsSeen: 5, modelsCreated: 1, modelsUpdated: 2, recordsRejected: 2, issuesFound: 3 });

    const fresh = Object.fromEntries((await call('GET', '/models', uma)).body.map((m: any) => [m.name, m]));
    expect(fresh['GPT-class Frontier'].inputPrice).toBe('10.0000');
    expect(fresh['GPT-class Frontier'].latencyMs).toBe(2000);
    expect(fresh['GPT-class Mini'].reliability).toBe(99.99);
    expect(fresh['Nimbus Nano'].providerName).toBe('Cirrus');
    expect(fresh['Ghost']).toBeUndefined();

    const hist = (await call('GET', `/models/${models['GPT-class Frontier'].id}`, uma)).body.history;
    expect(hist.pricing[0]).toMatchObject({ inputPrice: '10.0000', source: 'Test feed' });
    expect(hist.benchmarks[0]).toMatchObject({ latencyMs: 2000, source: 'Test feed' });

    const issues = (await call('GET', '/admin/data-quality', admin)).body;
    expect(issues.map((i: any) => i.kind).sort()).toEqual(['INVALID_RECORD', 'MISSING_FIELDS', 'PRICE_JUMP']);
    const runs = await call('GET', '/admin/ingestion/runs?limit=5', admin);
    expect(runs.headers['x-total-count']).toBe('1');
    expect(runs.body[0]).toMatchObject({ sourceName: 'Test feed', status: 'PARTIAL', trigger: 'MANUAL' });
  });

  it('alerts the portfolio owner about the cost change and admins about the issues', async () => {
    const n = (await call('GET', '/notifications', uma)).body;
    expect(n.items[0]).toMatchObject({ kind: 'COST_CHANGE', title: 'Uma portfolio now costs $15.70 a month', link: `/portfolios/${portfolioId}` });
    const a = (await call('GET', '/notifications', admin)).body;
    expect(a.items.some((x: any) => x.kind === 'DATA_QUALITY' && x.title.startsWith('3 data-quality issues'))).toBe(true);
    // the saved portfolio now reports the live cost and the cost at save time
    const p = (await call('GET', `/portfolios/${portfolioId}`, uma)).body;
    expect(p.estimatedCost).toBe('15.7000');
    expect(p.savedEstimatedCost).toBe('13.2000');
  });

  it('resolves issues once', async () => {
    const [first] = (await call('GET', '/admin/data-quality', admin)).body;
    expect((await call('POST', `/admin/data-quality/${first.id}/resolve`, admin)).status).toBe(204);
    expect((await call('POST', `/admin/data-quality/${first.id}/resolve`, admin)).status).toBe(404);
    expect((await call('GET', '/admin/data-quality?status=resolved', admin)).body.map((i: any) => i.id)).toContain(first.id);
  });

  it('a broken or malformed source fails the run, files an issue and alerts admins', async () => {
    for (const [file, message] of [
      ['broken-feed.json', 'The feed isn’t valid JSON.'],
      ['wrong-shape.json', 'The feed isn’t in the expected format: it needs a "models" list.'],
    ]) {
      const s = (await call('POST', '/admin/ingestion/sources', admin, { name: file, kind: 'FILE', location: file })).body;
      const run = await call('POST', `/admin/ingestion/sources/${s.id}/run`, admin);
      expect(run.body).toMatchObject({ status: 'FAILED', error: message });
    }
    const a = (await call('GET', '/notifications', admin)).body;
    expect(a.items.filter((x: any) => x.kind === 'INGESTION_FAILED')).toHaveLength(2);
  });

  it('reads HTTP sources', async () => {
    const body = readFileSync(resolve(config.dataDir, 'update-feed.json'));
    const server: Server = createServer((req, res) => {
      if (req.url === '/feed.json') res.writeHead(200, { 'content-type': 'application/json' }).end(body);
      else res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    try {
      const ok = (await call('POST', '/admin/ingestion/sources', admin, { name: 'HTTP feed', kind: 'HTTP', location: `http://127.0.0.1:${port}/feed.json` })).body;
      const run = (await call('POST', `/admin/ingestion/sources/${ok.id}/run`, admin)).body;
      expect(run).toMatchObject({ recordsSeen: 5, modelsCreated: 0, modelsUpdated: 0 });
      const missing = (await call('POST', '/admin/ingestion/sources', admin, { name: 'HTTP missing', kind: 'HTTP', location: `http://127.0.0.1:${port}/nope.json` })).body;
      expect((await call('POST', `/admin/ingestion/sources/${missing.id}/run`, admin)).body).toMatchObject({ status: 'FAILED', error: 'The source answered 404.' });
    } finally {
      server.close();
    }
  });

  it('flags stale figures and clears the flag when a source confirms them', async () => {
    await db.query(`UPDATE ai_model SET last_verified_at = now() - interval '2 days' WHERE model_id = $1`, [models['Swift'].id]);
    expect(await checkFreshness(db)).toBe(1);
    expect(await checkFreshness(db)).toBe(0); // one open issue per model
    const open = (await call('GET', '/admin/data-quality', admin)).body;
    expect(open.some((i: any) => i.kind === 'STALE_DATA' && i.modelId === models['Swift'].id)).toBe(true);
    await call('PATCH', `/models/${models['Swift'].id}`, admin, {}); // an admin save verifies the figures
    const after = (await call('GET', '/admin/data-quality', admin)).body;
    expect(after.some((i: any) => i.kind === 'STALE_DATA' && i.modelId === models['Swift'].id)).toBe(false);
  });
});

describe('alerts from admin edits', () => {
  it('deprecation within 90 days and retirement notify portfolio owners', async () => {
    const date = isoInDays(30);
    await call('PATCH', `/models/${models['GPT-class Mini'].id}`, admin, { deprecationDate: date });
    await call('PATCH', `/models/${models['Flash Lite'].id}`, admin, { status: 'RETIRED' });
    const kinds = (await call('GET', '/notifications', uma)).body.items.map((x: any) => x.kind);
    expect(kinds).toEqual(expect.arrayContaining(['MODEL_DEPRECATION', 'MODEL_RETIRED']));
    const risk = (await call('GET', `/portfolios/${portfolioId}/risk`, uma)).body;
    expect(risk.level).toBe('HIGH');
    expect(risk.findings[0]).toMatch(/Flash Lite is no longer available/);
  });

  it('a price rise that breaks the budget sends an over-budget alert', async () => {
    await call('PATCH', `/models/${models['GPT-class Frontier'].id}`, admin, { inputPrice: '100' });
    const top = (await call('GET', '/notifications', uma)).body.items[0];
    expect(top).toMatchObject({ kind: 'OVER_BUDGET', severity: 'WARNING', title: 'Uma portfolio is now over budget' });
  });

  it('notifications: unread count, mark read, read all, ownership', async () => {
    const before = (await call('GET', '/notifications?limit=2', uma));
    expect(before.body.items).toHaveLength(2);
    expect(Number(before.headers['x-total-count'])).toBe(before.body.total);
    const id = before.body.items[0].id;
    expect((await call('POST', `/notifications/${id}/read`, otto)).status).toBe(404);
    expect((await call('POST', `/notifications/${id}/read`, uma)).status).toBe(204);
    expect((await call('GET', '/notifications', uma)).body.unread).toBe(before.body.unread - 1);
    await call('POST', '/notifications/read-all', uma);
    expect((await call('GET', '/notifications', uma)).body.unread).toBe(0);
  });
});

describe('analytics', () => {
  it('overview: catalogue, freshness, price index, my portfolios', async () => {
    const r = (await call('GET', '/analytics/overview', uma)).body;
    expect(r.catalogue.models).toBeGreaterThanOrEqual(9);
    expect(r.freshness.thresholdHours).toBe(24);
    expect(r.priceIndex.length).toBeGreaterThan(0);
    expect(r.priceIndex[0]).toHaveProperty('avgInputPrice');
    expect(r.portfolios).toMatchObject({ count: 1, overBudget: 1 });
    expect(r.portfolios.providerExposure[0].provider).toBe('Atlas Labs');
  });

  it('price history and cost-vs-quality', async () => {
    const h = (await call('GET', `/analytics/price-history?modelIds=${models['GPT-class Frontier'].id}`, uma)).body;
    expect(h[0].points.map((p: any) => p.inputPrice)).toEqual(['5.0000', '10.0000', '100.0000']);
    expect((await call('GET', '/analytics/price-history?modelIds=abc', uma)).status).toBe(400);
    const cq = (await call('GET', `/analytics/cost-quality?workloadId=${workloadId}`, uma)).body;
    expect(cq.workload.name).toBe('Chat');
    const mini = cq.points.find((p: any) => p.name === 'GPT-class Mini');
    expect(mini).toMatchObject({ monthlyCost: '2.0000', overallScore: 76, eligible: true });
    expect((await call('GET', `/analytics/cost-quality?workloadId=${workloadId}`, otto)).status).toBe(404);
  });
});

describe('pilot feedback and evaluation metrics', () => {
  it('stores one clarity rating per user per recommendation', async () => {
    expect((await call('PUT', `/recommendations/${recommendationId}/feedback`, uma, { clarityRating: 6 })).status).toBe(400);
    expect((await call('PUT', `/recommendations/${recommendationId}/feedback`, otto, { clarityRating: 5 })).status).toBe(404);
    await call('PUT', `/recommendations/${recommendationId}/feedback`, uma, { clarityRating: 3 });
    const r = await call('PUT', `/recommendations/${recommendationId}/feedback`, uma, { clarityRating: 5, priorModelId: models['Balanced Pro'].id, comment: 'Clear' });
    expect(r.body).toEqual({ clarityRating: 5, priorModelId: models['Balanced Pro'].id, comment: 'Clear' });
    expect((await call('GET', `/recommendations/${recommendationId}/feedback`, uma)).body.clarityRating).toBe(5);
  });

  it('evaluation dashboard reports every proposal metric', async () => {
    expect((await call('GET', '/admin/evaluation', uma)).status).toBe(403);
    const e = (await call('GET', '/admin/evaluation', admin)).body;
    expect(e.costCorrectness).toMatchObject({ passed: 17, total: 17, rate: 100 });
    expect(e.budgetCompliance.rate).toBe(100);
    expect(e.usability).toEqual({ responses: 1, averageClarity: 5 });
    expect(e.pilot.comparisons[0]).toMatchObject({ priorModel: 'Balanced Pro', priorCost: '18.00', priorCoversRequirements: true });
    expect(e.responsiveness.p95Ms).toBeLessThan(e.targets.responsivenessMs);
    expect(e.availability.rate).toBe(100);
  });

  it('ops dashboard shows request metrics, runtime and counts', async () => {
    const o = (await call('GET', '/admin/ops', admin)).body;
    expect(o.metrics.routes.some((r: any) => r.route === '/models' || r.route === 'GET /models')).toBe(true);
    expect(o.runtime.cache).toBe('memory');
    expect(o.runtime.jobs).toBe('inline');
    expect(o.counts.portfolios).toBe(1);
    expect(o.lastIngestion.status).toBeDefined();
  });
});

describe('security and health', () => {
  it('sends security headers and a readiness check', async () => {
    const r = await call('GET', '/health/ready');
    expect(r.body).toMatchObject({ ok: true, database: 'up' });
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('rate-limits credential endpoints', async () => {
    const limited = await buildApp({ db, authRateLimit: 2 });
    try {
      const attempt = () => call('POST', '/auth/login', undefined, { email: 'uma@example.test', password: 'wrong-password' }, limited);
      expect((await attempt()).status).toBe(401);
      expect((await attempt()).status).toBe(401);
      const third = await attempt();
      expect(third.status).toBe(429);
      expect(third.body.message).toBe('Too many attempts. Wait a minute and try again.');
    } finally {
      await limited.close();
    }
  });
});

describe.runIf(!!process.env.REDIS_URL)('Redis queue and cache (CI)', () => {
  it('runs ingestion through the BullMQ worker and caches in Redis', async () => {
    const redisUrl = process.env.REDIS_URL!;
    const queued = await buildApp({ db, redisUrl, authRateLimit: 1000 });
    const stop = await startScheduler(db, queued.cache, redisUrl, () => {});
    try {
      expect(queued.cache.kind).toBe('redis');
      const src = (await call('POST', '/admin/ingestion/sources', admin, { name: 'Queued feed', kind: 'FILE', location: 'update-feed.json' }, queued)).body;
      const before = (await db.query(`SELECT count(*)::int AS n FROM ingestion_run WHERE source_id = $1`, [src.id])).rows[0].n;
      const r = await call('POST', `/admin/ingestion/sources/${src.id}/run`, admin, undefined, queued);
      expect(r.status).toBe(202);
      let done = null;
      for (let i = 0; i < 60 && !done; i++) {
        await new Promise((res) => setTimeout(res, 250));
        const q = await db.query(`SELECT status FROM ingestion_run WHERE source_id = $1 AND status <> 'RUNNING' ORDER BY run_id DESC LIMIT 1`, [src.id]);
        if (q.rows.length > 0 && q.rows.length + before > before) done = q.rows[0].status;
      }
      expect(done).toBe('PARTIAL');
      await call('GET', '/models', uma, undefined, queued);
      await call('GET', '/models', uma, undefined, queued);
      expect(queued.cache.stats().hits).toBeGreaterThan(0);
    } finally {
      await stop();
      await queued.close();
    }
  });
});
