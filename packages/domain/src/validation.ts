import { CAPABILITY_KEYS } from './labels.js';
import { Decimal, sumMoney, type DecimalLike } from './money.js';
import { normaliseWeights, type ScoringWeights } from './scoring.js';
import { QUALITY_BASES, type QualityBasis } from './types.js';

/**
 * Validation rules shared by client and server. The server is authoritative;
 * the client runs the same functions only to show errors early.
 */

export const LIMITS = {
  maxTokensPerRequest: 10_000_000,
  maxRequestsPerMonth: 100_000_000,
  /** numeric(12,4) holds up to 99,999,999.9999 */
  maxMoney: '99999999.9999',
  maxPricePerMillion: '1000',
  nameMax: 120,
} as const;

export type FieldErrors = Record<string, string>;

export interface WorkloadDraft {
  name: unknown;
  inputTokens: unknown;
  outputTokens: unknown;
  requestsPerMonth: unknown;
  budget: unknown;
  requiredCapabilities: unknown;
  /** Optional ranking factors; omitted or null means the default 60/40. */
  scoringWeights?: unknown;
  /** Optional, 0–100 whole number; default 0. */
  cachedInputPercent?: unknown;
  /** Optional, one of QUALITY_BASES; default BLENDED. */
  qualityBasis?: unknown;
}

export interface ValidWorkload {
  name: string;
  inputTokens: number;
  outputTokens: number;
  requestsPerMonth: number;
  /** Decimal string */
  budget: string;
  requiredCapabilities: string[];
  /** Normalised to sum to 1, or null for the default. */
  scoringWeights: ScoringWeights | null;
  cachedInputPercent: number;
  qualityBasis: QualityBasis;
}

export type Validated<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return null;
}

export function parsePositiveInt(v: unknown, label: string, max: number): { value?: number; error?: string } {
  const n = toNumber(v);
  if (n === null) return { error: `Enter ${label}.` };
  if (!Number.isInteger(n)) return { error: `Use a whole number for ${label}.` };
  if (n <= 0) return { error: `${capitalise(label)} must be more than 0.` };
  if (n > max) return { error: `${capitalise(label)} can be at most ${max.toLocaleString('en-US')}.` };
  return { value: n };
}

export function parseMoney(v: unknown, label: string, opts: { allowZero?: boolean; max?: string } = {}): { value?: string; error?: string } {
  const raw = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '';
  if (!/^\d+(\.\d+)?$/.test(raw) && !/^-\d+(\.\d+)?$/.test(raw)) return { error: `Enter ${label} as an amount in dollars.` };
  const d = new Decimal(raw);
  if (d.isNeg()) return { error: `${capitalise(label)} can’t be negative.` };
  if (!opts.allowZero && d.isZero()) return { error: `${capitalise(label)} must be more than $0.` };
  if (d.decimalPlaces() > 4) return { error: `Use at most four decimal places for ${label}.` };
  if (d.gt(opts.max ?? LIMITS.maxMoney)) return { error: `${capitalise(label)} is too large.` };
  return { value: d.toFixed(4) };
}

export function parseName(v: unknown, label: string, min = 1): { value?: string; error?: string } {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min) return { error: min > 1 ? `${capitalise(label)} needs at least ${min} characters.` : `Give the ${label} a name.` };
  if (s.length > LIMITS.nameMax) return { error: `Keep the ${label} name under ${LIMITS.nameMax} characters.` };
  return { value: s };
}

