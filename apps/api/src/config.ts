import { resolve } from 'node:path';

// Optional repo-root .env (see .env.example). Real environment variables win.
try {
  process.loadEnvFile(resolve(import.meta.dirname, '..', '..', '..', '.env'));
} catch {
  // no .env file: defaults below apply
}

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3001),
  host: env.HOST ?? '127.0.0.1',
  databaseUrl: env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/portfolio',
  jwtSecret: env.JWT_SECRET ?? 'dev-only-secret-change-me-before-deploying-anywhere',
  tokenTtl: env.TOKEN_TTL ?? '12h',
  /** Redis for cache + job queue (proposal §8). Optional: without it the API uses an in-memory cache and an in-process scheduler. */
  redisUrl: env.REDIS_URL || undefined,
  /**
   * Where scheduled jobs run: 'inline' = inside the API process (dev default),
   * 'off' = not in this process (a separate worker runs them).
   */
  scheduler: (env.SCHEDULER ?? 'inline') as 'inline' | 'off',
  /** Base URL of the OpenRouter public API (the live catalogue source). */
  openRouterUrl: env.OPENROUTER_URL ?? 'https://openrouter.ai/api/v1',
  /** Folder FILE ingestion sources may read from. */
  dataDir: resolve(env.DATA_DIR ?? resolve(import.meta.dirname, '..', '..', '..', 'data')),
  /** Plain-http ingestion sources are refused unless explicitly allowed (tests, local mirrors). */
  allowHttpSources: env.ALLOW_HTTP_SOURCES === 'true',
  /** Login/registration attempts per IP per minute. */
  authRateLimit: Number(env.AUTH_RATE_LIMIT ?? 20),
  /** Shared secret Vercel Cron sends as a bearer token to /cron/run. Unset = the endpoint is disabled. */
  cronSecret: env.CRON_SECRET || undefined,
  /**
   * Public address of the web app, for links in emails and sign-in redirects.
   * On Vercel the production URL is used when APP_URL isn't set.
   */
  appUrl: (env.APP_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:5173')).replace(/\/$/, ''),
  /**
   * Email. Either SMTP (e.g. Gmail: GMAIL_USER + GMAIL_APP_PASSWORD, or any
   * provider via SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS) or Resend
   * (RESEND_API_KEY + MAIL_FROM). With neither, password reset and email
   * alerts are switched off.
   */
  mail: {
    resendApiKey: env.RESEND_API_KEY || undefined,
    from: env.MAIL_FROM || (env.GMAIL_USER ? `Model Portfolio <${env.GMAIL_USER}>` : undefined),
    smtp:
      env.GMAIL_USER && env.GMAIL_APP_PASSWORD
        ? { host: 'smtp.gmail.com', port: 465, user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD.replace(/\s+/g, '') }
        : env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS
          ? { host: env.SMTP_HOST, port: Number(env.SMTP_PORT ?? 465), user: env.SMTP_USER, pass: env.SMTP_PASS }
          : undefined,
  },
  /** Sign in with Google / GitHub: each is enabled when its client id and secret are set. */
  oauth: {
    google: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } : undefined,
    github: env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } : undefined,
  },
  /** Demo accounts are removed after this many hours. */
  demoTtlHours: Number(env.DEMO_TTL_HOURS ?? 24),
  /** First administrator, created by the seed if no admin exists yet. */
  seedAdmin: {
    name: env.SEED_ADMIN_NAME ?? 'Catalogue Admin',
    email: env.SEED_ADMIN_EMAIL ?? 'admin@example.test',
    password: env.SEED_ADMIN_PASSWORD ?? 'dev-admin-password',
  },
};

if (env.NODE_ENV === 'production' && !env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}
