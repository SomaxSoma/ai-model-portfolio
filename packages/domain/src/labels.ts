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
