import type { Queryable } from '../db.js';

export type TeamRole = 'OWNER' | 'MEMBER';

export interface TeamDto {
  id: number;
  name: string;
  /** The signed-in user's role in this team. */
  role: TeamRole;
  members: { userId: number; name: string; email: string; role: TeamRole }[];
  invites: { id: number; email: string; createdAt: string }[];
  portfolioCount: number;
}

export interface InviteDto {
  id: number;
  teamId: number;
  teamName: string;
  invitedBy: string | null;
  createdAt: string;
}

/** Teams the user belongs to, with members, pending invites and shared-portfolio counts. */
export async function listTeams(db: Queryable, userId: number): Promise<TeamDto[]> {
  const r = await db.query(
    `SELECT t.team_id, t.name, me.role,
            (SELECT json_agg(json_build_object('userId', u.user_id, 'name', u.name, 'email', u.email, 'role', m.role) ORDER BY m.role DESC, u.name)
               FROM team_member m JOIN app_user u ON u.user_id = m.user_id WHERE m.team_id = t.team_id) AS members,
            coalesce((SELECT json_agg(json_build_object('id', i.invite_id, 'email', i.email, 'createdAt', i.created_at) ORDER BY i.created_at)
               FROM team_invite i WHERE i.team_id = t.team_id AND i.responded_at IS NULL), '[]'::json) AS invites,
            (SELECT count(*)::int FROM portfolio p WHERE p.team_id = t.team_id) AS portfolio_count
       FROM team t JOIN team_member me ON me.team_id = t.team_id AND me.user_id = $1
      ORDER BY t.name, t.team_id`,
    [userId],
  );
  return r.rows.map((x) => ({ id: x.team_id, name: x.name, role: x.role, members: x.members ?? [], invites: x.invites, portfolioCount: x.portfolio_count }));
}

export async function membershipRole(db: Queryable, teamId: number, userId: number): Promise<TeamRole | null> {
  const r = await db.query(`SELECT role FROM team_member WHERE team_id = $1 AND user_id = $2`, [teamId, userId]);
  return r.rows[0]?.role ?? null;
}

export async function createTeam(db: Queryable, userId: number, name: string): Promise<number> {
  const r = await db.query(`INSERT INTO team (name, created_by) VALUES ($1, $2) RETURNING team_id`, [name, userId]);
  const id: number = r.rows[0].team_id;
  await db.query(`INSERT INTO team_member (team_id, user_id, role) VALUES ($1, $2, 'OWNER')`, [id, userId]);
  return id;
}

export async function renameTeam(db: Queryable, teamId: number, name: string): Promise<void> {
  await db.query(`UPDATE team SET name = $2 WHERE team_id = $1`, [teamId, name]);
}

export async function deleteTeam(db: Queryable, teamId: number): Promise<void> {
  // Shared portfolios fall back to their creators (portfolio.team_id ON DELETE SET NULL).
  await db.query(`DELETE FROM team WHERE team_id = $1`, [teamId]);
}

/** Creates a pending invite; returns null when one is already pending for that address. */
export async function createInvite(db: Queryable, teamId: number, email: string, invitedBy: number): Promise<number | null> {
  const r = await db.query(
    `INSERT INTO team_invite (team_id, email, invited_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING invite_id`,
    [teamId, email.toLowerCase(), invitedBy],
  );
  return r.rows[0]?.invite_id ?? null;
}

export async function cancelInvite(db: Queryable, teamId: number, inviteId: number): Promise<boolean> {
  const r = await db.query(`DELETE FROM team_invite WHERE invite_id = $1 AND team_id = $2 AND responded_at IS NULL`, [inviteId, teamId]);
  return (r.rowCount ?? 0) > 0;
}

/** Pending invites addressed to this email. */
export async function invitesFor(db: Queryable, email: string): Promise<InviteDto[]> {
  const r = await db.query(
    `SELECT i.invite_id, i.team_id, t.name AS team_name, u.name AS invited_by, i.created_at
       FROM team_invite i JOIN team t ON t.team_id = i.team_id LEFT JOIN app_user u ON u.user_id = i.invited_by
      WHERE lower(i.email) = lower($1) AND i.responded_at IS NULL ORDER BY i.created_at`,
    [email],
  );
  return r.rows.map((x) => ({ id: x.invite_id, teamId: x.team_id, teamName: x.team_name, invitedBy: x.invited_by, createdAt: x.created_at.toISOString() }));
}

/**
 * Answers an invite addressed to this email. Accepting adds the user as a
 * member. Returns the team id, or null if no such pending invite exists for them.
 */
export async function respondToInvite(db: Queryable, inviteId: number, user: { id: number; email: string }, accept: boolean): Promise<number | null> {
  const r = await db.query(
    `UPDATE team_invite SET responded_at = now(), accepted = $3
      WHERE invite_id = $1 AND lower(email) = lower($2) AND responded_at IS NULL RETURNING team_id`,
    [inviteId, user.email, accept],
  );
  const teamId: number | undefined = r.rows[0]?.team_id;
  if (!teamId) return null;
  if (accept) await db.query(`INSERT INTO team_member (team_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [teamId, user.id]);
  return teamId;
}

export async function removeMember(db: Queryable, teamId: number, userId: number): Promise<boolean> {
  const r = await db.query(`DELETE FROM team_member WHERE team_id = $1 AND user_id = $2`, [teamId, userId]);
  if ((r.rowCount ?? 0) > 0) {
    // Their portfolios stop being shared with a team they've left.
    await db.query(`UPDATE portfolio SET team_id = NULL WHERE team_id = $1 AND user_id = $2`, [teamId, userId]);
    return true;
  }
  return false;
}

export async function ownerCount(db: Queryable, teamId: number): Promise<number> {
  return (await db.query(`SELECT count(*)::int AS n FROM team_member WHERE team_id = $1 AND role = 'OWNER'`, [teamId])).rows[0].n;
}

export async function setMemberRole(db: Queryable, teamId: number, userId: number, role: TeamRole): Promise<boolean> {
  const r = await db.query(`UPDATE team_member SET role = $3 WHERE team_id = $1 AND user_id = $2`, [teamId, userId, role]);
  return (r.rowCount ?? 0) > 0;
}

/** Everyone who should hear about a portfolio: its creator and the members of the team it's shared with. */
export async function portfolioAudience(db: Queryable, portfolioIds: number[]): Promise<Map<number, number[]>> {
  const r = await db.query(
    `SELECT p.portfolio_id, array_agg(DISTINCT x.user_id) AS users
       FROM portfolio p
       JOIN LATERAL (SELECT p.user_id UNION SELECT m.user_id FROM team_member m WHERE m.team_id = p.team_id) x(user_id) ON true
      WHERE p.portfolio_id = ANY($1::bigint[])
      GROUP BY p.portfolio_id`,
    [portfolioIds],
  );
  return new Map(r.rows.map((x) => [x.portfolio_id, (x.users as (number | string)[]).map(Number)]));
}
