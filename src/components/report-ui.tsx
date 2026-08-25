import { type ReactNode, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { downloadCsv } from "@/lib/csv";

export function fmtMoney(cents: number | null | undefined) {
  const v = (cents ?? 0) / 100;
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value.length <= 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function useDateRange(monthsBack = 1) {
  const to = new Date();
  const from = new Date();
  from.setMonth(from.getMonth() - monthsBack);
  const [range, setRange] = useState({ from: isoDate(from), to: isoDate(to) });
  return { ...range, setRange };
}

export function RangeBar({
  from, to, onChange, children,
}: {
  from: string;
  to: string;
  onChange: (patch: { from?: string; to?: string }) => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      <div className="ml-auto flex items-center gap-2">
        <label className="text-xs text-muted-foreground">From</label>
        <Input type="date" value={from} onChange={(e) => onChange({ from: e.target.value })} className="h-8 w-40" />
        <label className="text-xs text-muted-foreground">To</label>
        <Input type="date" value={to} onChange={(e) => onChange({ to: e.target.value })} className="h-8 w-40" />
      </div>
    </div>
  );
}

export function Kpi({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone === "bad" ? "text-destructive" : tone === "good" ? "text-emerald-600" : ""}`}>
        {value}
      </div>
    </div>
  );
}

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  csv?: (row: T) => string | number | null;
  align?: "right";
};

export function ReportTable<T>({
  title, rows, columns, filename, empty, loading, footer,
}: {
  title: string;
  rows: T[];
  columns: Column<T>[];
  filename: string;
  empty?: string;
  loading?: boolean;
  footer?: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border/60 bg-card">
      <header className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs text-muted-foreground">{rows.length} rows</span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={!rows.length}
          onClick={() =>
            downloadCsv(
              filename,
              rows.map((r) => {
                const o: Record<string, unknown> = {};
                for (const c of columns) o[c.header] = c.csv ? c.csv(r) : "";
                return o;
              }),
            )
          }
        >
          <Download className="h-3.5 w-3.5 mr-1" /> Export CSV
        </Button>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              {columns.map((c) => (
                <th key={c.key} className={`px-4 py-2 font-medium ${c.align === "right" ? "text-right" : ""}`}>{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={columns.length} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={columns.length} className="px-4 py-8 text-center text-muted-foreground">{empty ?? "No data in this range."}</td></tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i} className="border-b border-border/40 last:border-0 hover:bg-muted/40">
                  {columns.map((c) => (
                    <td key={c.key} className={`px-4 py-2 align-top ${c.align === "right" ? "text-right tabular-nums" : ""}`}>{c.cell(r)}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {footer ? <div className="border-t border-border/60 px-4 py-2 text-sm">{footer}</div> : null}
    </section>
  );
}
