import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests (proposal §8: frontend/API testing framework).
 * Locally they reuse running dev servers (npm run dev:api / dev:web); in CI
 * they start the API and a production build of the web app.
 */
const CI = !!process.env.CI;
const WEB = process.env.WEB_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testIgnore: /responsive\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /responsive\.spec\.ts/ },
  ],
  webServer: process.env.PW_NO_SERVER
    ? undefined
    : [
        { command: 'npm run start -w @pf/api', url: 'http://127.0.0.1:3001/health', reuseExistingServer: !CI, timeout: 60_000 },
        {
          command: CI ? 'npm run build -w @pf/web && npm run preview -w @pf/web -- --port 5173 --strictPort' : 'npm run dev:web',
          url: WEB,
          reuseExistingServer: !CI,
          timeout: 180_000,
        },
      ],
});
