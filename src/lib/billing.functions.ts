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
    stripe_customer_id: string;
    environment: string;
  } | null;
  all_plans: Array<BillingSummary["limits"]>;
};

export const getBillingSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BillingSummary> => {
    const { data, error } = await context.supabase.rpc("get_my_billing_summary");
    if (error) throw new Error(error.message);
    return data as BillingSummary;
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

export const createSubscriptionCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    plan_tier: z.enum(["starter", "growth", "scale"]),
    return_url: z.string().url(),
    environment: z.enum(["sandbox", "live"]),
  }).parse(d))
  .handler(async ({ data, context }): Promise<{ clientSecret: string } | { error: string }> => {
    try {
      if (!safeReturnUrl(data.return_url)) return { error: "Invalid return URL" };

      // Owner check
      const { data: isOwner } = await context.supabase.rpc("has_role", {
        _user_id: context.userId, _role: "owner",
      });
      if (!isOwner) return { error: "Only the workspace owner can change plans." };

      // Look up plan + tenant
      const { data: plan, error: planErr } = await context.supabase
        .from("plan_limits")
        .select("plan_tier, display_name, stripe_price_id")
        .eq("plan_tier", data.plan_tier)
        .maybeSingle();
      if (planErr || !plan?.stripe_price_id) return { error: "Plan is not available" };

      const { data: profile } = await context.supabase
        .from("profiles").select("tenant_id, email, full_name").eq("id", context.userId).maybeSingle();
      if (!profile?.tenant_id) return { error: "No workspace found" };

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: tenant } = await supabaseAdmin
        .from("tenants")
        .select("id, name, stripe_customer_id, business_email")
        .eq("id", profile.tenant_id)
        .maybeSingle();
      if (!tenant) return { error: "Workspace not found" };

      const stripe = createStripeClient(data.environment as StripeEnv);

      // Reuse or create Stripe customer
      let customerId = tenant.stripe_customer_id ?? null;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: tenant.business_email ?? profile.email ?? undefined,
          name: tenant.name,
          metadata: { tenant_id: tenant.id },
        });
        customerId = customer.id;
        await supabaseAdmin.from("tenants").update({ stripe_customer_id: customerId }).eq("id", tenant.id);
      }

      // Resolve price by lookup_key (stripe_price_id column stores the human-readable id we passed to create_product)
      const prices = await stripe.prices.list({
        lookup_keys: [plan.stripe_price_id], limit: 1, expand: ["data.product"],
      });
      const stripePrice = prices.data[0];
      if (!stripePrice) return { error: `Price ${plan.stripe_price_id} not found in Stripe` };

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        ui_mode: "embedded",
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

export const openBillingPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    return_url: z.string().url(),
    environment: z.enum(["sandbox", "live"]),
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
