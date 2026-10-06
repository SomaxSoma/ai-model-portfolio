import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashPassword, verifyPassword } from '../auth.js';
import { badRequest, conflict, HttpError, zodFieldErrors } from '../errors.js';
import { createUser, findUserByEmail, type UserDto } from '../repositories/users.js';

const email = z.string({ error: 'Enter your email address.' }).trim().max(254).refine((v) => /^[^\s@]+@[^\s@]+$/.test(v), 'Enter a valid email address.');

const registerBody = z.object({
  name: z.string({ error: 'Enter your name.' }).trim().min(2, 'Your name needs at least 2 characters.').max(120, 'Keep your name under 120 characters.'),
  email,
  password: z.string({ error: 'Choose a password.' }).min(8, 'Use at least 8 characters for your password.').max(200, 'That password is too long.'),
});

const loginBody = z.object({
  email,
  password: z.string({ error: 'Enter your password.' }).min(1, 'Enter your password.'),
});

export async function authRoutes(app: FastifyInstance) {
  const issue = (user: UserDto) => ({ user, token: app.jwt.sign({ sub: String(user.id) }) });

  app.post('/auth/register', async (request, reply) => {
    const parsed = registerBody.safeParse(request.body ?? {});
    if (!parsed.success) throw badRequest(zodFieldErrors(parsed.error.issues));
    const { name, email, password } = parsed.data;
    if (await findUserByEmail(app.db, email)) {
      throw conflict({ email: 'An account with this email already exists. Log in instead.' }, 'That email is already registered.');
    }
    // Role is never taken from the request: every self-registered account is a USER.
    const user = await createUser(app.db, { name, email: email.toLowerCase(), passwordHash: await hashPassword(password) });
    return reply.code(201).send(issue(user));
  });

  app.post('/auth/login', async (request) => {
    const parsed = loginBody.safeParse(request.body ?? {});
    if (!parsed.success) throw badRequest(zodFieldErrors(parsed.error.issues));
    const found = await findUserByEmail(app.db, parsed.data.email);
    if (!found || !(await verifyPassword(found.passwordHash, parsed.data.password))) {
      throw new HttpError(401, 'Email or password is incorrect.');
    }
    const { passwordHash: _omit, ...user } = found;
    return issue(user);
  });
}
