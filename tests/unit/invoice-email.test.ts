import { describe, expect, it } from "vitest";
import {
  buildInvoiceEmailHtml,
  buildInvoiceEmailText,
  greetingName,
  invoiceTemplateVars,
  propertyName,
  renderIntro,
  serviceSummary,
  type InvoiceEmailInput,
} from "../../src/lib/invoice-email";

const base: InvoiceEmailInput = {
  invoiceNumber: "2026-1015",
  issueDate: "2026-11-14",
  dueDate: "2026-11-28",
  currency: "usd",
  subtotalCents: 20000, discountCents: 0, taxCents: 0, surchargeCents: 0, totalCents: 20000,
  lines: [{ description: "Commercial Clean — November 15, 2026", details: "Olsen's — 1919 Humboldt Street\nService date: 2026-11-15", quantity: 1, hours: null, unitPriceCents: 20000, lineTotalCents: 20000, serviceDate: "2026-11-15" }],
  client: { firstName: "Olsen", lastName: "Auto Body", companyName: null, paysByCheck: false },
  property: { label: "Olsen's", address: "1919 Humboldt Street, Bellingham", propertyType: "Commerical" },
  clientMessage: null, termsText: null,
  payLink: "https://wrrcs.com/pay/abc", allowCard: true, venmoLink: null,
  business: { name: "Wash Rinse Repeat Cleaning", legalName: "Wash, Rinse, Repeat Cleaning Services LLC", phone: "3602008892", email: "INFO@WASHRINSEREPEATCLEANING.COM", address: "1685 H St #346, Blaine, WA 98230", footer: "Thank you for your business!", color: "#0b6e4f" },
};

describe("invoice email", () => {
  it("greets businesses by full name and homes by first name", () => {
    expect(greetingName(base)).toBe("Olsen Auto Body");
    expect(greetingName({ ...base, client: { ...base.client, firstName: "Angela", lastName: "Smith" }, property: { label: "Angela", address: null, propertyType: "Residence" } })).toBe("Angela");
  });

  it("calls a residence 'your home' and a business by its property name", () => {
    expect(propertyName(base)).toBe("Olsen's");
    expect(propertyName({ property: { label: "Angela", address: null, propertyType: "Residence" } })).toBe("your home");
  });

  it("summarizes one or several cleaning dates", () => {
    expect(serviceSummary(base.lines)).toBe("your cleaning on November 15, 2026");
    const two = [base.lines[0], { ...base.lines[0], serviceDate: "2026-10-02" }];
    expect(serviceSummary(two)).toBe("your 2 cleanings from October 2 to November 15, 2026");
  });

  it("includes every invoice line, the total, the pay link and how to reach customer service", () => {
    const intro = renderIntro(null, invoiceTemplateVars(base));
    const html = buildInvoiceEmailHtml(base, intro);
    expect(html).toContain("Commercial Clean — November 15, 2026");
    expect(html).toContain("$200.00");
    expect(html).toContain("https://wrrcs.com/pay/abc");
    expect(html).toContain("(360) 200-8892");
    expect(html).toContain("Hi Olsen Auto Body,");
    expect(html).not.toContain("Service date: 2026-11-15");
    expect(buildInvoiceEmailText(base, intro)).toContain("Total due: $200.00");
  });

  it("escapes client-entered text", () => {
    const html = buildInvoiceEmailHtml({ ...base, clientMessage: "<script>x</script>" }, "");
    expect(html).not.toContain("<script>");
  });

  it("shows check instructions for clients who pay by check", () => {
    const html = buildInvoiceEmailHtml({ ...base, client: { ...base.client, paysByCheck: true } }, "");
    expect(html).toContain("mail it to 1685 H St #346, Blaine, WA 98230");
  });
});
