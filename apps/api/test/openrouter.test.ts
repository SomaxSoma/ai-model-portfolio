import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, type Db } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { listModels } from '../src/repositories/catalogue.js';
import { runIngestion } from '../src/services/ingestion.js';
import { capabilitiesOf, perMillion, selectModels, splitName, toRecord } from '../src/services/openrouter.js';
import { freshDatabase } from './helpers.js';

// A trimmed copy of a real https://openrouter.ai/api/v1/models response (2026-11-05).
const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures', 'openrouter-models.json'), 'utf8')) as { data: any[] };

describe('OpenRouter mapping', () => {
  it('keeps one entry per benchmarked, fixed-price model', () => {
    const { kept, skipped } = selectModels(fixture.data);
    expect(kept.map((m) => m.id)).toEqual(['anthropic/claude-fable-5.1', 'openai/gpt-6-astra', 'inclusionai/ling-3.0-flash-vl', 'inception/mercury-2']);
    expect(skipped).toBe(4); // :free variant, ~ alias, no benchmark, variable-price router
  });

  it('converts per-token prices to USD per 1M tokens exactly', () => {
    expect(perMillion('0.0000001')).toBe('0.1000');
    expect(perMillion('0.00001')).toBe('10.0000');
    expect(perMillion('-1')).toBeNull();
    expect(perMillion(undefined)).toBeNull();
  });

  it('maps names, scores, capabilities and lifecycle', () => {
    const [fable, , ling, mercury] = selectModels(fixture.data).kept.map(toRecord);
    expect(fable).toMatchObject({ externalId: 'openrouter:anthropic/claude-fable-5.1', provider: 'Anthropic', name: 'Claude Fable 5.1', inputPrice: '10.0000', outputPrice: '50.0000', codingScore: 81, reasoningScore: 50 });
    expect(fable!.capabilities).toEqual(expect.arrayContaining(['vision', 'tool_use']));
    expect(ling!.reasoningScore).toBeNull(); // AA publishes no intelligence index for it
    expect(mercury!.deprecationDate).toBe('2026-11-08');
    expect(splitName({ id: 'acme/x', name: 'Plain' })).toEqual({ provider: 'Acme', name: 'Plain' });
    expect(capabilitiesOf({ id: 'a/b', name: 'b', context_length: 1, architecture: { input_modalities: ['text', 'audio'] }, supported_parameters: ['response_format'] })).toEqual(['audio', 'structured_output']);
  });
});

describe('OpenRouter ingestion (against a local stand-in server)', () => {
  let db: Db;
  let server: Server;
  let base: string;
  let models = fixture.data;
  let sourceId: number;

  beforeAll(async () => {
    db = createPool(await freshDatabase('openrouter'));
    await migrate(db);
    server = createServer((req, res) => {
      const url = req.url ?? '';
      if (url === '/api/v1/models') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: models }));
      const m = url.match(/^\/api\/v1\/models\/(.+)\/endpoints$/);
      if (m && m[1] === 'openai/gpt-6-astra') return res.writeHead(500).end();
      if (m) return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: { endpoints: [{ uptime_last_1d: 80.123 }, { uptime_last_1d: 99.456 }, { uptime_last_1d: null }] } }));
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
    sourceId = (await db.query(`INSERT INTO ingestion_source (name, kind, location) VALUES ('OpenRouter (test)', 'OPENROUTER', $1) RETURNING source_id`, [base])).rows[0].source_id;
  });

  afterAll(async () => {
    server?.close();
    await db?.end();
  });

  it('creates the live catalogue with real figures', async () => {
    const run = await runIngestion(db, sourceId, 'MANUAL');
    expect(run).toMatchObject({ status: 'SUCCEEDED', recordsSeen: 4, modelsCreated: 4, recordsRejected: 0 });
    const byName = Object.fromEntries((await listModels(db)).map((m) => [m.name, m]));
    expect(byName['Claude Fable 5.1']).toMatchObject({ providerName: 'Anthropic', externalId: 'openrouter:anthropic/claude-fable-5.1', reliability: 99.46, latencyMs: null });
    expect(byName['GPT-6 Astra']).toBeDefined();
    expect(byName['GPT-6 Astra']!.reliability).toBeNull(); // endpoints call failed → left empty, not invented
    expect(byName['Ling 3.0 Flash VL']).toBeDefined();
    expect(byName['Ling 3.0 Flash VL']!.reasoningScore).toBeNull();
    expect(byName['Ling 3.0 Flash VL']!.overallScore).toBe(57); // coding index stands alone
  });

  it('follows renames by stable id and retires models that leave the source', async () => {
    const [fable, astra, ling] = fixture.data;
    models = [{ ...fable, name: 'Anthropic: Claude Fable 5.1 (renamed)' }, astra, ling, ...fixture.data.slice(4)];
    const run = await runIngestion(db, sourceId, 'MANUAL');
    expect(run.status).toBe('SUCCEEDED');
    const all = await listModels(db);
    expect(all).toHaveLength(4); // renamed in place, no duplicate
    expect(all.find((m) => m.externalId === 'openrouter:anthropic/claude-fable-5.1')!.name).toBe('Claude Fable 5.1 (renamed)');
    expect(all.find((m) => m.externalId === 'openrouter:inception/mercury-2')!.status).toBe('RETIRED');
    const issues = await db.query(`SELECT kind FROM data_quality_issue WHERE kind = 'MODEL_REMOVED'`);
    expect(issues.rowCount).toBe(1);
  });

  it('a truncated response never retires the catalogue', async () => {
    models = [];
    const run = await runIngestion(db, sourceId, 'MANUAL');
    expect(run.recordsSeen).toBe(0);
    expect((await listModels(db, { status: 'ACTIVE' })).length).toBe(3);
    const guard = await db.query(`SELECT message FROM data_quality_issue WHERE kind = 'SOURCE_ERROR' ORDER BY issue_id DESC LIMIT 1`);
    expect(guard.rows[0].message).toMatch(/none were retired/);
  });
});
