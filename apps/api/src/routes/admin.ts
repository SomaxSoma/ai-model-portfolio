import { capabilityLabel, GOLDEN_COST_CASES, isEligible, monthlyCost, Decimal } from '@pf/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../auth.js';
import { badRequest, conflict, notFound, zodFieldErrors } from '../errors.js';
import { QUALITY_RULES, resolveFileLocation, toSource } from '../services/ingestion.js';
import { catalogueModels } from './planning.js';

const idParam = z.object({ id: z.coerce.number().int().positive() });
function parseId(params: unknown, what: string): number {
  const r = idParam.safeParse(params);
  if (!r.success) throw notFound(what);
  return r.data.id;
}
const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const sourceFields = {
  name: z.string({ error: 'Give the source a name.' }).trim().min(2, 'The name needs at least 2 characters.').max(120),
  kind: z.enum(['FILE', 'HTTP'], { error: 'Choose a file or a web address.' }),
  location: z.string({ error: 'Enter where the feed lives.' }).trim().min(1, 'Enter where the feed lives.').max(500),
  enabled: z.boolean().default(true),
  scheduleMinutes: z.number({ error: 'Enter how often to check, in minutes.' }).int('Use whole minutes.').min(5, 'Check at most every 5 minutes.').max(10080, 'Check at least once a week.').default(60),
};
const sourceBody = z.object(sourceFields);
const sourcePatch = z.object(sourceFields).partial().strict();

const TARGETS = {
  costCorrectness: 100,
  budgetCompliance: 100,
  freshness: 100,
  responsivenessMs: 2000,
  availability: 99,
  clarity: 4,
} as const;

