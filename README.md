# Atlas — AI Operating System for Service Businesses

Atlas is a full-stack SaaS platform for service businesses (cleaning, HVAC, landscaping, pest control, handyman, mobile detailing, home services, and any field-service operation): scheduling, CRM, invoicing, payments, inventory, SOPs, employee time tracking, lead capture webhooks, and an AI assistant ("Atlas AI") grounded in tenant business data.

Built with **TanStack Start v1** (React 19 + Vite 7), **Supabase** (Postgres + Auth + RLS + Storage), **Tailwind CSS v4**, and **shadcn/ui**. Deploys to Cloudflare Workers via Nitro.

---

## Feature Overview

- **Multi-tenant** with row-level security on every table
- **Roles:** super_admin, owner, admin, employee (stored in `user_roles` table, never on profile)
- **Jobs & Calendar** — scheduling, GPS tracking, photo uploads
- **Clients CRM** — notes, history, retention analytics
- **Invoicing & Payments** — Stripe checkout, Venmo, public pay links

- **Inventory** — items, recipes, usage tracking, low-stock alerts
- **SOPs** — standard operating procedures library
- **Employees** — time tracking, productivity reports
- **Leads** — inbound webhook capture (per-tenant URL) + Turno integration
- **Atlas AI** — Gemini-powered assistant with tenant-scoped context (jobs, invoices, clients, SOPs, inventory)
- **Super Admin** — cross-tenant audit, tenant management
- **Onboarding wizard** — required before first tenant use
- **Reports** — revenue, retention, employee productivity, inventory usage
- **Notifications & Email templates**

---

## Tech Stack

| Layer         | Technology                                                  |
|---------------|-------------------------------------------------------------|
| Framework     | TanStack Start v1 (React 19, file-based routing)            |
| Build         | Vite 7 + Nitro (Cloudflare Workers target)                  |
| Styling       | Tailwind CSS v4 + shadcn/ui + Radix primitives              |
| Backend       | Supabase (Postgres, Auth, Storage, RLS)                     |
| Server code   | TanStack `createServerFn` + server routes under `api/`      |
| AI            | Lovable AI Gateway (Google Gemini 2.5 Flash)                |
| Payments      | Stripe Checkout                                              |

| Data          | TanStack Query v5 with router integration                   |
| Forms         | react-hook-form + Zod                                        |
| Types         | Strict TypeScript                                            |

---

## Project Structure

```
src/
  routes/                    # File-based routes
    __root.tsx               # Root layout, <html>/<head>/<body>
    index.tsx                # Landing page
    auth.tsx / signup.tsx    # Authentication
    _authenticated/          # Auth-gated app routes (AppShell layout)
      dashboard.tsx
      jobs.tsx, jobs.$jobId.tsx, jobs.new.tsx
      clients.tsx, invoices.tsx, calendar.tsx
      inventory.tsx, sops.tsx, employees.tsx
      leads.tsx, reports.tsx
      settings.*.tsx         # AI, billing, business, integrations, etc.
      super-admin.*.tsx      # Cross-tenant admin
      onboarding.tsx
    api/public/              # Public HTTP endpoints (webhooks, callbacks)
      hooks/lead.$tenantId.tsx
      hooks/turno.$tenantId.ts
      payments/webhook.ts
      qbo/callback.tsx
    pay.$invoiceId.tsx       # Public invoice payment page
  lib/
    *.functions.ts           # createServerFn RPC modules (client-safe imports)
    *.server.ts              # Server-only helpers (never imported by components)
  components/                # UI (shadcn/ui + app-specific)
  integrations/supabase/     # Auto-generated Supabase clients (do not edit)
  router.tsx                 # Router setup w/ QueryClient in context
  start.ts                   # Server middleware
  server.ts                  # SSR entry w/ error handling
supabase/
  migrations/                # SQL migrations (source of truth for schema)
  config.toml
```

Notable architectural conventions:
- Client components import from `*.functions.ts` only. Server-only code lives in `*.server.ts`.
- Every server function that touches tenant data uses `.middleware([requireSupabaseAuth])`.
- Roles are checked via the `has_role(user_id, role)` SECURITY DEFINER function.
- Every public-schema table has RLS enabled + explicit `GRANT` statements.

---

## Getting Started (Self-Hosted)

### 1. Prerequisites
- Node.js 20+ or Bun
- A Supabase project (free tier works)
- Optional: Stripe account, QuickBooks Online developer app, an AI API key

### 2. Clone & install
```bash
git clone <your-repo-url>
cd <repo>
bun install     # or npm install
```

### 3. Environment variables

Create `.env` in the project root:

```env
# Supabase (required)
VITE_SUPABASE_URL="https://<project-ref>.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="<anon/publishable key>"
VITE_SUPABASE_PROJECT_ID="<project-ref>"
SUPABASE_URL="https://<project-ref>.supabase.co"
SUPABASE_PUBLISHABLE_KEY="<anon/publishable key>"
SUPABASE_SERVICE_ROLE_KEY="<service role key>"   # server only, used by admin flows

# Atlas AI (optional — required for AI assistant)
LOVABLE_API_KEY="<AI gateway key>"
# Or swap to OpenAI/Anthropic by editing src/lib/atlas-ai.functions.ts

# Stripe (optional — required for invoice payments)
VITE_PAYMENTS_CLIENT_TOKEN="pk_test_..."
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."

# QuickBooks Online (optional)
QBO_CLIENT_ID="..."
QBO_CLIENT_SECRET="..."
QBO_ENVIRONMENT="sandbox"        # or "production"
QBO_STATE_SECRET="<random 32+ char string>"

# Twilio AI Voice (optional — required for AI calling module)
TWILIO_ACCOUNT_SID="AC..."
TWILIO_AUTH_TOKEN="..."
TWILIO_PHONE_NUMBER="+15551234567"
TWILIO_WEBHOOK_SECRET="<random 32+ char string>"
```

### 4. Database

Apply migrations to your Supabase project:

```bash
# via Supabase CLI
supabase link --project-ref <your-ref>
supabase db push
```

All schema, RLS policies, GRANTs, and SECURITY DEFINER functions live in `supabase/migrations/`.

### 5. Run

```bash
bun dev        # http://localhost:8080
bun run build  # production build (Cloudflare Workers target)
```

---

## Deployment

The default build target is **Cloudflare Workers** (via Nitro). To deploy:

```bash
bun run build
# Deploy .output/ to Cloudflare (see nitro docs)
```

To target another platform (Vercel, Netlify, Node), change the Nitro preset in `vite.config.ts` — see [Nitro presets](https://nitro.build/deploy).

Additional guidance: <https://docs.lovable.dev/tips-tricks/self-hosting>

---

## Security Notes

- RLS is enforced on every tenant table; server functions use the caller's JWT (`requireSupabaseAuth`) so the database enforces access, not the app.
- Roles are in a separate `user_roles` table (never on `profiles`) to prevent privilege-escalation via profile edits.
- SECURITY DEFINER helpers used by RLS policies are granted only to `authenticated`; internal helpers are `service_role` only.
- Webhook routes (`/api/public/*`) verify signatures/secrets before processing.
- Service role key is server-only; never expose it to the browser.

---

## License

Proprietary — all rights reserved unless a `LICENSE` file states otherwise.
