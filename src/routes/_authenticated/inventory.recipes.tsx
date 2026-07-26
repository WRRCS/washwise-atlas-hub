import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { listRecipes, listInventory, upsertRecipe, type RecipeRow, type InventoryItem } from "@/lib/inventory.functions";

const recipesQO = queryOptions({ queryKey: ["recipes"], queryFn: () => listRecipes() });
const itemsQO = queryOptions({ queryKey: ["inventory"], queryFn: () => listInventory() });

export const Route = createFileRoute("/_authenticated/inventory/recipes")({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(recipesQO),
      context.queryClient.ensureQueryData(itemsQO),
    ]);
  },
  component: RecipesPage,
  errorComponent: ({ error }) => (
    <AppShell><div className="p-8 text-red-600">Error: {error.message}</div></AppShell>
  ),
  notFoundComponent: () => <AppShell><div className="p-8">Not found</div></AppShell>,
});

function RecipesPage() {
  const { data: recipes } = useSuspenseQuery(recipesQO);
  const { data: items } = useSuspenseQuery(itemsQO);
  const upsert = useServerFn(upsertRecipe);

  const grouped = useMemo(() => {
    const m = new Map<string, { service_type_id: string; service_type_name: string; rows: RecipeRow[] }>();
    for (const r of recipes) {
      const g = m.get(r.service_type_id) ?? {
        service_type_id: r.service_type_id,
        service_type_name: r.service_type_name,
        rows: [],
      };
      g.rows.push(r);
      m.set(r.service_type_id, g);
    }
    return Array.from(m.values()).sort((a, b) => a.service_type_name.localeCompare(b.service_type_name));
  }, [recipes]);

  return (
    <AppShell>
      <PageHeader title="Inventory" subtitle="Recipes define how much stock each job consumes" />
      <div className="max-w-6xl mx-auto w-full px-6 md:px-8 py-8 space-y-4">
        {grouped.length === 0 && (
          <div className="text-sm text-muted-foreground py-12 text-center">
            No recipes yet. Complete the seed migration or add items.
          </div>
        )}
        {grouped.map((g) => (
          <ServiceRecipeCard
            key={g.service_type_id}
            title={g.service_type_name}
            serviceTypeId={g.service_type_id}
            rows={g.rows}
            allItems={items as InventoryItem[]}
            onSave={async (item_id, qty) => {
              try {
                await upsert({ data: { service_type_id: g.service_type_id, inventory_item_id: item_id, quantity_per_job: qty } });
                toast.success("Saved");
              } catch (e: any) {
                toast.error(e.message ?? "Failed");
              }
            }}
          />
        ))}
      </div>
    </AppShell>
  );
}

function ServiceRecipeCard({
  title, serviceTypeId, rows, allItems, onSave,
}: {
  title: string; serviceTypeId: string; rows: RecipeRow[]; allItems: InventoryItem[];
  onSave: (item_id: string, qty: number) => Promise<void>;
}) {
  const [addItemId, setAddItemId] = useState("");
  const [addQty, setAddQty] = useState("1");
  const existingIds = new Set(rows.map((r) => r.inventory_item_id));
  const addable = allItems.filter((i) => !existingIds.has(i.id));

  return (
    <div className="bg-white rounded-xl ring-1 ring-black/5 overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 font-medium">{title}</div>
      <table className="w-full text-sm">
        <thead className="bg-clay-100/60 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left px-4 py-2">Item</th>
            <th className="text-left px-3 py-2">Unit</th>
            <th className="text-right px-3 py-2">Qty per job</th>
            <th className="text-right px-3 py-2">Cost/job</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No items in recipe.</td></tr>
          )}
          {rows.map((r) => (
            <RecipeRowEditor key={r.id} row={r} onSave={(qty) => onSave(r.inventory_item_id, qty)} />
          ))}
          {addable.length > 0 && (
            <tr key={`add-${serviceTypeId}`} className="border-t border-border/60 bg-clay-50/40">
              <td className="px-4 py-2" colSpan={2}>
                <select
                  value={addItemId}
                  onChange={(e) => setAddItemId(e.target.value)}
                  className="h-8 rounded border border-input bg-background px-2 text-sm w-full"
                >
                  <option value="">Add item…</option>
                  {addable.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
                </select>
              </td>
              <td className="px-3 py-2 text-right">
                <Input value={addQty} onChange={(e) => setAddQty(e.target.value)} className="h-8 w-24 ml-auto text-right" type="number" min="0" step="any" />
              </td>
              <td className="px-3 py-2"></td>
              <td className="px-3 py-2 text-right">
                <Button
                  size="sm"
                  disabled={!addItemId || !Number(addQty)}
                  onClick={async () => {
                    await onSave(addItemId, Number(addQty));
                    setAddItemId(""); setAddQty("1");
                  }}
                >Add</Button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function RecipeRowEditor({ row, onSave }: { row: RecipeRow; onSave: (qty: number) => Promise<void> }) {
  const [qty, setQty] = useState(String(row.quantity_per_job));
  const [saving, setSaving] = useState(false);
  const dirty = Number(qty) !== row.quantity_per_job;
  const costPerJob = Number(qty) * row.item_cost_cents;
  return (
    <tr className="border-t border-border/60">
      <td className="px-4 py-2">{row.item_name}</td>
      <td className="px-3 py-2 text-muted-foreground">{row.item_unit}</td>
      <td className="px-3 py-2 text-right">
        <Input
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="h-8 w-24 ml-auto text-right tabular-nums"
          type="number" min="0" step="any"
        />
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
        {costPerJob ? `$${(costPerJob / 100).toFixed(2)}` : "—"}
      </td>
      <td className="px-3 py-2 text-right">
        {dirty && (
          <Button
            size="sm"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try { await onSave(Number(qty)); } finally { setSaving(false); }
            }}
          >{Number(qty) === 0 ? "Remove" : "Save"}</Button>
        )}
      </td>
    </tr>
  );
}
