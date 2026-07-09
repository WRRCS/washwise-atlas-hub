# Testing

Two test surfaces:

## Unit tests (Vitest)

```
bun run test
```

Location: `tests/unit/**/*.test.ts`. Fast, no browser, no network. Add pure-function tests here.

## End-to-end (Playwright)

Install browsers once:

```
bunx playwright install chromium
```

Run the public smoke suite (no auth):

```
bun run test:e2e
```

Run authenticated flows (requires a seeded test user):

```
E2E_USER_EMAIL=test@example.com E2E_USER_PASSWORD='...' bun run test:e2e
```

The dev server must be running at `http://localhost:8080` (or set `E2E_BASE_URL`).

### Preparing a test user

1. Create a user in Auth (email + password).
2. Sign in once through the app and complete onboarding so the user belongs to a tenant.
3. Set `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` env vars.

Authenticated specs automatically skip if the creds are missing, so `test:e2e` still runs the smoke suite in CI.
