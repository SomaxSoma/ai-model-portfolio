import { Badge, Button, Card, FilterChip, SearchInput, Select, Stat, TextLink, TopicTag } from '@pf/design-system';
import { CAPABILITIES, daysUntil, RISK_THRESHOLDS, statusLabel } from '@pf/domain';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { LoadError, Loading, PageHead } from '../app/controls';
import { useApi } from '../app/useApi';
import { formatPrice, formatTokens } from '../format';
import { MAX_COMPARE, usePlanner } from '../state/planner';
import type { Model } from '../types';

const PAGE = 24;

const SORTS: { value: string; label: string; by: (a: Model, b: Model) => number }[] = [
  { value: 'quality', label: 'Highest quality', by: (a, b) => b.overallScore - a.overallScore || Number(a.inputPrice) - Number(b.inputPrice) },
  { value: 'price', label: 'Lowest input price', by: (a, b) => Number(a.inputPrice) - Number(b.inputPrice) || b.overallScore - a.overallScore },
  { value: 'value', label: 'Best value (quality per $)', by: (a, b) => valueOf(b) - valueOf(a) },
  { value: 'context', label: 'Largest context', by: (a, b) => b.contextWindow - a.contextWindow },
  { value: 'name', label: 'Name', by: (a, b) => a.name.localeCompare(b.name) },
];

/** Quality points per dollar of a 1K-in / 1K-out request mix (higher is better value). */
function valueOf(m: Model): number {
  const blended = Number(m.inputPrice) + Number(m.outputPrice);
  return blended > 0 ? m.overallScore / blended : m.overallScore;
}

function Score({ value, label }: { value: number | null; label: string }) {
  return <Stat size="sm" value={value === null ? <span className="pf-subtle" title="Not published by the benchmark source">—</span> : value} label={label} />;
}

