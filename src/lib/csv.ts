// Simple CSV export

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[-+]?\d[\d,]*(\.\d+)?$/;

/** Neutralize text a spreadsheet would run as a formula (=, +, -, @, tab, CR); plain numbers stay numbers. */
export function neutralizeCsvText(s: string): string {
  return FORMULA_START.test(s) && !PLAIN_NUMBER.test(s) ? `'${s}` : s;
}

/** One always-quoted, formula-safe CSV cell. */
export function csvCell(v: unknown): string {
  if (v == null) return '""';
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return `"${neutralizeCsvText(s).replace(/"/g, '""')}"`;
}

export function toCsv(rows: Record<string, unknown>[], headers?: string[]): string {
  if (!rows.length) return "";
  const cols = headers ?? Object.keys(rows[0]);
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = neutralizeCsvText(typeof v === "object" ? JSON.stringify(v) : String(v));
    return /[",\n\r]/.test(s) || s.startsWith("'") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.map(esc).join(","), ...rows.map((r) => cols.map((c) => esc((r as any)[c])).join(","))].join("\n");
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[], headers?: string[]) {
  const csv = toCsv(rows, headers);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
