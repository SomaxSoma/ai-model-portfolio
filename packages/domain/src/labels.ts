import type { ModelStatus, Role } from './types.js';

/** Capability keys known to the catalogue, with their user-facing labels. */
export const CAPABILITIES = [
  { key: 'vision', label: 'Vision' },
  { key: 'tool_use', label: 'Tool use' },
  { key: 'structured_output', label: 'Structured output' },
  { key: 'reasoning', label: 'Extended reasoning' },
  { key: 'audio', label: 'Audio' },
] as const;

export type CapabilityKey = (typeof CAPABILITIES)[number]['key'];
export const CAPABILITY_KEYS: readonly string[] = CAPABILITIES.map((c) => c.key);

/** Where a provider is headquartered, grouped for filtering. Not where data is processed. */
export type HqRegion = 'US' | 'EUROPE' | 'CHINA' | 'OTHER';
export const HQ_REGIONS: { key: HqRegion; label: string }[] = [
  { key: 'US', label: 'United States' },
  { key: 'EUROPE', label: 'Europe' },
  { key: 'CHINA', label: 'China' },
  { key: 'OTHER', label: 'Elsewhere' },
];
const EUROPE = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'GB', 'CH', 'NO', 'IS']);

/** null when the headquarters isn't recorded. */
export function hqRegion(country: string | null | undefined): HqRegion | null {
  if (!country) return null;
  if (country === 'US') return 'US';
  if (country === 'CN') return 'CHINA';
  return EUROPE.has(country) ? 'EUROPE' : 'OTHER';
}

/** "France", "United States" … — the platform's own names via Intl, falling back to the code. */
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

export const QUALITY_BASIS_LABELS = {
  BLENDED: 'Blended (coding + intelligence)',
  CODING: 'Coding index',
  INTELLIGENCE: 'Intelligence index',
} as const;

export function capabilityLabel(key: string): string {
  return CAPABILITIES.find((c) => c.key === key)?.label ?? key;
}

/** Status enum values never reach the UI; these labels do. */
export const STATUS_LABELS: Record<ModelStatus, string> = {
  ACTIVE: 'Available',
  RETIRED: 'Retired',
};

export function statusLabel(status: ModelStatus): string {
  return STATUS_LABELS[status];
}

export const ROLE_LABELS: Record<Role, string> = {
  USER: 'Member',
  ADMIN: 'Administrator',
};

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (n >= 1_000) return `${trim(n / 1_000)}K`;
  return String(n);
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
}

export function formatList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
