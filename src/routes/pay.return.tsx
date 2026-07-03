import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";

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
  return (
    <div className="min-h-screen bg-clay-50 grid place-items-center px-6">
      <div className="max-w-md w-full bg-card rounded-xl ring-1 ring-black/5 p-8 text-center space-y-3">
        <div className="mx-auto size-12 rounded-full bg-green-100 grid place-items-center">
          <CheckCircle2 className="size-6 text-green-700" />
        </div>
        <h1 className="text-xl font-medium">Payment received</h1>
        <p className="text-sm text-muted-foreground">
          Thank you for your payment. A receipt has been emailed to you.
        </p>
        {session_id && (
          <p className="text-[10px] font-mono text-muted-foreground/70 pt-3 break-all">Ref: {session_id}</p>
        )}
      </div>
    </div>
  );
}
