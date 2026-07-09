import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getJob, toggleSopItem, updateJobStatus } from "@/lib/jobs.functions";
import { listJobGps } from "@/lib/time.functions";
import { listJobPhotos, logPhotoShare, deleteJobPhoto, type JobPhotoRow } from "@/lib/photos.functions";
import { PageHeader } from "@/components/app-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SopViewer } from "@/components/sop-viewer";
import { JobGpsMap } from "@/components/job-gps-map";
import { format } from "date-fns";
import { Check, Send, Trash2, X } from "lucide-react";
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
          <Tabs defaultValue="sop">
            <TabsList>
              <TabsTrigger value="sop">SOP Checklist</TabsTrigger>
              <TabsTrigger value="sop-doc">SOP</TabsTrigger>
              <TabsTrigger value="photos">Photos</TabsTrigger>
              <TabsTrigger value="gps">Location</TabsTrigger>
            </TabsList>
            <TabsContent value="sop" className="mt-4">
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
            </TabsContent>
            <TabsContent value="sop-doc" className="mt-4">
              <SopViewer serviceTypeId={job.service?.id ?? null} />
            </TabsContent>
            <TabsContent value="photos" className="mt-4">
              <PhotosTab jobId={jobId} />
            </TabsContent>
            <TabsContent value="gps" className="mt-4">
              <GpsTab jobId={jobId} />
            </TabsContent>
          </Tabs>
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
            {job.assignees && job.assignees.length ? (
              <ul className="space-y-1">{job.assignees.map((a: any) => <li key={a.id} className="text-sm">{a.full_name ?? "—"}</li>)}</ul>
            ) : <p className="text-sm text-muted-foreground">Unassigned</p>}
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

function PhotosTab({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listJobPhotos);
  const shareFn = useServerFn(logPhotoShare);
  const delFn = useServerFn(deleteJobPhoto);
  const [lightbox, setLightbox] = useState<JobPhotoRow | null>(null);

  const { data: photos = [], isLoading } = useQuery({
    queryKey: ["job-photos", jobId],
    queryFn: () => listFn({ data: { job_id: jobId } }),
  });

  const onShare = async (p: JobPhotoRow) => {
    try {
      await shareFn({ data: { photo_id: p.id } });
      toast.success("Share logged — email will send once wired up");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };
  const onDelete = async (p: JobPhotoRow) => {
    if (!confirm("Delete this photo?")) return;
    try {
      await delFn({ data: { id: p.id } });
      qc.invalidateQueries({ queryKey: ["job-photos", jobId] });
      toast.success("Deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!photos.length) return <p className="text-sm text-muted-foreground">No photos yet.</p>;

  const typeBadge: Record<string, string> = {
    before: "bg-blue-100 text-blue-800",
    after: "bg-green-100 text-green-800",
    other: "bg-clay-200 text-muted-foreground",
  };

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {photos.map((p) => (
          <div key={p.id} className="group relative rounded-lg overflow-hidden ring-1 ring-black/5 bg-clay-100">
            <button
              type="button"
              onClick={() => setLightbox(p)}
              className="block w-full aspect-square"
            >
              {p.url ? (
                <img src={p.url} alt={p.caption ?? ""} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full grid place-items-center text-xs text-muted-foreground">No preview</div>
              )}
            </button>
            <div className="p-2 space-y-1">
              <div className="flex items-center justify-between gap-1">
                <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-medium ${typeBadge[p.photo_type]}`}>
                  {p.photo_type}
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => onShare(p)}
                    className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded bg-brand text-brand-foreground hover:opacity-90"
                  >
                    <Send className="size-3" /> Send to client
                  </button>
                  <button
                    onClick={() => onDelete(p)}
                    className="p-1 text-muted-foreground hover:text-destructive"
                    aria-label="Delete"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
              {p.caption && <p className="text-xs text-muted-foreground truncate">{p.caption}</p>}
              <p className="text-[10px] text-muted-foreground">
                {p.uploader_name ?? "—"} · {format(new Date(p.uploaded_at), "MMM d, h:mma")}
              </p>
            </div>
          </div>
        ))}
      </div>
      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/80 grid place-items-center p-4" onClick={() => setLightbox(null)}>
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 text-white/80 hover:text-white"
            aria-label="Close"
          >
            <X className="size-6" />
          </button>
          <div className="max-w-4xl max-h-full flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
            {lightbox.url && <img src={lightbox.url} alt={lightbox.caption ?? ""} className="max-h-[80vh] rounded-lg" />}
            {lightbox.caption && <p className="text-white text-sm text-center">{lightbox.caption}</p>}
          </div>
        </div>
      )}
    </>
  );
}

function GpsTab({ jobId }: { jobId: string }) {
  const fetchGps = useServerFn(listJobGps);
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["job-gps", jobId],
    queryFn: () => fetchGps({ data: { job_id: jobId } }),
  });
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const withGps = entries.filter(
    (e) => e.clock_in_latitude !== null || e.clock_out_latitude !== null,
  );
  if (!withGps.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No GPS coordinates recorded. Enable "Track employee GPS on clock-in" in Business profile to start capturing
        location.
      </p>
    );
  }
  return <JobGpsMap entries={withGps} />;
}
