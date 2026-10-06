import DecimalJs from 'decimal.js';

/**
 * Decimal constructor used for every money value in the app.
 * Money is never a JS float: prices, budgets and costs stay decimal end to end
 * and are serialised as strings over the API.
 */
export const Decimal = DecimalJs.clone({ precision: 40, rounding: DecimalJs.ROUND_HALF_UP });
export type Decimal = InstanceType<typeof Decimal>;
export type DecimalLike = Decimal | string | number;

/** Scale of every stored money column (numeric(…, 4)). */
export const MONEY_SCALE = 4;

export function dec(value: DecimalLike): Decimal {
  return new Decimal(value);
}

/** Round to the stored money scale. */
export function toMoney(value: DecimalLike): Decimal {
  return new Decimal(value).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
}

/** Wire / database representation: a fixed-scale decimal string. */
export function moneyString(value: DecimalLike): string {
  return toMoney(value).toFixed(MONEY_SCALE);
}

export function sumMoney(values: DecimalLike[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(v), new Decimal(0));
}

/** User-facing currency format. Amounts under a cent never round down to "$0.00". */
export function formatUsd(value: DecimalLike, opts: { precise?: boolean } = {}): string {
  const d = new Decimal(value);
  if (!d.isZero() && d.abs().lt(0.01) && !opts.precise) return d.isNeg() ? '-<$0.01' : '<$0.01';
  const places = opts.precise ? 4 : 2;
  const fixed = d.abs().toFixed(places);
  const [int, frac] = fixed.split('.');
  const grouped = (int ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${d.isNeg() ? '-' : ''}$${grouped}${frac ? `.${frac}` : ''}`;
}
