import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { formatUsd } from '../format';
import { gradientSteps, usePrefersReducedMotion } from '../three';

/** A few live catalogue rows to show in the walkthrough (falls back to examples). */
export interface FlowModel {
  name: string;
  provider: string;
  inputPrice: string;
  /** The same benchmark score the catalogue shows (overallScore). */
  score: number;
}

const STEP_MS = 3600;

const STEPS = [
  { title: 'Live catalogue', copy: 'Prices, context and uptime sync on a schedule.', headline: 'Every model, kept current', body: 'Pricing, context windows, capabilities and uptime arrive from OpenRouter on a schedule; Artificial Analysis indices rate coding and intelligence. Big swings are flagged for review before you rely on them.' },
  { title: 'Describe the work', copy: 'Tokens, volume, budget, priorities.', headline: 'Describe the workload once', body: 'A typical request, how many you send a month, the capabilities you need and what matters most — quality, cost, latency or reliability.' },
  { title: 'Get a portfolio', copy: 'A mix that fits the budget.', headline: 'A mix, not a single bet', body: 'The engine ranks every eligible model and splits the workload across the best three, shifting share to cheaper models until the total fits your budget — and says why.' },
  { title: 'Save & monitor', copy: 'Alerts when prices move.', headline: 'Saved, then watched', body: 'Every cost is exact to four decimals. When a price changes, a model retires or a budget breaks, the portfolio’s owner gets an alert.' },
  { title: 'Stress-test', copy: 'Price rises, deprecations, outages.', headline: 'Rehearse the bad day', body: 'Simulate a price rise, a deprecation or a provider outage and compare doing nothing with a fresh recommendation, side by side.' },
] as const;

const EXAMPLE_MODELS: FlowModel[] = [
  { name: 'Frontier model', provider: 'Provider A', inputPrice: '5.0000', score: 78 },
  { name: 'Balanced model', provider: 'Provider B', inputPrice: '1.2500', score: 70 },
  { name: 'Fast model', provider: 'Provider C', inputPrice: '0.1500', score: 55 },
];

function Mock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="pf-mock" aria-hidden="true">
      <div className="pf-mock__bar">
        <i />
        <i />
        <i />
        {title}
      </div>
      <div className="pf-mock__body">{children}</div>
    </div>
  );
}

const vars = (o: Record<string, string | number>) => o as CSSProperties;

function Demo({ step, models, modelCount }: { step: number; models: FlowModel[]; modelCount: number }) {
  const ms = models.length >= 3 ? models.slice(0, 3) : EXAMPLE_MODELS;
  const steps3 = gradientSteps(3);
  if (step === 0)
    return (
      <Mock title="catalogue · live">
        {ms.map((m, i) => (
          <div key={m.name} className="pf-mock__row" style={vars({ '--i': i })}>
            <span>
              <b>{m.name}</b> · {m.provider}
            </span>
            <span className="pf-num">{formatUsd(m.inputPrice)}/1M</span>
            <span className="pf-num">{m.score}</span>
          </div>
        ))}
        <div className="pf-row" style={{ marginTop: 'var(--sp-2)' }}>
          <span className="pf-mock__chip pf-mock__chip--b">✓ {modelCount || 'all'} models synced</span>
          <span className="pf-mock__chip pf-mock__chip--a">⚠ big swings held for review</span>
        </div>
      </Mock>
    );
  if (step === 1)
    return (
      <Mock title="new workload">
        <span className="pf-typing pf-strong">Support assistant</span>
        <div className="pf-mock__bars" style={{ marginTop: 'var(--sp-3)' }}>
          {[
            ['Input tokens', '1,500', 0.42],
            ['Output tokens', '400', 0.22],
            ['Requests / mo', '50,000', 0.7],
            ['Budget', '$300', 0.55],
          ].map(([label, value, w], i) => (
            <div key={label as string} className="pf-mock__barrow">
              <span>{label}</span>
              <div className="pf-mock__track">
                <div className="pf-mock__fill" style={vars({ '--i': i, width: `${(w as number) * 100}%`, background: 'var(--gradient-scale)' })} />
              </div>
              <span className="pf-num">{value}</span>
            </div>
          ))}
        </div>
      </Mock>
    );
  if (step === 2)
    return (
      <Mock title="recommendation">
        <div className="pf-mock__bars">
          {ms.map((m, i) => {
            const pct = [46, 32, 22][i]!;
            return (
              <div key={m.name} className="pf-mock__barrow">
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                <div className="pf-mock__track">
                  <div className="pf-mock__fill" style={vars({ '--i': i, width: `${pct}%`, background: steps3[i]! })} />
                </div>
                <span className="pf-num">{pct}%</span>
              </div>
            );
          })}
        </div>
        <div className="pf-mock__total">
          <span className="pf-subtle pf-small">Estimated monthly cost</span>
          <strong className="pf-num">$214.60</strong>
        </div>
        <span className="pf-mock__chip pf-mock__chip--b">✓ within the $300 budget</span>
      </Mock>
    );
  if (step === 3)
    return (
      <Mock title="saved portfolio">
        <div className="pf-mock__barrow">
          <span>Spend / budget</span>
          <div className="pf-mock__track">
            <div className="pf-mock__fill" style={vars({ width: '72%', background: 'var(--gradient-scale)' })} />
          </div>
          <span className="pf-num">72%</span>
        </div>
        <div className="pf-mock__row" style={vars({ '--i': 2 })}>
          <span>
            <b>Price changed</b> · input +12%
          </span>
          <span className="pf-num">+$4.20/mo</span>
          <span className="pf-mock__chip pf-mock__chip--a">⚠ alert</span>
        </div>
        <div className="pf-mock__row" style={vars({ '--i': 3 })}>
          <span>
            <b>Retirement announced</b> · 30 days
          </span>
          <span />
          <span className="pf-mock__chip pf-mock__chip--a">✕ plan swap</span>
        </div>
      </Mock>
    );
  return (
    <Mock title="what-if · price +25%">
      <div className="pf-mock__bars">
        {[
          ['Today', 0.62, '$214.60', 'var(--surface-3)'],
          ['Keep mix', 0.78, '$268.25', 'var(--hue-a)'],
          ['Re-optimised', 0.66, '$228.90', 'var(--hue-b)'],
        ].map(([label, w, v, bg], i) => (
          <div key={label as string} className="pf-mock__barrow">
            <span>{label}</span>
            <div className="pf-mock__track">
              <div className="pf-mock__fill" style={vars({ '--i': i, width: `${(w as number) * 100}%`, background: bg as string })} />
            </div>
            <span className="pf-num">{v}</span>
          </div>
        ))}
      </div>
      <div className="pf-row">
        <span className="pf-mock__chip pf-mock__chip--a">✕ +$53.65 if you change nothing</span>
        <span className="pf-mock__chip pf-mock__chip--b">✓ −$39.35 re-optimised</span>
      </div>
    </Mock>
  );
}

