import type { Role } from '@pf/domain';
import type { Queryable } from '../db.js';

export interface UserDto {
  id: number;
  name: string;
  email: string;
  role: Role;
  /** A disposable demo account (removed after DEMO_TTL_HOURS). */
  isDemo: boolean;
  /** Wants a digest of new alerts by email. */
  emailAlerts: boolean;
  /** False for accounts that only sign in with Google/GitHub (or demo accounts). */
  hasPassword: boolean;
}

interface UserRow {
  user_id: number;
  name: string;
  email: string;
  role: Role;
  password_hash: string | null;
  is_demo: boolean;
  email_alerts: boolean;
  session_version: number;
}

const toUser = (r: UserRow): UserDto => ({
  id: r.user_id,
  name: r.name,
  email: r.email,
  role: r.role,
  isDemo: r.is_demo,
  emailAlerts: r.email_alerts,
  hasPassword: r.password_hash !== null,
});

export async function findUserByEmail(db: Queryable, email: string): Promise<(UserDto & { passwordHash: string | null }) | null> {
  const r = await db.query<UserRow>(`SELECT * FROM app_user WHERE lower(email) = lower($1)`, [email]);
  const row = r.rows[0];
  return row ? { ...toUser(row), passwordHash: row.password_hash } : null;
}

export async function findUserById(db: Queryable, id: number): Promise<UserDto | null> {
  const r = await db.query<UserRow>(`SELECT * FROM app_user WHERE user_id = $1`, [id]);
  return r.rows[0] ? toUser(r.rows[0]) : null;
}

/** The user plus the session version tokens must carry to be accepted. */
export async function findSessionUser(db: Queryable, id: number): Promise<(UserDto & { sessionVersion: number }) | null> {
  const r = await db.query<UserRow>(`SELECT * FROM app_user WHERE user_id = $1`, [id]);
  const row = r.rows[0];
  return row ? { ...toUser(row), sessionVersion: row.session_version } : null;
}

export async function sessionVersionOf(db: Queryable, id: number): Promise<number> {
  return (await db.query(`SELECT session_version FROM app_user WHERE user_id = $1`, [id])).rows[0]?.session_version ?? 0;
}

export async function createUser(db: Queryable, u: { name: string; email: string; passwordHash: string | null; role?: Role; isDemo?: boolean }): Promise<UserDto> {
  const r = await db.query<UserRow>(
    `INSERT INTO app_user (name, email, password_hash, role, is_demo) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [u.name, u.email, u.passwordHash, u.role ?? 'USER', u.isDemo ?? false],
  );
  return toUser(r.rows[0]!);
}

export async function updateProfile(db: Queryable, id: number, patch: { name?: string; emailAlerts?: boolean }): Promise<UserDto | null> {
  const r = await db.query<UserRow>(
    `UPDATE app_user SET name = COALESCE($2, name), email_alerts = COALESCE($3, email_alerts) WHERE user_id = $1 RETURNING *`,
    [id, patch.name ?? null, patch.emailAlerts ?? null],
  );
  return r.rows[0] ? toUser(r.rows[0]) : null;
}

/** New password; every token issued before it stops working. */
export async function setPassword(db: Queryable, id: number, passwordHash: string): Promise<void> {
  await db.query(`UPDATE app_user SET password_hash = $2, session_version = session_version + 1 WHERE user_id = $1`, [id, passwordHash]);
}

export async function deleteUser(db: Queryable, id: number): Promise<void> {
  await db.query(`DELETE FROM app_user WHERE user_id = $1`, [id]);
}

export async function adminCount(db: Queryable): Promise<number> {
  return (await db.query(`SELECT count(*)::int AS n FROM app_user WHERE role = 'ADMIN'`)).rows[0].n;
}

export async function adminExists(db: Queryable): Promise<boolean> {
  return ((await db.query(`SELECT 1 FROM app_user WHERE role = 'ADMIN' LIMIT 1`)).rowCount ?? 0) > 0;
}

/** Removes demo accounts older than the given age (their workloads and portfolios cascade). */
export async function purgeDemoUsers(db: Queryable, olderThanHours: number): Promise<number> {
  const r = await db.query(`DELETE FROM app_user WHERE is_demo AND created_at < now() - make_interval(hours => $1)`, [olderThanHours]);
  return r.rowCount ?? 0;
}

// ---- linked sign-in providers ---------------------------------------------

export async function findUserByIdentity(db: Queryable, provider: string, subject: string): Promise<UserDto | null> {
  const r = await db.query<UserRow>(
    `SELECT u.* FROM user_identity i JOIN app_user u ON u.user_id = i.user_id WHERE i.provider = $1 AND i.subject = $2`,
    [provider, subject],
  );
  return r.rows[0] ? toUser(r.rows[0]) : null;
}

export async function linkIdentity(db: Queryable, userId: number, provider: string, subject: string): Promise<void> {
  await db.query(`INSERT INTO user_identity (user_id, provider, subject) VALUES ($1, $2, $3) ON CONFLICT (provider, subject) DO NOTHING`, [userId, provider, subject]);
}

// ---- password reset tokens (only their SHA-256 is stored) -----------------

export async function insertPasswordReset(db: Queryable, userId: number, tokenHash: string, minutes: number): Promise<void> {
  await db.query(`INSERT INTO password_reset (user_id, token_hash, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))`, [userId, tokenHash, minutes]);
}

/** Marks a valid, unused, unexpired token as used and returns its user; null otherwise. Atomic. */
export async function consumePasswordReset(db: Queryable, tokenHash: string): Promise<number | null> {
  const r = await db.query(
    `UPDATE password_reset SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id`,
    [tokenHash],
  );
  return r.rows[0]?.user_id ?? null;
}

/** Resets requested for this user in the last hour (to cap emails per account). */
export async function recentResetCount(db: Queryable, userId: number): Promise<number> {
  return (await db.query(`SELECT count(*)::int AS n FROM password_reset WHERE user_id = $1 AND created_at > now() - interval '1 hour'`, [userId])).rows[0].n;
}
