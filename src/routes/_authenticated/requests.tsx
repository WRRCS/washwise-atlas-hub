import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { formatDateRange, formatReceivedAt } from "@/lib/owner-inbox-alerts";
import {
  listPendingTimeOff,
  decideTimeOff,
  askTimeOffQuestion,
  type TimeOffRow,
  listPendingShiftSwaps,
  decideShiftSwap,
} from "@/lib/requests.functions";

export const Route = createFileRoute("/_authenticated/requests")({
  head: () => ({
    meta: [
      { title: "Requests · WRRCS.com" },
      { name: "description", content: "Approve, decline or ask about time-off and shift-swap requests." },
    ],
  }),
  component: RequestsPage,
});

function RequestsPage() {
  const qc = useQueryClient();
  const listTO = useServerFn(listPendingTimeOff);
  const listSW = useServerFn(listPendingShiftSwaps);
  const decTO = useServerFn(decideTimeOff);
  const decSW = useServerFn(decideShiftSwap);

  const toQ = useQuery({ queryKey: ["pending-time-off"], queryFn: () => listTO() });
  const swQ = useQuery({ queryKey: ["pending-shift-swaps"], queryFn: () => listSW() });

  const toMut = useMutation({
    mutationFn: (v: { id: string; decision: "approved" | "denied" }) => decTO({ data: v }),
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["pending-time-off"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const swMut = useMutation({
    mutationFn: (v: { id: string; decision: "approved" | "denied" }) => decSW({ data: v }),
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["pending-shift-swaps"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader title="Requests" subtitle="Approve, decline or ask a question about time-off and shift-swap requests." />
      <div className="max-w-5xl mx-auto px-6 md:px-8 py-6 space-y-8">
        <Card>
          <CardHeader><CardTitle>Time off — pending</CardTitle></CardHeader>
          <CardContent>
            {toQ.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (toQ.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No pending requests.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {(toQ.data ?? []).map((r) => (
                  <TimeOffItem key={r.id} r={r} busy={toMut.isPending} onDecide={(decision) => toMut.mutate({ id: r.id, decision })} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Shift swaps — pending</CardTitle></CardHeader>
          <CardContent>
            {swQ.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (swQ.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No pending requests.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {(swQ.data ?? []).map((r) => (
                  <li key={r.id} className="py-3 flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{r.job_label ?? "Job"}</p>
                      <p className="text-xs text-muted-foreground">Sent {formatReceivedAt(r.created_at)}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Requested by {r.requesting_employee_name ?? "Employee"} · Suggested cover: {r.proposed_covering_employee_name ?? "Anyone"}
                      </p>
                      {r.reason && <p className="text-sm text-muted-foreground mt-1">{r.reason}</p>}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => swMut.mutate({ id: r.id, decision: "approved" })} disabled={swMut.isPending}>Approve</Button>
                      <Button size="sm" variant="outline" onClick={() => swMut.mutate({ id: r.id, decision: "denied" })} disabled={swMut.isPending}>Decline</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function TimeOffItem({ r, busy, onDecide }: { r: TimeOffRow; busy: boolean; onDecide: (d: "approved" | "denied") => void }) {
  const qc = useQueryClient();
  const askFn = useServerFn(askTimeOffQuestion);
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const askMut = useMutation({
    mutationFn: () => askFn({ data: { id: r.id, question: question.trim() } }),
    onSuccess: () => {
      toast.success("Question saved — the employee will see it on their Time off page");
      setAsking(false); setQuestion("");
      qc.invalidateQueries({ queryKey: ["pending-time-off"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <li className="py-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium">{r.employee_name ?? "Employee"}</p>
          <p className="text-sm">{formatDateRange(r.start_date, r.end_date)}</p>
          <p className="text-xs text-muted-foreground">Sent {formatReceivedAt(r.created_at)}</p>
          {r.reason_en ? (
            <>
              <p className="text-sm mt-1">{r.reason_en}</p>
              <p className="text-xs text-muted-foreground">Original (Ukrainian): {r.reason}</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground mt-1">{r.reason}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onDecide("approved")} disabled={busy}>Approve</Button>
          <Button size="sm" variant="outline" onClick={() => onDecide("denied")} disabled={busy}>Decline</Button>
          <Button size="sm" variant="secondary" onClick={() => setAsking((v) => !v)}>Ask a question</Button>
        </div>
      </div>
      {r.owner_question && (
        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm space-y-1">
          <p><span className="font-medium">You asked:</span> {r.owner_question}</p>
          {r.employee_reply ? (
            <>
              <p><span className="font-medium">Answer:</span> {r.employee_reply_en ?? r.employee_reply}</p>
              {r.employee_reply_en && <p className="text-xs text-muted-foreground">Original (Ukrainian): {r.employee_reply}</p>}
              {r.replied_at && <p className="text-xs text-muted-foreground">Answered {formatReceivedAt(r.replied_at)}</p>}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Waiting for an answer</p>
          )}
        </div>
      )}
      {asking && (
        <form
          className="space-y-2"
          onSubmit={(e) => { e.preventDefault(); if (question.trim()) askMut.mutate(); }}
        >
          <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} placeholder="e.g. Can you work the morning and leave at noon?" />
          <div className="flex gap-2">
            <Button size="sm" type="submit" disabled={askMut.isPending || !question.trim()}>{askMut.isPending ? "Saving…" : "Send question"}</Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
          </div>
        </form>
      )}
    </li>
  );
}
