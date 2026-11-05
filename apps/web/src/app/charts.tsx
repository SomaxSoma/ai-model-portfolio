import { CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import { gradientAt, token } from '../three';

/**
 * Chart conventions (dataviz method): one y-axis only, recessive grid and
 * axes, 2px lines, ≥ 8px markers, a legend for ≥ 2 series plus direct labels,
 * crosshair/hover tooltips, text in text tokens (never the series colour).
 */
function axisProps() {
  const muted = token('--text-muted', '#8a94aa');
  return { stroke: token('--line-strong', '#333'), tick: { fill: muted, fontSize: 11, fontFamily: token('--font-mono', 'monospace') }, tickLine: false };
}

function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="pf-chart-tooltip">
      <strong>{title}</strong>
      {rows.map((r) => (
        <div key={r.label} className="pf-chart-tooltip__row">
          {r.color && <span className="pf-swatch" style={{ background: r.color }} aria-hidden="true" />}
          <span>{r.label}</span>
          <span className="pf-num pf-strong" style={{ marginLeft: 'auto' }}>
            {r.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export interface PriceSeriesPoint {
  label: string;
  input: number;
  output: number;
}

/** Input vs output price over time (both $ per 1M tokens → one shared axis). */
export function PriceChart({ data, height = 280, title }: { data: PriceSeriesPoint[]; height?: number; title: string }) {
  const c1 = token('--hue-a');
  const c2 = token('--hue-b');
  const grid = token('--line', '#222');
  const fmt = (v: number) => `$${v.toFixed(v < 1 ? 2 : 2)}`;
  const last = data.length - 1;
  return (
    <figure className="pf-stack pf-stack--sm" style={{ margin: 0 }}>
      <ul className="pf-legend" aria-label="Legend">
        <li>
          <span className="pf-swatch" style={{ background: c1 }} aria-hidden="true" />
          Input price
        </li>
        <li>
          <span className="pf-swatch" style={{ background: c2 }} aria-hidden="true" />
          Output price
        </li>
      </ul>
      <div style={{ height }} role="img" aria-label={`${title}. Latest input ${fmt(data[last]?.input ?? 0)}, output ${fmt(data[last]?.output ?? 0)} per 1M tokens.`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 16, right: 56, bottom: 4, left: 4 }}>
            <CartesianGrid stroke={grid} vertical={false} />
            <XAxis dataKey="label" {...axisProps()} minTickGap={24} />
            <YAxis {...axisProps()} width={56} tickFormatter={(v: number) => `$${v}`} />
            <Tooltip
              cursor={{ stroke: token('--text-muted'), strokeDasharray: '3 3' }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TooltipBox
                    title={String(label)}
                    rows={[
                      { label: 'Input', value: fmt(Number(payload[0]?.payload.input)), color: c1 },
                      { label: 'Output', value: fmt(Number(payload[0]?.payload.output)), color: c2 },
                    ]}
                  />
                ) : null
              }
            />
            <Line type="stepAfter" dataKey="input" stroke={c1} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: token('--surface-2'), fill: c1 }} activeDot={{ r: 6 }} isAnimationActive>
              <LabelList dataKey="input" content={(p) => (p.index === last ? <text x={Number(p.x) + 8} y={Number(p.y) + 4} fill={token('--text-secondary')} fontSize={11}>Input</text> : null)} />
            </Line>
            <Line type="stepAfter" dataKey="output" stroke={c2} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: token('--surface-2'), fill: c2 }} activeDot={{ r: 6 }} isAnimationActive>
              <LabelList dataKey="output" content={(p) => (p.index === last ? <text x={Number(p.x) + 8} y={Number(p.y) + 4} fill={token('--text-secondary')} fontSize={11}>Output</text> : null)} />
            </Line>
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

export interface ScatterPoint {
  id: number;
  name: string;
  provider: string;
  cost: number;
  overall: number;
  eligible: boolean;
}

/**
 * Models no other model beats on both price and quality — the efficient
 * frontier. Only these get direct labels (a live catalogue has ~100 models).
 */
export function efficientFrontier<T extends { cost: number; overall: number }>(points: T[]): Set<T> {
  const sorted = [...points].sort((a, b) => a.cost - b.cost || b.overall - a.overall);
  const out = new Set<T>();
  let best = -Infinity;
  for (const p of sorted) {
    if (p.overall > best) {
      out.add(p);
      best = p.overall;
    }
  }
  return out;
}

/** Quality as a position on the brand gradient: violet = lower, cyan = higher. */
export function qualityColor(overall: number, min: number, max: number): string {
  return gradientAt(max === min ? 1 : (overall - min) / (max - min));
}

export function GradientLegend({ low, high }: { low: string; high: string }) {
  return (
    <div className="pf-scale-legend" aria-hidden="true">
      <span>{low}</span>
      <span className="pf-scale-legend__bar" />
      <span>{high}</span>
    </div>
  );
}

/** 2D cost vs quality for every available model. Colour = quality on the brand gradient; labels on the efficient frontier. */
export function CostQualityScatter({ points: raw, height = 340, onSelect }: { points: ScatterPoint[]; height?: number; onSelect?: (id: number) => void }) {
  const grid = token('--line', '#222');
  const min = Math.min(...raw.map((p) => p.overall));
  const max = Math.max(...raw.map((p) => p.overall));
  const frontier = efficientFrontier(raw);
  const points = raw.map((p) => ({ ...p, color: qualityColor(p.overall, min, max), labelled: frontier.has(p) }));
  // Log axis: one tick per power of ten across the data (1-2-5 steps when the range is narrow).
  const costs = raw.map((p) => p.cost).filter((c) => c > 0);
  const lo = Math.min(...costs);
  const hi = Math.max(...costs);
  const decades = Math.ceil(Math.log10(hi)) - Math.floor(Math.log10(lo));
  const mult = decades <= 2 ? [1, 2, 5] : [1];
  const ticks: number[] = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) for (const m of mult) ticks.push(m * 10 ** e);
  const xTicks = ticks.filter((t) => t >= lo / 1.01 && t <= hi * 1.01);
  const money = (v: number) => (v >= 1 ? `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : `$${Number(v.toPrecision(1))}`);
  return (
    <figure className="pf-stack pf-stack--sm" style={{ margin: 0 }}>
      <div className="pf-row pf-row--between">
        <GradientLegend low={`quality ${min}`} high={`${max}`} />
        <span className="pf-subtle pf-small">Labelled: best quality for the money</span>
      </div>
      <div style={{ height }} role="img" aria-label="Monthly cost against overall benchmark score for each available model. The table below lists the same values.">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 16, right: 24, bottom: 16, left: 4 }}>
            <CartesianGrid stroke={grid} />
            <XAxis type="number" dataKey="cost" scale="log" domain={[lo / 1.15, hi * 1.15]} ticks={xTicks} name="Monthly cost" {...axisProps()} tickFormatter={money} label={{ value: 'Monthly cost (log scale)', position: 'insideBottom', offset: -10, fill: token('--text-muted'), fontSize: 11 }} />
            <YAxis type="number" dataKey="overall" name="Quality" domain={[Math.max(0, Math.floor(min / 10) * 10), Math.min(100, Math.ceil(max / 10) * 10)]} {...axisProps()} width={44} />
            <ZAxis range={[90, 90]} />
            <Tooltip
              cursor={{ strokeDasharray: '3 3', stroke: token('--text-muted') }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as (ScatterPoint & { color: string }) | undefined;
                return active && p ? (
                  <TooltipBox
                    title={p.name}
                    rows={[
                      { label: p.provider, value: '' },
                      { label: 'Monthly cost', value: `$${p.cost.toFixed(2)}` },
                      { label: 'Overall score', value: String(p.overall) },
                    ]}
                  />
                ) : null;
              }}
            />
            <Scatter
              data={points}
              shape={(props: { cx?: number; cy?: number; payload?: ScatterPoint & { color: string; labelled: boolean } }) => {
                const p = props.payload!;
                return (
                  <g style={{ cursor: onSelect ? 'pointer' : 'default' }} onClick={() => onSelect?.(p.id)}>
                    <circle cx={props.cx} cy={props.cy} r={p.labelled ? 11 : 8} fill={p.color} opacity={0.16} />
                    <circle cx={props.cx} cy={props.cy} r={p.labelled ? 5.5 : 4} fill={p.color} stroke={token('--surface-2')} strokeWidth={2} opacity={p.eligible ? 1 : 0.35} />
                    {/* direct label (frontier only): text ink, never the series colour */}
                    {p.labelled && (
                      <text x={props.cx} y={(props.cy ?? 0) - 14} textAnchor="middle" fill={token('--text-secondary')} fontSize={11}>
                        {p.name}
                      </text>
                    )}
                  </g>
                );
              }}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
