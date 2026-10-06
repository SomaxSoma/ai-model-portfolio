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
  reasoningScore: number;
  status: ModelStatus;
  capabilities: string[];
}

export interface WorkloadInput {
  inputTokens: number;
  outputTokens: number;
  requestsPerMonth: number;
  budget: DecimalLike;
  requiredCapabilities: string[];
}
