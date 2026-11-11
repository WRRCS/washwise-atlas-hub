import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { saveJobInventory, type JobInventoryRow } from "@/lib/property-inventory.functions";
import { INVENTORY_LEVELS, INVENTORY_LEVEL_LABELS, parseInventoryQuantity, type InventoryLevel } from "@/lib/inventory";
import { usePick, useT } from "@/lib/i18n";

export const jobInventoryKey = (jobId: string) => ["job-inventory", jobId] as const;

const LEVEL_TONE: Record<InventoryLevel, string> = {
  high: "text-success",
  med: "text-foreground",
  low: "text-warning",
  out: "text-destructive",
};

export function JobInventoryTab({ jobId, items, readOnly }: { jobId: string; items: JobInventoryRow[]; readOnly?: boolean }) {
  const t = useT();
  const filled = items.filter((i) => i.level !== null || i.quantity !== null).length;
  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-semibold">{t("Inventory")}</h3>
        <span className="text-xs text-muted-foreground">{filled} / {items.length} {t("recorded")}</span>
      </div>
      <ul className="divide-y divide-border rounded-lg ring-1 ring-border">
        {items.map((item) => <InventoryRow key={item.id} jobId={jobId} item={item} readOnly={readOnly} />)}
      </ul>
    </div>
  );
}

function InventoryRow({ jobId, item, readOnly }: { jobId: string; item: JobInventoryRow; readOnly?: boolean }) {
  const t = useT();
  const pick = usePick();
  const qc = useQueryClient();
  const saveFn = useServerFn(saveJobInventory);
  const [qty, setQty] = useState(item.quantity === null ? "" : String(item.quantity));
  const [saved, setSaved] = useState(false);
  useEffect(() => { setQty(item.quantity === null ? "" : String(item.quantity)); }, [item.quantity]);

  const save = useMutation({
    mutationFn: (v: { level: InventoryLevel | null; quantity: number | null }) =>
      saveFn({ data: { job_id: jobId, item_id: item.id, kind: item.kind, ...v } }),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      qc.invalidateQueries({ queryKey: jobInventoryKey(jobId) });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("Something went wrong")),
  });

  const commitQty = () => {
    const parsed = parseInventoryQuantity(qty);
    if (!parsed.ok) { toast.error(t("Type a whole number from 0 to 9999")); return; }
    if (parsed.value === item.quantity) return;
    save.mutate({ level: null, quantity: parsed.value });
  };

  const name = pick(item.name, item.name_uk);
  const unit = item.unit ? pick(item.unit, item.unit_uk) : null;
  const inputId = `inv-${item.id}`;

  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <label htmlFor={inputId} className="flex-1 min-w-0">
        <span className="block text-sm font-medium">{name}</span>
        {unit && <span className="block text-xs text-muted-foreground">{unit}</span>}
      </label>
      <span className="w-4 shrink-0" aria-live="polite">
        {saved && <Check className="size-4 text-success" aria-label={t("Saved")} />}
      </span>
      {item.kind === "count" ? (
        <Input
          id={inputId}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          placeholder="#"
          value={qty}
          disabled={readOnly || save.isPending}
          onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))}
          onBlur={commitQty}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          className="w-28 h-10 text-center text-base font-semibold"
        />
      ) : (
        <Select
          value={item.level ?? undefined}
          disabled={readOnly || save.isPending}
          onValueChange={(v) => save.mutate({ level: v as InventoryLevel, quantity: null })}
        >
          <SelectTrigger id={inputId} className={`w-28 h-10 font-semibold ${item.level ? LEVEL_TONE[item.level] : ""}`}>
            <SelectValue placeholder={t("Select")} />
          </SelectTrigger>
          <SelectContent>
            {INVENTORY_LEVELS.map((l) => (
              <SelectItem key={l} value={l} className={`font-semibold ${LEVEL_TONE[l]}`}>{t(INVENTORY_LEVEL_LABELS[l])}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </li>
  );
}
