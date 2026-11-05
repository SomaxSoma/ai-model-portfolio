import { pathToFileURL } from 'node:url';
import { hashPassword } from './auth.js';
import { config } from './config.js';
import { createPool, withTransaction, type Db } from './db.js';
import { createModel, createProvider, findProviderByName } from './repositories/catalogue.js';
import { adminExists, createUser, findUserByEmail } from './repositories/users.js';
import { runIngestion } from './services/ingestion.js';
import { SAMPLE_FEED, SAMPLE_SOURCE, sampleModels, sampleProviders } from './seed/sample-catalogue.js';

/** The live catalogue source: OpenRouter's public models API, refreshed hourly. */
export const LIVE_SOURCE = { name: 'OpenRouter live catalogue', kind: 'OPENROUTER' as const, scheduleMinutes: 60 };

/**
 * Seeds the first administrator and a catalogue source. Idempotent.
 *  - default: registers the LIVE OpenRouter source (the catalogue fills on its first run)
 *  - sample: true → the illustrative sample catalogue and its FILE feed (tests, offline demos)
 */
export async function seed(db: Db, opts: { sample?: boolean; log?: (msg: string) => void } = {}): Promise<{ liveSourceId: number | null }> {
  const log = opts.log ?? (() => {});
  let liveSourceId: number | null = null;

  await withTransaction(db, async (tx) => {
    if (opts.sample) {
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
      const src = await tx.query(`INSERT INTO ingestion_source (name, kind, location, schedule_minutes) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING source_id`, [SAMPLE_FEED.name, SAMPLE_FEED.kind, SAMPLE_FEED.location, SAMPLE_FEED.scheduleMinutes]);
      if (src.rowCount) log(`ingestion source: ${SAMPLE_FEED.name}`);
    } else {
      await tx.query(`INSERT INTO ingestion_source (name, kind, location, schedule_minutes) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [LIVE_SOURCE.name, LIVE_SOURCE.kind, config.openRouterUrl, LIVE_SOURCE.scheduleMinutes]);
      const r = await tx.query(`SELECT source_id FROM ingestion_source WHERE lower(name) = lower($1)`, [LIVE_SOURCE.name]);
      liveSourceId = r.rows[0]?.source_id ?? null;
      log(`ingestion source: ${LIVE_SOURCE.name} (${config.openRouterUrl})`);
    }
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
  return { liveSourceId };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const db = createPool(config.databaseUrl);
  const sample = process.env.SEED_SAMPLE === 'true';
  const { liveSourceId } = await seed(db, { sample, log: console.log });
  if (!sample && liveSourceId && process.env.SEED_SKIP_INGEST !== 'true') {
    // Fill the catalogue now rather than waiting for the first scheduled run.
    console.log('fetching the live catalogue…');
    const run = await runIngestion(db, liveSourceId, 'MANUAL');
    console.log(run.status === 'FAILED' ? `live catalogue unavailable: ${run.error} (the scheduler will retry)` : `live catalogue: ${run.modelsCreated} added, ${run.modelsUpdated} updated, ${run.recordsRejected} rejected`);
  }
  await db.end();
}
