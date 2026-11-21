import { isAppUrl } from "@/lib/app-origin";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { type StripeEnv, createStripeClient, getStripeErrorMessage } from "@/lib/stripe.server";

type CheckoutResult = { clientSecret: string } | { error: string };
type InvoiceSummary = {
  id: string;
  number: string;
  status: string;
  subject: string | null;
  total_cents: number;
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  surcharge_cents: number;
  card_surcharge: boolean;
  currency: string;
  issue_date: string | null;
  due_date: string | null;
  client_name: string;
  client_email: string | null;
  property_address: string | null;
  client_message: string | null;
  terms_text: string | null;
  line_items: { description: string; details: string | null; quantity: number; hours: number | null; unit_price_cents: number; line_total_cents: number; service_date: string | null }[];
  business_phone: string | null;
  business_email: string | null;
  /** How many service photos are attached; the photos load only on the gallery page. */
  photo_count: number;
  allow_card: boolean;
  venmo_link: string | null;
} | { error: string };

// The public pay link carries the invoice's private code; without the matching code nothing is shown.
const payTokenSchema = z.string().trim().max(128).default("");
const EXPIRED_LINK = "This payment link is not valid. Please contact Wash Rinse Repeat Cleaning for a current link.";
function payTokenMatches(stored: string | null | undefined, given: string): boolean {
  if (!stored || !given || stored.length !== given.length) return false;
  let diff = 0;
  for (let i = 0; i < stored.length; i++) diff |= stored.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

// Shared loader for the client pay page. Drafts are only returned for staff previews.
async function loadInvoiceSummary(id: string, opts: { allowDraft: boolean; payToken?: string }): Promise<InvoiceSummary> {
    const data = { id };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inv, error } = await supabaseAdmin
      .from("invoices")
      .select("id, tenant_id, client_id, pay_token, number, status, subject, total_cents, subtotal_cents, discount_cents, tax_cents, surcharge_cents, card_surcharge, allow_card, allow_venmo, currency, issue_date, due_date, photo_ids, client_message, terms_text, client:clients(first_name, last_name, email), property:client_properties(label, address)")
      .eq("id", data.id)
      .maybeSingle();
    if (error) return { error: error.message };
    if (!inv) return { error: "Invoice not found" };
    if (opts.payToken !== undefined && !payTokenMatches((inv as any).pay_token, opts.payToken)) return { error: EXPIRED_LINK };
    if (inv.status === "draft" && !opts.allowDraft) return { error: "This invoice is not available for payment." };
    const { data: lineRows } = await supabaseAdmin
      .from("invoice_line_items")
      .select("description, details, quantity, hours, unit_price_cents, line_total_cents, service_date")
      .eq("invoice_id", inv.id)
      .order("sort_order")
      .order("service_date");
    const client = inv.client as { first_name: string | null; last_name: string | null; email: string | null } | null;
    const ids: string[] = ((inv as any).photo_ids ?? []) as string[];
    const photo_count = ids.length ? (await invoicePhotoRows(inv.tenant_id, inv.client_id, ids)).length : 0;
    const allowCard = (inv as any).allow_card !== false;
    const allowVenmo = (inv as any).allow_venmo !== false;
    // Venmo goes straight to the business's own Venmo handle — no app processing fee.
    let venmoLink: string | null = null;
    if (allowVenmo) {
      const { data: vr } = await supabaseAdmin
        .from("integrations").select("is_connected, settings")
        .eq("tenant_id", (inv as any).tenant_id).eq("provider", "venmo").maybeSingle();
      const handle = ((vr?.settings as { handle?: string } | null)?.handle ?? "").replace(/^@/, "");
      if (vr?.is_connected && handle) {
        // Venmo amount excludes the card surcharge.
        const amount = (Math.max((inv.total_cents ?? 0) - (inv.surcharge_cents ?? 0), 0) / 100).toFixed(2);
        const params = new URLSearchParams({ txn: "pay", amount, note: `Invoice ${inv.number ?? ""}`.trim() });
        venmoLink = `https://venmo.com/${encodeURIComponent(handle)}?${params.toString()}`;
      }
    }
    const prop = (inv as any).property as { label?: string; address?: string } | null;
    // Public business contact details, shown so clients know how to reach customer service.
    const { data: biz } = await (supabaseAdmin as any)
      .from("tenants").select("business_phone, business_email").eq("id", (inv as any).tenant_id).maybeSingle();
    return {
      business_phone: (biz?.business_phone as string | null) ?? null,
      business_email: ((biz?.business_email as string | null) ?? null)?.toLowerCase() ?? null,
      photo_count,
      allow_card: allowCard,
      venmo_link: venmoLink,
      id: inv.id,
      number: inv.number,
      status: inv.status,
      subject: (inv as any).subject ?? null,
      total_cents: inv.total_cents ?? 0,
      subtotal_cents: inv.subtotal_cents ?? 0,
      discount_cents: (inv as any).discount_cents ?? 0,
      tax_cents: (inv as any).tax_cents ?? 0,
      surcharge_cents: inv.surcharge_cents ?? 0,
      card_surcharge: inv.card_surcharge ?? false,
      currency: inv.currency ?? "usd",
      issue_date: (inv as any).issue_date ?? null,
      due_date: inv.due_date,
      client_name: [client?.first_name, client?.last_name].filter(Boolean).join(" ") || "Customer",
      client_email: client?.email ?? null,
      property_address: prop ? `${prop.label ?? ""} — ${prop.address ?? ""}`.replace(/^— | —$/g, "").trim() : null,
      client_message: (inv as any).client_message ?? null,
      terms_text: (inv as any).terms_text ?? null,
      line_items: (lineRows ?? []) as { description: string; details: string | null; quantity: number; hours: number | null; unit_price_cents: number; line_total_cents: number; service_date: string | null }[],
    };
}

