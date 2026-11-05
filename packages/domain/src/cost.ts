import { Decimal, toMoney, type DecimalLike } from './money.js';
import type { CatalogueModel, WorkloadInput } from './types.js';

export const TOKENS_PER_PRICE_UNIT = 1_000_000;

type PricedModel = Pick<CatalogueModel, 'inputPrice' | 'outputPrice' | 'cacheReadPrice'>;
type Volume = Pick<WorkloadInput, 'inputTokens' | 'outputTokens' | 'requestsPerMonth' | 'cachedInputPercent'>;

/**
 * Effective price per 1M input tokens when a share of input is read from the
 * prompt cache: inputPrice × (100 − c)% + cacheReadPrice × c%. A model with no
 * published cache price is charged its normal input price for every token.
 */
export function effectiveInputPrice(model: PricedModel, cachedInputPercent: DecimalLike = 0): Decimal {
  const c = new Decimal(cachedInputPercent);
  if (c.isZero() || model.cacheReadPrice === null || model.cacheReadPrice === undefined) return new Decimal(model.inputPrice);
  return new Decimal(model.inputPrice).mul(new Decimal(100).minus(c)).plus(new Decimal(model.cacheReadPrice).mul(c)).div(100);
}

/**
 * THE cost function. Every cost shown anywhere in the app — workload preview,
 * recommendation, allocation rows, breakdown table, server-side save checks —
 * comes from here. Do not reimplement it.
 *
 *   ((inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000)
 *     * requestsPerMonth * (sharePercent / 100)
 *
 * where inputPrice is the effective input price when part of the input is
 * served from the prompt cache (effectiveInputPrice; unchanged at 0%).
 *
 * Result is rounded to the stored money scale (4 dp) so the value a user sees
 * is the value the database stores.
 */
export function monthlyCost(model: PricedModel, workload: Volume, sharePercent: DecimalLike = 100): Decimal {
  const perRequest = new Decimal(workload.inputTokens)
    .mul(effectiveInputPrice(model, workload.cachedInputPercent ?? 0))
    .plus(new Decimal(workload.outputTokens).mul(model.outputPrice))
    .div(TOKENS_PER_PRICE_UNIT);
  return toMoney(perRequest.mul(workload.requestsPerMonth).mul(sharePercent).div(100));
}

/** Split of a line's cost into its input and output parts, for the breakdown table. */
export function costBreakdown(model: PricedModel, workload: Volume, sharePercent: DecimalLike = 100) {
  const input = monthlyCost({ inputPrice: model.inputPrice, cacheReadPrice: model.cacheReadPrice, outputPrice: 0 }, workload, sharePercent);
  const output = monthlyCost({ inputPrice: 0, outputPrice: model.outputPrice }, workload, sharePercent);
  return { input, output, total: monthlyCost(model, workload, sharePercent) };
}
