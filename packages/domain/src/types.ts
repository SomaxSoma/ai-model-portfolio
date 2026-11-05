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
  codingScore: number;
  /** Null when the source publishes no intelligence/reasoning index for the model. */
  reasoningScore: number | null;
  status: ModelStatus;
  capabilities: string[];
  /** Median end-to-end latency in milliseconds. null = not available from any source. */
  latencyMs?: number | null;
  /** Measured availability over the last 30 days, 0–100. null = not available. */
  reliability?: number | null;
  /** ISO date (YYYY-MM-DD) the provider will stop serving the model. null = none announced. */
  deprecationDate?: string | null;
}

export interface WorkloadInput {
  inputTokens: number;
  outputTokens: number;
  requestsPerMonth: number;
  budget: DecimalLike;
  requiredCapabilities: string[];
}
