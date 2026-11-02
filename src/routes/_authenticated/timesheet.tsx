import { TimesheetCorrectionDialog } from "@/components/timesheet-correction-dialog";
import { attendanceIssue } from "@/lib/timesheet-corrections";
import { EmployeeClockControls } from "@/components/employee-clock-controls";
import { dailyIntervalMinutes } from "@/lib/clock-totals";
import { zonedToUTCISO } from "@/lib/tz";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueries } from "@tanstack/react-query";
import { myCapabilities } from "@/lib/entities.functions";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { addDays, format, startOfDay, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight, Download, Pencil, Plus } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import {
  listDailyTimesheet, type DailyRow,
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

type Issue = "No-Show" | "Missing punch" | "Late" | "Clocked in" | null;

function TimesheetPage() {
  const tz = useBusinessTz();
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const [view, setView] = useState<"day" | "week">("day");
  const [correction,setCorrection]=useState<{employeeId?:string;jobId?:string|null}|null>(null);
  const from = zonedToUTCISO(format(day, "yyyy-MM-dd"), "00:00", "America/Los_Angeles");
  const to = zonedToUTCISO(format(addDays(day, 1), "yyyy-MM-dd"), "00:00", "America/Los_Angeles");
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
    const attendance=attendanceIssue(r,now);
    if(attendance)return attendance;
    if(r.attendance_status==="worked" && rows.some(other=>other.employee_id===r.employee_id&&other.job_id===r.job_id&&other.arrived_at&&r.arrived_at&&other.arrived_at<r.arrived_at))return null;
    if (r.arrived_at && r.scheduled_start && mins(r.scheduled_start, r.arrived_at) > LATE_GRACE && r.arrived_at > r.scheduled_start) return "Late";
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
    lines.push("", "Employee,Record,Start,End,Paid minutes,Unpaid lunch minutes,Description");
    for (const e of entries) lines.push([e.employee_name,"Paid work",e.started_at,e.ended_at ?? "",dailyIntervalMinutes(e, { from, to }),0,""].map(v=>`"${String(v).replaceAll('"','""')}"`).join(","));
    for (const e of q.data?.clockRecords ?? []) if(e.kind === "lunch") lines.push([e.employee_name,"Unpaid lunch",e.started_at,e.ended_at ?? "",0,dailyIntervalMinutes(e, { from, to }),e.description].map(v=>`"${String(v).replaceAll('"','""')}"`).join(","));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = `timesheet-${format(day, "yyyy-MM-dd")}.csv`;
    a.click();
  };

  const isToday = startOfDay(new Date()).getTime() === day.getTime();

  const dayTotals = useMemo(() => computeTotals(q.data), [q.data]);

  if (view === "week") {
    return (
      <>
        <PageHeader title="Timesheet" subtitle="Pay period (week) · Pacific time" />
        <WeekView day={day} onBack={() => setView("day")} onPickDay={(d) => { setDay(d); setView("day"); }} setDay={setDay} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Timesheet"
        subtitle={`${format(day, "EEE, MMM d, yyyy")} · Pacific time`}
        action={<Button variant="outline" size="sm" onClick={download}><Download className="size-4 mr-1.5" />Download</Button>}
      />
      <div className="max-w-6xl mx-auto w-full px-4 md:px-8 py-6 space-y-4">
        {caps && !isMgr && <EmployeeClockControls />}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setDay(addDays(day, -1))}><ChevronLeft className="size-4 mr-1" />Prev</Button>
          <Button variant="outline" size="sm" disabled={isToday} onClick={() => setDay(startOfDay(new Date()))}>Today</Button>
          <Button variant="outline" size="sm" onClick={() => setDay(addDays(day, 1))}>Next<ChevronRight className="size-4 ml-1" /></Button>
          <Button variant="secondary" size="sm" onClick={() => setView("week")}>Pay period (week)</Button>
          {isMgr&&<Button variant="outline" size="sm" onClick={()=>setCorrection({})}><Plus className="size-4 mr-1"/>Add / correct time</Button>}
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
                <TimesheetRow key={r.key} row={r} issue={issueOf(r)} time={time} isMgr={isMgr} from={from} to={to} onEdit={()=>setCorrection({employeeId:r.employee_id,jobId:r.job_id})} />
              ))}
            </tbody>
          </table>
        </div>

        {dayTotals.length > 0 && (
          <section className="rounded-xl border border-border/60 bg-card">
            <div className="px-4 py-3 border-b border-border/60">
              <h2 className="font-semibold text-sm">Total hours for the day</h2>
              <p className="text-xs text-muted-foreground">On site plus drive / other time.</p>
            </div>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground"><tr>
                <th className="text-left px-4 py-2 font-medium">Team member</th>
                <th className="text-right px-4 py-2 font-medium">Paid work</th>
                <th className="text-right px-4 py-2 font-medium">Drive</th>
                <th className="text-right px-4 py-2 font-medium">Unpaid lunch</th>
                <th className="text-right px-4 py-2 font-medium">Paid total</th>
              </tr></thead>
              <tbody>
                {dayTotals.map((t) => (
                  <tr key={t.name} className="border-t border-border/40 tabular-nums">
                    <td className="px-4 py-2">{t.name}</td>
                    <td className="px-4 py-2 text-right">{shortDur(t.total-t.drive)}</td>
                    <td className="px-4 py-2 text-right">{shortDur(t.drive)}</td>
                    <td className="px-4 py-2 text-right">{shortDur(t.unpaid)}</td>
                    <td className="px-4 py-2 text-right font-semibold">{shortDur(t.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {isMgr && (entries.length>0 || (q.data?.clockRecords.length??0)>0) && (
          <section className="rounded-xl border border-border/60 bg-card">
            <div className="px-4 py-3 border-b border-border/60">
              <h2 className="font-semibold text-sm">Work, drive &amp; unpaid lunch</h2>
            </div>
            <div className="divide-y divide-border/40">
              {[...entries,...(q.data?.clockRecords??[]).filter(e=>e.kind==="lunch")].map((en) => (
                <div key={en.id} className="px-4 py-2 flex flex-wrap items-center gap-3 text-sm">
                  <span className="font-medium w-40 truncate">{en.employee_name}</span>
                  <span>{en.kind==="lunch"?"Unpaid lunch": "activity_type" in en&&en.activity_type==="drive"?"Drive":en.job_id?"Paid work":"Unscheduled work"}</span>
                  <span>{time(en.started_at)} – {en.ended_at?time(en.ended_at):"Missing clock-out"}</span>
                  <Button size="icon" variant="ghost" aria-label="Edit time record" onClick={()=>setCorrection({employeeId:en.employee_id,jobId:en.job_id})}><Pencil className="size-4"/></Button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
      {correction&&<TimesheetCorrectionDialog {...correction} from={from} to={to} onClose={()=>setCorrection(null)}/>}
    </>
  );
}

function initials(name: string) {
  return name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 1).join("").toUpperCase() || "?";
}

const ISSUE_STYLE: Record<Exclude<Issue, null>, string> = {
  "No-Show": "bg-red-100 text-red-700",
  "Missing punch": "bg-warning/15 text-foreground",
  "Late": "bg-amber-100 text-amber-800",
  "Clocked in": "bg-green-100 text-green-700",
};

function TimesheetRow({ row: r, issue, time, isMgr,from,to,onEdit }: {
  row: DailyRow; issue: Issue; time: (iso: string | null) => string; isMgr: boolean;from:string;to:string;onEdit:()=>void;
}) {
  const onSite = r.arrived_at ? dailyIntervalMinutes({started_at:r.arrived_at,ended_at:r.left_at},{from,to}) : 0;
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
        {r.arrived_at ? (
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
          <Button size="sm" variant="ghost" aria-label="Edit times" onClick={onEdit}><Pencil className="size-3.5" /></Button>
        </td>
      )}
    </tr>
  );
}

/** Paid total = clock in → clock out (open entry counts to now); falls back to on-site + drive when no clock entry exists. */
function computeTotals(data: { from: string; to: string; rows: any[]; entries: { employee_id: string; employee_name: string; started_at: string; ended_at: string | null }[]; clockRecords?: {employee_id:string;employee_name:string;kind:string;started_at:string;ended_at:string|null}[] } | undefined) {
  const m = new Map<string, { id: string; name: string; onSite: number; clocked: number; unpaid: number; hasClock: boolean; legacy: number; explicitDrive:number; corrected:boolean }>();
  const get = (id: string, name: string) => { const t = m.get(id) ?? { id, name, onSite: 0, clocked: 0, unpaid: 0, hasClock: false, legacy: 0, explicitDrive:0, corrected:false }; m.set(id, t); return t; };
  for (const r of data?.rows ?? []) {
    const t = get(r.employee_id, r.employee_name);
    const on = r.arrived_at && data ? dailyIntervalMinutes({ started_at: r.arrived_at, ended_at: r.left_at }, data) : 0;
    t.onSite += on; if(r.attendance_status) t.corrected=true;
    t.legacy += on + (r.drive_min ?? 0);
  }
  if (data) {
    for (const e of data.entries) { const t=get(e.employee_id,e.employee_name); t.clocked += dailyIntervalMinutes(e, data); if("activity_type" in e && e.activity_type==="drive") t.explicitDrive += dailyIntervalMinutes(e,data); t.hasClock=true; }
    for (const e of data.clockRecords ?? []) if(e.kind === "lunch") { const t=get(e.employee_id,e.employee_name); t.unpaid += dailyIntervalMinutes(e, data); t.hasClock=true; }
  }
  return Array.from(m.values())
    .map((t) => { const total = t.hasClock ? t.clocked : t.legacy; return { ...t, total, drive: t.corrected || t.explicitDrive>0 ? t.explicitDrive : Math.max(0, total - t.onSite) }; })
    .filter((t) => t.total > 0 || t.unpaid > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function WeekView({ day, onBack, onPickDay, setDay }: { day: Date; onBack: () => void; onPickDay: (d: Date) => void; setDay: (d: Date) => void }) {
  const start = startOfWeek(day, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const fn = useServerFn(listDailyTimesheet);
  const results = useQueries({
    queries: days.map((d) => {
      const from = zonedToUTCISO(format(d,"yyyy-MM-dd"), "00:00", "America/Los_Angeles");
      return { queryKey: ["timesheet", "day", from], queryFn: () => fn({ data: { from, to: zonedToUTCISO(format(addDays(d,1),"yyyy-MM-dd"),"00:00","America/Los_Angeles") } }) };
    }),
  });
  const loading = results.some((r) => r.isLoading);
  const people = new Map<string, { name: string; perDay: number[]; unpaid: number }>();
  results.forEach((res, i) => {
    for (const t of computeTotals(res.data)) {
      const p = people.get(t.id) ?? { name: t.name, perDay: Array(7).fill(0), unpaid: 0 };
      p.perDay[i] += t.total;
      p.unpaid += t.unpaid;
      people.set(t.id, p);
    }
  });
  const list = Array.from(people.values()).filter((p) => p.unpaid > 0 || p.perDay.some((v) => v > 0)).sort((a, b) => a.name.localeCompare(b.name));
  const hrs = (m: number) => (m ? (m / 60).toFixed(2) : "—");

  const download = () => {
    const lines = [["Employee", ...days.map((d) => format(d, "EEE MM/dd")), "Unpaid lunch hours", "Paid total hours"].join(",")];
    for (const p of list) lines.push([p.name, ...p.perDay.map((v) => (v / 60).toFixed(2)),(p.unpaid/60).toFixed(2), (p.perDay.reduce((a, b) => a + b, 0) / 60).toFixed(2)].map((v) => `"${v}"`).join(","));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = `timesheet-week-${format(start, "yyyy-MM-dd")}.csv`;
    a.click();
  };

  return (
    <div className="max-w-6xl mx-auto w-full px-4 md:px-8 py-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setDay(addDays(start, -7))}><ChevronLeft className="size-4 mr-1" />Prev week</Button>
        <Button variant="outline" size="sm" onClick={() => setDay(startOfDay(new Date()))}>This week</Button>
        <Button variant="outline" size="sm" onClick={() => setDay(addDays(start, 7))}>Next week<ChevronRight className="size-4 ml-1" /></Button>
        <span className="text-sm font-medium ml-2">{format(start, "MMM d")} – {format(addDays(start, 6), "MMM d, yyyy")}</span>
        <span className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={download}><Download className="size-4 mr-1.5" />Download</Button>
          <Button variant="secondary" size="sm" onClick={onBack}>Day view</Button>
        </span>
      </div>
      <div className="rounded-xl border border-border/60 bg-card overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead className="text-xs text-muted-foreground border-b border-border/60">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Team member</th>
              {days.map((d) => (
                <th key={d.toISOString()} className="text-right px-3 py-3 font-medium">
                  <button className="hover:underline" onClick={() => onPickDay(d)}>{format(d, "EEE M/d")}</button>
                </th>
              ))}
              <th className="text-right px-4 py-3 font-medium">Unpaid lunch</th>
              <th className="text-right px-4 py-3 font-medium">Paid total hrs</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>}
            {!loading && list.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">No time recorded this week.</td></tr>}
            {list.map((p) => (
              <tr key={p.name} className="border-b border-border/40 last:border-0 tabular-nums">
                <td className="px-4 py-3 font-medium">{p.name}</td>
                {p.perDay.map((v, i) => <td key={i} className="px-3 py-3 text-right">{hrs(v)}</td>)}
                <td className="px-4 py-3 text-right">{hrs(p.unpaid)}</td>
                <td className="px-4 py-3 text-right font-semibold">{hrs(p.perDay.reduce((a, b) => a + b, 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Hours include on-site and drive / other time. Tap a day to see its details.</p>
    </div>
  );
}
