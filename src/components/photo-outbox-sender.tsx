import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { jobPhotoQueue, onJobPhotoSaved, type JobPhotoMeta } from "@/lib/job-photo-queue";
import { loadViewerOutbox, sendableOutboxJob } from "@/lib/photo-outbox";
import { resumeAllPhotoQueues } from "@/lib/photo-upload-queue";

/**
 * Always-on helper for signed-in users: photos left on the phone (app closed,
 * no signal, or handed off from the Leaving screen) are put back in line and
 * sent as soon as signal returns, whichever page the cleaner is on.
 */
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
    void loadViewerOutbox<JobPhotoMeta>(viewerId).then((kept) => {
      if (cancelled) return;
      const byJob = new Map<string, typeof kept>();
      for (const r of kept) {
        const jobId = sendableOutboxJob(r.scope, viewerId);
        if (!jobId) continue;
        byJob.set(jobId, [...(byJob.get(jobId) ?? []), r]);
      }
      for (const [jobId, records] of byJob) {
        jobPhotoQueue(viewerId, jobId).add(
          records.map((r) => ({ id: r.id, file: r.file, meta: r.meta, previewUrl: URL.createObjectURL(r.file) })),
          { stored: true },
        );
      }
    });
    const timer = window.setInterval(() => { if (navigator.onLine !== false) resumeAllPhotoQueues(); }, 20_000);
    window.addEventListener("online", resumeAllPhotoQueues);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("online", resumeAllPhotoQueues);
    };
  }, [viewerId]);

  return null;
}
