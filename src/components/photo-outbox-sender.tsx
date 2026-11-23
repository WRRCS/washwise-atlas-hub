import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { jobPhotoQueue, onJobPhotoSaved, type JobPhotoMeta } from "@/lib/job-photo-queue";
import { loadViewerOutbox, sendableOutboxJob, strandedLeavingJob, type OutboxRecord } from "@/lib/photo-outbox";
import { resumeAllPhotoQueues } from "@/lib/photo-upload-queue";

/**
 * Always-on helper for signed-in users: photos left on the phone (app closed,
 * no signal, or handed off from the Leaving screen) are put back in line and
 * sent as soon as signal returns, whichever page the cleaner is on.
 */
const OUTBOX_START_DELAY_MS = 3000;

export function PhotoOutboxSender() {
  const qc = useQueryClient();
  const [viewerId, setViewerId] = useState<string | null>(null);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data: { session } }) => setViewerId(session?.user.id ?? null));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setViewerId(session?.user.id ?? null));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => onJobPhotoSaved((jobId) => {
    void qc.invalidateQueries({ queryKey: ["job-photos", jobId] }, { cancelRefetch: false });
  }), [qc]);

  useEffect(() => {
    if (!viewerId) return;
    let cancelled = false;
    // Let the first screen open before the phone starts working through saved photos.
    const start = window.setTimeout(() => void loadViewerOutbox<JobPhotoMeta>(viewerId).then((kept) => {
      if (cancelled) return;
      const byJob = new Map<string, typeof kept>();
      for (const r of kept) {
        const jobId = sendableOutboxJob(r.scope, viewerId);
        if (!jobId) continue;
        byJob.set(jobId, [...(byJob.get(jobId) ?? []), r]);
      }
      for (const [jobId, records] of byJob) {
        jobPhotoQueue(viewerId, jobId).add(
          records.map((r) => ({ id: r.id, file: r.file, meta: r.meta, previewUrl: null })),
          { stored: true },
        );
      }
      void rescueLeavingPhotos(viewerId, kept, () => cancelled);
    }), OUTBOX_START_DELAY_MS);
    const timer = window.setInterval(() => { if (navigator.onLine !== false) resumeAllPhotoQueues(); }, 20_000);
    window.addEventListener("online", resumeAllPhotoQueues);
    return () => {
      cancelled = true;
      window.clearTimeout(start);
      window.clearInterval(timer);
      window.removeEventListener("online", resumeAllPhotoQueues);
    };
  }, [viewerId]);

  return null;
}

/** Sends Leaving-screen photos the cleaner can no longer reach (see strandedLeavingJob). */
async function rescueLeavingPhotos(viewerId: string, kept: OutboxRecord<JobPhotoMeta>[], isCancelled: () => boolean) {
  const leaving = kept.filter((r) => r.scope.endsWith(":leaving"));
  if (!leaving.length) return;
  const jobIds = Array.from(new Set(leaving.map((r) => r.scope.split(":")[1]).filter(Boolean)));
  const [open, jobs] = await Promise.all([
    supabase.from("time_entries").select("job_id").eq("user_id", viewerId).is("ended_at", null),
    supabase.from("jobs").select("id, status").in("id", jobIds),
  ]);
  // Without a clear answer (no signal), leave them on the Leaving screen for now.
  if (open.error || jobs.error || isCancelled()) return;
  const state = {
    openJobIds: new Set((open.data ?? []).map((r) => r.job_id)),
    finishedJobIds: new Set((jobs.data ?? []).filter((j) => j.status === "completed" || j.status === "canceled").map((j) => j.id)),
  };
  const byJob = new Map<string, OutboxRecord<JobPhotoMeta>[]>();
  for (const r of leaving) {
    const jobId = strandedLeavingJob(r, viewerId, state);
    if (jobId) byJob.set(jobId, [...(byJob.get(jobId) ?? []), r]);
  }
  for (const [jobId, records] of byJob) {
    // Not "stored": the phone copy is re-filed under the background sender (same id) until it is saved.
    jobPhotoQueue(viewerId, jobId).add(records.map((r) => ({
      id: r.id,
      file: r.file,
      previewUrl: null,
      meta: {
        photo_type: r.meta.photo_type ?? "after",
        taken_at: typeof r.meta.taken_at === "string" ? r.meta.taken_at : new Date(r.createdAt).toISOString(),
        caption: typeof r.meta.caption === "string" ? r.meta.caption : undefined,
      },
    })));
  }
}
