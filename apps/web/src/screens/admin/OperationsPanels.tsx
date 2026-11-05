import { Alert, Badge, Button, Card, SegmentedNav, Select, Table } from '@pf/design-system';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../../api';
import { LoadError, Loading, PfInput, TableScroll } from '../../app/controls';
import { relativeTime } from '../../app/NotificationBell';
import { useApi } from '../../app/useApi';
import { Kpi, TargetFlag } from '../../app/viz';
import { formatDate } from '../../format';

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------
interface Source {
  id: number;
  name: string;
  kind: 'FILE' | 'HTTP';
  location: string;
  enabled: boolean;
  scheduleMinutes: number;
  lastRunAt: string | null;
}
interface Run {
  id: number;
  sourceName: string;
  trigger: 'SCHEDULE' | 'MANUAL';
  status: 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  startedAt: string;
  finishedAt: string | null;
  recordsSeen: number;
  modelsCreated: number;
  modelsUpdated: number;
  recordsRejected: number;
  issuesFound: number;
  error: string | null;
}

const RUN_STATUS: Record<Run['status'], { label: string; cls: string }> = {
  RUNNING: { label: 'Running', cls: 'pf-subtle' },
  SUCCEEDED: { label: 'Succeeded', cls: 'pf-positive' },
  PARTIAL: { label: 'Partly applied', cls: 'pf-warning' },
  FAILED: { label: 'Failed', cls: 'pf-negative' },
};

function every(minutes: number): string {
  if (minutes % 1440 === 0) return `every ${minutes / 1440 === 1 ? 'day' : `${minutes / 1440} days`}`;
  if (minutes % 60 === 0) return `every ${minutes / 60 === 1 ? 'hour' : `${minutes / 60} hours`}`;
  return `every ${minutes} min`;
}

