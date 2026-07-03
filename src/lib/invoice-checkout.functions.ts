import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { type StripeEnv, createStripeClient, getStripeErrorMessage } from "@/lib/stripe.server";

type CheckoutResult = { clientSecret: string } | { error: string };
type InvoiceSummary = {
  id: string;
  number: string;
  status: string;
  total_cents: number;
  subtotal_cents: number;
  surcharge_cents: number;
  card_surcharge: boolean;
  currency: string;
  due_date: string | null;
  client_name: string;
  client_email: string | null;
} | { error: string };

// Public: fetch minimal invoice info by id for the pay page
export const getPublicInvoice = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }): Promise<InvoiceSummary> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inv, error } = await supabaseAdmin
      .from("invoices")
      .select("id, number, status, total_cents, subtotal_cents, surcharge_cents, card_surcharge, currency, due_date, client:clients(first_name, last_name, email)")
      .eq("id", data.id)
      .maybeSingle();
    if (error) return { error: error.message };
    if (!inv) return { error: "Invoice not found" };
    const client = inv.client as { first_name: string | null; last_name: string | null; email: string | null } | null;
    return {
      id: inv.id,
      number: inv.number,
      status: inv.status,
      total_cents: inv.total_cents ?? 0,
      subtotal_cents: inv.subtotal_cents ?? 0,
      surcharge_cents: inv.surcharge_cents ?? 0,
      card_surcharge: inv.card_surcharge ?? false,
      currency: inv.currency ?? "usd",
      due_date: inv.due_date,
      client_name: [client?.first_name, client?.last_name].filter(Boolean).join(" ") || "Customer",
      client_email: client?.email ?? null,
    };
  });

// Public: create a Stripe embedded checkout session for an invoice
export const createInvoiceCheckout = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({
      invoice_id: z.string().uuid(),
      return_url: z.string().url(),
      environment: z.enum(["sandbox", "live"]),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<CheckoutResult> => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: inv, error } = await supabaseAdmin
        .from("invoices")
        .select("id, tenant_id, number, status, total_cents, currency, client:clients(first_name, last_name, email)")
        .eq("id", data.invoice_id)
        .maybeSingle();
      if (error) return { error: error.message };
      if (!inv) return { error: "Invoice not found" };
      if (inv.status === "paid") return { error: "This invoice is already paid" };
      if (inv.status === "cancelled" || inv.status === "void") return { error: "This invoice is no longer payable" };
      const total = inv.total_cents ?? 0;
      if (total < 50) return { error: "Invoice amount is too small to process" };

      const client = inv.client as { first_name: string | null; last_name: string | null; email: string | null } | null;
      const customerName = [client?.first_name, client?.last_name].filter(Boolean).join(" ") || "Customer";

      const stripe = createStripeClient(data.environment as StripeEnv);
      const session = await stripe.checkout.sessions.create({
        line_items: [{
          price_data: {
            currency: (inv.currency ?? "usd").toLowerCase(),
            product_data: {
              name: `Invoice ${inv.number}`,
              description: `Wash Rinse Repeat Cleaning — ${customerName}`,
            },
            unit_amount: total,
          },
          quantity: 1,
        }],
        mode: "payment",
        ui_mode: "embedded_page",
        return_url: `${data.return_url}?session_id={CHECKOUT_SESSION_ID}`,
        client_reference_id: inv.id,
        payment_intent_data: {
          description: `Invoice ${inv.number} — ${customerName}`,
          metadata: {
            invoice_id: inv.id,
            invoice_number: inv.number,
            tenant_id: inv.tenant_id,
          },
        },
        metadata: {
          invoice_id: inv.id,
          invoice_number: inv.number,
          tenant_id: inv.tenant_id,
        },
        ...(client?.email && { customer_email: client.email }),
      });

      return { clientSecret: session.client_secret ?? "" };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });
