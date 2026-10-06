import { Decimal, toMoney, type DecimalLike } from './money.js';
import type { CatalogueModel, WorkloadInput } from './types.js';

export const TOKENS_PER_PRICE_UNIT = 1_000_000;

type PricedModel = Pick<CatalogueModel, 'inputPrice' | 'outputPrice'>;
type Volume = Pick<WorkloadInput, 'inputTokens' | 'outputTokens' | 'requestsPerMonth'>;

/**
 * THE cost function. Every cost shown anywhere in the app — workload preview,
 * recommendation, allocation rows, breakdown table, server-side save checks —
 * comes from here. Do not reimplement it.
 *
 *   ((inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000)
 *     * requestsPerMonth * (sharePercent / 100)
 *
 * Result is rounded to the stored money scale (4 dp) so the value a user sees
 * is the value the database stores.
 */
export function monthlyCost(model: PricedModel, workload: Volume, sharePercent: DecimalLike = 100): Decimal {
  const perRequest = new Decimal(workload.inputTokens)
    .mul(model.inputPrice)
    .plus(new Decimal(workload.outputTokens).mul(model.outputPrice))
    .div(TOKENS_PER_PRICE_UNIT);
  return toMoney(perRequest.mul(workload.requestsPerMonth).mul(sharePercent).div(100));
}

/** Split of a line's cost into its input and output parts, for the breakdown table. */
export function costBreakdown(model: PricedModel, workload: Volume, sharePercent: DecimalLike = 100) {
  const input = monthlyCost({ inputPrice: model.inputPrice, outputPrice: 0 }, workload, sharePercent);
  const output = monthlyCost({ inputPrice: 0, outputPrice: model.outputPrice }, workload, sharePercent);
  return { input, output, total: monthlyCost(model, workload, sharePercent) };
}
