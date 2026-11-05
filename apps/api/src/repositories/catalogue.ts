import { Decimal, overallScore, type CatalogueModel, type ModelStatus } from '@pf/domain';
import type { Queryable, Tx } from '../db.js';

export interface ProviderDto {
  id: number;
  name: string;
  website: string | null;
  description: string | null;
  modelCount: number;
}

export interface ModelDto extends CatalogueModel {
  providerId: number;
  inputPrice: string;
  outputPrice: string;
  overallScore: number;
  latencyMs: number | null;
  reliability: number | null;
  deprecationDate: string | null;
  lastVerifiedAt: string;
  updatedAt: string;
}

export interface ModelHistory {
  pricing: { recordedAt: string; inputPrice: string; outputPrice: string; source: string }[];
  benchmarks: { recordedAt: string; codingScore: number; reasoningScore: number; latencyMs: number | null; reliability: number | null; source: string }[];
}

const MODEL_SELECT = `
  SELECT m.model_id, m.provider_id, p.name AS provider_name, m.name, m.version, m.context_window,
         m.input_price, m.output_price, m.coding_score, m.reasoning_score, m.status, m.capabilities,
         m.latency_ms, m.reliability, to_char(m.deprecation_date, 'YYYY-MM-DD') AS deprecation_date,
         m.last_verified_at, m.updated_at
    FROM ai_model m JOIN provider p ON p.provider_id = m.provider_id`;

interface ModelRow {
  model_id: number;
  provider_id: number;
  provider_name: string;
  name: string;
  version: string;
  context_window: number;
  input_price: string;
  output_price: string;
  coding_score: number;
  reasoning_score: number;
  status: ModelStatus;
  capabilities: string[];
  latency_ms: number | null;
  reliability: string | null;
  deprecation_date: string | null;
  last_verified_at: Date;
  updated_at: Date;
}

