import { Badge, Button, Card, FilterChip, SearchInput, Stat, TextLink, TopicTag } from '@pf/design-system';
import { CAPABILITIES, statusLabel } from '@pf/domain';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { LoadError, Loading, PageHead } from '../app/controls';
import { useApi } from '../app/useApi';
import { formatPrice, formatTokens } from '../format';
import { MAX_COMPARE, usePlanner } from '../state/planner';
import type { Model } from '../types';

export function ModelsScreen() {
  const { data: models, error, loading, reload } = useApi<Model[]>('/models');
  const { compare, toggleCompare } = usePlanner();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [caps, setCaps] = useState<string[]>([]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (models ?? []).filter(
      (m) =>
        caps.every((c) => m.capabilities.includes(c)) &&
        (!q || `${m.name} ${m.providerName} ${m.version}`.toLowerCase().includes(q)),
    );
  }, [models, search, caps]);

  const toggleCap = (key: string) => setCaps((c) => (c.includes(key) ? c.filter((x) => x !== key) : [...c, key]));
  const clearFilters = () => {
    setSearch('');
    setCaps([]);
  };

  const available = (models ?? []).filter((m) => m.status === 'ACTIVE');
  const cheapest = available.reduce<Model | null>((a, m) => (!a || Number(m.inputPrice) < Number(a.inputPrice) ? m : a), null);
  const best = available.reduce<Model | null>((a, m) => (!a || m.overallScore > a.overallScore ? m : a), null);
  const largest = available.reduce<Model | null>((a, m) => (!a || m.contextWindow > a.contextWindow ? m : a), null);

  return (
    <>
      <PageHead
        title="Model catalogue"
        subtitle={models ? `${visible.length} of ${models.length} models · prices per 1M tokens` : 'Prices per 1M tokens'}
        actions={
          <>
            <SearchInput className="pf-search" value={search} onChange={setSearch} label="Search models" placeholder="Search models or providers" />
            <Button variant="primary" size="lg" disabled={compare.length < 2} onClick={() => navigate('/compare')} title={compare.length < 2 ? 'Select at least two models to compare' : undefined}>
              Compare ({compare.length})
            </Button>
          </>
        }
      />

      <div className="pf-stack pf-stack--lg">
        <div className="pf-chips" role="group" aria-label="Filter by capability">
          {CAPABILITIES.map((c) => (
            <FilterChip key={c.key} active={caps.includes(c.key)} onClick={() => toggleCap(c.key)}>
              {c.label}
            </FilterChip>
          ))}
        </div>

        {loading && !models && <Loading what="Loading models" />}
        {error && <LoadError error={error} onRetry={reload} />}

        {models && visible.length === 0 && (
          <Card tint padding="lg" className="pf-empty">
            <h2>No models match</h2>
            <p className="pf-subtle">Try a different search or fewer capabilities.</p>
            <TextLink as="button" arrow={false} onClick={clearFilters}>
              Clear filters
            </TextLink>
          </Card>
        )}

        {visible.length > 0 && (
          <ul className="pf-model-grid pf-list-reset">
            {visible.map((m) => {
              const selected = compare.includes(m.id);
              const full = !selected && compare.length >= MAX_COMPARE;
              return (
                <li key={m.id}>
                  <Card padding="md" className={`pf-model-card${selected ? ' pf-model-card--selected' : ''}`}>
                    <div className="pf-model-card__title">
                      <div className="pf-row pf-row--between">
                        <TopicTag>{m.providerName}</TopicTag>
                        {m.status === 'RETIRED' && (
                          <Badge variant="status" tone="negative" dot>
                            {statusLabel(m.status)}
                          </Badge>
                        )}
                      </div>
                      <span className="pf-model-card__name">
                        {m.name} <span className="pf-subtle">{m.version}</span>
                      </span>
                    </div>
                    <div className="pf-stat-grid">
                      <Stat size="sm" value={formatPrice(m.inputPrice)} label="Input price" />
                      <Stat size="sm" value={formatPrice(m.outputPrice)} label="Output price" />
                      <Stat size="sm" value={m.codingScore} label="Coding score" />
                      <Stat size="sm" value={m.reasoningScore} label="Reasoning score" />
                    </div>
                    <p className="pf-subtle">{formatTokens(m.contextWindow)} token context window</p>
                    <div className="pf-model-card__actions">
                      <TextLink as={Link} to={`/models/${m.id}`} arrow={false} aria-label={`Details for ${m.name}`}>
                        Details
                      </TextLink>
                      <Button
                        variant={selected ? 'accent' : 'ghost'}
                        size="sm"
                        aria-pressed={selected}
                        disabled={full}
                        title={full ? `You can compare up to ${MAX_COMPARE} models` : undefined}
                        onClick={() => toggleCompare(m.id)}
                      >
                        {selected ? '✓ In comparison' : 'Add to compare'}
                      </Button>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}

        {models && available.length > 0 && (
          <div className="pf-stats-row" aria-label="Catalogue summary">
            <Stat value={available.length} label="Models available to recommend" />
            {cheapest && <Stat value={formatPrice(cheapest.inputPrice)} label={`Lowest input price · ${cheapest.name}`} />}
            {best && <Stat value={best.overallScore} label={`Highest overall score · ${best.name}`} />}
            {!best && largest && <Stat value={formatTokens(largest.contextWindow)} label="Largest context window" />}
          </div>
        )}
      </div>
    </>
  );
}
