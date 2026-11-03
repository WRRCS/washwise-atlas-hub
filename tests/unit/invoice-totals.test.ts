import { describe, expect, it } from "vitest";
import { computeInvoiceTotals, calcCardSurcharge } from "../../src/lib/invoice-totals";

describe("invoice editor totals", () => {
  it("sums quantity × unit price across lines", () => {
    const t = computeInvoiceTotals([
      { quantity: 1, unit_price_cents: 15000 },
      { quantity: 2, unit_price_cents: 4500 },
    ], 0, 0, false);
    expect(t.subtotal_cents).toBe(24000);
    expect(t.total_cents).toBe(24000);
  });

  it("applies the discount before tax", () => {
    // $200 subtotal, $50 discount, 10% tax → tax on $150 = $15
    const t = computeInvoiceTotals([{ quantity: 1, unit_price_cents: 20000 }], 5000, 1000, false);
    expect(t.discount_cents).toBe(5000);
    expect(t.tax_cents).toBe(1500);
    expect(t.total_cents).toBe(16500);
  });

  it("never lets the discount exceed the subtotal", () => {
    const t = computeInvoiceTotals([{ quantity: 1, unit_price_cents: 5000 }], 99999, 1000, false);
    expect(t.discount_cents).toBe(5000);
    expect(t.tax_cents).toBe(0);
    expect(t.total_cents).toBe(0);
  });

  it("keeps the existing card surcharge rule on the full subtotal", () => {
    // 3% of $100 + $0.30 = $3.30
    expect(calcCardSurcharge(10000)).toBe(330);
    const t = computeInvoiceTotals([{ quantity: 1, unit_price_cents: 10000 }], 0, 0, true);
    expect(t.surcharge_cents).toBe(330);
    expect(t.total_cents).toBe(10330);
  });

  it("combines discount, tax, and surcharge", () => {
    // $300 subtotal − $30 discount = $270; 8.7% tax = $23.49; surcharge 3%+$0.30 on $300 = $9.30
    const t = computeInvoiceTotals([{ quantity: 3, unit_price_cents: 10000 }], 3000, 870, true);
    expect(t.subtotal_cents).toBe(30000);
    expect(t.tax_cents).toBe(2349);
    expect(t.surcharge_cents).toBe(930);
    expect(t.total_cents).toBe(27000 + 2349 + 930);
  });

  it("handles an empty price as zero", () => {
    const t = computeInvoiceTotals([{ quantity: 1, unit_price_cents: 0 }], 0, 500, true);
    expect(t.subtotal_cents).toBe(0);
    expect(t.surcharge_cents).toBe(0);
    expect(t.total_cents).toBe(0);
  });

  it("includes preserved job-linked lines in the totals", () => {
    // Auto-generated job line ($180) kept as-is + one edited line ($50):
    // subtotal $230, $30 discount, 10% tax on $200 = $20, no surcharge.
    const jobLine = { quantity: 1, unit_price_cents: 18000 };
    const t = computeInvoiceTotals([jobLine, { quantity: 1, unit_price_cents: 5000 }], 3000, 1000, false);
    expect(t.subtotal_cents).toBe(23000);
    expect(t.tax_cents).toBe(2000);
    expect(t.total_cents).toBe(22000);
  });

  it("supports an invoice whose only lines are job-linked", () => {
    const t = computeInvoiceTotals([{ quantity: 1, unit_price_cents: 12500 }], 0, 0, false);
    expect(t.subtotal_cents).toBe(12500);
    expect(t.total_cents).toBe(12500);
  });
});