/**
 * "How it works": a five-step walkthrough of the product that animates
 * through each step (pausing on hover and when the user picks a step).
 * Reduced motion: no auto-advance, no animated fills.
 */
export function WorkflowShowcase({ models = [], modelCount = 0 }: { models?: FlowModel[]; modelCount?: number }) {
  const reduced = usePrefersReducedMotion();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [userPicked, setUserPicked] = useState(false);

  useEffect(() => {
    if (reduced || paused || userPicked) return;
    const t = setTimeout(() => setActive((a) => (a + 1) % STEPS.length), STEP_MS);
    return () => clearTimeout(t);
  }, [active, reduced, paused, userPicked]);

  const step = STEPS[active]!;
  return (
    <section
      className="pf-flow"
      aria-labelledby="pf-flow-title"
      // While paused the progress line is static; resuming restarts it with the timer.
      data-paused={reduced || paused || userPicked ? 'true' : undefined}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="pf-flow__head">
        <div className="pf-stack pf-stack--sm">
          <span className="pf-eyebrow">How it works</span>
          <h2 id="pf-flow-title">From a live catalogue to a budget-proof portfolio</h2>
        </div>
        <span className="pf-index">
          {String(active + 1).padStart(2, '0')} / {String(STEPS.length).padStart(2, '0')}
        </span>
      </div>
      <div className="pf-flow__track" role="tablist" aria-label="Workflow steps" style={vars({ '--pf-flow-dur': `${STEP_MS}ms` })}>
        {STEPS.map((s, i) => (
          <button
            key={s.title}
            type="button"
            role="tab"
            aria-selected={i === active}
            aria-current={i === active ? 'step' : undefined}
            aria-controls="pf-flow-panel"
            className="pf-flow__step"
            onClick={() => {
              setActive(i);
              setUserPicked(true);
            }}
          >
            <span className="pf-flow__num">{String(i + 1).padStart(2, '0')}</span>
            <span className="pf-flow__title">{s.title}</span>
            <span className="pf-flow__copy">{s.copy}</span>
          </button>
        ))}
      </div>
      <div className="pf-flow__stage" id="pf-flow-panel" role="tabpanel" aria-live="polite">
        <div className="pf-flow__explain" key={`t${active}`}>
          <span className="pf-index">STEP {String(active + 1).padStart(2, '0')}</span>
          <h3>{step.headline}</h3>
          <p className="pf-subtle">{step.body}</p>
        </div>
        <div className="pf-flow__demo">
          <Demo key={`d${active}`} step={active} models={models} modelCount={modelCount} />
          <span className="pf-flow__beam" aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
