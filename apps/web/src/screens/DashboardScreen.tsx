import { Card, SegmentedNav, Select, Stat, Table, TextLink } from '@pf/design-system';
import { formatUsd } from '@pf/domain';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { CostQualityScatter, PriceChart } from '../app/charts';
import { ButtonLink, LoadError, Loading, TableScroll } from '../app/controls';
import { NotificationRow } from '../app/NotificationBell';
import { useApi } from '../app/useApi';
import { CountUp, Kpi, Meter, ShareBar, TargetFlag, useProviderPalette } from '../app/viz';
import { formatDate } from '../format';
import { useSession } from '../state/session';
import { ModelGalaxy, Scene3D, type GalaxyPoint } from '../three';
import type { CostQuality, NotificationPage, Overview, Workload } from '../types';

export function DashboardScreen() {
  const { user } = useSession();
  const navigate = useNavigate();
  const overview = useApi<Overview>('/analytics/overview');
  const workloads = useApi<Workload[]>('/workloads');
  const [workloadId, setWorkloadId] = useState('');
  const cq = useApi<CostQuality>(`/analytics/cost-quality${workloadId ? `?workloadId=${workloadId}` : ''}`);
  const notes = useApi<NotificationPage>('/notifications?limit=4');
  const colorFor = useProviderPalette();
  const [view, setView] = useState('3d');

  const galaxy: GalaxyPoint[] = useMemo(
    () =>
      (cq.data?.points ?? []).map((p) => ({
        id: p.modelId,
        name: p.name,
        provider: p.provider,
        cost: Number(p.monthlyCost),
        overall: p.overallScore,
        latencyMs: p.latencyMs,
        eligible: p.eligible,
        color: colorFor(p.provider),
      })),
    [cq.data, colorFor],
  );

  if (overview.error) return <LoadError error={overview.error} onRetry={overview.reload} />;
  const o = overview.data;
  const freshPct = o && o.freshness.available ? Math.round((o.freshness.fresh / o.freshness.available) * 100) : null;
  const volumeNote = cq.data?.workload
    ? `Monthly cost for “${cq.data.workload.name}”. Dimmed models don’t meet its requirements.`
    : 'Monthly cost for 1,000 requests of 1K input + 1K output tokens.';

  return (
    <div className="pf-stack pf-stack--lg">
      <section className="pf-hero">
        <div>
          <span className="pf-eyebrow">Portfolio intelligence</span>
          <h1 className="pf-hero__title" style={{ marginTop: 'var(--sp-4)' }}>
            Hi {user?.name.split(' ')[0]}, <span className="pf-gradient-text">spend smarter</span> across every model.
          </h1>
          <p className="pf-hero__lead">Compare price, quality and latency in one view, then let the engine split your workload across the models that fit your budget.</p>
          <div className="pf-row" style={{ marginTop: 'var(--sp-6)' }}>
            <ButtonLink to="/workload">Plan a workload</ButtonLink>
            <ButtonLink to="/models" variant="ghost">
              Browse catalogue
            </ButtonLink>
          </div>
        </div>
        <Card padding="none" className="pf-galaxy">
          <Scene3D className="pf-galaxy" fallback={<div className="pf-scene-fallback" />}>
            {galaxy.length > 0 && <ModelGalaxy points={galaxy} onSelect={(id) => navigate(`/models/${id}`)} />}
          </Scene3D>
          <span className="pf-galaxy__hint">drag to orbit · click a model</span>
        </Card>
      </section>

      {!o ? (
        <Loading what="Loading your dashboard" />
      ) : (
        <>
          <div className="pf-kpis pf-reveal">
            <Kpi index={0} label="Models available" value={<CountUp value={o.catalogue.available} />} meta={`${o.catalogue.providers} providers · ${o.catalogue.models} in catalogue`} />
            <Kpi index={1} label="Avg input price / 1M" value={<CountUp value={Number(o.catalogue.avgInputPrice)} format={(n) => formatUsd(n)} />} meta={`Output ${formatUsd(o.catalogue.avgOutputPrice)} / 1M`} />
            <Kpi
              index={2}
              label="Your monthly spend"
              value={<CountUp value={Number(o.portfolios.totalMonthlyCost)} format={(n) => formatUsd(n)} />}
              meta={`${o.portfolios.count} saved ${o.portfolios.count === 1 ? 'portfolio' : 'portfolios'} · budget ${formatUsd(o.portfolios.totalBudget)}`}
              flag={o.portfolios.count ? <TargetFlag ok={o.portfolios.overBudget === 0}>{o.portfolios.overBudget ? `${o.portfolios.overBudget} over budget` : 'All within budget'}</TargetFlag> : undefined}
            />
            <Kpi
              index={3}
              label="Data freshness"
              value={freshPct === null ? '–' : <CountUp value={freshPct} format={(n) => `${Math.round(n)}%`} />}
              meta={`Verified within ${o.freshness.thresholdHours} h`}
              flag={freshPct === null ? undefined : <TargetFlag ok={freshPct === 100}>{freshPct === 100 ? 'All figures fresh' : `${o.freshness.available - o.freshness.fresh} stale`}</TargetFlag>}
            />
          </div>

          <div className="pf-bento">
            <Card padding="lg" className="pf-span-7 pf-stack">
              <div className="pf-section-head">
                <div>
                  <h2 className="pf-card-title">Cost vs quality</h2>
                  <p className="pf-subtle pf-small">{volumeNote}</p>
                </div>
                <SegmentedNav label="Chart view" active={view} onChange={setView} items={[{ key: '3d', label: 'Chart' }, { key: 'table', label: 'Table' }]} />
              </div>
              {workloads.data && workloads.data.length > 0 && (
                <Select
                  label="Volume"
                  value={workloadId}
                  onChange={setWorkloadId}
                  options={[{ value: '', label: 'Reference volume' }, ...workloads.data.map((w) => ({ value: String(w.id), label: w.name }))]}
                />
              )}
              {cq.data &&
                (view === '3d' ? (
                  <CostQualityScatter
                    onSelect={(id) => navigate(`/models/${id}`)}
                    points={cq.data.points.map((p) => ({ id: p.modelId, name: p.name, provider: p.provider, cost: Number(p.monthlyCost), overall: p.overallScore, color: colorFor(p.provider), eligible: p.eligible }))}
                  />
                ) : (
                  <TableScroll label="Cost vs quality" stack fluid>
                    <Table
                      rowHeaders
                      columns={[
                        { key: 'name', label: 'Model' },
                        { key: 'provider', label: 'Provider' },
                        { key: 'cost', label: 'Monthly cost', align: 'right' },
                        { key: 'score', label: 'Overall', align: 'right' },
                        { key: 'latency', label: 'Latency', align: 'right' },
                      ]}
                      rows={[...cq.data.points]
                        .sort((a, b) => Number(a.monthlyCost) - Number(b.monthlyCost))
                        .map((p) => ({ id: p.modelId, name: <Link to={`/models/${p.modelId}`}>{p.name}</Link>, provider: p.provider, cost: formatUsd(p.monthlyCost), score: p.overallScore, latency: p.latencyMs === null ? 'Not available' : `${p.latencyMs} ms` }))}
                    />
                  </TableScroll>
                ))}
            </Card>

            <Card padding="lg" className="pf-span-5 pf-stack">
              <h2 className="pf-card-title">Catalogue price index</h2>
              <p className="pf-subtle pf-small">Average list price across models after each price change, per 1M tokens.</p>
              {o.priceIndex.length > 1 ? (
                <PriceChart title="Catalogue price index" data={o.priceIndex.map((p) => ({ label: formatDate(p.date), input: Number(p.avgInputPrice), output: Number(p.avgOutputPrice) }))} />
              ) : (
                // One data point is not a trend: show the level, not a lonely dot.
                <div className="pf-stack">
                  <div className="pf-stats-row">
                    <Stat value={formatUsd(o.catalogue.avgInputPrice)} label="Average input price / 1M" />
                    <Stat value={formatUsd(o.catalogue.avgOutputPrice)} label="Average output price / 1M" />
                  </div>
                  <p className="pf-subtle pf-small">
                    {o.priceIndex.length ? `All prices date from ${formatDate(o.priceIndex[0]!.date)}. The trend appears after the first price change.` : 'No price history yet.'}
                  </p>
                </div>
              )}
            </Card>

            <Card padding="lg" className="pf-span-7 pf-stack">
              <div className="pf-section-head">
                <h2 className="pf-card-title">Your portfolios</h2>
                <TextLink as={Link} to="/portfolio?saved">
                  All portfolios
                </TextLink>
              </div>
              {o.portfolios.items.length === 0 ? (
                <div className="pf-empty">
                  <p className="pf-subtle">No saved portfolios yet. Define a workload to get a recommendation you can save.</p>
                  <ButtonLink to="/workload" variant="ghost">
                    Define a workload
                  </ButtonLink>
                </div>
              ) : (
                <ul className="pf-list-reset pf-stack">
                  {o.portfolios.items.map((p) => (
                    <li key={p.id} className="pf-stack pf-stack--sm">
                      <div className="pf-row pf-row--between">
                        <Link to={`/portfolios/${p.id}`} className="pf-strong">
                          {p.name}
                        </Link>
                        <span className={`pf-num pf-small ${p.withinBudget ? '' : 'pf-negative'}`}>
                          {formatUsd(p.estimatedCost)} <span className="pf-subtle">/ {formatUsd(p.budget)}</span>
                          {!p.withinBudget && ' · over budget'}
                        </span>
                      </div>
                      <Meter value={Number(p.estimatedCost)} max={Number(p.budget)} label={`${p.name}: monthly cost against budget`} />
                    </li>
                  ))}
                </ul>
              )}
              {o.portfolios.providerExposure.length > 0 && (
                <>
                  <hr className="pf-divider" />
                  <ShareBar label="Your spend by provider" parts={o.portfolios.providerExposure.map((p) => ({ key: p.provider, label: p.provider, share: p.costShare, color: colorFor(p.provider) }))} />
                </>
              )}
            </Card>

            <Card padding="lg" className="pf-span-5 pf-stack">
              <div className="pf-section-head">
                <h2 className="pf-card-title">Recent alerts</h2>
                <TextLink as={Link} to="/notifications">
                  View all
                </TextLink>
              </div>
              {notes.data && notes.data.items.length === 0 && <p className="pf-subtle">No alerts. We’ll flag price changes, budget breaches and retirements that affect your portfolios.</p>}
              <ul className="pf-notes">
                {notes.data?.items.map((n) => (
                  <li key={n.id}>
                    <NotificationRow n={n} onOpen={() => {}} />
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
