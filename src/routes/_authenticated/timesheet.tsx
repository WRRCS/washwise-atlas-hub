import { useT, translateNow as tn, activeLocales, dateLocaleOpts } from "@/lib/i18n";
import { TimesheetCorrectionDialog } from "@/components/timesheet-correction-dialog";
import { DeleteLineConfirm, TimesheetLineDialog } from "@/components/timesheet-line-dialog";
import { repeatedLineKeys } from "@/lib/timesheet-quick-edit";
import { attendanceIssue } from "@/lib/timesheet-corrections";
import { EmployeeClockControls } from "@/components/employee-clock-controls";
import { dailyIntervalMinutes } from "@/lib/clock-totals";
import { zonedToUTCISO } from "@/lib/tz";
import { visiblePayRates } from "@/lib/pay-rates.functions";
import { dollars, weeklyPay } from "@/lib/pay-calc";
import { buildPayPeriod, computeTotals, hours2, type PayGroup } from "@/lib/pay-period";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueries } from "@tanstack/react-query";
import { myCapabilities } from "@/lib/entities.functions";
import { useServerFn } from "@tanstack/react-start";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { addDays, format, startOfDay, startOfWeek } from "date-fns";
import { ChevronDown, ChevronLeft, ChevronRight, Download, Pencil, Plus, Trash2 } from "lucide-react";
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
  if (!h) return `${mm} ${tn("min")}`;
  return `${h} ${tn(h === 1 ? "hr" : "hrs")}${mm ? ` ${mm} ${tn("min")}` : ""}`;
}
const shortDur = (m: number) => {
  const r = Math.round(m);
  return r < 60 ? `${r} ${tn("min")}` : `${Math.floor(r / 60)}${tn("h")} ${String(r % 60).padStart(2, "0")}${tn("m")}`;
};

type Issue = "No-Show" | "Missing punch" | "Late" | "Clocked in" | "Repeated" | null;

