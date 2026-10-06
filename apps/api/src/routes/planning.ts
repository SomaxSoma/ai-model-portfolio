import {
  blendedScore,
  checkPortfolio,
  costBreakdown,
  formatUsd,
  isEligible,
  moneyString,
  parseMoney,
  parseName,
  recommend,
  validateWorkload,
  type FieldErrors,
} from '@pf/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth.js';
import { withTransaction, type Queryable } from '../db.js';
import { badRequest, notFound, unprocessable, zodFieldErrors } from '../errors.js';
import { listModels, type ModelDto } from '../repositories/catalogue.js';
import {
  deleteOwnPortfolio,
  getOwnPortfolio,
  insertPortfolio,
  listOwnPortfolios,
  updatePortfolio,
  type PortfolioRow,
} from '../repositories/portfolios.js';
import { getOwnRecommendation, insertRecommendation, linkPortfolio, type RecommendationRow } from '../repositories/recommendations.js';
import { createWorkload, getOwnWorkload, listWorkloads, type WorkloadDto } from '../repositories/workloads.js';

const idParam = z.object({ id: z.coerce.number().int().positive() });
function parseId(params: unknown, what: string): number {
  const r = idParam.safeParse(params);
  if (!r.success) throw notFound(what);
  return r.data.id;
}

const allocationLine = z.object({
  modelId: z.number().int().positive(),
  allocationPercentage: z.number({ error: 'Enter a percentage.' }).int('Use whole percentages.').min(0, 'A share can’t be below 0%.').max(100, 'A share can’t be above 100%.'),
});

const portfolioBody = z.object({
  workloadId: z.number({ error: 'Choose a workload.' }).int().positive(),
  recommendationId: z.number().int().positive().nullish(),
  name: z.unknown(),
  budget: z.unknown(),
  allocations: z.array(allocationLine, { error: 'Add at least one model.' }).max(50),
});

const portfolioPatch = z
  .object({
    name: z.unknown(),
    budget: z.unknown(),
    allocations: z.array(allocationLine).max(50),
  })
  .partial()
  .strict();

async function modelsById(db: Queryable): Promise<Map<number, ModelDto>> {
  return new Map((await listModels(db)).map((m) => [m.id, m]));
}

function hydrateRecommendation(rec: RecommendationRow, workload: WorkloadDto, models: Map<number, ModelDto>) {
  return {
    ...rec,
    workload,
    allocations: rec.allocations.map((a) => ({ ...a, model: models.get(a.modelId) ?? null })),
  };
}

