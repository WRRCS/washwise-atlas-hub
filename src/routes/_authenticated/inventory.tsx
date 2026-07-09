import { createFileRoute, useRouter } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell, PageHeader, BrandButton } from "@/components/app-shell";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { History, Plus, Pencil, Trash2, X, PackagePlus, Search } from "lucide-react";
import { format } from "date-fns";
import {
  listInventory, createInventoryItem, updateInventoryItem, deleteInventoryItem,
  logInventoryTransaction, listItemTransactions,
  type InventoryItem, type InventoryStatus, type InventoryTransaction,
} from "@/lib/inventory.functions";
import { InventoryTabs } from "@/components/inventory-tabs";

const invQO = queryOptions({ queryKey: ["inventory"], queryFn: () => listInventory() });

export const Route = createFileRoute("/_authenticated/inventory")({
  loader: ({ context }) => context.queryClient.ensureQueryData(invQO),
  component: InventoryPage,
});

const UNITS = ["bottle", "gallon", "box", "pack", "roll", "each"];

function statusStyle(s: InventoryStatus) {
  if (s === "OUT") return "bg-red-100 text-red-800";
  if (s === "LOW") return "bg-amber-100 text-amber-800";
  return "bg-green-100 text-green-800";
}
function fmtMoney(cents: number) {
  return cents ? `$${(cents / 100).toFixed(2)}` : "—";
}

function InventoryPage() {
  const { data: items } = useSuspenseQuery(invQO);
  const router = useRouter();
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | InventoryStatus>("all");
  const [restockFor, setRestockFor] = useState<InventoryItem | null>(null);
  const [historyFor, setHistoryFor] = useState<InventoryItem | null>(null);
  const [formFor, setFormFor] = useState<InventoryItem | "new" | null>(null);
  const del = useServerFn(deleteInventoryItem);

  const vendors = useMemo(
    () => Array.from(new Set((items as InventoryItem[]).map((i) => i.vendor_name).filter(Boolean))),
    [items],
  );
  const [vendorFilter, setVendorFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (items as InventoryItem[]).filter((i) => {
      if (statusFilter !== "all" && i.status !== statusFilter) return false;
      if (vendorFilter !== "all" && i.vendor_name !== vendorFilter) return false;
      if (needle && !`${i.name} ${i.vendor_name ?? ""} ${i.sku ?? ""}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [items, q, statusFilter, vendorFilter]);

  const onDelete = async (item: InventoryItem) => {
    if (!confirm(`Archive "${item.name}"? You can re-add it later.`)) return;
    try {
      await del({ data: { id: item.id } });
      toast.success("Archived");
      router.invalidate();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  return (
    <AppShell>
      <PageHeader
        title="Inventory"
        subtitle="Track cleaning supplies and reorder before you run out"
        action={<BrandButton onClick={() => setFormFor("new")}><Plus className="size-4 mr-1.5" />New item</BrandButton>}
      />
      <div className="max-w-6xl mx-auto w-full px-6 md:px-8 py-8 space-y-4">
        <InventoryTabs current="items" />

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          <div className="relative flex-1">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search name, vendor, SKU…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">All statuses</option>
            <option value="OUT">Out of stock</option>
            <option value="LOW">Low</option>
            <option value="OK">OK</option>
          </select>
          {vendors.length > 0 && (
            <select
              value={vendorFilter}
              onChange={(e) => setVendorFilter(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="all">All vendors</option>
              {vendors.map((v) => <option key={v!} value={v!}>{v}</option>)}
            </select>
          )}
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl ring-1 ring-black/5 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-clay-100/60 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2.5">Item</th>
                  <th className="text-left px-3 py-2.5">Unit</th>
                  <th className="text-right px-3 py-2.5">On hand</th>
                  <th className="text-right px-3 py-2.5">Reorder at</th>
                  <th className="text-left px-3 py-2.5">Vendor</th>
                  <th className="text-right px-3 py-2.5">Cost</th>
                  <th className="text-left px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-12 text-muted-foreground">No items match your filters.</td></tr>
                ) : filtered.map((i) => (
                  <tr key={i.id} className="border-t border-border/60 hover:bg-clay-100/40">
                    <td className="px-4 py-3">
                      <div className="font-medium">{i.name}</div>
                      {i.sku && <div className="text-xs text-muted-foreground">SKU: {i.sku}</div>}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{i.unit}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-medium">{i.quantity_on_hand}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{i.reorder_threshold}</td>
                    <td className="px-3 py-3 text-muted-foreground">{i.vendor_name ?? "—"}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{fmtMoney(i.cost_per_unit_cents)}</td>
                    <td className="px-3 py-3">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider font-medium ${statusStyle(i.status)}`}>
                        {i.status}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => setRestockFor(i)} title="Quick restock">
                          <PackagePlus className="size-3.5" />
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setHistoryFor(i)} title="History">
                          <History className="size-3.5" />
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setFormFor(i)} title="Edit">
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => onDelete(i)} title="Archive">
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {restockFor && (
        <RestockDialog item={restockFor} onClose={() => setRestockFor(null)} onDone={() => { setRestockFor(null); router.invalidate(); }} />
      )}
      {historyFor && (
        <HistoryPanel item={historyFor} onClose={() => setHistoryFor(null)} />
      )}
      {formFor && (
        <ItemFormDialog
          item={formFor === "new" ? null : formFor}
          onClose={() => setFormFor(null)}
          onDone={() => { setFormFor(null); router.invalidate(); }}
        />
      )}
    </AppShell>
  );
}

