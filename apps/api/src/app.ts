import fastifyHelmet from '@fastify/helmet';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from './auth.js';
import { createCache, type Cache } from './cache.js';
import { config } from './config.js';
import type { Db } from './db.js';
import { HttpError } from './errors.js';
import { createJobRunner, type JobRunner } from './jobs.js';
import { Metrics } from './metrics.js';
import { adminRoutes } from './routes/admin.js';
import { analyticsRoutes } from './routes/analytics.js';
import { authRoutes } from './routes/auth.js';
import { catalogueRoutes } from './routes/catalogue.js';
import { insightRoutes } from './routes/insights.js';
import { planningRoutes } from './routes/planning.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    cache: Cache;
    metrics: Metrics;
    jobs: JobRunner;
    authRateLimit: number;
  }
}

// Fallback wording for any validation rule without its own message, so schema
// language ("expected string, received undefined") never reaches a user.
z.config({
  customError: (issue) =>
    issue.code === 'invalid_type' ? (issue.input === undefined ? 'This field is required.' : 'This value isn’t in the right format.') : 'This value isn’t valid.',
});

export interface AppOptions {
  db: Db;
  logger?: boolean;
  jwtSecret?: string;
  cache?: Cache;
  redisUrl?: string;
  authRateLimit?: number;
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true, bodyLimit: 1024 * 1024 });
  const cache = opts.cache ?? createCache(opts.redisUrl);
  app.decorate('db', opts.db);
  app.decorate('cache', cache);
  app.decorate('metrics', new Metrics());
  app.decorate('jobs', createJobRunner(opts.db, cache, opts.redisUrl));
  app.decorate('authRateLimit', opts.authRateLimit ?? config.authRateLimit);
  app.addHook('onClose', async () => {
    await app.jobs.close();
    if (!opts.cache) await cache.close();
  });

  // Security headers. The API serves JSON only, so the strictest CSP applies.
  await app.register(fastifyHelmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } });
  await app.register(fastifyRateLimit, { global: false });
  await app.register(fastifyJwt, { secret: opts.jwtSecret ?? config.jwtSecret, sign: { expiresIn: config.tokenTtl } });

  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions.url;
    if (route) app.metrics.record(request.method, route, reply.statusCode, reply.elapsedTime);
  });

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ message: err.message, ...(err.errors ? { errors: err.errors } : {}) });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return reply.code(429).send({ message: 'Too many attempts. Wait a minute and try again.' });
    if (status && status >= 400 && status < 500) {
      // Malformed JSON and the like.
      return reply.code(status).send({ message: 'The request could not be read.' });
    }
    request.log.error(err);
    return reply.code(500).send({ message: 'Something went wrong on our side. Please try again.' });
  });

  // Liveness: the process is up. Readiness: its dependencies answer.
  app.get('/health', async () => ({ ok: true }));
  app.get('/health/ready', async (_request, reply) => {
    const started = Date.now();
    try {
      await app.db.query('SELECT 1');
      return { ok: true, database: 'up', cache: app.cache.kind, jobs: app.jobs.mode, dbLatencyMs: Date.now() - started };
    } catch {
      return reply.code(503).send({ ok: false, database: 'down' });
    }
  });
  app.get('/me', { preHandler: authenticate }, async (request) => request.account);

  await app.register(authRoutes);
  await app.register(catalogueRoutes);
  await app.register(planningRoutes);
  await app.register(insightRoutes);
  await app.register(analyticsRoutes);
  await app.register(adminRoutes);
  return app;
}
