import { CAPABILITY_KEYS, LIMITS, MODEL_STATUSES, parseMoney, type ModelStatus } from '@pf/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../auth.js';
import { cached, CACHE_KEYS, CATALOGUE_PREFIX } from '../cache.js';
import { withTransaction } from '../db.js';
import { badRequest, conflict, notFound, zodFieldErrors } from '../errors.js';
import {
  createModel,
  createProvider,
  findProviderByName,
  getModel,
  getModelHistory,
  listModels,
  listProviders,
  markVerified,
  providerExists,
  updateModel,
  type ModelDto,
} from '../repositories/catalogue.js';
import { notifyCatalogueChanges } from '../services/alerts.js';

const ADMIN_SOURCE = 'Admin console';
const CATALOGUE_TTL = 300;

const price = (label: string) =>
  z.union([z.string(), z.number()]).transform((v, ctx) => {
    const r = parseMoney(v, label, { allowZero: true, max: LIMITS.maxPricePerMillion });
    if (r.error) {
      ctx.addIssue({ code: 'custom', message: r.error });
      return z.NEVER;
    }
    return r.value!;
  });
const score = (label: string) =>
  z.number({ error: `Enter a ${label} from 0 to 100.` }).int(`Use a whole number for the ${label}.`).min(0, `The ${label} can’t be below 0.`).max(100, `The ${label} can’t be above 100.`);

const modelFields = {
  providerId: z.number({ error: 'Choose a provider.' }).int().positive(),
  name: z.string({ error: 'Give the model a name.' }).trim().min(1, 'Give the model a name.').max(120),
  version: z.string().trim().max(60).default(''),
  contextWindow: z.number({ error: 'Enter the context window in tokens.' }).int('Use a whole number of tokens.').positive('The context window must be more than 0.').max(100_000_000),
  inputPrice: price('the input price'),
  outputPrice: price('the output price'),
  codingScore: score('coding score'),
  reasoningScore: score('reasoning score').nullable(),
  status: z.enum(MODEL_STATUSES as [ModelStatus, ...ModelStatus[]], { error: 'Choose a status from the list.' }),
  capabilities: z.array(z.string().refine((c) => CAPABILITY_KEYS.includes(c), 'Choose capabilities from the list.')).transform((a) => [...new Set(a)]),
  latencyMs: z.number({ error: 'Enter latency in milliseconds.' }).int('Use whole milliseconds.').positive('Latency must be more than 0 ms.').max(600_000, 'Latency can be at most 600,000 ms.').nullable(),
  reliability: z.number({ error: 'Enter reliability as a percentage.' }).min(0, 'Reliability can’t be below 0%.').max(100, 'Reliability can’t be above 100%.').nullable(),
  deprecationDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2027-03-31.')
    .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), 'Use a real date.')
    .nullable(),
};

const createModelBody = z.object({
  ...modelFields,
  status: modelFields.status.default('ACTIVE'),
  capabilities: modelFields.capabilities.default([]),
  latencyMs: modelFields.latencyMs.default(null),
  reliability: modelFields.reliability.default(null),
  deprecationDate: modelFields.deprecationDate.default(null),
});
const patchModelBody = z.object(modelFields).partial().strict();

const providerBody = z.object({
  name: z.string({ error: 'Enter a provider name.' }).trim().min(2, 'The provider name needs at least 2 characters.').max(120),
  website: z.string().trim().max(300).url('Enter a full web address, starting with https://').nullish(),
  description: z.string().trim().max(1000).nullish(),
});

