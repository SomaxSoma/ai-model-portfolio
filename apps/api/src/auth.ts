import { hash, verify } from '@node-rs/argon2';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { forbidden, unauthorized } from './errors.js';
import type { FastifyInstance } from 'fastify';
import { findSessionUser, sessionVersionOf, type UserDto } from './repositories/users.js';

export const hashPassword = (password: string) => hash(password);
/** False (never throws) for accounts without a password, e.g. Google/GitHub-only sign-in. */
export const verifyPassword = (passwordHash: string | null, password: string) => (passwordHash ? verify(passwordHash, password) : Promise.resolve(false));

declare module 'fastify' {
  interface FastifyRequest {
    /** The authenticated account, loaded from the database on every request. */
    account: UserDto;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; sv?: number };
  }
}

/**
 * preHandler: requires a valid token AND a user that still exists. The role is
 * read from the database, never from the token or the client, so demoting an
 * admin takes effect immediately.
 */
export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  let sub: string;
  let sv: number | undefined;
  try {
    ({ sub, sv } = await request.jwtVerify<{ sub: string; sv?: number }>());
  } catch {
    throw unauthorized();
  }
  // Only user tokens carry a numeric subject (OAuth state tokens, for one, don't).
  if (!/^\d+$/.test(sub)) throw unauthorized();
  const found = await findSessionUser(request.server.db, Number(sub));
  if (!found) throw unauthorized();
  // A password reset bumps the session version, which invalidates every earlier token.
  if ((sv ?? 0) !== found.sessionVersion) throw unauthorized();
  const { sessionVersion: _v, ...user } = found;
  request.account = user;
}

/** preHandler: authenticate, then require ADMIN. */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await authenticate(request, reply);
  if (request.account.role !== 'ADMIN') throw forbidden('Only administrators can change the catalogue.');
}

/** A sign-in token for this user, bound to their current session version. */
export async function issueToken(app: FastifyInstance, user: UserDto): Promise<{ user: UserDto; token: string }> {
  return { user, token: app.jwt.sign({ sub: String(user.id), sv: await sessionVersionOf(app.db, user.id) }) };
}
