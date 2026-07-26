import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { listMyInvoices, type PortalInvoice } from "@/lib/portal.functions";

export const Route = createFileRoute("/portal/billing")({
  component: PortalBillingPage,
});

function money(cents: number, currency = "usd") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

const STATUS_STYLE: Record<string, string> = {
  paid: "bg-success/15 text-success",
  sent: "bg-brand/15 text-brand",
  overdue: "bg-destructive/15 text-destructive",
  draft: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground",
  void: "bg-muted text-muted-foreground",
};

function PortalBillingPage() {
  const listFn = useServerFn(listMyInvoices);
  const { data: invoices = [], isLoading } = useQuery<PortalInvoice[]>({
    queryKey: ["portal-invoices"],
    queryFn: () =>
      listFn({ data: { session_token: localStorage.getItem("portal_session") ?? "" } }),
  });

  const payable = (inv: PortalInvoice) => inv.status === "sent" || inv.status === "overdue";

  return (
    <div className="space-y-3">
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : invoices.length === 0 ? (
        <p className="text-sm text-muted-foreground">No invoices yet.</p>
      ) : (
        invoices.map((inv) => (
          <div
            key={inv.id}
            className="bg-card rounded-xl ring-1 ring-black/5 p-4 flex items-center justify-between gap-3"
          >
            <div>
              <p className="font-medium text-sm">Invoice {inv.number}</p>
              <p className="text-xs text-muted-foreground">
                {inv.issue_date ? format(new Date(inv.issue_date), "MMM d, yyyy") : "—"}
                {inv.due_date && ` · due ${format(new Date(inv.due_date), "MMM d")}`}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="font-medium tabular-nums">{money(inv.total_cents, inv.currency)}</p>
              <span
                className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${STATUS_STYLE[inv.status] ?? "bg-muted text-muted-foreground"}`}
              >
                {inv.status}
              </span>
            </div>
            {payable(inv) && (
              <Link
                to="/pay/$invoiceId"
                params={{ invoiceId: inv.id }}
                target="_blank"
                className="text-xs bg-brand text-brand-foreground rounded-lg px-3 py-2 font-medium shrink-0"
              >
                Pay
              </Link>
            )}
          </div>
        ))
      )}
    </div>
  );
}
