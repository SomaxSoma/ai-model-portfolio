import { monthlyCost } from './cost.js';
import { eligibleModels, explainNoEligibleModels } from './eligibility.js';
import { formatList } from './labels.js';
import { Decimal, formatUsd, sumMoney } from './money.js';
import { normaliseWeights, overallScore, rankScored, scoreModels, type ScoredModel, type ScoringWeights } from './scoring.js';
import type { CatalogueModel, WorkloadInput } from './types.js';

export const RECOMMENDATION_CONFIG = {
  /** How many of the best-scoring models make up the portfolio. */
  portfolioSize: 3,
  /** Percentage points moved per budget-adjustment step. */
  adjustmentStep: 5,
  /** Hard cap on budget-adjustment iterations. */
  maxAdjustmentSteps: 20,
} as const;

export interface AllocationLine<M extends CatalogueModel = CatalogueModel> {
  model: M;
  allocationPercentage: number;
  estimatedCost: Decimal;
}

export interface Recommendation<M extends CatalogueModel = CatalogueModel> {
  allocations: AllocationLine<M>[];
  estimatedCost: Decimal;
  /** Allocation-weighted blended benchmark score, 0–100, one decimal place. */
  score: number;
  withinBudget: boolean;
  /** True when the budget-adjustment loop changed the allocation. */
  adjusted: boolean;
  /** Plain-language, user-facing explanation. Shown verbatim. */
  reason: string;
}

/** Integer percentages proportional to score; rounding drift goes to the top (first) entry. */
export function allocatePercentages(scores: number[]): number[] {
  if (scores.length === 0) return [];
  const sum = scores.reduce((a, b) => a + b, 0);
  const pcts = sum > 0 ? scores.map((s) => Math.round((s / sum) * 100)) : scores.map(() => 0);
  if (sum <= 0) pcts[0] = 100;
  const drift = 100 - pcts.reduce((a, b) => a + b, 0);
  pcts[0] = pcts[0]! + drift;
  return pcts;
}

/** Allocation-weighted blended benchmark score. */
export function blendedScore(lines: { model: Pick<CatalogueModel, 'codingScore' | 'reasoningScore'>; allocationPercentage: number }[]): number {
  const total = lines.reduce((a, l) => a + l.allocationPercentage, 0);
  if (total === 0) return 0;
  const weighted = lines.reduce((a, l) => a + overallScore(l.model) * l.allocationPercentage, 0);
  return Math.round((weighted / total) * 10) / 10;
}

interface Working<M extends CatalogueModel> {
  scored: ScoredModel<M>;
  percent: number;
}

function linesOf<M extends CatalogueModel>(work: Working<M>[], workload: WorkloadInput): AllocationLine<M>[] {
  return work
    .filter((w) => w.percent > 0)
    .map((w) => ({
      model: w.scored.model,
      allocationPercentage: w.percent,
      estimatedCost: monthlyCost(w.scored.model, workload, w.percent),
    }));
}

function total(lines: AllocationLine[]): Decimal {
  return sumMoney(lines.map((l) => l.estimatedCost));
}

/**
 * Deterministic, rule-based recommendation:
 *   eligibility → cost → score → top-N allocation (drift to top) → budget loop.
 *
 * Never throws for a valid workload and never returns an empty allocation
 * unless no model is eligible — in which case `reason` says what to relax.
 */
export interface RecommendOptions {
  /** Ranking factors; defaults to the 60/40 quality:cost rule. */
  weights?: Partial<ScoringWeights> | null;
}

