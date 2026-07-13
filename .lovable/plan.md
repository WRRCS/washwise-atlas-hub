
# Billing, Payments & Account Management — Fix Plan

Based on the end-to-end audit and your decisions, here's what I'll build.

## 1. Subscription changes: full in-app control with proration

Rework `createSubscriptionCheckout` (`src/lib/billing.functions.ts`) into two paths, chosen automatically based on whether the tenant already has an active `tenant_subscriptions` row:

- **First-time subscribe** → embedded Stripe Checkout (unchanged path, `mode:"subscription"`).
- **Existing subscriber changes plan** → call `stripe.subscriptions.update(sub_id, { items:[{id, price}], proration_behavior:"create_prorated_invoice" })` directly. No checkout, no second subscription. Immediate switch, prorated on next invoice.

New server functions:
- `changePlan({ targetTier })` — validates owner role, resolves target price via `lookup_keys`, runs the downgrade guard (below), then updates the Stripe subscription in place.
- `cancelSubscription({ atPeriodEnd:true })` — sets `cancel_at_period_end` so users keep access until period end.
- `resumeSubscription()` — clears `cancel_at_period_end`.

The Customer Portal (`openBillingPortal`) is kept, but only surfaced as **"Manage payment method & invoices"** — not for plan changes.

Add `managed_payments: { enabled: true }` on the first-time subscription checkout session (US-based SaaS, tax code `txcd_10103001` already set on the product) so Stripe handles tax + compliance end-to-end. Skip `automatic_tax` (conflicts with managed_payments).

## 2. Downgrade guard (blocks over-limit downgrades)

New RPC `preview_plan_change(target_tier)` returns:
```
{ ok: bool, blocking: [{limit:'employees', current:8, allowed:3}, ...] }
```
Checks current active clients / employees / current-month jobs vs the target plan's `plan_limits` row.

- `changePlan` calls it first and refuses with a structured error if `!ok`.
- `PlanCard` on the Billing page calls it on hover/click and, when blocking rows exist, disables the "Choose plan" button and shows an inline message: *"You have 8 employees. Starter allows 3. Remove 5 employees to downgrade."* with a deep link to the relevant admin page.

## 3. Env-scoped subscription reads

Fix `get_my_billing_summary()` to filter `tenant_subscriptions` by `environment` matching the caller (sandbox in preview, live in production). The `environment` value is passed in from the client using the existing `getStripeEnvironment()` helper.

## 4. Webhook coverage & renewal receipts

Extend `src/routes/api/public/payments/webhook.ts` to handle:
- `invoice.payment_succeeded` — insert a `subscription_invoices` row (new table) so tenants see a renewal history with downloadable Stripe hosted invoice URLs.
- `invoice.payment_failed` — write a `subscription_status='past_due'` mirror + increment `retry_count` for the dunning banner.
- `customer.subscription.trial_will_end` — no-op stub for future email hook, prevents "unhandled event" noise.

New table `subscription_invoices` (per-tenant, RLS to owner) storing: `stripe_invoice_id`, `amount_paid`, `status`, `hosted_invoice_url`, `invoice_pdf`, `period_start`, `period_end`, `environment`.

## 5. Grace-period lockout — use the RPC

Route guard (`src/routes/_authenticated/route.tsx`) switches from hand-rolled query + local `GRACE_DAYS` constant to calling `get_my_subscription_gate()`. Single source of truth. Add a small dunning banner component shown app-wide when status is `past_due` (link to portal / update card).

## 6. Remove legacy `/auth` signup

- `src/routes/auth.tsx` becomes sign-in only (tabs component removed). Any "Create account" link routes to `/signup`.
- `handle_new_user()` trigger keeps the "no business name → default tenant" branch only as a safety net for existing seeded accounts; new signups always go through `/signup` which supplies `signup_business_name`.

## 7. Business Profile settings page

New route `src/routes/_authenticated/settings.business-profile.tsx` (rename existing `settings.business.tsx` → `settings.gps.tsx` since it only covers GPS). Sections:

