/**
 * Builds the invoice email a client receives: a personal note (editable on
 * the Templates page), the full invoice with every line, the totals, the
 * ways to pay, and how to reach customer service. Pure — no server access.
 */

export type InvoiceEmailLine = {
  description: string;
  details: string | null;
  quantity: number | null;
  hours: number | null;
  unitPriceCents: number;
  lineTotalCents: number;
  serviceDate: string | null; // YYYY-MM-DD
};

export type InvoiceEmailInput = {
  invoiceNumber: string;
  issueDate: string | null; // YYYY-MM-DD
  dueDate: string | null; // YYYY-MM-DD
  currency: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  surchargeCents: number;
  totalCents: number;
  lines: InvoiceEmailLine[];
  client: { firstName: string | null; lastName: string | null; companyName: string | null; paysByCheck: boolean };
  property: { label: string | null; address: string | null; propertyType: string | null } | null;
  clientMessage: string | null;
  termsText: string | null;
  payLink: string;
  allowCard: boolean;
  venmoLink: string | null;
  business: {
    name: string;
    legalName: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    footer: string | null;
    color: string | null;
  };
};

/** The note at the top of the email. Saved on the Templates page as "Invoice sent". */
export const DEFAULT_INVOICE_INTRO_HTML =
  "<p>Hi {{greeting_name}},</p>" +
  "<p>Thank you for choosing Wash Rinse Repeat Cleaning to care for {{property_name}}. " +
  "Your invoice for {{service_summary}} is below. The total of <strong>{{amount}}</strong> is due by <strong>{{due_date}}</strong>.</p>" +
  "<p>Your satisfaction matters to us. If anything about your cleaning or this invoice doesn't look right, " +
  "just reply to this email or call or text us at {{business_phone}}. We're always happy to help.</p>" +
  "<p>We truly appreciate your business.<br>Warm regards,<br>The Wash Rinse Repeat Cleaning team</p>";

const BUSINESS_TYPES = /commerc|commerical|laundry|apartment|office|storage/i;
const HOME_TYPES = /^(residence|residential|home|house)?$/i;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function money(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: (currency || "usd").toUpperCase() }).format(
    (cents ?? 0) / 100,
  );
}

export function formatPhone(raw: string | null | undefined): string {
  const d = (raw ?? "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  return (raw ?? "").trim();
}

export function formatDate(ymd: string | null | undefined): string {
  if (!ymd) return "";
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

/** Homes greet by first name; businesses and buildings by their full name. */
export function greetingName(input: Pick<InvoiceEmailInput, "client" | "property">): string {
  const { firstName, lastName, companyName } = input.client;
  if (companyName?.trim()) return companyName.trim();
  const full = [firstName, lastName].map((s) => s?.trim()).filter(Boolean).join(" ");
  const type = input.property?.propertyType ?? "";
  if (BUSINESS_TYPES.test(type)) return full || "there";
  return firstName?.trim() || full || "there";
}

/** "your home" for residences (their labels are client names), the property's name otherwise. */
export function propertyName(input: Pick<InvoiceEmailInput, "property">): string {
  const p = input.property;
  if (!p) return "your home";
  const type = (p.propertyType ?? "").trim();
  if (HOME_TYPES.test(type)) return "your home";
  return p.label?.trim() || "your property";
}

/** "your cleaning on November 15, 2026" or "your 4 cleanings from October 2 to October 30, 2026". */
export function serviceSummary(lines: InvoiceEmailLine[]): string {
  const dates = [...new Set(lines.map((l) => l.serviceDate?.slice(0, 10)).filter((d): d is string => !!d))].sort();
  const count = Math.max(lines.length, dates.length);
  if (dates.length === 0) return count > 1 ? `your ${count} recent cleanings` : "your recent cleaning";
  if (dates.length === 1) {
    return count > 1 ? `your ${count} cleanings on ${formatDate(dates[0])}` : `your cleaning on ${formatDate(dates[0])}`;
  }
  const first = formatDate(dates[0]);
  const last = formatDate(dates[dates.length - 1]);
  const sameYear = dates[0].slice(0, 4) === dates[dates.length - 1].slice(0, 4);
  const firstShort = sameYear ? first.replace(/, \d{4}$/, "") : first;
  return `your ${count} cleanings from ${firstShort} to ${last}`;
}

/** Values for {{…}} in the saved note. Already HTML-escaped. */
export function invoiceTemplateVars(input: InvoiceEmailInput): Record<string, string> {
  const name = [input.client.firstName, input.client.lastName].filter(Boolean).join(" ") || "there";
  const v: Record<string, string> = {
    company_name: input.business.name,
    client_name: name,
    greeting_name: greetingName(input),
    first_name: input.client.firstName?.trim() || greetingName(input),
    property_name: propertyName(input),
    service_summary: serviceSummary(input.lines),
    invoice_number: input.invoiceNumber,
    amount: money(input.totalCents, input.currency),
    due_date: formatDate(input.dueDate) || "the date shown below",
    date: formatDate(input.issueDate),
    business_phone: formatPhone(input.business.phone) || "the number below",
    business_email: (input.business.email ?? "").toLowerCase(),
    pay_link: input.payLink,
    venmo_link: input.venmoLink ?? "",
  };
  return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, escapeHtml(val)]));
}

