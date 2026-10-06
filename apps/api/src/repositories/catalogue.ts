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
  updatedAt: string;
}

export interface ModelHistory {
  pricing: { recordedAt: string; inputPrice: string; outputPrice: string; source: string }[];
  benchmarks: { recordedAt: string; codingScore: number; reasoningScore: number; source: string }[];
}

const MODEL_SELECT = `
  SELECT m.model_id, m.provider_id, p.name AS provider_name, m.name, m.version, m.context_window,
         m.input_price, m.output_price, m.coding_score, m.reasoning_score, m.status, m.capabilities, m.updated_at
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

export async function getModelHistory(db: Queryable, id: number): Promise<ModelHistory> {
  const [pricing, benchmarks] = await Promise.all([
    db.query(`SELECT recorded_at, input_price, output_price, source FROM pricing_history WHERE model_id = $1 ORDER BY recorded_at DESC, history_id DESC`, [id]),
    db.query(`SELECT recorded_at, coding_score, reasoning_score, source FROM benchmark WHERE model_id = $1 ORDER BY recorded_at DESC, benchmark_id DESC`, [id]),
  ]);
  return {
    pricing: pricing.rows.map((r) => ({ recordedAt: r.recorded_at.toISOString(), inputPrice: r.input_price, outputPrice: r.output_price, source: r.source })),
    benchmarks: benchmarks.rows.map((r) => ({ recordedAt: r.recorded_at.toISOString(), codingScore: r.coding_score, reasoningScore: r.reasoning_score, source: r.source })),
  };
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
// Denormalisation contract: the ONLY places that write ai_model's price and
// score columns. Each inserts the history row and updates the model row in the
// same transaction, so the two can never drift.
// ---------------------------------------------------------------------------

export async function recordPricing(tx: Tx, modelId: number, p: { inputPrice: string; outputPrice: string; source: string }): Promise<void> {
  await tx.query(`INSERT INTO pricing_history (model_id, input_price, output_price, source) VALUES ($1, $2, $3, $4)`, [modelId, p.inputPrice, p.outputPrice, p.source]);
  await tx.query(`UPDATE ai_model SET input_price = $2, output_price = $3, updated_at = now() WHERE model_id = $1`, [modelId, p.inputPrice, p.outputPrice]);
}

export async function recordBenchmark(tx: Tx, modelId: number, b: { codingScore: number; reasoningScore: number; source: string }): Promise<void> {
  await tx.query(`INSERT INTO benchmark (model_id, coding_score, reasoning_score, source) VALUES ($1, $2, $3, $4)`, [modelId, b.codingScore, b.reasoningScore, b.source]);
  await tx.query(`UPDATE ai_model SET coding_score = $2, reasoning_score = $3, updated_at = now() WHERE model_id = $1`, [modelId, b.codingScore, b.reasoningScore]);
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
}

/** Creates a model with its first pricing and benchmark history rows. Call inside a transaction. */
export async function createModel(tx: Tx, m: NewModel, source: string): Promise<number> {
  const r = await tx.query(
    `INSERT INTO ai_model (provider_id, name, version, context_window, input_price, output_price, coding_score, reasoning_score, status, capabilities)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING model_id`,
    [m.providerId, m.name, m.version, m.contextWindow, m.inputPrice, m.outputPrice, m.codingScore, m.reasoningScore, m.status, JSON.stringify(m.capabilities)],
  );
  const id: number = r.rows[0].model_id;
  await recordPricing(tx, id, { inputPrice: m.inputPrice, outputPrice: m.outputPrice, source });
  await recordBenchmark(tx, id, { codingScore: m.codingScore, reasoningScore: m.reasoningScore, source });
  return id;
}

export type ModelPatch = Partial<NewModel>;

/**
 * Applies an admin edit. Price or score changes go through recordPricing /
 * recordBenchmark (history + model row). Call inside a transaction.
 */
export async function updateModel(tx: Tx, current: ModelDto, patch: ModelPatch, source: string): Promise<void> {
  const inputPrice = patch.inputPrice ?? current.inputPrice;
  const outputPrice = patch.outputPrice ?? current.outputPrice;
  if (!sameDecimal(inputPrice, current.inputPrice) || !sameDecimal(outputPrice, current.outputPrice)) {
    await recordPricing(tx, current.id, { inputPrice, outputPrice, source });
  }
  const codingScore = patch.codingScore ?? current.codingScore;
  const reasoningScore = patch.reasoningScore ?? current.reasoningScore;
  if (codingScore !== current.codingScore || reasoningScore !== current.reasoningScore) {
    await recordBenchmark(tx, current.id, { codingScore, reasoningScore, source });
  }

  const sets: string[] = [];
  const args: unknown[] = [current.id];
  const set = (col: string, v: unknown) => {
    args.push(v);
    sets.push(`${col} = $${args.length}`);
  };
  if (patch.providerId !== undefined) set('provider_id', patch.providerId);
  if (patch.name !== undefined) set('name', patch.name);
  if (patch.version !== undefined) set('version', patch.version);
  if (patch.contextWindow !== undefined) set('context_window', patch.contextWindow);
  if (patch.status !== undefined) set('status', patch.status);
  if (patch.capabilities !== undefined) set('capabilities', JSON.stringify(patch.capabilities));
  if (sets.length) await tx.query(`UPDATE ai_model SET ${sets.join(', ')}, updated_at = now() WHERE model_id = $1`, args);
}

function sameDecimal(a: string, b: string): boolean {
  return new Decimal(a).eq(b);
}
