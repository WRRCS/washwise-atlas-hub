import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { listJobs, createJob, checkConflicts, moveJob, publishSchedule, listUnavailability, deleteJob, duplicateJobToEmployee } from "@/lib/jobs.functions";
import { listClients, listServiceTypes, listEmployees, setClientColor } from "@/lib/entities.functions";
import { myPermissions } from "@/lib/team.functions";
import { startOfWeek, addDays, format, startOfDay, endOfDay, isSameDay, differenceInMinutes } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, AlertTriangle, Send, Users, LayoutGrid, List as ListIcon, Check, ExternalLink, Clock, Trash2, Copy, ClipboardPaste, X } from "lucide-react";
import { toast } from "sonner";
import { useBusinessTz } from "@/hooks/use-business-tz";
import { dayKeyTZ, fmtTimeTZ, fmtDateTZ, hourMinuteTZ, zonedToUTCISO } from "@/lib/tz";
import { ZoomPanSurface } from "@/components/zoom-pan-surface";
import { RecurrenceFields, defaultRecurrence, effectiveStartDate, recurrenceEndValue, type RecurrenceValue } from "@/components/recurrence-fields";



export const Route = createFileRoute("/_authenticated/calendar")({
  component: SchedulePage,
  errorComponent: ({ error }) => <div className="p-8 text-sm text-destructive">{error.message}</div>,
});

type View = "grid" | "list";

function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

// Palette users can pick from per client (24 distinct variations)
const CHIP_PALETTE = [
  "#e11d48", "#f43f5e", "#be123c", "#f97316", "#f59e0b", "#eab308",
  "#22c55e", "#10b981", "#14b8a6", "#0ea5e9", "#0891b2",
  "#6366f1", "#7c3aed", "#8b5cf6", "#ec4899", "#64748b",
  "#65a30d", "#ca8a04", "#2563eb", "#4f46e5", "#7e22ce",
  "#db2777", "#475569", "#c2410c",
];
function chipColor(seed: string | null | undefined) {
  const s = seed ?? "x";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return CHIP_PALETTE[h % CHIP_PALETTE.length];
}



