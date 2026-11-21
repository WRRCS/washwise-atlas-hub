import { createFileRoute, Link } from "@tanstack/react-router";
import { Images } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useState } from "react";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { getPublicInvoice, previewPublicInvoice, createInvoiceCheckout } from "@/lib/invoice-checkout.functions";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { formatDate, formatPhone } from "@/lib/invoice-email";

export const Route = createFileRoute("/pay/$invoiceId")({
  validateSearch: (search: Record<string, unknown>): { preview?: boolean; k?: string } => ({
    preview: search.preview === true || search.preview === 1 || search.preview === "1" ? true : undefined,
    k: typeof search.k === "string" && search.k ? search.k : undefined,
  }),
  component: PayInvoicePage,
  ssr: false,
  head: () => ({
    meta: [
      { title: "Pay your invoice — Wash Rinse Repeat Cleaning" },
      { name: "description", content: "Secure invoice payment for Wash Rinse Repeat Cleaning." },
      { name: "robots", content: "noindex" },
    ],
  }),
  errorComponent: ({ error }) => <div className="p-8 text-sm text-red-700">{(error as Error).message}</div>,
  notFoundComponent: () => <div className="p-8 text-sm text-muted-foreground">Invoice not found.</div>,
});

function money(cents: number, currency = "usd") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

