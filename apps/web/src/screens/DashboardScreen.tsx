import { SegmentedNav, Select, Table, TextLink } from '@pf/design-system';
import { formatUsd } from '@pf/domain';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { CostQualityScatter, PriceChart } from '../app/charts';
import { ButtonLink, LoadError, Loading, TableScroll } from '../app/controls';
import { NotificationRow, relativeTime } from '../app/NotificationBell';
import { useApi } from '../app/useApi';
import { CountUp, Kpi, Meter, ShareBar, TargetFlag } from '../app/viz';
import { WorkflowShowcase, type FlowModel } from '../app/Workflow';
import { formatDate } from '../format';
import { DotWave, Scene3D } from '../three';
import type { CostQuality, Model, NotificationPage, Overview, Workload } from '../types';

export function DashboardScreen() {
  const navigate = useNavigate();
  const overview = useApi<Overview>('/analytics/overview');
  const workloads = useApi<Workload[]>('/workloads');
  const models = useApi<Model[]>('/models?status=ACTIVE');
  const [workloadId, setWorkloadId] = useState('');
  const cq = useApi<CostQuality>(`/analytics/cost-quality${workloadId ? `?workloadId=${workloadId}` : ''}`);
  const notes = useApi<NotificationPage>('/notifications?limit=4');
  const [view, setView] = useState('chart');

  if (overview.error) return <LoadError error={overview.error} onRetry={overview.reload} />;
  const o = overview.data;
  const freshPct = o && o.freshness.available ? Math.round((o.freshness.fresh / o.freshness.available) * 100) : null;
  const volumeNote = cq.data?.workload
    ? `Monthly cost for “${cq.data.workload.name}”. Faded models don’t meet its requirements.`
    : 'Monthly cost for 1,000 requests of 1K input + 1K output tokens.';

  // Real catalogue rows for the walkthrough: the three best coding models.
  const flowModels: FlowModel[] = [...(models.data ?? [])]
    .sort((a, b) => b.codingScore - a.codingScore)
    .slice(0, 3)
    .map((m) => ({ name: m.name, provider: m.providerName, inputPrice: m.inputPrice, codingScore: m.codingScore }));
  const byPrice = [...(models.data ?? [])].sort((a, b) => Number(a.inputPrice) - Number(b.inputPrice));
  const cheapest = byPrice[0];
  const spread = byPrice.length
    ? {
        min: byPrice[0]!,
        max: byPrice[byPrice.length - 1]!,
        median: byPrice.length % 2 ? Number(byPrice[(byPrice.length - 1) / 2]!.inputPrice) : (Number(byPrice[byPrice.length / 2 - 1]!.inputPrice) + Number(byPrice[byPrice.length / 2]!.inputPrice)) / 2,
        underOne: byPrice.filter((m) => Number(m.inputPrice) < 1).length,
        count: byPrice.length,
      }
    : null;

  return (
    <div className="pf-stack pf-stack--lg">
      <section className="pf-hero">
        <Scene3D className="pf-hero__wave" fallback={null}>
          <DotWave />
        </Scene3D>
        <span className="pf-live">
          {o?.catalogue.lastSyncedAt ? `Live · ${o.catalogue.lastSource ?? 'catalogue'} synced ${relativeTime(o.catalogue.lastSyncedAt)}` : 'Live catalogue'}
        </span>
        <h1 className="pf-hero__title">
          Spend <span className="pf-gradient-text">smarter</span> across every model.
        </h1>
        <p className="pf-hero__lead">Live prices, benchmark indices and uptime for every model in one place — and an engine that splits each workload across the mix that fits your budget.</p>
        <div className="pf-hero__actions">
          <ButtonLink to="/workload">Plan a workload</ButtonLink>
          <ButtonLink to="/models" variant="ghost">
            Browse {o ? o.catalogue.available : ''} models
          </ButtonLink>
        </div>
        {o && (
          <div className="pf-hero__stats">
            <div className="pf-hero__stat">
              <strong>
                <CountUp value={o.catalogue.available} />
              </strong>
              <span>models tracked live</span>
            </div>
            <div className="pf-hero__stat">
              <strong>
                <CountUp value={o.catalogue.providers} />
              </strong>
              <span>providers</span>
            </div>
            <div className="pf-hero__stat">
              <strong>{cheapest ? formatUsd(cheapest.inputPrice, { precise: Number(cheapest.inputPrice) < 0.01 }) : '–'}</strong>
              <span>lowest input price / 1M{cheapest ? ` · ${cheapest.name}` : ''}</span>
            </div>
          </div>
        )}
      </section>

      {!o ? (
        <Loading what="Loading your dashboard" />
      ) : (
        <>
          <div className="pf-kpis pf-reveal">
            <Kpi index={0} label="Avg input price / 1M" value={<CountUp value={Number(o.catalogue.avgInputPrice)} format={(n) => formatUsd(n)} />} meta={`Output ${formatUsd(o.catalogue.avgOutputPrice)} / 1M`} />
            <Kpi
              index={1}
              label="Your monthly spend"
              value={<CountUp value={Number(o.portfolios.totalMonthlyCost)} format={(n) => formatUsd(n)} />}
              meta={`${o.portfolios.count} saved ${o.portfolios.count === 1 ? 'portfolio' : 'portfolios'} · budget ${formatUsd(o.portfolios.totalBudget)}`}
              flag={o.portfolios.count ? <TargetFlag ok={o.portfolios.overBudget === 0}>{o.portfolios.overBudget ? `${o.portfolios.overBudget} over budget` : 'All within budget'}</TargetFlag> : undefined}
            />
            <Kpi
              index={2}
              label="Data freshness"
              value={freshPct === null ? '–' : <CountUp value={freshPct} format={(n) => `${Math.round(n)}%`} />}
              meta={`Verified within ${o.freshness.thresholdHours} h`}
              flag={freshPct === null ? undefined : <TargetFlag ok={freshPct === 100}>{freshPct === 100 ? 'All figures fresh' : `${o.freshness.available - o.freshness.fresh} stale`}</TargetFlag>}
            />
            <Kpi index={3} label="Retiring soon" value={<CountUp value={o.catalogue.deprecatingSoon} />} meta="models with an announced end date" />
          </div>

          <div className="pf-seam" aria-hidden="true" />
          <WorkflowShowcase models={flowModels} modelCount={o.catalogue.available} />
          <div className="pf-seam" aria-hidden="true" />

          <section className="pf-stack" aria-labelledby="pf-market-title">
            <div className="pf-stack pf-stack--sm">
              <span className="pf-eyebrow">Market</span>
              <h2 id="pf-market-title">Where the models sit today</h2>
            </div>
            <div className="pf-cells">
              <div className="pf-cell pf-span-7 pf-stack">
                <div className="pf-section-head">
                  <div>
                    <h3>Cost vs quality</h3>
                    <p className="pf-subtle pf-small">{volumeNote}</p>
                  </div>
                  <SegmentedNav label="View" active={view} onChange={setView} items={[{ key: 'chart', label: 'Chart' }, { key: 'table', label: 'Table' }]} />
                </div>
                {workloads.data && workloads.data.length > 0 && (
                  <Select label="Volume" value={workloadId} onChange={setWorkloadId} options={[{ value: '', label: 'Reference volume' }, ...workloads.data.map((w) => ({ value: String(w.id), label: w.name }))]} />
                )}
                {cq.data &&
                  (view === 'chart' ? (
                    <CostQualityScatter onSelect={(id) => navigate(`/models/${id}`)} points={cq.data.points.map((p) => ({ id: p.modelId, name: p.name, provider: p.provider, cost: Number(p.monthlyCost), overall: p.overallScore, eligible: p.eligible }))} />
                  ) : (
                    <TableScroll label="Cost vs quality" stack fluid>
                      <Table
                        rowHeaders
                        columns={[
                          { key: 'name', label: 'Model' },
                          { key: 'provider', label: 'Provider' },
                          { key: 'cost', label: 'Monthly cost', align: 'right' },
                          { key: 'score', label: 'Quality', align: 'right' },
                          { key: 'uptime', label: '24 h uptime', align: 'right' },
                        ]}
                        rows={[...cq.data.points]
                          .sort((a, b) => Number(a.monthlyCost) - Number(b.monthlyCost))
                          .map((p) => ({ id: p.modelId, name: <Link to={`/models/${p.modelId}`}>{p.name}</Link>, provider: p.provider, cost: formatUsd(p.monthlyCost), score: p.overallScore, uptime: p.reliability === null ? 'n/a' : `${p.reliability}%` }))}
                      />
                    </TableScroll>
                  ))}
              </div>

              <div className="pf-cell pf-cell--tint-b pf-span-5 pf-stack">
                <h3>Catalogue price index</h3>
                <p className="pf-subtle pf-small">Average list price across models after each price change, per 1M tokens.</p>
                {o.priceIndex.length > 1 ? (
                  <PriceChart title="Catalogue price index" data={o.priceIndex.map((p) => ({ label: formatDate(p.date), input: Number(p.avgInputPrice), output: Number(p.avgOutputPrice) }))} />
                ) : (
                  // One data point is not a trend: show the level, not a lonely dot.
                  <div className="pf-stack">
                    <div className="pf-stats-row">
                      <div className="ds-stat">
                        <span className="ds-stat__value">{formatUsd(o.catalogue.avgInputPrice)}</span>
                        <span className="ds-stat__label">Average input / 1M</span>
                      </div>
                      <div className="ds-stat">
                        <span className="ds-stat__value">{formatUsd(o.catalogue.avgOutputPrice)}</span>
                        <span className="ds-stat__label">Average output / 1M</span>
                      </div>
                    </div>
                    <p className="pf-subtle pf-small">{o.priceIndex.length ? `Tracking since ${formatDate(o.priceIndex[0]!.date)}. The trend line appears after the first price change.` : 'No price history yet.'}</p>
                  </div>
                )}
                {spread && (
                  <ul className="pf-preview-list" aria-label="Input price spread">
                    <li>
                      <span>Cheapest input · {spread.min.name}</span>
                      <span className="pf-num pf-strong">{formatUsd(spread.min.inputPrice, { precise: Number(spread.min.inputPrice) < 0.01 })}</span>
                    </li>
                    <li>
                      <span>Median input</span>
                      <span className="pf-num pf-strong">{formatUsd(spread.median)}</span>
                    </li>
                    <li>
                      <span>Priciest input · {spread.max.name}</span>
                      <span className="pf-num pf-strong">{formatUsd(spread.max.inputPrice)}</span>
                    </li>
                    <li>
                      <span>Models under $1 / 1M input</span>
                      <span className="pf-num pf-strong">
                        {spread.underOne} of {spread.count}
                      </span>
                    </li>
                  </ul>
                )}
              </div>

              <div className="pf-cell pf-span-7 pf-stack">
                <div className="pf-section-head">
                  <h3>Your portfolios</h3>
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
                            {!p.withinBudget && ' · ✕ over budget'}
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
                    <ShareBar label="Your spend by provider" parts={o.portfolios.providerExposure.map((p) => ({ key: p.provider, label: p.provider, share: p.costShare }))} />
                  </>
                )}
              </div>

              <div className="pf-cell pf-cell--tint-a pf-span-5 pf-stack">
                <div className="pf-section-head">
                  <h3>Recent alerts</h3>
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
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
