import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { listJobs, createJob, checkConflicts } from "@/lib/jobs.functions";
import { listClients, listServiceTypes, listEmployees } from "@/lib/entities.functions";
import { startOfWeek, addDays, format, startOfDay, endOfDay, isSameDay } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/calendar")({
  component: SchedulePage,
  errorComponent: ({ error }) => <div className="p-8 text-sm text-destructive">{error.message}</div>,
});

type View = "week" | "list";

function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

function SchedulePage() {
  const [anchor, setAnchor] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [view, setView] = useState<View>("week");
  const [dialogDate, setDialogDate] = useState<Date | null>(null);

  const fn = useServerFn(listJobs);
  const from = startOfDay(anchor).toISOString();
  const to = endOfDay(addDays(anchor, 6)).toISOString();
  const { data = [] } = useQuery({
    queryKey: ["jobs", "week", from, to],
    queryFn: () => fn({ data: { from, to } }),
  });

  const days = Array.from({ length: 7 }, (_, i) => addDays(anchor, i));

  return (
    <>
      <PageHeader
        title="Schedule"
        subtitle={`${format(anchor, "MMM d")} — ${format(addDays(anchor, 6), "MMM d, yyyy")}`}
        action={
          <div className="flex flex-wrap gap-2 items-center">
            <div className="inline-flex rounded-lg border border-border/60 p-0.5 bg-clay-100">
              <button onClick={() => setView("week")} className={`px-3 py-1 text-xs rounded ${view === "week" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}>Week</button>
              <button onClick={() => setView("list")} className={`px-3 py-1 text-xs rounded ${view === "list" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}>List</button>
            </div>
            <Button variant="outline" size="sm" onClick={() => setAnchor(addDays(anchor, -7))}>←</Button>
            <Button variant="outline" size="sm" onClick={() => setAnchor(startOfWeek(new Date(), { weekStartsOn: 1 }))}>Today</Button>
            <Button variant="outline" size="sm" onClick={() => setAnchor(addDays(anchor, 7))}>→</Button>
            <Button size="sm" className="bg-brand text-brand-foreground hover:opacity-90" onClick={() => setDialogDate(new Date())}>
              <Plus className="size-4" /> New Job
            </Button>
          </div>
        }
      />

      {view === "week" ? (
        <div className="max-w-7xl mx-auto w-full px-6 md:px-8 py-6 grid grid-cols-1 md:grid-cols-7 gap-3">
          {days.map((d) => {
            const dayJobs = data.filter((j) => isSameDay(new Date(j.scheduled_start), d));
            const today = isSameDay(d, new Date());
            return (
              <div key={d.toISOString()} className={`bg-card rounded-xl ring-1 ring-black/5 p-3 min-h-[220px] flex flex-col ${today ? "ring-brand/40" : ""}`}>
                <div className="mb-3 flex items-start justify-between">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{format(d, "EEE")}</p>
                    <p className={`text-lg font-medium ${today ? "text-brand" : ""}`}>{format(d, "d")}</p>
                  </div>
                  <button
                    onClick={() => setDialogDate(d)}
                    className="size-6 rounded-md hover:bg-clay-200 text-muted-foreground grid place-items-center"
                    aria-label="Add job"
                  >
                    <Plus className="size-3.5" />
                  </button>
                </div>
                <div className="space-y-2 flex-1">
                  {dayJobs.map((j) => (
                    <JobCard key={j.id} job={j} />
                  ))}
                  {dayJobs.length === 0 && <p className="text-[11px] text-muted-foreground">No jobs</p>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="max-w-4xl mx-auto w-full px-6 md:px-8 py-6 space-y-2">
          {data.length === 0 && <p className="text-sm text-muted-foreground">No jobs scheduled this week.</p>}
          {data.map((j) => (
            <Link key={j.id} to="/jobs/$jobId" params={{ jobId: j.id }} className="block bg-card rounded-lg ring-1 ring-black/5 p-4 hover:ring-brand/30 transition">
              <div className="flex items-center gap-4">
                <div className="w-24 shrink-0">
                  <p className="text-xs text-muted-foreground">{format(new Date(j.scheduled_start), "EEE MMM d")}</p>
                  <p className="text-sm font-medium tabular-nums">{format(new Date(j.scheduled_start), "h:mma")}</p>
                </div>
                <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ background: (j.service?.color ?? "#eee") + "22", color: j.service?.color ?? "#333" }}>
                  {j.service?.name}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{[j.client?.first_name, j.client?.last_name].filter(Boolean).join(" ") || "—"}</p>
                  <p className="text-xs text-muted-foreground truncate">{j.client?.service_address ?? "—"}</p>
                </div>
                <div className="flex -space-x-1">
                  {j.assignees.slice(0, 3).map((a) => (
                    <div key={a.id} className="size-7 rounded-full bg-clay-200 grid place-items-center text-[10px] font-medium ring-2 ring-card">{initials(a.full_name)}</div>
                  ))}
                  {j.assignees.length === 0 && <span className="text-xs text-muted-foreground">Unassigned</span>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {dialogDate && (
        <NewJobDialog date={dialogDate} onClose={() => setDialogDate(null)} />
      )}
    </>
  );
}

function JobCard({ job }: { job: any }) {
  const color = job.service?.color ?? "#8b8b8b";
  return (
    <Link to="/jobs/$jobId" params={{ jobId: job.id }} className="block p-2 rounded-md bg-clay-100 hover:bg-clay-200/70 text-xs border-l-2" style={{ borderLeftColor: color }}>
      <p className="font-medium truncate">{format(new Date(job.scheduled_start), "h:mma")} · {job.service?.name}</p>
      <p className="text-muted-foreground truncate">{[job.client?.first_name, job.client?.last_name].filter(Boolean).join(" ") || "—"}</p>
      <div className="flex items-center gap-1 mt-1">
        {job.assignees.slice(0, 3).map((a: any) => (
          <span key={a.id} className="text-[9px] px-1.5 py-0.5 rounded-full bg-background">{initials(a.full_name)}</span>
        ))}
        {job.is_recurring && <span className="text-[9px] text-muted-foreground">↻</span>}
      </div>
    </Link>
  );
}

function NewJobDialog({ date, onClose }: { date: Date; onClose: () => void }) {
  const qc = useQueryClient();
  const clientsFn = useServerFn(listClients);
  const svcFn = useServerFn(listServiceTypes);
  const empFn = useServerFn(listEmployees);
  const create = useServerFn(createJob);
  const check = useServerFn(checkConflicts);

  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: () => clientsFn({}) });
  const { data: services = [] } = useQuery({ queryKey: ["services"], queryFn: () => svcFn({}) });
  const { data: employees = [] } = useQuery({ queryKey: ["employees"], queryFn: () => empFn({}) });

  const cleaners = useMemo(() => employees.filter((e: any) => e.role === "employee" || e.role === "owner"), [employees]);

  const [clientId, setClientId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [assignees, setAssignees] = useState<string[]>([]);
  const [startTime, setStartTime] = useState("09:00");
  const [dateStr, setDateStr] = useState(format(date, "yyyy-MM-dd"));
  const [durationMin, setDurationMin] = useState(120);
  const [priceCents, setPriceCents] = useState(0);
  const [notes, setNotes] = useState("");
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrence, setRecurrence] = useState<"weekly" | "biweekly" | "monthly">("weekly");
  const [recurrenceEnd, setRecurrenceEnd] = useState(format(addDays(date, 90), "yyyy-MM-dd"));
  const [saving, setSaving] = useState(false);
  const [conflicts, setConflicts] = useState<{ employee_id: string }[] | null>(null);

  const selectedClient = clients.find((c: any) => c.id === clientId);
  const startISO = new Date(`${dateStr}T${startTime}`).toISOString();
  const endISO = new Date(new Date(`${dateStr}T${startTime}`).getTime() + durationMin * 60_000).toISOString();

  const onSelectService = (id: string) => {
    setServiceId(id);
    const s = services.find((x: any) => x.id === id);
    if (s) {
      setDurationMin(s.default_duration_minutes);
      setPriceCents(s.default_price_cents);
    }
  };

  const toggleAssignee = (id: string) => {
    setAssignees((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setConflicts(null);
  };

  const doSave = async (force = false) => {
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
          is_recurring: isRecurring,
          recurrence_rule: isRecurring ? recurrence : null,
          recurrence_end: isRecurring ? recurrenceEnd : null,
        },
      });
      toast.success(isRecurring ? "Recurring jobs created" : "Job created");
      qc.invalidateQueries({ queryKey: ["jobs"] });
      onClose();
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
          <Field label="Duration (min)">
            <Input type="number" min={15} step={15} value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))} />
          </Field>
          <Field label="Price ($)">
            <Input type="number" min={0} step="0.01" value={(priceCents / 100).toFixed(2)} onChange={(e) => setPriceCents(Math.round(Number(e.target.value) * 100))} />
          </Field>
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

        <div className="rounded-md border border-input p-3 space-y-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={isRecurring} onCheckedChange={(v) => setIsRecurring(Boolean(v))} />
            <span>Recurring job</span>
          </label>
          {isRecurring && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Frequency">
                <select value={recurrence} onChange={(e) => setRecurrence(e.target.value as any)} className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Bi-weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </Field>
              <Field label="Repeat until">
                <Input type="date" value={recurrenceEnd} onChange={(e) => setRecurrenceEnd(e.target.value)} />
              </Field>
            </div>
          )}
        </div>

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
            <Button onClick={() => doSave(true)} disabled={saving} className="bg-destructive text-destructive-foreground hover:opacity-90">
              Save anyway
            </Button>
          ) : (
            <Button onClick={() => doSave(false)} disabled={saving} className="bg-brand text-brand-foreground hover:opacity-90">
              {saving ? "Saving…" : "Create job"}
            </Button>
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
