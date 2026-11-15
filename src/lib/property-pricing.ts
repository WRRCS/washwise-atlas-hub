/** Property service frequency + pricing helpers (browser-safe). */
export const FREQUENCY_OPTIONS = ["Weekly", "Biweekly", "Monthly", "One-off"] as const;

/** Map older typed values ("Bi-weekly", "Oneoff") onto the dropdown choices; unknown values are kept as-is. */
export function normalizeFrequency(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  const k = v.toLowerCase().replace(/[^a-z]/g, "");
  if (k === "weekly") return "Weekly";
  if (k === "biweekly" || k === "everyotherweek" || k === "everytwoweeks") return "Biweekly";
  if (k === "monthly") return "Monthly";
  if (k === "oneoff" || k === "onetime" || k === "once") return "One-off";
  return v;
}

export type PricingType = "hourly" | "flat";

type Priced = { pricing_type?: string | null; price_cents?: number | null };

/** Saved choice wins; older properties with a set price are flat, otherwise hourly. */
export function pricingTypeOf(p: Priced | null | undefined): PricingType {
  if (p?.pricing_type === "hourly" || p?.pricing_type === "flat") return p.pricing_type;
  return p?.price_cents != null ? "flat" : "hourly";
}

/** Price to pre-fill on a new cleaning: flat properties carry their price; hourly stays blank ($0 = billed by the hour). */
export function newJobPriceCents(p: Priced | null | undefined): number | null {
  if (!p) return null;
  return pricingTypeOf(p) === "flat" && p.price_cents != null ? p.price_cents : null;
}

export function describePropertyPrice(p: Priced): string {
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  if (pricingTypeOf(p) === "flat") return p.price_cents != null ? `${money(p.price_cents)} flat rate` : "Flat rate";
  return p.price_cents != null && p.price_cents > 0 ? `Hourly · ${money(p.price_cents)}/hr` : "Hourly";
}
