import { Alert, Button, Card, Select, Table, Tabs, TopicTag } from '@pf/design-system';
import { Decimal, MODEL_STATUSES, STATUS_LABELS, type FieldErrors, type ModelStatus } from '@pf/domain';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { LoadError, Loading, PageHead, PfInput, TableScroll } from '../app/controls';
import { useApi } from '../app/useApi';
import { plural } from '../format';
import type { Model, Provider } from '../types';

export function AdminScreen() {
  const [tab, setTab] = useState('models');
  return (
    <>
      <PageHead
        overline={<TopicTag>Admin console</TopicTag>}
        title="Catalogue"
        subtitle="Update prices, benchmark scores and availability. Every price or score change is kept in the model’s history, and the next recommendation uses it."
      />
      <Tabs
        label="Admin sections"
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'models', label: 'Models & pricing', content: <ModelsPanel /> },
          { key: 'providers', label: 'Providers', content: <ProvidersPanel /> },
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Models & pricing — inline-editable grid
// ---------------------------------------------------------------------------
interface RowDraft {
  inputPrice: string;
  outputPrice: string;
  codingScore: string;
  reasoningScore: string;
  status: ModelStatus;
}

const toDraft = (m: Model): RowDraft => ({
  inputPrice: new Decimal(m.inputPrice).toString(),
  outputPrice: new Decimal(m.outputPrice).toString(),
  codingScore: String(m.codingScore),
  reasoningScore: String(m.reasoningScore),
  status: m.status,
});

function isDirty(m: Model, d: RowDraft): boolean {
  const same = (a: string, b: string) => {
    try {
      return new Decimal(a || 'NaN').eq(b);
    } catch {
      return false;
    }
  };
  return !same(d.inputPrice, m.inputPrice) || !same(d.outputPrice, m.outputPrice) || d.codingScore !== String(m.codingScore) || d.reasoningScore !== String(m.reasoningScore) || d.status !== m.status;
}

function ModelsPanel() {
  const { data: models, error, loading, reload, setData } = useApi<Model[]>('/models');
  const [drafts, setDrafts] = useState<Record<number, RowDraft>>({});
  const [rowErrors, setRowErrors] = useState<Record<number, FieldErrors>>({});
  const [saving, setSaving] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'danger'; text: string } | null>(null);

  if (loading && !models) return <Loading what="Loading models" />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  if (!models) return null;

  const draftOf = (m: Model) => drafts[m.id] ?? toDraft(m);
  const edit = (m: Model, patch: Partial<RowDraft>) => setDrafts((d) => ({ ...d, [m.id]: { ...draftOf(m), ...patch } }));

  const save = async (m: Model) => {
    const d = draftOf(m);
    setSaving(m.id);
    setNotice(null);
    try {
      const toScore = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s) : s);
      const updated = await api<Model>(`/models/${m.id}`, {
        method: 'PATCH',
        body: { inputPrice: d.inputPrice.trim(), outputPrice: d.outputPrice.trim(), codingScore: toScore(d.codingScore), reasoningScore: toScore(d.reasoningScore), status: d.status },
      });
      setData(models.map((x) => (x.id === m.id ? updated : x)));
      setDrafts(({ [m.id]: _, ...rest }) => rest);
      setRowErrors(({ [m.id]: _, ...rest }) => rest);
      setNotice({ kind: 'success', text: `${updated.name} saved. The next recommendation will use these figures.` });
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.errors).length) {
        setRowErrors((e) => ({ ...e, [m.id]: err.errors }));
        setNotice({ kind: 'danger', text: `${m.name} wasn’t saved: ${Object.values(err.errors)[0]}` });
      } else setNotice({ kind: 'danger', text: err instanceof ApiError ? err.message : 'Something went wrong.' });
    } finally {
      setSaving(null);
    }
  };

  const cell = (m: Model, key: 'inputPrice' | 'outputPrice' | 'codingScore' | 'reasoningScore', label: string, prefix?: string) => (
    <PfInput
      compact
      hideLabel
      label={`${label} for ${m.name}`}
      prefix={prefix}
      inputMode={prefix ? 'decimal' : 'numeric'}
      value={draftOf(m)[key]}
      onChange={(v) => edit(m, { [key]: v })}
      error={rowErrors[m.id]?.[key]}
    />
  );

  return (
    <div className="pf-stack">
      {notice && (
        <Alert variant={notice.kind} onDismiss={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}
      <p className="pf-subtle">Prices are US dollars per 1M tokens. Scores run from 0 to 100.</p>
      <TableScroll label="Models and pricing" stack>
        <Table
          rowHeaders
          columns={[
            { key: 'model', label: 'Model' },
            { key: 'input', label: 'Input price' },
            { key: 'output', label: 'Output price' },
            { key: 'coding', label: 'Coding' },
            { key: 'reasoning', label: 'Reasoning' },
            { key: 'status', label: 'Status' },
            { key: 'save', label: <span className="ds-visually-hidden">Save</span> },
          ]}
          rows={models.map((m) => {
            const dirty = isDirty(m, draftOf(m));
            return {
              id: m.id,
              model: (
                <span className="pf-stack pf-stack--none">
                  <span>{m.name}</span>
                  <span className="pf-subtle pf-small">
                    {m.providerName} · {m.version}
                  </span>
                </span>
              ),
              input: cell(m, 'inputPrice', 'Input price', '$'),
              output: cell(m, 'outputPrice', 'Output price', '$'),
              coding: cell(m, 'codingScore', 'Coding score'),
              reasoning: cell(m, 'reasoningScore', 'Reasoning score'),
              status: (
                <Select
                  hideLabel
                  label={`Status for ${m.name}`}
                  value={draftOf(m).status}
                  onChange={(v) => edit(m, { status: v as ModelStatus })}
                  options={MODEL_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
                />
              ),
              save: (
                <Button variant="ghost" size="sm" disabled={!dirty || saving === m.id} onClick={() => save(m)} aria-label={`Save ${m.name}`}>
                  {saving === m.id ? 'Saving…' : 'Save'}
                </Button>
              ),
            };
          })}
        />
      </TableScroll>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------
function ProvidersPanel() {
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
