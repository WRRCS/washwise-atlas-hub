/** Standard payment terms offered on invoices. `days: 0` = due upon receipt. */
export const PAYMENT_TERMS = [
  { days: 0, label: "Due upon receipt" },
  { days: 7, label: "Net 7" },
  { days: 14, label: "Net 14" },
  { days: 30, label: "Net 30" },
] as const;

export function termsLabel(days: number | null | undefined): string {
  if (days == null) return "—";
  const match = PAYMENT_TERMS.find((t) => t.days === days);
  return match ? match.label : `Net ${days}`;
}

/** Add `days` to an ISO date (YYYY-MM-DD) and return an ISO date. */
export function dueDateFrom(issueDate: string, days: number): string {
  const d = new Date(`${issueDate.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
