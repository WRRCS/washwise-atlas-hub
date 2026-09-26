import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { addDays, format, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { listTimesheet, type TimesheetDay } from "@/lib/visits.functions";
import { useBusinessTz } from "@/hooks/use-business-tz";

export const Route = createFileRoute("/_authenticated/timesheet")({
  head: () => ({
    meta: [
      { title: "Timesheet — Wash Rinse Repeat" },
      { name: "description", content: "Clock-in, clock-out and time at each appointment for your team." },
      { property: "og:title", content: "Timesheet — Wash Rinse Repeat" },
      { property: "og:description", content: "Clock-in, clock-out and time at each appointment for your team." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TimesheetPage,
});

const mins = (a: string, b: string | null) => (b ? Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 60000) : 0);

function TimesheetPage() {
  const tz = useBusinessTz();
  const [anchor, setAnchor] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [decimal, setDecimal] = useState(false);
  const from = anchor.toISOString();
  const to = addDays(anchor, 7).toISOString();
  const fn = useServerFn(listTimesheet);
  const q = useQuery({ queryKey: ["timesheet", from, to, tz], queryFn: () => fn({ data: { from, to, tz } }) });

  const time = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz }) : "—";
  const dur = (m: number) => (decimal ? `${(m / 60).toFixed(2)} h` : `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, "0")}m`);

  const rows = q.data ?? [];
  const byEmp = useMemo(() => {
    const m = new Map<string, { name: string; paid: number; onSite: number; days: TimesheetDay[] }>();
    for (const d of rows) {
      const e = m.get(d.employee_id) ?? { name: d.employee_name, paid: 0, onSite: 0, days: [] };
      if (d.clock_in) e.paid += mins(d.clock_in, d.clock_out);
      e.onSite += d.visits.reduce((s, v) => s + mins(v.arrived_at, v.left_at), 0);
      e.days.push(d);
      m.set(d.employee_id, e);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const download = () => {
    const lines = [["Employee", "Date", "Clock in", "Clock out", "Paid", "Appointment", "Arrived", "Left", "On site"].join(",")];
    for (const d of rows) {
      const paid = d.clock_in ? dur(mins(d.clock_in, d.clock_out)) : "";
      if (!d.visits.length) lines.push([d.employee_name, d.day, time(d.clock_in), time(d.clock_out), paid, "", "", "", ""].map((v) => `"${v}"`).join(","));
      d.visits.forEach((v, i) =>
        lines.push([d.employee_name, d.day, i ? "" : time(d.clock_in), i ? "" : time(d.clock_out), i ? "" : paid, v.client, time(v.arrived_at), time(v.left_at), dur(mins(v.arrived_at, v.left_at))].map((x) => `"${x}"`).join(",")),
      );
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = `timesheet-${format(anchor, "yyyy-MM-dd")}.csv`;
    a.click();
  };

  return (
    <>
      <PageHeader
        title="Timesheet"
        subtitle="Clock in and out for the day, plus when each person arrived at and left every appointment."
        action={<Button variant="outline" size="sm" onClick={download}><Download className="size-4 mr-1.5" />Download</Button>}
      />
      <div className="max-w-6xl mx-auto px-6 md:px-8 py-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setAnchor(addDays(anchor, -7))} aria-label="Previous week"><ChevronLeft className="size-4" /></Button>
            <span className="text-sm font-medium">{format(anchor, "MMM d")} – {format(addDays(anchor, 6), "MMM d, yyyy")}</span>
            <Button variant="outline" size="icon" onClick={() => setAnchor(addDays(anchor, 7))} aria-label="Next week"><ChevronRight className="size-4" /></Button>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="dec" checked={decimal} onCheckedChange={setDecimal} />
            <Label htmlFor="dec">Decimal time</Label>
          </div>
        </div>

        {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!q.isLoading && byEmp.length === 0 && <p className="text-sm text-muted-foreground">No time recorded this week.</p>}

        {byEmp.map((e) => (
          <section key={e.name} className="rounded-xl border border-border/60 bg-card">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
              <h2 className="font-semibold">{e.name}</h2>
              <div className="text-sm text-muted-foreground tabular-nums">
                Paid <span className="text-foreground font-medium">{dur(e.paid)}</span> · On site <span className="text-foreground font-medium">{dur(e.onSite)}</span> · Drive/other <span className="text-foreground font-medium">{dur(Math.max(0, e.paid - e.onSite))}</span>
              </div>
            </div>
            <div className="divide-y divide-border/40">
              {e.days.sort((a, b) => a.day.localeCompare(b.day)).map((d) => (
                <div key={d.day} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{format(new Date(d.day + "T12:00:00"), "EEE, MMM d")}</span>
                    <span className="tabular-nums text-muted-foreground">
                      Clock in {time(d.clock_in)} · Clock out {d.clock_in && !d.clock_out ? "still clocked in" : time(d.clock_out)}
                      {d.clock_in && <> · <span className="text-foreground font-medium">{dur(mins(d.clock_in, d.clock_out))}</span></>}
                    </span>
                  </div>
                  {d.visits.length > 0 && (
                    <ul className="mt-2 space-y-1 pl-3 border-l-2 border-brand/30">
                      {d.visits.map((v) => (
                        <li key={v.id} className="flex justify-between gap-2 tabular-nums">
                          <span className="truncate">{v.client}</span>
                          <span className="text-muted-foreground">
                            {time(v.arrived_at)} – {v.left_at ? time(v.left_at) : "on site"}
                            {v.left_at && <> · <span className="text-foreground">{dur(mins(v.arrived_at, v.left_at))}</span></>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