const idParam = z.object({ id: z.coerce.number().int().positive() });
const modelQuery = z.object({
  capability: z.string().optional(),
  search: z.string().trim().max(100).optional(),
  status: z.enum(MODEL_STATUSES as [ModelStatus, ...ModelStatus[]]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

function parseId(params: unknown, what: string): number {
  const r = idParam.safeParse(params);
  if (!r.success) throw notFound(what);
  return r.data.id;
}

export async function catalogueRoutes(app: FastifyInstance) {
  const allModels = () => cached(app.cache, CACHE_KEYS.models, CATALOGUE_TTL, () => listModels(app.db));
  const invalidate = () => app.cache.invalidate(CATALOGUE_PREFIX);

  // ---- read: any authenticated user -------------------------------------
  app.get('/providers', { preHandler: authenticate }, async () => cached(app.cache, CACHE_KEYS.providers, CATALOGUE_TTL, () => listProviders(app.db)));

  /** Paginated with ?limit=&offset=; the total is in X-Total-Count. Without them, every match is returned. */
  app.get('/models', { preHandler: authenticate }, async (request, reply) => {
    const q = modelQuery.safeParse(request.query ?? {});
    if (!q.success) throw badRequest(zodFieldErrors(q.error.issues));
    const { capability, status, limit, offset = 0 } = q.data;
    const search = q.data.search?.toLowerCase();
    const all = capability || search || status ? (await allModels()).filter(
      (m) =>
        (!capability || m.capabilities.includes(capability)) &&
        (!status || m.status === status) &&
        (!search || `${m.name} ${m.providerName} ${m.version}`.toLowerCase().includes(search)),
    ) : await allModels();
    reply.header('X-Total-Count', String(all.length));
    return limit ? all.slice(offset, offset + limit) : all.slice(offset);
  });

  app.get('/models/:id', { preHandler: authenticate }, async (request) => {
    const id = parseId(request.params, 'That model');
    const model = await getModel(app.db, id);
    if (!model) throw notFound('That model');
    const { totals: _totals, ...history } = await getModelHistory(app.db, id);
    return { ...model, history };
  });

  /** Paged history: ?limit=&offset= over both pricing and benchmark rows. */
  app.get('/models/:id/history', { preHandler: authenticate }, async (request) => {
    const id = parseId(request.params, 'That model');
    if (!(await getModel(app.db, id))) throw notFound('That model');
    const q = pageQuery.safeParse(request.query ?? {});
    if (!q.success) throw badRequest(zodFieldErrors(q.error.issues));
    return getModelHistory(app.db, id, q.data);
  });

  // ---- write: ADMIN only (checked server-side) ---------------------------
  app.post('/providers', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = providerBody.safeParse(request.body ?? {});
    if (!parsed.success) throw badRequest(zodFieldErrors(parsed.error.issues));
    if (await findProviderByName(app.db, parsed.data.name)) {
      throw conflict({ name: 'A provider with this name already exists.' }, 'That provider already exists.');
    }
    const created = await createProvider(app.db, parsed.data);
    await invalidate();
    return reply.code(201).send(created);
  });

  app.post('/models', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = createModelBody.safeParse(request.body ?? {});
    if (!parsed.success) throw badRequest(zodFieldErrors(parsed.error.issues));
    if (!(await providerExists(app.db, parsed.data.providerId))) throw badRequest({ providerId: 'Choose a provider from the list.' });
    const id = await withTransaction(app.db, (tx) => createModel(tx, parsed.data, ADMIN_SOURCE)).catch(uniqueModel);
    await invalidate();
    return reply.code(201).send(await getModel(app.db, id));
  });

  app.patch('/models/:id', { preHandler: requireAdmin }, async (request) => {
    const id = parseId(request.params, 'That model');
    const parsed = patchModelBody.safeParse(request.body ?? {});
    if (!parsed.success) throw badRequest(zodFieldErrors(parsed.error.issues));
    if (parsed.data.providerId !== undefined && !(await providerExists(app.db, parsed.data.providerId))) {
      throw badRequest({ providerId: 'Choose a provider from the list.' });
    }
    const { before, after } = await withTransaction(app.db, async (tx) => {
      // Lock the row so concurrent edits can't interleave history writes.
      const locked = await tx.query('SELECT 1 FROM ai_model WHERE model_id = $1 FOR UPDATE', [id]);
      if (!locked.rowCount) throw notFound('That model');
      const current = (await getModel(tx, id))!;
      await updateModel(tx, current, parsed.data, ADMIN_SOURCE);
      // An admin edit is a verification of the figures.
      await markVerified(tx, [id]);
      return { before: current, after: (await getModel(tx, id)) as ModelDto };
    }).catch(uniqueModel);
    await invalidate();
    await notifyCatalogueChanges(app.db, [{ before, after }]);
    return after;
  });
}

function uniqueModel(err: unknown): never {
  if ((err as { code?: string }).code === '23505') {
    throw conflict({ name: 'This provider already has a model with that name and version.' }, 'That model already exists.');
  }
  throw err;
}
