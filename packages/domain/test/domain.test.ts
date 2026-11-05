import { describe, expect, it } from 'vitest';
import {
  allocatePercentages,
  blendedScore,
  checkPortfolio,
  costBreakdown,
  eligibleModels,
  formatUsd,
  monthlyCost,
  normalisePercentages,
  overallScore,
  recommend,
  recommendBestWithinBudget,
  scoreModels,
  validateWorkload,
  type CatalogueModel,
  type WorkloadInput,
} from '../src/index.js';

function model(id: number, name: string, price: number, quality: number, extra: Partial<CatalogueModel> = {}): CatalogueModel {
  return {
    id,
    name,
    version: '1',
    providerName: 'Test',
    contextWindow: 200_000,
    inputPrice: String(price),
    outputPrice: String(price),
    codingScore: quality,
    reasoningScore: quality,
    status: 'ACTIVE',
    capabilities: ['tool_use'],
    ...extra,
  };
}

// With 1,000 in + 1,000 out tokens and 1,000 requests, a model's monthly
// cost equals inputPrice + outputPrice dollars — easy to reason about.
const unitWorkload = (budget: string | number, extra: Partial<WorkloadInput> = {}): WorkloadInput => ({
  inputTokens: 1000,
  outputTokens: 1000,
  requestsPerMonth: 1000,
  budget,
  requiredCapabilities: [],
  ...extra,
});

const A = model(1, 'Alpha', 10, 90); // $20/month, overall 90
const B = model(2, 'Bravo', 1, 60); //  $2/month,  overall 60
const C = model(3, 'Charlie', 5, 80); // $10/month, overall 80
const catalogue = [A, B, C];

describe('monthlyCost — the single cost function', () => {
  it('applies the per-1M-token formula', () => {
    const m = { inputPrice: '3', outputPrice: '15' };
    const w = { inputTokens: 2000, outputTokens: 500, requestsPerMonth: 10_000 };
    // ((2000*3 + 500*15) / 1e6) * 10000 = 135
    expect(monthlyCost(m, w).toFixed(4)).toBe('135.0000');
    expect(monthlyCost(m, w, 40).toFixed(4)).toBe('54.0000');
  });

  it('stays exact where floats drift', () => {
    const m = { inputPrice: '0.1', outputPrice: '0.2' };
    const w = { inputTokens: 1_000_000, outputTokens: 1_000_000, requestsPerMonth: 1 };
    expect(monthlyCost(m, w).toFixed(4)).toBe('0.3000'); // 0.1 + 0.2 !== 0.3 in floats
  });

  it('rounds to the stored scale (4 dp, half-up)', () => {
    const m = { inputPrice: '0.15', outputPrice: '0' };
    const w = { inputTokens: 1, outputTokens: 0, requestsPerMonth: 1 };
    expect(monthlyCost(m, w).toFixed(4)).toBe('0.0000');
    expect(monthlyCost(m, { ...w, requestsPerMonth: 1000 }).toFixed(4)).toBe('0.0002'); // 0.00015 → 0.0002
  });

  it('breakdown parts sum to the total', () => {
    const b = costBreakdown({ inputPrice: '2.5', outputPrice: '10' }, { inputTokens: 3000, outputTokens: 700, requestsPerMonth: 4321 }, 37);
    expect(b.input.plus(b.output).toFixed(4)).toBe(b.total.toFixed(4));
  });
});

describe('eligibility', () => {
  it('excludes retired models, small contexts and missing capabilities', () => {
    const retired = model(10, 'Old', 1, 50, { status: 'RETIRED' });
    const small = model(11, 'Small', 1, 50, { contextWindow: 1999 });
    const exact = model(12, 'Exact', 1, 50, { contextWindow: 2000 });
    const noTools = model(13, 'NoTools', 1, 50, { capabilities: [] });
    const w = unitWorkload(100, { requiredCapabilities: ['tool_use'] });
    expect(eligibleModels([retired, small, exact, noTools], w).map((m) => m.name)).toEqual(['Exact']);
  });
});

describe('scoring', () => {
  it('overallScore rounds the mean of coding and reasoning', () => {
    expect(overallScore({ codingScore: 90, reasoningScore: 85 })).toBe(88); // 87.5 → 88
    expect(overallScore({ codingScore: 70, reasoningScore: 71 })).toBe(71); // 70.5 → 71
  });

  it('equal costs (maxCost == minCost) give every model costNorm 1', () => {
    const same = [model(1, 'X', 4, 90), model(2, 'Y', 4, 50)];
    const scored = scoreModels(same, unitWorkload(100));
    expect(scored.map((s) => s.costNorm)).toEqual([1, 1]);
    expect(scored[0]!.score).toBeCloseTo(0.6 * 0.9 + 0.4);
    expect(scored[1]!.score).toBeCloseTo(0.6 * 0.5 + 0.4);
    expect(scored.every((s) => Number.isFinite(s.score))).toBe(true);
  });

  it('a single eligible model is not a division by zero', () => {
    const r = recommend([A], unitWorkload(100));
    expect(r.allocations).toHaveLength(1);
    expect(r.allocations[0]!.allocationPercentage).toBe(100);
  });
});

describe('allocation', () => {
  it('adds rounding drift to the highest-scoring model', () => {
    expect(allocatePercentages([1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocatePercentages([2, 1, 1])).toEqual([50, 25, 25]);
    // 0.5/0.5/0.5/… style drift the other way: rounds to 101 → top loses one
    expect(allocatePercentages([0.335, 0.335, 0.33]).reduce((a, b) => a + b)).toBe(100);
  });

  it('every allocation in a recommendation totals exactly 100', () => {
    const r = recommend(catalogue, unitWorkload(1000));
    expect(r.allocations.reduce((a, l) => a + l.allocationPercentage, 0)).toBe(100);
  });

  it('takes the top three by score, highest first', () => {
    // Cost is scored on a log scale. Delta widens the range to $2–$100 (ln span = ln 50):
    // costNorm Alpha 1 − ln10/ln50 = 0.4114, Charlie 1 − ln5/ln50 = 0.5886, Bravo 1, Delta 0.
    // Scores: Bravo 0.760, Charlie 0.7154, Alpha 0.7046, Delta 0.060 → Delta is dropped.
    const D = model(4, 'Delta', 50, 10);
    const r = recommend([...catalogue, D], unitWorkload(1000));
    expect(r.allocations.map((l) => l.model.name)).toEqual(['Bravo', 'Charlie', 'Alpha']);
    expect(r.allocations.map((l) => l.allocationPercentage)).toEqual([35, 33, 32]);
    // Without Delta (ln span = ln 10): Bravo 0.76, Charlie 0.48 + 0.4 × 0.3010 = 0.6004, Alpha 0.54 → 40/32/28.
    expect(recommend(catalogue, unitWorkload(1000)).allocations.map((l) => l.allocationPercentage)).toEqual([40, 32, 28]);
  });

  it('is deterministic', () => {
    const w = unitWorkload(8);
    expect(JSON.stringify(recommend(catalogue, w))).toBe(JSON.stringify(recommend([...catalogue].reverse(), w)));
  });
});

describe('prompt caching and benchmark choice', () => {
  it('prices cached input at the cache-read rate, by share', () => {
    // 1,000 in / 1,000 out × 1,000 requests: cost = effective input price + output price.
    const m = { inputPrice: '10', outputPrice: '20', cacheReadPrice: '1' };
    const w = { inputTokens: 1000, outputTokens: 1000, requestsPerMonth: 1000 };
    expect(monthlyCost(m, w).toFixed(4)).toBe('30.0000'); // no caching: unchanged
    expect(monthlyCost(m, { ...w, cachedInputPercent: 40 }).toFixed(4)).toBe('26.4000'); // 10×0.6 + 1×0.4 = 6.4 → 6.4 + 20
    expect(monthlyCost(m, { ...w, cachedInputPercent: 100 }).toFixed(4)).toBe('21.0000');
    // No published cache price: every input token at the normal rate.
    expect(monthlyCost({ inputPrice: '10', outputPrice: '20' }, { ...w, cachedInputPercent: 100 }).toFixed(4)).toBe('30.0000');
    expect(costBreakdown(m, { ...w, cachedInputPercent: 40 }).input.toFixed(4)).toBe('6.4000');
  });

  it('ranks on the chosen benchmark; intelligence-only ranking skips unpublished models', () => {
    const coder = model(1, 'Coder', 1, 90, { reasoningScore: 40, providerName: 'A' });
    const thinker = model(2, 'Thinker', 1, 50, { reasoningScore: 95, providerName: 'B' });
    const silent = model(3, 'Silent', 1, 99, { reasoningScore: null, providerName: 'C' });
    expect(overallScore(coder, 'CODING')).toBe(90);
    expect(overallScore(coder, 'INTELLIGENCE')).toBe(40);
    expect(overallScore(coder)).toBe(65);
    const byIntel = recommend([coder, thinker, silent], unitWorkload(100, { qualityBasis: 'INTELLIGENCE' }));
    expect(byIntel.allocations.map((l) => l.model.name)).toEqual(['Thinker', 'Coder']);
    const none = recommend([silent], unitWorkload(100, { qualityBasis: 'INTELLIGENCE' }));
    expect(none.allocations).toEqual([]);
    expect(none.reason).toMatch(/intelligence index/);
  });
});

describe('best quality within budget', () => {
  it('ranks only on quality among models the budget can afford on their own', () => {
    // Budget $12: Alpha ($20) can't carry the workload alone, so it's out even though it scores highest.
    const alt = recommendBestWithinBudget(catalogue, unitWorkload(12))!;
    expect(alt.allocations.map((l) => l.model.name)).toEqual(['Charlie', 'Bravo']);
    // Split by score 80:60 → 57/43; cost 0.57×$10 + 0.43×$2 = $6.56, within budget.
    expect(alt.allocations.map((l) => l.allocationPercentage)).toEqual([57, 43]);
    expect(alt.estimatedCost.toFixed(2)).toBe('6.56');
    expect(alt.withinBudget).toBe(true);
    // A generous budget includes the best model, and quality beats the 60/40 mix.
    expect(recommendBestWithinBudget(catalogue, unitWorkload(100))!.score).toBeGreaterThan(recommend(catalogue, unitWorkload(100)).score);
  });

  it('is null when nothing fits the budget on its own', () => {
    expect(recommendBestWithinBudget(catalogue, unitWorkload(1))).toBeNull();
  });
});

describe('cost on a log scale and provider diversity', () => {
  it('one extreme outlier no longer gives every other model near-full cost marks', () => {
    // $2, $10, $20 and a $3,450 outlier. Linear scaling would put Alpha ($20)
    // at 0.995; on a log scale it's 1 − ln10/ln1725 = 0.691.
    const outlier = model(9, 'Outlier', 1725, 95);
    const byName = Object.fromEntries(scoreModels([...catalogue, outlier], unitWorkload(1)).map((s) => [s.model.name, s.costNorm]));
    expect(byName.Bravo).toBe(1);
    expect(byName.Outlier).toBe(0);
    expect(byName.Alpha!).toBeCloseTo(1 - Math.log(10) / Math.log(1725), 10);
    expect(byName.Alpha!).toBeLessThan(0.7);
  });

  it('spreads the portfolio across providers while others are eligible', () => {
    const spread = [
      model(1, 'North A', 1, 90, { providerName: 'North' }),
      model(2, 'North B', 1, 89, { providerName: 'North' }),
      model(3, 'South', 1, 70, { providerName: 'South' }),
      model(4, 'East', 1, 60, { providerName: 'East' }),
    ];
    // North B outranks South and East but shares a provider with North A.
    expect(recommend(spread, unitWorkload(100)).allocations.map((l) => l.model.name)).toEqual(['North A', 'South', 'East']);
    // With only two providers eligible, the third pick falls back to rank order.
    expect(recommend(spread.slice(0, 3), unitWorkload(100)).allocations.map((l) => l.model.name)).toEqual(['North A', 'North B', 'South']);
  });
});

describe('recommendation & budget loop', () => {
  it('within budget without adjustment', () => {
    const r = recommend(catalogue, unitWorkload(10));
    expect(r.withinBudget).toBe(true);
    expect(r.adjusted).toBe(false);
    // 0.40 × $2 + 0.32 × $10 + 0.28 × $20 = $9.60
    expect(r.estimatedCost.toFixed(2)).toBe('9.60');
    expect(r.reason).toMatch(/\$9\.60 of your \$10\.00 budget/);
  });

  it('shifts share from the most expensive to the cheapest until it fits', () => {
    const r = recommend(catalogue, unitWorkload(8));
    expect(r.withinBudget).toBe(true);
    expect(r.adjusted).toBe(true);
    // 40/32/28 costs $9.60; two 5-point steps from Alpha to Bravo: $8.70, then $7.80.
    expect(Object.fromEntries(r.allocations.map((l) => [l.model.name, l.allocationPercentage]))).toEqual({ Bravo: 50, Charlie: 32, Alpha: 18 });
    expect(r.estimatedCost.toFixed(2)).toBe('7.80');
    expect(r.reason).toMatch(/toward Bravo/);
  });

  it('falls back to the cheapest model when the mix cannot fit but that model can', () => {
    const r = recommend(catalogue, unitWorkload(3));
    expect(r.withinBudget).toBe(true);
    expect(r.allocations.map((l) => [l.model.name, l.allocationPercentage])).toEqual([['Bravo', 100]]);
    expect(r.estimatedCost.toFixed(2)).toBe('2.00');
  });

  it('infeasible budget: closest allocation, withinBudget false, helpful reason — not an error', () => {
    const r = recommend(catalogue, unitWorkload(1));
    expect(r.withinBudget).toBe(false);
    expect(r.allocations).toHaveLength(1);
    expect(r.allocations[0]!.model.name).toBe('Bravo');
    expect(r.estimatedCost.toFixed(2)).toBe('2.00');
    expect(r.reason).toMatch(/\$1\.00 over/);
    expect(r.reason).toMatch(/Raise the budget/);
  });

  it('zero budget returns the closest allocation, never empty', () => {
    const r = recommend(catalogue, unitWorkload(0));
    expect(r.withinBudget).toBe(false);
    expect(r.allocations.length).toBeGreaterThan(0);
    expect(r.reason).toMatch(/Nothing fits your \$0\.00 budget/);
  });

  it('no eligible models: empty allocation and a reason naming the capability', () => {
    const r = recommend(catalogue, unitWorkload(100, { requiredCapabilities: ['audio'] }));
    expect(r.allocations).toEqual([]);
    expect(r.withinBudget).toBe(false);
    expect(r.estimatedCost.toFixed(2)).toBe('0.00');
    expect(r.reason).toMatch(/Audio/);
    expect(r.reason).not.toMatch(/audio|ACTIVE|capabilit(y|ies)_/); // no schema terms
  });

  it('no eligible models: reason names the context constraint', () => {
    const r = recommend(catalogue, unitWorkload(100, { inputTokens: 300_000 }));
    expect(r.allocations).toEqual([]);
    expect(r.reason).toMatch(/301K tokens per request/);
  });

  it('no eligible models: all retired', () => {
    const r = recommend([model(1, 'Old', 1, 50, { status: 'RETIRED' })], unitWorkload(100));
    expect(r.allocations).toEqual([]);
    expect(r.reason).toMatch(/No models are available/);
  });

  it('allocation costs come from monthlyCost', () => {
    const w = unitWorkload(8);
    const r = recommend(catalogue, w);
    for (const l of r.allocations) {
      expect(l.estimatedCost.toFixed(4)).toBe(monthlyCost(l.model, w, l.allocationPercentage).toFixed(4));
    }
  });

  it('blended score is allocation-weighted', () => {
    expect(blendedScore([{ model: A, allocationPercentage: 50 }, { model: B, allocationPercentage: 50 }])).toBe(75);
  });
});

describe('validation', () => {
  it('rejects zero and non-numeric workload fields with per-field messages', () => {
    const v = validateWorkload({ name: ' ', inputTokens: 0, outputTokens: 'x', requestsPerMonth: 1.5, budget: '0', requiredCapabilities: ['nope'] });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(Object.keys(v.errors).sort()).toEqual(['budget', 'inputTokens', 'name', 'outputTokens', 'requestsPerMonth', 'requiredCapabilities']);
  });

  it('accepts a valid workload and normalises budget to 4 dp', () => {
    const v = validateWorkload({ name: 'Support bot', inputTokens: '1200', outputTokens: 300, requestsPerMonth: 50000, budget: '250.5', requiredCapabilities: ['tool_use', 'tool_use'] });
    expect(v).toEqual({ ok: true, value: { name: 'Support bot', inputTokens: 1200, outputTokens: 300, requestsPerMonth: 50000, budget: '250.5000', requiredCapabilities: ['tool_use'], scoringWeights: null, cachedInputPercent: 0, qualityBasis: 'BLENDED' } });
  });

  it('validates the cached-input share and the benchmark choice', () => {
    const base = { name: 'W', inputTokens: 1, outputTokens: 1, requestsPerMonth: 1, budget: '1', requiredCapabilities: [] };
    const ok = validateWorkload({ ...base, cachedInputPercent: '40', qualityBasis: 'INTELLIGENCE' });
    expect(ok.ok && [ok.value.cachedInputPercent, ok.value.qualityBasis]).toEqual([40, 'INTELLIGENCE']);
    for (const bad of [-1, 101, 2.5, 'lots']) expect(validateWorkload({ ...base, cachedInputPercent: bad }).ok).toBe(false);
    const basis = validateWorkload({ ...base, qualityBasis: 'VIBES' });
    expect(!basis.ok && basis.errors.qualityBasis).toBe('Choose a benchmark from the list.');
  });

  it('validates and normalises scoring weights', () => {
    const base = { name: 'W', inputTokens: 1, outputTokens: 1, requestsPerMonth: 1, budget: '1', requiredCapabilities: [] };
    const ok = validateWorkload({ ...base, scoringWeights: { quality: 50, cost: 25, latency: 25 } });
    expect(ok.ok && ok.value.scoringWeights).toEqual({ quality: 0.5, cost: 0.25, latency: 0.25, reliability: 0 });
    const zero = validateWorkload({ ...base, scoringWeights: { quality: 0, cost: 0 } });
    expect(!zero.ok && zero.errors.scoringWeights).toBe('Give at least one scoring priority some weight.');
    const bad = validateWorkload({ ...base, scoringWeights: { quality: 150 } });
    expect(!bad.ok && bad.errors.scoringWeights).toBe('Each scoring priority must be between 0 and 100.');
    const unknownKey = validateWorkload({ ...base, scoringWeights: { speed: 1 } });
    expect(unknownKey.ok).toBe(false);
  });

  it('portfolio check needs exactly 100%, within budget, at least one model', () => {
    expect(checkPortfolio([{ allocationPercentage: 60, estimatedCost: '5' }, { allocationPercentage: 40, estimatedCost: '5' }], '10').valid).toBe(true);
    expect(checkPortfolio([{ allocationPercentage: 60, estimatedCost: '5' }, { allocationPercentage: 39, estimatedCost: '5' }], '10').totalsHundred).toBe(false);
    expect(checkPortfolio([{ allocationPercentage: 100, estimatedCost: '10.0001' }], '10').withinBudget).toBe(false);
    expect(checkPortfolio([], '10').hasModels).toBe(false);
  });

  it('normalises percentages to 100', () => {
    expect(normalisePercentages([50, 50, 50])).toEqual([34, 33, 33]);
    expect(normalisePercentages([0, 0])).toEqual([100, 0]);
  });

  it('formats money for people', () => {
    expect(formatUsd('1234.5')).toBe('$1,234.50');
    expect(formatUsd('0.004')).toBe('<$0.01');
    expect(formatUsd('0')).toBe('$0.00');
  });
});
