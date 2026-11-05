import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    env: {
      // Ingestion FILE sources read from the test fixtures, not the real data folder.
      DATA_DIR: resolve(import.meta.dirname, 'test', 'fixtures', 'feeds'),
      ALLOW_HTTP_SOURCES: 'true',
      SCHEDULER: 'off',
    },
  },
});
