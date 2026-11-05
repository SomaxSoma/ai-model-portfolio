import { CAPABILITY_KEYS, Decimal, LIMITS, MODEL_STATUSES, parseMoney, type ModelStatus } from '@pf/domain';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';
import { config } from '../config.js';
import { withTransaction, type Db, type Queryable } from '../db.js';
import { createModel, createProvider, findModelByKey, findProviderByName, getModel, markVerified, updateModel, type ModelDto, type ModelPatch } from '../repositories/catalogue.js';
import { notifyAdmins, notifyCatalogueChanges, type CatalogueChange } from './alerts.js';

/**
 * Data ingestion layer (proposal §4.2 step 1): pull a catalogue feed from a
 * permitted source, normalise and validate every record, apply changes through
 * the catalogue repository (so history rows are always written), flag data
 * quality issues for admin review, then alert affected portfolio owners.
 */

export type IssueKind = 'INVALID_RECORD' | 'MISSING_FIELDS' | 'PRICE_JUMP' | 'BENCHMARK_JUMP' | 'STALE_DATA' | 'SOURCE_ERROR';

export const QUALITY_RULES = {
  /** A price change bigger than this fraction is applied but flagged for review. */
  priceJumpRatio: 0.5,
  /** A benchmark change of more points than this is flagged. */
  benchmarkJumpPoints: 15,
  /** Figures older than this are stale (proposal §6.2: reflected within 24 hours). */
  freshnessHours: 24,
  maxFeedBytes: 5 * 1024 * 1024,
  fetchTimeoutMs: 15_000,
} as const;

// ---------------------------------------------------------------------------
// Feed format
// ---------------------------------------------------------------------------
const money = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const r = parseMoney(v, 'price', { allowZero: true, max: LIMITS.maxPricePerMillion });
  if (r.error) {
    ctx.addIssue({ code: 'custom', message: r.error });
    return z.NEVER;
  }
  return r.value!;
});
const score = z.number().int().min(0).max(100);

export const feedRecord = z.object({
  provider: z.string().trim().min(2).max(120),
  name: z.string().trim().min(1).max(120),
  version: z.string().trim().max(60).default(''),
  contextWindow: z.number().int().positive().max(100_000_000),
  inputPrice: money,
  outputPrice: money,
  codingScore: score.optional(),
  reasoningScore: score.optional(),
  latencyMs: z.number().int().positive().max(600_000).nullish(),
  reliability: z.number().min(0).max(100).nullish(),
  status: z.enum(MODEL_STATUSES as [ModelStatus, ...ModelStatus[]]).default('ACTIVE'),
  deprecationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullish(),
  capabilities: z.array(z.string()).default([]).transform((a) => [...new Set(a.filter((c) => CAPABILITY_KEYS.includes(c)))]),
});
export type FeedRecord = z.output<typeof feedRecord>;

const feedEnvelope = z.object({
  source: z.string().optional(),
  generatedAt: z.string().optional(),
  models: z.array(z.unknown()).max(5000),
});

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------
export interface SourceRow {
  id: number;
  name: string;
  kind: 'FILE' | 'HTTP';
  location: string;
  enabled: boolean;
  scheduleMinutes: number;
  lastRunAt: string | null;
}

export const toSource = (r: any): SourceRow => ({
  id: r.source_id,
  name: r.name,
  kind: r.kind,
  location: r.location,
  enabled: r.enabled,
  scheduleMinutes: r.schedule_minutes,
  lastRunAt: r.last_run_at ? r.last_run_at.toISOString() : null,
});

/** FILE sources are confined to the data directory, so a source can't read arbitrary files. */
export function resolveFileLocation(location: string): string | null {
  const full = resolve(config.dataDir, location);
  const rel = relative(config.dataDir, full);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return full;
}

