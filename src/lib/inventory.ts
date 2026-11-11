/** Property inventory rules shared by the appointment Inventory tab and its server function. */
export const INVENTORY_LEVELS = ["high", "med", "low", "out"] as const;
export type InventoryLevel = (typeof INVENTORY_LEVELS)[number];
export type InventoryKind = "level" | "count";

export const INVENTORY_LEVEL_LABELS: Record<InventoryLevel, string> = {
  high: "High",
  med: "Med",
  low: "Low",
  out: "Out",
};

export const MAX_INVENTORY_QUANTITY = 9999;

/** Parse what a cleaner typed into a count box. Empty clears; anything else must be a whole number 0–9999. */
export function parseInventoryQuantity(raw: string): { ok: true; value: number | null } | { ok: false } {
  const s = raw.trim();
  if (s === "") return { ok: true, value: null };
  if (!/^\d+$/.test(s)) return { ok: false };
  const n = Number(s);
  if (n > MAX_INVENTORY_QUANTITY) return { ok: false };
  return { ok: true, value: n };
}

/** Level items take only High/Med/Low/Out; count items take only a typed number. */
export function validateInventoryEntry(
  kind: InventoryKind,
  entry: { level: string | null; quantity: number | null },
): boolean {
  if (kind === "level") {
    return entry.quantity === null && (entry.level === null || (INVENTORY_LEVELS as readonly string[]).includes(entry.level));
  }
  return (
    entry.level === null &&
    (entry.quantity === null || (Number.isInteger(entry.quantity) && entry.quantity >= 0 && entry.quantity <= MAX_INVENTORY_QUANTITY))
  );
}
