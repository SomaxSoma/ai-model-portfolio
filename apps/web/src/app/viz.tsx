import { Card } from '@pf/design-system';
import { RISK_LABELS, RISK_THRESHOLDS, type RiskReport } from '@pf/domain';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { gradientAt, gradientSteps, usePrefersReducedMotion } from '../three';

/**
 * Two-colour rule: there is no categorical palette. Parts of a whole are
 * steps along the violet → cyan gradient and are always named in text;
 * magnitudes (e.g. quality) map to a position on the same gradient.
 */
export { gradientAt, gradientSteps };

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

/** 100% stacked bar: segments are gradient steps (2px gaps), each named with its share in the legend. */
export function ShareBar({ parts, label }: { parts: { key: string; label: string; share: number; color?: string }[]; label: string }) {
  const live = parts.filter((p) => p.share > 0);
  const steps = gradientSteps(live.length);
  const colorOf = (i: number) => live[i]!.color ?? steps[i]!;
  return (
    <div className="pf-stack pf-stack--sm">
      {/* Visible caption: what the shares are of (requests vs spend) changes how to read them. */}
      <span className="pf-small pf-subtle" aria-hidden="true">
        {label}
      </span>
      <div className="pf-sharebar" role="img" aria-label={`${label}: ${live.map((p) => `${p.label} ${p.share}%`).join(', ')}`}>
        {live.map((p, i) => (
          <div key={p.key} className="pf-sharebar__seg" style={{ flexBasis: `${p.share}%`, background: colorOf(i) }} title={`${p.label}: ${p.share}%`} />
        ))}
      </div>
      <ul className="pf-legend">
        {live.map((p, i) => (
          <li key={p.key}>
            <span className="pf-swatch" style={{ background: colorOf(i) }} aria-hidden="true" />
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
export function RiskPanel({ risk }: { risk: RiskReport }) {
  const needle = Math.min(100, (risk.hhi / 10000) * 100);
  return (
    <Card padding="lg" className="pf-stack">
      <div className="pf-section-head">
        <h2 className="pf-card-title">Provider risk</h2>
        <RiskLevel level={risk.level} />
      </div>
      <div className="pf-stack pf-stack--sm">
        <div className="pf-row pf-row--between pf-small">
          <span className="pf-subtle">
            Provider dependency <span className="pf-small">(HHI concentration score)</span>
          </span>
          <span className="pf-num pf-strong">{risk.hhi.toLocaleString('en-US')} / 10,000</span>
        </div>
        <div className="pf-hhi" role="meter" aria-label="Provider dependency" aria-valuemin={0} aria-valuemax={10000} aria-valuenow={risk.hhi}>
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
        <ShareBar label="Share of requests, by provider" parts={risk.providers.map((p) => ({ key: p.provider, label: p.provider, share: p.trafficShare}))} />
      )}
      <ul className="pf-findings">
        {risk.findings.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </Card>
  );
}


/**
 * Allocation ring: one arc per model (arc length = share), gradient steps
 * along violet → cyan, 2px gaps, and the share list in text beside it.
 */
export function RingChart({ parts, centre, caption }: { parts: { key: string | number; label: string; share: number; color: string }[]; centre: string; caption: string }) {
  const r = 46;
  const circumference = 2 * Math.PI * r;
  const gap = parts.length > 1 ? 2 : 0;
  const total = parts.reduce((a, p) => a + p.share, 0) || 1;
  let offset = 0;
  return (
    <svg className="pf-ring" viewBox="0 0 120 120" role="img" aria-label={`${caption}: ${parts.map((p) => `${p.label} ${p.share}%`).join(', ')}`}>
      <circle cx="60" cy="60" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="10" />
      {parts.map((p) => {
        const len = Math.max(0, (p.share / total) * circumference - gap);
        const seg = (
          <circle
            key={p.key}
            className="pf-ring__seg"
            cx="60"
            cy="60"
            r={r}
            fill="none"
            stroke={p.color}
            strokeWidth="10"
            strokeLinecap="butt"
            strokeDasharray={`${len} ${circumference - len}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 60 60)"
          />
        );
        offset += (p.share / total) * circumference;
        return seg;
      })}
      <text x="60" y="60" textAnchor="middle" className="pf-ring__total">
        {centre}
      </text>
      <text x="60" y="76" textAnchor="middle" className="pf-ring__label">
        {caption.toUpperCase()}
      </text>
    </svg>
  );
}
