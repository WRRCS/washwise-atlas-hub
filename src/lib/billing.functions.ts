import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { type StripeEnv, createStripeClient, getStripeErrorMessage } from "@/lib/stripe.server";

export type BillingSummary = {
  tenant_id: string;
  plan_tier: string;
  limits: {
    plan_tier: string;
    display_name: string;
    price_cents_monthly: number;
    stripe_price_id: string | null;
    max_active_clients: number | null;
    max_monthly_jobs: number | null;
    max_employees: number | null;
    ai_tokens_monthly: number | null;
    features: Record<string, any>;
    sort_order: number;
  } | null;
  usage: {
    active_clients: number;
    monthly_jobs: number;
    employees: number;
    ai_tokens_used_month: number;
  };
  subscription: {
    id: string;
    status: string;
    plan_tier: string;
    price_id: string;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    stripe_subscription_id: string;
    stripe_customer_id: string;
    environment: string;
  } | null;
  invoices: Array<{
    id: string;
    stripe_invoice_id: string;
    amount_paid_cents: number;
    currency: string;
    status: string;
    hosted_invoice_url: string | null;
    invoice_pdf: string | null;
    period_start: string | null;
    period_end: string | null;
    created_at: string;
  }>;
  all_plans: Array<NonNullable<BillingSummary["limits"]>>;
};

export type PlanChangePreview = {
  ok: boolean;
  target_tier: string;
  blocking: Array<{ limit: string; current: number; allowed: number }>;
  error?: string;
};

const environmentSchema = z.enum(["sandbox", "live"]);
const planTierSchema = z.enum(["starter", "growth", "scale"]);

export const getBillingSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { environment?: StripeEnv } | undefined) => d ?? {})
  .handler(async ({ data, context }): Promise<BillingSummary> => {
    const rpcArgs = data.environment ? { _environment: data.environment } : {};
    const { data: res, error } = await context.supabase.rpc("get_my_billing_summary", rpcArgs);
    if (error) throw new Error(error.message);
    return res as BillingSummary;
  });

export const previewPlanChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ plan_tier: planTierSchema }).parse(d))
  .handler(async ({ data, context }): Promise<PlanChangePreview> => {
    const { data: res, error } = await context.supabase.rpc("preview_plan_change", {
      _target_tier: data.plan_tier,
    });
    if (error) throw new Error(error.message);
    return res as PlanChangePreview;
  });

const CHECKOUT_ALLOWED_HOSTS = ["lovable.app", "lovableproject.com", "localhost"];
function safeReturnUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && u.hostname === "localhost")) return false;
    return CHECKOUT_ALLOWED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith("." + h));
  } catch {
    return false;
  }
}

async function requireOwnerTenant(context: any) {
  const { data: isOwner } = await context.supabase.rpc("has_role", {
    _user_id: context.userId, _role: "owner",
  });
  if (!isOwner) throw new Error("Only the workspace owner can change plans.");
  const { data: profile } = await context.supabase
    .from("profiles").select("tenant_id, email, full_name").eq("id", context.userId).maybeSingle();
  if (!profile?.tenant_id) throw new Error("No workspace found");
  return profile;
}

export const createSubscriptionCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    plan_tier: planTierSchema,
    return_url: z.string().url(),
    environment: environmentSchema,
  }).parse(d))
  .handler(async ({ data, context }): Promise<{ clientSecret: string } | { error: string }> => {
    try {
      if (!safeReturnUrl(data.return_url)) return { error: "Invalid return URL" };
      const profile = await requireOwnerTenant(context);

      const { data: plan, error: planErr } = await context.supabase
        .from("plan_limits")
        .select("plan_tier, display_name, stripe_price_id")
        .eq("plan_tier", data.plan_tier)
        .maybeSingle();
      if (planErr || !plan?.stripe_price_id) return { error: "Plan is not available" };

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: tenant } = await supabaseAdmin
        .from("tenants")
        .select("id, name, stripe_customer_id, business_email")
        .eq("id", profile.tenant_id)
        .maybeSingle();
      if (!tenant) return { error: "Workspace not found" };

      // Refuse to open first-time checkout if an active sub already exists (avoids double-billing)
      const { data: existingSub } = await supabaseAdmin
        .from("tenant_subscriptions")
        .select("stripe_subscription_id, status")
        .eq("tenant_id", tenant.id)
        .eq("environment", data.environment)
        .in("status", ["active", "trialing", "past_due", "incomplete"])
        .maybeSingle();
      if (existingSub) {
        return { error: "You already have an active subscription — use Change plan instead." };
      }

      const stripe = createStripeClient(data.environment as StripeEnv);

      let customerId = tenant.stripe_customer_id ?? null;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: tenant.business_email ?? profile.email ?? undefined,
          name: tenant.name,
          metadata: { tenant_id: tenant.id, userId: context.userId },
        });
        customerId = customer.id;
        await supabaseAdmin.from("tenants").update({ stripe_customer_id: customerId }).eq("id", tenant.id);
      }

      const prices = await stripe.prices.list({
        lookup_keys: [plan.stripe_price_id], limit: 1,
      });
      const stripePrice = prices.data[0];
      if (!stripePrice) return { error: `Price ${plan.stripe_price_id} not found in Stripe` };

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        ui_mode: "embedded_page",
        return_url: data.return_url,
        customer: customerId,
        line_items: [{ price: stripePrice.id, quantity: 1 }],
        subscription_data: {
          metadata: {
            tenant_id: tenant.id,
            plan_tier: plan.plan_tier,
            userId: context.userId,
          },
        },
        metadata: {
          tenant_id: tenant.id,
          plan_tier: plan.plan_tier,
        },
      });
      return { clientSecret: session.client_secret ?? "" };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

