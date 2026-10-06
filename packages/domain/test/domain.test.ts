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
    // Delta widens the cost range to $2–$100, so Alpha's costNorm rises to 0.82:
    // Alpha 0.867, Charlie 0.847, Bravo 0.760, Delta 0.060 → Delta is dropped.
    const D = model(4, 'Delta', 50, 10);
    const r = recommend([...catalogue, D], unitWorkload(1000));
    expect(r.allocations.map((l) => l.model.name)).toEqual(['Alpha', 'Charlie', 'Bravo']);
    expect(r.allocations.map((l) => l.allocationPercentage)).toEqual([35, 34, 31]);
    // Without Delta the ranking is Bravo 38, Charlie 35, Alpha 27.
    expect(recommend(catalogue, unitWorkload(1000)).allocations.map((l) => l.allocationPercentage)).toEqual([38, 35, 27]);
  });

  it('is deterministic', () => {
    const w = unitWorkload(8);
    expect(JSON.stringify(recommend(catalogue, w))).toBe(JSON.stringify(recommend([...catalogue].reverse(), w)));
  });
});

describe('recommendation & budget loop', () => {
  it('within budget without adjustment', () => {
    const r = recommend(catalogue, unitWorkload(10));
    expect(r.withinBudget).toBe(true);
    expect(r.adjusted).toBe(false);
    expect(r.estimatedCost.toFixed(2)).toBe('9.66');
    expect(r.reason).toMatch(/\$9\.66 of your \$10\.00 budget/);
  });

  it('shifts share from the most expensive to the cheapest until it fits', () => {
    const r = recommend(catalogue, unitWorkload(8));
    expect(r.withinBudget).toBe(true);
    expect(r.adjusted).toBe(true);
    expect(Object.fromEntries(r.allocations.map((l) => [l.model.name, l.allocationPercentage]))).toEqual({ Bravo: 48, Charlie: 35, Alpha: 17 });
    expect(r.estimatedCost.toFixed(2)).toBe('7.86');
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
    expect(v).toEqual({ ok: true, value: { name: 'Support bot', inputTokens: 1200, outputTokens: 300, requestsPerMonth: 50000, budget: '250.5000', requiredCapabilities: ['tool_use'] } });
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