function PayInvoicePage() {
  const { invoiceId } = Route.useParams();
  const { preview, k } = Route.useSearch();
  const getFn = useServerFn(getPublicInvoice);
  const previewFn = useServerFn(previewPublicInvoice);
  const createFn = useServerFn(createInvoiceCheckout);
  const [confirmed, setConfirmed] = useState(false);

  const { data: inv, isLoading } = useQuery({
    queryKey: ["public-invoice", invoiceId, !!preview, k ?? ""],
    queryFn: () => (preview ? previewFn({ data: { id: invoiceId } }) : getFn({ data: { id: invoiceId, k: k ?? "" } })),
  });

  const fetchClientSecret = useCallback(async (): Promise<string> => {
    const result = await createFn({
      data: {
        invoice_id: invoiceId,
        k: k ?? "",
        return_url: `${window.location.origin}/pay/return`,
        environment: getStripeEnvironment(),
      },
    });
    if ("error" in result) throw new Error(result.error);
    if (!result.clientSecret) throw new Error("Could not start checkout");
    return result.clientSecret;
  }, [createFn, invoiceId, k]);

  if (isLoading) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  if (!inv || "error" in inv) return <div className="max-w-md mx-auto p-8 text-sm text-red-700">{(inv as { error: string })?.error ?? "Invoice not found"}</div>;

  const isPaid = inv.status === "paid";
  const isDead = inv.status === "cancelled" || inv.status === "void";

  return (
    <>
      {preview ? (
        <div className="w-full bg-warning/15 border-b border-warning/30 px-4 py-2 text-center text-sm text-foreground">
          Preview — this is what your client will see. Payment buttons are turned off here.
        </div>
      ) : (
        <PaymentTestModeBanner />
      )}
      <div className={`min-h-screen bg-clay-50 ${preview ? "[&_a[data-pay]]:pointer-events-none [&_button[data-pay]]:pointer-events-none" : ""}`}>
        <div className="max-w-2xl mx-auto px-6 py-10">
          <div className="text-center mb-6">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Wash Rinse Repeat Cleaning</p>
            <h1 className="text-2xl font-medium mt-2">Invoice {inv.number}</h1>
            {inv.subject && <p className="text-sm mt-1">{inv.subject}</p>}
            <p className="text-sm text-muted-foreground mt-1">Billed to {inv.client_name}</p>
            {inv.property_address && <p className="text-xs text-muted-foreground">Service at {inv.property_address}</p>}
            {(inv.issue_date || inv.due_date) && (
              <p className="text-xs text-muted-foreground mt-1">
                {inv.issue_date && <>Issued {formatDate(inv.issue_date)}</>}
                {inv.issue_date && inv.due_date && " · "}
                {inv.due_date && <>Due <span className="font-medium text-foreground">{formatDate(inv.due_date)}</span></>}
              </p>
            )}
          </div>

          {inv.line_items?.length > 0 && (
            <div className="bg-card rounded-xl ring-1 ring-black/5 p-6 mb-6">
              <table className="w-full text-sm">
                <tbody>
                  {inv.line_items.map((li, i) => (
                    <tr key={i} className="border-t border-border/40 first:border-0 align-top">
                      <td className="py-2">
                        <p>{li.description}</p>
                        {li.details && <p className="text-xs text-muted-foreground">{li.details}</p>}
                        {li.service_date && <p className="text-xs text-muted-foreground">Service date: {li.service_date}</p>}
                      </td>
                      <td className="py-2 text-right tabular-nums text-muted-foreground">{li.hours != null && Number(li.hours) > 0 ? `${Number(Number(li.hours).toFixed(2))} hrs × ${money(li.unit_price_cents, inv.currency)}/hr` : `${li.quantity} × ${money(li.unit_price_cents, inv.currency)}`}</td>
                      <td className="py-2 text-right tabular-nums font-medium">{money(li.line_total_cents, inv.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 pt-3 border-t border-border/40 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{money(inv.subtotal_cents, inv.currency)}</span></div>
                {inv.discount_cents > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="tabular-nums">−{money(inv.discount_cents, inv.currency)}</span></div>}
                {inv.tax_cents > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span className="tabular-nums">{money(inv.tax_cents, inv.currency)}</span></div>}
              </div>
            </div>
          )}

          <div className="bg-card rounded-xl ring-1 ring-black/5 p-6 mb-6">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Amount due</span>
              <span className="text-3xl font-medium tabular-nums">{money(inv.total_cents, inv.currency)}</span>
            </div>
            {inv.card_surcharge && inv.surcharge_cents > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                Includes a {money(inv.surcharge_cents, inv.currency)} card processing surcharge.
              </p>
            )}
          </div>

          {inv.client_message && (
            <div className="bg-card rounded-xl ring-1 ring-black/5 p-6 mb-6 text-sm whitespace-pre-wrap">{inv.client_message}</div>
          )}

          {inv.photo_count > 0 && (
            <Link
              to="/pay/$invoiceId/photos"
              params={{ invoiceId }}
              search={preview ? { preview: true } : { k }}
              className="flex items-center justify-between gap-3 bg-card rounded-xl ring-1 ring-black/5 p-5 mb-6 hover:bg-muted"
            >
              <span className="flex items-center gap-3">
                <Images className="size-5 text-muted-foreground" aria-hidden />
                <span>
                  <span className="block text-sm font-medium">Photos from your service</span>
                  <span className="block text-xs text-muted-foreground">{inv.photo_count === 1 ? "1 photo" : `${inv.photo_count} photos`}</span>
                </span>
              </span>
              <span className="text-sm font-medium">View photos →</span>
            </Link>
          )}

          {!isPaid && !isDead && inv.venmo_link && !confirmed && (
            <a
              href={inv.venmo_link}
              data-pay
              target="_blank"
              rel="noreferrer"
              className="block w-full mb-4 rounded-lg ring-1 ring-black/10 bg-card px-4 py-3 text-center text-sm font-medium hover:bg-muted"
            >
              Pay {money(inv.subtotal_cents || inv.total_cents, inv.currency)} with Venmo
            </a>
          )}

          {isPaid ? (
            <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
              <p className="font-medium text-green-800">This invoice has been paid — thank you!</p>
            </div>
          ) : isDead ? (
            <div className="bg-muted rounded-xl p-6 text-center text-sm text-muted-foreground">
              This invoice is no longer payable.
            </div>
          ) : !inv.allow_card ? (
            !inv.venmo_link ? (
              <div className="bg-card rounded-xl ring-1 ring-black/5 p-6 text-center text-sm text-muted-foreground">
                Please pay this invoice by check, payable to Wash Rinse Repeat Cleaning.
              </div>
            ) : null
          ) : !confirmed ? (
            <div className="bg-card rounded-xl ring-1 ring-black/5 p-6 text-center space-y-4">
              <p className="text-sm font-medium">Please verify before paying</p>
              <p className="text-sm text-muted-foreground">
                Your card will be charged{" "}
                <span className="font-medium text-foreground">{money(inv.total_cents, inv.currency)}</span> for invoice {inv.number}.
                Nothing is charged until you confirm.
              </p>
              <button
                data-pay
                onClick={() => { if (!preview) setConfirmed(true); }}
                className="w-full rounded-lg bg-brand text-brand-foreground px-4 py-3 text-sm font-medium hover:opacity-90"
              >
                Confirm amount and continue to card payment
              </button>
            </div>
          ) : (
            <div className="bg-card rounded-xl ring-1 ring-black/5 overflow-hidden">
              <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret }}>
                <EmbeddedCheckout />
              </EmbeddedCheckoutProvider>
            </div>
          )}

          {inv.terms_text && (
            <div className="mt-6 text-xs text-muted-foreground whitespace-pre-wrap border-t border-border/40 pt-4">{inv.terms_text}</div>
          )}

          {(inv.business_phone || inv.business_email) && (
            <div className="mt-6 bg-card rounded-xl ring-1 ring-black/5 p-5 text-sm">
              <p className="font-medium">Questions about this invoice?</p>
              <p className="text-muted-foreground mt-1">
                We're always happy to help.{" "}
                {inv.business_phone && (
                  <>Call or text <a className="text-brand underline" href={`tel:${inv.business_phone.replace(/\D/g, "")}`}>{formatPhone(inv.business_phone)}</a></>
                )}
                {inv.business_phone && inv.business_email && " or email "}
                {!inv.business_phone && inv.business_email && "Email "}
                {inv.business_email && <a className="text-brand underline" href={`mailto:${inv.business_email}`}>{inv.business_email}</a>}
                .
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
