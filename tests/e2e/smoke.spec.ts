import { test, expect } from "@playwright/test";

// Public smoke tests — no auth required.
// These verify the app boots, key public routes render, and don't crash.

test("auth page loads and shows sign-in UI", async ({ page }) => {
  await page.goto("/auth");
  await expect(page).toHaveURL(/\/auth/);
  // Look for common sign-in surface (email input or a heading)
  const emailInput = page.locator('input[type="email"]').first();
  await expect(emailInput).toBeVisible({ timeout: 10_000 });
});

test("root route redirects or renders without crashing", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBeLessThan(500);
});

test("unknown route shows not-found (no 500)", async ({ page }) => {
  const response = await page.goto("/this-route-does-not-exist-xyz");
  expect(response?.status()).toBeLessThan(500);
});