async function loadFeed(source: SourceRow): Promise<unknown> {
  if (source.kind === 'FILE') {
    const path = resolveFileLocation(source.location);
    if (!path) throw new Error('The file must be inside the data folder.');
    const text = await readFile(path, 'utf8');
    if (text.length > QUALITY_RULES.maxFeedBytes) throw new Error('The feed is larger than 5 MB.');
    return JSON.parse(text);
  }
  const url = new URL(source.location);
  if (url.protocol !== 'https:' && !(config.allowHttpSources && url.protocol === 'http:')) throw new Error('Only https:// sources are allowed.');
  const res = await fetch(url, { signal: AbortSignal.timeout(QUALITY_RULES.fetchTimeoutMs), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`The source answered ${res.status}.`);
  const text = await res.text();
  if (text.length > QUALITY_RULES.maxFeedBytes) throw new Error('The feed is larger than 5 MB.');
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// Data quality issues
// ---------------------------------------------------------------------------
export async function openIssue(db: Queryable, i: { modelId?: number | null; runId?: number | null; kind: IssueKind; severity: 'WARNING' | 'ERROR'; message: string }): Promise<boolean> {
  if (i.modelId) {
    const r = await db.query(
      `INSERT INTO data_quality_issue (model_id, run_id, kind, severity, message) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (model_id, kind) WHERE resolved_at IS NULL AND model_id IS NOT NULL DO UPDATE SET message = EXCLUDED.message, run_id = EXCLUDED.run_id
       RETURNING (xmax = 0) AS inserted`,
      [i.modelId, i.runId ?? null, i.kind, i.severity, i.message],
    );
    return r.rows[0].inserted;
  }
  await db.query(`INSERT INTO data_quality_issue (run_id, kind, severity, message) VALUES ($1, $2, $3, $4)`, [i.runId ?? null, i.kind, i.severity, i.message]);
  return true;
}

/** Flags available models whose figures no source has confirmed within the freshness window. */
export async function checkFreshness(db: Queryable): Promise<number> {
  const r = await db.query(
    `SELECT model_id, name FROM ai_model WHERE status = 'ACTIVE' AND last_verified_at < now() - make_interval(hours => $1)`,
    [QUALITY_RULES.freshnessHours],
  );
  let opened = 0;
  for (const m of r.rows) {
    if (await openIssue(db, { modelId: m.model_id, kind: 'STALE_DATA', severity: 'WARNING', message: `${m.name}'s figures haven't been confirmed by any source in over ${QUALITY_RULES.freshnessHours} hours.` })) opened++;
  }
  return opened;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
export interface RunResult {
  id: number;
  sourceId: number;
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  recordsSeen: number;
  modelsCreated: number;
  modelsUpdated: number;
  recordsRejected: number;
  issuesFound: number;
  error: string | null;
}

export async function runIngestion(db: Db, sourceId: number, trigger: 'SCHEDULE' | 'MANUAL', onCatalogueChanged?: () => Promise<void>): Promise<RunResult> {
  const src = await db.query(`SELECT * FROM ingestion_source WHERE source_id = $1`, [sourceId]);
  if (!src.rows[0]) throw new Error(`Unknown ingestion source ${sourceId}`);
  const source = toSource(src.rows[0]);
  const run = await db.query(`INSERT INTO ingestion_run (source_id, trigger, status) VALUES ($1, $2, 'RUNNING') RETURNING run_id`, [sourceId, trigger]);
  const runId: number = run.rows[0].run_id;
  await db.query(`UPDATE ingestion_source SET last_run_at = now() WHERE source_id = $1`, [sourceId]);

  const counts = { recordsSeen: 0, modelsCreated: 0, modelsUpdated: 0, recordsRejected: 0, issuesFound: 0 };
  const changes: CatalogueChange[] = [];
  const verified: number[] = [];
  const label = source.name;

  const finish = async (status: RunResult['status'], error: string | null): Promise<RunResult> => {
    await db.query(
      `UPDATE ingestion_run SET status = $2, finished_at = clock_timestamp(), records_seen = $3, models_created = $4, models_updated = $5, records_rejected = $6, issues_found = $7, error = $8 WHERE run_id = $1`,
      [runId, status, counts.recordsSeen, counts.modelsCreated, counts.modelsUpdated, counts.recordsRejected, counts.issuesFound, error],
    );
    return { id: runId, sourceId, status, ...counts, error };
  };

  let envelope: z.output<typeof feedEnvelope>;
  try {
    const parsed = feedEnvelope.safeParse(await loadFeed(source));
    if (!parsed.success) throw new Error('The feed isn’t in the expected format: it needs a "models" list.');
    envelope = parsed.data;
  } catch (err) {
    const message = err instanceof SyntaxError ? 'The feed isn’t valid JSON.' : (err as Error).message;
    await openIssue(db, { runId, kind: 'SOURCE_ERROR', severity: 'ERROR', message: `${source.name}: ${message}` });
    counts.issuesFound++;
    await notifyAdmins(db, { kind: 'INGESTION_FAILED', severity: 'WARNING', title: `Ingestion from ${source.name} failed`, body: message, link: '/admin?tab=ingestion' });
    return finish('FAILED', message);
  }

  for (const [index, raw] of envelope.models.entries()) {
    counts.recordsSeen++;
    const rec = feedRecord.safeParse(raw);
    if (!rec.success) {
      counts.recordsRejected++;
      const where = rec.error.issues[0];
      const name = (raw as { name?: unknown })?.name;
      await openIssue(db, { runId, kind: 'INVALID_RECORD', severity: 'ERROR', message: `Record ${index + 1}${typeof name === 'string' ? ` (${name})` : ''} was rejected: ${where?.path.join('.') || 'record'} — ${(where?.message ?? 'invalid').replace(/\.$/, '')}.` });
      counts.issuesFound++;
      continue;
    }
    const r = rec.data;
    // Effects of this record count only once its transaction commits.
    const local = { created: 0, updated: 0, rejected: 0, issues: 0, verified: [] as number[], changes: [] as CatalogueChange[] };
    try {
      await withTransaction(db, async (tx) => {
        const providerId = (await findProviderByName(tx, r.provider)) ?? (await createProvider(tx, { name: r.provider, description: `Added by ingestion from ${source.name}.` })).id;
        const current = await findModelByKey(tx, providerId, r.name, r.version);

        if (!current) {
          if (r.codingScore === undefined || r.reasoningScore === undefined) {
            local.rejected++;
            await openIssue(tx, { runId, kind: 'MISSING_FIELDS', severity: 'WARNING', message: `${r.provider} ${r.name} ${r.version} is new but has no benchmark scores, so it wasn’t added.` });
            local.issues++;
            return;
          }
          const id = await createModel(tx, { providerId, name: r.name, version: r.version, contextWindow: r.contextWindow, inputPrice: r.inputPrice, outputPrice: r.outputPrice, codingScore: r.codingScore, reasoningScore: r.reasoningScore, status: r.status, capabilities: r.capabilities, latencyMs: r.latencyMs ?? null, reliability: r.reliability ?? null, deprecationDate: r.deprecationDate ?? null }, label);
          local.created++;
          local.verified.push(id);
          return;
        }

        // Quality checks on existing models: apply, but flag big jumps for review.
        const jump = (oldV: string, newV: string) => !new Decimal(oldV).isZero() && new Decimal(newV).minus(oldV).abs().div(oldV).gt(QUALITY_RULES.priceJumpRatio);
        if (jump(current.inputPrice, r.inputPrice) || jump(current.outputPrice, r.outputPrice)) {
          await openIssue(tx, { modelId: current.id, runId, kind: 'PRICE_JUMP', severity: 'WARNING', message: `${current.name}: price moved by more than ${QUALITY_RULES.priceJumpRatio * 100}% (input ${current.inputPrice} → ${r.inputPrice}, output ${current.outputPrice} → ${r.outputPrice}). Applied; please verify against the provider.` });
          local.issues++;
        }
        const scoreJump = (a: number, b: number | undefined) => b !== undefined && Math.abs(a - b) > QUALITY_RULES.benchmarkJumpPoints;
        if (scoreJump(current.codingScore, r.codingScore) || scoreJump(current.reasoningScore, r.reasoningScore)) {
          await openIssue(tx, { modelId: current.id, runId, kind: 'BENCHMARK_JUMP', severity: 'WARNING', message: `${current.name}: a benchmark score moved by more than ${QUALITY_RULES.benchmarkJumpPoints} points. Check the source's methodology before relying on it.` });
          local.issues++;
        }

        const patch: ModelPatch = {
          contextWindow: r.contextWindow,
          inputPrice: r.inputPrice,
          outputPrice: r.outputPrice,
          codingScore: r.codingScore,
          reasoningScore: r.reasoningScore,
          status: r.status,
          capabilities: r.capabilities,
          ...(r.latencyMs !== undefined ? { latencyMs: r.latencyMs } : {}),
          ...(r.reliability !== undefined ? { reliability: r.reliability } : {}),
          ...(r.deprecationDate !== undefined ? { deprecationDate: r.deprecationDate } : {}),
        };
        await tx.query('SELECT 1 FROM ai_model WHERE model_id = $1 FOR UPDATE', [current.id]);
        if (await updateModel(tx, current, patch, label)) {
          local.updated++;
          local.changes.push({ before: current, after: (await getModel(tx, current.id)) as ModelDto });
        }
        local.verified.push(current.id);
      });
      counts.modelsCreated += local.created;
      counts.modelsUpdated += local.updated;
      counts.recordsRejected += local.rejected;
      counts.issuesFound += local.issues;
      verified.push(...local.verified);
      changes.push(...local.changes);
    } catch (err) {
      counts.recordsRejected++;
      await openIssue(db, { runId, kind: 'INVALID_RECORD', severity: 'ERROR', message: `${r.provider} ${r.name}: ${(err as Error).message}` });
      counts.issuesFound++;
    }
  }

  await markVerified(db, verified);
  if (changes.length || counts.modelsCreated) await onCatalogueChanged?.();
  await notifyCatalogueChanges(db, changes);
  if (counts.issuesFound) {
    await notifyAdmins(db, {
      kind: 'DATA_QUALITY',
      severity: 'WARNING',
      title: `${counts.issuesFound} data-quality ${counts.issuesFound === 1 ? 'issue' : 'issues'} from ${source.name}`,
      body: 'Review them in the admin console before relying on the affected figures.',
      link: '/admin?tab=quality',
    });
  }
  return finish(counts.recordsRejected ? 'PARTIAL' : 'SUCCEEDED', null);
}

/** Sources whose schedule says they should run now. */
export async function dueSources(db: Queryable): Promise<number[]> {
  const r = await db.query(
    `SELECT source_id FROM ingestion_source
      WHERE enabled AND (last_run_at IS NULL OR last_run_at <= now() - make_interval(mins => schedule_minutes))
      ORDER BY source_id`,
  );
  return r.rows.map((x) => x.source_id);
}
