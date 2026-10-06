import type { Queryable, Tx } from '../db.js';

export interface PortfolioRow {
  id: number;
  userId: number;
  workloadId: number;
  name: string;
  budget: string;
  createdAt: string;
  updatedAt: string;
  recommendationId: number | null;
  lines: { modelId: number; allocationPercentage: number; estimatedCost: string }[];
}

export interface PortfolioLineInput {
  modelId: number;
  allocationPercentage: number;
  estimatedCost: string;
}

async function load(db: Queryable, where: string, args: unknown[]): Promise<PortfolioRow[]> {
  const r = await db.query(
    `SELECT p.*,
            (SELECT max(r.recommendation_id) FROM recommendation r WHERE r.portfolio_id = p.portfolio_id) AS recommendation_id,
            coalesce((SELECT json_agg(json_build_object(
                        'modelId', pm.model_id,
                        'allocationPercentage', pm.allocation_percentage,
                        'estimatedCost', to_char(pm.estimated_cost, 'FM99999999999990.0000'))
                        ORDER BY pm.allocation_percentage DESC, pm.model_id)
                        FROM portfolio_model pm WHERE pm.portfolio_id = p.portfolio_id), '[]'::json) AS lines
       FROM portfolio p WHERE ${where} ORDER BY p.updated_at DESC, p.portfolio_id DESC`,
    args,
  );
  return r.rows.map((x) => ({
    id: x.portfolio_id,
    userId: x.user_id,
    workloadId: x.workload_id,
    name: x.name,
    budget: x.budget,
    createdAt: x.created_at.toISOString(),
    updatedAt: x.updated_at.toISOString(),
    recommendationId: x.recommendation_id,
    lines: x.lines,
  }));
}

export async function getOwnPortfolio(db: Queryable, userId: number, id: number): Promise<PortfolioRow | null> {
  return (await load(db, 'p.portfolio_id = $1 AND p.user_id = $2', [id, userId]))[0] ?? null;
}

export async function listOwnPortfolios(db: Queryable, userId: number): Promise<PortfolioRow[]> {
  return load(db, 'p.user_id = $1', [userId]);
}

export async function insertPortfolio(tx: Tx, p: { userId: number; workloadId: number; name: string; budget: string }, lines: PortfolioLineInput[]): Promise<number> {
  const r = await tx.query(
    `INSERT INTO portfolio (user_id, workload_id, name, budget) VALUES ($1, $2, $3, $4) RETURNING portfolio_id`,
    [p.userId, p.workloadId, p.name, p.budget],
  );
  const id: number = r.rows[0].portfolio_id;
  await replaceLines(tx, id, lines);
  return id;
}

export async function updatePortfolio(tx: Tx, id: number, p: { name: string; budget: string }, lines: PortfolioLineInput[]): Promise<void> {
  await tx.query(`UPDATE portfolio SET name = $2, budget = $3, updated_at = now() WHERE portfolio_id = $1`, [id, p.name, p.budget]);
  await replaceLines(tx, id, lines);
}

async function replaceLines(tx: Tx, portfolioId: number, lines: PortfolioLineInput[]): Promise<void> {
  await tx.query(`DELETE FROM portfolio_model WHERE portfolio_id = $1`, [portfolioId]);
  for (const l of lines) {
    await tx.query(
      `INSERT INTO portfolio_model (portfolio_id, model_id, allocation_percentage, estimated_cost) VALUES ($1, $2, $3, $4)`,
      [portfolioId, l.modelId, l.allocationPercentage, l.estimatedCost],
    );
  }
}

export async function deleteOwnPortfolio(db: Queryable, userId: number, id: number): Promise<boolean> {
  const r = await db.query(`DELETE FROM portfolio WHERE portfolio_id = $1 AND user_id = $2`, [id, userId]);
  return (r.rowCount ?? 0) > 0;
}
