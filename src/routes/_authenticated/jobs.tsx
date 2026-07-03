import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, PageHeader, BrandButton } from "@/components/app-shell";
import { listJobs } from "@/lib/jobs.functions";
import { format, startOfDay, endOfDay, addDays, startOfWeek, isSameDay } from "date-fns";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/jobs")({
  component: JobsPage,
  errorComponent: ({ error }) => (
    <AppShell><div className="p-8 text-sm text-destructive">Failed to load jobs: {error.message}</div></AppShell>
  ),
});

const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  scheduled: { dot: "bg-muted-foreground/40", label: "Scheduled" },
  in_progress: { dot: "bg-success", label: "In Progress" },
  completed: { dot: "bg-brand", label: "Completed" },
  canceled: { dot: "bg-destructive", label: "Canceled" },
};

function fmtClient(c: { first_name: string | null; last_name: string | null } | null) {
  if (!c) return "—";
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || "—";
}
function fmtCents(c: number) {
  return `$${(c / 100).toFixed(2)}`;
}

function JobsPage() {
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(new Date()));
  const fetchJobs = useServerFn(listJobs);
  const dayKey = selectedDay.toISOString().slice(0, 10);
  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["jobs", dayKey],
    queryFn: () => fetchJobs({ data: { from: startOfDay(selectedDay).toISOString(), to: endOfDay(selectedDay).toISOString() } }),
  });

  const weekStart = startOfWeek(selectedDay, { weekStartsOn: 1 });
  const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const remaining = jobs.filter((j) => j.status !== "completed" && j.status !== "canceled").length;

  return (
    <>
      <PageHeader
        title={format(selectedDay, "EEEE, MMM d")}
        action={
          <Link to="/jobs/new" className="inline-flex items-center gap-2 bg-brand text-brand-foreground text-sm font-medium rounded-lg px-3 py-2 hover:opacity-90 transition-opacity">
            + New Job
          </Link>
        }
      />
      <div className="max-w-6xl mx-auto w-full px-6 md:px-8 py-4">
        <div className="flex gap-2 md:gap-3">
          {week.map((d) => {
            const active = isSameDay(d, selectedDay);
            return (
              <button
                key={d.toISOString()}
                onClick={() => setSelectedDay(startOfDay(d))}
                className={`flex-1 flex flex-col items-center py-2 rounded-lg border transition-colors ${
                  active ? "border-border/60 bg-clay-100" : "border-transparent hover:border-border/60"
                }`}
              >
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{format(d, "EEE")}</span>
                <span className={`text-base font-medium ${active ? "text-brand" : ""}`}>{format(d, "d")}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 max-w-6xl mx-auto w-full px-6 md:px-8 pb-12">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Today's Queue</h2>
          <span className="text-xs text-muted-foreground">{remaining} job{remaining === 1 ? "" : "s"} remaining</span>
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : jobs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <p className="text-sm text-muted-foreground mb-4">No jobs scheduled for this day.</p>
            <Link to="/jobs/new" className="text-sm font-medium text-brand hover:underline">Create the first one →</Link>
          </div>
        ) : (
          <div className="space-y-4">
            {jobs.map((job) => {
              const status = STATUS_STYLES[job.status] ?? STATUS_STYLES.scheduled;
              return (
                <Link
                  key={job.id}
                  to="/jobs/$jobId"
                  params={{ jobId: job.id }}
                  className="block group bg-card p-5 rounded-xl ring-1 ring-black/5 hover:ring-brand/30 transition-all cursor-pointer"
                >
                  <div className="flex justify-between items-start mb-4 gap-4">
                    <div className="min-w-0">
                      <span className="inline-block px-2 py-0.5 rounded-full bg-brand/10 text-brand text-[10px] font-medium uppercase tracking-wider mb-2">
                        {job.service?.name ?? "Service"}
                      </span>
                      <h3 className="text-lg font-medium truncate">{fmtAddress(job.property)}</h3>
                      <p className="text-sm text-muted-foreground truncate">
                        Client: {job.client?.name ?? "—"} · {format(new Date(job.scheduled_start), "h:mm a")} — {format(new Date(job.scheduled_end), "h:mm a")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right mr-2">
                        <p className="text-xs text-muted-foreground">Cleaner</p>
                        <p className="text-sm font-medium">{job.assignee?.full_name ?? "Unassigned"}</p>
                      </div>
                      <div className="size-10 rounded-full bg-clay-200 grid place-items-center text-xs font-medium">
                        {(job.assignee?.full_name ?? "?").slice(0, 1).toUpperCase()}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-4 border-t border-border/60 text-xs">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <div className={`size-1.5 rounded-full ${status.dot}`} />
                      {status.label}
                    </span>
                    <span className="text-muted-foreground tabular-nums">{fmtCents(job.price_cents)}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