export function IngestionPanel() {
  const sources = useApi<Source[]>('/admin/ingestion/sources');
  const runs = useApi<Run[]>('/admin/ingestion/runs?limit=15');
  const [busy, setBusy] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'danger' | 'info'; text: string } | null>(null);

  const runNow = async (s: Source) => {
    setBusy(s.id);
    setNotice(null);
    try {
      const r = await api<{ status: string; recordsSeen?: number; modelsCreated?: number; modelsUpdated?: number; issuesFound?: number; error?: string | null }>(`/admin/ingestion/sources/${s.id}/run`, { method: 'POST' });
      if (r.status === 'QUEUED') setNotice({ kind: 'info', text: `${s.name} is queued. The worker will run it in a moment.` });
      else if (r.status === 'FAILED') setNotice({ kind: 'danger', text: `${s.name} failed: ${r.error}` });
      else setNotice({ kind: r.issuesFound ? 'info' : 'success', text: `${s.name}: ${r.recordsSeen} records read, ${r.modelsCreated} added, ${r.modelsUpdated} updated${r.issuesFound ? `, ${r.issuesFound} flagged for review` : ''}.` });
      sources.reload();
      runs.reload();
    } catch (err) {
      setNotice({ kind: 'danger', text: err instanceof ApiError ? err.message : 'The run couldn’t start.' });
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (s: Source) => {
    await api(`/admin/ingestion/sources/${s.id}`, { method: 'PATCH', body: { enabled: !s.enabled } }).catch(() => {});
    sources.reload();
  };

  return (
    <div className="pf-stack pf-stack--lg">
      {notice && (
        <Alert variant={notice.kind} onDismiss={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}
      <Card padding="lg" className="pf-stack">
        <div>
          <h2 className="pf-card-title">Sources</h2>
          <p className="pf-subtle pf-small">Feeds are checked on their schedule. Big price or benchmark moves are applied but flagged for review; invalid records are rejected.</p>
        </div>
        {sources.error && <LoadError error={sources.error} onRetry={sources.reload} />}
        {!sources.data ? (
          <Loading what="Loading sources" />
        ) : (
          <TableScroll label="Ingestion sources" stack fluid>
            <Table
              rowHeaders
              columns={[
                { key: 'name', label: 'Source' },
                { key: 'where', label: 'Location' },
                { key: 'schedule', label: 'Schedule' },
                { key: 'last', label: 'Last run' },
                { key: 'actions', label: <span className="ds-visually-hidden">Actions</span>, align: 'right' },
              ]}
              rows={sources.data.map((s) => ({
                id: s.id,
                name: (
                  <span className="pf-stack pf-stack--none">
                    <span>{s.name}</span>
                    <span className={`pf-status-dot ${s.enabled ? 'pf-positive' : 'pf-subtle'}`}>{s.enabled ? 'Enabled' : 'Paused'}</span>
                  </span>
                ),
                where: <span className="pf-mono pf-small">{s.kind === 'FILE' ? `data/${s.location}` : s.location}</span>,
                schedule: every(s.scheduleMinutes),
                last: s.lastRunAt ? relativeTime(s.lastRunAt) : 'Never',
                actions: (
                  <span className="pf-row" style={{ justifyContent: 'flex-end' }}>
                    <Button variant="ghost" size="sm" onClick={() => toggle(s)}>
                      {s.enabled ? 'Pause' : 'Resume'}
                    </Button>
                    <Button variant="ghost" size="sm" disabled={busy === s.id} onClick={() => runNow(s)} aria-label={`Run ${s.name} now`}>
                      {busy === s.id ? 'Running…' : 'Run now'}
                    </Button>
                  </span>
                ),
              }))}
            />
          </TableScroll>
        )}
      </Card>

      <Card padding="lg" className="pf-stack">
        <h2 className="pf-card-title">Recent runs</h2>
        {runs.data && runs.data.length === 0 && <p className="pf-subtle">No runs yet.</p>}
        {runs.data && runs.data.length > 0 && (
          <TableScroll label="Recent ingestion runs" stack fluid>
            <Table
              columns={[
                { key: 'when', label: 'Started' },
                { key: 'source', label: 'Source' },
                { key: 'status', label: 'Result' },
                { key: 'seen', label: 'Records', align: 'right' },
                { key: 'changes', label: 'Added · updated', align: 'right' },
                { key: 'issues', label: 'Flagged', align: 'right' },
              ]}
              rows={runs.data.map((r) => ({
                id: r.id,
                when: `${formatDate(r.startedAt)} · ${relativeTime(r.startedAt)}`,
                source: `${r.sourceName}${r.trigger === 'SCHEDULE' ? '' : ' (manual)'}`,
                status: (
                  <span className={RUN_STATUS[r.status].cls} title={r.error ?? undefined}>
                    {RUN_STATUS[r.status].label}
                    {r.error ? ` — ${r.error}` : ''}
                  </span>
                ),
                seen: r.recordsSeen,
                changes: `${r.modelsCreated} · ${r.modelsUpdated}`,
                issues: r.issuesFound,
              }))}
            />
          </TableScroll>
        )}
      </Card>

      <AddSourceForm onAdded={() => sources.reload()} />
    </div>
  );
}

function AddSourceForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'FILE' | 'HTTP'>('HTTP');
  const [location, setLocation] = useState('');
  const [schedule, setSchedule] = useState('60');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await api('/admin/ingestion/sources', { method: 'POST', body: { name, kind, location, scheduleMinutes: Number(schedule) } });
      setName('');
      setLocation('');
      onAdded();
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
          <h2 className="pf-card-title">Add a source</h2>
          <p className="pf-subtle pf-small">Use only permitted or public feeds in the catalogue feed format (see data/sample-feed.json).</p>
        </div>
        <div className="pf-form-grid">
          <PfInput label="Name" value={name} onChange={setName} error={errors.name} />
          <Select label="Type" value={kind} onChange={(v) => setKind(v as 'FILE' | 'HTTP')} options={[{ value: 'HTTP', label: 'Web address (https)' }, { value: 'FILE', label: 'File in the data folder' }]} />
          <PfInput label={kind === 'HTTP' ? 'Feed URL' : 'File name'} placeholder={kind === 'HTTP' ? 'https://' : 'sample-feed.json'} value={location} onChange={setLocation} error={errors.location} />
          <PfInput label="Check every (minutes)" inputMode="numeric" value={schedule} onChange={setSchedule} error={errors.scheduleMinutes} hint="Freshness target: at least every 24 hours." />
        </div>
        <div>
          <Button type="submit" variant="primary" size="lg" disabled={busy}>
            {busy ? 'Adding…' : 'Add source'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Data quality
// ---------------------------------------------------------------------------
interface Issue {
  id: number;
  modelName: string | null;
  kind: string;
  severity: 'WARNING' | 'ERROR';
  message: string;
  detectedAt: string;
  resolvedAt: string | null;
}

const ISSUE_LABELS: Record<string, string> = {
  INVALID_RECORD: 'Rejected record',
  MISSING_FIELDS: 'Missing fields',
  PRICE_JUMP: 'Large price change',
  BENCHMARK_JUMP: 'Large benchmark change',
  STALE_DATA: 'Stale figures',
  SOURCE_ERROR: 'Source unavailable',
};

export function QualityPanel() {
  const [status, setStatus] = useState('open');
  const issues = useApi<Issue[]>(`/admin/data-quality?status=${status}`);
  const [busy, setBusy] = useState<number | null>(null);

  const resolve = async (i: Issue) => {
    setBusy(i.id);
    await api(`/admin/data-quality/${i.id}/resolve`, { method: 'POST' }).catch(() => {});
    setBusy(null);
    issues.reload();
  };

  return (
    <Card padding="lg" className="pf-stack">
      <div className="pf-section-head">
        <div>
          <h2 className="pf-card-title">Review queue</h2>
          <p className="pf-subtle pf-small">Mark an issue resolved once you’ve checked it against the provider.</p>
        </div>
        <SegmentedNav label="Issue status" active={status} onChange={setStatus} items={[{ key: 'open', label: 'Open' }, { key: 'resolved', label: 'Resolved' }]} />
      </div>
      {issues.error && <LoadError error={issues.error} onRetry={issues.reload} />}
      {!issues.data ? (
        <Loading what="Loading issues" />
      ) : issues.data.length === 0 ? (
        <p className="pf-subtle">{status === 'open' ? 'Nothing to review. Every figure passed its checks.' : 'No resolved issues yet.'}</p>
      ) : (
        <TableScroll label="Data-quality issues" stack fluid>
          <Table
            columns={[
              { key: 'kind', label: 'Issue' },
              { key: 'model', label: 'Model' },
              { key: 'message', label: 'Details' },
              { key: 'when', label: 'Found' },
              { key: 'action', label: <span className="ds-visually-hidden">Action</span>, align: 'right' },
            ]}
            rows={issues.data.map((i) => ({
              id: i.id,
              kind: (
                <Badge variant="status" tone={i.severity === 'ERROR' ? 'negative' : 'neutral'} dot>
                  {ISSUE_LABELS[i.kind] ?? i.kind}
                </Badge>
              ),
              model: i.modelName ?? '—',
              message: <span style={{ whiteSpace: 'normal', display: 'block', maxWidth: '60ch' }}>{i.message}</span>,
              when: relativeTime(i.detectedAt),
              action: i.resolvedAt ? (
                <span className="pf-subtle pf-small">Resolved {relativeTime(i.resolvedAt)}</span>
              ) : (
                <Button variant="ghost" size="sm" disabled={busy === i.id} onClick={() => resolve(i)}>
                  Mark resolved
                </Button>
              ),
            }))}
          />
        </TableScroll>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------
interface Ops {
  metrics: { startedAt: string; uptimeSeconds: number; requests: number; serverErrors: number; availability: number; p95Ms: number; routes: { route: string; count: number; errors: number; p50Ms: number; p95Ms: number; maxMs: number }[] };
  runtime: { node: string; memoryMb: number; cache: 'redis' | 'memory'; cacheStats: { hits: number; misses: number }; jobs: 'queue' | 'inline' };
  database: { up: boolean; latencyMs: number };
  counts: { users: number; models: number; workloads: number; recommendations: number; portfolios: number; openIssues: number; unreadNotifications: number };
  lastIngestion: { status: string; startedAt: string; source: string } | null;
}

function uptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

export function OpsPanel() {
  const ops = useApi<Ops>('/admin/ops');
  if (ops.error) return <LoadError error={ops.error} onRetry={ops.reload} />;
  if (!ops.data) return <Loading what="Loading operations" />;
  const o = ops.data;
  const hitRate = o.runtime.cacheStats.hits + o.runtime.cacheStats.misses ? Math.round((o.runtime.cacheStats.hits / (o.runtime.cacheStats.hits + o.runtime.cacheStats.misses)) * 100) : null;
  return (
    <div className="pf-stack pf-stack--lg">
      <div className="pf-row pf-row--between">
        <p className="pf-subtle pf-small">Figures cover this API instance since it started.</p>
        <Button variant="ghost" size="sm" onClick={ops.reload}>
          Refresh
        </Button>
      </div>
      <div className="pf-kpis pf-reveal">
        <Kpi index={0} label="Uptime" value={uptime(o.metrics.uptimeSeconds)} meta={`since ${formatDate(o.metrics.startedAt)}`} />
        <Kpi index={1} label="Requests served" value={o.metrics.requests.toLocaleString('en-US')} meta={`${o.metrics.serverErrors} server errors`} />
        <Kpi index={2} label="p95 response" value={`${o.metrics.p95Ms} ms`} flag={<TargetFlag ok={o.metrics.p95Ms <= 2000}>target ≤ 2,000 ms</TargetFlag>} />
        <Kpi index={3} label="Availability" value={`${o.metrics.availability}%`} flag={<TargetFlag ok={o.metrics.availability >= 99}>target ≥ 99%</TargetFlag>} />
        <Kpi index={4} label="Database" value={o.database.up ? 'Up' : 'Down'} meta={`${o.database.latencyMs} ms round trip`} />
        <Kpi index={5} label="Cache" value={o.runtime.cache === 'redis' ? 'Redis' : 'In-memory'} meta={hitRate === null ? 'No reads yet' : `${hitRate}% hit rate`} />
      </div>
      <div className="pf-bento">
        <Card padding="lg" className="pf-span-8 pf-stack">
          <h2 className="pf-card-title">Endpoints</h2>
          <TableScroll label="Endpoint response times" stack fluid>
            <Table
              rowHeaders
              columns={[
                { key: 'route', label: 'Endpoint' },
                { key: 'count', label: 'Requests', align: 'right' },
                { key: 'p50', label: 'p50', align: 'right' },
                { key: 'p95', label: 'p95', align: 'right' },
                { key: 'max', label: 'Max', align: 'right' },
                { key: 'errors', label: 'Errors', align: 'right' },
              ]}
              rows={o.metrics.routes.map((r) => ({ id: r.route, route: <span className="pf-mono pf-small">{r.route}</span>, count: r.count, p50: `${r.p50Ms} ms`, p95: `${r.p95Ms} ms`, max: `${r.maxMs} ms`, errors: r.errors }))}
            />
          </TableScroll>
        </Card>
        <Card padding="lg" className="pf-span-4 pf-stack">
          <h2 className="pf-card-title">Platform</h2>
          <ul className="pf-list-reset pf-stack pf-stack--sm pf-small">
            {(
              [
                ['Users', o.counts.users],
                ['Models', o.counts.models],
                ['Workloads', o.counts.workloads],
                ['Recommendations', o.counts.recommendations],
                ['Saved portfolios', o.counts.portfolios],
                ['Open data issues', o.counts.openIssues],
                ['Unread alerts', o.counts.unreadNotifications],
                ['Background jobs', o.runtime.jobs === 'queue' ? 'Redis queue + worker' : 'In-process scheduler'],
                ['Runtime', `Node ${o.runtime.node} · ${o.runtime.memoryMb} MB`],
                ['Last ingestion', o.lastIngestion ? `${o.lastIngestion.source}, ${relativeTime(o.lastIngestion.startedAt)}` : 'Never'],
              ] as const
            ).map(([k, v]) => (
              <li key={k} className="pf-row pf-row--between">
                <span className="pf-subtle">{k}</span>
                <span className="pf-num pf-strong">{v}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Evaluation (proposal §6)
// ---------------------------------------------------------------------------
interface Evaluation {
  targets: { costCorrectness: number; budgetCompliance: number; freshness: number; responsivenessMs: number; availability: number; clarity: number };
  costCorrectness: { passed: number; total: number; rate: number | null; cases: { id: string; description: string; expected: string; actual: string; pass: boolean }[] };
  budgetCompliance: { recommendations: number; claimedWithinBudget: number; verified: number; rate: number | null };
  freshness: { available: number; fresh: number; rate: number | null; thresholdHours: number };
  responsiveness: { p95Ms: number; requests: number };
  availability: { rate: number; requests: number; serverErrors: number; uptimeSeconds: number };
  usability: { responses: number; averageClarity: number | null };
  pilot: {
    comparisons: { priorModel: string; priorCost: string; recommendedCost: string; savingPercent: number; priorCoversRequirements: boolean; missing: string[] }[];
    averageSavingPercent: number | null;
    priorChoicesMissingRequirements: number;
  };
}

export function EvaluationPanel() {
  const ev = useApi<Evaluation>('/admin/evaluation');
  if (ev.error) return <LoadError error={ev.error} onRetry={ev.reload} />;
  if (!ev.data) return <Loading what="Computing metrics" />;
  const e = ev.data;
  const t = e.targets;
  return (
    <div className="pf-stack pf-stack--lg">
      <p className="pf-subtle">Live measurements against the success criteria in the project proposal (§6). Cost correctness re-runs the hand-verified cases on every load.</p>
      <div className="pf-kpis pf-reveal">
        <Kpi index={0} label="Cost-calculation correctness (primary)" value={`${e.costCorrectness.passed} / ${e.costCorrectness.total}`} flag={<TargetFlag ok={e.costCorrectness.rate === t.costCorrectness}>target 100% match</TargetFlag>} />
        <Kpi
          index={1}
          label="Budget compliance"
          value={e.budgetCompliance.rate === null ? '–' : `${e.budgetCompliance.rate}%`}
          meta={`${e.budgetCompliance.verified} of ${e.budgetCompliance.claimedWithinBudget} in-budget recommendations verified`}
          flag={<TargetFlag ok={e.budgetCompliance.rate === null ? null : e.budgetCompliance.rate === t.budgetCompliance}>target 100%</TargetFlag>}
        />
        <Kpi index={2} label="Data freshness" value={e.freshness.rate === null ? '–' : `${e.freshness.rate}%`} meta={`${e.freshness.fresh} of ${e.freshness.available} verified within ${e.freshness.thresholdHours} h`} flag={<TargetFlag ok={e.freshness.rate === null ? null : e.freshness.rate === t.freshness}>target: within 24 h</TargetFlag>} />
        <Kpi index={3} label="API responsiveness (p95)" value={`${e.responsiveness.p95Ms} ms`} meta={`${e.responsiveness.requests.toLocaleString('en-US')} requests`} flag={<TargetFlag ok={e.responsiveness.p95Ms <= t.responsivenessMs}>target ≤ 2 s</TargetFlag>} />
        <Kpi index={4} label="Availability" value={`${e.availability.rate}%`} meta={`${e.availability.serverErrors} server errors`} flag={<TargetFlag ok={e.availability.rate >= t.availability}>target ≥ 99%</TargetFlag>} />
        <Kpi
          index={5}
          label="Usability (clarity)"
          value={e.usability.averageClarity === null ? '–' : `${e.usability.averageClarity} / 5`}
          meta={`${e.usability.responses} pilot ${e.usability.responses === 1 ? 'rating' : 'ratings'}`}
          flag={<TargetFlag ok={e.usability.averageClarity === null ? null : e.usability.averageClarity >= t.clarity}>target ≥ 4 / 5</TargetFlag>}
        />
      </div>

      <div className="pf-bento">
        <Card padding="lg" className="pf-span-7 pf-stack">
          <h2 className="pf-card-title">Hand-verified cost cases</h2>
          <TableScroll label="Golden cost cases" stack fluid>
            <Table
              rowHeaders
              columns={[
                { key: 'id', label: 'Case' },
                { key: 'description', label: 'Scenario' },
                { key: 'expected', label: 'Expected', align: 'right' },
                { key: 'actual', label: 'Computed', align: 'right' },
                { key: 'pass', label: 'Result' },
              ]}
              rows={e.costCorrectness.cases.map((c) => ({
                id: c.id,
                description: c.description,
                expected: <span className="pf-mono">${c.expected}</span>,
                actual: <span className="pf-mono">${c.actual}</span>,
                pass: <TargetFlag ok={c.pass}>{c.pass ? 'Match' : 'Mismatch'}</TargetFlag>,
              }))}
            />
          </TableScroll>
        </Card>
        <Card padding="lg" className="pf-span-5 pf-stack">
          <h2 className="pf-card-title">Pilot comparisons</h2>
          <p className="pf-subtle pf-small">Recommended portfolio vs the model each pilot user said they used before.</p>
          {e.pilot.comparisons.length === 0 ? (
            <p className="pf-subtle">No pilot responses with a prior model yet. Users can add one from the feedback card on a recommendation.</p>
          ) : (
            <>
              <div className="pf-row">
                <span className="pf-strong">Average saving {e.pilot.averageSavingPercent}%</span>
                <span className="pf-subtle pf-small">· {e.pilot.priorChoicesMissingRequirements} prior choices missed a required capability</span>
              </div>
              <TableScroll label="Pilot comparisons" stack fluid>
                <Table
                  columns={[
                    { key: 'prior', label: 'Prior model' },
                    { key: 'priorCost', label: 'Prior cost', align: 'right' },
                    { key: 'rec', label: 'Recommended', align: 'right' },
                    { key: 'saving', label: 'Saving', align: 'right' },
                  ]}
                  rows={e.pilot.comparisons.map((c, i) => ({
                    id: i,
                    prior: (
                      <span className="pf-stack pf-stack--none">
                        <span>{c.priorModel}</span>
                        {!c.priorCoversRequirements && <span className="pf-negative pf-small">Missing {c.missing.join(', ')}</span>}
                      </span>
                    ),
                    priorCost: `$${c.priorCost}`,
                    rec: `$${c.recommendedCost}`,
                    saving: <span className={c.savingPercent >= 0 ? 'pf-positive' : 'pf-negative'}>{c.savingPercent}%</span>,
                  }))}
                />
              </TableScroll>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
