import { createFileRoute } from "@tanstack/react-router";
import { type StripeEnv, verifyWebhook, createStripeClient } from "@/lib/stripe.server";

async function markInvoicePaidFromSession(session: any, env: StripeEnv) {
  const invoiceId: string | undefined = session.metadata?.invoice_id || session.client_reference_id;
  const tenantId: string | undefined = session.metadata?.tenant_id;
  if (!invoiceId || !tenantId) {
    console.error("webhook: missing invoice/tenant metadata on session", session.id);
    return;
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: existing } = await supabaseAdmin
    .from("payments")
    .select("id")
    .eq("stripe_session_id", session.id)
    .maybeSingle();
  if (existing) return; // idempotent

  const amount = session.amount_total ?? 0;

  // Retrieve charge for method details
  let chargeId: string | null = null;
  let methodDetails: any = null;
  try {
    const stripe = createStripeClient(env);
    const pi = typeof session.payment_intent === "string"
      ? await stripe.paymentIntents.retrieve(session.payment_intent, { expand: ["latest_charge"] })
      : null;
    const charge: any = pi?.latest_charge;
    if (charge && typeof charge === "object") {
      chargeId = charge.id ?? null;
      methodDetails = charge.payment_method_details ?? null;
    }
  } catch (e) {
    console.error("webhook: failed to hydrate charge details", e);
  }

  await supabaseAdmin.from("payments").insert({
    tenant_id: tenantId,
    invoice_id: invoiceId,
    provider: "card",
    amount_cents: amount,
    surcharge_cents: 0,
    net_to_business_cents: amount,
    status: "succeeded",
    processed_at: new Date().toISOString(),
    stripe_session_id: session.id,
    stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : null,
    stripe_charge_id: chargeId,
    payment_method_details: methodDetails,
    note: "Paid via card",
  });
  // Note: tg_payment_mark_invoice_paid trigger flips the invoice to 'paid'.
}

async function upsertTenantSubscription(subscription: any, env: StripeEnv) {
  const tenantId: string | undefined = subscription.metadata?.tenant_id;
  if (!tenantId) {
    console.error("subscription webhook: missing tenant_id metadata", subscription.id);
    return;
  }
  const item = subscription.items?.data?.[0];
  const priceId: string =
    item?.price?.lookup_key ||
    item?.price?.metadata?.lovable_external_id ||
    item?.price?.id ||
    "";
  const planTier: string =
    subscription.metadata?.plan_tier ||
    (priceId.startsWith("atlas_starter") ? "starter"
     : priceId.startsWith("atlas_growth") ? "growth"
     : priceId.startsWith("atlas_scale") ? "scale" : "starter");
  const periodStart = item?.current_period_start ?? subscription.current_period_start;
  const periodEnd = item?.current_period_end ?? subscription.current_period_end;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("tenant_subscriptions").upsert(
    {
      tenant_id: tenantId,
      stripe_subscription_id: subscription.id,
      stripe_customer_id: typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id,
      price_id: priceId,
      plan_tier: planTier,
      status: subscription.status,
      current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      cancel_at_period_end: subscription.cancel_at_period_end ?? false,
      environment: env,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_subscription_id" },
  );
  // Reflect on tenant for fast reads / gating
  const activeStatuses = ["active", "trialing", "past_due"];
  const patch: { subscription_status: string; plan_tier?: string } = { subscription_status: subscription.status };
  if (activeStatuses.includes(subscription.status)) patch.plan_tier = planTier;
  await supabaseAdmin.from("tenants").update(patch).eq("id", tenantId);
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get("env");
        if (rawEnv !== "sandbox" && rawEnv !== "live") {
          return Response.json({ received: true, ignored: "invalid env" });
        }
        const env: StripeEnv = rawEnv;
        try {
          const event = await verifyWebhook(request, env);
          switch (event.type) {
            case "checkout.session.completed":
            case "checkout.session.async_payment_succeeded":
              // Invoice payment flow (skips silently if no invoice_id metadata)
              if ((event.data.object as any).metadata?.invoice_id) {
                await markInvoicePaidFromSession(event.data.object, env);
              }
              break;
            case "customer.subscription.created":
            case "customer.subscription.updated":
            case "customer.subscription.deleted":
              await upsertTenantSubscription(event.data.object, env);
              break;
            default:
              console.log("Unhandled Stripe event:", event.type);
          }
          return Response.json({ received: true });
        } catch (e) {
          console.error("Webhook error:", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
