import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { addMonths, format, startOfMonth } from "date-fns";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { listTips, assignTip, addManualTip, canManageTips } from "@/lib/tips.functions";
import { listEmployees } from "@/lib/entities.functions";

export const Route = createFileRoute("/_authenticated/tips")({
  head: () => ({
    meta: [
      { title: "Tip tracker — Wash Rinse Repeat" },
      { name: "description", content: "Tips from client payments, split evenly between the cleaners on each job." },
      { property: "og:title", content: "Tip tracker — Wash Rinse Repeat" },
      { property: "og:description", content: "Tips from client payments, split evenly between the cleaners on each job." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TipsPage,
});

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

function TipsPage() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const from = month.toISOString();
  const to = addMonths(month, 1).toISOString();
  const tipsFn = useServerFn(listTips);
  const permsFn = useServerFn(canManageTips);
  const empFn = useServerFn(listEmployees);
  const assignFn = useServerFn(assignTip);
  const addFn = useServerFn(addManualTip);

  const { data: perms } = useQuery({ queryKey: ["can-manage-tips"], queryFn: () => permsFn() });
  const isMgr = !!perms?.isManager;
  const { data: tips = [], isLoading, error } = useQuery({
    queryKey: ["tips", from],
    queryFn: () => tipsFn({ data: { from, to } }),
  });
  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => empFn(),
    enabled: isMgr,
  });

  const totals = useMemo(() => {
    const m = new Map<string, { name: string; cents: number; count: number }>();
    for (const t of tips) {
      const k = t.employee_id ?? "unassigned";
      const cur = m.get(k) ?? { name: t.employee_name ?? "Unassigned", cents: 0, count: 0 };
      cur.cents += t.amount_cents;
      cur.count += 1;
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => b.cents - a.cents);
  }, [tips]);
  const grand = tips.reduce((s, t) => s + t.amount_cents, 0);

  const assignMut = useMutation({
    mutationFn: (v: { id: string; employee_id: string }) => assignFn({ data: v }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tips"] }); toast.success("Tip assigned"); },
    onError: (e: any) => toast.error(e?.message ?? "Could not assign"),
  });

  const [addOpen, setAddOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const addMut = useMutation({
    mutationFn: () => addFn({ data: { amount_cents: Math.round(parseFloat(amount) * 100), employee_ids: picked, note: note || undefined } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tips"] });
      setAddOpen(false); setAmount(""); setPicked([]); setNote("");
      toast.success("Tip recorded");
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not save"),
  });

  return (
    <>
      <PageHeader
        title={isMgr ? "Tip tracker" : "My tips"}
        subtitle="Anything a client pays above the invoice total (card fee included) is split evenly between the cleaners on that job."
      />
      <div className="px-6 md:px-8 py-6 space-y-6 max-w-5xl w-full mx-auto">
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="icon" variant="outline" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month"><ChevronLeft className="size-4" /></Button>
          <div className="font-medium min-w-32 text-center">{format(month, "MMMM yyyy")}</div>
          <Button size="icon" variant="outline" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month"><ChevronRight className="size-4" /></Button>
          <div className="ml-auto text-sm">Total: <span className="font-semibold">{money(grand)}</span></div>
          {isMgr && (
            <Button size="sm" className="bg-brand text-brand-foreground hover:opacity-90" onClick={() => setAddOpen(true)}>
              <Plus className="size-4" /> Add cash tip
            </Button>
          )}
        </div>

        {totals.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {totals.map((t) => (
              <div key={t.name} className="rounded-xl border border-border/60 p-4">
                <div className="text-sm text-muted-foreground">{t.name}</div>
                <div className="text-2xl font-semibold">{money(t.cents)}</div>
                <div className="text-xs text-muted-foreground">{t.count} tip{t.count === 1 ? "" : "s"}</div>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-xl border border-border/60 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground border-b border-border/60">
              <tr><th className="p-3">Date</th><th className="p-3">Cleaner</th><th className="p-3">From</th><th className="p-3 text-right">Amount</th></tr>
            </thead>
            <tbody>
              {isLoading && <tr><td className="p-3" colSpan={4}>Loading…</td></tr>}
              {error && <tr><td className="p-3 text-destructive" colSpan={4}>{(error as Error).message}</td></tr>}
              {!isLoading && !error && tips.length === 0 && (
                <tr><td className="p-3 text-muted-foreground" colSpan={4}>No tips this month.</td></tr>
              )}
              {tips.map((t) => (
                <tr key={t.id} className="border-b border-border/40 last:border-0">
                  <td className="p-3">{format(new Date(t.job_start ?? t.created_at), "MMM d, yyyy")}</td>
                  <td className="p-3">
                    {t.employee_id ? t.employee_name : isMgr ? (
                      <select className="border rounded-md px-2 py-1 bg-background" defaultValue=""
                        onChange={(e) => e.target.value && assignMut.mutate({ id: t.id, employee_id: e.target.value })}>
                        <option value="">Assign to…</option>
                        {(employees as any[]).map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                      </select>
                    ) : "Unassigned"}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {t.source === "manual" ? `Cash${t.note ? ` · ${t.note}` : ""}` : `Invoice ${t.invoice_number ?? ""}`}
                  </td>
                  <td className="p-3 text-right font-medium">{money(t.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add cash tip</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="tip-amt">Amount ($)</Label>
              <Input id="tip-amt" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Split evenly between</Label>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {(employees as any[]).map((e) => (
                  <label key={e.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={picked.includes(e.id)}
                      onCheckedChange={(v) => setPicked((p) => v ? [...p, e.id] : p.filter((x) => x !== e.id))} />
                    {e.full_name}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="tip-note">Note (optional)</Label>
              <Input id="tip-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button className="bg-brand text-brand-foreground hover:opacity-90"
              disabled={!(parseFloat(amount) > 0) || !picked.length || addMut.isPending}
              onClick={() => addMut.mutate()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
