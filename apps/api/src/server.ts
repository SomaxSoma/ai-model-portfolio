import { buildApp } from './app.js';
import { config } from './config.js';
import { createPool } from './db.js';
import { startScheduler } from './jobs.js';

const db = createPool(config.databaseUrl);
const app = await buildApp({ db, logger: true, redisUrl: config.redisUrl });
await app.listen({ port: config.port, host: config.host });

// Development / single-instance: run scheduled jobs here. In staging, a
// separate worker does it (SCHEDULER=off) so API instances stay stateless.
const stopScheduler = config.scheduler === 'inline' ? await startScheduler(db, app.cache, config.redisUrl, (m) => app.log.info(m)) : async () => {};

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await stopScheduler();
    await app.close();
    await db.end();
    process.exit(0);
  });
}
