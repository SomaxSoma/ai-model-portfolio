import { capabilityLabel, formatList, formatTokens } from './labels.js';
import type { CatalogueModel, WorkloadInput } from './types.js';

type Requirements = Pick<WorkloadInput, 'inputTokens' | 'outputTokens' | 'requiredCapabilities'>;

/**
 * A model is eligible when all hold:
 *  1. it is ACTIVE
 *  2. its context window fits inputTokens + outputTokens
 *  3. it has every required capability
 */
export function isEligible(model: CatalogueModel, workload: Requirements): boolean {
  return (
    model.status === 'ACTIVE' &&
    model.contextWindow >= workload.inputTokens + workload.outputTokens &&
    workload.requiredCapabilities.every((c) => model.capabilities.includes(c))
  );
}

export function eligibleModels<M extends CatalogueModel>(models: M[], workload: Requirements): M[] {
  return models.filter((m) => isEligible(m, workload));
}

/**
 * Plain-language explanation of why nothing is eligible, naming the
 * constraint to relax. Only meaningful when eligibleModels() is empty.
 */
export function explainNoEligibleModels(models: CatalogueModel[], workload: Requirements): string {
  const active = models.filter((m) => m.status === 'ACTIVE');
  if (active.length === 0) {
    return 'No models are available in the catalogue right now, so there is nothing to recommend.';
  }
  const needed = workload.inputTokens + workload.outputTokens;
  const fitsContext = active.filter((m) => m.contextWindow >= needed);
  const caps = workload.requiredCapabilities;
  const hasCaps = active.filter((m) => caps.every((c) => m.capabilities.includes(c)));
  const capNames = formatList(caps.map(capabilityLabel));

  if (fitsContext.length === 0) {
    const largest = Math.max(...active.map((m) => m.contextWindow));
    return `No available model can hold ${formatTokens(needed)} tokens per request — the largest holds ${formatTokens(largest)}. Shorten the prompt or the expected response.`;
  }
  if (hasCaps.length === 0) {
    return `No available model offers ${capNames} together. Try removing one of those capabilities.`;
  }
  return `Models that offer ${capNames} can't hold ${formatTokens(needed)} tokens per request. Shorten the request or remove a capability.`;
}