function TimesheetPage() {
  const tz = useBusinessTz();
  const t = useT();
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const [view, setView] = useState<"day" | "week">("day");
  const [correction,setCorrection]=useState<{employeeId?:string;jobId?:string|null}|null>(null);
  const [line,setLine]=useState<DailyRow|null>(null);
  const [who, setWho] = useState<string>("all");
  const from = zonedToUTCISO(format(day, "yyyy-MM-dd"), "00:00", "America/Los_Angeles");
  const to = zonedToUTCISO(format(addDays(day, 1), "yyyy-MM-dd"), "00:00", "America/Los_Angeles");
  const fn = useServerFn(listDailyTimesheet);
  const q = useQuery({ queryKey: ["timesheet", "day", from], queryFn: () => fn({ data: { from, to } }) });
  const capsFn = useServerFn(myCapabilities);
  const { data: caps } = useQuery({ queryKey: ["my-capabilities"], queryFn: () => capsFn() });
  const isMgr = !!caps?.isStaff;

  const time = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString(activeLocales()[0] ?? "en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).toLowerCase() : "—";

  const rows = q.data?.rows ?? [];
  const entries = q.data?.entries ?? [];
  const now = Date.now();
  const repeated = useMemo(() => repeatedLineKeys(rows), [rows]);
  const issueOf = (r: DailyRow): Issue => {
    if (repeated.has(r.key)) return "Repeated";
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
  const dayTotalsShown = who === "all" ? dayTotals : dayTotals.filter((x) => x.id === who);
  const rates = usePayRates();
  const weekStart = startOfWeek(day, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const dayIndex = Math.round((day.getTime() - weekStart.getTime()) / 86400000);
  const weekResults = useQueries({ queries: weekDays.map((d) => dayQuery(fn, d)) });
  const priorResults = weekResults.slice(0, dayIndex);
  const priorMin = new Map<string, number>();
  for (const res of priorResults) for (const t of computeTotals(res.data)) priorMin.set(t.id, (priorMin.get(t.id) ?? 0) + t.total);
  const priorLoading = priorResults.some((r) => r.isLoading);
  // Everyone with time or cleanings this week, for the "show one employee" picker.
  const weekStamp = weekResults.map((r) => r.dataUpdatedAt).join(",");
  const people = useMemo(() => {
    const m = new Map<string, string>();
    const all = [...weekResults.map((r) => r.data), q.data];
    for (const d of all) for (const r of d?.rows ?? []) m.set(r.employee_id, r.employee_name);
    for (const d of all) for (const e of d?.entries ?? []) if (!m.has(e.employee_id)) m.set(e.employee_id, e.employee_name);
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStamp, q.dataUpdatedAt]);
  const pickerPeople = who !== "all" && !people.some((p) => p.id === who) ? [...people, { id: who, name: t("Employee") }] : people;
  const picker = isMgr && pickerPeople.length > 1 ? <EmployeePicker people={pickerPeople} value={who} onChange={setWho} /> : null;
  const shown = <T extends { employee_id: string }>(list: T[]) => (who === "all" ? list : list.filter((x) => x.employee_id === who));
  const dayEarned = (id: string, minutes: number) => {
    const rate = rates?.[id];
    if (!rate) return null;
    return weeklyPay([minutes], rate, priorMin.get(id) ?? 0).days[0];
  };

  if (view === "week") {
    return (
      <>
        <PageHeader title={t("Timesheet")} subtitle={`${t("Pay period (week)")} · ${t("Pacific time")}`} />
        <WeekView day={day} who={who} picker={picker} time={time} onBack={() => setView("day")} onPickDay={(d) => { setDay(d); setView("day"); }} setDay={setDay} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t("Timesheet")}
        subtitle={`${format(day, "EEE, MMM d, yyyy", dateLocaleOpts())} · ${t("Pacific time")}`}
        action={<Button variant="outline" size="sm" onClick={download}><Download className="size-4 mr-1.5" />{t("Download")}</Button>}
      />
      <div className="max-w-6xl mx-auto w-full px-4 md:px-8 py-6 space-y-4">
        {caps && !isMgr && <EmployeeClockControls />}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setDay(addDays(day, -1))}><ChevronLeft className="size-4 mr-1" />{t("Prev")}</Button>
          <Button variant="outline" size="sm" disabled={isToday} onClick={() => setDay(startOfDay(new Date()))}>{t("Today")}</Button>
          <Button variant="outline" size="sm" onClick={() => setDay(addDays(day, 1))}>{t("Next")}<ChevronRight className="size-4 ml-1" /></Button>
          <Button variant="secondary" size="sm" onClick={() => setView("week")}>{t("Pay period (week)")}</Button>
          {isMgr&&<Button variant="outline" size="sm" onClick={()=>setCorrection({})}><Plus className="size-4 mr-1"/>{t("Add / correct time")}</Button>}
          {picker}
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
                <th className="text-left px-4 py-3 font-medium">{t("Team member")}</th>
                <th className="text-left px-4 py-3 font-medium">{t("Worked")}</th>
                <th className="text-left px-4 py-3 font-medium">{t("On site")}</th>
                <th className="text-left px-4 py-3 font-medium">{t("Drive / other")}</th>
                <th className="text-left px-4 py-3 font-medium">{t("Issues")}</th>
                {isMgr && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {q.isLoading && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">{t("Loading…")}</td></tr>}
              {!q.isLoading && shown(rows).length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">{t("No jobs or time recorded this day.")}</td></tr>
              )}
              {shown(rows).map((r) => (
                <TimesheetRow key={r.key} row={r} issue={issueOf(r)} time={time} isMgr={isMgr} from={from} to={to} onEdit={()=>setLine(r)} />
              ))}
            </tbody>
          </table>
        </div>

        {dayTotalsShown.length > 0 && (
          <section className="rounded-xl border border-border/60 bg-card">
            <div className="px-4 py-3 border-b border-border/60">
              <h2 className="font-semibold text-sm">{t("Total hours for the day")}</h2>
              <p className="text-xs text-muted-foreground">{t("On site plus drive / other time.")}</p>
            </div>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground"><tr>
                <th className="text-left px-4 py-2 font-medium">{t("Team member")}</th>
                <th className="text-right px-4 py-2 font-medium">{t("Paid work")}</th>
                <th className="text-right px-4 py-2 font-medium">{t("Drive")}</th>
                <th className="text-right px-4 py-2 font-medium">{t("Unpaid lunch")}</th>
                <th className="text-right px-4 py-2 font-medium">{t("Paid total")}</th>
                {rates && <th className="text-right px-4 py-2 font-medium">{t("Earned")}</th>}
              </tr></thead>
              <tbody>
                {dayTotalsShown.map((tot) => (
                  <tr key={tot.name} className="border-t border-border/40 tabular-nums">
                    <td className="px-4 py-2">{tot.name}</td>
                    <td className="px-4 py-2 text-right">{shortDur(tot.total-tot.drive)}</td>
                    <td className="px-4 py-2 text-right">{shortDur(tot.drive)}</td>
                    <td className="px-4 py-2 text-right">{shortDur(tot.unpaid)}</td>
                    <td className="px-4 py-2 text-right font-semibold">{shortDur(tot.total)}</td>
                    {rates && (() => {
                      const e = dayEarned(tot.id, tot.total);
                      return <td className="px-4 py-2 text-right font-semibold">
                        {priorLoading ? "…" : e ? <>{dollars(e.cents)}{e.overtimeMin > 0 && <div className="text-xs font-normal text-muted-foreground">{(e.overtimeMin / 60).toFixed(2)} {t("overtime hrs")}</div>}</> : <span className="text-xs font-normal text-muted-foreground">{t("No rate set")}</span>}
                      </td>;
                    })()}
                  </tr>
                ))}
              </tbody>
            </table>
            {rates && <p className="px-4 py-2 text-xs text-muted-foreground border-t border-border/40">{t("Earned = hourly rate, with 1.5× for hours over 40 in the week (Mon–Sun). Tips not included.")}</p>}
          </section>
        )}

        {isMgr && (shown(entries).length>0 || shown(q.data?.clockRecords??[]).length>0) && (
          <section className="rounded-xl border border-border/60 bg-card">
            <div className="px-4 py-3 border-b border-border/60">
              <h2 className="font-semibold text-sm">{t("Work, drive & unpaid lunch")}</h2>
            </div>
            <div className="divide-y divide-border/40">
              {shown([...entries,...(q.data?.clockRecords??[]).filter(e=>e.kind==="lunch")]).map((en) => (
                <div key={en.id} className="px-4 py-2 flex flex-wrap items-center gap-3 text-sm">
                  <span className="font-medium w-40 truncate">{en.employee_name}</span>
                  <span>{t(en.kind==="lunch"?"Unpaid lunch": "activity_type" in en&&en.activity_type==="drive"?"Drive":en.job_id?"Paid work":"Unscheduled work")}</span>
                  <span>{time(en.started_at)} – {en.ended_at?time(en.ended_at):t("Missing clock-out")}</span>
                  <Button size="icon" variant="ghost" aria-label={t("Edit time record")} onClick={()=>setCorrection({employeeId:en.employee_id,jobId:en.job_id})}><Pencil className="size-4"/></Button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
      {line&&<TimesheetLineDialog key={line.key} row={line} dayKey={format(day,"yyyy-MM-dd")} from={from} to={to} onClose={()=>setLine(null)} onMoreCorrections={()=>{setCorrection({employeeId:line.employee_id,jobId:line.job_id});setLine(null);}}/>}
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
  "Repeated": "bg-destructive/10 text-destructive",
};

function TimesheetRow({ row: r, issue, time, isMgr,from,to,onEdit }: {
  row: DailyRow; issue: Issue; time: (iso: string | null) => string; isMgr: boolean;from:string;to:string;onEdit:()=>void;
}) {
  const onSite = r.arrived_at ? dailyIntervalMinutes({started_at:r.arrived_at,ended_at:r.left_at},{from,to}) : 0;
  const sched = r.scheduled_start && r.scheduled_end ? mins(r.scheduled_start, r.scheduled_end) : null;
  const diff = useMemo(() => (r.arrived_at && r.left_at && sched != null ? onSite - sched : null), [r, onSite, sched]);
  const lateBy = issue === "Late" && r.scheduled_start && r.arrived_at ? mins(r.scheduled_start, r.arrived_at) : 0;
  const t = useT();
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <tr
      className={`border-b border-border/40 last:border-0 align-top ${isMgr ? "cursor-pointer hover:bg-muted/40" : ""}`}
      onClick={isMgr ? onEdit : undefined}
    >
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
            <div className="text-[15px] tabular-nums">{time(r.arrived_at)} – {r.left_at ? time(r.left_at) : t("now")}</div>
            <div className="text-xs text-muted-foreground">
              {r.left_at ? `${t("Total:")} ${longDur(onSite)}` : `${t("On site")} ${longDur(onSite)}`}
              {lateBy > 0 && ` · ${t("arrived {d} late").replace("{d}", longDur(lateBy))}`}
              {diff != null && (
                Math.abs(diff) <= ON_TIME_BAND
                  ? <span className="ml-1 font-semibold text-green-700">✓ {t("on time")}</span>
                  : diff > 0
                    ? <span className="ml-1 font-semibold text-orange-600">↑ {longDur(diff)} {t("over")}</span>
                    : <span className="ml-1 font-semibold text-sky-700">↓ {longDur(-diff)} {t("under")}</span>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="text-[15px] text-muted-foreground">--:-- – --:--</div>
            <div className="text-xs text-muted-foreground">{t("Scheduled:")} {time(r.scheduled_start)} – {time(r.scheduled_end)}</div>
          </>
        )}
      </td>
      <td className="px-4 py-4 text-[15px] tabular-nums">{shortDur(onSite)}</td>
      <td className="px-4 py-4 text-[15px] tabular-nums">{shortDur(r.drive_min)}</td>
      <td className="px-4 py-4">
        {issue && <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${ISSUE_STYLE[issue]}`}>{t(issue)}</span>}
      </td>
      {isMgr && (
        <td className="px-4 py-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" aria-label={t("Edit times")} onClick={onEdit}><Pencil className="size-3.5" /></Button>
          {r.visit_id && (
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10" aria-label={t("Delete line")} onClick={() => setConfirmDelete(true)}><Trash2 className="size-3.5" /></Button>
          )}
          {r.visit_id && <DeleteLineConfirm row={r} open={confirmDelete} onOpenChange={setConfirmDelete} />}
        </td>
      )}
    </tr>
  );
}

function EmployeePicker({ people, value, onChange }: { people: { id: string; name: string }[]; value: string; onChange: (v: string) => void }) {
  const t = useT();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-[200px]" aria-label={t("Show employee")}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{t("All employees")}</SelectItem>
        {people.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function WeekView({ day, who, picker, time, onBack, onPickDay, setDay }: {
  day: Date; who: string; picker: ReactNode; time: (iso: string | null) => string;
  onBack: () => void; onPickDay: (d: Date) => void; setDay: (d: Date) => void;
}) {
  const start = startOfWeek(day, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const fn = useServerFn(listDailyTimesheet);
  const tt = useT();
  const results = useQueries({ queries: days.map((d) => dayQuery(fn, d)) });
  const rates = usePayRates();
  const loading = results.some((r) => r.isLoading);
  const all = useMemo(() => buildPayPeriod(results.map((r) => r.data), rates),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [results.map((r) => r.dataUpdatedAt).join(","), rates]);
  const list = who === "all" ? all : all.filter((g) => g.id === who);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOpen = list.length > 0 && list.every((g) => open.has(g.id));
  const rateText = (c: number | null) => (c ? `${dollars(c)}/${tt("hr")}` : "—");
  const cardText = (n: number) => `${n} ${tt(n === 1 ? "time card" : "time cards")}`;
  const lineTime = (l: PayGroup["lines"][number]) => (l.arrived_at ? `${time(l.arrived_at)} – ${l.left_at ? time(l.left_at) : tt("now")}` : "--");
  const sum = (f: (g: PayGroup) => number) => list.reduce((s, g) => s + f(g), 0);
  const priced = list.some((g) => g.cents != null);

  const download = () => {
    const head = ["Employee", "Date", "Cleaning", "Wage rate", "Time card", "Scheduled hours", "Total paid hours"];
    if (rates) head.push("Est. wages");
    const lines = [head.join(",")];
    for (const g of list) {
      for (const l of g.lines) {
        const row = [g.name, format(days[l.dayIndex], "EEE MM/dd"), l.other ? "Drive / other work" : `${l.client}${l.property ? ` · ${l.property}` : ""}`,
          g.rateCents ? (g.rateCents / 100).toFixed(2) : "", lineTime(l), hours2(l.scheduledMin), hours2(l.paidMin)];
        if (rates) row.push(l.cents != null ? (l.cents / 100).toFixed(2) : "");
        lines.push(row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","));
      }
      const tot = [g.name, "Total", "", "", cardText(g.timeCards), hours2(g.scheduledMin), hours2(g.paidMin)];
      if (rates) tot.push(g.cents != null ? (g.cents / 100).toFixed(2) : "");
      lines.push(tot.map((v) => `"${v}"`).join(","));
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = `timesheet-week-${format(start, "yyyy-MM-dd")}.csv`;
    a.click();
  };

  const cols = rates ? 7 : 6;
  return (
    <div className="max-w-6xl mx-auto w-full px-4 md:px-8 py-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setDay(addDays(start, -7))}><ChevronLeft className="size-4 mr-1" />{tt("Prev week")}</Button>
        <Button variant="outline" size="sm" onClick={() => setDay(startOfDay(new Date()))}>{tt("This week")}</Button>
        <Button variant="outline" size="sm" onClick={() => setDay(addDays(start, 7))}>{tt("Next week")}<ChevronRight className="size-4 ml-1" /></Button>
        <span className="text-sm font-medium ml-2">{format(start, "MMM d", dateLocaleOpts())} – {format(addDays(start, 6), "MMM d, yyyy", dateLocaleOpts())}</span>
        {picker}
        <span className="ml-auto flex gap-2">
          {list.length > 0 && <Button variant="ghost" size="sm" onClick={() => setOpen(allOpen ? new Set() : new Set(list.map((g) => g.id)))}>{tt(allOpen ? "Collapse all" : "Expand all")}</Button>}
          <Button variant="outline" size="sm" onClick={download}><Download className="size-4 mr-1.5" />{tt("Download")}</Button>
          <Button variant="secondary" size="sm" onClick={onBack}>{tt("Day view")}</Button>
        </span>
      </div>
      <div className="rounded-xl border border-border/60 bg-card overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead className="text-xs text-muted-foreground border-b border-border/60">
            <tr>
              <th className="text-left px-4 py-3 font-medium">{tt("Date")}</th>
              <th className="text-left px-4 py-3 font-medium">{tt("Cleaning")}</th>
              <th className="text-left px-4 py-3 font-medium">{tt("Wage rate")}</th>
              <th className="text-left px-4 py-3 font-medium">{tt("Time card")}</th>
              <th className="text-right px-4 py-3 font-medium">{tt("Scheduled hrs")}</th>
              <th className="text-right px-4 py-3 font-medium">{tt("Total paid hrs")}</th>
              {rates && <th className="text-right px-4 py-3 font-medium">{tt("Est. wages")}</th>}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {loading && <tr><td colSpan={cols} className="px-4 py-8 text-center text-muted-foreground">{tt("Loading…")}</td></tr>}
            {!loading && list.length === 0 && <tr><td colSpan={cols} className="px-4 py-8 text-center text-muted-foreground">{tt("No time recorded this week.")}</td></tr>}
            {!loading && list.map((g) => {
              const isOpen = open.has(g.id);
              return (
                <Fragment key={g.id}>
                  <tr className="border-b border-border/60 bg-muted/40 cursor-pointer hover:bg-muted/60" onClick={() => toggle(g.id)}>
                    <td className="px-4 py-3" colSpan={2}>
                      <button type="button" className="flex items-center gap-3 font-semibold text-[15px]" aria-expanded={isOpen} onClick={(e) => { e.stopPropagation(); toggle(g.id); }}>
                        <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                        <span className="size-8 shrink-0 rounded-full bg-brand/15 text-brand grid place-items-center text-xs font-semibold">{initials(g.name)}</span>
                        {g.name}
                      </button>
                    </td>
                    <td className="px-4 py-3">{rateText(g.rateCents)}</td>
                    <td className="px-4 py-3 font-semibold">{cardText(g.timeCards)}</td>
                    <td className="px-4 py-3 text-right font-semibold">{hours2(g.scheduledMin)}</td>
                    <td className="px-4 py-3 text-right font-semibold">{hours2(g.paidMin)}</td>
                    {rates && (
                      <td className="px-4 py-3 text-right font-semibold">
                        {g.cents != null ? <>{dollars(g.cents)}{g.overtimeMin > 0 && <div className="text-xs font-normal text-muted-foreground">{hours2(g.overtimeMin)} {tt("overtime hrs")}</div>}</> : <span className="text-xs font-normal text-muted-foreground">{tt("No rate set")}</span>}
                      </td>
                    )}
                  </tr>
                  {isOpen && g.lines.map((l) => (
                    <tr key={l.key} className="border-b border-border/40">
                      <td className="px-4 py-3 whitespace-nowrap"><button type="button" className="hover:underline" onClick={() => onPickDay(days[l.dayIndex])}>{format(days[l.dayIndex], "EEE MMM d", dateLocaleOpts())}</button></td>
                      <td className="px-4 py-3">
                        {l.other ? <span className="text-muted-foreground">{tt("Drive / other work")}</span> : <>
                          <div className="font-medium">{l.client}</div>
                          {l.property && <div className="text-xs text-muted-foreground truncate max-w-[220px]">{l.property}</div>}
                        </>}
                      </td>
                      <td className="px-4 py-3">{rateText(g.rateCents)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{lineTime(l)}</td>
                      <td className="px-4 py-3 text-right">{l.scheduledMin ? hours2(l.scheduledMin) : "--"}</td>
                      <td className="px-4 py-3 text-right">{hours2(l.paidMin)}</td>
                      {rates && <td className="px-4 py-3 text-right">{l.cents != null ? dollars(l.cents) : "—"}</td>}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
          {!loading && list.length > 0 && (
            <tfoot className="tabular-nums border-t-2 border-border">
              <tr className="font-semibold">
                <td className="px-4 py-3" colSpan={3}>{tt("Totals")}</td>
                <td className="px-4 py-3">{cardText(sum((g) => g.timeCards))}</td>
                <td className="px-4 py-3 text-right">{hours2(sum((g) => g.scheduledMin))}</td>
                <td className="px-4 py-3 text-right">{hours2(sum((g) => g.paidMin))}</td>
                {rates && <td className="px-4 py-3 text-right">{priced ? dollars(sum((g) => g.cents ?? 0)) : "—"}</td>}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{tt("Tap a name to show or hide each cleaning. Tap a date to open that day.")}</p>
      {rates && <p className="text-xs text-muted-foreground">{tt("Earned = hourly rate, with 1.5× for hours over 40 in the week (Mon–Sun). Tips not included.")}</p>}
    </div>
  );
}

/** Same query key as the day view so day and week screens share cached data. */
function dayQuery(fn: (args: { data: { from: string; to: string } }) => Promise<any>, d: Date) {
  const from = zonedToUTCISO(format(d, "yyyy-MM-dd"), "00:00", "America/Los_Angeles");
  const to = zonedToUTCISO(format(addDays(d, 1), "yyyy-MM-dd"), "00:00", "America/Los_Angeles");
  return { queryKey: ["timesheet", "day", from], queryFn: () => fn({ data: { from, to } }) };
}

/** Rates the signed-in person may see (everyone for owners/managers, only their own otherwise); null hides pay. */
function usePayRates() {
  const fn = useServerFn(visiblePayRates);
  const { data } = useQuery({ queryKey: ["visible-pay-rates"], queryFn: () => fn(), staleTime: 5 * 60_000 });
  return data && Object.keys(data).length ? data : null;
}