function toModel(r: ModelRow): ModelDto {
  const m = {
    id: r.model_id,
    providerId: r.provider_id,
    providerName: r.provider_name,
    name: r.name,
    version: r.version,
    contextWindow: r.context_window,
    inputPrice: r.input_price,
    outputPrice: r.output_price,
    codingScore: r.coding_score,
    reasoningScore: r.reasoning_score,
    status: r.status,
    capabilities: r.capabilities,
    latencyMs: r.latency_ms,
    reliability: r.reliability === null ? null : Number(r.reliability),
    deprecationDate: r.deprecation_date,
    lastVerifiedAt: r.last_verified_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
  return { ...m, overallScore: overallScore(m) };
}

export interface ModelFilter {
  capability?: string;
  search?: string;
  status?: ModelStatus;
}

export async function listModels(db: Queryable, filter: ModelFilter = {}): Promise<ModelDto[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (filter.capability) {
    args.push(JSON.stringify([filter.capability]));
    where.push(`m.capabilities @> $${args.length}::jsonb`);
  }
  if (filter.search) {
    args.push(`%${filter.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`(m.name ILIKE $${args.length} OR p.name ILIKE $${args.length} OR m.version ILIKE $${args.length})`);
  }
  if (filter.status) {
    args.push(filter.status);
    where.push(`m.status = $${args.length}`);
  }
  const sql = `${MODEL_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.name, m.name, m.version`;
  return (await db.query<ModelRow>(sql, args)).rows.map(toModel);
}

export async function getModel(db: Queryable, id: number): Promise<ModelDto | null> {
  const r = await db.query<ModelRow>(`${MODEL_SELECT} WHERE m.model_id = $1`, [id]);
  return r.rows[0] ? toModel(r.rows[0]) : null;
}

export async function findModelByKey(db: Queryable, providerId: number, name: string, version: string): Promise<ModelDto | null> {
  const r = await db.query<ModelRow>(`${MODEL_SELECT} WHERE m.provider_id = $1 AND m.name = $2 AND m.version = $3`, [providerId, name, version]);
  return r.rows[0] ? toModel(r.rows[0]) : null;
}

export async function getModelHistory(db: Queryable, id: number, opts: { limit?: number; offset?: number } = {}): Promise<ModelHistory & { totals: { pricing: number; benchmarks: number } }> {
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;
  const [pricing, benchmarks, totals] = await Promise.all([
    db.query(`SELECT recorded_at, input_price, output_price, source FROM pricing_history WHERE model_id = $1 ORDER BY recorded_at DESC, history_id DESC LIMIT $2 OFFSET $3`, [id, limit, offset]),
    db.query(`SELECT recorded_at, coding_score, reasoning_score, latency_ms, reliability, source FROM benchmark WHERE model_id = $1 ORDER BY recorded_at DESC, benchmark_id DESC LIMIT $2 OFFSET $3`, [id, limit, offset]),
    db.query(`SELECT (SELECT count(*)::int FROM pricing_history WHERE model_id = $1) AS p, (SELECT count(*)::int FROM benchmark WHERE model_id = $1) AS b`, [id]),
  ]);
  return {
    pricing: pricing.rows.map((r) => ({ recordedAt: r.recorded_at.toISOString(), inputPrice: r.input_price, outputPrice: r.output_price, source: r.source })),
    benchmarks: benchmarks.rows.map((r) => ({
      recordedAt: r.recorded_at.toISOString(),
      codingScore: r.coding_score,
      reasoningScore: r.reasoning_score,
      latencyMs: r.latency_ms,
      reliability: r.reliability === null ? null : Number(r.reliability),
      source: r.source,
    })),
    totals: { pricing: totals.rows[0].p, benchmarks: totals.rows[0].b },
  };
}

/** Every pricing history row, oldest first — for the analytics price index. */
export async function allPricingHistory(db: Queryable, modelIds?: number[]): Promise<{ modelId: number; recordedAt: Date; inputPrice: string; outputPrice: string }[]> {
  const r = await db.query(
    `SELECT model_id, recorded_at, input_price, output_price FROM pricing_history
      ${modelIds ? 'WHERE model_id = ANY($1::bigint[])' : ''}
      ORDER BY recorded_at, history_id`,
    modelIds ? [modelIds] : [],
  );
  return r.rows.map((x) => ({ modelId: x.model_id, recordedAt: x.recorded_at, inputPrice: x.input_price, outputPrice: x.output_price }));
}

export async function listProviders(db: Queryable): Promise<ProviderDto[]> {
  const r = await db.query(`
    SELECT p.provider_id, p.name, p.website, p.description, count(m.model_id)::int AS model_count
      FROM provider p LEFT JOIN ai_model m ON m.provider_id = p.provider_id
     GROUP BY p.provider_id ORDER BY p.name`);
  return r.rows.map((x) => ({ id: x.provider_id, name: x.name, website: x.website, description: x.description, modelCount: x.model_count }));
}

export async function findProviderByName(db: Queryable, name: string): Promise<number | null> {
  const r = await db.query(`SELECT provider_id FROM provider WHERE lower(name) = lower($1)`, [name]);
  return r.rows[0]?.provider_id ?? null;
}

export async function providerExists(db: Queryable, id: number): Promise<boolean> {
  return ((await db.query(`SELECT 1 FROM provider WHERE provider_id = $1`, [id])).rowCount ?? 0) > 0;
}

export async function createProvider(db: Queryable, p: { name: string; website?: string | null; description?: string | null }): Promise<ProviderDto> {
  const r = await db.query(`INSERT INTO provider (name, website, description) VALUES ($1, $2, $3) RETURNING provider_id`, [p.name, p.website ?? null, p.description ?? null]);
  return { id: r.rows[0].provider_id, name: p.name, website: p.website ?? null, description: p.description ?? null, modelCount: 0 };
}

// ---------------------------------------------------------------------------
// Denormalisation contract: the ONLY places that write ai_model's price,
// score and performance columns. Each inserts the history row and updates the
// model row in the same transaction, so the two can never drift.
// ---------------------------------------------------------------------------

export async function recordPricing(tx: Tx, modelId: number, p: { inputPrice: string; outputPrice: string; source: string }): Promise<void> {
  await tx.query(`INSERT INTO pricing_history (model_id, input_price, output_price, source) VALUES ($1, $2, $3, $4)`, [modelId, p.inputPrice, p.outputPrice, p.source]);
  await tx.query(`UPDATE ai_model SET input_price = $2, output_price = $3, updated_at = now() WHERE model_id = $1`, [modelId, p.inputPrice, p.outputPrice]);
}

export interface BenchmarkFigures {
  codingScore: number;
  reasoningScore: number;
  latencyMs: number | null;
  reliability: number | null;
}

export async function recordBenchmark(tx: Tx, modelId: number, b: BenchmarkFigures & { source: string }): Promise<void> {
  await tx.query(
    `INSERT INTO benchmark (model_id, coding_score, reasoning_score, latency_ms, reliability, source) VALUES ($1, $2, $3, $4, $5, $6)`,
    [modelId, b.codingScore, b.reasoningScore, b.latencyMs, b.reliability, b.source],
  );
  await tx.query(
    `UPDATE ai_model SET coding_score = $2, reasoning_score = $3, latency_ms = $4, reliability = $5, updated_at = now() WHERE model_id = $1`,
    [modelId, b.codingScore, b.reasoningScore, b.latencyMs, b.reliability],
  );
}

/** A source confirmed these models' figures just now (data freshness). */
export async function markVerified(db: Queryable, modelIds: number[]): Promise<void> {
  if (!modelIds.length) return;
  await db.query(`UPDATE ai_model SET last_verified_at = now() WHERE model_id = ANY($1::bigint[])`, [modelIds]);
  await db.query(
    `UPDATE data_quality_issue SET resolved_at = now() WHERE kind = 'STALE_DATA' AND resolved_at IS NULL AND model_id = ANY($1::bigint[])`,
    [modelIds],
  );
}

export interface NewModel {
  providerId: number;
  name: string;
  version: string;
  contextWindow: number;
  inputPrice: string;
  outputPrice: string;
  codingScore: number;
  reasoningScore: number;
  status: ModelStatus;
  capabilities: string[];
  latencyMs?: number | null;
  reliability?: number | null;
  deprecationDate?: string | null;
}

/** Creates a model with its first pricing and benchmark history rows. Call inside a transaction. */
export async function createModel(tx: Tx, m: NewModel, source: string): Promise<number> {
  const r = await tx.query(
    `INSERT INTO ai_model (provider_id, name, version, context_window, input_price, output_price, coding_score, reasoning_score, status, capabilities, latency_ms, reliability, deprecation_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING model_id`,
    [m.providerId, m.name, m.version, m.contextWindow, m.inputPrice, m.outputPrice, m.codingScore, m.reasoningScore, m.status, JSON.stringify(m.capabilities), m.latencyMs ?? null, m.reliability ?? null, m.deprecationDate ?? null],
  );
  const id: number = r.rows[0].model_id;
  await recordPricing(tx, id, { inputPrice: m.inputPrice, outputPrice: m.outputPrice, source });
  await recordBenchmark(tx, id, { codingScore: m.codingScore, reasoningScore: m.reasoningScore, latencyMs: m.latencyMs ?? null, reliability: m.reliability ?? null, source });
  return id;
}

export type ModelPatch = Partial<NewModel>;

/**
 * Applies an edit (admin console or ingestion). Price changes go through
 * recordPricing; score/latency/reliability changes through recordBenchmark.
 * Returns whether anything changed. Call inside a transaction.
 */
export async function updateModel(tx: Tx, current: ModelDto, patch: ModelPatch, source: string): Promise<boolean> {
  let changed = false;
  const inputPrice = patch.inputPrice ?? current.inputPrice;
  const outputPrice = patch.outputPrice ?? current.outputPrice;
  if (!sameDecimal(inputPrice, current.inputPrice) || !sameDecimal(outputPrice, current.outputPrice)) {
    await recordPricing(tx, current.id, { inputPrice, outputPrice, source });
    changed = true;
  }
  const figures: BenchmarkFigures = {
    codingScore: patch.codingScore ?? current.codingScore,
    reasoningScore: patch.reasoningScore ?? current.reasoningScore,
    latencyMs: patch.latencyMs !== undefined ? patch.latencyMs : current.latencyMs,
    reliability: patch.reliability !== undefined ? patch.reliability : current.reliability,
  };
  if (
    figures.codingScore !== current.codingScore ||
    figures.reasoningScore !== current.reasoningScore ||
    figures.latencyMs !== current.latencyMs ||
    !sameNullableNumber(figures.reliability, current.reliability)
  ) {
    await recordBenchmark(tx, current.id, { ...figures, source });
    changed = true;
  }

  const sets: string[] = [];
  const args: unknown[] = [current.id];
  const set = (col: string, v: unknown) => {
    args.push(v);
    sets.push(`${col} = $${args.length}`);
  };
  if (patch.providerId !== undefined && patch.providerId !== current.providerId) set('provider_id', patch.providerId);
  if (patch.name !== undefined && patch.name !== current.name) set('name', patch.name);
  if (patch.version !== undefined && patch.version !== current.version) set('version', patch.version);
  if (patch.contextWindow !== undefined && patch.contextWindow !== current.contextWindow) set('context_window', patch.contextWindow);
  if (patch.status !== undefined && patch.status !== current.status) set('status', patch.status);
  if (patch.capabilities !== undefined && JSON.stringify([...patch.capabilities].sort()) !== JSON.stringify([...current.capabilities].sort())) {
    set('capabilities', JSON.stringify(patch.capabilities));
  }
  if (patch.deprecationDate !== undefined && patch.deprecationDate !== current.deprecationDate) set('deprecation_date', patch.deprecationDate);
  if (sets.length) {
    await tx.query(`UPDATE ai_model SET ${sets.join(', ')}, updated_at = now() WHERE model_id = $1`, args);
    changed = true;
  }
  return changed;
}

function sameDecimal(a: string, b: string): boolean {
  return new Decimal(a).eq(b);
}

function sameNullableNumber(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return new Decimal(a).eq(b);
}
