import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  getInvoice, sendInvoice, markInvoicePaid, cancelInvoice, setCardSurcharge,
} from "@/lib/invoices.functions";
import { listInvoicePayments, recordManualPayment } from "@/lib/payments.functions";
import { syncInvoiceToQbo } from "@/lib/qbo.functions";
import { ArrowLeft, Send, Check, X, Wallet, CreditCard, Building2, HandCoins, Copy, ExternalLink, RefreshCw, AlertTriangle } from "lucide-react";

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
            <QboSyncButton
              invoiceId={inv.id}
              qboId={(inv as any).qbo_id ?? null}
              qboError={(inv as any).qbo_sync_error ?? null}
              onDone={refresh}
            />
          </div>
        </div>

        {(inv as any).qbo_id && (
          <div className="flex items-center gap-2 text-xs text-success">
            <Check className="size-3.5" /> Synced to QuickBooks
            {(inv as any).qbo_synced_at && (
              <span className="text-muted-foreground">
                · {format(new Date((inv as any).qbo_synced_at), "PPp")}
              </span>
            )}
          </div>
        )}
        {(inv as any).qbo_sync_error && !(inv as any).qbo_id && (
          <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/5 ring-1 ring-destructive/20 rounded-lg p-3">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-medium">QuickBooks sync failed</p>
              <p className="text-muted-foreground break-words">{(inv as any).qbo_sync_error}</p>
            </div>
          </div>
        )}

        <PaymentLinksCard invoiceId={inv.id} status={inv.status} onPaid={refresh} />

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

function PaymentLinksCard({ invoiceId, status, onPaid }: { invoiceId: string; status: string; onPaid: () => void }) {
  const qc = useQueryClient();
  const listPayFn = useServerFn(listInvoicePayments);
  const manualFn = useServerFn(recordManualPayment);
  const [placeholder, setPlaceholder] = useState<null | "venmo" | "ach">(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [method, setMethod] = useState<"cash" | "check" | "other">("cash");
  const [note, setNote] = useState("");

  const { data: payments = [] } = useQuery({
    queryKey: ["invoice-payments", invoiceId],
    queryFn: () => listPayFn({ data: { invoice_id: invoiceId } }),
  });

  const isPaid = status === "paid";
  const isCancelled = status === "cancelled";

  const payUrl = typeof window !== "undefined" ? `${window.location.origin}/pay/${invoiceId}` : "";

  const copyPayLink = async () => {
    await navigator.clipboard.writeText(payUrl);
    toast.success("Payment link copied");
  };

  const submitManual = async () => {
    try {
      await manualFn({ data: { invoice_id: invoiceId, method, note: note || undefined } });
      toast.success("Payment recorded");
      setManualOpen(false); setNote(""); setMethod("cash");
      qc.invalidateQueries({ queryKey: ["invoice-payments", invoiceId] });
      onPaid();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const providerCopy: Record<string, string> = {
    venmo: "Venmo integration coming in Phase 2. We'll wire up the Venmo Business API to auto-generate payment requests and reconcile received transfers.",
    ach: "ACH payments coming in Phase 2 via Stripe Financial Connections for low-fee bank transfers.",
  };

  return (
    <>
      <div className="bg-card rounded-xl ring-1 ring-black/5 p-6 space-y-4">
        <div>
          <h3 className="text-sm font-semibold">Payment links</h3>
          <p className="text-xs text-muted-foreground">Send the client a way to pay, or record an offline payment.</p>
        </div>

        {!isPaid && !isCancelled && (
          <div className="rounded-lg bg-clay-50 ring-1 ring-black/5 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <CreditCard className="size-4 text-brand" />
              <p className="text-sm font-medium">Card payment link</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Send this secure link to your client — they can pay by card without signing in.
            </p>
            <div className="flex gap-2">
              <input readOnly value={payUrl} className="flex-1 font-mono text-xs px-3 py-2 rounded-lg bg-background border border-input" />
              <Button variant="outline" onClick={copyPayLink}><Copy className="size-4" /></Button>
              <Button variant="outline" onClick={() => window.open(payUrl, "_blank")}><ExternalLink className="size-4" /></Button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <Button variant="outline" disabled={isPaid || isCancelled} onClick={() => setPlaceholder("venmo")}>
            <Wallet className="size-4 mr-1.5" /> Venmo
          </Button>
          <Button variant="outline" disabled={isPaid || isCancelled} onClick={() => setPlaceholder("ach")}>
            <Building2 className="size-4 mr-1.5" /> ACH
          </Button>
          <Button disabled={isPaid || isCancelled} onClick={() => setManualOpen(true)} className="bg-foreground text-background hover:opacity-90">
            <HandCoins className="size-4 mr-1.5" /> Mark paid manually
          </Button>
        </div>

        {payments.length > 0 && (
          <div className="pt-3 border-t border-border/40">
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Payment history</p>
            <ul className="space-y-1.5">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between text-sm">
                  <span className="capitalize">{p.provider}{p.note ? ` · ${p.note}` : ""}</span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    ${(p.amount_cents / 100).toFixed(2)} · {p.status}
                    {p.processed_at && ` · ${format(new Date(p.processed_at), "MMM d")}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <Dialog open={!!placeholder} onOpenChange={(o) => !o && setPlaceholder(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="capitalize">Pay with {placeholder}</DialogTitle>
            <DialogDescription>{placeholder && providerCopy[placeholder]}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setPlaceholder(null)}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record manual payment</DialogTitle>
            <DialogDescription>Log an offline payment received via cash, check, or another method.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Method</Label>
              <div className="flex gap-2 mt-1">
                {(["cash", "check", "other"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethod(m)}
                    className={`text-sm px-3 py-1.5 rounded-lg border capitalize ${method === m ? "border-brand bg-brand/5 text-brand" : "border-border"}`}
                  >{m}</button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs">Note (optional)</Label>
              <input
                value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="Check #1042"
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setManualOpen(false)}>Cancel</Button>
            <Button onClick={submitManual} className="bg-brand text-brand-foreground hover:opacity-90">Record payment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
