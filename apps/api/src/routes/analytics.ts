import { analyzeRisk, Decimal, isEligible, moneyString, monthlyCost, sumMoney } from '@pf/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth.js';
import { cached, CACHE_KEYS } from '../cache.js';
import { badRequest, notFound, zodFieldErrors } from '../errors.js';
import { allPricingHistory } from '../repositories/catalogue.js';
import { listOwnPortfolios } from '../repositories/portfolios.js';
import { getOwnWorkload, listWorkloads } from '../repositories/workloads.js';
import { QUALITY_RULES } from '../services/ingestion.js';
import { catalogueModels, hydratePortfolio, modelsById } from './planning.js';

/** Reference volume when no workload is chosen: 1,000 requests of 1K input + 1K output tokens. */
export const REFERENCE_WORKLOAD = { inputTokens: 1000, outputTokens: 1000, requestsPerMonth: 1000 };

const historyQuery = z.object({
  modelIds: z
    .string()
    .regex(/^\d+(,\d+)*$/, 'List model ids separated by commas.')
    .transform((s) => [...new Set(s.split(',').map(Number))])
    .refine((a) => a.length <= 12, 'Compare at most 12 models at a time.')
    .optional(),
});
const costQualityQuery = z.object({ workloadId: z.coerce.number().int().positive().optional() });

/**
 * Average current price across the catalogue after each day with a price
 * change — a simple price index for the trend chart.
 */
export function priceIndex(rows: { modelId: number; recordedAt: Date; inputPrice: string; outputPrice: string }[]) {
  const current = new Map<number, { input: Decimal; output: Decimal }>();
  const byDay = new Map<string, { avgInputPrice: string; avgOutputPrice: string; models: number }>();
  for (const r of rows) {
    current.set(r.modelId, { input: new Decimal(r.inputPrice), output: new Decimal(r.outputPrice) });
    const n = current.size;
    const avgIn = sumMoney([...current.values()].map((v) => v.input)).div(n);
    const avgOut = sumMoney([...current.values()].map((v) => v.output)).div(n);
    byDay.set(r.recordedAt.toISOString().slice(0, 10), { avgInputPrice: moneyString(avgIn), avgOutputPrice: moneyString(avgOut), models: n });
  }
  return [...byDay.entries()].map(([date, v]) => ({ date, ...v }));
}

export async function analyticsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  /** Dashboard summary (proposal §9.1 "initial analytics dashboard"). */
  app.get('/analytics/overview', async (request) => {
    const userId = request.account.id;
    const models = await catalogueModels(app.db, app.cache);
    const available = models.filter((m) => m.status === 'ACTIVE');
    const freshCutoff = Date.now() - QUALITY_RULES.freshnessHours * 3600_000;

    const catalogue = await cached(app.cache, CACHE_KEYS.analytics, 300, async () => ({
      priceIndex: priceIndex(await allPricingHistory(app.db)),
    }));

    const avg = (pick: (m: (typeof available)[number]) => string) =>
      available.length ? moneyString(sumMoney(available.map(pick)).div(available.length)) : '0.0000';

    const byId = await modelsById(app.db, app.cache);
    const workloads = new Map((await listWorkloads(app.db, userId)).map((w) => [w.id, w]));
    const portfolios = (await listOwnPortfolios(app.db, userId)).map((p) => hydratePortfolio(p, workloads.get(p.workloadId)!, byId));
    const totalCost = sumMoney(portfolios.map((p) => p.estimatedCost));
    const sync = await app.db.query(
      `SELECT r.finished_at, s.name, s.kind FROM ingestion_run r JOIN ingestion_source s USING (source_id)
        WHERE r.status IN ('SUCCEEDED', 'PARTIAL') ORDER BY r.finished_at DESC NULLS LAST LIMIT 1`,
    );
    const allLines = portfolios.flatMap((p) => p.allocations);
    const exposure = analyzeRisk(allLines);

    return {
      catalogue: {
        models: models.length,
        available: available.length,
        providers: new Set(models.map((m) => m.providerName)).size,
        avgInputPrice: avg((m) => m.inputPrice),
        avgOutputPrice: avg((m) => m.outputPrice),
        deprecatingSoon: available.filter((m) => m.deprecationDate).length,
        /** When a source last delivered figures, and which. */
        lastSyncedAt: sync.rows[0]?.finished_at ? sync.rows[0].finished_at.toISOString() : null,
        lastSource: sync.rows[0]?.name ?? null,
        live: sync.rows[0]?.kind === 'OPENROUTER',
      },
      freshness: {
        available: available.length,
        fresh: available.filter((m) => Date.parse(m.lastVerifiedAt) >= freshCutoff).length,
        thresholdHours: QUALITY_RULES.freshnessHours,
        oldestVerifiedAt: available.length ? available.map((m) => m.lastVerifiedAt).sort()[0] : null,
      },
      priceIndex: catalogue.priceIndex,
      portfolios: {
        count: portfolios.length,
        totalMonthlyCost: moneyString(totalCost),
        totalBudget: moneyString(sumMoney(portfolios.map((p) => p.budget))),
        overBudget: portfolios.filter((p) => !p.withinBudget).length,
        items: portfolios.map((p) => ({ id: p.id, name: p.name, estimatedCost: p.estimatedCost, budget: p.budget, withinBudget: p.withinBudget, models: p.allocations.length })),
        /** Spend by provider across all saved portfolios. */
        providerExposure: exposure.providers.map((x) => ({ provider: x.provider, costShare: x.costShare })),
      },
    };
  });

  /** Price history per model, oldest first, for the trend chart. */
  app.get('/analytics/price-history', async (request) => {
    const q = historyQuery.safeParse(request.query ?? {});
    if (!q.success) throw badRequest(zodFieldErrors(q.error.issues));
    const byId = await modelsById(app.db, app.cache);
    const ids = q.data.modelIds ?? [...byId.values()].filter((m) => m.status === 'ACTIVE').map((m) => m.id);
    const rows = await allPricingHistory(app.db, ids);
    return ids
      .filter((id) => byId.has(id))
      .map((id) => {
        const m = byId.get(id)!;
        return {
          modelId: id,
          name: m.name,
          provider: m.providerName,
          points: rows.filter((r) => r.modelId === id).map((r) => ({ recordedAt: r.recordedAt.toISOString(), inputPrice: r.inputPrice, outputPrice: r.outputPrice })),
        };
      });
  });

  /** Cost vs quality for every available model — for a workload, or a reference volume. */
  app.get('/analytics/cost-quality', async (request) => {
    const q = costQualityQuery.safeParse(request.query ?? {});
    if (!q.success) throw badRequest(zodFieldErrors(q.error.issues));
    let volume = REFERENCE_WORKLOAD;
    let workload = null;
    if (q.data.workloadId) {
      workload = await getOwnWorkload(app.db, request.account.id, q.data.workloadId);
      if (!workload) throw notFound('That workload');
      volume = workload;
    }
    const models = (await catalogueModels(app.db, app.cache)).filter((m) => m.status === 'ACTIVE');
    return {
      workload: workload ? { id: workload.id, name: workload.name, budget: workload.budget } : null,
      reference: workload ? null : REFERENCE_WORKLOAD,
      points: models.map((m) => ({
        modelId: m.id,
        name: m.name,
        provider: m.providerName,
        overallScore: m.overallScore,
        monthlyCost: moneyString(monthlyCost(m, volume)),
        latencyMs: m.latencyMs,
        reliability: m.reliability,
        eligible: workload ? isEligible(m, workload) : true,
      })),
    };
  });
}