// ============= Quick Restock =============

function RestockDialog({ item, onClose, onDone }: { item: InventoryItem; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState<string>("1");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const log = useServerFn(logInventoryTransaction);
  const onSave = async () => {
    const n = Number(qty);
    if (!n || n <= 0) { toast.error("Enter a positive quantity"); return; }
    setSaving(true);
    try {
      await log({ data: { item_id: item.id, change_amount: n, reason: "restock", notes: notes || null } });
      toast.success(`+${n} ${item.unit} added`);
      onDone();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Restock · {item.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Add quantity ({item.unit})</Label>
            <Input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
            <p className="text-xs text-muted-foreground mt-1">Current: {item.quantity_on_hand}</p>
          </div>
          <div>
            <Label>Notes (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. PO #, receipt no." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Add to stock"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============= History Panel =============

function HistoryPanel({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const fn = useServerFn(listItemTransactions);
  const q = useQuery({ queryKey: ["inv-tx", item.id], queryFn: () => fn({ data: { item_id: item.id } }) });
  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-black/40" />
      <aside className="w-full max-w-md bg-white h-full overflow-y-auto ring-1 ring-black/10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 border-b border-border/60">
          <div>
            <h2 className="font-medium">{item.name}</h2>
            <p className="text-xs text-muted-foreground">Transaction history</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
            <X className="size-4" />
          </button>
        </div>
        <div className="p-5">
          {q.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
            : (q.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No transactions yet.</p>
            : (
              <ul className="space-y-3">
                {(q.data as InventoryTransaction[]).map((t) => (
                  <li key={t.id} className="bg-clay-100/60 rounded-lg p-3 ring-1 ring-black/5">
                    <div className="flex items-center justify-between gap-3">
                      <span className={`font-medium tabular-nums ${t.change_amount > 0 ? "text-green-700" : "text-red-700"}`}>
                        {t.change_amount > 0 ? "+" : ""}{t.change_amount} {item.unit}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-clay-50 text-muted-foreground uppercase tracking-wider">
                        {t.reason.replace("_", " ")}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {format(new Date(t.created_at), "PPp")} · {t.actor_name ?? "Unknown"}
                    </p>
                    {t.notes && <p className="text-sm mt-1">{t.notes}</p>}
                  </li>
                ))}
              </ul>
            )}
        </div>
      </aside>
    </div>
  );
}

// ============= Item Form =============

function ItemFormDialog({ item, onClose, onDone }: { item: InventoryItem | null; onClose: () => void; onDone: () => void }) {
  const create = useServerFn(createInventoryItem);
  const update = useServerFn(updateInventoryItem);
  const [name, setName] = useState(item?.name ?? "");
  const [sku, setSku] = useState(item?.sku ?? "");
  const [unit, setUnit] = useState(item?.unit ?? "each");
  const [qty, setQty] = useState<string>(item ? String(item.quantity_on_hand) : "0");
  const [threshold, setThreshold] = useState<string>(item ? String(item.reorder_threshold) : "0");
  const [cost, setCost] = useState<string>(item ? (item.cost_per_unit_cents / 100).toFixed(2) : "0.00");
  const [vendorName, setVendorName] = useState(item?.vendor_name ?? "");
  const [vendorSku, setVendorSku] = useState(item?.vendor_sku ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    if (!name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    const payload = {
      name: name.trim(),
      sku: sku.trim() || null,
      unit,
      reorder_threshold: Number(threshold) || 0,
      cost_per_unit_cents: Math.round(Number(cost || 0) * 100),
      vendor_name: vendorName.trim() || null,
      vendor_sku: vendorSku.trim() || null,
      notes: notes.trim() || null,
    };
    try {
      if (item) {
        await update({ data: { id: item.id, ...payload } });
        toast.success("Updated");
      } else {
        await create({ data: { ...payload, quantity_on_hand: Number(qty) || 0 } });
        toast.success("Item added");
      }
      onDone();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{item ? "Edit item" : "New inventory item"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Unit</Label>
              <select value={unit} onChange={(e) => setUnit(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div><Label>SKU (optional)</Label><Input value={sku} onChange={(e) => setSku(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {!item && (
              <div><Label>Starting quantity</Label><Input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
            )}
            <div className={item ? "col-span-2 sm:col-span-1" : ""}>
              <Label>Reorder threshold</Label>
              <Input type="number" min="0" step="any" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
            </div>
            <div>
              <Label>Cost per unit ($)</Label>
              <Input type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Vendor name</Label><Input value={vendorName} onChange={(e) => setVendorName(e.target.value)} /></div>
            <div><Label>Vendor SKU</Label><Input value={vendorSku} onChange={(e) => setVendorSku(e.target.value)} /></div>
          </div>
          <div><Label>Notes</Label><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave} disabled={saving}>{saving ? "Saving…" : item ? "Save changes" : "Add item"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
