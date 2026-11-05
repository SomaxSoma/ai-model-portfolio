import { monthlyCost } from './cost.js';
import { isEligible } from './eligibility.js';
import { Decimal, formatUsd, sumMoney, toMoney, type DecimalLike } from './money.js';
import { blendedScore, recommend, type AllocationLine } from './recommend.js';
import { analyzeRisk, type RiskReport } from './risk.js';
import type { ScoringWeights } from './scoring.js';
import type { CatalogueModel, QualityBasis, WorkloadInput } from './types.js';
import { normalisePercentages, type FieldErrors } from './validation.js';

/**
 * What-if simulator (proposal §4.1): how a portfolio fares if a price rises,
 * a model is deprecated, or a provider becomes unavailable.
 */
export type Scenario =
  | { kind: 'PRICE_CHANGE'; modelId?: number | null; providerName?: string | null; percent: number }
  | { kind: 'MODEL_DEPRECATION'; modelId: number }
  | { kind: 'PROVIDER_OUTAGE'; providerName: string };

export const SCENARIO_KINDS = ['PRICE_CHANGE', 'MODEL_DEPRECATION', 'PROVIDER_OUTAGE'] as const;

export const SCENARIO_LABELS: Record<Scenario['kind'], string> = {
  PRICE_CHANGE: 'Price change',
  MODEL_DEPRECATION: 'Model deprecated',
  PROVIDER_OUTAGE: 'Provider unavailable',
};

export interface SimulationOutcome<M extends CatalogueModel = CatalogueModel> {
  lines: AllocationLine<M>[];
  estimatedCost: Decimal;
  withinBudget: boolean;
  score: number;
  risk: RiskReport;
}

export interface SimulationResult<M extends CatalogueModel = CatalogueModel> {
  description: string;
  baseline: SimulationOutcome<M>;
  /** Same allocation; shares of models that disappear are spread over the rest. */
  kept: SimulationOutcome<M> & { lostShare: number; note: string };
  /** A fresh recommendation against the changed catalogue. */
  reoptimised: SimulationOutcome<M> & { reason: string };
}

export function validateScenario(raw: unknown, catalogue: CatalogueModel[]): { ok: true; value: Scenario } | { ok: false; errors: FieldErrors } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const providers = new Set(catalogue.map((m) => m.providerName));
  const modelExists = (id: unknown) => typeof id === 'number' && catalogue.some((m) => m.id === id);
  switch (r.kind) {
    case 'PRICE_CHANGE': {
      const errors: FieldErrors = {};
      const percent = typeof r.percent === 'number' ? r.percent : Number(r.percent);
      if (!Number.isFinite(percent)) errors.percent = 'Enter the price change as a percentage.';
      else if (percent <= -100) errors.percent = 'A price can’t fall by 100% or more.';
      else if (percent > 1000) errors.percent = 'Use a change of at most +1,000%.';
      const hasModel = r.modelId !== undefined && r.modelId !== null;
      const hasProvider = typeof r.providerName === 'string' && r.providerName !== '';
      if (hasModel === hasProvider) errors.target = 'Choose either one model or one provider.';
      else if (hasModel && !modelExists(r.modelId)) errors.target = 'Choose a model from the catalogue.';
      else if (hasProvider && !providers.has(r.providerName as string)) errors.target = 'Choose a provider from the catalogue.';
      if (Object.keys(errors).length) return { ok: false, errors };
      return { ok: true, value: { kind: 'PRICE_CHANGE', percent, modelId: hasModel ? (r.modelId as number) : null, providerName: hasProvider ? (r.providerName as string) : null } };
    }
    case 'MODEL_DEPRECATION':
      return modelExists(r.modelId) ? { ok: true, value: { kind: 'MODEL_DEPRECATION', modelId: r.modelId as number } } : { ok: false, errors: { target: 'Choose a model from the catalogue.' } };
    case 'PROVIDER_OUTAGE':
      return typeof r.providerName === 'string' && providers.has(r.providerName)
        ? { ok: true, value: { kind: 'PROVIDER_OUTAGE', providerName: r.providerName } }
        : { ok: false, errors: { target: 'Choose a provider from the catalogue.' } };
    default:
      return { ok: false, errors: { kind: 'Choose a scenario.' } };
  }
}