function SchedulePage() {
  const qc = useQueryClient();
  const tz = useBusinessTz();
  const [anchor, setAnchor] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [view, setView] = useState<View>("grid");
  const [dialogSeed, setDialogSeed] = useState<{ date: Date; employeeId?: string } | null>(null);

  const jobsFn = useServerFn(listJobs);
  const empFn = useServerFn(listEmployees);
  const unavFn = useServerFn(listUnavailability);
  const moveFn = useServerFn(moveJob);
  const publishFn = useServerFn(publishSchedule);
  const setColorFn = useServerFn(setClientColor);
  const permsHeaderFn = useServerFn(myPermissions);
  const { data: headerPerms } = useQuery({ queryKey: ["my-permissions"], queryFn: () => permsHeaderFn() });
  const canManageSchedule = !!headerPerms?.isOwner;
  // Pay/earnings are never shown on the schedule; hours only.
  const canSeeWages = false;

  const colorMut = useMutation({
    mutationFn: (v: { clientId: string; color: string | null }) =>
      setColorFn({ data: { id: v.clientId, color: v.color } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
      toast.success("Color saved for client");
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not save color"),
  });

  const from = startOfDay(anchor).toISOString();
  const to = endOfDay(addDays(anchor, 6)).toISOString();

  const { data: jobs = [] } = useQuery({ queryKey: ["jobs", "week", from, to], queryFn: () => jobsFn({ data: { from, to } }) });
  const { data: employees = [] } = useQuery({ queryKey: ["employees"], queryFn: () => empFn({}) });
  const { data: unavailability = [] } = useQuery({ queryKey: ["unavail", from, to], queryFn: () => unavFn({ data: { from, to } }) });

  const cleaners = useMemo(
    () => employees.filter((e: any) => e.is_active !== false && (e.role === "employee" || e.role === "manager" || e.role === "owner")),
    [employees],
  );

  const days = Array.from({ length: 7 }, (_, i) => addDays(anchor, i));

  const moveMut = useMutation({
    mutationFn: (v: { id: string; start: Date; end: Date }) =>
      moveFn({ data: { id: v.id, scheduled_start: v.start.toISOString(), scheduled_end: v.end.toISOString() } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      toast.success("Shift moved");
    },
    onError: (e: any) => toast.error(e?.message ?? "Move failed"),
  });

  const dupFn = useServerFn(duplicateJobToEmployee);
  const dupMut = useMutation({
    mutationFn: (v: { id: string; employeeId: string; start: Date; end: Date }) =>
      dupFn({ data: { id: v.id, employee_id: v.employeeId, scheduled_start: v.start.toISOString(), scheduled_end: v.end.toISOString() } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      toast.success("Shift copied to team member");
    },
    onError: (e: any) => toast.error(e?.message ?? "Copy failed"),
  });

  const deleteFn = useServerFn(deleteJob);
  const deleteMut = useMutation({
    mutationFn: (v: { id: string; employeeId?: string }) =>
      deleteFn({ data: { id: v.id, employee_id: v.employeeId } }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      toast.success(r?.unassigned ? "Removed from this team member" : "Shift deleted");
    },
    onError: (e: any) => toast.error(e?.message ?? "Delete failed"),
  });

  const publishMut = useMutation({
    mutationFn: () => publishFn({ data: { from, to } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      toast.success(r.count ? `Published ${r.count} shift${r.count === 1 ? "" : "s"}` : "Nothing new to publish");
    },
  });

  // Build lookup: for each employee, jobs on each day
  const jobsByEmpDay = useMemo(() => {
    const m = new Map<string, Map<string, any[]>>();
    for (const j of jobs) {
      const dayKey = dayKeyTZ(j.scheduled_start, tz);
      for (const a of j.assignees) {
        if (!m.has(a.id)) m.set(a.id, new Map());
        const dm = m.get(a.id)!;
        if (!dm.has(dayKey)) dm.set(dayKey, []);
        dm.get(dayKey)!.push(j);
      }
    }
    return m;
  }, [jobs, tz]);

  const unavByEmpDay = useMemo(() => {
    const m = new Map<string, Map<string, any[]>>();
    for (const u of unavailability) {
      const dayKey = dayKeyTZ(u.starts_at, tz);
      if (!m.has(u.employee_id)) m.set(u.employee_id, new Map());
      const dm = m.get(u.employee_id)!;
      if (!dm.has(dayKey)) dm.set(dayKey, []);
      dm.get(dayKey)!.push(u);
    }
    return m;
  }, [unavailability, tz]);

  // Wages / hours per day, per employee (aggregate)
  const dailyTotals = useMemo(() => {
    return days.map((d) => {
      const dayKey = format(d, "yyyy-MM-dd");
      let hours = 0;
      let wages = 0;
      for (const emp of cleaners) {
        const rate = (emp.hourly_rate_cents ?? 0) / 100;
        const list = jobsByEmpDay.get(emp.id)?.get(dayKey) ?? [];
        for (const j of list) {
          const mins = differenceInMinutes(new Date(j.scheduled_end), new Date(j.scheduled_start));
          hours += mins / 60;
          wages += (mins / 60) * rate;
        }
      }
      return { dayKey, hours, wages };
    });
  }, [days, cleaners, jobsByEmpDay]);

  const weekTotals = useMemo(
    () =>
      dailyTotals.reduce((acc, d) => ({ hours: acc.hours + d.hours, wages: acc.wages + d.wages }), { hours: 0, wages: 0 }),
    [dailyTotals],
  );

  const empWeekTotals = useMemo(() => {
    const m = new Map<string, { hours: number; wages: number }>();
    for (const emp of cleaners) {
      const rate = (emp.hourly_rate_cents ?? 0) / 100;
      let hours = 0;
      const dm = jobsByEmpDay.get(emp.id);
      if (dm) for (const list of dm.values()) for (const j of list) hours += differenceInMinutes(new Date(j.scheduled_end), new Date(j.scheduled_start)) / 60;
      m.set(emp.id, { hours, wages: hours * rate });
    }
    return m;
  }, [cleaners, jobsByEmpDay]);

  const draftCount = jobs.filter((j: any) => !j.published_at).length;

  const [copiedShift, setCopiedShift] = useState<{ id: string; startISO: string; endISO: string; label: string } | null>(null);

  const pasteShift = (employeeId: string, day: Date) => {
    if (!copiedShift || !canManageSchedule) return;
    const oldStart = new Date(copiedShift.startISO);
    const oldEnd = new Date(copiedShift.endISO);
    const dayKey = format(day, "yyyy-MM-dd");
    const { hour, minute } = hourMinuteTZ(oldStart, tz);
    const newStart = new Date(
      zonedToUTCISO(dayKey, `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, tz),
    );
    const newEnd = new Date(newStart.getTime() + (oldEnd.getTime() - oldStart.getTime()));
    dupMut.mutate({ id: copiedShift.id, employeeId, start: newStart, end: newEnd });
  };

  const onDropOnCell = (e: React.DragEvent, employeeId: string, day: Date) => {
    e.preventDefault();
    const data = e.dataTransfer.getData("application/x-atlas-shift");
    if (!data) return;
    const { id, srcDayKey, srcEmpId, startISO, endISO } = JSON.parse(data);
    const dayKey = format(day, "yyyy-MM-dd");
    const sameEmp = !srcEmpId || srcEmpId === employeeId;
    if (dayKey === srcDayKey && sameEmp) return; // no-op
    // preserve time-of-day; only date changes
    const oldStart = new Date(startISO);
    const oldEnd = new Date(endISO);
    const { hour, minute } = hourMinuteTZ(oldStart, tz);
    const newStart = new Date(
      zonedToUTCISO(dayKey, `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, tz),
    );
    const newEnd = new Date(newStart.getTime() + (oldEnd.getTime() - oldStart.getTime()));
    if (!canManageSchedule) return;
    if (sameEmp) {
      moveMut.mutate({ id, start: newStart, end: newEnd });
    } else {
      dupMut.mutate({ id, employeeId, start: newStart, end: newEnd });
    }
  };

  return (
    <>
      <PageHeader
        title="Schedule"
        subtitle={`${format(anchor, "MMM d")} — ${format(addDays(anchor, 6), "MMM d, yyyy")}`}
        action={
          <div className="flex flex-wrap gap-2 items-center">
            <div className="inline-flex rounded-lg border border-border/60 p-0.5 bg-clay-100">
              <button onClick={() => setView("grid")} className={`px-2.5 py-1 text-xs rounded flex items-center gap-1 ${view === "grid" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}>
                <LayoutGrid className="size-3.5" /> Week grid
              </button>
              <button onClick={() => setView("list")} className={`px-2.5 py-1 text-xs rounded flex items-center gap-1 ${view === "list" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}>
                <ListIcon className="size-3.5" /> List
              </button>
            </div>
            <Button variant="outline" size="sm" onClick={() => setAnchor(addDays(anchor, -7))}>←</Button>
            <Button variant="outline" size="sm" onClick={() => setAnchor(startOfWeek(new Date(), { weekStartsOn: 1 }))}>Today</Button>
            <Button variant="outline" size="sm" onClick={() => setAnchor(addDays(anchor, 7))}>→</Button>
            {canManageSchedule ? (
              <>
                <Button
                  size="sm"
                  variant={draftCount ? "default" : "outline"}
                  onClick={() => publishMut.mutate()}
                  disabled={publishMut.isPending}
                  className={draftCount ? "bg-brand text-brand-foreground hover:opacity-90" : ""}
                >
                  <Send className="size-3.5 mr-1" />
                  {draftCount ? `Publish (${draftCount})` : "Published"}
                </Button>
                <Button size="sm" className="bg-brand text-brand-foreground hover:opacity-90" onClick={() => setDialogSeed({ date: new Date() })}>
                  <Plus className="size-4" /> New Job
                </Button>
              </>
            ) : (
              <Button asChild size="sm" className="bg-brand text-brand-foreground hover:opacity-90">
                <Link to="/my-jobs">
                  <Clock className="size-4" /> Clock in
                </Link>
              </Button>
            )}
          </div>
        }
      />

      {view === "grid" ? (
        <div className="w-full px-4 md:px-6 py-4">
          <ZoomPanSurface>
            {/* Header row */}
            <div className="grid w-full" style={{ gridTemplateColumns: `minmax(112px, 1.15fr) repeat(7, minmax(0, 1fr))` }}>
              <div className="sticky left-0 z-20 px-2 py-2 text-[11px] font-semibold text-muted-foreground border-b border-border/60 bg-clay-50 flex items-center gap-1.5">

                <Users className="size-3.5" /> Team members ({cleaners.length})
              </div>
              {days.map((d) => {
                const today = isSameDay(d, new Date());
                return (
                  <div key={d.toISOString()} className={`min-w-0 px-1 py-2 text-center border-b border-l border-border/60 ${today ? "bg-brand/5" : "bg-clay-50"}`}>
                    <p className={`text-[9px] uppercase ${today ? "text-brand font-semibold" : "text-muted-foreground"}`}>{format(d, "EEE")}</p>
                    <p className={`text-base font-semibold ${today ? "text-brand" : ""}`}>{format(d, "d")}</p>
                  </div>
                );
              })}
            </div>

            {/* Employee rows */}
            {cleaners.length === 0 && (
              <div className="p-6 text-sm text-muted-foreground">No employees yet. Add employees to see the schedule grid.</div>
            )}
            {cleaners.map((emp: any) => {
              const totals = empWeekTotals.get(emp.id) ?? { hours: 0, wages: 0 };
              return (
                <div key={emp.id} className="grid w-full border-t border-border/60" style={{ gridTemplateColumns: `minmax(112px, 1.15fr) repeat(7, minmax(0, 1fr))` }}>
                  <div className="sticky left-0 z-10 min-w-0 px-2 py-2 flex items-center gap-1.5 bg-clay-50 border-r border-border/60">
                    <div className="size-7 rounded-full bg-brand/15 text-brand grid place-items-center text-[10px] font-semibold shrink-0">
                      {initials(emp.full_name)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{emp.full_name ?? emp.email}</p>
                      <p className="text-[9px] text-muted-foreground tabular-nums truncate">
                        {totals.hours.toFixed(2)} hrs{canSeeWages ? ` / $${totals.wages.toFixed(2)}` : ""}
                      </p>
                    </div>
                  </div>
                  {days.map((d) => {
                    const dayKey = format(d, "yyyy-MM-dd");
                    const shifts = jobsByEmpDay.get(emp.id)?.get(dayKey) ?? [];
                    const unavs = unavByEmpDay.get(emp.id)?.get(dayKey) ?? [];
                    const today = isSameDay(d, new Date());
                    return (
                      <div
                        key={dayKey}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => onDropOnCell(e, emp.id, d)}
                        className={`min-w-0 border-l border-border/60 p-1 space-y-1 min-h-[100px] ${today ? "bg-brand/[0.02]" : ""}`}
                      >
                        {unavs.map((u: any) => (
                          <div key={u.id} className="rounded-md bg-clay-200/70 border-l-2 border-clay-400 px-2 py-1 text-[10px] leading-tight">
                            <p className="font-semibold text-muted-foreground">Unavailable</p>
                            <p className="text-muted-foreground">
                              {u.all_day ? "All Day" : `${fmtTimeTZ(u.starts_at, tz)}-${fmtTimeTZ(u.ends_at, tz)}`}
                            </p>
                          </div>
                        ))}
                        {shifts
                          .sort((a: any, b: any) => a.scheduled_start.localeCompare(b.scheduled_start))
                          .map((j: any) => {
                            const label =
                              j.notes ||
                              [j.client?.first_name, j.client?.last_name].filter(Boolean).join(" ") ||
                              j.service?.name ||
                              "Shift";
                            const clientId = j.client?.id as string | undefined;
                            const customColor = j.client?.color as string | undefined | null;
                            const c = customColor || chipColor(clientId ?? j.notes);
                            const draft = !j.published_at;
                            const s = new Date(j.scheduled_start).getTime();
                            const e = new Date(j.scheduled_end).getTime();
                            const conflict = shifts.some((k: any) => k.id !== j.id && new Date(k.scheduled_start).getTime() < e && new Date(k.scheduled_end).getTime() > s);
                            const cardBody = (
                              <>
                                <div className="flex items-center gap-1 font-semibold">
                                  {conflict && <AlertTriangle className="size-3 shrink-0" />}
                                  <span>{fmtTimeTZ(j.scheduled_start, tz)}-{fmtTimeTZ(j.scheduled_end, tz)}</span>
                                </div>
                                <p className="uppercase font-semibold truncate">{label}</p>
                              </>
                            );
                            if (!canManageSchedule) {
                              return (
                                <Link
                                  key={j.id}
                                  to="/jobs/$jobId"
                                  params={{ jobId: j.id }}
                                  className={`w-full text-left block rounded-md px-2 py-1 text-[10px] leading-tight text-white cursor-pointer hover:opacity-95 transition ${draft ? "ring-2 ring-dashed ring-white/60 opacity-90" : ""}`}
                                  style={{ backgroundColor: c }}
                                  title={`${label} — ${fmtTimeTZ(j.scheduled_start, tz)}-${fmtTimeTZ(j.scheduled_end, tz)}${draft ? " (draft)" : ""}`}
                                >
                                  {cardBody}
                                </Link>
                              );
                            }
                            return (
                              <Popover key={j.id}>
                                <PopoverTrigger asChild>
                                  <button
                                    type="button"
                                    draggable
                                    onDragStart={(ev) => {
                                      ev.dataTransfer.setData(
                                        "application/x-atlas-shift",
                                        JSON.stringify({ id: j.id, srcDayKey: dayKey, srcEmpId: emp.id, startISO: j.scheduled_start, endISO: j.scheduled_end }),
                                      );
                                      ev.dataTransfer.effectAllowed = "move";
                                    }}
                                    className={`w-full text-left block rounded-md px-2 py-1 text-[10px] leading-tight text-white cursor-pointer hover:opacity-95 transition ${draft ? "ring-2 ring-dashed ring-white/60 opacity-90" : ""}`}
                                    style={{ backgroundColor: c }}
                                    title={`${label} — ${fmtTimeTZ(j.scheduled_start, tz)}-${fmtTimeTZ(j.scheduled_end, tz)}${draft ? " (draft)" : ""}`}
                                  >
                                    {cardBody}
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-64 p-3" align="start">
                                  <p className="text-xs font-semibold mb-1 truncate">{label}</p>
                                  <p className="text-[11px] text-muted-foreground mb-2">
                                    {clientId ? "Pick a color for this client — it applies to every appointment." : "Assign a client to save a persistent color."}
                                  </p>
                                  <div className="grid grid-cols-5 gap-1.5 mb-3">
                                    {CHIP_PALETTE.map((swatch) => {
                                      const selected = (customColor ?? "").toLowerCase() === swatch.toLowerCase();
                                      return (
                                        <button
                                          key={swatch}
                                          type="button"
                                          disabled={!clientId || colorMut.isPending}
                                          onClick={() => clientId && colorMut.mutate({ clientId, color: swatch })}
                                          className="relative size-7 rounded-md ring-1 ring-black/10 disabled:opacity-50 hover:scale-105 transition"
                                          style={{ backgroundColor: swatch }}
                                          aria-label={`Set color ${swatch}`}
                                        >
                                          {selected && <Check className="size-4 text-white absolute inset-0 m-auto" />}
                                        </button>
                                      );
                                    })}
                                  </div>
                                  <div className="flex items-center justify-between gap-2">
                                    <button
                                      type="button"
                                      disabled={!clientId || !customColor || colorMut.isPending}
                                      onClick={() => clientId && colorMut.mutate({ clientId, color: null })}
                                      className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                                    >
                                      Reset to default
                                    </button>
                                    <Link to="/jobs/$jobId" params={{ jobId: j.id }} className="text-[11px] font-medium text-brand inline-flex items-center gap-1 hover:underline">
                                      Open job <ExternalLink className="size-3" />
                                    </Link>
                                  </div>
                                  {canManageSchedule && (
                                    <div className="mt-3 pt-3 border-t border-border/60 space-y-2">
                                      <EditTimesInline
                                        tz={tz}
                                        startISO={j.scheduled_start}
                                        endISO={j.scheduled_end}
                                        saving={moveMut.isPending}
                                        onSave={(startISO, endISO) =>
                                          moveMut.mutate({ id: j.id, start: new Date(startISO), end: new Date(endISO) })
                                        }
                                      />
                                       <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                                         <Copy className="size-3" /> Drag this shift onto another team member to copy it.
                                       </p>
                                       <button
                                         type="button"
                                         onClick={() => {
                                           setCopiedShift({ id: j.id, startISO: j.scheduled_start, endISO: j.scheduled_end, label });
                                           toast.success("Shift copied — tap \"Paste here\" on any day/team member to place it.");
                                         }}
                                         className="w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-border/70 text-[11px] font-medium py-1.5 hover:bg-clay-100"
                                       >
                                         <Copy className="size-3" /> Copy shift
                                       </button>
                                      <button
                                        type="button"
                                        disabled={deleteMut.isPending}
                                        onClick={() => {
                                          const many = (j.assignees?.length ?? 0) > 1;
                                          const msg = many
                                            ? `Remove ${emp.full_name ?? "this team member"} from this shift? Everyone else stays scheduled.`
                                            : "Delete this shift? This cannot be undone.";
                                          if (window.confirm(msg)) deleteMut.mutate({ id: j.id, employeeId: emp.id });
                                        }}
                                        className="w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-destructive/40 text-destructive text-[11px] font-medium py-1.5 hover:bg-destructive/10 disabled:opacity-50"
                                      >
                                        <Trash2 className="size-3" />
                                        {(j.assignees?.length ?? 0) > 1 ? "Remove from this person" : "Delete shift"}
                                      </button>
                                    </div>
                                  )}
                                </PopoverContent>
                              </Popover>
                            );
                          })}
                         {canManageSchedule && copiedShift && (
                           <button
                             type="button"
                             onClick={() => pasteShift(emp.id, d)}
                             disabled={dupMut.isPending}
                             title={`Paste "${copiedShift.label}" here`}
                             className="w-full rounded-md border border-dashed border-brand/60 text-brand text-[10px] font-medium py-1 inline-flex items-center justify-center gap-1 hover:bg-brand/10 transition disabled:opacity-50"
                           >
                             <ClipboardPaste className="size-3" /> Paste here
                           </button>
                         )}
                         {canManageSchedule && (
                           <button
                             onClick={() => setDialogSeed({ date: d, employeeId: emp.id })}
                            title={`Add a shift for ${emp.full_name ?? "this team member"}`}
                            className={
                              shifts.length === 0 && unavs.length === 0
                                ? "w-full h-full min-h-[100px] opacity-0 hover:opacity-100 grid place-items-center text-muted-foreground text-xs"
                                : "w-full rounded-md border border-dashed border-border/70 text-muted-foreground text-[10px] py-1 opacity-60 hover:opacity-100 hover:border-brand hover:text-brand transition"
                            }
                          >
                            + Add shift
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {/* Wages / hours footer */}
            <div className="grid w-full border-t-2 border-border" style={{ gridTemplateColumns: `minmax(112px, 1.15fr) repeat(7, minmax(0, 1fr))` }}>
              <div className="sticky left-0 z-10 px-2 py-2 bg-clay-50 border-r border-border/60">
                {canSeeWages && <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Wages</p>}
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Hours</p>
              </div>
              {dailyTotals.map((t) => (
                <div key={t.dayKey} className="min-w-0 px-1 py-2 border-l border-border/60 bg-clay-50 text-right tabular-nums overflow-hidden">
                  {canSeeWages && <p className="text-[10px] font-semibold truncate">${t.wages.toFixed(2)}</p>}
                  <p className="text-[10px] text-muted-foreground truncate">{t.hours.toFixed(2)}</p>
                </div>
              ))}
            </div>
          </ZoomPanSurface>

          <div className="mt-3 flex justify-end text-xs text-muted-foreground tabular-nums">
            <span>
              Week total:{" "}
              {canSeeWages && (
                <>
                  <span className="font-semibold text-foreground">${weekTotals.wages.toFixed(2)}</span> •{" "}
                </>
              )}
              {weekTotals.hours.toFixed(2)} hrs
            </span>
          </div>
        </div>
      ) : (
        <div className="max-w-4xl mx-auto w-full px-6 md:px-8 py-6 space-y-2">
          {jobs.length === 0 && <p className="text-sm text-muted-foreground">No jobs scheduled this week.</p>}
          {jobs.map((j: any) => (
            <Link key={j.id} to="/jobs/$jobId" params={{ jobId: j.id }} className="block bg-card rounded-lg ring-1 ring-black/5 p-4 hover:ring-brand/30 transition">
              <div className="flex items-center gap-4">
                <div className="w-24 shrink-0">
                  <p className="text-xs text-muted-foreground">{fmtDateTZ(j.scheduled_start, tz)}</p>
                  <p className="text-sm font-medium tabular-nums">{fmtTimeTZ(j.scheduled_start, tz)}</p>
                </div>
                <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ background: (j.service?.color ?? "#eee") + "22", color: j.service?.color ?? "#333" }}>
                  {j.service?.name}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{j.notes || [j.client?.first_name, j.client?.last_name].filter(Boolean).join(" ") || "—"}</p>
                  <p className="text-xs text-muted-foreground truncate">{j.client?.service_address ?? "—"}</p>
                </div>
                <div className="flex -space-x-1">
                  {j.assignees.slice(0, 3).map((a: any) => (
                    <div key={a.id} className="size-7 rounded-full bg-clay-200 grid place-items-center text-[10px] font-medium ring-2 ring-card">{initials(a.full_name)}</div>
                  ))}
                  {j.assignees.length === 0 && <span className="text-xs text-muted-foreground">Unassigned</span>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {dialogSeed && (
        <NewJobDialog
          date={dialogSeed.date}
          employeeId={dialogSeed.employeeId}
          onClose={() => setDialogSeed(null)}
        />
      )}
      {copiedShift && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-full bg-brand text-white text-xs font-medium pl-3 pr-1.5 py-1.5 shadow-lg">
          <ClipboardPaste className="size-3.5" />
          <span className="max-w-48 truncate">“{copiedShift.label}” copied — tap Paste here on any day</span>
          <button
            type="button"
            onClick={() => setCopiedShift(null)}
            className="rounded-full p-1 hover:bg-white/20"
            aria-label="Clear copied shift"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </>
  );
}

function NewJobDialog({ date, employeeId, onClose }: { date: Date; employeeId?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const tz = useBusinessTz();
  const clientsFn = useServerFn(listClients);
  const svcFn = useServerFn(listServiceTypes);
  const empFn = useServerFn(listEmployees);
  const create = useServerFn(createJob);
  const check = useServerFn(checkConflicts);
  const permsFn = useServerFn(myPermissions);

  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: () => clientsFn({}) });
  const { data: services = [] } = useQuery({ queryKey: ["services"], queryFn: () => svcFn({}) });
  const { data: employees = [] } = useQuery({ queryKey: ["employees"], queryFn: () => empFn({}) });
  const { data: perms } = useQuery({ queryKey: ["my-permissions"], queryFn: () => permsFn() });
  const canSeePricing = !!(perms?.isOwner || perms?.canViewPricing);

  const cleaners = useMemo(() => employees.filter((e: any) => e.role === "employee" || e.role === "manager" || e.role === "owner"), [employees]);

  const [clientId, setClientId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [assignees, setAssignees] = useState<string[]>(employeeId ? [employeeId] : []);
  const [startTime, setStartTime] = useState("09:00");
  const [dateStr, setDateStr] = useState(format(date, "yyyy-MM-dd"));
  const [endTime, setEndTime] = useState("11:00");
  const [priceCents, setPriceCents] = useState(0);
  const [notes, setNotes] = useState("");
  const [recur, setRecur] = useState<RecurrenceValue>(() => defaultRecurrence(format(date, "yyyy-MM-dd")));

  const [saving, setSaving] = useState(false);
  const [conflicts, setConflicts] = useState<{ employee_id: string }[] | null>(null);

  const selectedClient = clients.find((c: any) => c.id === clientId);
  const effDate = effectiveStartDate(recur, dateStr);
  const startISO = zonedToUTCISO(effDate, startTime, tz);
  const endBase = zonedToUTCISO(effDate, endTime, tz);
  // If the end time is at or before the start, treat it as the next day.
  const endISO = new Date(endBase).getTime() <= new Date(startISO).getTime()
    ? new Date(new Date(endBase).getTime() + 86_400_000).toISOString()
    : endBase;
  const lengthMin = Math.round((new Date(endISO).getTime() - new Date(startISO).getTime()) / 60_000);

  const addMinutesToTime = (time: string, mins: number) => {
    const [h, m] = time.split(":").map(Number);
    const total = ((h * 60 + m + mins) % 1440 + 1440) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  };

  const onSelectService = (id: string) => {
    setServiceId(id);
    const s = services.find((x: any) => x.id === id);
    if (s) {
      setEndTime(addMinutesToTime(startTime, s.default_duration_minutes));
      setPriceCents(s.default_price_cents);
    }
  };

  const toggleAssignee = (id: string) => {
    setAssignees((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setConflicts(null);
  };

  const doSave = async (force = false, addAnother = false) => {
    if (!clientId || !serviceId) { toast.error("Client and service required"); return; }
    setSaving(true);
    try {
      if (!force && assignees.length) {
        const res = await check({ data: { employee_ids: assignees, scheduled_start: startISO, scheduled_end: endISO } });
        if (res.conflicts.length) {
          setConflicts(res.conflicts);
          setSaving(false);
          return;
        }
      }
      await create({
        data: {
          client_id: clientId,
          service_type_id: serviceId,
          scheduled_start: startISO,
          scheduled_end: endISO,
          assigned_employee_ids: assignees,
          notes: notes || undefined,
          price_cents: priceCents,
          is_recurring: recur.mode === "recurring",
          recurrence_rule: recur.mode === "recurring" ? recur.rule : null,
          recurrence_end: recurrenceEndValue(recur, dateStr),
        },
      });
      toast.success(recur.mode === "recurring" ? "Recurring visits created" : "Job created");
      qc.invalidateQueries({ queryKey: ["jobs"] });
      if (addAnother) {
        // Keep date + assigned team members; clear the rest for the next shift.
        setConflicts(null);
        setClientId("");
        setServiceId("");
        setNotes("");
        setPriceCents(0);
        setStartTime(endTime);
        setEndTime(addMinutesToTime(endTime, 120));
        setRecur(defaultRecurrence(dateStr));
      } else {
        onClose();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Job</DialogTitle>
        </DialogHeader>

        {clients.length === 0 && (
          <div className="rounded-lg bg-warning/10 text-sm p-3">
            Add a client first. <Link to="/clients" className="font-medium text-brand hover:underline">Go to Clients →</Link>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Client">
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
              <option value="">Select…</option>
              {clients.map((c: any) => <option key={c.id} value={c.id}>{[c.first_name, c.last_name].filter(Boolean).join(" ")}</option>)}
            </select>
          </Field>
          <Field label="Service">
            <select value={serviceId} onChange={(e) => onSelectService(e.target.value)} className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
              <option value="">Select…</option>
              {services.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Service address">
            <Input value={selectedClient?.service_address ?? ""} disabled placeholder="From client record" />
          </Field>
          <Field label="Date">
            <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
          </Field>
          <Field label="Start time">
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </Field>
          <Field label="End time">
            <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              {(lengthMin / 60).toFixed(2).replace(/\.00$/, "")} hours
            </p>
          </Field>
          {canSeePricing && (
            <Field label="Price ($)">
              <Input type="number" min={0} step="0.01" value={(priceCents / 100).toFixed(2)} onChange={(e) => setPriceCents(Math.round(Number(e.target.value) * 100))} />
            </Field>
          )}
        </div>

        <div>
          <Label className="mb-2 block">Assigned cleaners</Label>
          <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto p-2 rounded-md border border-input">
            {cleaners.length === 0 && <p className="text-xs text-muted-foreground col-span-2">No employees yet.</p>}
            {cleaners.map((e: any) => (
              <label key={e.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={assignees.includes(e.id)} onCheckedChange={() => toggleAssignee(e.id)} />
                <span>{e.full_name ?? e.email}</span>
              </label>
            ))}
          </div>
        </div>

        <Field label="Notes">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Access code, special instructions…" />
        </Field>

        <RecurrenceFields value={recur} onChange={setRecur} startDate={dateStr} />


        {conflicts && conflicts.length > 0 && (
          <div className="rounded-md bg-destructive/10 text-destructive p-3 text-sm flex items-start gap-2">
            <AlertTriangle className="size-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">Scheduling conflict</p>
              <p className="text-xs">
                {conflicts.length} of the selected cleaners already have overlapping job(s). Save anyway?
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {conflicts && conflicts.length > 0 ? (
            <>
              <Button variant="outline" onClick={() => doSave(true, true)} disabled={saving}>
                Save anyway & add another
              </Button>
              <Button onClick={() => doSave(true)} disabled={saving} className="bg-destructive text-destructive-foreground hover:opacity-90">
                Save anyway
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => doSave(false, true)} disabled={saving}>
                {saving ? "Saving…" : "Save & add another"}
              </Button>
              <Button onClick={() => doSave(false)} disabled={saving} className="bg-brand text-brand-foreground hover:opacity-90">
                {saving ? "Saving…" : "Create job"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

/** Inline start/end time editor for a scheduled shift (business timezone). */
function EditTimesInline({
  tz,
  startISO,
  endISO,
  saving,
  onSave,
}: {
  tz: string;
  startISO: string;
  endISO: string;
  saving: boolean;
  onSave: (startISO: string, endISO: string) => void;
}) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const s = hourMinuteTZ(startISO, tz);
  const e = hourMinuteTZ(endISO, tz);
  const [day, setDay] = useState(() => dayKeyTZ(startISO, tz));
  const [start, setStart] = useState(`${pad(s.hour)}:${pad(s.minute)}`);
  const [end, setEnd] = useState(`${pad(e.hour)}:${pad(e.minute)}`);

  const submit = () => {
    const startUTC = zonedToUTCISO(day, start, tz);
    let endUTC = zonedToUTCISO(day, end, tz);
    if (new Date(endUTC) <= new Date(startUTC)) {
      // treat as overnight
      const next = new Date(new Date(`${day}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
      endUTC = zonedToUTCISO(next, end, tz);
    }
    onSave(startUTC, endUTC);
  };

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium inline-flex items-center gap-1">
        <Clock className="size-3" /> Edit times
      </p>
      <input
        type="date"
        value={day}
        onChange={(ev) => setDay(ev.target.value)}
        className="w-full rounded-md border border-input bg-background px-2 py-1 text-[11px]"
      />
      <div className="flex items-center gap-1.5">
        <input
          type="time"
          value={start}
          onChange={(ev) => setStart(ev.target.value)}
          className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-[11px]"
        />
        <span className="text-[11px] text-muted-foreground">to</span>
        <input
          type="time"
          value={end}
          onChange={(ev) => setEnd(ev.target.value)}
          className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-[11px]"
        />
      </div>
      <button
        type="button"
        disabled={saving}
        onClick={submit}
        className="w-full rounded-md bg-brand text-brand-foreground text-[11px] font-medium py-1.5 hover:opacity-90 disabled:opacity-50"
      >
        Save times
      </button>
    </div>
  );
}
