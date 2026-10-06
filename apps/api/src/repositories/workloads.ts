import type { ValidWorkload } from '@pf/domain';
import type { Queryable } from '../db.js';

export interface WorkloadDto extends ValidWorkload {
  id: number;
  userId: number;
  createdAt: string;
}

const toWorkload = (r: any): WorkloadDto => ({
  id: r.workload_id,
  userId: r.user_id,
  name: r.name,
  inputTokens: r.input_tokens,
  outputTokens: r.output_tokens,
  requestsPerMonth: r.requests_per_month,
  budget: r.budget,
  requiredCapabilities: r.required_capabilities,
  createdAt: r.created_at.toISOString(),
});

export async function createWorkload(db: Queryable, userId: number, w: ValidWorkload): Promise<WorkloadDto> {
  const r = await db.query(
    `INSERT INTO workload (user_id, name, input_tokens, output_tokens, requests_per_month, budget, required_capabilities)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [userId, w.name, w.inputTokens, w.outputTokens, w.requestsPerMonth, w.budget, JSON.stringify(w.requiredCapabilities)],
  );
  return toWorkload(r.rows[0]);
}

export async function listWorkloads(db: Queryable, userId: number): Promise<WorkloadDto[]> {
  const r = await db.query(`SELECT * FROM workload WHERE user_id = $1 ORDER BY created_at DESC, workload_id DESC`, [userId]);
  return r.rows.map(toWorkload);
}

/** Returns the workload only if it belongs to userId. */
export async function getOwnWorkload(db: Queryable, userId: number, id: number): Promise<WorkloadDto | null> {
  const r = await db.query(`SELECT * FROM workload WHERE workload_id = $1 AND user_id = $2`, [id, userId]);
  return r.rows[0] ? toWorkload(r.rows[0]) : null;
}
