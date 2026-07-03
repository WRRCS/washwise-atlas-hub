import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  getInvoice, sendInvoice, markInvoicePaid, cancelInvoice, setCardSurcharge,
} from "@/lib/invoices.functions";
import { ArrowLeft, Send, Check, X } from "lucide-react";

export const Route = createFileRoute("/_authenticated/invoices/$invoiceId")({
  component: InvoiceDetailPage,
  errorComponent: ({ error }) => <div className="p-8 text-sm text-destructive">{error.message}</div>,
});

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-warning/15 text-warning",
  paid: "bg-success/15 text-success",
  overdue: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground line-through",
  void: "bg-muted text-muted-foreground line-through",
};

function money(cents: number | null | undefined) {
  return `$${((cents ?? 0) / 100).toFixed(2)}`;
}
function fullName(c: { first_name: string | null; last_name: string | null } | null | undefined) {
  if (!c) return "—";
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || "—";
}

function InvoiceDetailPage() {
  const { invoiceId } = Route.useParams();
  const qc = useQueryClient();
  const getFn = useServerFn(getInvoice);
  const sendFn = useServerFn(sendInvoice);
  const paidFn = useServerFn(markInvoicePaid);
  const cancelFn = useServerFn(cancelInvoice);
  const toggleFn = useServerFn(setCardSurcharge);

  const { data: inv, isLoading } = useQuery({
    queryKey: ["invoice", invoiceId],
    queryFn: () => getFn({ data: { id: invoiceId } }),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["invoice", invoiceId] });
    qc.invalidateQueries({ queryKey: ["invoices"] });
  };

  if (isLoading) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  if (!inv) return <div className="p-8 text-sm text-muted-foreground">Invoice not found.</div>;

  const canEdit = inv.status === "draft";

  return (
    <>
      <PageHeader
        title={inv.number}
        subtitle={`${fullName(inv.client)} · ${inv.status}`}
        action={
          <Link to="/invoices" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
            <ArrowLeft className="size-4" /> Back
          </Link>
        }
      />
      <div className="max-w-4xl mx-auto w-full px-6 md:px-8 py-6 space-y-6">
        {/* Header card */}
        <div className="bg-card rounded-xl ring-1 ring-black/5 p-6 grid gap-6 md:grid-cols-3">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Bill to</p>
            <p className="font-medium">{fullName(inv.client)}</p>
            {inv.client?.email && <p className="text-sm text-muted-foreground">{inv.client.email}</p>}
            {inv.client?.phone && <p className="text-sm text-muted-foreground">{inv.client.phone}</p>}
            {inv.client?.billing_address && (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{inv.client.billing_address}</p>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Issued</p>
            <p className="font-medium">{inv.issue_date ? format(new Date(inv.issue_date), "PP") : "—"}</p>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mt-3">Due</p>
            <p className="font-medium">{inv.due_date ? format(new Date(inv.due_date), "PP") : "—"}</p>
          </div>
          <div className="space-y-1 md:text-right">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Status</p>
            <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider ${STATUS_STYLE[inv.status] ?? "bg-muted"}`}>
              {inv.status}
            </span>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mt-3">Total</p>
            <p className="text-2xl font-medium tabular-nums">{money(inv.total_cents || inv.amount_cents)}</p>
            {inv.cleanings_count ? (
              <p className="text-xs text-muted-foreground">{inv.cleanings_count} cleanings bundled</p>
            ) : null}
          </div>
        </div>

        {/* Line items */}
        <div className="bg-card rounded-xl ring-1 ring-black/5 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-clay-100/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Description</th>
                <th className="text-right px-4 py-3 font-medium">Qty</th>
                <th className="text-right px-4 py-3 font-medium">Unit</th>
                <th className="text-right px-4 py-3 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {inv.line_items.map((li) => (
                <tr key={li.id} className="border-t border-border/40">
                  <td className="px-4 py-3">{li.description}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{li.quantity}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{money(li.unit_price_cents)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{money(li.line_total_cents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-clay-50/50 text-sm">
              <tr className="border-t border-border/40">
                <td colSpan={3} className="px-4 py-2 text-right text-muted-foreground">Subtotal</td>
                <td className="px-4 py-2 text-right tabular-nums">{money(inv.subtotal_cents)}</td>
              </tr>
              {inv.surcharge_cents > 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-2 text-right text-muted-foreground">Card surcharge (3% + $0.30)</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(inv.surcharge_cents)}</td>
                </tr>
              )}
              <tr className="border-t border-border/40 font-medium">
                <td colSpan={3} className="px-4 py-3 text-right">Total</td>
                <td className="px-4 py-3 text-right tabular-nums">{money(inv.total_cents)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Actions */}
        <div className="bg-card rounded-xl ring-1 ring-black/5 p-4 flex flex-wrap gap-3 items-center justify-between">
          <div className="flex items-center gap-3">
            <Switch
              id="card-surcharge"
              checked={inv.card_surcharge}
              disabled={!canEdit}
              onCheckedChange={async (v) => {
                try {
                  await toggleFn({ data: { id: inv.id, enabled: v } });
                  toast.success(v ? "Card surcharge added" : "Card surcharge removed");
                  refresh();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed");
                }
              }}
            />
            <Label htmlFor="card-surcharge" className="text-sm">
              Add card surcharge <span className="text-muted-foreground">(3% + $0.30 if paying by card)</span>
            </Label>
          </div>
          <div className="flex gap-2">
            {inv.status === "draft" && (
              <Button
                onClick={async () => {
                  try { await sendFn({ data: { id: inv.id } }); toast.success("Invoice sent"); refresh(); }
                  catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
                }}
                className="bg-brand text-brand-foreground hover:opacity-90"
              >
                <Send className="size-4 mr-1.5" /> Send
              </Button>
            )}
            {(inv.status === "sent" || inv.status === "overdue") && (
              <Button
                onClick={async () => {
                  try { await paidFn({ data: { id: inv.id } }); toast.success("Marked paid"); refresh(); }
                  catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
                }}
              >
                <Check className="size-4 mr-1.5" /> Mark paid
              </Button>
            )}
            {inv.status !== "paid" && inv.status !== "cancelled" && (
              <Button
                variant="ghost"
                onClick={async () => {
                  if (!confirm("Cancel this invoice?")) return;
                  try { await cancelFn({ data: { id: inv.id } }); toast.success("Cancelled"); refresh(); }
                  catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
                }}
              >
                <X className="size-4 mr-1.5" /> Cancel
              </Button>
            )}
          </div>
        </div>

        {inv.job_id && (
          <div className="text-xs text-muted-foreground">
            Auto-generated from{" "}
            <Link to="/jobs/$jobId" params={{ jobId: inv.job_id }} className="underline hover:text-foreground">
              job
            </Link>
            .
          </div>
        )}
      </div>
    </>
  );
}