function hydratePortfolio(p: PortfolioRow, workload: WorkloadDto, models: Map<number, ModelDto>) {
  const allocations = p.lines.map((l) => {
    const model = models.get(l.modelId)!;
    const parts = costBreakdown(model, workload, l.allocationPercentage);
    return {
      modelId: l.modelId,
      model,
      allocationPercentage: l.allocationPercentage,
      estimatedCost: l.estimatedCost,
      inputCost: moneyString(parts.input),
      outputCost: moneyString(parts.output),
    };
  });
  const check = checkPortfolio(allocations, p.budget);
  return {
    id: p.id,
    name: p.name,
    budget: p.budget,
    workloadId: p.workloadId,
    recommendationId: p.recommendationId,
    workload,
    allocations,
    estimatedCost: moneyString(check.totalCost),
    score: blendedScore(allocations),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/**
 * Authoritative save-time validation. Recomputes every cost on the server with
 * the shared cost function — the client's numbers are never trusted.
 */
function validatePortfolioWrite(
  input: { name: unknown; budget: unknown; allocations: { modelId: number; allocationPercentage: number }[] },
  workload: WorkloadDto,
  models: Map<number, ModelDto>,
) {
  const errors: FieldErrors = {};
  const name = parseName(input.name, 'portfolio');
  const budget = parseMoney(input.budget, 'portfolio budget');
  if (name.error) errors.name = name.error;
  if (budget.error) errors.budget = budget.error;

  // A 0% line carries no workload; it is dropped rather than stored.
  const live = input.allocations.filter((a) => a.allocationPercentage > 0);
  const seen = new Set<number>();
  for (const a of live) {
    if (seen.has(a.modelId)) errors.allocations = 'Each model can appear only once in a portfolio.';
    seen.add(a.modelId);
    const model = models.get(a.modelId);
    if (!model) errors.allocations ??= 'One of the models is no longer in the catalogue.';
    else if (!isEligible(model, workload)) errors.allocations ??= `${model.name} doesn’t meet this workload’s requirements.`;
  }
  if (Object.keys(errors).length) return { ok: false as const, status: errors.name || errors.budget ? 400 : 422, errors };

  const lines = live.map((a) => ({
    modelId: a.modelId,
    allocationPercentage: a.allocationPercentage,
    estimatedCost: moneyString(costBreakdown(models.get(a.modelId)!, workload, a.allocationPercentage).total),
  }));
  const check = checkPortfolio(lines, budget.value!);
  if (!check.hasModels) errors.allocations = 'Add at least one model to the portfolio.';
  else if (!check.totalsHundred) errors.allocations = `Allocations must total exactly 100% — they currently total ${check.totalPercent}%.`;
  if (check.hasModels && !check.withinBudget) {
    errors.budget = `The estimated monthly cost of ${formatUsd(check.totalCost)} is over the ${formatUsd(budget.value!)} budget.`;
  }
  if (Object.keys(errors).length) return { ok: false as const, status: 422, errors };
  return { ok: true as const, name: name.value!, budget: budget.value!, lines };
}

export async function planningRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // ---- workloads ---------------------------------------------------------
  app.post('/workloads', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const v = validateWorkload({
      name: body.name,
      inputTokens: body.inputTokens,
      outputTokens: body.outputTokens,
      requestsPerMonth: body.requestsPerMonth,
      budget: body.budget,
      requiredCapabilities: body.requiredCapabilities,
    });
    if (!v.ok) throw badRequest(v.errors);
    return reply.code(201).send(await createWorkload(app.db, request.account.id, v.value));
  });

  app.get('/workloads', async (request) => listWorkloads(app.db, request.account.id));

  // ---- recommendations ---------------------------------------------------
  app.post('/workloads/:id/recommendation', async (request, reply) => {
    const workload = await getOwnWorkload(app.db, request.account.id, parseId(request.params, 'That workload'));
    if (!workload) throw notFound('That workload');
    const catalogue = await listModels(app.db);
    const result = recommend(catalogue, workload);
    // Persist before returning.
    const stored = await insertRecommendation(app.db, workload.id, result);
    return reply.code(201).send(hydrateRecommendation(stored, workload, new Map(catalogue.map((m) => [m.id, m]))));
  });

  app.get('/recommendations/:id', async (request) => {
    const rec = await getOwnRecommendation(app.db, request.account.id, parseId(request.params, 'That recommendation'));
    if (!rec) throw notFound('That recommendation');
    const workload = (await getOwnWorkload(app.db, request.account.id, rec.workloadId))!;
    return hydrateRecommendation(rec, workload, await modelsById(app.db));
  });

  // ---- portfolios --------------------------------------------------------
  app.get('/portfolios', async (request) => {
    const [rows, models] = await Promise.all([listOwnPortfolios(app.db, request.account.id), modelsById(app.db)]);
    const workloads = new Map((await listWorkloads(app.db, request.account.id)).map((w) => [w.id, w]));
    return rows.map((p) => hydratePortfolio(p, workloads.get(p.workloadId)!, models));
  });

  app.post('/portfolios', async (request, reply) => {
    const parsed = portfolioBody.safeParse(request.body ?? {});
    if (!parsed.success) throw badRequest(zodFieldErrors(parsed.error.issues));
    const userId = request.account.id;
    const workload = await getOwnWorkload(app.db, userId, parsed.data.workloadId);
    if (!workload) throw badRequest({ workloadId: 'Choose one of your workloads.' });
    const recId = parsed.data.recommendationId ?? null;
    if (recId !== null) {
      const rec = await getOwnRecommendation(app.db, userId, recId);
      if (!rec || rec.workloadId !== workload.id) throw badRequest({ recommendationId: 'That recommendation belongs to a different workload.' });
    }
    const models = await modelsById(app.db);
    const v = validatePortfolioWrite(parsed.data, workload, models);
    if (!v.ok) throw v.status === 400 ? badRequest(v.errors) : unprocessable(v.errors);

    const id = await withTransaction(app.db, async (tx) => {
      const pid = await insertPortfolio(tx, { userId, workloadId: workload.id, name: v.name, budget: v.budget }, v.lines);
      if (recId !== null) await linkPortfolio(tx, recId, pid);
      return pid;
    });
    return reply.code(201).send(hydratePortfolio((await getOwnPortfolio(app.db, userId, id))!, workload, models));
  });

  app.get('/portfolios/:id', async (request) => {
    const p = await getOwnPortfolio(app.db, request.account.id, parseId(request.params, 'That portfolio'));
    if (!p) throw notFound('That portfolio');
    const workload = (await getOwnWorkload(app.db, request.account.id, p.workloadId))!;
    return hydratePortfolio(p, workload, await modelsById(app.db));
  });

  app.patch('/portfolios/:id', async (request) => {
    const userId = request.account.id;
    const current = await getOwnPortfolio(app.db, userId, parseId(request.params, 'That portfolio'));
    if (!current) throw notFound('That portfolio');
    const parsed = portfolioPatch.safeParse(request.body ?? {});
    if (!parsed.success) throw badRequest(zodFieldErrors(parsed.error.issues));
    const workload = (await getOwnWorkload(app.db, userId, current.workloadId))!;
    const models = await modelsById(app.db);
    const merged = {
      name: parsed.data.name ?? current.name,
      budget: parsed.data.budget ?? current.budget,
      allocations: parsed.data.allocations ?? current.lines,
    };
    const v = validatePortfolioWrite(merged, workload, models);
    if (!v.ok) throw v.status === 400 ? badRequest(v.errors) : unprocessable(v.errors);
    await withTransaction(app.db, (tx) => updatePortfolio(tx, current.id, { name: v.name, budget: v.budget }, v.lines));
    return hydratePortfolio((await getOwnPortfolio(app.db, userId, current.id))!, workload, models);
  });

  app.delete('/portfolios/:id', async (request, reply) => {
    const ok = await deleteOwnPortfolio(app.db, request.account.id, parseId(request.params, 'That portfolio'));
    if (!ok) throw notFound('That portfolio');
    return reply.code(204).send();
  });
}