/** The catalogue as it would look under the scenario. Prices stay at the stored 4 dp scale. */
export function applyScenario<M extends CatalogueModel>(catalogue: M[], s: Scenario): M[] {
  return catalogue.map((m) => {
    if (s.kind === 'PRICE_CHANGE') {
      const hit = s.modelId != null ? m.id === s.modelId : m.providerName === s.providerName;
      if (!hit) return m;
      const factor = new Decimal(100).plus(s.percent).div(100);
      return { ...m, inputPrice: toMoney(new Decimal(m.inputPrice).mul(factor)).toFixed(4), outputPrice: toMoney(new Decimal(m.outputPrice).mul(factor)).toFixed(4) };
    }
    if (s.kind === 'MODEL_DEPRECATION') return m.id === s.modelId ? { ...m, status: 'RETIRED' } : m;
    return m.providerName === s.providerName ? { ...m, status: 'RETIRED' } : m;
  });
}

export function describeScenario(s: Scenario, catalogue: CatalogueModel[]): string {
  const modelName = (id: number | null | undefined) => catalogue.find((m) => m.id === id)?.name ?? 'the model';
  if (s.kind === 'PRICE_CHANGE') {
    const target = s.modelId != null ? modelName(s.modelId) : `every ${s.providerName} model`;
    const dir = s.percent >= 0 ? `rise by ${s.percent}%` : `fall by ${Math.abs(s.percent)}%`;
    return `Prices for ${target} ${dir}.`;
  }
  if (s.kind === 'MODEL_DEPRECATION') return `${modelName(s.modelId)} is deprecated and can no longer be used.`;
  return `${s.providerName} becomes unavailable.`;
}

function outcome<M extends CatalogueModel>(lines: AllocationLine<M>[], budget: DecimalLike, basis?: QualityBasis): SimulationOutcome<M> {
  const estimatedCost = sumMoney(lines.map((l) => l.estimatedCost));
  return {
    lines,
    estimatedCost,
    withinBudget: lines.length > 0 && estimatedCost.lte(budget),
    score: blendedScore(lines, basis),
    risk: analyzeRisk(lines),
  };
}

export function simulate<M extends CatalogueModel>(input: {
  catalogue: M[];
  workload: WorkloadInput;
  /** The portfolio's current allocation. */
  allocation: { modelId: number; allocationPercentage: number }[];
  budget: DecimalLike;
  scenario: Scenario;
  weights?: Partial<ScoringWeights> | null;
}): SimulationResult<M> {
  const { catalogue, workload, allocation, budget, scenario } = input;
  const live = allocation.filter((a) => a.allocationPercentage > 0);
  const linesFor = (cat: M[], alloc: { modelId: number; allocationPercentage: number }[]): AllocationLine<M>[] =>
    alloc
      .map((a) => ({ a, model: cat.find((m) => m.id === a.modelId) }))
      .filter((x): x is { a: (typeof alloc)[number]; model: M } => !!x.model)
      .map(({ a, model }) => ({ model, allocationPercentage: a.allocationPercentage, estimatedCost: monthlyCost(model, workload, a.allocationPercentage) }));

  const baseline = outcome(linesFor(catalogue, live), budget, workload.qualityBasis);

  const changed = applyScenario(catalogue, scenario);
  const surviving = live.filter((a) => {
    const m = changed.find((x) => x.id === a.modelId);
    return !!m && isEligible(m, workload);
  });
  const lostShare = live.reduce((a, l) => a + l.allocationPercentage, 0) - surviving.reduce((a, l) => a + l.allocationPercentage, 0);
  const pcts = normalisePercentages(surviving.map((s) => s.allocationPercentage));
  const keptAlloc = surviving.map((s, i) => ({ modelId: s.modelId, allocationPercentage: pcts[i]! })).filter((s) => s.allocationPercentage > 0);
  const kept = outcome(linesFor(changed, keptAlloc), budget, workload.qualityBasis);
  const note =
    keptAlloc.length === 0
      ? 'No model in this portfolio survives the scenario. The current allocation can’t serve the workload.'
      : lostShare > 0
        ? `${lostShare}% of the workload loses its model and is spread over the remaining models.`
        : 'The allocation is unchanged; only costs move.';

  const rec = recommend(changed, { ...workload, budget }, { weights: input.weights });
  const reoptimised = { ...outcome(rec.allocations, budget, workload.qualityBasis), reason: rec.reason };

  return {
    description: describeScenario(scenario, catalogue),
    baseline,
    kept: { ...kept, lostShare, note },
    reoptimised,
  };
}

/** Cost change between two outcomes as a signed, user-facing string, e.g. "+$12.40". */
export function formatDelta(from: Decimal, to: Decimal): string {
  const d = to.minus(from);
  if (d.isZero()) return '$0.00';
  return `${d.isNeg() ? '−' : '+'}${formatUsd(d.abs())}`;
}
