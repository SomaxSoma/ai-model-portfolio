import { Alert, Button, Card, FilterChip, Select, Table } from '@pf/design-system';
import { CAPABILITIES, Decimal, MODEL_STATUSES, STATUS_LABELS, type FieldErrors, type ModelStatus } from '@pf/domain';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../../api';
import { LoadError, Loading, PfInput, TableScroll } from '../../app/controls';
import { useApi } from '../../app/useApi';
import type { Model, Provider } from '../../types';

interface RowDraft {
  inputPrice: string;
  outputPrice: string;
  codingScore: string;
  reasoningScore: string;
  latencyMs: string;
  reliability: string;
  deprecationDate: string;
  status: ModelStatus;
}

const toDraft = (m: Model): RowDraft => ({
  inputPrice: new Decimal(m.inputPrice).toString(),
  outputPrice: new Decimal(m.outputPrice).toString(),
  codingScore: String(m.codingScore),
  reasoningScore: String(m.reasoningScore),
  latencyMs: m.latencyMs === null ? '' : String(m.latencyMs),
  reliability: m.reliability === null ? '' : String(m.reliability),
  deprecationDate: m.deprecationDate ?? '',
  status: m.status,
});

const sameDecimal = (a: string, b: string) => {
  try {
    return new Decimal(a || 'NaN').eq(b);
  } catch {
    return false;
  }
};

function isDirty(m: Model, d: RowDraft): boolean {
  const base = toDraft(m);
  return (
    !sameDecimal(d.inputPrice, m.inputPrice) ||
    !sameDecimal(d.outputPrice, m.outputPrice) ||
    d.codingScore !== base.codingScore ||
    d.reasoningScore !== base.reasoningScore ||
    d.latencyMs.trim() !== base.latencyMs ||
    d.reliability.trim() !== base.reliability ||
    d.deprecationDate.trim() !== base.deprecationDate ||
    d.status !== m.status
  );
}

/** Numbers go to the API as numbers when they look like numbers; anything else is sent as typed so the server's message explains it. */
const num = (s: string) => (/^-?\d+(\.\d+)?$/.test(s.trim()) ? Number(s) : s);
const nullable = (s: string) => (s.trim() === '' ? null : num(s));

