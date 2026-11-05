import { describe, expect, it } from 'vitest';
import {
  analyzeRisk,
  applyScenario,
  daysUntil,
  describeWeights,
  GOLDEN_COST_CASES,
  monthlyCost,
  normaliseWeights,
  recommend,
  scoreModels,
  simulate,
  validateScenario,
  type CatalogueModel,
} from '../src/index.js';

function model(id: number, name: string, provider: string, price: number, quality: number, extra: Partial<CatalogueModel> = {}): CatalogueModel {
  return { id, name, version: '1', providerName: provider, contextWindow: 200_000, inputPrice: String(price), outputPrice: String(price), codingScore: quality, reasoningScore: quality, status: 'ACTIVE', capabilities: [], ...extra };
}
const unit = (budget: string | number) => ({ inputTokens: 1000, outputTokens: 1000, requestsPerMonth: 1000, budget, requiredCapabilities: [] as string[] });

const A = model(1, 'Alpha', 'North', 10, 90, { latencyMs: 2000, reliability: 99.9 });
const B = model(2, 'Bravo', 'South', 1, 60, { latencyMs: 400, reliability: 98 });
const C = model(3, 'Charlie', 'North', 5, 80, { latencyMs: 900, reliability: null });
const catalogue = [A, B, C];

describe('golden cost cases (primary metric: 100% match)', () => {
  it.each(GOLDEN_COST_CASES)('$id $description', (c) => {
    expect(monthlyCost(c.model, c.workload, c.share).toFixed(4)).toBe(c.expected);
  });
  it('has at least 15 hand-verified cases', () => expect(GOLDEN_COST_CASES.length).toBeGreaterThanOrEqual(15));
});

describe('configurable scoring weights', () => {
  it('normalises any non-negative mix and falls back to the default', () => {
    expect(normaliseWeights({ quality: 3, cost: 1, latency: 0, reliability: 0 })).toEqual({ quality: 0.75, cost: 0.25, latency: 0, reliability: 0 });
    expect(normaliseWeights({ quality: 0, cost: 0, latency: 0, reliability: 0 })).toEqual({ quality: 0.6, cost: 0.4, latency: 0, reliability: 0 });
    expect(normaliseWeights({ quality: -5, cost: 1 })).toEqual({ quality: 0, cost: 1, latency: 0, reliability: 0 });
  });

  it('the default weights reproduce the original 60/40 results', () => {
    expect(recommend(catalogue, unit(1000)).allocations.map((l) => l.allocationPercentage)).toEqual(recommend(catalogue, unit(1000), { weights: { quality: 0.6, cost: 0.4 } }).allocations.map((l) => l.allocationPercentage));
  });

  it('latency: lower is better; missing data scores neutral 0.5', () => {
    const s = scoreModels(catalogue, unit(1000), { quality: 0, cost: 0, latency: 1, reliability: 0 });
    expect(s.map((x) => x.latencyNorm)).toEqual([0, 1, 1 - 500 / 1600]);
    const missing = scoreModels([model(9, 'X', 'P', 1, 50)], unit(1000), { latency: 1, quality: 0, cost: 0 });
    expect(missing[0]!.latencyNorm).toBe(0.5);
  });

  it('reliability uses the 0–100 value; missing is neutral', () => {
    const s = scoreModels(catalogue, unit(1000), { quality: 0, cost: 0, latency: 0, reliability: 1 });
    const norms = s.map((x) => x.reliabilityNorm);
    expect(norms[0]).toBeCloseTo(0.999, 10);
    expect(norms[1]).toBeCloseTo(0.98, 10);
    expect(norms[2]).toBe(0.5);
  });

  it('latency-only ranking puts the fastest model first and says so', () => {
    const r = recommend(catalogue, unit(1000), { weights: { quality: 0, cost: 0, latency: 1, reliability: 0 } });
    expect(r.allocations[0]!.model.name).toBe('Bravo');
    expect(r.reason).toMatch(/latency \(100%\) alone/);
  });

  it('describes weights in plain language', () => {
    expect(describeWeights(normaliseWeights({ quality: 50, cost: 30, latency: 20, reliability: 0 }))).toBe('benchmark quality (50%), cost (30%) and latency (20%)');
  });
});

