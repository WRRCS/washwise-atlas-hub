import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/app-shell";
import { listInvoices } from "@/lib/entities.functions";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/invoices")({
  component: Invoices,
  errorComponent: ({ error }) => <div className="p-8 text-sm text-destructive">{error.message}</div>,
});

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-warning/15 text-warning",
  paid: "bg-success/15 text-success",
  void: "bg-destructive/10 text-destructive",
};

function Invoices() {
  const fn = useServerFn(listInvoices);
  const { data = [], isLoading } = useQuery({ queryKey: ["invoices"], queryFn: () => fn({}) });

  return (
    <>
      <PageHeader title="Invoices" subtitle="Generate invoices from completed jobs and share secure pay links." />
      <div className="max-w-5xl mx-auto w-full px-6 md:px-8 py-8 space-y-6">
        <div className="rounded-xl bg-clay-100 p-5 text-sm text-muted-foreground">
          Payments aren't hooked up yet — connect Stripe (built-in) to generate secure pay links and mark invoices paid automatically. Just ask.
        </div>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : data.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No invoices yet. Complete a job to create one.</div>
        ) : (
          <div className="grid gap-3">
            {data.map((inv) => (
              <div key={inv.id} className="bg-card p-5 rounded-xl ring-1 ring-black/5 flex justify-between items-center">
                <div>
                  <p className="text-sm text-muted-foreground">#{inv.number}</p>
                  <p className="text-base font-medium">{[inv.client?.first_name, inv.client?.last_name].filter(Boolean).join(" ") || "—"}</p>
                  <p className="text-xs text-muted-foreground">
                    {inv.sent_at ? `Sent ${format(new Date(inv.sent_at), "PP")}` : "Not sent"}
                    {inv.paid_at && ` · Paid ${format(new Date(inv.paid_at), "PP")}`}
                  </p>
                </div>
                <div className="text-right space-y-1">
                  <p className="text-lg font-medium tabular-nums">${(inv.amount_cents / 100).toFixed(2)}</p>
                  <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider ${STATUS_STYLE[inv.status]}`}>{inv.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
