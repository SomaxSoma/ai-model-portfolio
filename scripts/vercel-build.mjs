// Vercel build (vercel.json → buildCommand). Produces the Build Output API v3
// layout in .vercel/output:
//   static/                 the web app (apps/web/dist)
//   functions/api.func/     the Fastify API as one Node function, bundled with
//                           esbuild; its runtime dependencies (argon2's native
//                           binary included) are traced with @vercel/nft
//   config.json             routes (/api/* → function, SPA fallback), security
//                           headers and the cron schedule
// When DATABASE_URL is set (Neon via the Vercel integration), the schema is
// migrated and the seed (administrator + live OpenRouter catalogue) runs first.
import { execSync } from 'node:child_process';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { nodeFileTrace } from '@vercel/nft';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const out = join(root, '.vercel', 'output');
const run = (cmd, env = {}) => execSync(cmd, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
const fail = (msg) => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};

// ── 0. Refuse unsafe production settings before anything is built ──────────
const onVercel = Boolean(process.env.VERCEL);
if (onVercel) {
  if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set. Connect a Neon database: Project → Storage → Neon.');
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) fail('JWT_SECRET must be set to a random string of at least 32 characters.');
  if (!process.env.SEED_ADMIN_EMAIL || !process.env.SEED_ADMIN_PASSWORD) fail('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set (the first administrator).');
  if (process.env.SEED_ADMIN_PASSWORD === 'dev-admin-password' || process.env.SEED_ADMIN_PASSWORD.length < 12) fail('SEED_ADMIN_PASSWORD must be a real password of at least 12 characters.');
}

// ── 1. Database: migrate + seed (idempotent; also refreshes the live catalogue) ──
if (process.env.DATABASE_URL) {
  // Migrations want a direct (unpooled) connection when Neon provides one.
  const env = { DATABASE_URL: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL };
  run('npm run migrate', env);
  run('npm run seed', env);
} else {
  console.log('DATABASE_URL not set: skipping migrate/seed (local dry run).');
}

// ── 2. Web app ─────────────────────────────────────────────────────────────
run('npm run build -w @pf/web');
await rm(out, { recursive: true, force: true });
await cp(join(root, 'apps/web/dist'), join(out, 'static'), { recursive: true });

// ── 3. API function ────────────────────────────────────────────────────────
const fnDir = join(out, 'functions', 'api.func');
const entryRel = 'apps/api/.vercel-fn/index.mjs';
const entry = join(root, entryRel);
await rm(dirname(entry), { recursive: true, force: true });
await build({
  entryPoints: [join(root, 'apps/api/src/vercel.ts')],
  outfile: entry,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  logLevel: 'warning',
  plugins: [
    {
      // Workspace packages (@pf/*, TypeScript source) are compiled in; every
      // other dependency stays external and is traced into the function below.
      name: 'externalise-dependencies',
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) => (args.kind === 'entry-point' || args.path.startsWith('@pf/') || args.path.startsWith('node:') ? null : { path: args.path, external: true }));
      },
    },
  ],
});
const { fileList, warnings } = await nodeFileTrace([entry], { base: root });
for (const w of warnings) if (!String(w.message).includes('Failed to resolve dependency')) console.warn(`nft: ${w.message}`);
for (const file of fileList) {
  const target = join(fnDir, file);
  await mkdir(dirname(target), { recursive: true });
  await cp(join(root, file), target, { dereference: true, recursive: true });
}
await writeFile(
  join(fnDir, '.vc-config.json'),
  JSON.stringify({ runtime: 'nodejs22.x', handler: entryRel, launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 60 }, null, 2),
);
console.log(`api function: ${fileList.size} files traced`);

// ── 4. Routing, headers, cron ──────────────────────────────────────────────
const security = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
};
await writeFile(
  join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/(.*)$', headers: security, continue: true },
        { src: '^/assets/(.*)$', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
        // The REST API, same origin; the function restores the path from __pf_path.
        { src: '^/api/?(.*)$', dest: '/api?__pf_path=$1' },
        { handle: 'filesystem' },
        // Single-page app: every other path serves index.html.
        { src: '^/(.*)$', dest: '/index.html' },
      ],
      // Daily live-catalogue sync + freshness check (Hobby plans allow one run a day;
      // on Pro, change to "0 * * * *" for hourly).
      crons: [{ path: '/api/cron/run', schedule: '0 6 * * *' }],
    },
    null,
    2,
  ),
);
console.log(`✓ Build Output written to ${out}`);
