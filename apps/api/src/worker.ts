import { createCache } from './cache.js';
import { config } from './config.js';
import { createPool } from './db.js';
import { startScheduler } from './jobs.js';

/**
 * Background worker: scheduled ingestion and freshness checks, consumed from
 * the Redis queue. Run one (or more) next to the stateless API instances.
 */
if (!config.redisUrl) {
  console.error('The worker needs REDIS_URL. Without Redis, the API runs scheduled jobs itself (SCHEDULER=inline).');
  process.exit(1);
}

const db = createPool(config.databaseUrl);
const cache = createCache(config.redisUrl);
const stop = await startScheduler(db, cache, config.redisUrl);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await stop();
    await cache.close();
    await db.end();
    process.exit(0);
  });
}
