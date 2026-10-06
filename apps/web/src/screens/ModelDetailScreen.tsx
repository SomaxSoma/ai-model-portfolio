import { Badge, Button, Card, Stat, Table, TextLink, TopicTag } from '@pf/design-system';
import { capabilityLabel, statusLabel } from '@pf/domain';
import { Link, useParams } from 'react-router';
import { LoadError, Loading, PageHead, TableScroll } from '../app/controls';
import { useApi } from '../app/useApi';
import { formatDate, formatPrice, formatTokens } from '../format';
import { MAX_COMPARE, usePlanner } from '../state/planner';
import type { ModelDetail } from '../types';

export function ModelDetailScreen() {
  const { id } = useParams();
  const { data: m, error, loading, reload } = useApi<ModelDetail>(`/models/${id}`);
  const { compare, toggleCompare } = usePlanner();

  if (loading && !m) return <Loading what="Loading model" />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  if (!m) return null;

  const selected = compare.includes(m.id);
  const full = !selected && compare.length >= MAX_COMPARE;

  // One table, newest first: a row per price change and per benchmark update.
  const history = [
    ...m.history.pricing.map((p, i) => ({ at: p.recordedAt, id: `p${i}`, kind: 'Price', input: formatPrice(p.inputPrice), output: formatPrice(p.outputPrice), coding: '—', reasoning: '—', source: p.source })),
    ...m.history.benchmarks.map((b, i) => ({ at: b.recordedAt, id: `b${i}`, kind: 'Benchmark', input: '—', output: '—', coding: String(b.codingScore), reasoning: String(b.reasoningScore), source: b.source })),
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

      <div className="pf-stats-row pf-stats-row--4">
        <Stat value={formatPrice(m.inputPrice)} label="Input price per 1M tokens" />
        <Stat value={formatPrice(m.outputPrice)} label="Output price per 1M tokens" />
        <Stat value={m.codingScore} label="Coding score (0–100)" />
        <Stat value={m.reasoningScore} label="Reasoning score (0–100)" />
      </div>

      <Card padding="lg" className="pf-stack">
        <h2>Capabilities</h2>
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
        <p className="pf-subtle">Overall score {m.overallScore} — the average of coding and reasoning.</p>
      </Card>

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
              { key: 'source', label: 'Source' },
            ]}
            rows={history}
          />
        </TableScroll>
      </section>
    </div>
  );
}
