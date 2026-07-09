import { test, expect } from "@playwright/test";

// Authenticated end-to-end flows.
//
// These specs require a seeded test user in your Supabase project.
// Set these env vars before running (e.g. in .env.local — never commit):
//
//   E2E_BASE_URL=http://localhost:8080
//   E2E_USER_EMAIL=test-user@example.com
//   E2E_USER_PASSWORD=<strong-password>
//
// The test user must:
//   - be created via Auth (Supabase dashboard or magic-link once)
//   - have completed onboarding (belong to a tenant)
//
// Run with:  bun run test:e2e
//
// Skip suite when creds are not present so CI on public forks still passes.

const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD;
const hasCreds = !!email && !!password;

test.describe("authenticated flows", () => {
  test.skip(!hasCreds, "E2E_USER_EMAIL / E2E_USER_PASSWORD not set");

  test.beforeEach(async ({ page }) => {
    await page.goto("/auth");
    await page.locator('input[type="email"]').first().fill(email!);
    await page.locator('input[type="password"]').first().fill(password!);
    await page.getByRole("button", { name: /sign in|log in/i }).first().click();
    await page.waitForURL(/\/(dashboard|onboarding|calendar|jobs|clients)/, { timeout: 15_000 });
  });

  test("dashboard loads", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator("body")).toBeVisible();
  });

  test("can open clients page", async ({ page }) => {
    await page.goto("/clients");
    await expect(page).toHaveURL(/\/clients/);
  });

  test("can open leads page", async ({ page }) => {
    await page.goto("/leads");
    await expect(page).toHaveURL(/\/leads/);
  });

  test("can open jobs page", async ({ page }) => {
    await page.goto("/jobs");
    await expect(page).toHaveURL(/\/jobs/);
  });

  test("can open voice settings", async ({ page }) => {
    await page.goto("/settings/voice");
    await expect(page.getByText(/voice ai/i).first()).toBeVisible();
  });
});
