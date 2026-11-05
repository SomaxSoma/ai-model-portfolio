import type { QualityBasis, ModelStatus, RiskReport, Role, Scenario, ScoringWeights } from '@pf/domain';

/** Wire types. Money is always a decimal string. */

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  /** A disposable demo account, removed after a day. */
  isDemo: boolean;
  emailAlerts: boolean;
  /** False for Google/GitHub-only and demo accounts. */
  hasPassword: boolean;
}

/** What the sign-in screen can offer on this deployment. */
export interface AuthOptions {
  passwordReset: boolean;
  emailAlerts: boolean;
  providers: ('google' | 'github')[];
  demo: boolean;
}

export interface Provider {
  id: number;
  name: string;
  website: string | null;
  description: string | null;
  /** ISO 3166-1 alpha-2 of the company's headquarters; null = not recorded. */
  hqCountry: string | null;
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
  /** Per 1M input tokens read from the prompt cache; null = not published. */
  cacheReadPrice: string | null;
  /** Headquarters of the provider (ISO alpha-2); null = not recorded. */
  providerHqCountry: string | null;
  codingScore: number;
  /** Artificial Analysis Intelligence Index; null when not published. */
  reasoningScore: number | null;
  overallScore: number;
  status: ModelStatus;
  capabilities: string[];
  latencyMs: number | null;
  reliability: number | null;
  deprecationDate: string | null;
  lastVerifiedAt: string;
  updatedAt: string;
  /** Stable id at the live source, e.g. openrouter:anthropic/claude-haiku-5.5 */
  externalId: string | null;
}

export interface ModelDetail extends Model {
  history: {
    pricing: { recordedAt: string; inputPrice: string; outputPrice: string; cacheReadPrice: string | null; source: string }[];
    benchmarks: { recordedAt: string; codingScore: number; reasoningScore: number | null; latencyMs: number | null; reliability: number | null; source: string }[];
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
  scoringWeights: ScoringWeights | null;
  cachedInputPercent: number;
  qualityBasis: QualityBasis;
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
  scoringWeights: ScoringWeights | null;
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
  allocations: { modelId: number; model: Model; allocationPercentage: number; estimatedCost: string; savedEstimatedCost: string; inputCost: string; outputCost: string }[];
  estimatedCost: string;
  savedEstimatedCost: string;
  withinBudget: boolean;
  score: number;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationItem {
  id: number;
  kind: 'COST_CHANGE' | 'OVER_BUDGET' | 'MODEL_RETIRED' | 'MODEL_DEPRECATION' | 'INGESTION_FAILED' | 'DATA_QUALITY';
  severity: 'INFO' | 'WARNING';
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationPage {
  items: NotificationItem[];
  total: number;
  unread: number;
}

export interface Overview {
  catalogue: { models: number; available: number; providers: number; avgInputPrice: string; avgOutputPrice: string; deprecatingSoon: number; lastSyncedAt: string | null; lastSource: string | null; live: boolean };
  freshness: { available: number; fresh: number; thresholdHours: number; oldestVerifiedAt: string | null };
  priceIndex: { date: string; avgInputPrice: string; avgOutputPrice: string; models: number }[];
  portfolios: {
    count: number;
    totalMonthlyCost: string;
    totalBudget: string;
    overBudget: number;
    items: { id: number; name: string; estimatedCost: string; budget: string; withinBudget: boolean; models: number }[];
    providerExposure: { provider: string; costShare: number }[];
  };
}

export interface CostQuality {
  workload: { id: number; name: string; budget: string } | null;
  reference: { inputTokens: number; outputTokens: number; requestsPerMonth: number } | null;
  points: { modelId: number; name: string; provider: string; overallScore: number; monthlyCost: string; latencyMs: number | null; reliability: number | null; eligible: boolean }[];
}

export interface SimOutcome {
  lines: { modelId: number; model: Model; allocationPercentage: number; estimatedCost: string }[];
  estimatedCost: string;
  withinBudget: boolean;
  score: number;
  risk: RiskReport;
}

export interface Simulation {
  scenario: Scenario;
  description: string;
  budget: string;
  baseline: SimOutcome;
  kept: SimOutcome & { lostShare: number; note: string };
  reoptimised: SimOutcome & { reason: string };
}

export interface Feedback {
  clarityRating: number;
  priorModelId: number | null;
  comment: string | null;
}
