/**
 * One background sender for every cleaner photo, wherever it was taken
 * (appointment Photos tab or the Leaving screen). Photos are kept on the phone
 * until the server has them and resend themselves when signal returns.
 */
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { translateNow as t } from "@/lib/i18n";
import { photoUploadQueue, type UploadQueue } from "@/lib/photo-upload-queue";
import { deleteOutboxItems, outboxScope, saveOutboxItem } from "@/lib/photo-outbox";
import { createJobPhotoUploadUrl, finishPhotoUploadBatch, registerJobPhoto, type PhotoType } from "@/lib/photos.functions";

export type JobPhotoMeta = {
  photo_type: PhotoType;
  taken_at: string;
  caption?: string;
  /** Taken on the Leaving screen: also attached to the "cleaning is complete" draft. */
  leaving?: boolean;
};

const savedListeners = new Set<(jobId: string) => void>();
/** Lets the app refresh photo lists when a background photo is saved. */
export function onJobPhotoSaved(fn: (jobId: string) => void) {
  savedListeners.add(fn);
  return () => { savedListeners.delete(fn); };
}
const notifySaved = (jobId: string) => savedListeners.forEach((fn) => fn(jobId));

// Weak signal can fail the same photos over and over; one warning a minute is enough.
let lastFailureToast = 0;
function warnFailed(message: string) {
  const now = Date.now();
  if (now - lastFailureToast < 60_000) return;
  lastFailureToast = now;
  toast.error(`${t("Failed to save photo")}: ${message}`);
}

const leavingSaved = new Set<string>();

export function jobPhotoQueue(viewerId: string, jobId: string): UploadQueue<JobPhotoMeta> {
  const scope = outboxScope(viewerId, jobId);
  return photoUploadQueue<JobPhotoMeta>(scope, {
    upload: async (item) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user.id !== viewerId) {
        throw Object.assign(new Error(t("Your login changed. Please reopen the appointment and upload again.")), { permanent: true });
      }
      const file = item.file as File;
      const { path, token } = await createJobPhotoUploadUrl({ data: { job_id: jobId, file_name: file.name || "photo.jpg" } });
      const { error } = await supabase.storage.from("job-photos").uploadToSignedUrl(path, token, file, { contentType: file.type || "image/jpeg" });
      if (error) throw new Error(error.message);
      const saved = await registerJobPhoto({
        data: {
          job_id: jobId,
          storage_path: path,
          photo_type: item.meta.photo_type,
          taken_at: item.meta.taken_at,
          caption: item.meta.caption?.trim() || undefined,
        },
      });
      if (item.meta.leaving) leavingSaved.add(saved.id);
      return saved.id;
    },
    onSaved: () => notifySaved(jobId),
    onFailed: warnFailed,
    storage: {
      save: (item) => saveOutboxItem({ id: item.id, scope, viewerId, file: item.file as Blob, meta: item.meta, createdAt: Date.now() }),
      drop: (id) => deleteOutboxItems([id]),
    },
    onStorageError: () => toast.error(t("Couldn't keep this photo on the phone — send it before closing the app.")),
    onDrained: (ids) => {
      notifySaved(jobId);
      toast.success(ids.length === 1 ? t("Photo saved") : `${ids.length} ${t("photos saved")}`);
      const draftIds = ids.filter((id) => leavingSaved.has(id));
      draftIds.forEach((id) => leavingSaved.delete(id));
      void finishPhotoUploadBatch({ data: { job_id: jobId, photo_ids: ids, draft_photo_ids: draftIds } })
        .catch(() => toast.error(t("Photos saved, but the owner email could not be prepared.")));
    },
  });
}
