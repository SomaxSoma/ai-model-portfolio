import { moneyString, type Recommendation } from '@pf/domain';
import type { Queryable } from '../db.js';
import type { ModelDto } from './catalogue.js';

export interface StoredAllocation {
  modelId: number;
  allocationPercentage: number;
  estimatedCost: string;
}

export interface RecommendationRow {
  id: number;
  workloadId: number;
  portfolioId: number | null;
  estimatedCost: string;
  score: number;
  withinBudget: boolean;
  adjusted: boolean;
  reason: string;
  allocations: StoredAllocation[];
  createdAt: string;
}

const toRow = (r: any): RecommendationRow => ({
  id: r.recommendation_id,
  workloadId: r.workload_id,
  portfolioId: r.portfolio_id,
  estimatedCost: r.estimated_cost,
  score: Number(r.score),
  withinBudget: r.within_budget,
  adjusted: r.adjusted,
  reason: r.reason,
  allocations: r.allocations,
  createdAt: r.created_at.toISOString(),
});

export async function insertRecommendation(db: Queryable, workloadId: number, rec: Recommendation<ModelDto>): Promise<RecommendationRow> {
  const allocations: StoredAllocation[] = rec.allocations.map((a) => ({
    modelId: a.model.id,
    allocationPercentage: a.allocationPercentage,
    estimatedCost: moneyString(a.estimatedCost),
  }));
  const r = await db.query(
    `INSERT INTO recommendation (workload_id, estimated_cost, score, reason, within_budget, adjusted, allocations)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [workloadId, moneyString(rec.estimatedCost), rec.score, rec.reason, rec.withinBudget, rec.adjusted, JSON.stringify(allocations)],
  );
  return toRow(r.rows[0]);
}

/** Returns the recommendation only if its workload belongs to userId. */
export async function getOwnRecommendation(db: Queryable, userId: number, id: number): Promise<RecommendationRow | null> {
  const r = await db.query(
    `SELECT r.* FROM recommendation r JOIN workload w ON w.workload_id = r.workload_id
      WHERE r.recommendation_id = $1 AND w.user_id = $2`,
    [id, userId],
  );
  return r.rows[0] ? toRow(r.rows[0]) : null;
}

export async function linkPortfolio(db: Queryable, recommendationId: number, portfolioId: number): Promise<void> {
  await db.query(`UPDATE recommendation SET portfolio_id = $2 WHERE recommendation_id = $1`, [recommendationId, portfolioId]);
}