export function ModelsPanel() {
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
      const updated = await api<Model>(`/models/${m.id}`, {
        method: 'PATCH',
        body: {
          inputPrice: d.inputPrice.trim(),
          outputPrice: d.outputPrice.trim(),
          codingScore: num(d.codingScore),
          reasoningScore: num(d.reasoningScore),
          latencyMs: nullable(d.latencyMs),
          reliability: nullable(d.reliability),
          deprecationDate: d.deprecationDate.trim() || null,
          status: d.status,
        },
      });
      setData(models.map((x) => (x.id === m.id ? updated : x)));
      setDrafts(({ [m.id]: _, ...rest }) => rest);
      setRowErrors(({ [m.id]: _, ...rest }) => rest);
      setNotice({ kind: 'success', text: `${updated.name} saved. Owners of affected portfolios have been alerted, and the next recommendation uses these figures.` });
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.errors).length) {
        setRowErrors((e) => ({ ...e, [m.id]: err.errors }));
        setNotice({ kind: 'danger', text: `${m.name} wasn’t saved: ${Object.values(err.errors)[0]}` });
      } else setNotice({ kind: 'danger', text: err instanceof ApiError ? err.message : 'Something went wrong.' });
    } finally {
      setSaving(null);
    }
  };

  const cell = (m: Model, key: keyof Omit<RowDraft, 'status'>, label: string, opts: { prefix?: string; placeholder?: string; mode?: 'decimal' | 'numeric' | 'text' } = {}) => (
    <PfInput
      compact
      hideLabel
      label={`${label} for ${m.name}`}
      prefix={opts.prefix}
      placeholder={opts.placeholder}
      inputMode={opts.mode ?? 'decimal'}
      value={draftOf(m)[key]}
      onChange={(v) => edit(m, { [key]: v })}
      error={rowErrors[m.id]?.[key]}
    />
  );

  return (
    <div className="pf-stack pf-stack--lg">
      {notice && (
        <Alert variant={notice.kind} onDismiss={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}
      <p className="pf-subtle">Prices are US dollars per 1M tokens. Scores run from 0 to 100. Leave latency or reliability empty when no source publishes them.</p>
      <TableScroll label="Models and pricing" stack>
        <Table
          rowHeaders
          columns={[
            { key: 'model', label: 'Model' },
            { key: 'input', label: 'Input price' },
            { key: 'output', label: 'Output price' },
            { key: 'coding', label: 'Coding' },
            { key: 'reasoning', label: 'Reasoning' },
            { key: 'latency', label: 'Latency (ms)' },
            { key: 'reliability', label: 'Reliability (%)' },
            { key: 'retires', label: 'Retires on' },
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
              input: cell(m, 'inputPrice', 'Input price', { prefix: '$' }),
              output: cell(m, 'outputPrice', 'Output price', { prefix: '$' }),
              coding: cell(m, 'codingScore', 'Coding score', { mode: 'numeric' }),
              reasoning: cell(m, 'reasoningScore', 'Reasoning score', { mode: 'numeric' }),
              latency: cell(m, 'latencyMs', 'Latency in milliseconds', { mode: 'numeric', placeholder: 'n/a' }),
              reliability: cell(m, 'reliability', 'Reliability percentage', { placeholder: 'n/a' }),
              retires: cell(m, 'deprecationDate', 'Retirement date', { mode: 'text', placeholder: 'YYYY-MM-DD' }),
              status: (
                <Select hideLabel label={`Status for ${m.name}`} value={draftOf(m).status} onChange={(v) => edit(m, { status: v as ModelStatus })} options={MODEL_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))} />
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
      <AddModelForm
        onCreated={(m) => {
          setData([...models, m]);
          setNotice({ kind: 'success', text: `${m.name} added to the catalogue.` });
        }}
      />
    </div>
  );
}

const EMPTY = { providerId: '', name: '', version: '', contextWindow: '', inputPrice: '', outputPrice: '', codingScore: '', reasoningScore: '', latencyMs: '', reliability: '', deprecationDate: '' };

function AddModelForm({ onCreated }: { onCreated: (m: Model) => void }) {
  const providers = useApi<Provider[]>('/providers');
  const [f, setF] = useState(EMPTY);
  const [caps, setCaps] = useState<string[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof EMPTY) => (v: string) => setF((cur) => ({ ...cur, [k]: v }));
  const providerId = f.providerId || String(providers.data?.[0]?.id ?? '');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const created = await api<Model>('/models', {
        method: 'POST',
        body: {
          providerId: Number(providerId),
          name: f.name,
          version: f.version,
          contextWindow: num(f.contextWindow),
          inputPrice: f.inputPrice,
          outputPrice: f.outputPrice,
          codingScore: num(f.codingScore),
          reasoningScore: num(f.reasoningScore),
          latencyMs: nullable(f.latencyMs),
          reliability: nullable(f.reliability),
          deprecationDate: f.deprecationDate.trim() || null,
          capabilities: caps,
        },
      });
      setF(EMPTY);
      setCaps([]);
      onCreated(created);
    } catch (err) {
      setErrors(err instanceof ApiError ? (Object.keys(err.errors).length ? err.errors : { name: err.message }) : { name: 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card tint padding="lg">
      <form className="pf-stack" onSubmit={submit} noValidate>
        <div>
          <h2 className="pf-card-title">Add a model</h2>
          <p className="pf-subtle pf-small">Its first price and benchmark rows are recorded in the model’s history.</p>
        </div>
        <div className="pf-form-grid">
          <Select label="Provider" value={providerId} onChange={set('providerId')} options={(providers.data ?? []).map((p) => ({ value: String(p.id), label: p.name }))} />
          <PfInput label="Model name" value={f.name} onChange={set('name')} error={errors.name ?? errors.providerId} />
          <PfInput label="Version" value={f.version} onChange={set('version')} error={errors.version} />
          <PfInput label="Context window (tokens)" inputMode="numeric" value={f.contextWindow} onChange={set('contextWindow')} error={errors.contextWindow} />
          <PfInput label="Input price / 1M" prefix="$" inputMode="decimal" value={f.inputPrice} onChange={set('inputPrice')} error={errors.inputPrice} />
          <PfInput label="Output price / 1M" prefix="$" inputMode="decimal" value={f.outputPrice} onChange={set('outputPrice')} error={errors.outputPrice} />
          <PfInput label="Coding score" inputMode="numeric" value={f.codingScore} onChange={set('codingScore')} error={errors.codingScore} />
          <PfInput label="Reasoning score" inputMode="numeric" value={f.reasoningScore} onChange={set('reasoningScore')} error={errors.reasoningScore} />
          <PfInput label="Median latency (ms, optional)" inputMode="numeric" value={f.latencyMs} onChange={set('latencyMs')} error={errors.latencyMs} />
          <PfInput label="30-day reliability (%, optional)" inputMode="decimal" value={f.reliability} onChange={set('reliability')} error={errors.reliability} />
          <PfInput label="Retirement date (optional)" placeholder="YYYY-MM-DD" value={f.deprecationDate} onChange={set('deprecationDate')} error={errors.deprecationDate} />
        </div>
        <fieldset className="pf-stack pf-stack--sm pf-fieldset">
          <legend className="pf-field__label">Capabilities</legend>
          <div className="pf-chips">
            {CAPABILITIES.map((c) => (
              <FilterChip key={c.key} active={caps.includes(c.key)} onClick={() => setCaps((cur) => (cur.includes(c.key) ? cur.filter((x) => x !== c.key) : [...cur, c.key]))}>
                {c.label}
              </FilterChip>
            ))}
          </div>
        </fieldset>
        <div>
          <Button type="submit" variant="primary" size="lg" disabled={busy || !providerId}>
            {busy ? 'Adding…' : 'Add model'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
