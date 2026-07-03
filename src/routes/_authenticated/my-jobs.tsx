import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/app-shell";
import { listMyJobs, clockIn, clockOut, listMyTimeEntries, type MyJobRow, type TimeEntryRow } from "@/lib/time.functions";
import { Play, Square, MapPin, Clock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/my-jobs")({
  component: MyJobsPage,
});

type Tab = "today" | "schedule" | "timesheet";

function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}
function clientName(c: MyJobRow["client"]) {
  if (!c) return "—";
  return `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "—";
}
function hoursBetween(a: string, b: string) {
  return (new Date(b).getTime() - new Date(a).getTime()) / 3600000;
}

function MyJobsPage() {
  const [tab, setTab] = useState<Tab>("today");
  return (
    <AppShell>
      <PageHeader title="My jobs" subtitle="Your assigned work and time tracking" />
      <div className="max-w-5xl w-full mx-auto px-6 md:px-8 py-6">
        <div className="flex gap-1 mb-6 bg-clay-100 p-1 rounded-lg w-fit">
          {(["today", "schedule", "timesheet"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                tab === t ? "bg-clay-50 text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "today" ? "Today & upcoming" : t === "schedule" ? "My schedule" : "My timesheet"}
            </button>
          ))}
        </div>
        {tab === "today" && <TodayView />}
        {tab === "schedule" && <ScheduleView />}
        {tab === "timesheet" && <TimesheetView />}
      </div>
    </AppShell>
  );
}

function TodayView() {
  const qc = useQueryClient();
  const list = useServerFn(listMyJobs);
  const doClockIn = useServerFn(clockIn);
  const doClockOut = useServerFn(clockOut);

  const from = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);
  const to = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);

  const q = useQuery({
    queryKey: ["my-jobs", from, to],
    queryFn: () => list({ data: { from, to } }),
  });

  const inM = useMutation({
    mutationFn: (job_id: string) => doClockIn({ data: { job_id } }),
    onSuccess: () => {
      toast.success("Clocked in");
      qc.invalidateQueries({ queryKey: ["my-jobs"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to clock in"),
  });

  const [outFor, setOutFor] = useState<{ entryId: string; startedAt: string } | null>(null);

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (q.error) return <p className="text-sm text-red-600">{(q.error as Error).message}</p>;
  const jobs = q.data ?? [];
  if (!jobs.length) return <p className="text-sm text-muted-foreground">No upcoming jobs assigned to you.</p>;

  // Group by day
  const groups = new Map<string, MyJobRow[]>();
  for (const j of jobs) {
    const key = new Date(j.scheduled_start).toDateString();
    const arr = groups.get(key) ?? [];
    arr.push(j);
    groups.set(key, arr);
  }

  return (
    <>
      <div className="space-y-6">
        {[...groups.entries()].map(([day, items]) => (
          <section key={day}>
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
              {new Date(items[0].scheduled_start).toDateString() === new Date().toDateString() ? "Today · " : ""}
              {fmtDate(items[0].scheduled_start)}
            </h2>
            <div className="space-y-3">
              {items.map((j) => (
                <article key={j.id} className="bg-clay-50 border border-border/60 rounded-xl p-4 ring-1 ring-black/5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="inline-block size-2 rounded-full"
                          style={{ background: j.service?.color ?? "hsl(var(--brand))" }}
                        />
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          {j.service?.name ?? "Service"}
                        </span>
                        <StatusPill status={j.status} />
                      </div>
                      <p className="font-medium">{clientName(j.client)}</p>
                      {j.client?.service_address && (
                        <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                          <MapPin className="size-3" /> {j.client.service_address}
                        </p>
                      )}
                      <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                        <Clock className="size-3" /> {fmtTime(j.scheduled_start)} – {fmtTime(j.scheduled_end)}
                      </p>
                      {j.notes && <p className="text-sm mt-2 text-muted-foreground italic">{j.notes}</p>}
                    </div>
                    <div className="shrink-0">
                      {j.open_entry ? (
                        <button
                          onClick={() =>
                            setOutFor({ entryId: j.open_entry!.id, startedAt: j.open_entry!.started_at })
                          }
                          className="inline-flex items-center gap-2 bg-orange-600 text-white text-sm font-medium rounded-lg px-3 py-2 hover:opacity-90"
                        >
                          <Square className="size-4" /> Clock out
                        </button>
                      ) : j.status === "scheduled" || j.status === "in_progress" ? (
                        <button
                          onClick={() => inM.mutate(j.id)}
                          disabled={inM.isPending}
                          className="inline-flex items-center gap-2 bg-brand text-brand-foreground text-sm font-medium rounded-lg px-3 py-2 hover:opacity-90 disabled:opacity-50"
                        >
                          <Play className="size-4" /> Clock in
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">Done</span>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
      {outFor && (
        <ClockOutDialog
          entryId={outFor.entryId}
          startedAt={outFor.startedAt}
          onClose={() => setOutFor(null)}
          onDone={async (notes) => {
            try {
              await doClockOut({ data: { entry_id: outFor.entryId, notes } });
              toast.success("Clocked out");
              qc.invalidateQueries({ queryKey: ["my-jobs"] });
              qc.invalidateQueries({ queryKey: ["my-timesheet"] });
              setOutFor(null);
            } catch (e: any) {
              toast.error(e.message ?? "Failed to clock out");
            }
          }}
        />
      )}
    </>
  );
}

function ClockOutDialog({
  entryId: _entryId,
  startedAt,
  onClose,
  onDone,
}: {
  entryId: string;
  startedAt: string;
  onClose: () => void;
  onDone: (notes: string) => Promise<void>;
}) {
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const hours = hoursBetween(startedAt, new Date().toISOString());
  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-clay-50 rounded-xl border border-border/60 w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-medium mb-1">Clock out</h3>
        <p className="text-sm text-muted-foreground mb-4">
          You worked <strong className="text-foreground">{hours.toFixed(2)} hours</strong> (since {fmtTime(startedAt)}).
        </p>
        <label className="block text-sm font-medium mb-1">Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-clay-50"
          placeholder="Anything worth noting?"
        />
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-2 text-sm rounded-lg hover:bg-clay-100">Cancel</button>
          <button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              await onDone(notes);
              setSaving(false);
            }}
            className="px-3 py-2 text-sm font-medium rounded-lg bg-brand text-brand-foreground disabled:opacity-50"
          >
            {saving ? "Saving…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: MyJobRow["status"] }) {
  const map: Record<MyJobRow["status"], string> = {
    scheduled: "bg-blue-100 text-blue-800",
    in_progress: "bg-orange-100 text-orange-800",
    completed: "bg-green-100 text-green-800",
    canceled: "bg-gray-100 text-gray-600",
  };
  const label = status === "in_progress" ? "In progress" : status[0].toUpperCase() + status.slice(1);
  return <span className={`text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded ${map[status]}`}>{label}</span>;
}

function ScheduleView() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const list = useServerFn(listMyJobs);
  const from = weekStart.toISOString();
  const toDate = new Date(weekStart);
  toDate.setDate(toDate.getDate() + 7);
  const to = toDate.toISOString();

  const q = useQuery({
    queryKey: ["my-jobs", "week", from],
    queryFn: () => list({ data: { from, to } }),
  });

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const jobsByDay = new Map<string, MyJobRow[]>();
  for (const j of q.data ?? []) {
    const k = new Date(j.scheduled_start).toDateString();
    const arr = jobsByDay.get(k) ?? [];
    arr.push(j);
    jobsByDay.set(k, arr);
  }

  const statusBg: Record<MyJobRow["status"], string> = {
    scheduled: "bg-blue-100 border-blue-300 text-blue-900",
    in_progress: "bg-orange-100 border-orange-300 text-orange-900",
    completed: "bg-green-100 border-green-300 text-green-900",
    canceled: "bg-gray-100 border-gray-300 text-gray-600",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const d = new Date(weekStart);
              d.setDate(d.getDate() - 7);
              setWeekStart(d);
            }}
            className="px-3 py-1.5 text-sm rounded-lg hover:bg-clay-100"
          >
            ‹
          </button>
          <button onClick={() => setWeekStart(startOfWeek(new Date()))} className="px-3 py-1.5 text-sm rounded-lg hover:bg-clay-100">
            Today
          </button>
          <button
            onClick={() => {
              const d = new Date(weekStart);
              d.setDate(d.getDate() + 7);
              setWeekStart(d);
            }}
            className="px-3 py-1.5 text-sm rounded-lg hover:bg-clay-100"
          >
            ›
          </button>
        </div>
        <span className="text-sm text-muted-foreground">
          {weekStart.toLocaleDateString([], { month: "short", day: "numeric" })} –{" "}
          {new Date(weekStart.getTime() + 6 * 86400000).toLocaleDateString([], { month: "short", day: "numeric" })}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-7 gap-2">
        {days.map((d) => {
          const items = jobsByDay.get(d.toDateString()) ?? [];
          const isToday = d.toDateString() === new Date().toDateString();
          return (
            <div key={d.toISOString()} className="border border-border/60 rounded-lg p-2 min-h-32 bg-clay-50">
              <div className={`text-xs font-medium mb-2 ${isToday ? "text-brand" : "text-muted-foreground"}`}>
                {d.toLocaleDateString([], { weekday: "short" })} {d.getDate()}
              </div>
              <div className="space-y-1.5">
                {items.map((j) => (
                  <div key={j.id} className={`text-xs px-2 py-1.5 rounded border ${statusBg[j.status]}`}>
                    <div className="font-medium">{fmtTime(j.scheduled_start)}</div>
                    <div className="truncate">{clientName(j.client)}</div>
                  </div>
                ))}
                {!items.length && <div className="text-[11px] text-muted-foreground/60">—</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimesheetView() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const list = useServerFn(listMyTimeEntries);
  const from = weekStart.toISOString();
  const toDate = new Date(weekStart);
  toDate.setDate(toDate.getDate() + 7);
  const to = toDate.toISOString();

  const q = useQuery({
    queryKey: ["my-timesheet", from],
    queryFn: () => list({ data: { from, to } }),
  });

  const entries = q.data ?? [];
  const totalHours = entries.reduce((sum, e) => (e.ended_at ? sum + hoursBetween(e.started_at, e.ended_at) : sum), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const d = new Date(weekStart);
              d.setDate(d.getDate() - 7);
              setWeekStart(d);
            }}
            className="px-3 py-1.5 text-sm rounded-lg hover:bg-clay-100"
          >
            ‹
          </button>
          <button onClick={() => setWeekStart(startOfWeek(new Date()))} className="px-3 py-1.5 text-sm rounded-lg hover:bg-clay-100">
            This week
          </button>
          <button
            onClick={() => {
              const d = new Date(weekStart);
              d.setDate(d.getDate() + 7);
              setWeekStart(d);
            }}
            className="px-3 py-1.5 text-sm rounded-lg hover:bg-clay-100"
          >
            ›
          </button>
        </div>
        <div className="text-sm">
          <span className="text-muted-foreground">Total: </span>
          <strong>{totalHours.toFixed(2)} hrs</strong>
        </div>
      </div>
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !entries.length ? (
        <p className="text-sm text-muted-foreground">No time entries this week.</p>
      ) : (
        <div className="border border-border/60 rounded-xl overflow-hidden bg-clay-50">
          <table className="w-full text-sm">
            <thead className="bg-clay-100 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2">Date</th>
                <th className="text-left px-4 py-2">Client</th>
                <th className="text-left px-4 py-2">Clock in</th>
                <th className="text-left px-4 py-2">Clock out</th>
                <th className="text-right px-4 py-2">Hours</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e: TimeEntryRow) => (
                <tr key={e.id} className="border-t border-border/60">
                  <td className="px-4 py-2">{fmtDate(e.started_at)}</td>
                  <td className="px-4 py-2">
                    {e.job?.client ? `${e.job.client.first_name ?? ""} ${e.job.client.last_name ?? ""}`.trim() : "—"}
                  </td>
                  <td className="px-4 py-2">{fmtTime(e.started_at)}</td>
                  <td className="px-4 py-2">
                    {e.ended_at ? fmtTime(e.ended_at) : <span className="text-orange-600">In progress</span>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {e.ended_at ? hoursBetween(e.started_at, e.ended_at).toFixed(2) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
