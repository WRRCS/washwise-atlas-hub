import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { getSopForServiceType, markSopReviewed, getLatestSopReview, type SopDetail } from "@/lib/sops.functions";
import { format } from "date-fns";
import { Check, Download, FileText, X, ImageIcon } from "lucide-react";

/**
 * Displays the active SOP for a service type. Optionally lets an employee
 * mark the SOP reviewed (scoped to a specific job).
 */
export function SopViewer({
  serviceTypeId,
  jobId,
  allowMarkReviewed = false,
}: {
  serviceTypeId: string | null | undefined;
  jobId?: string;
  allowMarkReviewed?: boolean;
}) {
  const fetchSop = useServerFn(getSopForServiceType);
  const fetchReview = useServerFn(getLatestSopReview);
  const markFn = useServerFn(markSopReviewed);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const sopQ = useQuery({
    queryKey: ["sop-for-service", serviceTypeId],
    queryFn: () => fetchSop({ data: { service_type_id: serviceTypeId! } }),
    enabled: !!serviceTypeId,
  });

  const sop = sopQ.data as SopDetail | null | undefined;

  const reviewQ = useQuery({
    queryKey: ["sop-review", sop?.id, jobId],
    queryFn: () => fetchReview({ data: { sop_id: sop!.id, job_id: jobId ?? null } }),
    enabled: allowMarkReviewed && !!sop?.id,
  });

  const onMarkReviewed = async () => {
    if (!sop) return;
    try {
      await markFn({ data: { sop_id: sop.id, job_id: jobId ?? null } });
      toast.success("SOP marked reviewed");
      reviewQ.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  if (!serviceTypeId) return <p className="text-sm text-muted-foreground">No service type on this job.</p>;
  if (sopQ.isLoading) return <p className="text-sm text-muted-foreground">Loading SOP…</p>;
  if (!sop) return (
    <p className="text-sm text-muted-foreground">
      No SOP has been created for this service type yet.
    </p>
  );

  const reviewedAt = (reviewQ.data as { reviewed_at: string } | null | undefined)?.reviewed_at;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">{sop.name}</h3>
          {sop.description && <p className="text-sm text-muted-foreground mt-1">{sop.description}</p>}
        </div>
        {allowMarkReviewed && (
          <div className="text-right shrink-0">
            <button
              onClick={onMarkReviewed}
              className="inline-flex items-center gap-2 bg-brand text-brand-foreground text-sm font-medium rounded-lg px-3 py-2 hover:opacity-90"
            >
              <Check className="size-4" /> Mark SOP reviewed
            </button>
            {reviewedAt && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Last reviewed {format(new Date(reviewedAt), "MMM d, h:mma")}
              </p>
            )}
          </div>
        )}
      </div>

      {sop.steps.length === 0 ? (
        <p className="text-sm text-muted-foreground">No steps yet.</p>
      ) : (
        <ol className="space-y-4">
          {sop.steps.map((s) => (
            <li key={s.id} className="bg-clay-100/60 rounded-xl p-4 ring-1 ring-black/5">
              <div className="flex gap-3">
                <span className="size-6 shrink-0 rounded-full bg-brand text-brand-foreground text-xs font-medium grid place-items-center">
                  {s.step_number}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{s.title}</p>
                  {s.description && <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{s.description}</p>}
                  {s.reference_photo_url && (
                    <button
                      type="button"
                      onClick={() => setLightbox(s.reference_photo_url)}
                      className="mt-3 block rounded-lg overflow-hidden ring-1 ring-black/5"
                    >
                      <img src={s.reference_photo_url} alt="" className="max-h-56 object-cover" />
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      {sop.attachments.length > 0 && (
        <div>
          <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Attachments</h4>
          <ul className="space-y-2">
            {sop.attachments.map((a) => {
              const isImage = /\.(png|jpe?g|webp|gif|heic)$/i.test(a.original_filename);
              return (
                <li key={a.id} className="flex items-center gap-3 bg-clay-100/60 rounded-lg p-2 ring-1 ring-black/5">
                  <div className="size-10 rounded bg-clay-200 grid place-items-center shrink-0">
                    {isImage ? <ImageIcon className="size-4 text-muted-foreground" /> : <FileText className="size-4 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{a.original_filename}</p>
                    {a.caption && <p className="text-xs text-muted-foreground truncate">{a.caption}</p>}
                  </div>
                  {a.url && (
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-input hover:bg-clay-100"
                    >
                      <Download className="size-3" /> Open
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/80 grid place-items-center p-4" onClick={() => setLightbox(null)}>
          <button className="absolute top-4 right-4 text-white/80 hover:text-white" aria-label="Close">
            <X className="size-6" />
          </button>
          <img src={lightbox} alt="" className="max-h-[85vh] max-w-full rounded-lg" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
