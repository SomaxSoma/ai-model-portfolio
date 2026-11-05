import { Card } from '@pf/design-system';
import { RISK_LABELS, RISK_THRESHOLDS, type RiskReport } from '@pf/domain';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { seriesColor, usePrefersReducedMotion } from '../three';
import { useApi } from './useApi';

// ---------------------------------------------------------------------------
// Provider colours: assigned from the fixed categorical order by the provider's
// position in the alphabetical provider list, so a colour follows the entity
// (never its rank or the current filter).
// ---------------------------------------------------------------------------
export function useProviderColors(providerNames: string[]): (provider: string) => string {
  const key = [...new Set(providerNames)].sort().join('|');
  return useMemo(() => {
    const order = key ? key.split('|') : [];
    const cache = new Map(order.map((p, i) => [p, seriesColor(i)]));
    return (p: string) => cache.get(p) ?? seriesColor(7);
  }, [key]);
}

// ---------------------------------------------------------------------------
// CountUp: animates to its value; screen readers get the final value at once.
// ---------------------------------------------------------------------------
export function CountUp({ value, format = (n) => String(Math.round(n)), duration = 900 }: { value: number; format?: (n: number) => string; duration?: number }) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  const from = useRef(0);
  useEffect(() => {
    if (reduced) {
      setShown(value);
      return;
    }
    let start: number | null = null;
    const origin = from.current;
    let raf = 0;
    const tick = (t: number) => {
      // Anchor on the first frame's own timestamp: rAF times can precede performance.now().
      start ??= t;
      const k = Math.min(1, Math.max(0, (t - start) / duration));
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(origin + (value - origin) * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    // Background tabs may never run rAF: land on the true value regardless.
    const settle = setTimeout(() => {
      cancelAnimationFrame(raf);
      setShown(value);
      from.current = value;
    }, duration + 100);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
    };
  }, [value, duration, reduced]);
  return (
    <>
      <span aria-hidden="true">{format(shown)}</span>
      <span className="ds-visually-hidden">{format(value)}</span>
    </>
  );
}

export function Kpi({ label, value, meta, flag, index = 0 }: { label: ReactNode; value: ReactNode; meta?: ReactNode; flag?: ReactNode; index?: number }) {
  return (
    <Card padding="none" className="pf-kpi" style={{ ['--i' as string]: index }}>
      <span className="pf-kpi__label">{label}</span>
      <span className="pf-kpi__value">{value}</span>
      {flag && <span className="pf-kpi__flag">{flag}</span>}
      {meta && <span className="pf-kpi__meta">{meta}</span>}
    </Card>
  );
}

/** Pass/fail flag against a target, with icon + text (never colour alone). */
export function TargetFlag({ ok, children }: { ok: boolean | null; children: ReactNode }) {
  if (ok === null) return <span className="pf-subtle pf-small">{children}</span>;
  return (
    <span className={`pf-nowrap ${ok ? 'pf-positive' : 'pf-negative'}`}>
      <span aria-hidden="true">{ok ? '✓' : '✕'}</span> {children}
    </span>
  );
}

export function Meter({ value, max, label, mark }: { value: number; max: number; label: string; mark?: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const over = value > max;
  return (
    <div className="pf-meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <div className={`pf-meter__fill${over ? ' pf-meter__fill--over' : ''}`} style={{ width: `${pct}%` }} />
      {mark !== undefined && <div className="pf-meter__mark" style={{ left: `${Math.min(100, (mark / max) * 100)}%` }} />}
    </div>
  );
}

/** 100% stacked bar with 2px gaps and a legend; values are shown in the legend text. */
export function ShareBar({ parts, label }: { parts: { key: string; label: string; share: number; color: string }[]; label: string }) {
  const live = parts.filter((p) => p.share > 0);
  return (
    <div className="pf-stack pf-stack--sm">
      <div className="pf-sharebar" role="img" aria-label={`${label}: ${live.map((p) => `${p.label} ${p.share}%`).join(', ')}`}>
        {live.map((p) => (
          <div key={p.key} className="pf-sharebar__seg" style={{ flexBasis: `${p.share}%`, background: p.color }} title={`${p.label}: ${p.share}%`} />
        ))}
      </div>
      <ul className="pf-legend">
        {live.map((p) => (
          <li key={p.key}>
            <span className="pf-swatch" style={{ background: p.color }} aria-hidden="true" />
            {p.label} <span className="pf-num pf-strong">{p.share}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RiskLevel({ level }: { level: RiskReport['level'] }) {
  return <span className={`pf-level pf-level--${level}`}>{RISK_LABELS[level]} risk</span>;
}

/** Provider concentration (HHI) + lifecycle exposure, with plain-language findings. */
export function RiskPanel({ risk, colorFor }: { risk: RiskReport; colorFor: (provider: string) => string }) {
  const needle = Math.min(100, (risk.hhi / 10000) * 100);
  return (
    <Card padding="lg" className="pf-stack">
      <div className="pf-section-head">
        <h2 className="pf-card-title">Provider risk</h2>
        <RiskLevel level={risk.level} />
      </div>
      <div className="pf-stack pf-stack--sm">
        <div className="pf-row pf-row--between pf-small">
          <span className="pf-subtle">Concentration (HHI)</span>
          <span className="pf-num pf-strong">{risk.hhi.toLocaleString('en-US')} / 10,000</span>
        </div>
        <div className="pf-hhi" role="meter" aria-label="Provider concentration" aria-valuemin={0} aria-valuemax={10000} aria-valuenow={risk.hhi}>
          <div className="pf-hhi__needle" style={{ left: `${needle}%` }} />
        </div>
        <div className="pf-row pf-row--between pf-small pf-subtle">
          <span>Spread</span>
          <span>
            {RISK_THRESHOLDS.moderateHhi.toLocaleString('en-US')} moderate · {RISK_THRESHOLDS.highHhi.toLocaleString('en-US')} high
          </span>
          <span>One provider</span>
        </div>
      </div>
      {risk.providers.length > 0 && (
        <ShareBar label="Share of requests by provider" parts={risk.providers.map((p) => ({ key: p.provider, label: p.provider, share: p.trafficShare, color: colorFor(p.provider) }))} />
      )}
      <ul className="pf-findings">
        {risk.findings.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </Card>
  );
}

/** Provider colours keyed on the full provider list, so every screen agrees. */
export function useProviderPalette(): (provider: string) => string {
  const { data } = useApi<{ name: string }[]>('/providers');
  return useProviderColors((data ?? []).map((p) => p.name));
}
