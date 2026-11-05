import { expect, test, type Page } from '@playwright/test';

const ADMIN = { email: process.env.SEED_ADMIN_EMAIL ?? 'admin@example.test', password: process.env.SEED_ADMIN_PASSWORD ?? 'dev-admin-password' };

async function logIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

test('access control: signed-out users go to login, members never see the admin console', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
  const email = `member-${Date.now()}@example.test`;
  await page.goto('/register');
  await page.getByLabel('Name').fill('Member Test');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('member-password-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/models$/);
});

test('user journey: workload → recommendation → save → what-if → alerts', async ({ page }) => {
  const errors = trackErrors(page);
  const email = `journey-${Date.now()}@example.test`;
  await page.goto('/register');
  await page.getByLabel('Name').fill('Journey Tester');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('journey-password-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/spend smarter/i);

  // Validation is inline and nothing is submitted.
  await page.getByRole('link', { name: 'Workload', exact: true }).first().click();
  await page.getByLabel('Monthly budget').fill('0');
  await page.getByRole('button', { name: 'Calculate cost and recommend' }).click();
  await expect(page.getByText('Monthly budget must be more than $0.')).toBeVisible();
  await expect(page).toHaveURL(/\/workload$/);

  await page.getByLabel('Workload name').fill('E2E support bot');
  await page.getByLabel('Monthly budget').fill('500');
  await page.getByRole('button', { name: 'Calculate cost and recommend' }).click();
  await expect(page).toHaveURL(/\/recommendations\/\d+$/);
  await expect(page.locator('#pf-banner-headline')).toHaveText(/within budget/);
  await expect(page.getByText('Allocation totals 100%')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Provider risk' })).toBeVisible();

  await page.getByRole('button', { name: '5 of 5' }).click();
  await page.getByRole('button', { name: 'Send feedback' }).click();
  await expect(page.getByText('Thanks — recorded.')).toBeVisible();

  await page.getByRole('button', { name: 'Save portfolio' }).click();
  await expect(page).toHaveURL(/\/portfolios\/\d+$/);
  await expect(page.getByText('Portfolio saved.')).toBeVisible();

  await page.getByRole('button', { name: 'Run a what-if scenario' }).click();
  await expect(page).toHaveURL(/\/what-if$/);
  await page.getByRole('button', { name: 'Provider unavailable' }).click();
  await page.getByRole('button', { name: 'Run simulation' }).click();
  await expect(page.getByRole('heading', { name: /becomes unavailable\./ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Re-optimised' })).toBeVisible();

  await page.goto('/notifications');
  await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();

  expect(errors, errors.join('\n')).toEqual([]);
});

test('admin: evaluation metrics, manual ingestion run, operations and tabs', async ({ page }) => {
  const errors = trackErrors(page);
  await logIn(page, ADMIN.email, ADMIN.password);

  await page.goto('/admin?tab=evaluation');
  await expect(page.getByText('Cost-calculation correctness (primary)')).toBeVisible();
  await expect(page.getByText(/^17 \/ 17$/)).toBeVisible();

  await page.goto('/admin?tab=ingestion');
  // Whichever source is configured: the sample feed in CI, the live OpenRouter catalogue locally.
  await page.getByRole('button', { name: /^Run .+ now$/ }).first().click();
  await expect(page.getByText(/: \d+ records read/)).toBeVisible({ timeout: 60_000 });

  await page.goto('/admin?tab=ops');
  await expect(page.getByText('p95 response')).toBeVisible();

  for (const tab of ['Models & pricing', 'Providers', 'Data quality']) {
    await page.getByRole('tab', { name: tab }).click();
    await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
  }
  expect(errors, errors.join('\n')).toEqual([]);
});