- **Identity**: business name, legal name, business email, phone, website, timezone, address.
- **Branding**: logo upload (to Supabase storage bucket `tenant-assets`), primary color.
- **Invoicing defaults**: default currency, invoice prefix, footer text, payment terms (net-N days), late fee %.
- **Client notifications**: default reminder cadence toggles.

Owner-only writes via existing `has_role` check; server function `updateBusinessProfile` gated by `requireSupabaseAuth` + owner check.

## Technical details

New migrations (single file):
- `subscription_invoices` table + RLS + grants.
- `preview_plan_change(target_tier text)` RPC (SECURITY DEFINER, `search_path=public`).
- `get_my_billing_summary()` gets an optional `_environment text` parameter; falls back to newest row if null (backward compat).
- Add `tenants.logo_url`, `legal_name`, `website`, `timezone`, `invoice_prefix`, `invoice_footer`, `payment_terms_days`, `late_fee_percent`, `primary_color` columns (nullable, with sensible defaults).

New/changed files:
- `src/lib/billing.functions.ts` — add `changePlan`, `cancelSubscription`, `resumeSubscription`, `previewPlanChange`; refactor `createSubscriptionCheckout` to first-time-only.
- `src/lib/business-profile.functions.ts` — CRUD for the new settings page.
- `src/routes/_authenticated/settings.billing.tsx` — new PlanCard states (current / upgrade / downgrade / blocked), cancel/resume buttons, invoice history table, portal link relabeled.
- `src/routes/_authenticated/settings.business-profile.tsx` — new page.
- `src/routes/_authenticated/route.tsx` — replace hand-rolled gate with RPC.
- `src/components/DunningBanner.tsx` — new.
- `src/routes/auth.tsx` — remove signup tab.
- `src/routes/api/public/payments/webhook.ts` — new event handlers + invoice inserts.
- Small friendly-error helper mapping Postgres `check_violation` from limit triggers → "Upgrade to add more employees/clients/jobs" toast (used across `clients.tsx`, `jobs.new.tsx`, employee invite flow).

## Testing in preview (Stripe sandbox)

The preview build uses `pk_test_...`, so all payments go through Stripe's sandbox — no real charges. Test cards:

| Scenario | Card |
|---|---|
| Success | `4242 4242 4242 4242` |
| Requires 3-D Secure | `4000 0025 0000 3155` |
| Decline (generic) | `4000 0000 0000 0002` |
| Renewal succeeds | `4000 0000 0000 0341` (attaches, then charges succeed) |
| Renewal fails | `4000 0000 0000 0341` — set clock forward in Stripe test to force renewal, will trigger `past_due` |

Any future expiry (e.g., `12/34`), any 3-digit CVC, any ZIP.

**Flow to walk through:**

1. Sign up at `/signup` with a fresh email → new tenant is created, owner role granted → onboarding wizard → land on dashboard.
2. Settings → Billing → pick **Growth** → embedded checkout appears → pay with `4242…` → return page confirms → tenant flips to `growth`.
3. Try to downgrade to **Starter** while over-limit (add 4+ employees first) → button shows "Remove 1 employee to downgrade", click is blocked.
4. Remove employees → downgrade → no new checkout, immediate switch, next invoice will be prorated.
5. Click **Cancel subscription** → confirms scheduled cancellation at period end → banner shows expiry date → **Resume** clears it.
6. Manage payment method → opens Stripe Customer Portal in a new tab.
7. Invoice-history table populates as Stripe sends `invoice.payment_succeeded` webhooks (visible after the first renewal or immediately for the initial invoice).
8. Simulate past-due: in Stripe test dashboard, mark the invoice unpaid → within a few seconds the app shows the amber dunning banner; after 7 days (or by advancing status to `unpaid`) the route guard redirects to Billing until paid.
9. Settings → Business Profile → edit name/logo/invoice defaults → send a test invoice → verify the new prefix + footer render on `/pay/$invoiceId`.

**Also verify:** `/auth` no longer offers signup, and the runtime error ("Expected to find a match below the root match in SPA mode") is resolved as part of the route-guard refactor.