/** Photos on an invoice that really belong to that client's cleanings (in the invoice's chosen order). */
async function invoicePhotoRows(tenantId: string, clientId: string | null, ids: string[]) {
  if (!ids.length || !clientId) return [];
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: rows } = await supabaseAdmin
    .from("job_photos").select("id, storage_path, caption, photo_type, job:jobs!inner(client_id)")
    .eq("tenant_id", tenantId).eq("job.client_id", clientId).in("id", ids);
  const order = new Map(ids.map((id, i) => [id, i]));
  return (rows ?? []).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export type InvoicePhoto = { thumb_url: string | null; url: string; caption: string | null; photo_type: string };
export type InvoicePhotosResult = { number: string | null; photos: InvoicePhoto[] } | { error: string };

/** Small previews for the gallery grid, plus a full-size link that loads only when tapped. */
async function loadInvoicePhotos(id: string, opts: { allowDraft: boolean; payToken?: string }): Promise<InvoicePhotosResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: inv } = await supabaseAdmin.from("invoices").select("id, tenant_id, client_id, pay_token, number, status, photo_ids").eq("id", id).maybeSingle();
  if (!inv) return { error: "Invoice not found" };
  if (opts.payToken !== undefined && !payTokenMatches((inv as any).pay_token, opts.payToken)) return { error: EXPIRED_LINK };
  if (inv.status === "draft" && !opts.allowDraft) return { error: "This invoice is not available." };
  const rows = await invoicePhotoRows(inv.tenant_id, inv.client_id, ((inv as any).photo_ids ?? []) as string[]);
  const bucket = supabaseAdmin.storage.from("job-photos");
  const photos = await Promise.all(rows.map(async (r) => {
    const [full, thumb] = await Promise.all([
      bucket.createSignedUrl(r.storage_path, 3600),
      bucket.createSignedUrl(r.storage_path, 3600, { transform: { width: 480, height: 480, resize: "cover", quality: 70 } }).catch(() => ({ data: null })),
    ]);
    return full.data?.signedUrl ? { url: full.data.signedUrl, thumb_url: thumb.data?.signedUrl ?? null, caption: r.caption, photo_type: r.photo_type as string } : null;
  }));
  return { number: inv.number, photos: photos.filter((p): p is InvoicePhoto => !!p) };
}

// Public: the invoice's photo gallery (same access as the pay page link).
export const getPublicInvoicePhotos = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid(), k: payTokenSchema }).parse(input))
  .handler(async ({ data }): Promise<InvoicePhotosResult> => loadInvoicePhotos(data.id, { allowDraft: false, payToken: data.k }));

// Staff only: gallery for an invoice that hasn't been sent yet.
export const previewPublicInvoicePhotos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<InvoicePhotosResult> => {
    const { data: isMgr } = await context.supabase.rpc("is_owner_or_manager" as never);
    if (!isMgr) return { error: "Only owners and managers can preview invoices." };
    const { data: own } = await context.supabase.from("invoices").select("id").eq("id", data.id).maybeSingle();
    if (!own) return { error: "Invoice not found" };
    return loadInvoicePhotos(data.id, { allowDraft: true });
  });

// Public: fetch minimal invoice info by id for the pay page
export const getPublicInvoice = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid(), k: payTokenSchema }).parse(input))
  .handler(async ({ data }): Promise<InvoiceSummary> => loadInvoiceSummary(data.id, { allowDraft: false, payToken: data.k }));

// Staff only: show the client's pay page for an invoice before it is sent.
export const previewPublicInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<InvoiceSummary> => {
    const { data: isMgr } = await context.supabase.rpc("is_owner_or_manager" as never);
    if (!isMgr) return { error: "Only owners and managers can preview invoices." };
    // Must be an invoice the signed-in staff member can already see.
    const { data: own } = await context.supabase.from("invoices").select("id").eq("id", data.id).maybeSingle();
    if (!own) return { error: "Invoice not found" };
    return loadInvoiceSummary(data.id, { allowDraft: true });
  });

// Public: create a Stripe embedded checkout session for an invoice
const isAllowedReturnUrl = isAppUrl;

export const createInvoiceCheckout = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({
      invoice_id: z.string().uuid(),
      k: payTokenSchema,
      return_url: z.string().url(),
      environment: z.enum(["sandbox", "live"]),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<CheckoutResult> => {
    try {
      if (!isAllowedReturnUrl(data.return_url)) return { error: "Invalid return URL" };
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: inv, error } = await supabaseAdmin
        .from("invoices")
        .select("id, tenant_id, pay_token, number, status, total_cents, currency, allow_card, client:clients(first_name, last_name, email)")
        .eq("id", data.invoice_id)
        .maybeSingle();
      if (error) return { error: "Could not load this invoice." };
      if (!inv) return { error: "Invoice not found" };
      if (!payTokenMatches((inv as any).pay_token, data.k)) return { error: EXPIRED_LINK };
      if (inv.status === "paid") return { error: "This invoice is already paid" };
      if (inv.status === "cancelled" || inv.status === "void") return { error: "This invoice is no longer payable" };
      if (inv.status === "draft") return { error: "This invoice is not available for payment." };
      if ((inv as any).allow_card === false) return { error: "Card payment is not offered for this invoice." };
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
