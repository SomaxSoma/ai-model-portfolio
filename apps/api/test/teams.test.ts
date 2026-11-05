import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createPool, type Db } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { seed } from '../src/seed.js';
import { freshDatabase } from './helpers.js';

let db: Db;
let app: FastifyInstance;

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, token?: string, payload?: unknown) {
  const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: payload as any });
  return { status: res.statusCode, body: res.body ? res.json() : null };
}
const register = async (name: string, email: string) => (await call('POST', '/auth/register', undefined, { name, email, password: 'password-123' })).body.token as string;

let owner: string;
let mate: string;
let outsider: string;
let teamId: number;
let portfolioId: number;

beforeAll(async () => {
  db = createPool(await freshDatabase('teams'));
  await migrate(db);
  await seed(db, { sample: true });
  app = await buildApp({ db, authRateLimit: 1000 });
  owner = await register('Olive Owner', 'olive@example.test');
  mate = await register('Matt Mate', 'matt@example.test');
  outsider = await register('Otto Outsider', 'otto@example.test');

  // Olive saves a portfolio from a recommendation.
  const w = await call('POST', '/workloads', owner, { name: 'Shared bot', inputTokens: 1500, outputTokens: 400, requestsPerMonth: 20000, budget: '500', requiredCapabilities: [] });
  const rec = await call('POST', `/workloads/${w.body.id}/recommendation`, owner);
  const p = await call('POST', '/portfolios', owner, {
    workloadId: w.body.id,
    recommendationId: rec.body.id,
    name: 'Team mix',
    budget: '500',
    allocations: rec.body.allocations.map((a: any) => ({ modelId: a.modelId, allocationPercentage: a.allocationPercentage })),
  });
  portfolioId = p.body.id;
});
afterAll(async () => {
  await app.close();
  await db.end();
});

describe('teams and invitations', () => {
  it('creates a team with the creator as owner', async () => {
    const r = await call('POST', '/teams', owner, { name: 'Platform' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ name: 'Platform', role: 'OWNER' });
    teamId = r.body.id;
    expect((await call('POST', '/teams', owner, { name: 'X' })).status).toBe(400);
  });

  it('only owners invite; the invitee is notified and can accept', async () => {
    expect((await call('POST', `/teams/${teamId}/invites`, outsider, { email: 'matt@example.test' })).status).toBe(404);
    const inv = await call('POST', `/teams/${teamId}/invites`, owner, { email: 'Matt@Example.test' });
    expect(inv.status).toBe(201);
    expect(inv.body.invites).toHaveLength(1);
    expect((await call('POST', `/teams/${teamId}/invites`, owner, { email: 'matt@example.test' })).status).toBe(409);

    const notes = await call('GET', '/notifications', mate);
    expect(notes.body.items.some((n: any) => n.kind === 'TEAM_INVITE')).toBe(true);
    const mine = await call('GET', '/teams', mate);
    expect(mine.body.invites).toHaveLength(1);
    // Someone else can't answer Matt's invitation.
    expect((await call('POST', `/invites/${mine.body.invites[0].id}/accept`, outsider)).status).toBe(404);
    const accepted = await call('POST', `/invites/${mine.body.invites[0].id}/accept`, mate);
    expect(accepted.body.teams[0]).toMatchObject({ id: teamId, role: 'MEMBER' });
  });
});

describe('shared portfolios', () => {
  it('is private until shared; only the creator shares, and only to their own teams', async () => {
    expect((await call('GET', `/portfolios/${portfolioId}`, mate)).status).toBe(404);
    const otherTeam = (await call('POST', '/teams', outsider, { name: 'Elsewhere' })).body.id;
    expect((await call('PATCH', `/portfolios/${portfolioId}/team`, owner, { teamId: otherTeam })).status).toBe(400);
    const shared = await call('PATCH', `/portfolios/${portfolioId}/team`, owner, { teamId });
    expect(shared.status).toBe(200);
    expect(shared.body.team).toEqual({ id: teamId, name: 'Platform' });
  });

  it('members can open, edit and stress-test it; outsiders still get 404', async () => {
    const view = await call('GET', `/portfolios/${portfolioId}`, mate);
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ isOwner: false, ownerName: 'Olive Owner' });
    expect((await call('GET', '/portfolios', mate)).body.map((p: any) => p.id)).toContain(portfolioId);
    const edit = await call('PATCH', `/portfolios/${portfolioId}`, mate, { name: 'Team mix v2' });
    expect(edit.status).toBe(200);
    expect(edit.body.name).toBe('Team mix v2');
    expect((await call('GET', `/portfolios/${portfolioId}/risk`, mate)).status).toBe(200);
    expect((await call('GET', `/portfolios/${portfolioId}`, outsider)).status).toBe(404);
    expect((await call('PATCH', `/portfolios/${portfolioId}`, outsider, { name: 'x' })).status).toBe(404);
    // Sharing is the creator's call; a member can't move it.
    expect((await call('PATCH', `/portfolios/${portfolioId}/team`, mate, { teamId: null })).status).toBe(404);
    // Members can't delete it; the creator (or a team owner) can.
    expect((await call('DELETE', `/portfolios/${portfolioId}`, mate)).status).toBe(404);
  });

  it('a member can duplicate it into their own account, workload and all', async () => {
    const copy = await call('POST', `/portfolios/${portfolioId}/duplicate`, mate);
    expect(copy.status).toBe(201);
    expect(copy.body).toMatchObject({ name: 'Copy of Team mix v2', isOwner: true, team: null });
    const theirWorkloads = (await call('GET', '/workloads', mate)).body;
    expect(theirWorkloads.map((w: any) => w.id)).toContain(copy.body.workloadId);
    expect((await call('DELETE', `/portfolios/${copy.body.id}`, mate)).status).toBe(204);
  });

  it('leaving the team removes access; the last owner cannot leave', async () => {
    expect((await call('DELETE', `/teams/${teamId}/members/${(await call('GET', '/me', owner)).body.id}`, owner)).status).toBe(400);
    const mateId = (await call('GET', '/me', mate)).body.id;
    expect((await call('DELETE', `/teams/${teamId}/members/${mateId}`, mate)).status).toBe(204);
    expect((await call('GET', `/portfolios/${portfolioId}`, mate)).status).toBe(404);
  });

  it('deleting a team returns its portfolios to their creators', async () => {
    expect((await call('DELETE', `/teams/${teamId}`, mate)).status).toBe(404);
    expect((await call('DELETE', `/teams/${teamId}`, owner)).status).toBe(204);
    const p = await call('GET', `/portfolios/${portfolioId}`, owner);
    expect(p.status).toBe(200);
    expect(p.body.team).toBeNull();
  });

  it('demo accounts cannot start teams', async () => {
    const demo = (await call('POST', '/auth/demo')).body.token;
    expect((await call('POST', '/teams', demo, { name: 'Demo team' })).status).toBe(403);
  });
});
