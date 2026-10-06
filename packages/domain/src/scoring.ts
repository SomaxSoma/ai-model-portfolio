import { monthlyCost } from './cost.js';
import type { Decimal } from './money.js';
import type { CatalogueModel, WorkloadInput } from './types.js';

/**
 * Product decision: how much a model's benchmark quality counts against its
 * cost when ranking. Weights must sum to 1.
 */
export const SCORING_WEIGHTS = { quality: 0.6, cost: 0.4 } as const;

export function overallScore(model: Pick<CatalogueModel, 'codingScore' | 'reasoningScore'>): number {
  return Math.round((model.codingScore + model.reasoningScore) / 2);
}

export interface ScoredModel<M extends CatalogueModel = CatalogueModel> {
  model: M;
  /** Monthly cost if this model took 100% of the workload. */
  fullCost: Decimal;
  overall: number;
  costNorm: number;
  score: number;
}

/**
 * costNorm(i) = maxCost == minCost ? 1 : 1 - (cost[i] - minCost) / (maxCost - minCost)
 * score(i)    = quality * overall/100 + cost * costNorm(i)
 */
export function scoreModels<M extends CatalogueModel>(
  models: M[],
  workload: Pick<WorkloadInput, 'inputTokens' | 'outputTokens' | 'requestsPerMonth'>,
  weights: { quality: number; cost: number } = SCORING_WEIGHTS,
): ScoredModel<M>[] {
  const costs = models.map((m) => monthlyCost(m, workload));
  if (costs.length === 0) return [];
  const min = costs.reduce((a, b) => (b.lt(a) ? b : a));
  const max = costs.reduce((a, b) => (b.gt(a) ? b : a));
  const span = max.minus(min);

  return models.map((model, i) => {
    const fullCost = costs[i]!;
    const costNorm = span.isZero() ? 1 : 1 - fullCost.minus(min).div(span).toNumber();
    const overall = overallScore(model);
    return {
      model,
      fullCost,
      overall,
      costNorm,
      score: weights.quality * (overall / 100) + weights.cost * costNorm,
    };
  });
}

/** Deterministic ranking: score desc, then cheaper, then lower id. */
export function rankScored<M extends CatalogueModel>(scored: ScoredModel<M>[]): ScoredModel<M>[] {
  return [...scored].sort(
    (a, b) => b.score - a.score || a.fullCost.comparedTo(b.fullCost) || a.model.id - b.model.id,
  );
}
