import { expect, test } from '@playwright/test';

// Runs in the "mobile" project (Pixel 7): no horizontal scroll, nav collapses.
test('mobile: no horizontal overflow and a working menu', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(process.env.SEED_ADMIN_EMAIL ?? 'admin@example.test');
  await page.getByLabel('Password').fill(process.env.SEED_ADMIN_PASSWORD ?? 'dev-admin-password');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  for (const path of ['/dashboard', '/models', '/workload', '/compare', '/admin?tab=models', '/admin?tab=evaluation']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);
  }

  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.locator('#pf-nav-sheet').getByRole('link', { name: 'Catalogue', exact: true }).click();
  await expect(page).toHaveURL(/\/models$/);
});
