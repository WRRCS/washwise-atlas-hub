import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { verifyCheckoutSession, type VerifyCheckoutResult } from "@/lib/pay.functions";
import { getStripeEnvironment } from "@/lib/stripe";

export const Route = createFileRoute("/pay/return")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { session_id?: string } => ({
    session_id: typeof search.session_id === "string" ? search.session_id : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Payment received — Wash Rinse Repeat Cleaning" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PayReturnPage,
});

function PayReturnPage() {
  const { session_id } = Route.useSearch();
  const [result, setResult] = useState<VerifyCheckoutResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session_id) {
      setError("Missing session reference.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const env = getStripeEnvironment();
        const res = await verifyCheckoutSession({ data: { session_id, environment: env } });
        if (!cancelled) setResult(res);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Verification failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session_id]);

  const paid = result && "paid" in result && result.paid === true;
  const failed = error || (result && "paid" in result && result.paid === false);

  return (
    <div className="min-h-screen bg-clay-50 grid place-items-center px-6">
      <div className="max-w-md w-full bg-card rounded-xl ring-1 ring-black/5 p-8 text-center space-y-3">
        {!result && !error ? (
          <>
            <div className="mx-auto size-12 rounded-full bg-clay-100 grid place-items-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
            <h1 className="text-xl font-medium">Verifying payment…</h1>
            <p className="text-sm text-muted-foreground">This only takes a moment.</p>
          </>
        ) : paid ? (
          <>
            <div className="mx-auto size-12 rounded-full bg-green-100 grid place-items-center">
              <CheckCircle2 className="size-6 text-green-700" />
            </div>
            <h1 className="text-xl font-medium">Payment received</h1>
            <p className="text-sm text-muted-foreground">
              Thank you for your payment. A receipt has been emailed to you.
            </p>
          </>
        ) : (
          <>
            <div className="mx-auto size-12 rounded-full bg-amber-100 grid place-items-center">
              <AlertTriangle className="size-6 text-amber-700" />
            </div>
            <h1 className="text-xl font-medium">Payment could not be verified</h1>
            <p className="text-sm text-muted-foreground">
              {error ?? (result && "reason" in result ? result.reason : "Please try again or contact support.")}
            </p>
            <Link to="/" className="inline-block text-sm underline mt-2">Return home</Link>
          </>
        )}
        {session_id && (
          <p className="text-[10px] font-mono text-muted-foreground/70 pt-3 break-all">Ref: {session_id}</p>
        )}
      </div>
    </div>
  );
}
