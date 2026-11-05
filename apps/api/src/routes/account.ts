import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { normaliseWeights, recommend } from '@pf/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate, hashPassword, issueToken, verifyPassword } from '../auth.js';
import { config } from '../config.js';
import { withTransaction } from '../db.js';
import { badRequest, HttpError, notFound, zodFieldErrors } from '../errors.js';
import { insertPortfolio } from '../repositories/portfolios.js';
import { insertRecommendation, linkPortfolio } from '../repositories/recommendations.js';
import {
  adminCount,
  consumePasswordReset,
  createUser,
  deleteUser,
  findUserByEmail,
  findUserById,
  findUserByIdentity,
  insertPasswordReset,
  linkIdentity,
  recentResetCount,
  setPassword,
  updateProfile,
  type UserDto,
} from '../repositories/users.js';
import { createWorkload } from '../repositories/workloads.js';
import { mailEnabled, sendMail } from '../services/mailer.js';
import { catalogueModels } from './planning.js';

const RESET_MINUTES = 30;
const MAX_RESETS_PER_HOUR = 3;
const OAUTH_COOKIE = 'pf_oauth';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const email = z.string({ error: 'Enter your email address.' }).trim().max(254).refine((v) => /^[^\s@]+@[^\s@]+$/.test(v), 'Enter a valid email address.');
const newPassword = z.string({ error: 'Choose a password.' }).min(8, 'Use at least 8 characters for your password.').max(200, 'That password is too long.');

/** Only same-site paths survive a round trip through a sign-in provider. */
function safeNext(raw: unknown): string {
  return typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\') ? raw.slice(0, 500) : '/dashboard';
}

type ProviderName = 'google' | 'github';

/** The provider rejected this site's own client id/secret: a configuration problem, not the user's. */
class OAuthConfigError extends Error {}
/** The provider's token endpoint said why it refused; tell misconfiguration apart from a bad/expired code. */
function tokenError(provider: string, body: { error?: string }): Error {
  if (body.error === 'invalid_client' || body.error === 'incorrect_client_credentials' || body.error === 'unauthorized_client') {
    return new OAuthConfigError(`Sign-in with ${provider} isn’t set up correctly on this site yet.`);
  }
  return new Error(`${provider} did not return an access token (${body.error ?? 'no reason given'}).`);
}
interface ProviderProfile {
  subject: string;
  email: string;
  name: string;
}

const PROVIDERS: Record<ProviderName, { authorize: string; scope: string; profile: (code: string, redirectUri: string) => Promise<ProviderProfile> }> = {
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    scope: 'openid email profile',
    profile: async (code, redirectUri) => {
      const c = config.oauth.google!;
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
        signal: AbortSignal.timeout(10_000),
      });
      const token = (await tokenRes.json()) as { access_token?: string; error?: string };
      if (!token.access_token) throw tokenError('Google', token);
      const info = (await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(10_000) })).json()) as {
        sub?: string;
        email?: string;
        email_verified?: boolean;
        name?: string;
      };
      if (!info.sub || !info.email || info.email_verified !== true) throw new Error('Your Google account has no verified email address.');
      return { subject: info.sub, email: info.email, name: info.name ?? info.email.split('@')[0]! };
    },
  },
  github: {
    authorize: 'https://github.com/login/oauth/authorize',
    scope: 'read:user user:email',
    profile: async (code, redirectUri) => {
      const c = config.oauth.github!;
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: c.clientId, client_secret: c.clientSecret, code, redirect_uri: redirectUri }),
        signal: AbortSignal.timeout(10_000),
      });
      const token = (await tokenRes.json()) as { access_token?: string; error?: string };
      if (!token.access_token) throw tokenError('GitHub', token);
      const headers = { authorization: `Bearer ${token.access_token}`, accept: 'application/vnd.github+json', 'user-agent': 'model-portfolio' };
      const user = (await (await fetch('https://api.github.com/user', { headers, signal: AbortSignal.timeout(10_000) })).json()) as { id?: number; name?: string | null; login?: string };
      const emails = (await (await fetch('https://api.github.com/user/emails', { headers, signal: AbortSignal.timeout(10_000) })).json()) as { email: string; primary: boolean; verified: boolean }[];
      const primary = Array.isArray(emails) ? emails.find((e) => e.primary && e.verified) : undefined;
      if (!user.id || !primary) throw new Error('Your GitHub account has no verified primary email address.');
      return { subject: String(user.id), email: primary.email, name: user.name || user.login || primary.email.split('@')[0]! };
    },
  },
};

const enabledProviders = (): ProviderName[] => (Object.keys(PROVIDERS) as ProviderName[]).filter((p) => !!config.oauth[p]);
const redirectUriFor = (p: ProviderName) => `${config.appUrl}/api/auth/oauth/${p}/callback`;

