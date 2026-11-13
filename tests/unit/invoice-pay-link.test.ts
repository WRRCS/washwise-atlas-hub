import { describe, expect, it } from "vitest";
import {
  FALLBACK_APP_ORIGIN,
  invoicePayUrl,
  normalizeAppOrigin,
} from "../../src/lib/invoice-pay-link";

const INVOICE_ID = "89ba6a53-7f6f-4a81-9d10-0c0ab140eb9b";

describe("invoice card-payment link", () => {
  it("points at the app's own public pay page for the invoice", () => {
    expect(invoicePayUrl("https://wrrcs.com", INVOICE_ID)).toBe(
      `https://wrrcs.com/pay/${INVOICE_ID}`,
    );
  });

  it("ignores a trailing slash on the address", () => {
    expect(invoicePayUrl("https://wrrcs.com/", INVOICE_ID)).toBe(
      `https://wrrcs.com/pay/${INVOICE_ID}`,
    );
  });

  it("falls back to the published address when no request address is available", () => {
    expect(invoicePayUrl("", INVOICE_ID)).toBe(`${FALLBACK_APP_ORIGIN}/pay/${INVOICE_ID}`);
    expect(invoicePayUrl(undefined, INVOICE_ID)).toBe(
      `${FALLBACK_APP_ORIGIN}/pay/${INVOICE_ID}`,
    );
  });

  it("refuses anything that is not a bare site address", () => {
    expect(normalizeAppOrigin("https://evil.example.com/steal")).toBe("");
    expect(normalizeAppOrigin("javascript:alert(1)")).toBe("");
    expect(normalizeAppOrigin("not a url")).toBe("");
    expect(normalizeAppOrigin(null)).toBe("");
  });
});
