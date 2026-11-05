import { Badge, Button, Table, TextLink, TopicTag } from '@pf/design-system';
import { capabilityLabel, daysUntil, statusLabel } from '@pf/domain';
import { Link, useParams } from 'react-router';
import { LoadError, Loading, PageHead, TableScroll } from '../app/controls';
import { PriceChart } from '../app/charts';
import { useApi } from '../app/useApi';
import { Kpi } from '../app/viz';
import { formatDate, formatPrice, formatTokens } from '../format';
import { MAX_COMPARE, usePlanner } from '../state/planner';
import type { ModelDetail } from '../types';

/** A value the source doesn't publish: quieter type than a real figure. */
function Missing({ children }: { children: string }) {
  return <span className="pf-kpi__missing">{children}</span>;
}

export function ModelDetailScreen() {
  const { id } = useParams();
  const { data: m, error, loading, reload } = useApi<ModelDetail>(`/models/${id}`);
  const { compare, toggleCompare } = usePlanner();

  if (loading && !m) return <Loading what="Loading model" />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  if (!m) return null;

  const selected = compare.includes(m.id);
  const full = !selected && compare.length >= MAX_COMPARE;

  const days = m.deprecationDate && m.status === 'ACTIVE' ? daysUntil(m.deprecationDate) : null;

  // One table, newest first: a row per price change and per benchmark update.
  const history = [
    ...m.history.pricing.map((p, i) => ({ at: p.recordedAt, id: `p${i}`, kind: 'Price', input: formatPrice(p.inputPrice), output: formatPrice(p.outputPrice), coding: '—', reasoning: '—', latency: '—', source: p.source })),
    ...m.history.benchmarks.map((b, i) => ({ at: b.recordedAt, id: `b${i}`, kind: 'Benchmark', input: '—', output: '—', coding: String(b.codingScore), reasoning: b.reasoningScore === null ? '—' : String(b.reasoningScore), latency: b.latencyMs === null ? '—' : `${b.latencyMs} ms`, source: b.source })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((r) => ({ ...r, date: formatDate(r.at) }));

  return (
    <div className="pf-stack pf-stack--lg">
      <div>
        <TextLink as={Link} to="/models" arrow={false} variant="muted">
          ← Back to catalogue
        </TextLink>
      </div>
      <PageHead
        overline={<TopicTag>{m.providerName}</TopicTag>}
        title={`${m.name} ${m.version}`}
        subtitle={`${statusLabel(m.status)} · ${formatTokens(m.contextWindow)} token context window`}
        actions={
          <Button variant={selected ? 'accent' : 'primary'} size="lg" aria-pressed={selected} disabled={full} onClick={() => toggleCompare(m.id)}>
            {selected ? '✓ In comparison' : 'Add to compare'}
          </Button>
        }
      />

      {m.status === 'RETIRED' && <p className="pf-negative">This model is retired. It stays in the catalogue for reference but is never recommended.</p>}

      <div className="pf-kpis pf-kpis--3 pf-reveal">
        <Kpi index={0} label="Input price / 1M tokens" value={formatPrice(m.inputPrice)} />
        <Kpi index={1} label="Output price / 1M tokens" value={formatPrice(m.outputPrice)} />
        <Kpi index={2} label="Coding · intelligence index" value={`${m.codingScore} · ${m.reasoningScore ?? '—'}`} meta={m.reasoningScore === null ? `Intelligence index not published · benchmark score ${m.overallScore}` : `Benchmark score ${m.overallScore} / 100`} />
        <Kpi index={3} label="Median latency" value={m.latencyMs === null ? <Missing>Not available</Missing> : `${m.latencyMs.toLocaleString('en-US')} ms`} meta={m.latencyMs === null ? 'Not published by the live source' : undefined} />
        <Kpi index={4} label="Uptime (best route, 24 h)" value={m.reliability === null ? <Missing>Not available</Missing> : `${m.reliability}%`} />
        <Kpi
          index={5}
          label="Lifecycle"
          value={m.status === 'RETIRED' ? 'Retired' : m.deprecationDate ? `Retires ${formatDate(m.deprecationDate)}` : <Missing>No retirement announced</Missing>}
          meta={days !== null && days >= 0 ? `${days} days from today` : `Figures verified ${formatDate(m.lastVerifiedAt)}`}
        />
      </div>

      <div className="pf-cells">
        <div className="pf-cell pf-span-8 pf-stack">
          <h3>Price history</h3>
          {m.history.pricing.length > 1 ? (
            <PriceChart title={`${m.name} price history`} data={[...m.history.pricing].reverse().map((p) => ({ label: formatDate(p.recordedAt), input: Number(p.inputPrice), output: Number(p.outputPrice) }))} />
          ) : (
            <p className="pf-subtle">
              {formatPrice(m.inputPrice)} in · {formatPrice(m.outputPrice)} out per 1M tokens since {formatDate(m.history.pricing[0]?.recordedAt ?? m.updatedAt)}. The chart appears after the first price change.
            </p>
          )}
        </div>
        <div className="pf-cell pf-cell--tint-a pf-span-4 pf-stack">
          <h3>Capabilities</h3>
          {m.capabilities.length ? (
            <div className="pf-chips">
              {m.capabilities.map((c) => (
                <Badge key={c} variant="topic">
                  {capabilityLabel(c)}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="pf-subtle">Text only.</p>
          )}
          <p className="pf-subtle pf-small">
            Benchmark score {m.overallScore}: {m.reasoningScore === null ? 'the coding index alone, as no intelligence index is published.' : 'the average of the coding and intelligence indices.'}
          </p>
          {m.externalId?.startsWith('openrouter:') && (
            <TextLink href={`https://openrouter.ai/${m.externalId.slice('openrouter:'.length)}`} target="_blank" rel="noreferrer">
              Source listing on OpenRouter
            </TextLink>
          )}
        </div>
      </div>

      <section className="pf-stack">
        <h2>History</h2>
        <TableScroll label="Price and benchmark history" stack fluid>
          <Table
            columns={[
              { key: 'date', label: 'Recorded' },
              { key: 'kind', label: 'Change' },
              { key: 'input', label: 'Input price', align: 'right' },
              { key: 'output', label: 'Output price', align: 'right' },
              { key: 'coding', label: 'Coding', align: 'right' },
              { key: 'reasoning', label: 'Reasoning', align: 'right' },
              { key: 'latency', label: 'Latency', align: 'right' },
              { key: 'source', label: 'Source' },
            ]}
            rows={history}
          />
        </TableScroll>
      </section>
    </div>
  );
}
