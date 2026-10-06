import { Card, Table, TextLink } from '@pf/design-system';
import { CAPABILITIES, statusLabel } from '@pf/domain';
import { Link } from 'react-router';
import { ButtonLink, LoadError, Loading, PageHead, TableScroll } from '../app/controls';
import { useApi } from '../app/useApi';
import { formatPrice, formatTokens } from '../format';
import { usePlanner } from '../state/planner';
import type { Model } from '../types';

export function CompareScreen() {
  const { compare, toggleCompare, clearCompare } = usePlanner();
  const { data: all, error, loading, reload } = useApi<Model[]>(compare.length >= 2 ? '/models' : null);

  if (compare.length < 2) {
    return (
      <>
        <PageHead title="Compare models" />
        <Card tint padding="lg" className="pf-empty">
          <h2>Pick at least two models</h2>
          <p className="pf-subtle">
            {compare.length === 1 ? 'You’ve picked one model. Add another from the catalogue to compare them side by side.' : 'Choose models in the catalogue with “Add to compare”, then come back here to see them side by side.'}
          </p>
          <ButtonLink to="/models">Go to catalogue</ButtonLink>
        </Card>
      </>
    );
  }

  if (loading && !all) return <Loading what="Loading comparison" />;
  if (error) return <LoadError error={error} onRetry={reload} />;
  const models = compare.map((id) => all?.find((m) => m.id === id)).filter((m): m is Model => !!m);

  const tick = (on: boolean) => (on ? <span aria-label="Yes">✓</span> : <span aria-label="No" className="pf-subtle">—</span>);
  const best = (pick: (m: Model) => number, higherIsBetter: boolean) => {
    const vals = models.map(pick);
    return higherIsBetter ? Math.max(...vals) : Math.min(...vals);
  };
  const lowIn = best((m) => Number(m.inputPrice), false);
  const lowOut = best((m) => Number(m.outputPrice), false);
  const topOverall = best((m) => m.overallScore, true);
  const mark = (on: boolean, text: string) => (on ? <strong>{text}</strong> : text);

  const row = (id: string, label: string, cell: (m: Model) => unknown) => ({
    id,
    attribute: label,
    ...Object.fromEntries(models.map((m) => [`m${m.id}`, cell(m)])),
  });

  const rows = [
    row('provider', 'Provider', (m) => m.providerName),
    row('version', 'Version', (m) => m.version || '—'),
    row('input', 'Input price / 1M', (m) => mark(Number(m.inputPrice) === lowIn, formatPrice(m.inputPrice))),
    row('output', 'Output price / 1M', (m) => mark(Number(m.outputPrice) === lowOut, formatPrice(m.outputPrice))),
    row('context', 'Context window', (m) => `${formatTokens(m.contextWindow)} tokens`),
    row('coding', 'Coding score', (m) => m.codingScore),
    row('reasoning', 'Reasoning score', (m) => m.reasoningScore),
    row('overall', 'Overall score', (m) => mark(m.overallScore === topOverall, String(m.overallScore))),
    row('status', 'Status', (m) => <span className={m.status === 'RETIRED' ? 'pf-negative' : undefined}>{statusLabel(m.status)}</span>),
    ...CAPABILITIES.map((c) => row(`cap-${c.key}`, c.label, (m) => tick(m.capabilities.includes(c.key)))),
  ];

  return (
    <>
      <PageHead
        title="Compare models"
        subtitle="Bold marks the lowest price and the highest overall score. Prices per 1M tokens."
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
                <span className="pf-stack pf-stack--sm">
                  <Link to={`/models/${m.id}`}>{m.name}</Link>
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
    </>
  );
}
