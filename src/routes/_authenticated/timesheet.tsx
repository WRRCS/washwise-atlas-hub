import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { myCapabilities } from "@/lib/entities.functions";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { addDays, format, startOfDay } from "date-fns";
import { ChevronLeft, ChevronRight, Download, Pencil, Trash2, LogOut } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import {
  listDailyTimesheet, updateTimeEntry, deleteTimeEntry, updateJobVisit, deleteJobVisit, type DailyRow,
} from "@/lib/visits.functions";
import { useBusinessTz } from "@/hooks/use-business-tz";

export const Route = createFileRoute("/_authenticated/timesheet")({
  head: () => ({
    meta: [
      { title: "Timesheet — Wash Rinse Repeat" },
      { name: "description", content: "Each cleaner's arrive and leave times at every job, with no-shows, late arrivals and drive time." },
      { property: "og:title", content: "Timesheet — Wash Rinse Repeat" },
      { property: "og:description", content: "Each cleaner's arrive and leave times at every job, with no-shows, late arrivals and drive time." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TimesheetPage,
});

const mins = (a: string, b: string | null) => Math.max(0, ((b ? new Date(b) : new Date()).getTime() - new Date(a).getTime()) / 60000);
const LATE_GRACE = 10; // minutes
const ON_TIME_BAND = 5; // minutes either side of the scheduled length

function longDur(m: number) {
  const r = Math.round(m);
  const h = Math.floor(r / 60), mm = r % 60;
  if (!h) return `${mm} min`;
  return `${h} hr${h === 1 ? "" : "s"}${mm ? ` ${mm} min` : ""}`;
}
const shortDur = (m: number) => {
  const r = Math.round(m);
  return r < 60 ? `${r} min` : `${Math.floor(r / 60)}h ${String(r % 60).padStart(2, "0")}m`;
};

type Issue = "No-Show" | "Late" | "Clocked in" | null;

function TimesheetPage() {
  const tz = useBusinessTz();
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const from = day.toISOString();
  const to = addDays(day, 1).toISOString();
  const fn = useServerFn(listDailyTimesheet);
  const q = useQuery({ queryKey: ["timesheet", "day", from], queryFn: () => fn({ data: { from, to } }) });
  const capsFn = useServerFn(myCapabilities);
  const { data: caps } = useQuery({ queryKey: ["my-capabilities"], queryFn: () => capsFn() });
  const isMgr = !!caps?.isStaff;

  const time = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).toLowerCase() : "—";

  const rows = q.data?.rows ?? [];
  const entries = q.data?.entries ?? [];
  const now = Date.now();
  const issueOf = (r: DailyRow): Issue => {
    if (r.arrived_at && !r.left_at) return "Clocked in";
    if (!r.arrived_at) return r.scheduled_end && new Date(r.scheduled_end).getTime() < now ? "No-Show" : null;
    if (r.scheduled_start && mins(r.scheduled_start, r.arrived_at) > LATE_GRACE && r.arrived_at > r.scheduled_start) return "Late";
    return null;
  };

  const download = () => {
    const lines = [["Employee", "Client", "Property", "Scheduled start", "Scheduled end", "Arrived", "Left", "On site", "Drive/other", "Issue"].join(",")];
    for (const r of rows) {
      lines.push([
        r.employee_name, r.client, r.property ?? "", time(r.scheduled_start), time(r.scheduled_end),
        time(r.arrived_at), time(r.left_at), r.arrived_at ? shortDur(mins(r.arrived_at, r.left_at)) : "",
        shortDur(r.drive_min), issueOf(r) ?? "",
      ].map((v) => `"${v}"`).join(","));
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = `timesheet-${format(day, "yyyy-MM-dd")}.csv`;
    a.click();
  };

  const isToday = startOfDay(new Date()).getTime() === day.getTime();

  return (
    <>
      <PageHeader
        title="Timesheet"
        subtitle={`${format(day, "EEE, MMM d, yyyy")} · Pacific time`}
        action={<Button variant="outline" size="sm" onClick={download}><Download className="size-4 mr-1.5" />Download</Button>}
      />
      <div className="max-w-6xl mx-auto w-full px-4 md:px-8 py-6 space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setDay(addDays(day, -1))}><ChevronLeft className="size-4 mr-1" />Prev</Button>
          <Button variant="outline" size="sm" disabled={isToday} onClick={() => setDay(startOfDay(new Date()))}>Today</Button>
          <Button variant="outline" size="sm" onClick={() => setDay(addDays(day, 1))}>Next<ChevronRight className="size-4 ml-1" /></Button>
          <input
            type="date"
            className="ml-auto h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={format(day, "yyyy-MM-dd")}
            onChange={(e) => e.target.value && setDay(startOfDay(new Date(e.target.value + "T12:00:00")))}
          />
        </div>

        <div className="rounded-xl border border-border/60 bg-card overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="text-xs text-muted-foreground border-b border-border/60">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Team member</th>
                <th className="text-left px-4 py-3 font-medium">Worked</th>
                <th className="text-left px-4 py-3 font-medium">On site</th>
                <th className="text-left px-4 py-3 font-medium">Drive / other</th>
                <th className="text-left px-4 py-3 font-medium">Issues</th>
                {isMgr && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {q.isLoading && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>}
              {!q.isLoading && rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No jobs or time recorded this day.</td></tr>
              )}
              {rows.map((r) => (
                <TimesheetRow key={r.key} row={r} issue={issueOf(r)} time={time} isMgr={isMgr} />
              ))}
            </tbody>
          </table>
        </div>

        {isMgr && entries.length > 0 && (
          <section className="rounded-xl border border-border/60 bg-card">
            <div className="px-4 py-3 border-b border-border/60">
              <h2 className="font-semibold text-sm">Day clock (clock in / clock out)</h2>
              <p className="text-xs text-muted-foreground">Fix a forgotten clock out or wrong time here.</p>
            </div>
            <div className="divide-y divide-border/40">
              {entries.map((en) => (
                <div key={en.id} className="px-4 py-2 flex flex-wrap items-center gap-3 text-sm">
                  <span className="font-medium w-40 truncate">{en.employee_name}</span>
                  <div className="flex-1"><EntryEditor entry={en} time={time} /></div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

function initials(name: string) {
  return name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 1).join("").toUpperCase() || "?";
}

const ISSUE_STYLE: Record<Exclude<Issue, null>, string> = {
  "No-Show": "bg-red-100 text-red-700",
  "Late": "bg-amber-100 text-amber-800",
  "Clocked in": "bg-green-100 text-green-700",
};

function TimesheetRow({ row: r, issue, time, isMgr }: {
  row: DailyRow; issue: Issue; time: (iso: string | null) => string; isMgr: boolean;
}) {
  const qc = useQueryClient();
  const updFn = useServerFn(updateJobVisit);
  const delFn = useServerFn(deleteJobVisit);
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(toLocalInput(r.arrived_at));
  const [end, setEnd] = useState(toLocalInput(r.left_at));
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try { await f(); toast.success(msg); setEditing(false); qc.invalidateQueries({ queryKey: ["timesheet"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Something went wrong"); }
    finally { setBusy(false); }
  };

  const onSite = r.arrived_at ? mins(r.arrived_at, r.left_at) : 0;
  const sched = r.scheduled_start && r.scheduled_end ? mins(r.scheduled_start, r.scheduled_end) : null;
  const diff = useMemo(() => (r.arrived_at && r.left_at && sched != null ? onSite - sched : null), [r, onSite, sched]);
  const lateBy = issue === "Late" && r.scheduled_start && r.arrived_at ? mins(r.scheduled_start, r.arrived_at) : 0;

  return (
    <tr className="border-b border-border/40 last:border-0 align-top">
      <td className="px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="size-8 shrink-0 rounded-full bg-brand/15 text-brand grid place-items-center text-xs font-semibold">{initials(r.employee_name)}</div>
          <div className="min-w-0">
            <div className="font-semibold truncate">{r.employee_name}</div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide truncate">
              {r.client}{r.property ? ` · ${r.property}` : ""}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-4">
        {editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-muted-foreground">Arrived <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className="ml-1 rounded border border-input bg-background px-2 py-1 text-sm" /></label>
            <label className="text-xs text-muted-foreground">Left <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className="ml-1 rounded border border-input bg-background px-2 py-1 text-sm" /></label>
            <Button size="sm" disabled={busy || !start} onClick={() => run(() => updFn({ data: { id: r.visit_id!, arrived_at: new Date(start).toISOString(), left_at: end ? new Date(end).toISOString() : null } }), "Times updated")}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        ) : r.arrived_at ? (
          <>
            <div className="text-[15px] tabular-nums">{time(r.arrived_at)} – {r.left_at ? time(r.left_at) : "now"}</div>
            <div className="text-xs text-muted-foreground">
              {r.left_at ? `Total: ${longDur(onSite)}` : `On site ${longDur(onSite)}`}
              {lateBy > 0 && ` · arrived ${longDur(lateBy)} late`}
              {diff != null && (
                Math.abs(diff) <= ON_TIME_BAND
                  ? <span className="ml-1 font-semibold text-green-700">✓ on time</span>
                  : diff > 0
                    ? <span className="ml-1 font-semibold text-orange-600">↑ {longDur(diff)} over</span>
                    : <span className="ml-1 font-semibold text-sky-700">↓ {longDur(-diff)} under</span>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="text-[15px] text-muted-foreground">--:-- – --:--</div>
            <div className="text-xs text-muted-foreground">Scheduled: {time(r.scheduled_start)} – {time(r.scheduled_end)}</div>
          </>
        )}
      </td>
      <td className="px-4 py-4 text-[15px] tabular-nums">{shortDur(onSite)}</td>
      <td className="px-4 py-4 text-[15px] tabular-nums">{shortDur(r.drive_min)}</td>
      <td className="px-4 py-4">
        {issue && <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${ISSUE_STYLE[issue]}`}>{issue}</span>}
      </td>
      {isMgr && (
        <td className="px-4 py-4 text-right whitespace-nowrap">
          {r.visit_id && !editing && (
            <>
              <Button size="sm" variant="ghost" aria-label="Edit times" onClick={() => setEditing(true)}><Pencil className="size-3.5" /></Button>
              <Button size="sm" variant="ghost" disabled={busy} aria-label="Delete job time"
                onClick={() => { if (confirm("Delete this arrive/leave record?")) run(() => delFn({ data: { id: r.visit_id! } }), "Deleted"); }}>
                <Trash2 className="size-3.5" />
              </Button>
            </>
          )}
        </td>
      )}
    </tr>
  );
}

const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function EntryEditor({ entry, time }: { entry: { id: string; started_at: string; ended_at: string | null }; time: (iso: string | null) => string }) {
  const qc = useQueryClient();
  const updFn = useServerFn(updateTimeEntry);
  const delFn = useServerFn(deleteTimeEntry);
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(toLocalInput(entry.started_at));
  const [end, setEnd] = useState(toLocalInput(entry.ended_at));
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try { await f(); toast.success(msg); setEditing(false); qc.invalidateQueries({ queryKey: ["timesheet"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Something went wrong"); }
    finally { setBusy(false); }
  };
  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 p-2">
        <label className="text-xs text-muted-foreground">In <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className="ml-1 rounded border border-input bg-background px-2 py-1 text-sm" /></label>
        <label className="text-xs text-muted-foreground">Out <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className="ml-1 rounded border border-input bg-background px-2 py-1 text-sm" /></label>
        <Button size="sm" disabled={busy || !start} onClick={() => run(() => updFn({ data: { id: entry.id, started_at: new Date(start).toISOString(), ended_at: end ? new Date(end).toISOString() : null } }), "Times updated")}>Save</Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span className="tabular-nums">{time(entry.started_at)} – {entry.ended_at ? time(entry.ended_at) : "still clocked in"}</span>
      <span className="flex gap-1">
        {!entry.ended_at && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => updFn({ data: { id: entry.id, clock_out_now: true } }), "Clocked out")}>
            <LogOut className="size-3.5 mr-1" />Clock out now
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label="Edit times"><Pencil className="size-3.5" /></Button>
        <Button size="sm" variant="ghost" disabled={busy} aria-label="Delete entry"
          onClick={() => { if (confirm("Delete this clock in/out entry?")) run(() => delFn({ data: { id: entry.id } }), "Entry deleted"); }}>
          <Trash2 className="size-3.5" />
        </Button>
      </span>
    </div>
  );
}
