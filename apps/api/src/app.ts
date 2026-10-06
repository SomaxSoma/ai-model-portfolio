import fastifyJwt from '@fastify/jwt';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from './auth.js';
import { config } from './config.js';
import type { Db } from './db.js';
import { HttpError } from './errors.js';
import { authRoutes } from './routes/auth.js';
import { catalogueRoutes } from './routes/catalogue.js';
import { planningRoutes } from './routes/planning.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
  }
}

// Fallback wording for any validation rule without its own message, so schema
// language ("expected string, received undefined") never reaches a user.
z.config({
  customError: (issue) =>
    issue.code === 'invalid_type' ? (issue.input === undefined ? 'This field is required.' : 'This value isn’t in the right format.') : 'This value isn’t valid.',
});

export async function buildApp(opts: { db: Db; logger?: boolean; jwtSecret?: string }): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
  app.decorate('db', opts.db);
  await app.register(fastifyJwt, { secret: opts.jwtSecret ?? config.jwtSecret, sign: { expiresIn: config.tokenTtl } });

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ message: err.message, ...(err.errors ? { errors: err.errors } : {}) });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      // Malformed JSON and the like.
      return reply.code(status).send({ message: 'The request could not be read.' });
    }
    request.log.error(err);
    return reply.code(500).send({ message: 'Something went wrong on our side. Please try again.' });
  });

  app.get('/health', async () => ({ ok: true }));
  app.get('/me', { preHandler: authenticate }, async (request) => request.account);

  await app.register(authRoutes);
  await app.register(catalogueRoutes);
  await app.register(planningRoutes);
  return app;
}
