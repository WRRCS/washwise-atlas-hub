
# Phase A — Multi-Tenant Foundation

Assumptions I'm proceeding with (say the word if either is wrong):
- Existing tenant stays as tenant #1; your account becomes `super_admin` alongside `owner`.
- Billing is deferred to Phase C. Onboarding will show plan tiers but not charge yet.

## What ships in this phase

1. **Public `/signup` page** — pricing tiers (Starter $49 / Growth $99 / Scale $199), business name + email + password, Google button. Creates the user; a DB trigger provisions a fresh tenant and assigns owner role.
2. **`/onboarding` wizard** — 6 steps, blocks the app until finished:
   1. Business profile (name, email, phone, address, timezone, locale EN/UK)
   2. Pick service types from a master list
   3. Set default price per selected service
   4. Set default duration per selected service
   5. Business hours + SMS quiet hours
   6. Confirm & land on dashboard (Stripe step stubbed — "Set up billing later")
3. **Onboarding gate** — any authenticated route redirects to `/onboarding` while `tenants.onboarding_completed = false`.
4. **Plan-tier field** stored on tenant (`starter` default) so Phase C can wire enforcement without another migration.
5. **`super_admin` role** added to the `app_role` enum so Phase B has a place to slot the console.

## Deferred to later phases

- Phase B: `/super-admin` console, impersonation, audit log, platform stats, support tickets.
- Phase C: Stripe subscription billing, tier limits (50/200/∞ jobs, AI query quotas), tenant-scoped feature flags, Billing settings page.
- Cross-tenant RLS audit (Phase B/C prep — I'll spot-check now but a full sweep across ~35 tables is its own prompt).

## Technical notes

- **Migration**
  - `ALTER TYPE app_role ADD VALUE 'super_admin'`.
  - `ALTER TABLE tenants ADD` columns: `business_email text`, `business_phone text`, `address text`, `timezone text default 'America/New_York'`, `locale text default 'en-US'`, `plan_tier text default 'starter' check (plan_tier in ('starter','growth','scale'))`, `onboarding_completed boolean default false`, `business_hours jsonb`, `quiet_hours jsonb`.
  - Backfill existing tenant with `onboarding_completed = true` so you're not forced through the wizard.
  - Grant your user the `super_admin` role.
  - Rewrite `handle_new_user()`:
    - If `raw_user_meta_data->>'signup_business_name'` is set → create new tenant with that name + selected `plan_tier`, insert profile + owner role scoped to the new tenant.
    - Else → keep current behavior (join default tenant, first user = owner).
  - Add `current_tenant_onboarding_completed()` security-definer helper for the gate.

- **Files**
  - Create `src/routes/signup.tsx` (public, SSR off — writes to `localStorage`).
  - Create `src/routes/_authenticated/onboarding.tsx` (wizard, uses shadcn Steps pattern).
  - Create `src/lib/onboarding.functions.ts` (server fns: `getOnboardingState`, `saveBusinessProfile`, `saveServiceSelections`, `completeOnboarding`).
  - Edit `src/routes/_authenticated/route.tsx` — after auth check, fetch onboarding state; if incomplete and route is not `/onboarding`, redirect.
  - Edit `src/routes/auth.tsx` — add small "New here? Start a free trial →" link to `/signup`.
  - Regenerate route tree.

- **Signup flow specifics**
  - `supabase.auth.signUp({ email, password, options: { data: { full_name, signup_business_name, plan_tier } } })`.
  - Trigger runs server-side, so the tenant exists before the client redirects. Client polls `getOnboardingState` once, then routes to `/onboarding`.

- **Not touched this phase**
  - Existing RLS policies (all already scope by `tenant_id` via `current_tenant_id()`, which pulls from `profiles`). New tenants get isolated automatically because their profile row points at the new tenant id.
  - `src/integrations/supabase/*` (auto-gen).

After you approve, I'll ship the migration + all files in one pass. Phase B starts on your next go.
