import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { format } from "date-fns";
import { listInvoices, createMonthlyBundle, previewMonthlyBundle } from "@/lib/invoices.functions";
import { listClients } from "@/lib/entities.functions";
import { Layers, Filter } from "lucide-react";

export const Route = createFileRoute("/_authenticated/invoices")({
  component: InvoicesPage,
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

function InvoicesPage() {
  const listFn = useServerFn(listInvoices);
  const clientsFn = useServerFn(listClients);

  const [status, setStatus] = useState<string>("all");
  const [clientId, setClientId] = useState<string>("all");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const filters = useMemo(
    () => ({
      status: status === "all" ? undefined : status,
      client_id: clientId === "all" ? undefined : clientId,
      from: from || undefined,
      to: to || undefined,
    }),
    [status, clientId, from, to],
  );

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["invoices", filters],
    queryFn: () => listFn({ data: filters }),
  });
  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: () => clientsFn({}) });

  const [bundleOpen, setBundleOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle={`${invoices.length} shown`}
        action={
          <Button onClick={() => setBundleOpen(true)} className="bg-brand text-brand-foreground hover:opacity-90">
            <Layers className="size-4 mr-1.5" /> Create monthly bundle
          </Button>
        }
      />
      <div className="max-w-6xl mx-auto w-full px-6 md:px-8 py-6 space-y-4">
        <div className="bg-card rounded-xl ring-1 ring-black/5 p-4 flex flex-wrap gap-3 items-end">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground pr-2">
            <Filter className="size-3.5" /> Filter
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Client</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All clients</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{fullName(c)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
        </div>

        <div className="bg-card rounded-xl ring-1 ring-black/5 overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-sm text-muted-foreground">Loading…</div>
          ) : invoices.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No invoices match those filters.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-clay-100/50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Invoice #</th>
                  <th className="text-left px-4 py-3 font-medium">Client</th>
                  <th className="text-left px-4 py-3 font-medium">Issued</th>
                  <th className="text-left px-4 py-3 font-medium">Due</th>
                  <th className="text-right px-4 py-3 font-medium">Amount</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-t border-border/40 hover:bg-clay-50/60">
                    <td className="px-4 py-3">
                      <Link
                        to="/invoices/$invoiceId"
                        params={{ invoiceId: inv.id }}
                        className="font-medium text-brand hover:underline"
                      >
                        {inv.number}
                      </Link>
                      {inv.cleanings_count ? (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                          × {inv.cleanings_count} cleanings
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">{fullName(inv.client)}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {inv.issue_date ? format(new Date(inv.issue_date), "PP") : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {inv.due_date ? format(new Date(inv.due_date), "PP") : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">
                      {money(inv.total_cents || inv.amount_cents)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider ${STATUS_STYLE[inv.status] ?? "bg-muted"}`}>
                        {inv.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <MonthlyBundleDialog
        open={bundleOpen}
        onClose={() => setBundleOpen(false)}
        clients={clients}
      />
    </>
  );
}

function MonthlyBundleDialog({
  open, onClose, clients,
}: {
  open: boolean;
  onClose: () => void;
  clients: { id: string; first_name: string | null; last_name: string | null }[];
}) {
  const previewFn = useServerFn(previewMonthlyBundle);
  const createFn = useServerFn(createMonthlyBundle);
  const navigate = Route.useNavigate();

  const [clientId, setClientId] = useState<string>("");
  const [month, setMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [busy, setBusy] = useState(false);

  const { data: jobs = [], isFetching } = useQuery({
    queryKey: ["bundle-preview", clientId, month],
    queryFn: () => previewFn({ data: { client_id: clientId, month } }),
    enabled: !!clientId && !!month && open,
  });

  const subtotal = jobs.reduce((s, j) => s + (j.price_cents ?? 0), 0);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create monthly bundle</DialogTitle>
          <DialogDescription>
            Bundle all of a client's completed jobs from a chosen month into one invoice. Any existing draft invoices for those jobs are replaced.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Client</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{fullName(c)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Month</Label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>

          {clientId && (
            <div className="rounded-lg border border-border/60 p-3 text-sm bg-clay-50">
              {isFetching ? (
                <p className="text-muted-foreground">Loading…</p>
              ) : jobs.length === 0 ? (
                <p className="text-muted-foreground">No completed jobs found for that month.</p>
              ) : (
                <>
                  <ul className="space-y-1 max-h-48 overflow-auto">
                    {jobs.map((j) => (
                      <li key={j.id} className="flex justify-between gap-3">
                        <span className="truncate">
                          {(j.service_type as { name?: string } | null)?.name ?? "Cleaning"} —{" "}
                          {format(new Date(j.scheduled_start), "MMM d, yyyy")}
                        </span>
                        <span className="tabular-nums text-muted-foreground">{money(j.price_cents)}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="pt-2 mt-2 border-t border-border/60 flex justify-between font-medium">
                    <span>Subtotal ({jobs.length} cleaning{jobs.length !== 1 ? "s" : ""})</span>
                    <span className="tabular-nums">{money(subtotal)}</span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            disabled={!clientId || jobs.length === 0 || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const res = await createFn({ data: { client_id: clientId, month } });
                toast.success(`Created ${res.number} (${res.count} cleanings)`);
                onClose();
                navigate({ to: "/invoices/$invoiceId", params: { invoiceId: res.id } });
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed to create bundle");
              } finally {
                setBusy(false);
              }
            }}
            className="bg-brand text-brand-foreground hover:opacity-90"
          >
            Create invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
