import { Card, Table, TextLink } from '@pf/design-system';
import { CAPABILITIES, capabilityLabel, formatUsd, monthlyCost, statusLabel } from '@pf/domain';
import { useEffect, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ButtonLink, LoadError, Loading, PageHead, TableScroll } from '../app/controls';
import { useApi } from '../app/useApi';
import { formatDate, formatListPrice, formatTokens } from '../format';
import { cleanCompareIds, usePlanner } from '../state/planner';
import type { Model } from '../types';

/** Parses "?ids=3,7,12" — the shareable form of a comparison. */
function idsFromUrl(params: URLSearchParams): number[] | null {
  const raw = params.get('ids');
  return raw === null ? null : cleanCompareIds(raw.split(','));
}

export function CompareScreen() {
  const { compare, toggleCompare, setCompare, clearCompare, draft } = usePlanner();
  const [params, setParams] = useSearchParams();
  const urlIds = idsFromUrl(params);

  // A shared link wins over what this browser remembers; afterwards the URL follows the selection.
  useEffect(() => {
    if (urlIds && urlIds.join(',') !== compare.join(',')) setCompare(urlIds);
    // Only on arrival: later changes flow from the selection to the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const want = compare.join(',');
    if ((params.get('ids') ?? '') !== want) setParams(want ? { ids: want } : {}, { replace: true });
  }, [compare, params, setParams]);

  const ids = urlIds && urlIds.join(',') !== compare.join(',') && compare.length === 0 ? urlIds : compare;
  const { data: all, error, loading, reload } = useApi<Model[]>(ids.length >= 2 ? '/models' : null);

  if (ids.length < 2) {
    return (
      <>
        <PageHead title="Compare models" />
        <Card tint padding="lg" className="pf-empty">
          <h2>Pick at least two models</h2>
          <p className="pf-subtle">
            {ids.length === 1 ? 'You’ve picked one model. Add another from the catalogue to compare them side by side.' : 'Choose models in the catalogue with “Add to compare”, then come back here to see them side by side.'}
          </p>
          <ButtonLink to="/models">Go to catalogue</ButtonLink>
        </Card>
      </>
    );
  }

  if (loading && !all) return <Loading what="Loading comparison" />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  const models = ids.map((id) => all?.find((m) => m.id === id)).filter((m): m is Model => !!m);

  const best = (pick: (m: Model) => number, higherIsBetter: boolean) => {
    const vals = models.map(pick);
    return higherIsBetter ? Math.max(...vals) : Math.min(...vals);
  };
  const lowIn = best((m) => Number(m.inputPrice), false);
  const lowOut = best((m) => Number(m.outputPrice), false);
  const topOverall = best((m) => m.overallScore, true);
  const latencies = models.map((m) => m.latencyMs).filter((v): v is number => v !== null);
  const fastest = latencies.length ? Math.min(...latencies) : null;
  const mark = (on: boolean, text: string) => (on ? <strong>{text}</strong> : text);
  const missing = (text: string) => <span className="pf-subtle">{text}</span>;

  // The user's own workload (from the workload form), priced with the one cost function.
  const volume = { inputTokens: Number(draft.inputTokens) || 0, outputTokens: Number(draft.outputTokens) || 0, requestsPerMonth: Number(draft.requestsPerMonth) || 0 };
  const hasVolume = volume.inputTokens > 0 && volume.outputTokens > 0 && volume.requestsPerMonth > 0;
  const costs = models.map((m) => monthlyCost(m, volume));
  const cheapest = costs.length ? costs.reduce((a, b) => (b.lt(a) ? b : a)) : null;

  type Row = { id: string; attribute: ReactNode } & Record<string, ReactNode>;
  const row = (id: string, label: ReactNode, cell: (m: Model, i: number) => ReactNode): Row => ({
    id,
    attribute: label,
    ...Object.fromEntries(models.map((m, i) => [`m${m.id}`, cell(m, i)])),
  });

  const rows: Row[] = [
    row('provider', 'Provider', (m) => m.providerName),
    // Hidden when no model has a version: a row of dashes says nothing.
    ...(models.some((m) => m.version) ? [row('version', 'Version', (m) => m.version || '—')] : []),
    ...(hasVolume
      ? [
          row(
            'workload',
            <span>
              Monthly cost for your workload
              <span className="pf-subtle pf-small" style={{ display: 'block', fontWeight: 400 }}>
                {volume.requestsPerMonth.toLocaleString('en-US')} requests × {volume.inputTokens.toLocaleString('en-US')} in / {volume.outputTokens.toLocaleString('en-US')} out tokens
              </span>
            </span>,
            (_m, i) => mark(!!cheapest && costs[i]!.eq(cheapest), formatUsd(costs[i]!)),
          ),
        ]
      : []),
    row('input', 'Input price / 1M', (m) => mark(Number(m.inputPrice) === lowIn, formatListPrice(m.inputPrice))),
    row('output', 'Output price / 1M', (m) => mark(Number(m.outputPrice) === lowOut, formatListPrice(m.outputPrice))),
    row('context', 'Context window', (m) => `${formatTokens(m.contextWindow)} tokens`),
    row('overall', 'Benchmark score', (m) => mark(m.overallScore === topOverall, String(m.overallScore))),
    row('coding', 'Coding index (AA)', (m) => m.codingScore),
    row('reasoning', 'Intelligence index (AA)', (m) => (m.reasoningScore === null ? missing('Not published') : m.reasoningScore)),
    ...(latencies.length ? [row('latency', 'Median latency', (m) => (m.latencyMs === null ? missing('Not available') : mark(m.latencyMs === fastest, `${m.latencyMs.toLocaleString('en-US')} ms`)))] : []),
    ...(models.some((m) => m.reliability !== null) ? [row('reliability', 'Uptime (24 h, best route)', (m) => (m.reliability === null ? missing('Not available') : `${m.reliability}%`))] : []),
    row('status', 'Status', (m) => <span className={m.status === 'RETIRED' ? 'pf-negative' : undefined}>{statusLabel(m.status)}</span>),
    row('retires', 'Retirement', (m) => (m.deprecationDate ? formatDate(m.deprecationDate) : missing('None announced'))),
  ];

  // Capabilities: only the ones that differ get a row; shared ones are summarised below the table.
  const differing = CAPABILITIES.filter((c) => new Set(models.map((m) => m.capabilities.includes(c.key))).size > 1);
  const allHave = CAPABILITIES.filter((c) => models.every((m) => m.capabilities.includes(c.key))).map((c) => capabilityLabel(c.key));
  const noneHave = CAPABILITIES.filter((c) => models.every((m) => !m.capabilities.includes(c.key))).map((c) => capabilityLabel(c.key));
  for (const c of differing) rows.push(row(`cap-${c.key}`, c.label, (m) => (m.capabilities.includes(c.key) ? <span aria-label="Yes">✓</span> : <span aria-label="No" className="pf-subtle">—</span>)));

  return (
    <>
      <PageHead
        title="Compare models"
        subtitle="Bold marks the best value in each row. Prices per 1M tokens. The benchmark score is the coding index, averaged with the intelligence index where it’s published."
        actions={
          <TextLink as="button" arrow={false} onClick={clearCompare}>
            Clear comparison
          </TextLink>
        }
      />
      <TableScroll label="Model comparison">
        <Table
          rowHeaders
          columns={[
            { key: 'attribute', label: <span className="ds-visually-hidden">Attribute</span> },
            ...models.map((m) => ({
              key: `m${m.id}`,
              label: (
                <span className="pf-compare__head">
                  <Link to={`/models/${m.id}`} className="pf-compare__name">
                    {m.name}
                  </Link>
                  <TextLink as="button" arrow={false} variant="muted" onClick={() => toggleCompare(m.id)} aria-label={`Remove ${m.name} from comparison`}>
                    Remove
                  </TextLink>
                </span>
              ),
            })),
          ]}
          rows={rows}
        />
      </TableScroll>
      {(allHave.length > 0 || noneHave.length > 0) && (
        <p className="pf-subtle pf-small" style={{ marginTop: 'var(--sp-3)' }}>
          {allHave.length > 0 && <>All of these support {allHave.join(', ')}. </>}
          {noneHave.length > 0 && <>None support {noneHave.join(', ')}.</>}
        </p>
      )}
      {!hasVolume && (
        <p className="pf-subtle pf-small">
          <Link to="/workload">Describe your workload</Link> to see what each model would cost you a month.
        </p>
      )}
    </>
  );
}
