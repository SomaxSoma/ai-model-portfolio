// Production build: bundle each entry point into dist/. Workspace packages
// (@pf/*, TypeScript source) are compiled in; every other dependency stays an
// external import resolved from node_modules at runtime (argon2 is native,
// BullMQ loads Lua scripts from its package folder).
import { build } from 'esbuild';
import { rm } from 'node:fs/promises';

const external = {
  name: 'externalise-dependencies',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith('@pf/') || args.path.startsWith('node:')) return null;
      return { path: args.path, external: true };
    });
  },
};

await rm('dist', { recursive: true, force: true });
await build({
  entryPoints: ['src/server.ts', 'src/worker.ts', 'src/migrate.ts', 'src/seed.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  plugins: [external],
  logLevel: 'info',
});