function checkLocation(kind: 'FILE' | 'HTTP', location: string): string | null {
  if (kind === 'FILE') return resolveFileLocation(location) ? null : 'Use a file name inside the data folder, such as sample-feed.json.';
  try {
    const u = new URL(location);
    return u.protocol === 'https:' || u.protocol === 'http:' ? null : 'Enter a web address starting with https://';
  } catch {
    return 'Enter a web address starting with https://';
  }
}

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  // ---- ingestion sources -----------------------------------------------------
  app.get('/admin/ingestion/sources', async () => {
    const r = await app.db.query(`SELECT * FROM ingestion_source ORDER BY name`);
    return r.rows.map(toSource);
  });

  app.post('/admin/ingestion/sources', async (request, reply) => {
    const parsed = sourceBody.safeParse(request.body ?? {});
    if (!parsed.success) throw badRequest(zodFieldErrors(parsed.error.issues));
    const s = parsed.data;
    const locErr = checkLocation(s.kind, s.location);
    if (locErr) throw badRequest({ location: locErr });
    try {
      const r = await app.db.query(
        `INSERT INTO ingestion_source (name, kind, location, enabled, schedule_minutes) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [s.name, s.kind, s.location, s.enabled, s.scheduleMinutes],
      );
      return reply.code(201).send(toSource(r.rows[0]));
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw conflict({ name: 'A source with this name already exists.' }, 'That source already exists.');
      throw err;
    }
  });

  app.patch('/admin/ingestion/sources/:id', async (request) => {
    const id = parseId(request.params, 'That source');
    const parsed = sourcePatch.safeParse(request.body ?? {});
    if (!parsed.success) throw badRequest(zodFieldErrors(parsed.error.issues));
    const cur = await app.db.query(`SELECT * FROM ingestion_source WHERE source_id = $1`, [id]);
    if (!cur.rows[0]) throw notFound('That source');
    const next = { ...toSource(cur.rows[0]), ...parsed.data };
    const locErr = checkLocation(next.kind, next.location);
    if (locErr) throw badRequest({ location: locErr });
    const r = await app.db.query(
      `UPDATE ingestion_source SET name = $2, kind = $3, location = $4, enabled = $5, schedule_minutes = $6 WHERE source_id = $1 RETURNING *`,
      [id, next.name, next.kind, next.location, next.enabled, next.scheduleMinutes],
    );
    return toSource(r.rows[0]);
  });

  /** Run a source now. With a queue: 202 and the worker runs it; inline: 201 with the result. */
  app.post('/admin/ingestion/sources/:id/run', async (request, reply) => {
    const id = parseId(request.params, 'That source');
    const exists = await app.db.query(`SELECT 1 FROM ingestion_source WHERE source_id = $1`, [id]);
    if (!exists.rowCount) throw notFound('That source');
    const result = await app.jobs.ingestNow(id);
    return result ? reply.code(201).send(result) : reply.code(202).send({ status: 'QUEUED' });
  });

  app.get('/admin/ingestion/runs', async (request, reply) => {
    const q = pageQuery.safeParse(request.query ?? {});
    if (!q.success) throw badRequest(zodFieldErrors(q.error.issues));
    const [rows, total] = await Promise.all([
      app.db.query(
        `SELECT r.*, s.name AS source_name FROM ingestion_run r JOIN ingestion_source s ON s.source_id = r.source_id
          ORDER BY r.started_at DESC, r.run_id DESC LIMIT $1 OFFSET $2`,
        [q.data.limit, q.data.offset],
      ),
      app.db.query(`SELECT count(*)::int AS n FROM ingestion_run`),
    ]);
    reply.header('X-Total-Count', String(total.rows[0].n));
    return rows.rows.map((r) => ({
      id: r.run_id,
      sourceId: r.source_id,
      sourceName: r.source_name,
      trigger: r.trigger,
      status: r.status,
      startedAt: r.started_at.toISOString(),
      finishedAt: r.finished_at ? r.finished_at.toISOString() : null,
      recordsSeen: r.records_seen,
      modelsCreated: r.models_created,
      modelsUpdated: r.models_updated,
      recordsRejected: r.records_rejected,
      issuesFound: r.issues_found,
      error: r.error,
    }));
  });

  // ---- data quality ----------------------------------------------------------
  app.get('/admin/data-quality', async (request) => {
    const status = (request.query as { status?: string } | null)?.status === 'resolved' ? 'resolved' : 'open';
    const r = await app.db.query(
      `SELECT i.*, m.name AS model_name FROM data_quality_issue i LEFT JOIN ai_model m ON m.model_id = i.model_id
        WHERE ${status === 'open' ? 'i.resolved_at IS NULL' : 'i.resolved_at IS NOT NULL'}
        ORDER BY i.detected_at DESC, i.issue_id DESC LIMIT 200`,
    );
    return r.rows.map((x) => ({
      id: x.issue_id,
      modelId: x.model_id,
      modelName: x.model_name,
      runId: x.run_id,
      kind: x.kind,
      severity: x.severity,
      message: x.message,
      detectedAt: x.detected_at.toISOString(),
      resolvedAt: x.resolved_at ? x.resolved_at.toISOString() : null,
    }));
  });

  app.post('/admin/data-quality/:id/resolve', async (request, reply) => {
    const id = parseId(request.params, 'That issue');
    const r = await app.db.query(`UPDATE data_quality_issue SET resolved_at = now(), resolved_by = $2 WHERE issue_id = $1 AND resolved_at IS NULL`, [id, request.account.id]);
    if (!r.rowCount) throw notFound('That open issue');
    return reply.code(204).send();
  });

  // ---- operations -------------------------------------------------------------
  app.get('/admin/ops', async () => {
    const dbStart = Date.now();
    const counts = await app.db.query(`SELECT
      (SELECT count(*)::int FROM app_user) AS users,
      (SELECT count(*)::int FROM ai_model) AS models,
      (SELECT count(*)::int FROM workload) AS workloads,
      (SELECT count(*)::int FROM recommendation) AS recommendations,
      (SELECT count(*)::int FROM portfolio) AS portfolios,
      (SELECT count(*)::int FROM data_quality_issue WHERE resolved_at IS NULL) AS open_issues,
      (SELECT count(*)::int FROM notification WHERE read_at IS NULL) AS unread_notifications`);
    const dbLatencyMs = Date.now() - dbStart;
    const lastRun = await app.db.query(`SELECT r.status, r.started_at, s.name FROM ingestion_run r JOIN ingestion_source s USING (source_id) ORDER BY r.started_at DESC LIMIT 1`);
    const c = counts.rows[0];
    return {
      metrics: app.metrics.summary(),
      runtime: { node: process.version, memoryMb: Math.round(process.memoryUsage().rss / 1048576), cache: app.cache.kind, cacheStats: app.cache.stats(), jobs: app.jobs.mode },
      database: { up: true, latencyMs: dbLatencyMs },
      counts: {
        users: c.users,
        models: c.models,
        workloads: c.workloads,
        recommendations: c.recommendations,
        portfolios: c.portfolios,
        openIssues: c.open_issues,
        unreadNotifications: c.unread_notifications,
      },
      lastIngestion: lastRun.rows[0] ? { status: lastRun.rows[0].status, startedAt: lastRun.rows[0].started_at.toISOString(), source: lastRun.rows[0].name } : null,
    };
  });

  // ---- evaluation metrics (proposal §6) --------------------------------------
  app.get('/admin/evaluation', async () => {
    // §6.1 primary: cost-calculation correctness against hand-verified cases.
    const cases = GOLDEN_COST_CASES.map((c) => {
      const actual = monthlyCost(c.model, c.workload, c.share).toFixed(4);
      return { id: c.id, description: c.description, expected: c.expected, actual, pass: actual === c.expected };
    });
    const passed = cases.filter((c) => c.pass).length;

    // §6.2 budget compliance: every recommendation that says it fits really fits.
    const recs = await app.db.query(`SELECT r.within_budget, r.estimated_cost, w.budget FROM recommendation r JOIN workload w USING (workload_id)`);
    const claimed = recs.rows.filter((r) => r.within_budget);
    const verified = claimed.filter((r) => new Decimal(r.estimated_cost).lte(r.budget)).length;

    // §6.2 freshness.
    const models = (await catalogueModels(app.db, app.cache)).filter((m) => m.status === 'ACTIVE');
    const cutoff = Date.now() - QUALITY_RULES.freshnessHours * 3600_000;
    const fresh = models.filter((m) => Date.parse(m.lastVerifiedAt) >= cutoff).length;

    // §6.2 responsiveness + availability from this instance's request metrics.
    const metrics = app.metrics.summary();

    // §6.2 usability + §6.3 pilot comparison.
    const fb = await app.db.query(
      `SELECT f.clarity_rating, f.prior_model_id, r.estimated_cost AS rec_cost,
              w.input_tokens, w.output_tokens, w.requests_per_month, w.required_capabilities
         FROM feedback f
         JOIN recommendation r ON r.recommendation_id = f.recommendation_id
         JOIN workload w ON w.workload_id = r.workload_id`,
    );
    const allModels = new Map((await catalogueModels(app.db, app.cache)).map((m) => [m.id, m]));
    const ratings = fb.rows.map((r) => r.clarity_rating as number);
    const comparisons = fb.rows
      .filter((r) => r.prior_model_id && allModels.has(r.prior_model_id))
      .map((r) => {
        const prior = allModels.get(r.prior_model_id)!;
        const volume = { inputTokens: r.input_tokens, outputTokens: r.output_tokens, requestsPerMonth: r.requests_per_month };
        const priorCost = monthlyCost(prior, volume);
        const covers = isEligible({ ...prior, status: 'ACTIVE' }, { ...volume, requiredCapabilities: r.required_capabilities });
        const saving = priorCost.isZero() ? 0 : priorCost.minus(r.rec_cost).div(priorCost).mul(100).toNumber();
        return { priorModel: prior.name, priorCost: priorCost.toFixed(2), recommendedCost: new Decimal(r.rec_cost).toFixed(2), savingPercent: Math.round(saving * 10) / 10, priorCoversRequirements: covers, missing: covers ? [] : r.required_capabilities.filter((c: string) => !prior.capabilities.includes(c)).map(capabilityLabel) };
      });

    const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);
    return {
      targets: TARGETS,
      costCorrectness: { passed, total: cases.length, rate: pct(passed, cases.length), cases },
      budgetCompliance: { recommendations: recs.rows.length, claimedWithinBudget: claimed.length, verified, rate: pct(verified, claimed.length) },
      freshness: { available: models.length, fresh, rate: pct(fresh, models.length), thresholdHours: QUALITY_RULES.freshnessHours },
      responsiveness: { p95Ms: metrics.p95Ms, requests: metrics.requests },
      availability: { rate: metrics.availability, requests: metrics.requests, serverErrors: metrics.serverErrors, uptimeSeconds: metrics.uptimeSeconds },
      usability: { responses: ratings.length, averageClarity: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 100) / 100 : null },
      pilot: {
        comparisons,
        averageSavingPercent: comparisons.length ? Math.round((comparisons.reduce((a, c) => a + c.savingPercent, 0) / comparisons.length) * 10) / 10 : null,
        priorChoicesMissingRequirements: comparisons.filter((c) => !c.priorCoversRequirements).length,
      },
    };
  });
}
