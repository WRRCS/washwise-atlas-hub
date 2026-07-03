import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getJob, toggleSopItem, updateJobStatus } from "@/lib/jobs.functions";
import { PageHeader } from "@/components/app-shell";
import { format } from "date-fns";
import { Check } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/jobs/$jobId")({
  component: JobDetail,
  errorComponent: ({ error }) => <div className="p-8 text-sm text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-8">Job not found.</div>,
});

function fmtCents(c: number) { return `$${(c / 100).toFixed(2)}`; }

function JobDetail() {
  const { jobId } = useParams({ from: "/_authenticated/jobs/$jobId" });
  const qc = useQueryClient();
  const fetchJob = useServerFn(getJob);
  const toggle = useServerFn(toggleSopItem);
  const setStatus = useServerFn(updateJobStatus);

  const { data: job, isLoading } = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => fetchJob({ data: { id: jobId } }),
  });

  if (isLoading) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  if (!job) return <div className="p-8">Not found.</div>;

  const sop = (job.sop ?? []).slice().sort((a, b) => a.position - b.position);
  const done = sop.filter((s) => s.completed).length;

  const onToggle = async (id: string, completed: boolean) => {
    await toggle({ data: { id, completed } });
    qc.invalidateQueries({ queryKey: ["job", jobId] });
  };
  const onStatus = async (status: "in_progress" | "completed" | "canceled") => {
    if (status === "canceled" && !confirm("Cancel this job?")) return;
    await setStatus({ data: { id: jobId, status } });
    toast.success(status === "completed" ? "Job completed" : status === "canceled" ? "Job canceled" : "Job started");
    qc.invalidateQueries({ queryKey: ["job", jobId] });
    qc.invalidateQueries({ queryKey: ["jobs"] });
  };


  return (
    <>
      <PageHeader
        title={job.service?.name ?? "Job"}
        subtitle={`${job.client?.service_address ?? "No address"} · ${format(new Date(job.scheduled_start), "PPp")}`}
        action={
          <div className="flex gap-2">
            {job.status === "scheduled" && (
              <button onClick={() => onStatus("in_progress")} className="text-sm font-medium bg-brand text-brand-foreground rounded-lg px-3 py-2 hover:opacity-90">Start job</button>
            )}
            {job.status !== "completed" && job.status !== "canceled" && (
              <button onClick={() => onStatus("completed")} className="text-sm font-medium bg-foreground text-background rounded-lg px-3 py-2 hover:opacity-90">Complete</button>
            )}
            {job.status !== "canceled" && job.status !== "completed" && (
              <button onClick={() => onStatus("canceled")} className="text-sm font-medium border border-destructive/40 text-destructive rounded-lg px-3 py-2 hover:bg-destructive/5">Cancel job</button>
            )}
          </div>
        }
      />

      <div className="max-w-4xl mx-auto w-full px-6 md:px-8 py-8 grid md:grid-cols-3 gap-8">
        <section className="md:col-span-2 bg-card p-6 rounded-xl ring-1 ring-black/5">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-semibold">SOP Checklist</h3>
            <span className="text-xs text-muted-foreground">{done} / {sop.length} complete</span>
          </div>
          {sop.length === 0 ? (
            <p className="text-sm text-muted-foreground">No checklist items for this service.</p>
          ) : (
            <ul className="space-y-3">
              {sop.map((s) => (
                <li key={s.id} className="flex items-start gap-3">
                  <button
                    onClick={() => onToggle(s.id, !s.completed)}
                    className={`size-4 mt-0.5 rounded border-2 shrink-0 grid place-items-center transition-colors ${
                      s.completed ? "border-brand bg-brand" : "border-input hover:border-brand/50"
                    }`}
                  >
                    {s.completed && <Check className="size-3 text-brand-foreground" strokeWidth={3} />}
                  </button>
                  <span className={`text-sm ${s.completed ? "text-muted-foreground line-through" : "text-foreground"}`}>{s.label}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <aside className="space-y-6">
          <div className="bg-card p-5 rounded-xl ring-1 ring-black/5 space-y-3">
            <h4 className="text-xs uppercase tracking-wider text-muted-foreground">Client</h4>
            <div>
              <p className="text-sm font-medium">{[job.client?.first_name, job.client?.last_name].filter(Boolean).join(" ") || "—"}</p>
              <p className="text-xs text-muted-foreground">{job.client?.email ?? "—"}</p>
              <p className="text-xs text-muted-foreground">{job.client?.phone ?? "—"}</p>
            </div>
          </div>
          <div className="bg-card p-5 rounded-xl ring-1 ring-black/5 space-y-3">
            <h4 className="text-xs uppercase tracking-wider text-muted-foreground">Service address</h4>
            <p className="text-sm whitespace-pre-wrap">{job.client?.service_address ?? "—"}</p>
          </div>
          <div className="bg-card p-5 rounded-xl ring-1 ring-black/5 space-y-3">
            <h4 className="text-xs uppercase tracking-wider text-muted-foreground">Assignment</h4>
            <p className="text-sm">{job.assignee?.full_name ?? "Unassigned"}</p>
            <p className="text-xs text-muted-foreground tabular-nums">Price · {fmtCents(job.price_cents)}</p>
          </div>
          {job.notes && (
            <div className="bg-card p-5 rounded-xl ring-1 ring-black/5">
              <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Notes</h4>
              <p className="text-sm whitespace-pre-wrap">{job.notes}</p>
            </div>
          )}
          <Link to="/jobs" className="block text-center text-sm text-muted-foreground hover:text-foreground">← Back to queue</Link>
        </aside>
      </div>
    </>
  );
}
