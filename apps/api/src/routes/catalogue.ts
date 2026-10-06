import { CAPABILITY_KEYS, LIMITS, MODEL_STATUSES, parseMoney, type ModelStatus } from '@pf/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../auth.js';
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
  providerExists,
  updateModel,
} from '../repositories/catalogue.js';

const ADMIN_SOURCE = 'Admin console';

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
  providerId: z.number().int().positive(),
  name: z.string().trim().min(1, 'Give the model a name.').max(120),
  version: z.string().trim().max(60).default(''),
  contextWindow: z.number({ error: 'Enter the context window in tokens.' }).int('Use a whole number of tokens.').positive('The context window must be more than 0.').max(100_000_000),
  inputPrice: price('the input price'),
  outputPrice: price('the output price'),
  codingScore: score('coding score'),
  reasoningScore: score('reasoning score'),
  status: z.enum(MODEL_STATUSES as [ModelStatus, ...ModelStatus[]], { error: 'Choose a status from the list.' }),
  capabilities: z.array(z.string().refine((c) => CAPABILITY_KEYS.includes(c), 'Choose capabilities from the list.')).transform((a) => [...new Set(a)]),
};

const createModelBody = z.object({ ...modelFields, status: modelFields.status.default('ACTIVE'), capabilities: modelFields.capabilities.default([]) });
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
});

function parseId(params: unknown, what: string): number {
  const r = idParam.safeParse(params);
  if (!r.success) throw notFound(what);
  return r.data.id;
}

export async function catalogueRoutes(app: FastifyInstance) {
  // ---- read: any authenticated user -------------------------------------
  app.get('/providers', { preHandler: authenticate }, async () => listProviders(app.db));

  app.get('/models', { preHandler: authenticate }, async (request) => {
    const q = modelQuery.safeParse(request.query ?? {});
    if (!q.success) throw badRequest(zodFieldErrors(q.error.issues));
    return listModels(app.db, { ...q.data, search: q.data.search || undefined });
  });

  app.get('/models/:id', { preHandler: authenticate }, async (request) => {
    const id = parseId(request.params, 'That model');
    const model = await getModel(app.db, id);
    if (!model) throw notFound('That model');
    return { ...model, history: await getModelHistory(app.db, id) };
  });

  // ---- write: ADMIN only (checked server-side) ---------------------------
  app.post('/providers', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = providerBody.safeParse(request.body ?? {});
    if (!parsed.success) throw badRequest(zodFieldErrors(parsed.error.issues));
    if (await findProviderByName(app.db, parsed.data.name)) {
      throw conflict({ name: 'A provider with this name already exists.' }, 'That provider already exists.');
    }
    return reply.code(201).send(await createProvider(app.db, parsed.data));
  });

  app.post('/models', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = createModelBody.safeParse(request.body ?? {});
    if (!parsed.success) throw badRequest(zodFieldErrors(parsed.error.issues));
    if (!(await providerExists(app.db, parsed.data.providerId))) throw badRequest({ providerId: 'Choose a provider from the list.' });
    const id = await withTransaction(app.db, (tx) => createModel(tx, parsed.data, ADMIN_SOURCE)).catch(uniqueModel);
    return reply.code(201).send(await getModel(app.db, id));
  });

  app.patch('/models/:id', { preHandler: requireAdmin }, async (request) => {
    const id = parseId(request.params, 'That model');
    const parsed = patchModelBody.safeParse(request.body ?? {});
    if (!parsed.success) throw badRequest(zodFieldErrors(parsed.error.issues));
    if (parsed.data.providerId !== undefined && !(await providerExists(app.db, parsed.data.providerId))) {
      throw badRequest({ providerId: 'Choose a provider from the list.' });
    }
    await withTransaction(app.db, async (tx) => {
      // Lock the row so concurrent edits can't interleave history writes.
      const locked = await tx.query('SELECT 1 FROM ai_model WHERE model_id = $1 FOR UPDATE', [id]);
      if (!locked.rowCount) throw notFound('That model');
      const current = (await getModel(tx, id))!;
      await updateModel(tx, current, parsed.data, ADMIN_SOURCE);
    }).catch(uniqueModel);
    return getModel(app.db, id);
  });
}

function uniqueModel(err: unknown): never {
  if ((err as { code?: string }).code === '23505') {
    throw conflict({ name: 'This provider already has a model with that name and version.' }, 'That model already exists.');
  }
  throw err;
}
