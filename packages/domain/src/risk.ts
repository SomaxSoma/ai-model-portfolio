import { formatList } from './labels.js';
import { Decimal, sumMoney, type DecimalLike } from './money.js';
import type { CatalogueModel } from './types.js';

/**
 * Provider risk analysis (proposal §4.1, "Provider risk analyzer").
 *
 * Concentration is measured with the Herfindahl–Hirschman Index over each
 * provider's share of the workload: HHI = Σ (share%)², from ~0 (spread thin)
 * to 10,000 (one provider).
 *
 * Bands are calibrated for a portfolio of a handful of models, not for market
 * antitrust (whose 1,500/2,500 bands flag any three-way split as "high"):
 *  - below 3,500: low — about three or more providers sharing evenly
 *  - 3,500–5,499: moderate — effectively two providers (an even pair is 5,000)
 *  - 5,500 and up: high — one provider carries roughly 70% or more
 */
export const RISK_THRESHOLDS = {
  moderateHhi: 3500,
  highHhi: 5500,
  /** A model whose deprecation date is this close counts as lifecycle risk. */
  deprecationWarningDays: 90,
} as const;

export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH';

export const RISK_LABELS: Record<RiskLevel, string> = { LOW: 'Low', MODERATE: 'Moderate', HIGH: 'High' };

export interface RiskLine {
  model: Pick<CatalogueModel, 'id' | 'name' | 'providerName' | 'status' | 'deprecationDate'>;
  allocationPercentage: number;
  estimatedCost: DecimalLike;
}

export interface ProviderExposure {
  provider: string;
  /** Share of requests, 0–100. */
  trafficShare: number;
  /** Share of monthly spend, 0–100 (one decimal). */
  costShare: number;
  models: string[];
}

export interface LifecycleExposure {
  modelId: number;
  name: string;
  share: number;
  retired: boolean;
  deprecationDate: string | null;
  /** Days until deprecation; negative when already past. null when no date. */
  daysLeft: number | null;
}

export interface RiskReport {
  providers: ProviderExposure[];
  hhi: number;
  concentration: RiskLevel;
  lifecycle: LifecycleExposure[];
  /** Overall level: the worse of concentration and lifecycle risk. */
  level: RiskLevel;
  /** Plain-language findings, most important first. */
  findings: string[];
}

const RANK: Record<RiskLevel, number> = { LOW: 0, MODERATE: 1, HIGH: 2 };
const worse = (a: RiskLevel, b: RiskLevel): RiskLevel => (RANK[a] >= RANK[b] ? a : b);

/** Whole days from `today` (UTC date) to an ISO YYYY-MM-DD date. */
export function daysUntil(isoDate: string, today: Date = new Date()): number {
  const target = Date.UTC(Number(isoDate.slice(0, 4)), Number(isoDate.slice(5, 7)) - 1, Number(isoDate.slice(8, 10)));
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((target - now) / 86_400_000);
}

export function concentrationLevel(hhi: number): RiskLevel {
  if (hhi >= RISK_THRESHOLDS.highHhi) return 'HIGH';
  if (hhi >= RISK_THRESHOLDS.moderateHhi) return 'MODERATE';
  return 'LOW';
}

export function analyzeRisk(lines: RiskLine[], today: Date = new Date()): RiskReport {
  const live = lines.filter((l) => l.allocationPercentage > 0);
  const totalPct = live.reduce((a, l) => a + l.allocationPercentage, 0);
  const totalCost = sumMoney(live.map((l) => l.estimatedCost));

  const byProvider = new Map<string, { pct: number; cost: Decimal; models: string[] }>();
  for (const l of live) {
    const p = byProvider.get(l.model.providerName) ?? { pct: 0, cost: new Decimal(0), models: [] };
    p.pct += l.allocationPercentage;
    p.cost = p.cost.plus(l.estimatedCost);
    p.models.push(l.model.name);
    byProvider.set(l.model.providerName, p);
  }

  const providers: ProviderExposure[] = [...byProvider.entries()]
    .map(([provider, p]) => ({
      provider,
      trafficShare: totalPct > 0 ? Math.round((p.pct / totalPct) * 1000) / 10 : 0,
      costShare: totalCost.gt(0) ? p.cost.div(totalCost).mul(100).toDecimalPlaces(1).toNumber() : 0,
      models: p.models,
    }))
    .sort((a, b) => b.trafficShare - a.trafficShare || a.provider.localeCompare(b.provider));

  const hhi = totalPct > 0 ? Math.round([...byProvider.values()].reduce((a, p) => a + ((p.pct / totalPct) * 100) ** 2, 0)) : 0;
  const concentration: RiskLevel = live.length === 0 ? 'LOW' : concentrationLevel(hhi);

  const lifecycle: LifecycleExposure[] = live
    .map((l) => {
      const daysLeft = l.model.deprecationDate ? daysUntil(l.model.deprecationDate, today) : null;
      return {
        modelId: l.model.id,
        name: l.model.name,
        share: l.allocationPercentage,
        retired: l.model.status === 'RETIRED' || (daysLeft !== null && daysLeft <= 0),
        deprecationDate: l.model.deprecationDate ?? null,
        daysLeft,
      };
    })
    .filter((x) => x.retired || (x.daysLeft !== null && x.daysLeft <= RISK_THRESHOLDS.deprecationWarningDays));

  const lifecycleLevel: RiskLevel = lifecycle.some((x) => x.retired) ? 'HIGH' : lifecycle.length ? 'MODERATE' : 'LOW';
  const level = worse(concentration, lifecycleLevel);

  const findings: string[] = [];
  for (const x of lifecycle.filter((x) => x.retired)) {
    findings.push(`${x.name} is no longer available but still carries ${x.share}% of the workload. Move that share to another model.`);
  }
  if (providers.length === 1 && live.length > 0) {
    findings.push(`Everything runs on ${providers[0]!.provider}. An outage or price change there affects the whole workload.`);
  } else if (concentration !== 'LOW' && providers[0]) {
    findings.push(`${providers[0].provider} handles ${providers[0].trafficShare}% of requests. Spreading more across providers would lower the dependency.`);
  }
  for (const x of lifecycle.filter((x) => !x.retired)) {
    findings.push(`${x.name} is scheduled to be retired in ${x.daysLeft} ${x.daysLeft === 1 ? 'day' : 'days'} (${x.deprecationDate}). Plan a replacement for its ${x.share}% share.`);
  }
  if (findings.length === 0 && live.length > 0) {
    findings.push(
      providers.length > 1
        ? `The workload is spread across ${formatList(providers.map((p) => p.provider))}, and no model is due to be retired soon.`
        : 'No lifecycle or concentration concerns.',
    );
  }

  return { providers, hhi, concentration, lifecycle, level, findings };
}
