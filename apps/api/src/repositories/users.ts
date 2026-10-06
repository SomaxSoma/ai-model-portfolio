import type { Role } from '@pf/domain';
import type { Queryable } from '../db.js';

export interface UserDto {
  id: number;
  name: string;
  email: string;
  role: Role;
}

interface UserRow {
  user_id: number;
  name: string;
  email: string;
  role: Role;
  password_hash: string;
}

const toUser = (r: UserRow): UserDto => ({ id: r.user_id, name: r.name, email: r.email, role: r.role });

export async function findUserByEmail(db: Queryable, email: string): Promise<(UserDto & { passwordHash: string }) | null> {
  const r = await db.query<UserRow>(`SELECT * FROM app_user WHERE lower(email) = lower($1)`, [email]);
  const row = r.rows[0];
  return row ? { ...toUser(row), passwordHash: row.password_hash } : null;
}

export async function findUserById(db: Queryable, id: number): Promise<UserDto | null> {
  const r = await db.query<UserRow>(`SELECT * FROM app_user WHERE user_id = $1`, [id]);
  return r.rows[0] ? toUser(r.rows[0]) : null;
}

export async function createUser(db: Queryable, u: { name: string; email: string; passwordHash: string; role?: Role }): Promise<UserDto> {
  const r = await db.query<UserRow>(
    `INSERT INTO app_user (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING *`,
    [u.name, u.email, u.passwordHash, u.role ?? 'USER'],
  );
  return toUser(r.rows[0]!);
}

export async function adminExists(db: Queryable): Promise<boolean> {
  return ((await db.query(`SELECT 1 FROM app_user WHERE role = 'ADMIN' LIMIT 1`)).rowCount ?? 0) > 0;
}
