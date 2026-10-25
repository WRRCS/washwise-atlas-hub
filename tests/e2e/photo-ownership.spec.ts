import { test, expect } from '@playwright/test';

// Isolated accounts/appointments only. Never pass real staff credentials or job IDs.
const job = process.env.E2E_PHOTO_JOB;
const nextJob = process.env.E2E_PHOTO_NEXT_JOB;
const users = [
  { email: process.env.E2E_PHOTO_A_EMAIL, password: process.env.E2E_PHOTO_A_PASSWORD, count: 2, name: 'Photo Test A' },
  { email: process.env.E2E_PHOTO_B_EMAIL, password: process.env.E2E_PHOTO_B_PASSWORD, count: 1, name: 'Photo Test B' },
];

test.describe('permanent photo ownership', () => {
  test.skip(!job || !nextJob || users.some(u => !u.email || !u.password), 'Requires isolated two-cleaner photo fixtures');
  for (const [index, user] of users.entries()) {
    test(`cleaner ${index + 1} sees only their images after refresh and occurrence switching`, async ({ page }) => {
      if (!job || !nextJob || !user.email || !user.password) return;
      await page.goto('/auth');
      await page.getByLabel('Email', { exact: true }).fill(user.email);
      await page.locator('input[type="password"]').fill(user.password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.waitForURL(/\/(my-jobs|dashboard|calendar)/);
      await page.goto(`/jobs/${job}`);
      await page.getByRole('tab', { name: 'Photos', exact: true }).click();
      await expect(page.getByRole('button', { name: `Download all (${user.count})`, exact: true })).toBeVisible();
      await expect(page.locator('button.aspect-square img')).toHaveCount(user.count);
      await expect(page.locator('button.aspect-square').locator('..').filter({ hasText: users[1 - index].name })).toHaveCount(0);
      await page.reload();
      await page.getByRole('tab', { name: 'Photos', exact: true }).click();
      await expect(page.getByRole('button', { name: `Download all (${user.count})`, exact: true })).toBeVisible();
      await page.goto(`/jobs/${nextJob}`);
      await page.getByRole('tab', { name: 'Photos', exact: true }).click();
      await expect(page.getByText('No photos yet.', { exact: true })).toBeVisible();
      await expect(page.locator('button.aspect-square img')).toHaveCount(0);
      await page.goto(`/jobs/${job}`);
      await page.getByRole('tab', { name: 'Photos', exact: true }).click();
      await expect(page.locator('button.aspect-square img')).toHaveCount(user.count);
    });
  }
});