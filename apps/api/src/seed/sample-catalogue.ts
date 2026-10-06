/**
 * ============================================================================
 *  SAMPLE DATA — NOT A LIVE PRICE LIST
 * ============================================================================
 *  Providers, model names, prices and benchmark scores below are ILLUSTRATIVE.
 *  The names are deliberately generic. Before launch, replace this file with
 *  data from a licensed, attributed source. The UI footer carries the same
 *  warning ("sample data, not a live price list").
 *
 *  Prices: USD per 1M tokens. Scores: 0–100 per axis.
 * ============================================================================
 */
import type { CapabilityKey, ModelStatus } from '@pf/domain';

export const SAMPLE_SOURCE = 'Sample data (illustrative)';

export const sampleProviders = [
  { name: 'Atlas Labs', website: 'https://example.com/atlas', description: 'Sample provider: frontier general-purpose models.' },
  { name: 'Northwind AI', website: 'https://example.com/northwind', description: 'Sample provider: balanced models for production work.' },
  { name: 'Meridian', website: 'https://example.com/meridian', description: 'Sample provider: long-context and multimodal models.' },
  { name: 'Open Weights Collective', website: 'https://example.com/open-weights', description: 'Sample provider: open-weight models served by hosts.' },
] as const;

export interface SampleModel {
  provider: (typeof sampleProviders)[number]['name'];
  name: string;
  version: string;
  contextWindow: number;
  inputPrice: string;
  outputPrice: string;
  codingScore: number;
  reasoningScore: number;
  status: ModelStatus;
  capabilities: CapabilityKey[];
}

export const sampleModels: SampleModel[] = [
  { provider: 'Atlas Labs', name: 'GPT-class Frontier', version: '2026-06', contextWindow: 400_000, inputPrice: '5.0000', outputPrice: '20.0000', codingScore: 92, reasoningScore: 94, status: 'ACTIVE', capabilities: ['vision', 'tool_use', 'structured_output', 'reasoning'] },
  { provider: 'Atlas Labs', name: 'GPT-class Mini', version: '2026-06', contextWindow: 200_000, inputPrice: '0.4000', outputPrice: '1.6000', codingScore: 78, reasoningScore: 74, status: 'ACTIVE', capabilities: ['vision', 'tool_use', 'structured_output'] },
  { provider: 'Northwind AI', name: 'Balanced Pro', version: '4.1', contextWindow: 200_000, inputPrice: '3.0000', outputPrice: '15.0000', codingScore: 90, reasoningScore: 88, status: 'ACTIVE', capabilities: ['vision', 'tool_use', 'structured_output', 'reasoning'] },
  { provider: 'Northwind AI', name: 'Swift', version: '4.1', contextWindow: 200_000, inputPrice: '0.8000', outputPrice: '4.0000', codingScore: 80, reasoningScore: 72, status: 'ACTIVE', capabilities: ['vision', 'tool_use'] },
  { provider: 'Meridian', name: 'Long-Context Ultra', version: '2.5', contextWindow: 1_000_000, inputPrice: '2.5000', outputPrice: '10.0000', codingScore: 85, reasoningScore: 89, status: 'ACTIVE', capabilities: ['vision', 'audio', 'tool_use', 'structured_output', 'reasoning'] },
  { provider: 'Meridian', name: 'Flash Lite', version: '2.5', contextWindow: 1_000_000, inputPrice: '0.1000', outputPrice: '0.4000', codingScore: 68, reasoningScore: 62, status: 'ACTIVE', capabilities: ['vision', 'audio', 'structured_output'] },
  { provider: 'Open Weights Collective', name: 'Open 70B', version: '3.3', contextWindow: 128_000, inputPrice: '0.6000', outputPrice: '0.6000', codingScore: 72, reasoningScore: 70, status: 'ACTIVE', capabilities: ['tool_use', 'structured_output'] },
  { provider: 'Open Weights Collective', name: 'Open 405B Legacy', version: '3.1', contextWindow: 128_000, inputPrice: '3.0000', outputPrice: '3.0000', codingScore: 76, reasoningScore: 75, status: 'RETIRED', capabilities: ['tool_use'] },
];
