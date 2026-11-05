import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth.js';
import { config } from '../config.js';
import { badRequest, conflict, forbidden, notFound, zodFieldErrors } from '../errors.js';
import { insertNotifications } from '../repositories/notifications.js';
import {
  cancelInvite,
  createInvite,
  createTeam,
  deleteTeam,
  invitesFor,
  listTeams,
  membershipRole,
  ownerCount,
  removeMember,
  renameTeam,
  respondToInvite,
  setMemberRole,
} from '../repositories/teams.js';
import { findUserByEmail } from '../repositories/users.js';
import { mailEnabled, sendMail } from '../services/mailer.js';

const idParam = z.object({ id: z.coerce.number().int().positive() });
const memberParam = z.object({ id: z.coerce.number().int().positive(), userId: z.coerce.number().int().positive() });
const inviteParam = z.object({ id: z.coerce.number().int().positive(), inviteId: z.coerce.number().int().positive() });
const teamName = z.string({ error: 'Give the team a name.' }).trim().min(2, 'The team name needs at least 2 characters.').max(80, 'Keep the team name under 80 characters.');
const email = z.string({ error: 'Enter an email address.' }).trim().max(254).refine((v) => /^[^\s@]+@[^\s@]+$/.test(v), 'Enter a valid email address.');

function param<T>(schema: z.ZodType<T>, params: unknown): T {
  const r = schema.safeParse(params);
  if (!r.success) throw notFound('That team');
  return r.data;
}

/**
 * Team workspaces. Every check is on the server: membership to see a team,
 * the OWNER role to invite, rename, change roles, remove others or delete.
 * Anyone can leave; the last owner can't (delete the team instead).
 */
export async function teamRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  const requireRole = async (teamId: number, userId: number, owner: boolean) => {
    const role = await membershipRole(app.db, teamId, userId);
    if (!role) throw notFound('That team');
    if (owner && role !== 'OWNER') throw forbidden('Only a team owner can do that.');
    return role;
  };
  const teamOf = async (teamId: number, userId: number) => (await listTeams(app.db, userId)).find((t) => t.id === teamId)!;

  app.get('/teams', async (request) => ({ teams: await listTeams(app.db, request.account.id), invites: await invitesFor(app.db, request.account.email) }));

  app.post('/teams', async (request, reply) => {
    if (request.account.isDemo) throw forbidden('Create a free account to start a team.');
    const parsed = z.object({ name: teamName }).safeParse(request.body ?? {});
    if (!parsed.success) throw badRequest(zodFieldErrors(parsed.error.issues));
    const id = await createTeam(app.db, request.account.id, parsed.data.name);
    return reply.code(201).send(await teamOf(id, request.account.id));
  });

  app.patch('/teams/:id', async (request) => {
    const { id } = param(idParam, request.params);
    await requireRole(id, request.account.id, true);
    const parsed = z.object({ name: teamName }).safeParse(request.body ?? {});
    if (!parsed.success) throw badRequest(zodFieldErrors(parsed.error.issues));
    await renameTeam(app.db, id, parsed.data.name);
    return teamOf(id, request.account.id);
  });

  app.delete('/teams/:id', async (request, reply) => {
    const { id } = param(idParam, request.params);
    await requireRole(id, request.account.id, true);
    await deleteTeam(app.db, id);
    return reply.code(204).send();
  });

  // ---- invitations ---------------------------------------------------------
  app.post('/teams/:id/invites', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { id } = param(idParam, request.params);
    await requireRole(id, request.account.id, true);
    const parsed = z.object({ email }).safeParse(request.body ?? {});
    if (!parsed.success) throw badRequest(zodFieldErrors(parsed.error.issues));
    const address = parsed.data.email.toLowerCase();
    const team = await teamOf(id, request.account.id);
    if (team.members.some((m) => m.email.toLowerCase() === address)) throw conflict({ email: 'That person is already in the team.' }, 'Already a member.');
    const inviteId = await createInvite(app.db, id, address, request.account.id);
    if (!inviteId) throw conflict({ email: 'That address already has an invitation waiting.' }, 'Already invited.');

    // Tell them: in the app if they have an account, and by email when email is set up.
    const invitee = await findUserByEmail(app.db, address);
    if (invitee) {
      await insertNotifications(app.db, [
        { userId: invitee.id, kind: 'TEAM_INVITE', severity: 'INFO', title: `${request.account.name} invited you to ${team.name}`, body: 'Join the team to see and edit the portfolios shared with it.', link: '/teams' },
      ]);
    }
    if (mailEnabled()) {
      await sendMail({
        to: address,
        subject: `${request.account.name} invited you to ${team.name} on Model Portfolio`,
        text: `${request.account.name} invited you to the team “${team.name}” on Model Portfolio.\n\nSign in (or create a free account) with this email address, then accept the invitation:\n${config.appUrl}/teams\n`,
      });
    }
    return reply.code(201).send(await teamOf(id, request.account.id));
  });

  app.delete('/teams/:id/invites/:inviteId', async (request, reply) => {
    const { id, inviteId } = param(inviteParam, request.params);
    await requireRole(id, request.account.id, true);
    if (!(await cancelInvite(app.db, id, inviteId))) throw notFound('That invitation');
    return reply.code(204).send();
  });

  /** Accept or decline an invitation addressed to your own email. */
  app.post('/invites/:id/:answer', async (request) => {
    const p = z.object({ id: z.coerce.number().int().positive(), answer: z.enum(['accept', 'decline']) }).safeParse(request.params);
    if (!p.success) throw notFound('That invitation');
    if (request.account.isDemo && p.data.answer === 'accept') throw forbidden('Create a free account to join a team.');
    const teamId = await respondToInvite(app.db, p.data.id, request.account, p.data.answer === 'accept');
    if (!teamId) throw notFound('That invitation');
    return { teams: await listTeams(app.db, request.account.id), invites: await invitesFor(app.db, request.account.email) };
  });

  // ---- members ---------------------------------------------------------------
  app.patch('/teams/:id/members/:userId', async (request) => {
    const { id, userId } = param(memberParam, request.params);
    await requireRole(id, request.account.id, true);
    const parsed = z.object({ role: z.enum(['OWNER', 'MEMBER']) }).safeParse(request.body ?? {});
    if (!parsed.success) throw badRequest({ role: 'Choose owner or member.' });
    if (parsed.data.role === 'MEMBER' && (await membershipRole(app.db, id, userId)) === 'OWNER' && (await ownerCount(app.db, id)) <= 1) {
      throw badRequest({ role: 'A team needs at least one owner.' }, 'A team needs at least one owner.');
    }
    if (!(await setMemberRole(app.db, id, userId, parsed.data.role))) throw notFound('That member');
    return teamOf(id, request.account.id);
  });

  /** Owners remove members; anyone may remove themselves (leave). */
  app.delete('/teams/:id/members/:userId', async (request, reply) => {
    const { id, userId } = param(memberParam, request.params);
    const self = userId === request.account.id;
    const myRole = await requireRole(id, request.account.id, !self);
    const theirRole = self ? myRole : await membershipRole(app.db, id, userId);
    if (!theirRole) throw notFound('That member');
    if (theirRole === 'OWNER' && (await ownerCount(app.db, id)) <= 1) {
      throw badRequest({ member: 'The last owner can’t leave. Make someone else an owner, or delete the team.' }, 'The last owner can’t leave.');
    }
    await removeMember(app.db, id, userId);
    return reply.code(204).send();
  });
}
