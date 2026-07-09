# Fix critical billing, auth, and entitlement gaps

Scope: the 7 critical items from the audit. Important / nice-to-have items (business profile fields, downgrade guard, custom-domain returns, session verification on `/pay/return`, `invoice.payment_failed` handling) are deferred to a follow-up pass.

## What we're fixing

### 1. Create the three Stripe subscription products
`billing.functions.ts:111` looks up `atlas_starter_monthly`, `atlas_growth_monthly`, `atlas_scale_monthly` — nothing ever created them, so every plan checkout errors with "Price not found". Create products with correct SaaS tax code and monthly recurring prices ($49 / $99 / $199).

### 2. Fix invited employees landing in the wrong tenant
`inviteEmployee` (`entities.functions.ts:385`) doesn't pass `signup_business_name`, so `handle_new_user` falls through to the legacy path that hard-codes tenant `00000000-…-0001`. After `inviteUserByEmail`, force the new user's profile.tenant_id and user_roles row onto the inviter's tenant with the `employee` role.

### 3. Password reset flow
Add `/forgot-password` (calls `supabase.auth.resetPasswordForEmail` with `redirectTo: /reset-password`) and `/reset-password` (public route, reads recovery hash, calls `supabase.auth.updateUser({ password })`). Link "Forgot password?" from `/auth`.

### 4. Access gating: 7-day grace, then lock
Add a check in `_authenticated/route.tsx` `beforeLoad`: if `tenants.subscription_status IN ('past_due','canceled')` AND `updated_at < now() - 7 days`, redirect all routes except `/settings/billing` to `/settings/billing`. Show a countdown banner during the grace period.

Add a `subscription_status_changed_at` column so the 7-day timer starts when the status first goes bad, not when the row was last touched.

### 5. Enforce max_active_clients and max_employees at the DB
Two new triggers modeled on `tg_enforce_job_limit`:
- `tg_enforce_client_limit` on `INSERT INTO clients` — blocks when count ≥ `plan_limits.max_active_clients`.
- `tg_enforce_employee_limit` on `INSERT INTO user_roles WHERE role='employee'` — blocks when the tenant's employee count ≥ `plan_limits.max_employees`. This runs during invite, so `inviteEmployee` will get a friendly error before the auth user is created — check the count in the server function first and short-circuit with a clear message.

### 6. VITE_PAYMENTS_CLIENT_TOKEN in production
Already present in `.env` (verified). No action needed. ✅

### 7. Verify Stripe session on `/pay/return`
Deferred — flagged as Important, not Critical in the audit. Will address in next pass.

Actually promoting this: the current page shows a false "paid" for any random `session_id` in the URL, which is a real risk. Replacing item 6 in scope: add a server function `verifyCheckoutSession(sessionId)` that calls `stripe.checkout.sessions.retrieve` and returns `{ paid, amount, currency }`. Render the confirmation only when `paid === true`; otherwise show "Payment could not be verified" with a retry link.

## Files touched

**New**
- `supabase/migrations/<ts>_critical_billing_fixes.sql` — client/employee limit triggers, `subscription_status_changed_at` column + trigger, minor helper
- `src/routes/forgot-password.tsx`, `src/routes/reset-password.tsx`
- `src/lib/pay.functions.ts` — `verifyCheckoutSession`

**Edited**
- `src/lib/entities.functions.ts` — pre-check employee cap, then correct tenant_id/role after invite
- `src/routes/_authenticated/route.tsx` — subscription gate with 7-day grace
- `src/routes/auth.tsx` — "Forgot password?" link
- `src/routes/pay.return.tsx` — verify session before showing success

**Tool calls**
- `payments--batch_create_product` for the three plans

## Deferred (call out for next pass)
- Business profile edit UI (name/email/phone/address/timezone/branding/invoicing defaults) — user picked all four groups; sized as its own pass.
- Downgrade guard in `openBillingPortal`.
- Return-URL allowlist for custom domains.
- `invoice.payment_failed` webhook + notification.
- AI token cap enforcement.

## How to test in the preview

**Card numbers (Stripe test mode):**
- Success: `4242 4242 4242 4242` — any future expiry, any 3-digit CVC, any ZIP
- Declined: `4000 0000 0000 0002`
- Requires 3-D Secure: `4000 0025 0000 3155`

**Flows to verify:**
1. **Plan checkout** — Sign in as an owner → Settings → Billing → "Choose plan" on Growth → complete with `4242…` → return to billing page → row shows `active`, plan tier updated to `growth`.
2. **Past-due gating** — In the Stripe test dashboard, cancel the subscription (or trigger `customer.subscription.updated` with status `past_due`). Refresh the app: banner appears with "N days left". Set `subscription_status_changed_at` to `now() - 8 days` via SQL to simulate expiry — every route except `/settings/billing` redirects to billing.
3. **Employee invite** — Owner invites `test+emp@example.com` → open the invite email → set password → sign in → land on that owner's tenant (not "Wash Rinse Repeat Cleaning"). Verify with `select tenant_id from profiles where email='test+emp@example.com'`.
4. **Password reset** — On `/auth` click "Forgot password?" → enter email → click link in email → land on `/reset-password` → set new password → sign in with it.
5. **Limits** — On a Starter tenant with 50 clients, adding client #51 shows the friendly plan-cap error. Same for employees (max 3 on Starter).
6. **Invoice payment** — Open a client's invoice → "Pay online" → complete with `4242…` → return page verifies the session and shows "Paid". Tamper with the `session_id` in the URL → page shows "could not be verified".

Approve to implement.