describe('provider risk', () => {
  const today = new Date(Date.UTC(2026, 0, 1));
  it('single provider is high concentration (HHI 10,000)', () => {
    const r = analyzeRisk([{ model: A, allocationPercentage: 60, estimatedCost: '12' }, { model: C, allocationPercentage: 40, estimatedCost: '4' }], today);
    expect(r.hhi).toBe(10000);
    expect(r.concentration).toBe('HIGH');
    expect(r.providers).toEqual([{ provider: 'North', trafficShare: 100, costShare: 100, models: ['Alpha', 'Charlie'] }]);
    expect(r.findings[0]).toMatch(/Everything runs on North/);
  });

  it('computes HHI and shares across providers', () => {
    // North 50%, South 50% → 2500+2500 = 5000
    const r = analyzeRisk([{ model: A, allocationPercentage: 50, estimatedCost: '10' }, { model: B, allocationPercentage: 50, estimatedCost: '1' }], today);
    expect(r.hhi).toBe(5000);
    expect(r.providers.find((p) => p.provider === 'North')!.costShare).toBe(90.9);
  });

  it('three equal providers is low concentration', () => {
    const D = model(4, 'Delta', 'East', 1, 50);
    const r = analyzeRisk([{ model: A, allocationPercentage: 34, estimatedCost: '1' }, { model: B, allocationPercentage: 33, estimatedCost: '1' }, { model: { ...D, providerName: 'West' }, allocationPercentage: 33, estimatedCost: '1' }], today);
    expect(r.hhi).toBe(3334); // 1156 + 1089 + 1089
    expect(r.concentration).toBe('HIGH');
    const spread = analyzeRisk(['P1', 'P2', 'P3', 'P4', 'P5'].map((p, i) => ({ model: model(10 + i, `M${i}`, p, 1, 50), allocationPercentage: 20, estimatedCost: '1' })), today);
    expect(spread.hhi).toBe(2000);
    expect(spread.concentration).toBe('MODERATE');
    const wide = analyzeRisk(Array.from({ length: 10 }, (_, i) => ({ model: model(20 + i, `W${i}`, `P${i}`, 1, 50), allocationPercentage: 10, estimatedCost: '1' })), today);
    expect(wide.concentration).toBe('LOW');
  });

  it('flags retired and soon-deprecated models', () => {
    const old = model(5, 'Old', 'South', 1, 50, { status: 'RETIRED' });
    const soon = model(6, 'Soon', 'East', 1, 50, { deprecationDate: '2026-02-15' });
    const later = model(7, 'Later', 'West', 1, 50, { deprecationDate: '2027-06-01' });
    const r = analyzeRisk([{ model: old, allocationPercentage: 20, estimatedCost: '1' }, { model: soon, allocationPercentage: 30, estimatedCost: '1' }, { model: later, allocationPercentage: 50, estimatedCost: '1' }], today);
    expect(r.lifecycle.map((x) => [x.name, x.retired, x.daysLeft])).toEqual([['Old', true, null], ['Soon', false, 45]]);
    expect(r.level).toBe('HIGH');
    expect(r.findings[0]).toMatch(/Old is no longer available/);
    expect(r.findings.some((f) => f.includes('Soon is scheduled to be retired in 45 days'))).toBe(true);
  });

  it('daysUntil counts calendar days in UTC', () => {
    expect(daysUntil('2026-01-02', new Date(Date.UTC(2026, 0, 1, 23, 59)))).toBe(1);
    expect(daysUntil('2025-12-31', new Date(Date.UTC(2026, 0, 1)))).toBe(-1);
  });
});

describe('what-if simulator', () => {
  const allocation = [{ modelId: 1, allocationPercentage: 50 }, { modelId: 2, allocationPercentage: 30 }, { modelId: 3, allocationPercentage: 20 }];
  // baseline: Alpha 50% of $20 = 10, Bravo 30% of $2 = 0.6, Charlie 20% of $10 = 2 → 12.60

  it('price change keeps the allocation and recomputes cost', () => {
    const r = simulate({ catalogue, workload: unit(100), allocation, budget: '100', scenario: { kind: 'PRICE_CHANGE', modelId: 1, percent: 50 } });
    expect(r.baseline.estimatedCost.toFixed(2)).toBe('12.60');
    expect(r.kept.estimatedCost.toFixed(2)).toBe('17.60'); // Alpha now $30 → 15 + 0.6 + 2
    expect(r.kept.lostShare).toBe(0);
    expect(r.description).toBe('Prices for Alpha rise by 50%.');
  });

  it('provider-wide price cut', () => {
    const r = simulate({ catalogue, workload: unit(100), allocation, budget: '100', scenario: { kind: 'PRICE_CHANGE', providerName: 'North', percent: -50 } });
    expect(r.kept.estimatedCost.toFixed(2)).toBe('6.60'); // 5 + 0.6 + 1
    expect(r.description).toBe('Prices for every North model fall by 50%.');
  });

  it('deprecation spreads the lost share over the remaining models', () => {
    const r = simulate({ catalogue, workload: unit(100), allocation, budget: '100', scenario: { kind: 'MODEL_DEPRECATION', modelId: 1 } });
    expect(r.kept.lostShare).toBe(50);
    expect(r.kept.lines.map((l) => [l.model.name, l.allocationPercentage])).toEqual([['Bravo', 60], ['Charlie', 40]]);
    expect(r.reoptimised.lines.map((l) => l.model.name)).not.toContain('Alpha');
  });

  it('provider outage that removes everything leaves an explained empty allocation', () => {
    const north = [{ modelId: 1, allocationPercentage: 70 }, { modelId: 3, allocationPercentage: 30 }];
    const r = simulate({ catalogue, workload: unit(100), allocation: north, budget: '100', scenario: { kind: 'PROVIDER_OUTAGE', providerName: 'North' } });
    expect(r.kept.lines).toEqual([]);
    expect(r.kept.withinBudget).toBe(false);
    expect(r.kept.note).toMatch(/No model in this portfolio survives/);
    expect(r.reoptimised.lines.map((l) => l.model.name)).toEqual(['Bravo']);
  });

  it('does not mutate the catalogue', () => {
    applyScenario(catalogue, { kind: 'PRICE_CHANGE', modelId: 1, percent: 100 });
    expect(A.inputPrice).toBe('10');
  });

  it('validates scenarios with user-facing messages', () => {
    expect(validateScenario({ kind: 'PRICE_CHANGE', percent: -100, modelId: 1 }, catalogue)).toEqual({ ok: false, errors: { percent: 'A price can’t fall by 100% or more.' } });
    expect(validateScenario({ kind: 'PRICE_CHANGE', percent: 5 }, catalogue)).toEqual({ ok: false, errors: { target: 'Choose either one model or one provider.' } });
    expect(validateScenario({ kind: 'PROVIDER_OUTAGE', providerName: 'Nowhere' }, catalogue).ok).toBe(false);
    expect(validateScenario({ kind: 'nope' }, catalogue)).toEqual({ ok: false, errors: { kind: 'Choose a scenario.' } });
    expect(validateScenario({ kind: 'MODEL_DEPRECATION', modelId: 2 }, catalogue)).toEqual({ ok: true, value: { kind: 'MODEL_DEPRECATION', modelId: 2 } });
  });
});
