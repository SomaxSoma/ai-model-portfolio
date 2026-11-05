import { monthlyCost } from './cost.js';
import type { Decimal } from './money.js';
import type { CatalogueModel, WorkloadInput } from './types.js';

/**
 * Product decision: the default ranking is 60% benchmark quality, 40% cost.
 * Latency and reliability are available as extra factors (weight 0 by default).
 */
export const SCORING_WEIGHTS: ScoringWeights = { quality: 0.6, cost: 0.4, latency: 0, reliability: 0 };

/**
 * Configurable ranking factors (proposal §5.1). Any non-negative mix; it is
 * normalised to sum to 1. The default reproduces the 60/40 quality:cost rule.
 */
export interface ScoringWeights {
  quality: number;
  cost: number;
  latency: number;
  reliability: number;
}

/** Score used for a factor the catalogue has no data for: neutral, neither rewarded nor punished. */
export const MISSING_FACTOR_SCORE = 0.5;

export function normaliseWeights(w: Partial<ScoringWeights> | null | undefined): ScoringWeights {
  const raw = { ...SCORING_WEIGHTS, ...(w ?? {}) };
  const clean = {
    quality: Math.max(0, Number(raw.quality) || 0),
    cost: Math.max(0, Number(raw.cost) || 0),
    latency: Math.max(0, Number(raw.latency) || 0),
    reliability: Math.max(0, Number(raw.reliability) || 0),
  };
  const sum = clean.quality + clean.cost + clean.latency + clean.reliability;
  if (sum <= 0) return { ...SCORING_WEIGHTS };
  return { quality: clean.quality / sum, cost: clean.cost / sum, latency: clean.latency / sum, reliability: clean.reliability / sum };
}

/** Min-max normalise where LOWER raw values are better. Missing values score neutral. */
function lowerIsBetter(values: (number | null | undefined)[]): number[] {
  const present = values.filter((v): v is number => typeof v === 'number');
  if (present.length === 0) return values.map(() => MISSING_FACTOR_SCORE);
  const min = Math.min(...present);
  const max = Math.max(...present);
  return values.map((v) => (typeof v !== 'number' ? MISSING_FACTOR_SCORE : max === min ? 1 : 1 - (v - min) / (max - min)));
}

export function overallScore(model: Pick<CatalogueModel, 'codingScore' | 'reasoningScore'>): number {
  return Math.round((model.codingScore + model.reasoningScore) / 2);
}

export interface ScoredModel<M extends CatalogueModel = CatalogueModel> {
  model: M;
  /** Monthly cost if this model took 100% of the workload. */
  fullCost: Decimal;
  overall: number;
  costNorm: number;
  latencyNorm: number;
  reliabilityNorm: number;
  score: number;
}

/**
 * costNorm(i) = maxCost == minCost ? 1 : 1 - (cost[i] - minCost) / (maxCost - minCost)
 * score(i)    = quality * overall/100 + cost * costNorm(i)
 *              + latency * latencyNorm(i) + reliability * reliability(i)/100
 * Weights are normalised first; the default (0.6, 0.4, 0, 0) is the spec's 60/40 rule.
 */
export function scoreModels<M extends CatalogueModel>(
  models: M[],
  workload: Pick<WorkloadInput, 'inputTokens' | 'outputTokens' | 'requestsPerMonth'>,
  weightsIn: Partial<ScoringWeights> = SCORING_WEIGHTS,
): ScoredModel<M>[] {
  const weights = normaliseWeights(weightsIn);
  const costs = models.map((m) => monthlyCost(m, workload));
  if (costs.length === 0) return [];
  const min = costs.reduce((a, b) => (b.lt(a) ? b : a));
  const max = costs.reduce((a, b) => (b.gt(a) ? b : a));
  const span = max.minus(min);
  const latencyNorms = lowerIsBetter(models.map((m) => m.latencyMs));

  return models.map((model, i) => {
    const fullCost = costs[i]!;
    const costNorm = span.isZero() ? 1 : 1 - fullCost.minus(min).div(span).toNumber();
    const overall = overallScore(model);
    const latencyNorm = latencyNorms[i]!;
    const reliabilityNorm = typeof model.reliability === 'number' ? model.reliability / 100 : MISSING_FACTOR_SCORE;
    return {
      model,
      fullCost,
      overall,
      costNorm,
      latencyNorm,
      reliabilityNorm,
      score: weights.quality * (overall / 100) + weights.cost * costNorm + weights.latency * latencyNorm + weights.reliability * reliabilityNorm,
    };
  });
}

/** Deterministic ranking: score desc, then cheaper, then lower id. */
export function rankScored<M extends CatalogueModel>(scored: ScoredModel<M>[]): ScoredModel<M>[] {
  return [...scored].sort(
    (a, b) => b.score - a.score || a.fullCost.comparedTo(b.fullCost) || a.model.id - b.model.id,
  );
}
