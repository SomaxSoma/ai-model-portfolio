import { CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import { token } from '../three';

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
  const c1 = token('--series-1');
  const c2 = token('--series-2');
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
  color: string;
  eligible: boolean;
}

/** 2D cost vs quality: the accessible twin of the 3D galaxy. Direct labels on every model (n is small). */
export function CostQualityScatter({ points, height = 340, onSelect }: { points: ScatterPoint[]; height?: number; onSelect?: (id: number) => void }) {
  const grid = token('--line', '#222');
  const providers = [...new Map(points.map((p) => [p.provider, p.color])).entries()];
  return (
    <figure className="pf-stack pf-stack--sm" style={{ margin: 0 }}>
      <ul className="pf-legend" aria-label="Providers">
        {providers.map(([name, color]) => (
          <li key={name}>
            <span className="pf-swatch" style={{ background: color }} aria-hidden="true" />
            {name}
          </li>
        ))}
      </ul>
      <div style={{ height }} role="img" aria-label="Monthly cost against overall benchmark score for each available model. The table below lists the same values.">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 16, right: 24, bottom: 16, left: 4 }}>
            <CartesianGrid stroke={grid} />
            <XAxis type="number" dataKey="cost" scale="log" domain={['auto', 'auto']} name="Monthly cost" {...axisProps()} tickFormatter={(v: number) => `$${v >= 100 ? Math.round(v) : v.toFixed(v < 1 ? 2 : 0)}`} label={{ value: 'Monthly cost (log scale)', position: 'insideBottom', offset: -10, fill: token('--text-muted'), fontSize: 11 }} />
            <YAxis type="number" dataKey="overall" name="Overall score" domain={['dataMin - 4', 'dataMax + 4']} {...axisProps()} width={44} />
            <ZAxis range={[90, 90]} />
            <Tooltip
              cursor={{ strokeDasharray: '3 3', stroke: token('--text-muted') }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as ScatterPoint | undefined;
                return active && p ? (
                  <TooltipBox
                    title={p.name}
                    rows={[
                      { label: p.provider, value: '', color: p.color },
                      { label: 'Monthly cost', value: `$${p.cost.toFixed(2)}` },
                      { label: 'Overall score', value: String(p.overall) },
                    ]}
                  />
                ) : null;
              }}
            />
            <Scatter
              data={points}
              shape={(props: { cx?: number; cy?: number; payload?: ScatterPoint }) => {
                const p = props.payload!;
                return (
                  <g style={{ cursor: onSelect ? 'pointer' : 'default' }} onClick={() => onSelect?.(p.id)}>
                    <circle cx={props.cx} cy={props.cy} r={11} fill={p.color} opacity={0.18} />
                    <circle cx={props.cx} cy={props.cy} r={5.5} fill={p.color} stroke={token('--surface-2')} strokeWidth={2} opacity={p.eligible ? 1 : 0.4} />
                    {/* direct label: text ink, never the series colour */}
                    <text x={props.cx} y={(props.cy ?? 0) - 14} textAnchor="middle" fill={token('--text-secondary')} fontSize={11}>
                      {p.name}
                    </text>
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
