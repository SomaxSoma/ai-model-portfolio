import type { DecimalLike } from './money.js';

export type ModelStatus = 'ACTIVE' | 'RETIRED';
export const MODEL_STATUSES: readonly ModelStatus[] = ['ACTIVE', 'RETIRED'];

export type Role = 'USER' | 'ADMIN';

/** A catalogue model as the domain library sees it. Prices are per 1M tokens, USD. */
export interface CatalogueModel {
  id: number;
  name: string;
  version: string;
  providerName: string;
  contextWindow: number;
  inputPrice: DecimalLike;
  outputPrice: DecimalLike;
  /** Price per 1M input tokens read from the provider's prompt cache. null/absent = no cache pricing published. */
  cacheReadPrice?: DecimalLike | null;
  codingScore: number;
  /** Null when the source publishes no intelligence/reasoning index for the model. */
  reasoningScore: number | null;
  status: ModelStatus;
  capabilities: string[];
  /** Median end-to-end latency in milliseconds. null = not available from any source. */
  latencyMs?: number | null;
  /** Measured availability, 0–100 (the live source publishes the last 24 hours). null = not available. */
  reliability?: number | null;
  /** ISO date (YYYY-MM-DD) the provider will stop serving the model. null = none announced. */
  deprecationDate?: string | null;
}

/**
 * Which benchmark stands for quality when ranking models:
 *  BLENDED      — coding and intelligence indices averaged (coding alone where intelligence isn't published)
 *  CODING       — the coding index only
 *  INTELLIGENCE — the intelligence index only; models without one are not eligible
 */
export type QualityBasis = 'BLENDED' | 'CODING' | 'INTELLIGENCE';
export const QUALITY_BASES: readonly QualityBasis[] = ['BLENDED', 'CODING', 'INTELLIGENCE'];

export interface WorkloadInput {
  inputTokens: number;
  outputTokens: number;
  requestsPerMonth: number;
  budget: DecimalLike;
  requiredCapabilities: string[];
  /** Share (0–100) of input tokens served from the provider's prompt cache. Default 0. */
  cachedInputPercent?: number;
  /** Default BLENDED. */
  qualityBasis?: QualityBasis;
}
