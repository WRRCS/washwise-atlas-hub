import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { getSopForJob, markSopReviewed, getLatestSopReview } from "@/lib/sops.functions";
import { format } from "date-fns";
import { useT, usePick } from "@/lib/i18n";
import { Check, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SopDocumentPreview } from "@/components/sop-document-preview";
import { isImportedSopPlaceholder } from "@/lib/sop-document";
import { getJob } from "@/lib/jobs.functions";
import { distinctSopAttachments, sopContentIsCovered } from "@/lib/sop-content";

export function SopViewer({ serviceTypeId, jobId, allowMarkReviewed = false, hasTextSop = false, readableText = "" }: {
  serviceTypeId: string | null | undefined;
  jobId?: string;
  allowMarkReviewed?: boolean;
  hasTextSop?: boolean;
  readableText?: string;
}) {
  const fetchSop = useServerFn(getSopForJob);
  const fetchReview = useServerFn(getLatestSopReview);
  const markFn = useServerFn(markSopReviewed);
  const fetchJob = useServerFn(getJob);
  const [selected, setSelected] = useState<string | null>(null);
  const [covered, setCovered] = useState<Set<string>>(() => new Set());
  const coverAttachment = useCallback((identity: string) => {
    setCovered((previous) => new Set([...previous, identity]));
  }, []);
  const t = useT();
  const pick = usePick();
  const sopQ = useQuery({
    queryKey: ["sop-for-job", jobId],
    queryFn: () => {
      if (!jobId) throw new Error("No appointment selected");
      return fetchSop({ data: { job_id: jobId } });
    },
    enabled: !!jobId,
  });
  const sop = sopQ.data;
  const textQ = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => {
      if (!jobId) throw new Error("No appointment selected");
      return fetchJob({ data: { id: jobId } });
    },
    enabled: !!jobId && !hasTextSop && sopQ.isSuccess && !sop,
  });
  const reviewQ = useQuery({
    queryKey: ["sop-review", sop?.id, jobId],
    queryFn: () => {
      if (!sop) throw new Error("No SOP selected");
      return fetchReview({ data: { sop_id: sop.id, job_id: jobId ?? null } });
    },
    enabled: allowMarkReviewed && !!sop?.id,
  });
  void serviceTypeId;
  if (!jobId) return null;
  if (sopQ.isLoading) return <p role="status" className="text-sm text-muted-foreground">{t("Loading SOP…")}</p>;
  if (sopQ.isError) return <div role="alert" className="space-y-2"><p className="text-sm text-destructive">Could not load this appointment's SOP. Please try again or contact the office.</p><Button variant="outline" onClick={() => sopQ.refetch()}>Try again</Button></div>;
  if (!sop) {
    if (hasTextSop) return null;
    if (textQ.isLoading) return <p role="status" className="text-sm text-muted-foreground">Loading saved instructions…</p>;
    if (textQ.isError) return <p role="alert" className="text-sm text-destructive">Could not load saved instructions. Please reopen the SOP or contact the office.</p>;
    const text = textQ.data?.client?.client_sop;
    return text?.trim() ? <p className="whitespace-pre-wrap text-base leading-relaxed">{text}</p> : <p className="text-sm text-muted-foreground">{t("No SOP is saved for this appointment's property. Please contact the office.")}</p>;
  }
  const steps = sop.steps.filter((step) => !isImportedSopPlaceholder(step.title));
  const libraryText = [sop.description && !sop.description.startsWith("Imported from ") ? sop.description : "", ...steps.flatMap((step) => [pick(step.title, step.title_uk), pick(step.description, step.description_uk)])].filter(Boolean).join("\n");
  const hasInstructions = !!libraryText.trim() && !(sopContentIsCovered(libraryText, readableText) && !steps.some((step) => step.reference_photo_url));
  const attachments = distinctSopAttachments(sop.attachments).filter((a) => !covered.has(`${jobId}:${a.id}`));
  const active = selected === "instructions" && hasInstructions ? "instructions" : selected && attachments.some((a) => `${jobId}:${a.id}` === selected) ? selected : (hasInstructions ? "instructions" : attachments[0] ? `${jobId}:${attachments[0].id}` : undefined);
  const attachment = attachments.find((a) => `${jobId}:${a.id}` === active);
  const reviewedAt = reviewQ.data?.reviewed_at;
  const onMarkReviewed = async () => {
    try {
      await markFn({ data: { sop_id: sop.id, job_id: jobId ?? null } });
      toast.success(t("SOP marked reviewed"));
      await reviewQ.refetch();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save review"); }
  };
  return (
    <div className="min-w-0 space-y-4">
      {(hasInstructions || attachments.length > 0) && <h3 className="font-semibold break-words">{sop.name}</h3>}
      {(hasInstructions ? 1 : 0) + attachments.length > 1 && (
        <label className="block text-sm font-medium">SOP documents
          <select aria-label="SOP documents" value={active} onChange={(e) => setSelected(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-background text-foreground p-2">
            {hasInstructions && <option value="instructions">Written instructions · Primary</option>}
            {attachments.map((a, index) => <option key={a.id} value={`${jobId}:${a.id}`}>{a.original_filename}{!hasInstructions && index === 0 ? " · Primary" : ""}</option>)}
          </select>
        </label>
      )}
      {active === "instructions" && (
        <div className="space-y-5 text-base leading-relaxed">
          {sop.description && !sop.description.startsWith("Imported from ") && <p className="whitespace-pre-wrap">{sop.description}</p>}
          <ol className="space-y-5">
            {steps.map((s) => <li key={s.id} className="border-b border-border pb-4">
              <p className="font-semibold">{s.step_number}. {pick(s.title, s.title_uk)}</p>
              {pick(s.description, s.description_uk) && <p className="mt-2 whitespace-pre-wrap">{pick(s.description, s.description_uk)}</p>}
              {s.reference_photo_url && <img src={s.reference_photo_url} alt={`Reference for ${s.title}`} className="mt-3 w-full h-auto rounded-lg" />}
            </li>)}
          </ol>
        </div>
      )}
      {attachment && <ComparedSopDocument key={`${jobId}:${attachment.id}`} identity={`${jobId}:${attachment.id}`} url={attachment.url} filename={attachment.original_filename} readableText={[readableText, hasInstructions ? libraryText : ""].join("\n")} onCovered={coverAttachment} />}
      {!hasInstructions && !sop.attachments.length && !readableText.trim() && <p className="text-sm text-muted-foreground">This SOP has no saved instructions or document yet. Please contact the office.</p>}
      {attachment?.url && <Button asChild variant="outline" size="sm"><a href={attachment.url} download={attachment.original_filename} target="_blank" rel="noreferrer"><Download />Download</a></Button>}
      {allowMarkReviewed && <div className="border-t border-border pt-4"><Button onClick={onMarkReviewed}><Check />{t("Mark SOP reviewed")}</Button>{reviewedAt && <p className="mt-2 text-xs text-muted-foreground">Last reviewed {format(new Date(reviewedAt), "MMM d, h:mma")}</p>}</div>}
    </div>
  );
}

function ComparedSopDocument({ identity, onCovered, ...props }: { identity: string; onCovered: (identity: string) => void; url: string | null; filename: string; readableText: string }) {
  const covered = useCallback(() => onCovered(identity), [identity, onCovered]);
  return <SopDocumentPreview {...props} onCovered={covered} />;
}
