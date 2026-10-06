import type { ModelStatus, Role } from '@pf/domain';

/** Wire types. Money is always a decimal string. */

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
}

export interface Provider {
  id: number;
  name: string;
  website: string | null;
  description: string | null;
  modelCount: number;
}

export interface Model {
  id: number;
  providerId: number;
  providerName: string;
  name: string;
  version: string;
  contextWindow: number;
  inputPrice: string;
  outputPrice: string;
  codingScore: number;
  reasoningScore: number;
  overallScore: number;
  status: ModelStatus;
  capabilities: string[];
  updatedAt: string;
}

export interface ModelDetail extends Model {
  history: {
    pricing: { recordedAt: string; inputPrice: string; outputPrice: string; source: string }[];
    benchmarks: { recordedAt: string; codingScore: number; reasoningScore: number; source: string }[];
  };
}

export interface Workload {
  id: number;
  name: string;
  inputTokens: number;
  outputTokens: number;
  requestsPerMonth: number;
  budget: string;
  requiredCapabilities: string[];
  createdAt: string;
}

export interface Recommendation {
  id: number;
  workloadId: number;
  portfolioId: number | null;
  estimatedCost: string;
  score: number;
  withinBudget: boolean;
  adjusted: boolean;
  reason: string;
  createdAt: string;
  workload: Workload;
  allocations: { modelId: number; allocationPercentage: number; estimatedCost: string; model: Model | null }[];
}

export interface Portfolio {
  id: number;
  name: string;
  budget: string;
  workloadId: number;
  recommendationId: number | null;
  workload: Workload;
  allocations: { modelId: number; model: Model; allocationPercentage: number; estimatedCost: string; inputCost: string; outputCost: string }[];
  estimatedCost: string;
  score: number;
  createdAt: string;
  updatedAt: string;
}
