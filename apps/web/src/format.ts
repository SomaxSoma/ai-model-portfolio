import { Decimal, formatTokens, formatUsd } from '@pf/domain';

export { formatTokens, formatUsd };

/** Per-1M-token prices: two decimals, more only when the price needs them. */
export function formatPrice(value: string): string {
  const d = new Decimal(value);
  const places = Math.max(2, d.decimalPlaces());
  const [int, frac] = d.toFixed(places).split('.');
  return `$${(int ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`;
}

/**
 * A per-1M-token price for lists and tables, with one rule everywhere:
 * 2 decimals from $1 up, 3 decimals below $1 ($0.021, $0.045, $0.300).
 * The exact stored price (formatPrice) is on the model page; costs always use it.
 */
export function formatListPrice(value: string): string {
  const d = new Decimal(value);
  const [int, frac] = d.toFixed(d.gte(1) ? 2 : 3).split('.');
  return `$${(int ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`;
}

export function formatDate(iso: string): string {
  // A bare calendar date (e.g. a retirement date) is the same day everywhere: format it in UTC.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  return new Date(dateOnly ? `${iso}T00:00:00Z` : iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', ...(dateOnly ? { timeZone: 'UTC' } : {}) });
}

export function formatInt(n: number): string {
  return n.toLocaleString('en-US');
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
