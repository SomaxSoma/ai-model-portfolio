import { Decimal } from '@pf/domain';

/**
 * Live catalogue adapter for the OpenRouter public models API (no key needed).
 *
 *   GET {base}/models                     prices, context, modalities, parameters,
 *                                          expiration dates, Artificial Analysis indices
 *   GET {base}/models/{id}/endpoints      per-route uptime (best route's 24 h uptime)
 *
 * Output records use the same feed format as FILE/HTTP sources, so they go
 * through the same validation, quality checks and history writes.
 *
 * What is real and what is not available:
 *   - prices: OpenRouter list price per token, converted to USD per 1M tokens
 *     (base tier; long-context surcharges are not modelled)
 *   - codingScore: Artificial Analysis Coding Index (0–100), rounded
 *   - reasoningScore: Artificial Analysis Intelligence Index, rounded, or null
 *     when AA publishes none for the model
 *   - reliability: highest 24 h uptime among the model's routes
 *   - latency: not published without an account → left as "not available"
 */

export const OPENROUTER_ID_PREFIX = 'openrouter:';
const MODELS_TIMEOUT_MS = 20_000;
const ENDPOINT_TIMEOUT_MS = 10_000;
const ENDPOINT_CONCURRENCY = 6;
const MAX_BYTES = 15 * 1024 * 1024;

interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number | null;
  top_provider?: { context_length?: number | null } | null;
  architecture?: { input_modalities?: string[] } | null;
  pricing?: { prompt?: string; completion?: string } | null;
  supported_parameters?: string[] | null;
  expiration_date?: string | null;
  benchmarks?: { artificial_analysis?: { coding_index?: number | null; intelligence_index?: number | null } | null } | null;
}

export interface OpenRouterRecord {
  externalId: string;
  provider: string;
  name: string;
  version: string;
  contextWindow: number;
  inputPrice: string;
  outputPrice: string;
  codingScore: number;
  reasoningScore: number | null;
  capabilities: string[];
  deprecationDate: string | null;
  reliability?: number | null;
  status: 'ACTIVE';
}

async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json', 'user-agent': 'model-portfolio-intelligence/1.0 (catalogue sync)' } });
  if (!res.ok) throw new Error(`The source answered ${res.status}.`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error('The feed is larger than 15 MB.');
  return JSON.parse(text);
}

/** Per-token price string → USD per 1M tokens, 4 dp. Null if missing/negative (variable-price routers). */
export function perMillion(perToken: string | undefined): string | null {
  if (perToken === undefined || perToken === null || perToken === '') return null;
  try {
    const d = new Decimal(perToken);
    if (d.isNeg()) return null;
    return d.mul(1_000_000).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
  } catch {
    return null;
  }
}

export function capabilitiesOf(m: OpenRouterModel): string[] {
  const input = new Set(m.architecture?.input_modalities ?? []);
  const params = new Set(m.supported_parameters ?? []);
  const caps: string[] = [];
  if (input.has('image')) caps.push('vision');
  if (input.has('audio')) caps.push('audio');
  if (params.has('tools')) caps.push('tool_use');
  if (params.has('structured_outputs') || params.has('response_format')) caps.push('structured_output');
  if (params.has('reasoning') || params.has('include_reasoning')) caps.push('reasoning');
  return caps;
}

/** "Anthropic: Claude Haiku 5.5" → { provider: "Anthropic", name: "Claude Haiku 5.5" } */
export function splitName(m: Pick<OpenRouterModel, 'id' | 'name'>): { provider: string; name: string } {
  const i = m.name.indexOf(': ');
  if (i > 0) return { provider: m.name.slice(0, i).trim(), name: m.name.slice(i + 2).trim() };
  const slug = m.id.split('/')[0] ?? 'Unknown';
  return { provider: slug.replace(/(^|-)([a-z])/g, (_, s: string, c: string) => (s ? ' ' : '') + c.toUpperCase()), name: m.name.trim() };
}

/**
 * Which listings become catalogue models: one entry per real model with a
 * published Artificial Analysis coding index and a fixed positive price.
 * Excluded: tier/variant suffixes (":free", ":batch", …), "~" aliases,
 * OpenRouter's own routers, and variable or zero pricing.
 */
export function selectModels(all: OpenRouterModel[]): { kept: OpenRouterModel[]; skipped: number } {
  const kept = all.filter((m) => {
    if (!m.id || m.id.includes(':') || m.id.startsWith('~') || m.id.startsWith('openrouter/')) return false;
    const input = perMillion(m.pricing?.prompt);
    const output = perMillion(m.pricing?.completion);
    if (input === null || output === null || (Number(input) === 0 && Number(output) === 0)) return false;
    return typeof m.benchmarks?.artificial_analysis?.coding_index === 'number';
  });
  return { kept, skipped: all.length - kept.length };
}

export function toRecord(m: OpenRouterModel): OpenRouterRecord {
  const { provider, name } = splitName(m);
  const aa = m.benchmarks!.artificial_analysis!;
  const clamp = (v: number) => Math.min(100, Math.max(0, Math.round(v)));
  return {
    externalId: OPENROUTER_ID_PREFIX + m.id,
    provider,
    name,
    version: '',
    contextWindow: m.context_length ?? m.top_provider?.context_length ?? 0,
    inputPrice: perMillion(m.pricing?.prompt)!,
    outputPrice: perMillion(m.pricing?.completion)!,
    codingScore: clamp(aa.coding_index!),
    reasoningScore: typeof aa.intelligence_index === 'number' ? clamp(aa.intelligence_index) : null,
    capabilities: capabilitiesOf(m),
    deprecationDate: m.expiration_date ? m.expiration_date.slice(0, 10) : null,
    status: 'ACTIVE',
  };
}

async function bestUptime(base: string, id: string): Promise<number | null | undefined> {
  try {
    const body = (await getJson(`${base}/models/${id}/endpoints`, ENDPOINT_TIMEOUT_MS)) as { data?: { endpoints?: { uptime_last_1d?: number | null }[] } };
    const ups = (body.data?.endpoints ?? []).map((e) => e.uptime_last_1d).filter((v): v is number => typeof v === 'number');
    return ups.length ? Math.round(Math.max(...ups) * 100) / 100 : null;
  } catch {
    // Leave the stored figure untouched rather than erase it on a transient error.
    return undefined;
  }
}

/** Fetch and convert the live catalogue. Throws only if the models list itself can't be read. */
export async function loadOpenRouterFeed(baseUrl: string): Promise<{ source: string; generatedAt: string; models: OpenRouterRecord[]; skipped: number }> {
  const base = baseUrl.replace(/\/$/, '');
  const body = (await getJson(`${base}/models`, MODELS_TIMEOUT_MS)) as { data?: OpenRouterModel[] };
  if (!Array.isArray(body.data)) throw new Error('The OpenRouter response had no "data" list.');
  const { kept, skipped } = selectModels(body.data);
  const records = kept.map(toRecord);

  // Uptime per model, a few requests at a time.
  let next = 0;
  await Promise.all(
    Array.from({ length: ENDPOINT_CONCURRENCY }, async () => {
      while (next < kept.length) {
        const i = next++;
        const r = await bestUptime(base, kept[i]!.id);
        if (r !== undefined) records[i]!.reliability = r;
      }
    }),
  );
  return { source: 'OpenRouter public models API', generatedAt: new Date().toISOString(), models: records, skipped };
}