export function validateWorkload(draft: WorkloadDraft): Validated<ValidWorkload> {
  const errors: FieldErrors = {};
  const name = parseName(draft.name, 'workload');
  const inputTokens = parsePositiveInt(draft.inputTokens, 'input tokens per request', LIMITS.maxTokensPerRequest);
  const outputTokens = parsePositiveInt(draft.outputTokens, 'output tokens per request', LIMITS.maxTokensPerRequest);
  const requests = parsePositiveInt(draft.requestsPerMonth, 'requests per month', LIMITS.maxRequestsPerMonth);
  const budget = parseMoney(draft.budget, 'monthly budget');

  if (name.error) errors.name = name.error;
  if (inputTokens.error) errors.inputTokens = inputTokens.error;
  if (outputTokens.error) errors.outputTokens = outputTokens.error;
  if (requests.error) errors.requestsPerMonth = requests.error;
  if (budget.error) errors.budget = budget.error;

  let caps: string[] = [];
  if (draft.requiredCapabilities !== undefined && draft.requiredCapabilities !== null) {
    if (!Array.isArray(draft.requiredCapabilities) || draft.requiredCapabilities.some((c) => typeof c !== 'string' || !CAPABILITY_KEYS.includes(c))) {
      errors.requiredCapabilities = 'Choose capabilities from the list.';
    } else {
      caps = [...new Set(draft.requiredCapabilities as string[])];
    }
  }

  const weights = parseWeights(draft.scoringWeights);
  if (weights.error) errors.scoringWeights = weights.error;

  let cachedInputPercent = 0;
  if (draft.cachedInputPercent !== undefined && draft.cachedInputPercent !== null && draft.cachedInputPercent !== '') {
    const c = toNumber(draft.cachedInputPercent);
    if (c === null || !Number.isInteger(c) || c < 0 || c > 100) errors.cachedInputPercent = 'Enter a whole percentage from 0 to 100.';
    else cachedInputPercent = c;
  }
  let qualityBasis: QualityBasis = 'BLENDED';
  if (draft.qualityBasis !== undefined && draft.qualityBasis !== null) {
    if (typeof draft.qualityBasis !== 'string' || !QUALITY_BASES.includes(draft.qualityBasis as QualityBasis)) errors.qualityBasis = 'Choose a benchmark from the list.';
    else qualityBasis = draft.qualityBasis as QualityBasis;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name: name.value!,
      inputTokens: inputTokens.value!,
      outputTokens: outputTokens.value!,
      requestsPerMonth: requests.value!,
      budget: budget.value!,
      requiredCapabilities: caps,
      scoringWeights: weights.value ?? null,
      cachedInputPercent,
      qualityBasis,
    },
  };
}

const WEIGHT_KEYS = ['quality', 'cost', 'latency', 'reliability'] as const;

/** Weights arrive as any non-negative numbers (the UI sends percentages); stored normalised. */
export function parseWeights(v: unknown): { value?: ScoringWeights | null; error?: string } {
  if (v === undefined || v === null) return { value: null };
  if (typeof v !== 'object' || Array.isArray(v)) return { error: 'Set the scoring priorities as numbers.' };
  const raw = v as Record<string, unknown>;
  if (Object.keys(raw).some((k) => !(WEIGHT_KEYS as readonly string[]).includes(k))) return { error: 'Set the scoring priorities as numbers.' };
  const out: Partial<ScoringWeights> = {};
  for (const k of WEIGHT_KEYS) {
    const n = raw[k] === undefined ? 0 : toNumber(raw[k]);
    if (n === null || n < 0 || n > 100) return { error: 'Each scoring priority must be between 0 and 100.' };
    out[k] = n;
  }
  if (WEIGHT_KEYS.every((k) => out[k] === 0)) return { error: 'Give at least one scoring priority some weight.' };
  return { value: normaliseWeights(out) };
}

export interface PortfolioCheck {
  totalPercent: number;
  totalCost: Decimal;
  totalsHundred: boolean;
  withinBudget: boolean;
  hasModels: boolean;
  valid: boolean;
}

/** The three save-time validations. */
export function checkPortfolio(lines: { allocationPercentage: number; estimatedCost: DecimalLike }[], budget: DecimalLike): PortfolioCheck {
  const live = lines.filter((l) => l.allocationPercentage > 0);
  const totalPercent = live.reduce((a, l) => a + l.allocationPercentage, 0);
  const totalCost = sumMoney(live.map((l) => l.estimatedCost));
  const totalsHundred = totalPercent === 100;
  const withinBudget = totalCost.lte(budget);
  const hasModels = live.length > 0;
  return { totalPercent, totalCost, totalsHundred, withinBudget, hasModels, valid: totalsHundred && withinBudget && hasModels };
}

/** Scale integer percentages to total exactly 100, drift to the largest share. */
export function normalisePercentages(pcts: number[]): number[] {
  const sum = pcts.reduce((a, b) => a + b, 0);
  if (pcts.length === 0) return [];
  if (sum === 0) return pcts.map((_, i) => (i === 0 ? 100 : 0));
  const out = pcts.map((p) => Math.round((p / sum) * 100));
  const drift = 100 - out.reduce((a, b) => a + b, 0);
  const top = out.indexOf(Math.max(...out));
  out[top] = out[top]! + drift;
  return out;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