export function recommend<M extends CatalogueModel>(models: M[], workload: WorkloadInput, options: RecommendOptions = {}): Recommendation<M> {
  const weights = normaliseWeights(options.weights);
  const budget = new Decimal(workload.budget);
  const eligible = eligibleModels(models, workload);

  if (eligible.length === 0) {
    return {
      allocations: [],
      estimatedCost: new Decimal(0),
      score: 0,
      withinBudget: false,
      adjusted: false,
      reason: explainNoEligibleModels(models, workload),
    };
  }

  const ranked = rankScored(scoreModels(eligible, workload, weights));
  const top = pickDiverse(ranked, RECOMMENDATION_CONFIG.portfolioSize);
  const pcts = allocatePercentages(top.map((s) => s.score));
  const work: Working<M>[] = top.map((scored, i) => ({ scored, percent: pcts[i]! }));

  // Budget-adjustment loop. Each step moves share from the most expensive
  // entry to the cheapest, strictly lowering total cost.
  const { adjustmentStep, maxAdjustmentSteps } = RECOMMENDATION_CONFIG;
  let lines = linesOf(work, workload);
  let steps = 0;
  while (total(lines).gt(budget) && steps < maxAdjustmentSteps) {
    const live = work.filter((w) => w.percent > 0);
    const donor = live.reduce((a, b) => (b.scored.fullCost.gt(a.scored.fullCost) ? b : a));
    const cheapest = live.reduce((a, b) => (b.scored.fullCost.lt(a.scored.fullCost) ? b : a));
    if (donor === cheapest || donor.percent <= adjustmentStep) break;
    donor.percent -= adjustmentStep;
    cheapest.percent += adjustmentStep;
    lines = linesOf(work, workload);
    steps++;
  }
  const adjusted = steps > 0;
  const cost = total(lines);
  const describe = (ls: AllocationLine<M>[]) => formatList(ls.map((l) => l.model.name));

  if (cost.lte(budget)) {
    const reason = adjusted
      ? `Shifted share toward ${cheapestName(work)} to bring the cost to ${formatUsd(cost)}, within your ${formatUsd(budget)} budget. Split across ${describe(lines)}.`
      : `Splits your workload across ${describe(lines)}, weighing ${describeWeights(weights)}. Estimated ${formatUsd(cost)} of your ${formatUsd(budget)} budget.`;
    return { allocations: lines, estimatedCost: cost, score: blendedScore(lines), withinBudget: true, adjusted, reason };
  }

  // The mix can't fit. The closest allocation is the whole workload on the
  // cheapest eligible model (from the full eligible set, not just the top N).
  const floor = ranked.reduce((a, b) => (b.fullCost.lt(a.fullCost) || (b.fullCost.eq(a.fullCost) && b.model.id < a.model.id) ? b : a));
  const floorLines: AllocationLine<M>[] = [
    { model: floor.model, allocationPercentage: 100, estimatedCost: floor.fullCost },
  ];
  const floorCost = floor.fullCost;

  if (floorCost.lte(budget)) {
    return {
      allocations: floorLines,
      estimatedCost: floorCost,
      score: blendedScore(floorLines),
      withinBudget: true,
      adjusted: true,
      reason: `A mix of models would exceed your ${formatUsd(budget)} budget, so the whole workload goes to ${floor.model.name}, the cheapest model that meets your requirements, at ${formatUsd(floorCost)} a month.`,
    };
  }

  return {
    allocations: floorLines,
    estimatedCost: floorCost,
    score: blendedScore(floorLines),
    withinBudget: false,
    adjusted: true,
    reason: `Nothing fits your ${formatUsd(budget)} budget. The cheapest model that meets your requirements, ${floor.model.name}, costs ${formatUsd(floorCost)} a month — ${formatUsd(floorCost.minus(budget))} over. Raise the budget, lower requests per month, or shorten requests.`,
  };
}

/**
 * The best `n` models, at most one per provider while other providers remain:
 * a mix of one provider's models is no hedge against that provider. Falls
 * back to further models from already-chosen providers only when fewer than
 * `n` providers are eligible. Keeps rank order.
 */
export function pickDiverse<M extends CatalogueModel>(ranked: ScoredModel<M>[], n: number): ScoredModel<M>[] {
  const picked: ScoredModel<M>[] = [];
  const providers = new Set<string>();
  for (const s of ranked) {
    if (picked.length === n) break;
    if (providers.has(s.model.providerName)) continue;
    picked.push(s);
    providers.add(s.model.providerName);
  }
  for (const s of ranked) {
    if (picked.length === n) break;
    if (!picked.includes(s)) picked.push(s);
  }
  return rankScored(picked);
}

function cheapestName<M extends CatalogueModel>(work: Working<M>[]): string {
  return work.reduce((a, b) => (b.scored.fullCost.lt(a.scored.fullCost) ? b : a)).scored.model.name;
}

/** "benchmark quality (60%) against cost (40%)" — only factors that carry weight. */
export function describeWeights(w: ScoringWeights): string {
  const parts = (
    [
      ['benchmark quality', w.quality],
      ['cost', w.cost],
      ['latency', w.latency],
      ['reliability', w.reliability],
    ] as const
  )
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k} (${pct(v)})`);
  if (parts.length === 1) return `${parts[0]} alone`;
  if (parts.length === 2) return `${parts[0]} against ${parts[1]}`;
  return formatList(parts);
}

function pct(weight: number): string {
  return `${Math.round(weight * 100)}%`;
}
