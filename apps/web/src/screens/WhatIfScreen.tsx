import { Alert, Button, Card, SegmentedNav, Select, TextLink } from '@pf/design-system';
import { Decimal, formatDelta, formatUsd, SCENARIO_LABELS, type FieldErrors, type Scenario } from '@pf/domain';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { api, ApiError } from '../api';
import { LoadError, Loading, PageHead, PfInput } from '../app/controls';
import { useApi } from '../app/useApi';
import { RiskLevel, ShareBar } from '../app/viz';
import type { Model, Portfolio, SimOutcome, Simulation } from '../types';

type Kind = Scenario['kind'];

function Outcome({ title, subtitle, o, baseline, budget, focus, note }: { title: string; subtitle: string; o: SimOutcome; baseline?: SimOutcome; budget: string; focus?: boolean; note?: string }) {
  const delta = baseline ? formatDelta(new Decimal(baseline.estimatedCost), new Decimal(o.estimatedCost)) : null;
  const up = baseline ? new Decimal(o.estimatedCost).gt(baseline.estimatedCost) : false;
  return (
    <Card padding="lg" className={`pf-whatif-col${focus ? ' pf-whatif-col--focus' : ''}`}>
      <div>
        <span className="pf-eyebrow">{subtitle}</span>
        <h2 className="pf-card-title" style={{ marginTop: 'var(--sp-2)' }}>
          {title}
        </h2>
      </div>
      <div className="pf-stack pf-stack--none">
        <span className="pf-kpi__value">{formatUsd(o.estimatedCost)}</span>
        <span className="pf-subtle pf-small">
          a month · budget {formatUsd(budget)}
          {delta && (
            <>
              {' · '}
              <span className={`pf-delta ${up ? 'pf-negative' : delta === '$0.00' ? '' : 'pf-positive'}`}>{delta}</span>
            </>
          )}
        </span>
      </div>
      <div className="pf-row">
        <span className={o.withinBudget ? 'pf-positive pf-small' : 'pf-negative pf-small'}>
          <span aria-hidden="true">{o.withinBudget ? '✓' : '✕'}</span> {o.withinBudget ? 'Within budget' : o.lines.length ? 'Over budget' : 'No allocation'}
        </span>
        <RiskLevel level={o.risk.level} />
        <span className="pf-subtle pf-small">Score {o.lines.length ? o.score.toFixed(1) : '–'}</span>
      </div>
      {o.lines.length > 0 ? (
        <ShareBar label={`${title}: allocation`} parts={o.lines.map((l) => ({ key: String(l.modelId), label: l.model.name, share: l.allocationPercentage }))} />
      ) : (
        <p className="pf-negative pf-small">Nothing can serve the workload.</p>
      )}
      {note && <p className="pf-subtle pf-small">{note}</p>}
    </Card>
  );
}

