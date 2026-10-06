import { Decimal, formatTokens, formatUsd } from '@pf/domain';

export { formatTokens, formatUsd };

/** Per-1M-token prices: two decimals, more only when the price needs them. */
export function formatPrice(value: string): string {
  const d = new Decimal(value);
  const places = Math.max(2, d.decimalPlaces());
  const [int, frac] = d.toFixed(places).split('.');
  return `$${(int ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatInt(n: number): string {
  return n.toLocaleString('en-US');
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
