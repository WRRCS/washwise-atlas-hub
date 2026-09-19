import { createFileRoute, useRouter } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell, PageHeader, BrandButton } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Minus, Plus, Trash2, PackagePlus, Pencil } from "lucide-react";
import {
  getCaddyOverview, saveCaddyItem, setCaddyLevel, deleteCaddyItem,
  stockCaddyFromTemplate, saveCaddyTemplateItem, deleteCaddyTemplateItem,
  type CaddyItem, type CaddyEmployee, type CaddyTemplateItem,
} from "@/lib/caddy.functions";

const caddyQO = queryOptions({ queryKey: ["caddies"], queryFn: () => getCaddyOverview() });

export const Route = createFileRoute("/_authenticated/caddies")({
  loader: ({ context }) => context.queryClient.ensureQueryData(caddyQO),
  component: CaddiesPage,
  head: () => ({
    meta: [
      { title: "Caddy supplies | WRRCS" },
      { name: "description", content: "Track what every cleaner carries in their caddy and restock it in a tap." },
      { property: "og:title", content: "Caddy supplies" },
      { property: "og:description", content: "Track what every cleaner carries in their caddy and restock it in a tap." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  errorComponent: ({ error }) => (
    <AppShell><div className="p-8 text-red-600">Error: {error.message}</div></AppShell>
  ),
});

const UNITS = ["each", "can", "bottle", "roll", "pack", "box"];

const LEVELS = [
  { pct: 100, label: "Full" },
  { pct: 75, label: "3/4" },
  { pct: 50, label: "Half" },
  { pct: 25, label: "1/4" },
  { pct: 0, label: "Out" },
];

function CaddiesPage() {
  const { data } = useSuspenseQuery(caddyQO);
  const router = useRouter();
  const saveItem = useServerFn(saveCaddyItem);
  const setLevel = useServerFn(setCaddyLevel);
  const delItem = useServerFn(deleteCaddyItem);
  const stock = useServerFn(stockCaddyFromTemplate);

  const [addFor, setAddFor] = useState<CaddyEmployee | null>(null);
  const [editItem, setEditItem] = useState<CaddyItem | null>(null);
  const [showTemplate, setShowTemplate] = useState(false);

  const refresh = () => router.invalidate();

  const pickLevel = async (item: CaddyItem, pct: number) => {
    try {
      await setLevel({ data: { id: item.id, level_pct: pct } });
      refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  const onDelete = async (item: CaddyItem) => {
    if (!confirm(`Remove "${item.name}" from this caddy?`)) return;
    try {
      await delItem({ data: { id: item.id } });
      toast.success("Removed");
      refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  const onStock = async (emp: CaddyEmployee) => {
    try {
      const res = await stock({ data: { employee_id: emp.id } });
      toast.success(res.added ? `Added ${res.added} standard item${res.added === 1 ? "" : "s"}` : "Already has every standard item");
      refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  return (
    <AppShell>
      <PageHeader
        title="Caddy supplies"
        subtitle="What each cleaner carries in their caddy — change it any time"
        action={data.isManager ? (
          <BrandButton onClick={() => setShowTemplate(true)}>
            <Pencil className="size-4 mr-1.5" />Standard caddy list
          </BrandButton>
        ) : undefined}
      />
      <div className="max-w-5xl mx-auto w-full px-6 md:px-8 py-8 space-y-6">
        {data.employees.length === 0 && (
          <div className="text-muted-foreground">No team members yet.</div>
        )}
        {data.employees.map((emp) => (
          <div key={emp.id} className="bg-white rounded-xl ring-1 ring-black/5 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between gap-3">
              <div className="font-medium">{emp.full_name}{emp.id === data.myId ? " (you)" : ""}</div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => onStock(emp)}>
                  <PackagePlus className="size-4 mr-1.5" />Stock standard
                </Button>
                <Button variant="outline" size="sm" onClick={() => setAddFor(emp)}>
                  <Plus className="size-4 mr-1.5" />Add item
                </Button>
              </div>
            </div>
            {emp.items.length === 0 ? (
              <div className="px-4 py-8 text-center text-muted-foreground text-sm">
                Caddy is empty — tap “Stock standard” to fill it with the standard list.
              </div>
            ) : (
              <ul className="divide-y divide-border/60">
                {emp.items.map((it) => (
                  <li key={it.id} className="px-4 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{it.name}</div>
                      {it.notes && <div className="text-xs text-muted-foreground truncate">{it.notes}</div>}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="icon" className="size-8" onClick={() => bump(it, -1)}>
                        <Minus className="size-4" />
                      </Button>
                      <div className="w-20 text-center tabular-nums text-sm">
                        {it.qty} <span className="text-muted-foreground">{it.unit}</span>
                      </div>
                      <Button variant="outline" size="icon" className="size-8" onClick={() => bump(it, 1)}>
                        <Plus className="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditItem(it)}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-8 text-red-600" onClick={() => onDelete(it)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {(addFor || editItem) && (
        <ItemDialog
          item={editItem}
          employeeId={editItem ? editItem.employee_id : addFor!.id}
          onClose={() => { setAddFor(null); setEditItem(null); }}
          onSaved={() => { setAddFor(null); setEditItem(null); refresh(); }}
          save={saveItem}
        />
      )}

      {showTemplate && (
        <TemplateDialog
          template={data.template}
          onClose={() => setShowTemplate(false)}
          onChanged={refresh}
        />
      )}
    </AppShell>
  );
}

function ItemDialog({ item, employeeId, onClose, onSaved, save }: {
  item: CaddyItem | null;
  employeeId: string;
  onClose: () => void;
  onSaved: () => void;
  save: (args: any) => Promise<any>;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [unit, setUnit] = useState(item?.unit ?? "each");
  const [qty, setQty] = useState(String(item?.qty ?? 1));
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) { toast.error("Name is required"); return; }
    setBusy(true);
    try {
      await save({ data: { id: item?.id, employee_id: employeeId, name, unit, qty: Number(qty) || 0, notes: notes || null } });
      toast.success("Saved");
      onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{item ? "Edit caddy item" : "Add caddy item"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Item</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bar Keepers Friend" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Quantity</Label>
              <Input type="number" min={0} step="1" value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div>
              <Label>Unit</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              >
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div>
            <Label>Notes (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <BrandButton onClick={() => { if (!busy) void submit(); }}>Save</BrandButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplateDialog({ template, onClose, onChanged }: {
  template: CaddyTemplateItem[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const save = useServerFn(saveCaddyTemplateItem);
  const remove = useServerFn(deleteCaddyTemplateItem);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("each");
  const [qty, setQty] = useState("1");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!name.trim()) { toast.error("Name is required"); return; }
    setBusy(true);
    try {
      await save({ data: { name, unit, default_qty: Number(qty) || 0 } });
      setName(""); setQty("1");
      toast.success("Added to the standard list");
      onChanged();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };

  const updateQty = async (t: CaddyTemplateItem, next: number) => {
    try {
      await save({ data: { id: t.id, name: t.name, unit: t.unit, default_qty: Math.max(0, next) } });
      onChanged();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  const del = async (t: CaddyTemplateItem) => {
    if (!confirm(`Remove "${t.name}" from the standard caddy list?`)) return;
    try {
      await remove({ data: { id: t.id } });
      toast.success("Removed");
      onChanged();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Standard caddy list</DialogTitle></DialogHeader>
        <ul className="max-h-72 overflow-auto divide-y divide-border/60 rounded-md ring-1 ring-black/5">
          {template.map((t) => (
            <li key={t.id} className="px-3 py-2 flex items-center gap-2">
              <span className="flex-1 truncate text-sm">{t.name}</span>
              <Button variant="outline" size="icon" className="size-7" onClick={() => updateQty(t, t.default_qty - 1)}>
                <Minus className="size-3.5" />
              </Button>
              <span className="w-16 text-center text-sm tabular-nums">{t.default_qty} {t.unit}</span>
              <Button variant="outline" size="icon" className="size-7" onClick={() => updateQty(t, t.default_qty + 1)}>
                <Plus className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="size-7 text-red-600" onClick={() => del(t)}>
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
          {template.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No standard items yet.</li>}
        </ul>
        <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-end pt-2">
          <div>
            <Label>Add item</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Magic erasers" />
          </div>
          <div className="w-20">
            <Label>Qty</Label>
            <Input type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div className="w-28">
            <Label>Unit</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            >
              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <BrandButton onClick={() => { if (!busy) void add(); }}>Add</BrandButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
