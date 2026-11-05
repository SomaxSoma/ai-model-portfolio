import { Queue, Worker } from 'bullmq';
import type { Cache } from './cache.js';
import { CATALOGUE_PREFIX } from './cache.js';
import type { Db } from './db.js';
import { housekeeping, sendAlertDigests } from './services/digest.js';
import { checkFreshness, dueSources, runIngestion, type RunResult } from './services/ingestion.js';

/**
 * Background jobs: scheduled ingestion and the hourly freshness check
 * (proposal §8: Redis job queue). With REDIS_URL, jobs go through a BullMQ
 * queue consumed by the worker process; without it, an in-process ticker runs
 * them (single-instance development).
 */
export const QUEUE_NAME = 'pf-jobs';
const TICK_MS = 60_000;
const FRESHNESS_EVERY_MS = 60 * 60_000;

export type JobData = { type: 'ingest'; sourceId: number; trigger: 'SCHEDULE' | 'MANUAL' } | { type: 'scan' } | { type: 'freshness' };

export interface JobRunner {
  readonly mode: 'queue' | 'inline';
  /** Run a source now. Queue mode returns null (the worker runs it); inline mode returns the result. */
  ingestNow(sourceId: number): Promise<RunResult | null>;
  close(): Promise<void>;
}

async function handle(db: Db, cache: Cache, data: JobData): Promise<unknown> {
  const invalidate = () => cache.invalidate(CATALOGUE_PREFIX);
  if (data.type === 'ingest') return runIngestion(db, data.sourceId, data.trigger, invalidate);
  if (data.type === 'freshness') {
    // Hourly upkeep: stale-data check, alert email digests, expired demo accounts.
    const stale = await checkFreshness(db);
    await sendAlertDigests(db);
    await housekeeping(db);
    return stale;
  }
  // scan: run every due source in turn
  const results = [];
  for (const id of await dueSources(db)) results.push(await runIngestion(db, id, 'SCHEDULE', invalidate));
  return results;
}

/**
 * One pass of the scheduled work: every due source, then the freshness check.
 * Serverless deployments (Vercel Cron) call this instead of a long-lived ticker.
 */
export async function runScheduledJobs(db: Db, cache: Cache): Promise<{ ingested: number; freshness: unknown }> {
  const runs = (await handle(db, cache, { type: 'scan' })) as unknown[];
  const freshness = await handle(db, cache, { type: 'freshness' });
  return { ingested: runs.length, freshness };
}

/** Producer side, used by the API. */
export function createJobRunner(db: Db, cache: Cache, redisUrl: string | undefined): JobRunner {
  if (!redisUrl) {
    return { mode: 'inline', ingestNow: (id) => runIngestion(db, id, 'MANUAL', () => cache.invalidate(CATALOGUE_PREFIX)), close: async () => {} };
  }
  const queue = new Queue<JobData>(QUEUE_NAME, { connection: { url: redisUrl }, defaultJobOptions: { removeOnComplete: 200, removeOnFail: 500, attempts: 1 } });
  return {
    mode: 'queue',
    ingestNow: async (sourceId) => {
      await queue.add('ingest', { type: 'ingest', sourceId, trigger: 'MANUAL' });
      return null;
    },
    close: () => queue.close(),
  };
}

/** Consumer side + schedules. Runs in the worker process (or inline in the API in dev). */
export async function startScheduler(db: Db, cache: Cache, redisUrl: string | undefined, log: (msg: string) => void = console.log): Promise<() => Promise<void>> {
  if (redisUrl) {
    const connection = { url: redisUrl };
    const queue = new Queue<JobData>(QUEUE_NAME, { connection });
    // Every minute, enqueue whichever sources are due; hourly freshness check.
    await queue.upsertJobScheduler('scan-sources', { every: TICK_MS }, { name: 'scan', data: { type: 'scan' } });
    await queue.upsertJobScheduler('freshness', { every: FRESHNESS_EVERY_MS }, { name: 'freshness', data: { type: 'freshness' } });
    const worker = new Worker<JobData>(QUEUE_NAME, (job) => handle(db, cache, job.data), { connection, concurrency: 1 });
    worker.on('failed', (job, err) => log(`job ${job?.name} failed: ${err.message}`));
    worker.on('completed', (job) => log(`job ${job.name} completed`));
    log('scheduler: BullMQ worker started');
    return async () => {
      await worker.close();
      await queue.close();
    };
  }

  let running = false;
  let lastFreshness = 0;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await handle(db, cache, { type: 'scan' });
      if (Date.now() - lastFreshness >= FRESHNESS_EVERY_MS) {
        lastFreshness = Date.now();
        await handle(db, cache, { type: 'freshness' });
      }
    } catch (err) {
      log(`scheduler tick failed: ${(err as Error).message}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, TICK_MS);
  timer.unref();
  void tick();
  log('scheduler: in-process ticker started');
  return async () => clearInterval(timer);
}
