import { pathToFileURL } from 'node:url';
import { hashPassword } from './auth.js';
import { config } from './config.js';
import { createPool, withTransaction, type Db } from './db.js';
import { createModel, createProvider, findProviderByName } from './repositories/catalogue.js';
import { adminExists, createUser, findUserByEmail } from './repositories/users.js';
import { SAMPLE_SOURCE, sampleModels, sampleProviders } from './seed/sample-catalogue.js';

/**
 * Seeds the SAMPLE catalogue (see seed/sample-catalogue.ts) and the first
 * administrator. Idempotent: skips anything that already exists.
 */
export async function seed(db: Db, log: (msg: string) => void = () => {}): Promise<void> {
  await withTransaction(db, async (tx) => {
    const providerIds = new Map<string, number>();
    for (const p of sampleProviders) {
      const existing = await findProviderByName(tx, p.name);
      providerIds.set(p.name, existing ?? (await createProvider(tx, p)).id);
    }
    let added = 0;
    for (const m of sampleModels) {
      const providerId = providerIds.get(m.provider)!;
      const exists = await tx.query('SELECT 1 FROM ai_model WHERE provider_id = $1 AND name = $2 AND version = $3', [providerId, m.name, m.version]);
      if (exists.rowCount) continue;
      await createModel(tx, { ...m, providerId }, SAMPLE_SOURCE);
      added++;
    }
    log(`sample catalogue: ${added} model(s) added`);
  });

  if (!(await adminExists(db))) {
    const { name, email, password } = config.seedAdmin;
    if (await findUserByEmail(db, email)) {
      await db.query(`UPDATE app_user SET role = 'ADMIN' WHERE lower(email) = lower($1)`, [email]);
    } else {
      await createUser(db, { name, email, passwordHash: await hashPassword(password), role: 'ADMIN' });
    }
    log(`administrator: ${email}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const db = createPool(config.databaseUrl);
  await seed(db, console.log);
  await db.end();
}
