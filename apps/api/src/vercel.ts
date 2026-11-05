import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp } from './app.js';
import { config } from './config.js';
import { createPool } from './db.js';
import { apiPath } from './serverless.js';

/**
 * Vercel serverless entry. The same Fastify app as server.ts, without
 * listen(): each invocation hands the raw request to Fastify's router. The
 * pool and the app are created once per warm instance and reused.
 *
 * Routing (scripts/vercel-build.mjs): `/api/<path>` is rewritten to this
 * function as `/api?__pf_path=<path>`, so the original path is recovered from
 * the query whatever URL the platform passes in. Scheduled work runs through
 * GET /cron/run (Vercel Cron) instead of an in-process ticker.
 */
const db = createPool(config.databaseUrl, 3);
const ready = buildApp({ db, logger: false, redisUrl: config.redisUrl }).then(async (app) => {
  await app.ready();
  return app;
});

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await ready;
  req.url = apiPath(req.url ?? '/');
  // Resolve only once the response is out, so the platform doesn't freeze the instance mid-reply.
  await new Promise<void>((resolve) => {
    res.once('close', resolve);
    app.server.emit('request', req, res);
  });
}
