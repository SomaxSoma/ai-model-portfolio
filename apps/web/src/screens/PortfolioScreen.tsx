import { Alert, Button, Card, Select, Stat, Table, TextLink } from '@pf/design-system';
import {
  analyzeRisk,
  blendedScore,
  Decimal,
  checkPortfolio,
  costBreakdown,
  eligibleModels,
  formatUsd,
  normalisePercentages,
  parseMoney,
  parseName,
  sumMoney,
  type FieldErrors,
} from '@pf/domain';
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { api, ApiError } from '../api';
import { ButtonLink, LoadError, Loading, PageHead, PfInput, PfSlider, TableScroll } from '../app/controls';
import { useApi } from '../app/useApi';
import { gradientSteps, RingChart, RiskPanel } from '../app/viz';
import { formatDate, formatInt } from '../format';
import { usePlanner } from '../state/planner';
import type { Feedback, Model, Portfolio, Recommendation, Workload } from '../types';

// ---------------------------------------------------------------------------
// /portfolio — entry point from the nav
// ---------------------------------------------------------------------------
export function PortfolioEntryScreen() {
  const { lastRecommendationId } = usePlanner();
  const [params] = useSearchParams();
  const showSaved = params.has('saved');
  const { data: saved, error, reload } = useApi<Portfolio[]>('/portfolios');

  if (lastRecommendationId && !showSaved) return <Navigate to={`/recommendations/${lastRecommendationId}`} replace />;

  return (
    <div className="pf-stack pf-stack--lg">
      <PageHead title="Portfolio" subtitle="A portfolio splits one workload across several models to balance quality and cost." />
      {!showSaved && (
        <Card tint padding="lg" className="pf-empty">
          {saved && saved.length > 0 ? (
            <>
              <h2>Plan another workload</h2>
              <p className="pf-subtle">Open a saved portfolio below, or describe a new workload to get a fresh recommendation.</p>
            </>
          ) : (
            <>
              <h2>No recommendation yet</h2>
              <p className="pf-subtle">Describe your workload and budget, and we’ll recommend a mix of models you can fine-tune and save.</p>
            </>
          )}
          <ButtonLink to="/workload">Define workload</ButtonLink>
        </Card>
      )}
      <section className="pf-stack">
        <h2>Saved portfolios</h2>
        {error && <LoadError error={error} onRetry={reload} />}
        {saved && saved.length === 0 && <p className="pf-subtle">You haven’t saved a portfolio yet.</p>}
        {saved && saved.length > 0 && (
          <TableScroll label="Saved portfolios" stack fluid>
            <Table
              rowHeaders
              columns={[
                { key: 'name', label: 'Portfolio' },
                { key: 'workload', label: 'Workload' },
                { key: 'models', label: 'Models', align: 'right' },
                { key: 'cost', label: 'Monthly cost', align: 'right' },
                { key: 'budget', label: 'Budget', align: 'right' },
                { key: 'updated', label: 'Last saved' },
                { key: 'actions', label: <span className="ds-visually-hidden">Actions</span> },
              ]}
              rows={saved.map((p) => ({
                id: p.id,
                name: <Link to={`/portfolios/${p.id}`}>{p.name}</Link>,
                workload: p.workload.name,
                models: p.allocations.length,
                cost: formatUsd(p.estimatedCost),
                budget: formatUsd(p.budget),
                updated: formatDate(p.updatedAt),
                actions: (
                  <span className="pf-row" style={{ gap: 'var(--sp-3)', flexWrap: 'nowrap' }}>
                    <Link to={`/portfolios/${p.id}`} aria-label={`Open ${p.name}`}>
                      Open
                    </Link>
                    <Link to={`/portfolios/${p.id}/what-if`} aria-label={`Run a what-if scenario on ${p.name}`}>
                      What-if
                    </Link>
                  </span>
                ),
              }))}
            />
          </TableScroll>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// /recommendations/:id and /portfolios/:id — the editor
// ---------------------------------------------------------------------------
export function PortfolioScreen({ source }: { source: 'recommendation' | 'portfolio' }) {
  const { id } = useParams();
  const rec = useApi<Recommendation>(source === 'recommendation' ? `/recommendations/${id}` : null);
  const saved = useApi<Portfolio>(source === 'portfolio' ? `/portfolios/${id}` : null);
  const catalogue = useApi<Model[]>('/models');

  const primary = source === 'recommendation' ? rec : saved;
  const error = primary.error ?? catalogue.error;
  if (error) return <LoadError error={error} onRetry={() => (primary.reload(), catalogue.reload())} />;
  if (!primary.data || !catalogue.data) return <Loading what="Loading portfolio" />;

  if (source === 'recommendation') {
    const r = rec.data!;
    // Already accepted: open the saved portfolio instead of creating a duplicate.
    if (r.portfolioId) return <Navigate to={`/portfolios/${r.portfolioId}`} replace />;
    return (
      <PortfolioEditor
        key={`r${r.id}`}
        workload={r.workload}
        catalogue={catalogue.data}
        initialLines={ordered(r.allocations.map((a) => ({ modelId: a.modelId, pct: a.allocationPercentage })))}
        initialName={`${r.workload.name} portfolio`}
        initialBudget={r.workload.budget}
        recommendation={r}
      />
    );
  }
  const p = saved.data!;
  return (
    <PortfolioEditor
      key={`p${p.id}-${p.updatedAt}`}
      workload={p.workload}
      catalogue={catalogue.data}
      initialLines={ordered(p.allocations.map((a) => ({ modelId: a.modelId, pct: a.allocationPercentage })))}
      initialName={p.name}
      initialBudget={p.budget}
      portfolio={p}
      onSaved={saved.setData}
    />
  );
}

interface Line {
  modelId: number;
  pct: number;
}

/** Saves the cost breakdown as a CSV file (quoted cells; amounts as shown, rounded to the cent). */
function downloadCsv(name: string, rows: string[][]) {
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const csv = [['Model', 'Allocation', 'Input cost', 'Output cost', 'Monthly cost'], ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^\w\- ]+/g, '').trim() || 'portfolio'}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Largest share first, then model id: the order is the same for a recommendation and the portfolio saved from it. */
function ordered(lines: Line[]): Line[] {
  return [...lines].sort((a, b) => b.pct - a.pct || a.modelId - b.modelId);
}

function trimMoney(v: string): string {
  return v.includes('.') ? v.replace(/\.?0+$/, '') : v;
}

function PortfolioEditor(props: {
  workload: Workload;
  catalogue: Model[];
  initialLines: Line[];
  initialName: string;
  initialBudget: string;
  recommendation?: Recommendation;
  portfolio?: Portfolio;
  onSaved?: (p: Portfolio) => void;
}) {
  const { workload, catalogue, recommendation, portfolio } = props;
  const navigate = useNavigate();
  const location = useLocation();
  const { setLastRecommendationId, setDraft } = usePlanner();

  const editWorkload = () => {
    setDraft({
      name: workload.name,
      inputTokens: String(workload.inputTokens),
      outputTokens: String(workload.outputTokens),
      requestsPerMonth: String(workload.requestsPerMonth),
      budget: trimMoney(workload.budget),
      requiredCapabilities: workload.requiredCapabilities,
      weights: workload.scoringWeights
        ? {
            quality: Math.round(workload.scoringWeights.quality * 100),
            cost: Math.round(workload.scoringWeights.cost * 100),
            latency: Math.round(workload.scoringWeights.latency * 100),
            reliability: Math.round(workload.scoringWeights.reliability * 100),
          }
        : { quality: 60, cost: 40, latency: 0, reliability: 0 },
    });
    navigate('/workload');
  };

  // A mix proposed elsewhere (the what-if's re-optimised result) opens as an unsaved edit to review.
  const proposed = (location.state as { proposed?: Line[] } | null)?.proposed?.filter((l) => catalogue.some((m) => m.id === l.modelId));
  const [lines, setLines] = useState<Line[]>(() => (proposed?.length ? ordered(proposed) : props.initialLines));
  const [name, setName] = useState(props.initialName);
  const [budget, setBudget] = useState(trimMoney(props.initialBudget));
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [serverMessage, setServerMessage] = useState('');
  const [notice, setNotice] = useState(
    (location.state as { saved?: boolean } | null)?.saved ? 'Portfolio saved.' : proposed?.length ? 'Loaded the re-optimised mix from your what-if, at today’s prices. Review it, then save to apply it.' : '',
  );
  const [saving, setSaving] = useState(false);
  const [pick, setPick] = useState('');

  const models = useMemo(() => new Map(catalogue.map((m) => [m.id, m])), [catalogue]);
  const edited = JSON.stringify(lines) !== JSON.stringify(props.initialLines);

  // Every figure below comes from the shared cost function.
  const rows = lines
    .map((l) => ({ ...l, model: models.get(l.modelId) }))
    .filter((r): r is Line & { model: Model } => !!r.model)
    .map((r) => ({ ...r, cost: costBreakdown(r.model, workload, r.pct) }));
  const parsedBudget = parseMoney(budget.replace(/[$,]/g, ''), 'portfolio budget');
  const parsedName = parseName(name, 'portfolio');
  const check = checkPortfolio(
    rows.map((r) => ({ allocationPercentage: r.pct, estimatedCost: r.cost.total })),
    parsedBudget.value ?? '0',
  );
  const total = check.totalCost;
  const score = blendedScore(rows.map((r) => ({ model: r.model, allocationPercentage: r.pct })));
  const addable = eligibleModels(catalogue, workload).filter((m) => !lines.some((l) => l.modelId === m.id));
  // Default the picker to the best-ranked model not yet in the portfolio.
  const addableRanked = [...addable].sort((a, b) => b.overallScore - a.overallScore || Number(a.inputPrice) - Number(b.inputPrice) || a.id - b.id);
  const pickValue = pick && addable.some((m) => String(m.id) === pick) ? pick : String(addableRanked[0]?.id ?? '');
  const withinWorkloadBudget = total.lte(workload.budget);
  const nothingEligible = recommendation && recommendation.allocations.length === 0 && lines.length === 0;
  const canSave = check.valid && !parsedName.error && !parsedBudget.error && !saving;

  const setPct = (modelId: number, pct: number) => setLines((ls) => ls.map((l) => (l.modelId === modelId ? { ...l, pct } : l)));
  const remove = (modelId: number) => setLines((ls) => ls.filter((l) => l.modelId !== modelId));
  const add = (modelId: number) => setLines((ls) => [...ls, { modelId, pct: ls.length === 0 ? 100 : 0 }]);
  const normalise = () =>
    setLines((ls) => {
      const pcts = normalisePercentages(ls.map((l) => l.pct));
      return ls.map((l, i) => ({ ...l, pct: pcts[i]! }));
    });

  const save = async () => {
    setServerErrors({});
    setServerMessage('');
    setNotice('');
    setSaving(true);
    const body = {
      name: parsedName.value,
      budget: parsedBudget.value,
      allocations: lines.filter((l) => l.pct > 0).map((l) => ({ modelId: l.modelId, allocationPercentage: l.pct })),
    };
    try {
      if (portfolio) {
        const updated = await api<Portfolio>(`/portfolios/${portfolio.id}`, { method: 'PATCH', body });
        props.onSaved?.(updated);
        navigate(location.pathname, { replace: true, state: { saved: true } });
      } else {
        const created = await api<Portfolio>('/portfolios', {
          method: 'POST',
          body: { ...body, workloadId: workload.id, recommendationId: recommendation?.id ?? null },
        });
        setLastRecommendationId(null);
        navigate(`/portfolios/${created.id}`, { replace: true, state: { saved: true } });
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setServerErrors(err.errors);
        setServerMessage(err.message);
      } else setServerMessage('Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const remove_ = async () => {
    if (!portfolio || !window.confirm(`Delete “${portfolio.name}”? This can’t be undone.`)) return;
    try {
      await api(`/portfolios/${portfolio.id}`, { method: 'DELETE' });
      navigate('/portfolio?saved', { replace: true });
    } catch (err) {
      setServerMessage(err instanceof ApiError ? err.message : 'Couldn’t delete the portfolio.');
    }
  };

  // ---- banner copy --------------------------------------------------------
  let headline: string;
  let reason: string;
  if (nothingEligible) {
    headline = 'No model fits this workload';
    reason = recommendation!.reason;
  } else if (!edited && recommendation) {
    headline = recommendation.withinBudget ? 'Recommended portfolio, within budget' : 'Closest portfolio, over budget';
    reason = recommendation.reason;
  } else if (!edited && portfolio) {
    headline = withinWorkloadBudget ? 'Saved portfolio, within budget' : 'Saved portfolio, over the workload budget';
    reason = `Last saved ${formatDate(portfolio.updatedAt)}. Adjust the allocation and save to update it.`;
  } else {
    headline = withinWorkloadBudget ? 'Your allocation is within budget' : 'Your allocation is over budget';
    reason = 'You’ve changed the recommended allocation. Costs update as you go — save once all three checks pass.';
  }
  const positive = !nothingEligible && withinWorkloadBudget;
  // Each allocation row takes a step along the two-colour gradient (rows, ring, legend); names are always in text.
  const ringSteps = gradientSteps(Math.max(1, rows.length));
  const ringColor = (i: number) => ringSteps[i] ?? ringSteps[0]!;
  const risk = analyzeRisk(rows.map((r) => ({ model: r.model, allocationPercentage: r.pct, estimatedCost: r.cost.total })));
  const pricesMoved = portfolio && !edited && !new Decimal(portfolio.savedEstimatedCost).eq(portfolio.estimatedCost);

  const breakdownRows = [
    ...rows.map((r) => ({
      id: r.modelId,
      model: r.model.name,
      allocation: `${r.pct}%`,
      input: formatUsd(r.cost.input),
      output: formatUsd(r.cost.output),
      monthly: formatUsd(r.cost.total),
    })),
    {
      id: 'total',
      _variant: 'total' as const,
      model: 'Total',
      allocation: `${check.totalPercent}%`,
      input: formatUsd(sumMoney(rows.map((r) => r.cost.input))),
      output: formatUsd(sumMoney(rows.map((r) => r.cost.output))),
      monthly: formatUsd(total),
    },
  ];

  const checks = [
    { ok: check.totalsHundred, label: check.totalsHundred ? 'Allocation totals 100%' : `Allocation totals ${check.totalPercent}% — needs 100%` },
    { ok: check.hasModels && check.withinBudget && !parsedBudget.error, label: 'Total cost within budget' },
    { ok: check.hasModels, label: 'At least one model' },
  ];

  return (
    <>
      <section className={`pf-banner ${positive ? 'pf-banner--positive' : 'pf-banner--negative'}`} aria-labelledby="pf-banner-headline">
        <div>
          <div className="pf-banner__overline">
            {workload.name}
            <span className="pf-banner__status">{positive ? '✓ Within budget' : nothingEligible ? '✕ No eligible model' : '✕ Over budget'}</span>
          </div>
          <h1 id="pf-banner-headline" className="pf-banner__headline">
            {headline}
          </h1>
          <p className="pf-banner__reason">{reason}</p>
          <div className="pf-banner__metrics">
            <div className="pf-banner__metric">
              <span className="pf-banner__value">{formatUsd(total)}</span>
              <span className="pf-banner__label">Estimated monthly cost</span>
            </div>
            <div className="pf-banner__metric">
              <span className="pf-banner__value">{formatUsd(workload.budget)}</span>
              <span className="pf-banner__label">Workload budget</span>
            </div>
            <div className="pf-banner__metric">
              <span className="pf-banner__value">{rows.filter((r) => r.pct > 0).length}</span>
              <span className="pf-banner__label">Models allocated</span>
            </div>
          </div>
        </div>
        <RingChart
          caption="allocated"
          centre={`${check.totalPercent}%`}
          parts={rows.filter((r) => r.pct > 0).map((r) => ({ key: r.modelId, label: r.model.name, share: r.pct, color: ringColor(rows.indexOf(r)) }))}
        />
      </section>

      {pricesMoved && (
        <Alert variant="info" title="Prices changed since you saved">
          This portfolio was {formatUsd(portfolio.savedEstimatedCost)} a month when saved; at today’s prices it’s {formatUsd(portfolio.estimatedCost)}. Save again to record the new figures.
        </Alert>
      )}

      <div className="pf-two-col">
        <div className="pf-stack pf-stack--lg">
          <section className="pf-stack" aria-labelledby="pf-alloc-head">
            <div className="pf-section-head">
              <h2 id="pf-alloc-head">Allocation</h2>
              <TextLink as="button" arrow={false} onClick={normalise} disabled={lines.length === 0 || check.totalPercent === 100}>
                Normalise to 100%
              </TextLink>
            </div>

            {rows.length === 0 ? (
              <p className="pf-subtle">{nothingEligible ? 'Change the workload’s requirements to see eligible models.' : 'No models in this portfolio yet. Add one below.'}</p>
            ) : (
              <ul className="pf-alloc">
                {rows.map((r) => (
                  <li key={r.modelId} className="pf-alloc__row">
                    <div className="pf-alloc__head">
                      <span className="pf-swatch" style={{ background: ringColor(rows.indexOf(r)) }} aria-hidden="true" />
                      <span>
                        <span className="pf-alloc__name">{r.model.name}</span>
                        <span className="pf-subtle"> · {r.model.providerName}</span>
                      </span>
                      <span className="pf-num">{formatUsd(r.cost.total)}</span>
                      <span className="pf-alloc__pct">{r.pct}%</span>
                      <button type="button" className="pf-icon-button" aria-label={`Remove ${r.model.name}`} onClick={() => remove(r.modelId)}>
                        ×
                      </button>
                    </div>
                    <PfSlider label={`Share of workload for ${r.model.name}`} value={r.pct} valueText={`${r.pct}%`} onChange={(v) => setPct(r.modelId, v)} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="pf-stack pf-stack--sm" aria-labelledby="pf-add-head">
            <h3 id="pf-add-head">Add an eligible model</h3>
            {addable.length ? (
              // A live catalogue has ~100 eligible models: a sorted picker, not a wall of buttons.
              <div className="pf-row">
                <Select
                  label="Eligible model"
                  hideLabel
                  value={pickValue}
                  onChange={setPick}
                  options={addableRanked.map((m) => ({ value: String(m.id), label: `${m.name} · ${m.providerName} · score ${m.overallScore} · ${formatUsd(costBreakdown(m, workload, 100).total)}/mo at 100%` }))}
                />
                <Button
                  variant="ghost"
                  onClick={() => {
                    add(Number(pickValue));
                    setPick('');
                  }}
                >
                  Add to portfolio
                </Button>
              </div>
            ) : (
              <p className="pf-subtle">{nothingEligible ? 'No model meets this workload’s requirements.' : 'Every eligible model is already in the portfolio.'}</p>
            )}
          </section>

          {rows.length > 0 && (
            <section className="pf-stack" aria-labelledby="pf-breakdown-head">
              <h2 id="pf-breakdown-head">Cost breakdown</h2>
              <TableScroll label="Cost breakdown" stack fluid>
                <Table
                  rowHeaders
                  columns={[
                    { key: 'model', label: 'Model' },
                    { key: 'allocation', label: 'Allocation', align: 'right' },
                    { key: 'input', label: 'Input cost', align: 'right' },
                    { key: 'output', label: 'Output cost', align: 'right' },
                    { key: 'monthly', label: 'Monthly cost', align: 'right' },
                  ]}
                  rows={breakdownRows}
                />
              </TableScroll>
              <p className="pf-subtle pf-small">
                {formatInt(workload.requestsPerMonth)} {workload.requestsPerMonth === 1 ? 'request' : 'requests'} a month at {workload.inputTokens.toLocaleString('en-US')} input and {workload.outputTokens.toLocaleString('en-US')} output tokens each. Totals are calculated exactly and then rounded, so rounded rows can differ from the total by a cent.
              </p>
            </section>
          )}

          {rows.length > 0 && <RiskPanel risk={risk} />}

          {(recommendation || portfolio?.recommendationId) && <FeedbackCard recommendationId={(recommendation?.id ?? portfolio?.recommendationId)!} catalogue={catalogue} />}
        </div>

        <aside className="pf-sticky pf-stack">
          <Card padding="lg" className="pf-stack">
            <PfInput label="Portfolio name" value={name} onChange={setName} error={serverErrors.name ?? (name.trim() ? undefined : parsedName.error)} />
            <PfInput
              label="Portfolio budget"
              prefix="$"
              inputMode="decimal"
              value={budget}
              onChange={setBudget}
              error={serverErrors.budget ?? parsedBudget.error}
              hint="Monthly, in US dollars."
            />

            <ul className="pf-checks" aria-label="Checks before saving">
              {checks.map((c) => (
                <li key={c.label}>
                  <span className={`pf-check-icon ${c.ok ? 'pf-check-icon--ok' : 'pf-check-icon--fail'}`} aria-hidden="true">
                    {c.ok ? '✓' : '✕'}
                  </span>
                  <span className={c.ok ? undefined : 'pf-negative'}>
                    <span className="ds-visually-hidden">{c.ok ? 'Passed: ' : 'Not yet: '}</span>
                    {c.label}
                  </span>
                </li>
              ))}
            </ul>

            <Stat size="sm" value={rows.length ? score.toFixed(1) : '–'} label="Blended benchmark score (0–100)" />

            {serverErrors.allocations && <Alert variant="danger">{serverErrors.allocations}</Alert>}
            {serverMessage && !Object.keys(serverErrors).length && <Alert variant="danger">{serverMessage}</Alert>}
            {notice && (
              <Alert variant="success" onDismiss={() => setNotice('')}>
                {notice}
              </Alert>
            )}

            <div className="pf-stack pf-stack--sm">
              <Button variant="primary" size="lg" fullWidth disabled={!canSave} onClick={save}>
                {saving ? 'Saving…' : 'Save portfolio'}
              </Button>
              <p className="pf-subtle pf-small">Saves this portfolio and its model allocations.</p>
            </div>

            {portfolio && (
              <Button variant="ghost" fullWidth onClick={() => navigate(`/portfolios/${portfolio.id}/what-if`)}>
                Run a what-if scenario
              </Button>
            )}
            {rows.length > 0 && (
              <TextLink as="button" arrow={false} onClick={() => downloadCsv(name || 'portfolio', breakdownRows.map((r) => [String(r.model), String(r.allocation), String(r.input), String(r.output), String(r.monthly)]))}>
                Download cost breakdown (CSV)
              </TextLink>
            )}

            <div className="pf-row">
              <TextLink as="button" arrow={false} onClick={editWorkload}>
                Edit workload
              </TextLink>
              <TextLink as={Link} to="/portfolio?saved" arrow={false}>
                Saved portfolios
              </TextLink>
              {portfolio && (
                <TextLink as="button" arrow={false} variant="muted" onClick={remove_}>
                  Delete
                </TextLink>
              )}
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Pilot feedback (proposal §6.3): clarity rating + the model used before.
// ---------------------------------------------------------------------------
function FeedbackCard({ recommendationId, catalogue }: { recommendationId: number; catalogue: Model[] }) {
  const existing = useApi<Feedback | null>(`/recommendations/${recommendationId}/feedback`);
  const [rating, setRating] = useState(0);
  const [prior, setPrior] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    if (existing.data) {
      setRating(existing.data.clarityRating);
      setPrior(existing.data.priorModelId ? String(existing.data.priorModelId) : '');
    }
  }, [existing.data]);

  const submit = async () => {
    setState('saving');
    try {
      await api(`/recommendations/${recommendationId}/feedback`, { method: 'PUT', body: { clarityRating: rating, priorModelId: prior ? Number(prior) : null } });
      setState('saved');
    } catch {
      setState('error');
    }
  };

  return (
    <Card padding="lg" className="pf-stack">
      <div>
        <h2 className="pf-card-title">How clear was this recommendation?</h2>
        <p className="pf-subtle pf-small">Your rating helps us measure whether the explanations make sense. Optional.</p>
      </div>
      <div className="pf-rating" role="group" aria-label="Clarity from 1 (unclear) to 5 (very clear)">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" className="pf-rating__star" aria-pressed={rating === n} aria-label={`${n} of 5`} onClick={() => { setRating(n); setState('idle'); }}>
            {n}
          </button>
        ))}
      </div>
      <Select
        label="Which model did you use before? (optional)"
        value={prior}
        onChange={(v) => { setPrior(v); setState('idle'); }}
        options={[{ value: '', label: 'Not using one yet' }, ...catalogue.map((m) => ({ value: String(m.id), label: `${m.name} · ${m.providerName}` }))]}
      />
      <div className="pf-row">
        <Button variant="ghost" disabled={!rating || state === 'saving'} onClick={submit}>
          {state === 'saving' ? 'Sending…' : existing.data ? 'Update feedback' : 'Send feedback'}
        </Button>
        {state === 'saved' && <span className="pf-positive pf-small"><span aria-hidden="true">✓</span> Thanks — recorded.</span>}
        {state === 'error' && <span className="pf-negative pf-small">Couldn’t send that. Try again.</span>}
      </div>
    </Card>
  );
}