export const changePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    plan_tier: planTierSchema,
    environment: environmentSchema,
  }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true } | { error: string; blocking?: PlanChangePreview["blocking"] }> => {
    try {
      const profile = await requireOwnerTenant(context);

      // Guard: block downgrade that would exceed target caps
      const { data: preview, error: previewErr } = await context.supabase.rpc("preview_plan_change", {
        _target_tier: data.plan_tier,
      });
      if (previewErr) return { error: previewErr.message };
      const p = preview as PlanChangePreview;
      if (!p.ok) {
        return {
          error: "Your current usage exceeds the target plan's limits. Reduce below the caps to switch.",
          blocking: p.blocking,
        };
      }

      const { data: plan } = await context.supabase
        .from("plan_limits")
        .select("plan_tier, stripe_price_id")
        .eq("plan_tier", data.plan_tier)
        .maybeSingle();
      if (!plan?.stripe_price_id) return { error: "Plan is not available" };

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: sub } = await supabaseAdmin
        .from("tenant_subscriptions")
        .select("stripe_subscription_id, plan_tier, status")
        .eq("tenant_id", profile.tenant_id)
        .eq("environment", data.environment)
        .in("status", ["active", "trialing", "past_due"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!sub?.stripe_subscription_id) {
        return { error: "No active subscription to change. Start a subscription first." };
      }
      if (sub.plan_tier === plan.plan_tier) return { ok: true };

      const stripe = createStripeClient(data.environment);
      const prices = await stripe.prices.list({ lookup_keys: [plan.stripe_price_id], limit: 1 });
      const newPrice = prices.data[0];
      if (!newPrice) return { error: `Price ${plan.stripe_price_id} not found in Stripe` };

      const remote = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
      const itemId = remote.items?.data?.[0]?.id;
      if (!itemId) return { error: "Could not read subscription items from Stripe" };

      await stripe.subscriptions.update(sub.stripe_subscription_id, {
        items: [{ id: itemId, price: newPrice.id }],
        proration_behavior: "always_invoice",
        metadata: {
          tenant_id: profile.tenant_id,
          plan_tier: plan.plan_tier,
          userId: context.userId,
        },
      });
      // Webhook will sync the DB; also mirror plan_tier immediately for UI snappiness.
      await supabaseAdmin.from("tenants").update({ plan_tier: plan.plan_tier }).eq("id", profile.tenant_id);
      return { ok: true };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

export const cancelSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ environment: environmentSchema }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true } | { error: string }> => {
    try {
      const profile = await requireOwnerTenant(context);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: sub } = await supabaseAdmin
        .from("tenant_subscriptions")
        .select("stripe_subscription_id, status")
        .eq("tenant_id", profile.tenant_id)
        .eq("environment", data.environment)
        .in("status", ["active", "trialing", "past_due"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!sub?.stripe_subscription_id) return { error: "No active subscription" };
      const stripe = createStripeClient(data.environment);
      await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: true });
      return { ok: true };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

export const resumeSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ environment: environmentSchema }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true } | { error: string }> => {
    try {
      const profile = await requireOwnerTenant(context);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: sub } = await supabaseAdmin
        .from("tenant_subscriptions")
        .select("stripe_subscription_id")
        .eq("tenant_id", profile.tenant_id)
        .eq("environment", data.environment)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!sub?.stripe_subscription_id) return { error: "No subscription found" };
      const stripe = createStripeClient(data.environment);
      await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: false });
      return { ok: true };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

export const openBillingPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    return_url: z.string().url(),
    environment: environmentSchema,
  }).parse(d))
  .handler(async ({ data, context }): Promise<{ url: string } | { error: string }> => {
    try {
      const { data: profile } = await context.supabase
        .from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
      if (!profile?.tenant_id) return { error: "No workspace" };
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: tenant } = await supabaseAdmin
        .from("tenants").select("stripe_customer_id").eq("id", profile.tenant_id).maybeSingle();
      if (!tenant?.stripe_customer_id) return { error: "No billing account yet — start a subscription first." };
      const stripe = createStripeClient(data.environment as StripeEnv);
      const portal = await stripe.billingPortal.sessions.create({
        customer: tenant.stripe_customer_id,
        return_url: data.return_url,
      });
      return { url: portal.url };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });
