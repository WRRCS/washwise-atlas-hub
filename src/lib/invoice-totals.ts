/** Shared invoice math used by the editor (live preview) and the server. */

export type InvoiceLineInput = { quantity: number; unit_price_cents: number };

export type InvoiceTotals = {
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  surcharge_cents: number;
  total_cents: number;
};

const SURCHARGE_RATE = 0.03;
const SURCHARGE_FIXED = 30; // 30 cents

/** Card surcharge keeps the existing rule: 3% + $0.30 on the pre-discount subtotal. */
export function calcCardSurcharge(subtotalCents: number) {
  if (subtotalCents <= 0) return 0;
  return Math.round(subtotalCents * SURCHARGE_RATE) + SURCHARGE_FIXED;
}

/**
 * Totals: tax applies to the discounted subtotal; the card surcharge (when
 * enabled) follows the existing rule on the full subtotal.
 */
export function computeInvoiceTotals(
  lines: InvoiceLineInput[],
  discountCents: number,
  taxRateBp: number,
  cardSurcharge: boolean,
): InvoiceTotals {
  const subtotal = lines.reduce((sum, l) => sum + Math.round(l.quantity * l.unit_price_cents), 0);
  const discount = Math.min(Math.max(discountCents, 0), subtotal);
  const taxable = subtotal - discount;
  const tax = Math.round((taxable * taxRateBp) / 10000);
  const surcharge = cardSurcharge ? calcCardSurcharge(subtotal) : 0;
  return {
    subtotal_cents: subtotal,
    discount_cents: discount,
    tax_cents: tax,
    surcharge_cents: surcharge,
    total_cents: taxable + tax + surcharge,
  };
}
