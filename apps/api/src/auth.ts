import { hash, verify } from '@node-rs/argon2';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { forbidden, unauthorized } from './errors.js';
import { findUserById, type UserDto } from './repositories/users.js';

export const hashPassword = (password: string) => hash(password);
export const verifyPassword = (passwordHash: string, password: string) => verify(passwordHash, password);

declare module 'fastify' {
  interface FastifyRequest {
    /** The authenticated account, loaded from the database on every request. */
    account: UserDto;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
  }
}

/**
 * preHandler: requires a valid token AND a user that still exists. The role is
 * read from the database, never from the token or the client, so demoting an
 * admin takes effect immediately.
 */
export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  let sub: string;
  try {
    ({ sub } = await request.jwtVerify<{ sub: string }>());
  } catch {
    throw unauthorized();
  }
  const user = await findUserById(request.server.db, Number(sub));
  if (!user) throw unauthorized();
  request.account = user;
}

/** preHandler: authenticate, then require ADMIN. */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await authenticate(request, reply);
  if (request.account.role !== 'ADMIN') throw forbidden('Only administrators can change the catalogue.');
}
