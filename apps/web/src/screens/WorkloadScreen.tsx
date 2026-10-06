import { Alert, Button, Card, FilterChip, Stat, TextLink } from '@pf/design-system';
import { CAPABILITIES, Decimal, eligibleModels, formatUsd, monthlyCost, validateWorkload, type FieldErrors } from '@pf/domain';
import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError } from '../api';
import { LoadError, PageHead, PfInput } from '../app/controls';
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

export function WorkloadScreen() {
  const { draft, setDraft, setLastRecommendationId } = usePlanner();
  const { data: models, error: loadError, reload } = useApi<Model[]>('/models');
  const navigate = useNavigate();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof WorkloadDraft>(key: K) => (value: WorkloadDraft[K]) => setDraft({ ...draft, [key]: value });
  const toggleCap = (key: string) =>
    set('requiredCapabilities')(draft.requiredCapabilities.includes(key) ? draft.requiredCapabilities.filter((c) => c !== key) : [...draft.requiredCapabilities, key]);

  // Live preview: the same eligibility rules and the same cost function as the engine.
  const preview = useMemo(() => {
    const volume = { inputTokens: num(draft.inputTokens), outputTokens: num(draft.outputTokens), requestsPerMonth: num(draft.requestsPerMonth) };
    const budget = new Decimal(num(draft.budget));
    const eligible = eligibleModels(models ?? [], { ...volume, requiredCapabilities: draft.requiredCapabilities });
    const costed = eligible
      .map((m) => ({ model: m, cost: monthlyCost(m, volume) }))
      .sort((a, b) => a.cost.comparedTo(b.cost) || a.model.id - b.model.id);
    const cheapest = costed[0];
    const share = cheapest && budget.gt(0) ? cheapest.cost.div(budget).mul(100) : null;
    return { eligible, costed: costed.slice(0, PREVIEW_COUNT), budget, share, ready: volume.inputTokens > 0 && volume.outputTokens > 0 && volume.requestsPerMonth > 0 };
  }, [models, draft]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError('');
    const v = validateWorkload({
      name: draft.name,
      inputTokens: draft.inputTokens.replace(/,/g, ''),
      outputTokens: draft.outputTokens.replace(/,/g, ''),
      requestsPerMonth: draft.requestsPerMonth.replace(/,/g, ''),
      budget: draft.budget.replace(/[$,]/g, ''),
      requiredCapabilities: draft.requiredCapabilities,
    });
    if (!v.ok) {
      setErrors(v.errors);
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
      if (err instanceof ApiError && Object.keys(err.errors).length) setErrors(err.errors);
      else setFormError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
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
              <PfInput label="Input tokens per request" inputMode="numeric" value={draft.inputTokens} onChange={set('inputTokens')} error={errors.inputTokens} hint="Prompt, instructions and context." />
              <PfInput label="Output tokens per request" inputMode="numeric" value={draft.outputTokens} onChange={set('outputTokens')} error={errors.outputTokens} hint="The length of a typical response." />
              <PfInput label="Requests per month" inputMode="numeric" value={draft.requestsPerMonth} onChange={set('requestsPerMonth')} error={errors.requestsPerMonth} />
              <PfInput label="Monthly budget" inputMode="decimal" prefix="$" value={draft.budget} onChange={set('budget')} error={errors.budget} hint="In US dollars." />
            </div>

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
                        {over && <span className="ds-visually-hidden"> (over budget)</span>}
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