export function renderIntro(templateHtml: string | null | undefined, vars: Record<string, string>): string {
  const html = templateHtml?.trim() ? templateHtml : DEFAULT_INVOICE_INTRO_HTML;
  return html.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => vars[key] ?? "");
}

function lineQty(l: InvoiceEmailLine, currency: string): string {
  if (l.hours != null && l.hours > 0) return `${Number(l.hours.toFixed(2))} hrs × ${money(l.unitPriceCents, currency)}/hr`;
  const q = l.quantity ?? 1;
  return q === 1 ? money(l.unitPriceCents, currency) : `${q} × ${money(l.unitPriceCents, currency)}`;
}

function lineDetail(l: InvoiceEmailLine): string {
  return (l.details ?? "").split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !/^Service date:/i.test(s)).join(" · ");
}

function showCheck(input: InvoiceEmailInput): boolean {
  return input.client.paysByCheck || (!input.allowCard && !input.venmoLink);
}

export function buildInvoiceEmailHtml(input: InvoiceEmailInput, introHtml: string): string {
  const c = input.currency;
  const brand = /^#[0-9a-f]{6}$/i.test(input.business.color ?? "") ? (input.business.color as string) : "#0b6e4f";
  const e = escapeHtml;
  const font = "font-family:Arial,Helvetica,sans-serif;";
  const muted = "color:#6b7280;";
  const phone = formatPhone(input.business.phone);
  const email = (input.business.email ?? "").toLowerCase();

  const rows = input.lines.map((l) => {
    const detail = lineDetail(l);
    return `<tr>
<td style="${font}padding:12px 0;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;vertical-align:top">${e(l.description)}${detail ? `<div style="${muted}font-size:12px;margin-top:2px">${e(detail)}</div>` : ""}</td>
<td style="${font}padding:12px 8px;border-bottom:1px solid #e5e7eb;font-size:13px;${muted}text-align:right;vertical-align:top;white-space:nowrap">${e(lineQty(l, c))}</td>
<td style="${font}padding:12px 0;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;text-align:right;vertical-align:top;white-space:nowrap">${e(money(l.lineTotalCents, c))}</td>
</tr>`;
  }).join("");

  const totalRow = (label: string, cents: number, bold = false) =>
    `<tr><td colspan="2" style="${font}padding:6px 8px 6px 0;font-size:${bold ? 16 : 14}px;text-align:right;${bold ? "color:#111827;font-weight:bold" : muted}">${e(label)}</td><td style="${font}padding:6px 0;font-size:${bold ? 16 : 14}px;text-align:right;white-space:nowrap;color:#111827;${bold ? "font-weight:bold" : ""}">${e(money(cents, c))}</td></tr>`;

  const totals = [
    totalRow("Subtotal", input.subtotalCents),
    input.discountCents > 0 ? totalRow("Discount", -input.discountCents) : "",
    input.taxCents > 0 ? totalRow("Tax", input.taxCents) : "",
    input.surchargeCents > 0 ? totalRow("Card processing fee (card payments only)", input.surchargeCents) : "",
    totalRow("Total due", input.totalCents, true),
  ].join("");

  const button = (href: string, label: string, primary: boolean) =>
    `<a href="${e(href)}" style="${font}display:inline-block;margin:0 8px 8px 0;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:bold;text-decoration:none;${primary ? `background:${brand};color:#ffffff` : `background:#ffffff;color:${brand};border:1px solid ${brand}`}">${e(label)}</a>`;

  const payButtons = [
    input.allowCard ? button(input.payLink, `Pay ${money(input.totalCents, c)} by card`, true) : "",
    input.venmoLink ? button(input.venmoLink, "Pay with Venmo", !input.allowCard) : "",
    !input.allowCard ? button(input.payLink, "View invoice online", false) : "",
  ].join("");

  const check = showCheck(input)
    ? `<p style="${font}font-size:14px;color:#374151;margin:8px 0 0">Paying by check? Please make it payable to ${e(input.business.name)}${input.business.address ? ` and mail it to ${e(input.business.address)}` : ""}. Write invoice ${e(input.invoiceNumber)} on the memo line.</p>`
    : "";

  const propertyBlock = input.property?.address || input.property?.label
    ? `<div style="${font}font-size:13px;${muted}margin-top:4px">Service at: ${e([input.property?.label, input.property?.address].filter(Boolean).join(" — "))}</div>`
    : "";

  const message = input.clientMessage?.trim()
    ? `<div style="${font}margin:0 0 20px;padding:14px 16px;background:#f9fafb;border-left:3px solid ${brand};font-size:14px;color:#374151;white-space:pre-wrap">${e(input.clientMessage.trim())}</div>`
    : "";

  const terms = input.termsText?.trim()
    ? `<p style="${font}font-size:12px;${muted}margin:16px 0 0;white-space:pre-wrap">${e(input.termsText.trim())}</p>`
    : "";

  const contactBits = [
    phone ? `call or text <a href="tel:${e(phone.replace(/\D/g, ""))}" style="color:${brand}">${e(phone)}</a>` : "",
    email ? `email <a href="mailto:${e(email)}" style="color:${brand}">${e(email)}</a>` : "",
  ].filter(Boolean).join(" or ");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ffffff">
<div style="display:none;max-height:0;overflow:hidden">${e(`Invoice ${input.invoiceNumber} — ${money(input.totalCents, c)}${input.dueDate ? `, due ${formatDate(input.dueDate)}` : ""}`)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td style="${font}padding:0 0 16px;border-bottom:3px solid ${brand}">
<div style="font-size:20px;font-weight:bold;color:${brand}">${e(input.business.name)}</div>
<div style="font-size:13px;${muted}">Invoice ${e(input.invoiceNumber)}</div>
</td></tr>
<tr><td style="${font}padding:20px 0 4px;font-size:15px;line-height:1.55;color:#111827">${introHtml}</td></tr>
<tr><td>${message}</td></tr>
<tr><td style="padding:0 0 8px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:10px"><tr>
<td style="${font}padding:16px;vertical-align:top;font-size:13px;color:#374151">
<div style="${muted}font-size:11px;letter-spacing:.06em;text-transform:uppercase">Bill to</div>
<div style="font-size:15px;font-weight:bold;color:#111827;margin-top:2px">${e([input.client.companyName?.trim() || [input.client.firstName, input.client.lastName].filter(Boolean).join(" ")].filter(Boolean).join(""))}</div>
${propertyBlock}
</td>
<td style="${font}padding:16px;vertical-align:top;font-size:13px;color:#374151;text-align:right;white-space:nowrap">
<div><span style="${muted}">Invoice</span> <strong>${e(input.invoiceNumber)}</strong></div>
${input.issueDate ? `<div><span style="${muted}">Issued</span> ${e(formatDate(input.issueDate))}</div>` : ""}
${input.dueDate ? `<div><span style="${muted}">Due</span> <strong>${e(formatDate(input.dueDate))}</strong></div>` : ""}
<div style="font-size:20px;font-weight:bold;color:#111827;margin-top:6px">${e(money(input.totalCents, c))}</div>
</td></tr></table>
</td></tr>
<tr><td>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>
<th align="left" style="${font}padding:12px 0 6px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;${muted}border-bottom:1px solid #e5e7eb">Service</th>
<th align="right" style="${font}padding:12px 8px 6px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;${muted}border-bottom:1px solid #e5e7eb">Rate</th>
<th align="right" style="${font}padding:12px 0 6px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;${muted}border-bottom:1px solid #e5e7eb">Amount</th>
</tr>
${rows}
${totals}
</table>
</td></tr>
<tr><td style="padding:20px 0 4px">${payButtons}${check}</td></tr>
<tr><td>${terms}</td></tr>
<tr><td style="${font}padding:20px 0 0;font-size:14px;color:#374151;line-height:1.5">
<div style="padding:14px 16px;border:1px solid #e5e7eb;border-radius:10px"><strong>Questions about this invoice?</strong><br>Reply to this email${contactBits ? `, or ${contactBits}` : ""}. We'll get back to you quickly.</div>
</td></tr>
<tr><td style="${font}padding:20px 0 0;font-size:12px;${muted}text-align:center;line-height:1.5">
${input.business.footer ? `${e(input.business.footer)}<br>` : ""}
${e(input.business.legalName || input.business.name)}${input.business.address ? `<br>${e(input.business.address)}` : ""}${phone ? `<br>${e(phone)}` : ""}${email ? ` · ${e(email)}` : ""}
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildInvoiceEmailText(input: InvoiceEmailInput, introHtml: string): string {
  const c = input.currency;
  const phone = formatPhone(input.business.phone);
  const email = (input.business.email ?? "").toLowerCase();
  const out: string[] = [htmlToText(introHtml), ""];
  if (input.clientMessage?.trim()) out.push(input.clientMessage.trim(), "");
  out.push(`INVOICE ${input.invoiceNumber}`);
  if (input.issueDate) out.push(`Issued: ${formatDate(input.issueDate)}`);
  if (input.dueDate) out.push(`Due: ${formatDate(input.dueDate)}`);
  out.push("");
  for (const l of input.lines) {
    out.push(`${l.description} — ${lineQty(l, c)} — ${money(l.lineTotalCents, c)}`);
    const d = lineDetail(l);
    if (d) out.push(`  ${d}`);
  }
  out.push("", `Subtotal: ${money(input.subtotalCents, c)}`);
  if (input.discountCents > 0) out.push(`Discount: ${money(-input.discountCents, c)}`);
  if (input.taxCents > 0) out.push(`Tax: ${money(input.taxCents, c)}`);
  if (input.surchargeCents > 0) out.push(`Card processing fee (card payments only): ${money(input.surchargeCents, c)}`);
  out.push(`Total due: ${money(input.totalCents, c)}`, "");
  if (input.allowCard) out.push(`Pay by card: ${input.payLink}`);
  if (input.venmoLink) out.push(`Pay with Venmo: ${input.venmoLink}`);
  if (!input.allowCard) out.push(`View invoice online: ${input.payLink}`);
  if (showCheck(input)) {
    out.push(`Paying by check? Please make it payable to ${input.business.name}${input.business.address ? ` and mail it to ${input.business.address}` : ""}. Write invoice ${input.invoiceNumber} on the memo line.`);
  }
  if (input.termsText?.trim()) out.push("", input.termsText.trim());
  out.push("", `Questions about this invoice? Reply to this email${phone ? `, or call or text ${phone}` : ""}${email ? ` or email ${email}` : ""}.`);
  out.push("", [input.business.legalName || input.business.name, input.business.address].filter(Boolean).join(", "));
  return out.join("\n");
}
