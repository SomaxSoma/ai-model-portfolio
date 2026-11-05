import { countryName } from '@pf/domain';
import { Alert, Button, Card, Tabs } from '@pf/design-system';
import type { FieldErrors } from '@pf/domain';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { api, ApiError } from '../api';
import { LoadError, Loading, PageHead, PfInput } from '../app/controls';
import { EvaluationPanel, IngestionPanel, OpsPanel, QualityPanel } from './admin/OperationsPanels';
import { ModelsPanel } from './admin/ModelsPanel';
import { useApi } from '../app/useApi';
import { plural } from '../format';
import type { Provider } from '../types';

const TABS = ['models', 'providers', 'ingestion', 'quality', 'ops', 'evaluation'] as const;

export function AdminScreen() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab = TABS.includes(requested as (typeof TABS)[number]) ? requested! : 'models';
  return (
    <>
      <PageHead
        overline={<span className="pf-eyebrow">Admin console</span>}
        title="Catalogue operations"
        subtitle="Maintain prices, benchmarks and lifecycle data, watch ingestion and data quality, and track the platform’s evaluation metrics."
      />
      <Tabs
        label="Admin sections"
        active={tab}
        onChange={(k) => setParams({ tab: k }, { replace: true })}
        tabs={[
          { key: 'models', label: 'Models & pricing', content: <ModelsPanel /> },
          { key: 'providers', label: 'Providers', content: <ProvidersPanel /> },
          { key: 'ingestion', label: 'Ingestion', content: <IngestionPanel /> },
          { key: 'quality', label: 'Data quality', content: <QualityPanel /> },
          { key: 'ops', label: 'Operations', content: <OpsPanel /> },
          { key: 'evaluation', label: 'Evaluation', content: <EvaluationPanel /> },
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------
/** Inline editor for a provider's headquarters (two-letter country code). */
function ProviderHq({ provider, onSaved }: { provider: Provider; onSaved: (p: Provider) => void }) {
  const [value, setValue] = useState(provider.hqCountry ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty = value.trim().toUpperCase() !== (provider.hqCountry ?? '');
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onSaved(await api<Provider>(`/providers/${provider.id}`, { method: 'PATCH', body: { hqCountry: value.trim() || null } }));
    } catch (err) {
      setError(err instanceof ApiError ? (err.errors.hqCountry ?? err.message) : 'Couldn’t save.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="pf-row" style={{ gap: 'var(--sp-2)', alignItems: 'flex-end' }} onSubmit={save} noValidate>
      <PfInput
        compact
        label={`Headquarters of ${provider.name}`}
        hideLabel
        placeholder="HQ, e.g. US"
        maxLength={2}
        value={value}
        onChange={(v) => {
          setValue(v);
          setError('');
        }}
        error={error}
        hint={provider.hqCountry ? countryName(provider.hqCountry) : 'Headquarters not recorded'}
      />
      {dirty && (
        <Button type="submit" variant="ghost" size="sm" disabled={busy}>
          Save
        </Button>
      )}
    </form>
  );
}

export function ProvidersPanel() {
  const { data: providers, error, loading, reload, setData } = useApi<Provider[]>('/providers');
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setNotice('');
    if (name.trim().length < 2) {
      setErrors({ name: 'The provider name needs at least 2 characters.' });
      return;
    }
    setBusy(true);
    try {
      const p = await api<Provider>('/providers', { method: 'POST', body: { name: name.trim(), website: website.trim() || null } });
      setData([...(providers ?? []), p].sort((a, b) => a.name.localeCompare(b.name)));
      setName('');
      setWebsite('');
      setErrors({});
      setNotice(`${p.name} added.`);
    } catch (err) {
      if (err instanceof ApiError) setErrors(Object.keys(err.errors).length ? err.errors : { name: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pf-stack pf-stack--lg">
      {loading && !providers && <Loading what="Loading providers" />}
      {error && <LoadError error={error} onRetry={reload} />}
      {providers && (
        <ul className="pf-provider-grid pf-list-reset">
          {providers.map((p) => (
            <li key={p.id}>
              <Card padding="md" className="pf-stack pf-stack--sm">
                <h3>{p.name}</h3>
                <p className="pf-subtle">{plural(p.modelCount, 'model')}</p>
                <ProviderHq provider={p} onSaved={(saved) => setData((providers ?? []).map((x) => (x.id === saved.id ? saved : x)))} />
                {p.website && (
                  <a href={p.website} target="_blank" rel="noreferrer" className="pf-small">
                    {p.website.replace(/^https?:\/\//, '')}
                  </a>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Card tint padding="lg">
        <form className="pf-stack" onSubmit={submit} noValidate>
          <h2>Add a provider</h2>
          <div className="pf-form-grid">
            <PfInput label="Provider name" value={name} onChange={setName} error={errors.name} />
            <PfInput label="Website (optional)" type="url" value={website} onChange={setWebsite} error={errors.website} placeholder="https://" />
          </div>
          {notice && (
            <Alert variant="success" onDismiss={() => setNotice('')}>
              {notice}
            </Alert>
          )}
          <div>
            <Button type="submit" variant="primary" size="lg" disabled={busy}>
              {busy ? 'Adding…' : 'Add provider'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
