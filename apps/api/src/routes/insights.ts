import { analyzeRisk, moneyString, normaliseWeights, simulate, validateScenario, type SimulationOutcome } from '@pf/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth.js';
import { badRequest, notFound, zodFieldErrors } from '../errors.js';
import type { ModelDto } from '../repositories/catalogue.js';
import { listNotifications, markAllRead, markRead } from '../repositories/notifications.js';
import { getAccessiblePortfolio } from '../repositories/portfolios.js';
import { getOwnRecommendation } from '../repositories/recommendations.js';
import { getWorkloadForPortfolio } from '../repositories/workloads.js';
import { catalogueModels, hydratePortfolio, modelsById } from './planning.js';

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

const feedbackBody = z.object({
  clarityRating: z.number({ error: 'Choose a rating from 1 to 5.' }).int('Choose a rating from 1 to 5.').min(1, 'Choose a rating from 1 to 5.').max(5, 'Choose a rating from 1 to 5.'),
  priorModelId: z.number().int().positive().nullish(),
  comment: z.string().trim().max(2000, 'Keep the comment under 2,000 characters.').nullish(),
});

function serialiseOutcome(o: SimulationOutcome<ModelDto>) {
  return {
    lines: o.lines.map((l) => ({ modelId: l.model.id, model: l.model, allocationPercentage: l.allocationPercentage, estimatedCost: moneyString(l.estimatedCost) })),
    estimatedCost: moneyString(o.estimatedCost),
    withinBudget: o.withinBudget,
    score: o.score,
    risk: o.risk,
  };
}

/** Risk analysis, what-if simulation, notifications and pilot feedback. */
export async function insightRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  const loadPortfolio = async (userId: number, params: unknown) => {
    // Teammates can stress-test a shared portfolio too.
    const p = await getAccessiblePortfolio(app.db, userId, parseId(params, 'That portfolio'));
    if (!p) throw notFound('That portfolio');
    const workload = (await getWorkloadForPortfolio(app.db, p.workloadId))!;
    return { p, workload, view: hydratePortfolio(p, workload, await modelsById(app.db, app.cache), userId) };
  };

  // ---- provider risk -------------------------------------------------------
  app.get('/portfolios/:id/risk', async (request) => {
    const { view } = await loadPortfolio(request.account.id, request.params);
    return analyzeRisk(view.allocations);
  });

  // ---- what-if simulator ---------------------------------------------------
  app.post('/portfolios/:id/simulate', async (request) => {
    const { p, workload } = await loadPortfolio(request.account.id, request.params);
    const catalogue = await catalogueModels(app.db, app.cache);
    const scenario = validateScenario((request.body as { scenario?: unknown } | null)?.scenario, catalogue);
    if (!scenario.ok) throw badRequest(scenario.errors);
    const result = simulate({
      catalogue,
      workload,
      allocation: p.lines,
      budget: p.budget,
      scenario: scenario.value,
      weights: normaliseWeights(workload.scoringWeights),
    });
    return {
      scenario: scenario.value,
      description: result.description,
      budget: p.budget,
      baseline: serialiseOutcome(result.baseline),
      kept: { ...serialiseOutcome(result.kept), lostShare: result.kept.lostShare, note: result.kept.note },
      reoptimised: { ...serialiseOutcome(result.reoptimised), reason: result.reoptimised.reason },
    };
  });

  // ---- notifications ------------------------------------------------------
  app.get('/notifications', async (request, reply) => {
    const q = pageQuery.safeParse(request.query ?? {});
    if (!q.success) throw badRequest(zodFieldErrors(q.error.issues));
    const r = await listNotifications(app.db, request.account.id, q.data.limit, q.data.offset);
    reply.header('X-Total-Count', String(r.total));
    return r;
  });

  app.post('/notifications/:id/read', async (request, reply) => {
    if (!(await markRead(app.db, request.account.id, parseId(request.params, 'That notification')))) throw notFound('That notification');
    return reply.code(204).send();
  });

  app.post('/notifications/read-all', async (request, reply) => {
    await markAllRead(app.db, request.account.id);
    return reply.code(204).send();
  });

  // ---- pilot feedback (proposal §6.3) ------------------------------------
  app.put('/recommendations/:id/feedback', async (request) => {
    const userId = request.account.id;
    const rec = await getOwnRecommendation(app.db, userId, parseId(request.params, 'That recommendation'));
    if (!rec) throw notFound('That recommendation');
    const parsed = feedbackBody.safeParse(request.body ?? {});
    if (!parsed.success) throw badRequest(zodFieldErrors(parsed.error.issues));
    const { clarityRating, priorModelId, comment } = parsed.data;
    if (priorModelId && !(await modelsById(app.db, app.cache)).has(priorModelId)) throw badRequest({ priorModelId: 'Choose a model from the catalogue.' });
    const r = await app.db.query(
      `INSERT INTO feedback (user_id, recommendation_id, clarity_rating, prior_model_id, comment) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, recommendation_id) DO UPDATE SET clarity_rating = EXCLUDED.clarity_rating, prior_model_id = EXCLUDED.prior_model_id, comment = EXCLUDED.comment, created_at = now()
       RETURNING clarity_rating, prior_model_id, comment`,
      [userId, rec.id, clarityRating, priorModelId ?? null, comment || null],
    );
    const row = r.rows[0];
    return { clarityRating: row.clarity_rating, priorModelId: row.prior_model_id, comment: row.comment };
  });

  app.get('/recommendations/:id/feedback', async (request) => {
    const userId = request.account.id;
    const rec = await getOwnRecommendation(app.db, userId, parseId(request.params, 'That recommendation'));
    if (!rec) throw notFound('That recommendation');
    const r = await app.db.query(`SELECT clarity_rating, prior_model_id, comment FROM feedback WHERE user_id = $1 AND recommendation_id = $2`, [userId, rec.id]);
    const row = r.rows[0];
    return row ? { clarityRating: row.clarity_rating, priorModelId: row.prior_model_id, comment: row.comment } : null;
  });
}
