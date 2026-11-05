import { Alert, Button, Card, FilterChip, Select, Stat, TextLink } from '@pf/design-system';
import { CAPABILITIES, Decimal, eligibleModels, formatUsd, monthlyCost, QUALITY_BASES, QUALITY_BASIS_LABELS, validateWorkload, type FieldErrors } from '@pf/domain';
import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError } from '../api';
import { LoadError, PageHead, PfInput, PfSlider } from '../app/controls';
import { useApi } from '../app/useApi';
import { plural } from '../format';
import { usePlanner, type WorkloadDraft } from '../state/planner';
import type { Model, Recommendation, Workload } from '../types';

const PREVIEW_COUNT = 4;

/** Lenient parse for the live preview: anything unusable counts as 0. */
function num(v: string): number {
  const n = Number(v.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Typical request shapes, to start from instead of guessing token counts. */
const PRESETS = [
  { label: 'Chatbot', inputTokens: '1500', outputTokens: '400' },
  { label: 'RAG / search answers', inputTokens: '6000', outputTokens: '500' },
  { label: 'Summarisation', inputTokens: '8000', outputTokens: '800' },
  { label: 'Coding agent', inputTokens: '6000', outputTokens: '1200' },
] as const;

const WEIGHT_FIELDS = [
  { key: 'quality', label: 'Benchmark quality' },
  { key: 'cost', label: 'Low cost' },
  { key: 'latency', label: 'Low latency' },
  { key: 'reliability', label: 'Reliability' },
] as const;

export function WorkloadScreen() {
  const { draft, setDraft, setLastRecommendationId } = usePlanner();
  const { data: models, error: loadError, reload } = useApi<Model[]>('/models');
  const navigate = useNavigate();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  // Editing a field clears its error: a fixed field shouldn't keep an old message.
  const clearError = (...keys: string[]) => setErrors((prev) => (keys.some((k) => k in prev) ? Object.fromEntries(Object.entries(prev).filter(([k]) => !keys.includes(k))) : prev));
  const set = <K extends keyof WorkloadDraft>(key: K) => (value: WorkloadDraft[K]) => {
    clearError(key);
    setDraft({ ...draft, [key]: value });
  };
  const latencyAvailable = !models || models.some((m) => m.latencyMs !== null);
  const toggleCap = (key: string) =>
    set('requiredCapabilities')(draft.requiredCapabilities.includes(key) ? draft.requiredCapabilities.filter((c) => c !== key) : [...draft.requiredCapabilities, key]);

  // Live preview: the same eligibility rules and the same cost function as the engine.
  const preview = useMemo(() => {
    const cached = Math.min(100, Math.max(0, Math.round(num(draft.cachedInputPercent))));
    const volume = { inputTokens: num(draft.inputTokens), outputTokens: num(draft.outputTokens), requestsPerMonth: num(draft.requestsPerMonth), cachedInputPercent: cached };
    const budget = new Decimal(num(draft.budget));
    const eligible = eligibleModels(models ?? [], { ...volume, requiredCapabilities: draft.requiredCapabilities, qualityBasis: draft.qualityBasis });
    const costed = eligible
      .map((m) => ({ model: m, cost: monthlyCost(m, volume) }))
      .sort((a, b) => a.cost.comparedTo(b.cost) || a.model.id - b.model.id);
    const cheapest = costed[0];
    const share = cheapest && budget.gt(0) ? cheapest.cost.div(budget).mul(100) : null;
    return { eligible, costed: costed.slice(0, PREVIEW_COUNT), budget, share, ready: volume.inputTokens > 0 && volume.outputTokens > 0 && volume.requestsPerMonth > 0 };
  }, [models, draft]);

  const weightTotal = WEIGHT_FIELDS.reduce((a, f) => a + draft.weights[f.key], 0);
  const weightSummary = weightTotal
    ? WEIGHT_FIELDS.filter((f) => draft.weights[f.key] > 0)
        .map((f) => `${f.label.toLowerCase()} ${Math.round((draft.weights[f.key] / weightTotal) * 100)}%`)
        .join(' · ')
    : 'give at least one factor some weight';

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    // Bring the first problem into view: submitting from the bottom shouldn't look like nothing happened.
    const revealFirstError = () =>
      requestAnimationFrame(() => {
        const target = form.querySelector<HTMLElement>('[aria-invalid="true"], .pf-field__error');
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (target?.matches('input')) target.focus({ preventScroll: true });
      });
    setFormError('');
    const v = validateWorkload({
      name: draft.name,
      inputTokens: draft.inputTokens.replace(/,/g, ''),
      outputTokens: draft.outputTokens.replace(/,/g, ''),
      requestsPerMonth: draft.requestsPerMonth.replace(/,/g, ''),
      budget: draft.budget.replace(/[$,]/g, ''),
      requiredCapabilities: draft.requiredCapabilities,
      cachedInputPercent: draft.cachedInputPercent.trim() || '0',
      qualityBasis: draft.qualityBasis,
      // No latency data yet: the factor can't separate models, so it carries no weight.
      scoringWeights: latencyAvailable ? draft.weights : { ...draft.weights, latency: 0 },
    });
    if (!v.ok) {
      setErrors(v.errors);
      revealFirstError();
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const workload = await api<Workload>('/workloads', { method: 'POST', body: v.value });
      const rec = await api<Recommendation>(`/workloads/${workload.id}/recommendation`, { method: 'POST' });
      setLastRecommendationId(rec.id);
      navigate(`/recommendations/${rec.id}`);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.errors).length) {
        setErrors(err.errors);
        revealFirstError();
      } else setFormError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead title="Define workload" subtitle="Describe a typical request and your monthly volume. We’ll estimate costs and recommend a mix of models." />
      <div className="pf-two-col">
        <Card padding="lg">
          <form className="pf-stack pf-stack--lg" onSubmit={submit} noValidate>
            <div className="pf-form-grid">
              <PfInput className="pf-form-grid__full" label="Workload name" value={draft.name} onChange={set('name')} error={errors.name} placeholder="e.g. Customer support assistant" />
              <div className="pf-form-grid__full pf-stack pf-stack--sm">
                <span className="pf-field__label" id="pf-presets-label">
                  Start from a typical request
                </span>
                <div className="pf-chips" role="group" aria-labelledby="pf-presets-label">
                  {PRESETS.map((p) => (
                    <FilterChip
                      key={p.label}
                      active={draft.inputTokens === p.inputTokens && draft.outputTokens === p.outputTokens}
                      onClick={() => {
                        clearError('inputTokens', 'outputTokens');
                        setDraft({ ...draft, inputTokens: p.inputTokens, outputTokens: p.outputTokens });
                      }}
                    >
                      {p.label}
                    </FilterChip>
                  ))}
                </div>
                <span className="pf-field__hint">Tokens are pieces of words: about 750 English words make 1,000 tokens.</span>
              </div>
              <PfInput label="Input tokens per request" inputMode="numeric" value={draft.inputTokens} onChange={set('inputTokens')} error={errors.inputTokens} hint="Prompt, instructions and context." />
              <PfInput label="Output tokens per request" inputMode="numeric" value={draft.outputTokens} onChange={set('outputTokens')} error={errors.outputTokens} hint="The length of a typical response." />
              <PfInput label="Requests per month" inputMode="numeric" value={draft.requestsPerMonth} onChange={set('requestsPerMonth')} error={errors.requestsPerMonth} />
              <PfInput label="Monthly budget" inputMode="decimal" prefix="$" value={draft.budget} onChange={set('budget')} error={errors.budget} hint="In US dollars." />
              <PfInput
                label="Input served from prompt cache"
                inputMode="numeric"
                suffix="%"
                value={draft.cachedInputPercent}
                onChange={set('cachedInputPercent')}
                error={errors.cachedInputPercent}
                hint="Repeated instructions or context the provider can cache. Cached tokens cost the model’s cache-read price, where it publishes one. 0 if unsure."
              />
              <Select
                label="Rank quality by"
                value={draft.qualityBasis}
                onChange={(v) => set('qualityBasis')(v as typeof draft.qualityBasis)}
                options={QUALITY_BASES.map((b) => ({ value: b, label: QUALITY_BASIS_LABELS[b] }))}
              />
            </div>
            {draft.qualityBasis === 'INTELLIGENCE' && (
              <p className="pf-field__hint" style={{ marginTop: 'calc(var(--sp-4) * -1)' }}>
                Only models with a published intelligence index are considered — fewer models, but quality isn’t judged on coding alone. Good for writing, support and analysis.
              </p>
            )}

            <fieldset className="pf-stack pf-stack--sm pf-fieldset">
              <legend className="pf-field__label">
                Required capabilities
              </legend>
              <div className="pf-chips">
                {CAPABILITIES.map((c) => (
                  <FilterChip key={c.key} active={draft.requiredCapabilities.includes(c.key)} onClick={() => toggleCap(c.key)}>
                    {c.label}
                  </FilterChip>
                ))}
              </div>
              {errors.requiredCapabilities && <span className="pf-field__error">{errors.requiredCapabilities}</span>}
              <span className="pf-field__hint">Only models with every selected capability are considered.</span>
            </fieldset>

            <fieldset className="pf-stack pf-fieldset">
              <legend className="pf-field__label">Scoring priorities</legend>
              <p className="pf-field__hint" style={{ marginTop: 'calc(var(--sp-2) * -1)' }}>
                How much each factor counts when ranking models. Shares are relative: {weightSummary}.
                {!latencyAvailable && ' Latency isn’t published by the live source yet, so that factor is off for now.'}
              </p>
              <div className="pf-weights">
                {WEIGHT_FIELDS.map((f) => {
                  const off = f.key === 'latency' && !latencyAvailable;
                  const value = off ? 0 : draft.weights[f.key];
                  return (
                    <div key={f.key} className={`pf-weight${off ? ' pf-weight--off' : ''}`}>
                      <div className="pf-weight__head">
                        <span>{f.label}</span>
                        <span className="pf-num pf-strong">{off ? 'No data yet' : value}</span>
                      </div>
                      <PfSlider
                        label={`${f.label} priority`}
                        value={value}
                        valueText={off ? 'Unavailable: no latency data yet' : `${value}`}
                        disabled={off}
                        onChange={(v) => {
                          clearError('scoringWeights');
                          setDraft({ ...draft, weights: { ...draft.weights, [f.key]: v } });
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              {errors.scoringWeights && <span className="pf-field__error">{errors.scoringWeights}</span>}
            </fieldset>

            {formError && <Alert variant="danger">{formError}</Alert>}

            <div className="pf-row">
              <Button type="submit" variant="primary" size="lg" disabled={busy}>
                {busy ? 'Calculating…' : 'Calculate cost and recommend'}
              </Button>
              <TextLink as="button" arrow={false} onClick={() => set('requiredCapabilities')([])} disabled={!draft.requiredCapabilities.length}>
                Reset capabilities
              </TextLink>
            </div>
          </form>
        </Card>

        <aside className="pf-stack pf-sticky" aria-label="Live estimate" aria-live="polite">
          {loadError && <LoadError error={loadError} onRetry={reload} />}
          <Card tint padding="lg" className="pf-stack">
            <Stat value={models ? preview.eligible.length : '–'} label={`eligible ${preview.eligible.length === 1 ? 'model' : 'models'} of ${models?.length ?? '–'}`} />
            {models && preview.eligible.length === 0 && (
              <p className="pf-negative">No available model meets these requirements. Try removing a capability or shortening requests.</p>
            )}
          </Card>

          {preview.ready && preview.costed.length > 0 && (
            <Card padding="lg" className="pf-stack">
              <div className="pf-stack pf-stack--sm">
                <h2 className="pf-card-title">Single-model cost estimate</h2>
                <p className="pf-subtle">Monthly cost if one model handled everything. Cheapest {plural(preview.costed.length, 'option')}.</p>
              </div>
              <ul className="pf-preview-list">
                {preview.costed.map(({ model, cost }) => {
                  const over = preview.budget.gt(0) && cost.gt(preview.budget);
                  return (
                    <li key={model.id}>
                      <span>
                        <span className="pf-strong">{model.name}</span>
                        <span className="pf-subtle"> · {model.providerName}</span>
                      </span>
                      <span className={`pf-num${over ? ' pf-negative' : ''}`}>
                        {formatUsd(cost)}
                        {over && <span className="pf-over-tag">over budget</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {preview.share && (
                <p className={preview.share.gt(100) ? 'pf-negative' : 'pf-subtle'}>
                  The cheapest option uses {preview.share.lt(1) && !preview.share.isZero() ? 'under 1' : preview.share.toFixed(0)}% of the budget.
                </p>
              )}
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