export function WhatIfScreen() {
  const { id } = useParams();
  const portfolio = useApi<Portfolio>(`/portfolios/${id}`);
  const catalogue = useApi<Model[]>('/models');

  const [kind, setKind] = useState<Kind>('PRICE_CHANGE');
  const [targetType, setTargetType] = useState<'model' | 'provider'>('model');
  const [target, setTarget] = useState('');
  const [percent, setPercent] = useState('25');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [result, setResult] = useState<Simulation | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const p = portfolio.data;
  const models = useMemo(() => catalogue.data ?? [], [catalogue.data]);
  const providers = useMemo(() => [...new Set(models.map((m) => m.providerName))].sort(), [models]);
  // Default targets: the portfolio's own models first, since they matter most.
  const ordered = useMemo(() => {
    const mine = new Set(p?.allocations.map((a) => a.modelId));
    return [...models].filter((m) => m.status === 'ACTIVE').sort((a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id)) || a.name.localeCompare(b.name));
  }, [models, p]);

  if (portfolio.error) return <LoadError error={portfolio.error} onRetry={portfolio.reload} />;
  if (!p || !catalogue.data) return <Loading what="Loading simulator" />;

  const needsModel = kind === 'MODEL_DEPRECATION' || (kind === 'PRICE_CHANGE' && targetType === 'model');
  const options = needsModel
    ? ordered.map((m) => ({ value: String(m.id), label: `${m.name} · ${m.providerName}${p.allocations.some((a) => a.modelId === m.id) ? ' (in portfolio)' : ''}` }))
    : providers.map((name) => ({ value: name, label: name }));
  const chosen = target || options[0]?.value || '';

  const run = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setMessage('');
    const scenario =
      kind === 'PRICE_CHANGE'
        ? { kind, percent: Number(percent), ...(targetType === 'model' ? { modelId: Number(chosen) } : { providerName: chosen }) }
        : kind === 'MODEL_DEPRECATION'
          ? { kind, modelId: Number(chosen) }
          : { kind, providerName: chosen };
    try {
      setResult(await api<Simulation>(`/portfolios/${p.id}/simulate`, { method: 'POST', body: { scenario } }));
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.errors).length) setErrors(err.errors);
      else setMessage(err instanceof ApiError ? err.message : 'The simulation couldn’t run.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pf-stack pf-stack--lg">
      <PageHead
        overline={<span className="pf-eyebrow">What-if simulator</span>}
        title={p.name}
        subtitle="Stress-test this portfolio before reality does. Nothing here changes the saved portfolio."
        actions={
          <TextLink as={Link} to={`/portfolios/${p.id}`} arrow={false} variant="muted">
            ← Back to portfolio
          </TextLink>
        }
      />

      <Card padding="lg">
        <form className="pf-stack" onSubmit={run} noValidate>
          <SegmentedNav
            label="Scenario"
            active={kind}
            onChange={(k) => {
              setKind(k as Kind);
              setTarget('');
              setResult(null);
            }}
            items={(Object.keys(SCENARIO_LABELS) as Kind[]).map((k) => ({ key: k, label: SCENARIO_LABELS[k] }))}
          />
          <div className="pf-form-grid">
            {kind === 'PRICE_CHANGE' && (
              <Select
                label="Apply to"
                value={targetType}
                onChange={(v) => {
                  setTargetType(v as 'model' | 'provider');
                  setTarget('');
                }}
                options={[
                  { value: 'model', label: 'One model' },
                  { value: 'provider', label: 'Every model from a provider' },
                ]}
              />
            )}
            <Select label={needsModel ? 'Model' : 'Provider'} value={chosen} onChange={setTarget} options={options} />
            {kind === 'PRICE_CHANGE' && <PfInput label="Price change" value={percent} onChange={setPercent} inputMode="decimal" error={errors.percent} hint="Percent. Use a negative number for a price cut." />}
          </div>
          {(errors.target || errors.kind || message) && <Alert variant="danger">{errors.target ?? errors.kind ?? message}</Alert>}
          <div>
            <Button type="submit" variant="primary" size="lg" disabled={busy || !chosen}>
              {busy ? 'Simulating…' : 'Run simulation'}
            </Button>
          </div>
        </form>
      </Card>

      {result && (
        <section className="pf-stack" aria-live="polite" aria-label="Simulation results">
          <h2>{result.description}</h2>
          <div className="pf-whatif-grid pf-reveal">
            <div style={{ ['--i' as string]: 0 }}>
              <Outcome title="Today" subtitle="Current allocation" o={result.baseline} budget={result.budget} />
            </div>
            <div style={{ ['--i' as string]: 1 }}>
              <Outcome title="Keep the allocation" subtitle="If you change nothing" o={result.kept} baseline={result.baseline} budget={result.budget} note={result.kept.note} />
            </div>
            <div style={{ ['--i' as string]: 2 }}>
              <Outcome title="Re-optimised" subtitle="A fresh recommendation" o={result.reoptimised} baseline={result.baseline} budget={result.budget} note={result.reoptimised.reason} focus />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
