/**
 * Cost-calculation correctness — the proposal's primary evaluation metric
 * (§6.1: 100% agreement with manually verified expected values).
 *
 * Each `expected` value was worked out by hand from
 *   ((inputTokens × inputPrice + outputTokens × outputPrice) / 1,000,000)
 *     × requestsPerMonth × share / 100, rounded half-up to 4 dp,
 * with the arithmetic shown in `working`. CI runs every case; the admin
 * evaluation dashboard re-runs them live.
 */
export interface GoldenCostCase {
  id: string;
  description: string;
  model: { inputPrice: string; outputPrice: string };
  workload: { inputTokens: number; outputTokens: number; requestsPerMonth: number };
  share: number;
  working: string;
  expected: string;
}

export const GOLDEN_COST_CASES: GoldenCostCase[] = [
  { id: 'G01', description: 'Unit prices, unit volume', model: { inputPrice: '1', outputPrice: '1' }, workload: { inputTokens: 1000, outputTokens: 1000, requestsPerMonth: 1000 }, share: 100, working: '(1000+1000)/1e6 × 1000', expected: '2.0000' },
  { id: 'G02', description: 'Typical mid-tier model', model: { inputPrice: '3', outputPrice: '15' }, workload: { inputTokens: 2000, outputTokens: 500, requestsPerMonth: 10000 }, share: 100, working: '(6000+7500)/1e6 × 10000', expected: '135.0000' },
  { id: 'G03', description: 'Partial share', model: { inputPrice: '3', outputPrice: '15' }, workload: { inputTokens: 2000, outputTokens: 500, requestsPerMonth: 10000 }, share: 40, working: '135 × 0.40', expected: '54.0000' },
  { id: 'G04', description: 'Budget model, support workload', model: { inputPrice: '0.10', outputPrice: '0.40' }, workload: { inputTokens: 1500, outputTokens: 400, requestsPerMonth: 50000 }, share: 100, working: '(150+160)/1e6 × 50000', expected: '15.5000' },
  { id: 'G05', description: 'Flat-priced open model', model: { inputPrice: '0.60', outputPrice: '0.60' }, workload: { inputTokens: 1500, outputTokens: 400, requestsPerMonth: 50000 }, share: 100, working: '(900+240)/1e6 × 50000', expected: '57.0000' },
  { id: 'G06', description: 'Mini model, support workload', model: { inputPrice: '0.40', outputPrice: '1.60' }, workload: { inputTokens: 1500, outputTokens: 400, requestsPerMonth: 50000 }, share: 100, working: '(600+640)/1e6 × 50000', expected: '62.0000' },
  { id: 'G07', description: 'Fast model, support workload', model: { inputPrice: '0.80', outputPrice: '4.00' }, workload: { inputTokens: 1500, outputTokens: 400, requestsPerMonth: 50000 }, share: 100, working: '(1200+1600)/1e6 × 50000', expected: '140.0000' },
  { id: 'G08', description: 'Coding agent, long-context model at 41%', model: { inputPrice: '2.50', outputPrice: '10.00' }, workload: { inputTokens: 6000, outputTokens: 1200, requestsPerMonth: 20000 }, share: 41, working: '(15000+12000)/1e6 × 20000 = 540; × 0.41', expected: '221.4000' },
  { id: 'G09', description: 'Coding agent, balanced model at 35%', model: { inputPrice: '3', outputPrice: '15' }, workload: { inputTokens: 6000, outputTokens: 1200, requestsPerMonth: 20000 }, share: 35, working: '(18000+18000)/1e6 × 20000 = 720; × 0.35', expected: '252.0000' },
  { id: 'G10', description: 'Coding agent, frontier model at 24%', model: { inputPrice: '5', outputPrice: '20' }, workload: { inputTokens: 6000, outputTokens: 1200, requestsPerMonth: 20000 }, share: 24, working: '(30000+24000)/1e6 × 20000 = 1080; × 0.24', expected: '259.2000' },
  { id: 'G11', description: 'Sub-cent amount rounds half-up', model: { inputPrice: '0.15', outputPrice: '0' }, workload: { inputTokens: 1, outputTokens: 0, requestsPerMonth: 1000 }, share: 100, working: '0.15/1e6 × 1000 = 0.00015 → 0.0002', expected: '0.0002' },
  { id: 'G12', description: 'Decimal exactness (0.1 + 0.2)', model: { inputPrice: '0.1', outputPrice: '0.2' }, workload: { inputTokens: 1000000, outputTokens: 1000000, requestsPerMonth: 1 }, share: 100, working: '(100000+200000)/1e6 × 1', expected: '0.3000' },
  { id: 'G13', description: 'Full 128K context request', model: { inputPrice: '3', outputPrice: '15' }, workload: { inputTokens: 128000, outputTokens: 4000, requestsPerMonth: 1 }, share: 100, working: '(384000+60000)/1e6', expected: '0.4440' },
  { id: 'G14', description: 'Zero share costs nothing', model: { inputPrice: '5', outputPrice: '20' }, workload: { inputTokens: 1000, outputTokens: 1000, requestsPerMonth: 1000 }, share: 0, working: '25 × 0', expected: '0.0000' },
  { id: 'G15', description: 'Very large workload', model: { inputPrice: '1000', outputPrice: '1000' }, workload: { inputTokens: 100000, outputTokens: 20000, requestsPerMonth: 100000000 }, share: 100, working: '(1e8+2e7)/1e6 = 120; × 1e8', expected: '12000000000.0000' },
  { id: 'G16', description: 'Odd prices and share', model: { inputPrice: '0.333', outputPrice: '0.777' }, workload: { inputTokens: 333, outputTokens: 777, requestsPerMonth: 3 }, share: 33, working: '(110.889+603.729)/1e6 × 3 × 0.33 = 0.00070747… → 0.0007', expected: '0.0007' },
  { id: 'G17', description: 'Non-round volume', model: { inputPrice: '2.5', outputPrice: '10' }, workload: { inputTokens: 750, outputTokens: 250, requestsPerMonth: 12345 }, share: 17, working: '(1875+2500)/1e6 × 12345 = 54.009375; × 0.17 = 9.18159375', expected: '9.1816' },
];