function readCookie(request: FastifyRequest, name: string): string | undefined {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

function sameString(a: string, b: string): boolean {
  const x = Buffer.from(sha256(a));
  const y = Buffer.from(sha256(b));
  return timingSafeEqual(x, y);
}

export async function accountRoutes(app: FastifyInstance) {
  const limited = { config: { rateLimit: { max: app.authRateLimit, timeWindow: '1 minute' } } };
  const issue = (user: UserDto) => issueToken(app, user);

  /** What the sign-in screen can offer on this deployment. */
  app.get('/auth/options', async () => ({ passwordReset: mailEnabled(), emailAlerts: mailEnabled(), providers: enabledProviders(), demo: true }));

  // ---- forgot / reset password ------------------------------------------
  app.post('/auth/forgot', limited, async (request, reply) => {
    const parsed = z.object({ email }).safeParse(request.body ?? {});
    if (!parsed.success) throw badRequest(zodFieldErrors(parsed.error.issues));
    if (!mailEnabled() && process.env.NODE_ENV === 'production') throw new HttpError(503, 'Password reset by email isn’t set up on this site yet.');
    // Same answer whether or not the account exists, so this can't be used to discover accounts.
    const found = await findUserByEmail(app.db, parsed.data.email);
    if (found && !found.isDemo && (await recentResetCount(app.db, found.id)) < MAX_RESETS_PER_HOUR) {
      const token = randomBytes(32).toString('base64url');
      await insertPasswordReset(app.db, found.id, sha256(token), RESET_MINUTES);
      const link = `${config.appUrl}/reset-password?token=${token}`;
      await sendMail(
        {
          to: found.email,
          subject: 'Reset your Model Portfolio password',
          text: `Hi ${found.name},\n\nSomeone asked to reset the password for this account. To choose a new one, open this link within ${RESET_MINUTES} minutes:\n\n${link}\n\nIf it wasn’t you, ignore this email — your password stays the same.\n`,
        },
        (m) => app.log.info(m),
      );
    }
    return reply.code(202).send({ message: 'If an account uses that address, we’ve emailed a link to reset its password. It works for 30 minutes.' });
  });

  app.post('/auth/reset', limited, async (request) => {
    const parsed = z.object({ token: z.string().min(20).max(200), password: newPassword }).safeParse(request.body ?? {});
    if (!parsed.success) throw badRequest(zodFieldErrors(parsed.error.issues));
    const userId = await consumePasswordReset(app.db, sha256(parsed.data.token));
    if (!userId) throw badRequest({ token: 'This reset link has expired or was already used. Ask for a new one.' }, 'This reset link has expired or was already used.');
    await setPassword(app.db, userId, await hashPassword(parsed.data.password));
    return await issue((await findUserById(app.db, userId))!);
  });

  // ---- demo: a fresh disposable account with a sample portfolio -----------
  app.post('/auth/demo', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const user = await createUser(app.db, { name: 'Demo visitor', email: `demo-${randomBytes(8).toString('hex')}@demo.invalid`, passwordHash: null, isDemo: true });
    const catalogue = await catalogueModels(app.db, app.cache);
    const workload = await createWorkload(app.db, user.id, {
      name: 'Customer support assistant',
      inputTokens: 1500,
      outputTokens: 400,
      requestsPerMonth: 50_000,
      budget: '300.0000',
      requiredCapabilities: [],
      scoringWeights: null,
      cachedInputPercent: 0,
      qualityBasis: 'BLENDED',
    });
    const weights = normaliseWeights(null);
    const rec = recommend(catalogue, workload, { weights });
    if (rec.allocations.length) {
      const stored = await insertRecommendation(app.db, workload.id, rec, weights);
      await withTransaction(app.db, async (tx) => {
        const pid = await insertPortfolio(
          tx,
          { userId: user.id, workloadId: workload.id, name: 'Support assistant (demo)', budget: workload.budget },
          rec.allocations.map((a) => ({ modelId: a.model.id, allocationPercentage: a.allocationPercentage, estimatedCost: a.estimatedCost.toFixed(4) })),
        );
        await linkPortfolio(tx, stored.id, pid);
      });
    }
    request.log.info({ userId: user.id }, 'demo account created');
    return reply.code(201).send(await issue(user));
  });

  // ---- the signed-in account --------------------------------------------
  app.patch('/me', { preHandler: authenticate }, async (request) => {
    const parsed = z
      .object({
        name: z.string().trim().min(2, 'Your name needs at least 2 characters.').max(120, 'Keep your name under 120 characters.').optional(),
        emailAlerts: z.boolean().optional(),
      })
      .strict()
      .safeParse(request.body ?? {});
    if (!parsed.success) throw badRequest(zodFieldErrors(parsed.error.issues));
    if (parsed.data.emailAlerts && !mailEnabled()) throw badRequest({ emailAlerts: 'Email isn’t set up on this site yet.' });
    return updateProfile(app.db, request.account.id, parsed.data);
  });

  /** Deletes the account and everything it owns. Password accounts confirm with their password. */
  app.delete('/me', { preHandler: authenticate }, async (request, reply) => {
    const me = request.account;
    if (me.hasPassword) {
      const parsed = z.object({ password: z.string({ error: 'Enter your password to confirm.' }).min(1, 'Enter your password to confirm.') }).safeParse(request.body ?? {});
      if (!parsed.success) throw badRequest(zodFieldErrors(parsed.error.issues));
      const found = await findUserByEmail(app.db, me.email);
      if (!found || !(await verifyPassword(found.passwordHash, parsed.data.password))) throw badRequest({ password: 'That password isn’t right.' });
    }
    if (me.role === 'ADMIN' && (await adminCount(app.db)) <= 1) {
      throw badRequest({ account: 'You’re the only administrator. Make someone else an administrator first.' }, 'The last administrator can’t be deleted.');
    }
    await deleteUser(app.db, me.id);
    return reply.code(204).send();
  });

  // ---- sign in with Google / GitHub ---------------------------------------
  const providerParam = z.object({ provider: z.enum(['google', 'github']) });

  app.get('/auth/oauth/:provider/start', async (request, reply) => {
    const p = providerParam.safeParse(request.params);
    if (!p.success || !config.oauth[p.data.provider]) throw notFound('That sign-in option');
    const provider = p.data.provider;
    const nonce = randomBytes(16).toString('base64url');
    const next = safeNext((request.query as Record<string, unknown>)?.next);
    // State is signed (can't be forged) and bound to this browser by the nonce cookie (login-CSRF).
    const state = app.jwt.sign({ sub: 'oauth', provider, nonce, next } as never, { expiresIn: '10m' });
    reply.header('set-cookie', `${OAUTH_COOKIE}=${nonce}; Path=/api/auth/oauth; HttpOnly; SameSite=Lax; Max-Age=600${config.appUrl.startsWith('https') ? '; Secure' : ''}`);
    const url = new URL(PROVIDERS[provider].authorize);
    url.search = new URLSearchParams({ client_id: config.oauth[provider]!.clientId, redirect_uri: redirectUriFor(provider), response_type: 'code', scope: PROVIDERS[provider].scope, state }).toString();
    return reply.redirect(url.toString());
  });

  app.get('/auth/oauth/:provider/callback', async (request, reply) => {
    const back = (params: Record<string, string>) => reply.header('set-cookie', `${OAUTH_COOKIE}=; Path=/api/auth/oauth; Max-Age=0`).redirect(`${config.appUrl}/login#${new URLSearchParams(params)}`);
    const p = providerParam.safeParse(request.params);
    if (!p.success || !config.oauth[p.data.provider]) throw notFound('That sign-in option');
    const provider = p.data.provider;
    const q = (request.query ?? {}) as Record<string, string | undefined>;
    let state: { provider?: string; nonce?: string; next?: string };
    try {
      state = app.jwt.verify<{ provider?: string; nonce?: string; next?: string }>(q.state ?? '');
    } catch {
      return back({ error: 'That sign-in link expired. Please try again.' });
    }
    const cookie = readCookie(request, OAUTH_COOKIE);
    if (state.provider !== provider || !state.nonce || !cookie || !sameString(cookie, state.nonce)) return back({ error: 'Sign-in couldn’t be verified. Please try again.' });
    if (!q.code) return back({ error: 'Sign-in was cancelled.' });
    try {
      const profile = await PROVIDERS[provider].profile(q.code, redirectUriFor(provider));
      let user = await findUserByIdentity(app.db, provider, profile.subject);
      if (!user) {
        // Link to an existing account only through an address the provider has verified.
        const existing = await findUserByEmail(app.db, profile.email);
        user = existing && !existing.isDemo ? existing : await createUser(app.db, { name: profile.name.slice(0, 120).padEnd(2, '.'), email: profile.email.toLowerCase(), passwordHash: null });
        await linkIdentity(app.db, user.id, provider, profile.subject);
      }
      const { token } = await issue(user);
      return back({ token, next: safeNext(state.next) });
    } catch (err) {
      request.log.warn({ err }, 'oauth sign-in failed');
      const msg = (err as Error).message;
      return back({ error: err instanceof OAuthConfigError || msg.startsWith('Your ') ? msg : 'Sign-in failed. Please try again.' });
    }
  });
}

