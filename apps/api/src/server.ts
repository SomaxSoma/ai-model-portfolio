import { buildApp } from './app.js';
import { config } from './config.js';
import { createPool } from './db.js';

const db = createPool(config.databaseUrl);
const app = await buildApp({ db, logger: true });
await app.listen({ port: config.port, host: config.host });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    await db.end();
    process.exit(0);
  });
}
