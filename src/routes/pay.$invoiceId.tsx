import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback } from "react";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { getPublicInvoice, createInvoiceCheckout } from "@/lib/invoice-checkout.functions";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";

export const Route = createFileRoute("/pay/$invoiceId")({
  component: PayInvoicePage,
  ssr: false,
  head: () => ({
    meta: [
      { title: "Pay your invoice — Wash Rinse Repeat Cleaning" },
      { name: "description", content: "Secure invoice payment for Wash Rinse Repeat Cleaning." },
      { name: "robots", content: "noindex" },
    ],
  }),
  errorComponent: ({ error }) => <div className="p-8 text-sm text-red-700">{error.message}</div>,
  notFoundComponent: () => <div className="p-8 text-sm text-muted-foreground">Invoice not found.</div>,
});

function money(cents: number, currency = "usd") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

function PayInvoicePage() {
  const { invoiceId } = Route.useParams();
  const getFn = useServerFn(getPublicInvoice);
  const createFn = useServerFn(createInvoiceCheckout);

  const { data: inv, isLoading } = useQuery({
    queryKey: ["public-invoice", invoiceId],
    queryFn: () => getFn({ data: { id: invoiceId } }),
  });

  const fetchClientSecret = useCallback(async (): Promise<string> => {
    const result = await createFn({
      data: {
        invoice_id: invoiceId,
        return_url: `${window.location.origin}/pay/return`,
        environment: getStripeEnvironment(),
      },
    });
    if ("error" in result) throw new Error(result.error);
    if (!result.clientSecret) throw new Error("Could not start checkout");
    return result.clientSecret;
  }, [createFn, invoiceId]);

  if (isLoading) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  if (!inv || "error" in inv) return <div className="max-w-md mx-auto p-8 text-sm text-red-700">{(inv as { error: string })?.error ?? "Invoice not found"}</div>;

  const isPaid = inv.status === "paid";
  const isDead = inv.status === "cancelled" || inv.status === "void";

  return (
    <>
      <PaymentTestModeBanner />
      <div className="min-h-screen bg-clay-50">
        <div className="max-w-2xl mx-auto px-6 py-10">
          <div className="text-center mb-6">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Wash Rinse Repeat Cleaning</p>
            <h1 className="text-2xl font-medium mt-2">Invoice {inv.number}</h1>
            <p className="text-sm text-muted-foreground mt-1">Billed to {inv.client_name}</p>
          </div>

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

          {isPaid ? (
            <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
              <p className="font-medium text-green-800">This invoice has been paid — thank you!</p>
            </div>
          ) : isDead ? (
            <div className="bg-muted rounded-xl p-6 text-center text-sm text-muted-foreground">
              This invoice is no longer payable.
            </div>
          ) : (
            <div className="bg-card rounded-xl ring-1 ring-black/5 overflow-hidden">
              <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret }}>
                <EmbeddedCheckout />
              </EmbeddedCheckoutProvider>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
