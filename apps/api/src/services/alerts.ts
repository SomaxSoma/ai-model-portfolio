import { daysUntil, formatUsd, monthlyCost, RISK_THRESHOLDS, sumMoney } from '@pf/domain';
import type { Queryable } from '../db.js';
import type { ModelDto } from '../repositories/catalogue.js';
import { adminIds, insertNotifications, type NewNotification } from '../repositories/notifications.js';

export interface CatalogueChange {
  before: ModelDto;
  after: ModelDto;
}

/** Ignore cost moves smaller than this share of the old cost. */
const COST_CHANGE_THRESHOLD = 0.01;

/**
 * Alerts (proposal §9.2). After a catalogue change — an admin edit or an
 * ingestion run — tell every owner of an affected portfolio what changed for
 * them: cost moved, budget broken, model retired or deprecation announced.
 */
export async function notifyCatalogueChanges(db: Queryable, changes: CatalogueChange[]): Promise<number> {
  const relevant = changes.filter((c) => c.before && c.after);
  if (!relevant.length) return 0;
  const changedIds = relevant.map((c) => c.after.id);
  const beforeById = new Map(relevant.map((c) => [c.before.id, c.before]));
  const afterById = new Map(relevant.map((c) => [c.after.id, c.after]));

  // Every line of every portfolio that holds a changed model, with the workload volumes.
  const r = await db.query(
    `SELECT p.portfolio_id, p.user_id, p.name, p.budget, w.input_tokens, w.output_tokens, w.requests_per_month,
            pm.model_id, pm.allocation_percentage, m.input_price, m.output_price, m.name AS model_name
       FROM portfolio p
       JOIN workload w ON w.workload_id = p.workload_id
       JOIN portfolio_model pm ON pm.portfolio_id = p.portfolio_id
       JOIN ai_model m ON m.model_id = pm.model_id
      WHERE p.portfolio_id IN (SELECT portfolio_id FROM portfolio_model WHERE model_id = ANY($1::bigint[]))`,
    [changedIds],
  );

  const portfolios = new Map<number, { userId: number; name: string; budget: string; lines: typeof r.rows; volume: { inputTokens: number; outputTokens: number; requestsPerMonth: number } }>();
  for (const row of r.rows) {
    const p = portfolios.get(row.portfolio_id) ?? {
      userId: row.user_id,
      name: row.name,
      budget: row.budget,
      lines: [] as typeof r.rows,
      volume: { inputTokens: row.input_tokens, outputTokens: row.output_tokens, requestsPerMonth: row.requests_per_month },
    };
    p.lines.push(row);
    portfolios.set(row.portfolio_id, p);
  }

  const out: NewNotification[] = [];
  for (const [portfolioId, p] of portfolios) {
    const link = `/portfolios/${portfolioId}`;
    const priceOf = (modelId: number, which: 'before' | 'after', row: (typeof p.lines)[number]) => {
      const m = which === 'before' ? beforeById.get(modelId) : afterById.get(modelId);
      return m ? { inputPrice: m.inputPrice, outputPrice: m.outputPrice } : { inputPrice: row.input_price, outputPrice: row.output_price };
    };
    const oldCost = sumMoney(p.lines.map((l) => monthlyCost(priceOf(l.model_id, 'before', l), p.volume, l.allocation_percentage)));
    const newCost = sumMoney(p.lines.map((l) => monthlyCost(priceOf(l.model_id, 'after', l), p.volume, l.allocation_percentage)));

    if (!oldCost.eq(newCost) && (oldCost.isZero() || newCost.minus(oldCost).abs().div(oldCost).gte(COST_CHANGE_THRESHOLD))) {
      const crossed = newCost.gt(p.budget) && oldCost.lte(p.budget);
      out.push({
        userId: p.userId,
        kind: crossed ? 'OVER_BUDGET' : 'COST_CHANGE',
        severity: crossed || newCost.gt(oldCost) ? 'WARNING' : 'INFO',
        title: crossed ? `${p.name} is now over budget` : `${p.name} now costs ${formatUsd(newCost)} a month`,
        body: `A catalogue price change moved its estimated monthly cost from ${formatUsd(oldCost)} to ${formatUsd(newCost)}${crossed ? `, above its ${formatUsd(p.budget)} budget. Rebalance the allocation or raise the budget.` : '.'}`,
        link,
      });
    }

    for (const l of p.lines) {
      const before = beforeById.get(l.model_id);
      const after = afterById.get(l.model_id);
      if (!before || !after) continue;
      if (before.status !== 'RETIRED' && after.status === 'RETIRED') {
        out.push({
          userId: p.userId,
          kind: 'MODEL_RETIRED',
          severity: 'WARNING',
          title: `${after.name} has been retired`,
          body: `It carries ${l.allocation_percentage}% of ${p.name}. Move that share to another model before saving changes.`,
          link,
        });
      }
      if (after.deprecationDate && after.deprecationDate !== before.deprecationDate && after.status !== 'RETIRED') {
        const days = daysUntil(after.deprecationDate);
        if (days <= RISK_THRESHOLDS.deprecationWarningDays) {
          out.push({
            userId: p.userId,
            kind: 'MODEL_DEPRECATION',
            severity: 'WARNING',
            title: `${after.name} will be retired on ${after.deprecationDate}`,
            body: `That is ${days} ${days === 1 ? 'day' : 'days'} away, and it carries ${l.allocation_percentage}% of ${p.name}. Plan a replacement.`,
            link,
          });
        }
      }
    }
  }
  return insertNotifications(db, out);
}

export async function notifyAdmins(db: Queryable, n: Omit<NewNotification, 'userId'>): Promise<void> {
  const ids = await adminIds(db);
  await insertNotifications(db, ids.map((userId) => ({ ...n, userId })));
}
