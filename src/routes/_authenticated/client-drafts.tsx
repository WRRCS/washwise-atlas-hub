import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import {
  listJobCompleteDrafts,
  updateJobCompleteDraft,
  sendJobCompleteDraft,
  discardJobCompleteDraft,
  type JobCompleteDraft,
} from "@/lib/job-complete-drafts.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/client-drafts")({
  head: () => ({
    meta: [
      { title: "Client message drafts — WRRCS.com" },
      { name: "description", content: "Review and send job-complete messages to clients before anything leaves the office." },
      { property: "og:title", content: "Client message drafts — WRRCS.com" },
      { property: "og:description", content: "Review and send job-complete messages to clients before anything leaves the office." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ClientDraftsPage,
});

function DraftCard({ draft, onChanged }: { draft: JobCompleteDraft; onChanged: () => void }) {
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const save = useServerFn(updateJobCompleteDraft);
  const send = useServerFn(sendJobCompleteDraft);
  const discard = useServerFn(discardJobCompleteDraft);

  const saveM = useMutation({
    mutationFn: () => save({ data: { id: draft.id, subject, body } }),
    onSuccess: () => { toast.success("Draft saved"); onChanged(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const sendM = useMutation({
    mutationFn: async () => {
      await save({ data: { id: draft.id, subject, body } });
      return send({ data: { id: draft.id } });
    },
    onSuccess: () => { toast.success("Sent to the client"); onChanged(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const discardM = useMutation({
    mutationFn: () => discard({ data: { id: draft.id } }),
    onSuccess: () => { toast.success("Draft discarded"); onChanged(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded-xl bg-card ring-1 ring-black/5 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">{draft.client_name ?? "Client"}</div>
        <div className="text-xs text-muted-foreground">
          {new Date(draft.created_at).toLocaleString()}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`s-${draft.id}`}>Subject</Label>
        <Input id={`s-${draft.id}`} value={subject} onChange={(e) => setSubject(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`b-${draft.id}`}>Message</Label>
        <Textarea id={`b-${draft.id}`} rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
      </div>

      {draft.photo_urls.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {draft.photo_urls.map((u) => (
            <img key={u} src={u} alt="Job photo" className="h-20 w-20 rounded-md object-cover ring-1 ring-black/5" />
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          onClick={() => sendM.mutate()}
          disabled={sendM.isPending}
          className="bg-brand text-brand-foreground hover:opacity-90"
        >
          {sendM.isPending ? "Sending…" : "Send to client"}
        </Button>
        <Button variant="outline" onClick={() => saveM.mutate()} disabled={saveM.isPending}>
          Save draft
        </Button>
        <Button variant="ghost" onClick={() => discardM.mutate()} disabled={discardM.isPending}>
          Discard
        </Button>
      </div>
    </div>
  );
}

function ClientDraftsPage() {
  const qc = useQueryClient();
  const fetchDrafts = useServerFn(listJobCompleteDrafts);
  const { data, isLoading } = useQuery({
    queryKey: ["client-message-drafts"],
    queryFn: () => fetchDrafts(),
  });

  const drafts = (data ?? []).filter((d) => d.status === "draft");
  const sent = (data ?? []).filter((d) => d.status === "sent");
  const refresh = () => qc.invalidateQueries({ queryKey: ["client-message-drafts"] });

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 p-4">
      <div>
        <h1 className="text-xl font-medium">Client message drafts</h1>
        <p className="text-sm text-muted-foreground">
          When a crew finishes a job we write the client a "job complete" note with their photos. It stays here
          until you send it — nothing goes out on its own.
        </p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && drafts.length === 0 && (
        <p className="text-sm text-muted-foreground">No drafts waiting right now.</p>
      )}

      <div className="space-y-4">
        {drafts.map((d) => (
          <DraftCard key={d.id} draft={d} onChanged={refresh} />
        ))}
      </div>

      {sent.length > 0 && (
        <div className="space-y-2 pt-4">
          <h2 className="text-sm font-medium text-muted-foreground">Recently sent</h2>
          {sent.slice(0, 10).map((d) => (
            <div key={d.id} className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
              <span className="font-medium">{d.client_name ?? "Client"}</span>{" "}
              <span className="text-muted-foreground">
                · {d.sent_at ? new Date(d.sent_at).toLocaleString() : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
