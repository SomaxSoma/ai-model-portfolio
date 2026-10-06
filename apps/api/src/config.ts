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