export function ModelsScreen() {
  const { data: models, error, loading, reload } = useApi<Model[]>('/models');
  const { compare, toggleCompare } = usePlanner();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [caps, setCaps] = useState<string[]>([]);
  const [sort, setSort] = useState('quality');
  const [showRetired, setShowRetired] = useState(false);
  const [shown, setShown] = useState(PAGE);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const by = SORTS.find((s) => s.value === sort)!.by;
    return (models ?? [])
      .filter(
        (m) =>
          (showRetired || m.status === 'ACTIVE') &&
          caps.every((c) => m.capabilities.includes(c)) &&
          (!q || `${m.name} ${m.providerName} ${m.version}`.toLowerCase().includes(q)),
      )
      .sort(by);
  }, [models, search, caps, sort, showRetired]);

  const toggleCap = (key: string) => {
    setCaps((c) => (c.includes(key) ? c.filter((x) => x !== key) : [...c, key]));
    setShown(PAGE);
  };
  const clearFilters = () => {
    setSearch('');
    setCaps([]);
    setShown(PAGE);
  };

  const available = (models ?? []).filter((m) => m.status === 'ACTIVE');
  const retiredCount = (models?.length ?? 0) - available.length;
  const providers = new Set(available.map((m) => m.providerName)).size;
  const qMax = Math.max(1, ...available.map((m) => m.overallScore));

  return (
    <>
      <PageHead
        overline={<span className="pf-eyebrow">Live catalogue</span>}
        title="Every model, side by side"
        subtitle={models ? `${visible.length} of ${available.length} available models from ${providers} providers · prices per 1M tokens · coding and intelligence indices by Artificial Analysis` : 'Prices per 1M tokens'}
        actions={
          <>
            <SearchInput
              className="pf-search"
              value={search}
              onChange={(v) => {
                setSearch(v);
                setShown(PAGE);
              }}
              label="Search models"
              placeholder="Search models or providers"
            />
            <Button variant="primary" size="lg" disabled={compare.length < 2} onClick={() => navigate('/compare')} title={compare.length < 2 ? 'Select at least two models to compare' : undefined}>
              Compare ({compare.length})
            </Button>
          </>
        }
      />

      <div className="pf-stack pf-stack--lg">
        <div className="pf-row pf-row--between">
          <div className="pf-chips" role="group" aria-label="Filter by capability">
            {CAPABILITIES.map((c) => (
              <FilterChip key={c.key} active={caps.includes(c.key)} onClick={() => toggleCap(c.key)}>
                {c.label}
              </FilterChip>
            ))}
            {retiredCount > 0 && (
              <FilterChip active={showRetired} onClick={() => setShowRetired((s) => !s)}>
                Include retired ({retiredCount})
              </FilterChip>
            )}
          </div>
          <Select label="Sort by" hideLabel value={sort} onChange={setSort} options={SORTS.map((s) => ({ value: s.value, label: `Sort: ${s.label}` }))} />
        </div>

        {loading && !models && <Loading what="Loading the live catalogue" />}
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
          <ul className="pf-model-grid pf-list-reset pf-reveal">
            {visible.slice(0, shown).map((m, i) => {
              const selected = compare.includes(m.id);
              const full = !selected && compare.length >= MAX_COMPARE;
              const days = m.deprecationDate && m.status === 'ACTIVE' ? daysUntil(m.deprecationDate) : null;
              return (
                <li key={m.id} style={{ ['--i' as string]: i % PAGE }}>
                  <Card padding="md" className={`pf-model-card pf-hover-card${selected ? ' pf-model-card--selected' : ''}`}>
                    <div className="pf-model-card__title">
                      <div className="pf-row pf-row--between">
                        <TopicTag>{m.providerName}</TopicTag>
                        {m.status === 'RETIRED' ? (
                          <Badge variant="status" tone="negative" dot>
                            {statusLabel(m.status)}
                          </Badge>
                        ) : days !== null && days <= RISK_THRESHOLDS.deprecationWarningDays ? (
                          <Badge variant="status" tone="negative" dot>
                            Retires in {days} {days === 1 ? 'day' : 'days'}
                          </Badge>
                        ) : null}
                      </div>
                      <span className="pf-model-card__name">
                        {m.name} {m.version && <span className="pf-subtle">{m.version}</span>}
                      </span>
                    </div>
                    <div className="pf-stat-grid">
                      <Stat size="sm" value={formatPrice(m.inputPrice)} label="Input price" />
                      <Stat size="sm" value={formatPrice(m.outputPrice)} label="Output price" />
                      <Score value={m.codingScore} label="Coding index" />
                      <Score value={m.reasoningScore} label="Intelligence index" />
                    </div>
                    <div className="pf-qbar" role="meter" aria-label={`Quality ${m.overallScore} of ${qMax} in this catalogue`} aria-valuemin={0} aria-valuemax={qMax} aria-valuenow={m.overallScore}>
                      <span style={{ width: `${(m.overallScore / qMax) * 100}%`, ['--full' as string]: `${(qMax / Math.max(1, m.overallScore)) * 100}%` }} />
                    </div>
                    <div className="pf-model-card__meta">
                      <span>{formatTokens(m.contextWindow)} context</span>
                      <span>{m.reliability === null ? 'uptime n/a' : `${m.reliability}% uptime (24 h)`}</span>
                    </div>
                    <div className="pf-model-card__actions">
                      <TextLink as={Link} to={`/models/${m.id}`} arrow={false} aria-label={`Details for ${m.name}`}>
                        Details
                      </TextLink>
                      <Button variant={selected ? 'accent' : 'ghost'} size="sm" aria-pressed={selected} disabled={full} title={full ? `You can compare up to ${MAX_COMPARE} models` : undefined} onClick={() => toggleCompare(m.id)}>
                        {selected ? '✓ In comparison' : 'Add to compare'}
                      </Button>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}

        {visible.length > shown && (
          <div className="pf-row" style={{ justifyContent: 'center' }}>
            <Button variant="ghost" onClick={() => setShown((s) => s + PAGE)}>
              Show {Math.min(PAGE, visible.length - shown)} more · {visible.length - shown} left
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
