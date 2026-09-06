import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  listMyTimeOff,
  createTimeOff,
  listMyShiftSwaps,
  createShiftSwap,
  listMyUpcomingAssignedJobs,
} from "@/lib/requests.functions";
import { listTeamRoster } from "@/lib/team.functions";

export const Route = createFileRoute("/_authenticated/time-off")({
  head: () => ({
    meta: [
      { title: "Time Off & Swaps · WRRCS.com" },
      { name: "description", content: "Request time off and shift swaps." },
    ],
  }),
  component: TimeOffPage,
});

function statusBadge(status: string) {
  const variant =
    status === "approved" ? "default" : status === "denied" ? "destructive" : "secondary";
  return <Badge variant={variant as any} className="capitalize">{status}</Badge>;
}

function TimeOffPage() {
  const qc = useQueryClient();
  const listTimeOff = useServerFn(listMyTimeOff);
  const listSwaps = useServerFn(listMyShiftSwaps);
  const listJobs = useServerFn(listMyUpcomingAssignedJobs);
  const listRoster = useServerFn(listTeamRoster);
  const createTOFn = useServerFn(createTimeOff);
  const createSwapFn = useServerFn(createShiftSwap);

  const timeOffQ = useQuery({ queryKey: ["my-time-off"], queryFn: () => listTimeOff() });
  const swapsQ = useQuery({ queryKey: ["my-shift-swaps"], queryFn: () => listSwaps() });
  const jobsQ = useQuery({ queryKey: ["my-upcoming-assigned"], queryFn: () => listJobs() });
  const rosterQ = useQuery({ queryKey: ["team-roster"], queryFn: () => listRoster() });

  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const toMut = useMutation({
    mutationFn: (v: { start_date: string; end_date: string; reason: string }) =>
      createTOFn({ data: v }),
    onSuccess: () => {
      toast.success("Time off request submitted");
      setStart(""); setEnd(""); setReason("");
      qc.invalidateQueries({ queryKey: ["my-time-off"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [swapJobId, setSwapJobId] = useState("");
  const [coverId, setCoverId] = useState<string>("none");
  const [swapReason, setSwapReason] = useState("");
  const swapMut = useMutation({
    mutationFn: (v: { job_id: string; proposed_covering_employee_id: string | null; reason: string }) =>
      createSwapFn({ data: v }),
    onSuccess: () => {
      toast.success("Shift swap request submitted");
      setSwapJobId(""); setCoverId("none"); setSwapReason("");
      qc.invalidateQueries({ queryKey: ["my-shift-swaps"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <PageHeader title="Time off & swaps" subtitle="Request days off or ask a teammate to cover a shift." />
      <div className="max-w-4xl mx-auto px-6 md:px-8 py-6 space-y-8">
        {/* Time off request */}
        <Card>
          <CardHeader><CardTitle>Request time off</CardTitle></CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!start || !end || !reason.trim()) {
                  toast.error("All fields are required");
                  return;
                }
                toMut.mutate({ start_date: start, end_date: end, reason: reason.trim() });
              }}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="start">Start date</Label>
                  <Input id="start" type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
                </div>
                <div>
                  <Label htmlFor="end">End date</Label>
                  <Input id="end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} required />
                </div>
              </div>
              <div>
                <Label htmlFor="reason">Reason</Label>
                <Textarea id="reason" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Let your manager know why you need this time off." rows={3} />
              </div>
              <Button type="submit" disabled={toMut.isPending}>
                {toMut.isPending ? "Submitting…" : "Submit request"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>My time off requests</CardTitle></CardHeader>
          <CardContent>
            {timeOffQ.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (timeOffQ.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No requests yet.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {(timeOffQ.data ?? []).map((r) => (
                  <li key={r.id} className="py-3 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium">{r.start_date} → {r.end_date}</p>
                      <p className="text-sm text-muted-foreground mt-0.5">{r.reason}</p>
                    </div>
                    {statusBadge(r.status)}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Shift swap request */}
        <Card>
          <CardHeader><CardTitle>Request shift swap</CardTitle></CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!swapJobId) { toast.error("Pick a job"); return; }
                swapMut.mutate({
                  job_id: swapJobId,
                  proposed_covering_employee_id: coverId === "none" ? null : coverId,
                  reason: swapReason.trim(),
                });
              }}
            >
              <div>
                <Label>Job to cover</Label>
                <Select value={swapJobId} onValueChange={setSwapJobId}>
                  <SelectTrigger><SelectValue placeholder="Pick one of your upcoming jobs" /></SelectTrigger>
                  <SelectContent>
                    {(jobsQ.data ?? []).map((j) => (
                      <SelectItem key={j.id} value={j.id}>
                        {(j.client_name ?? "Client")} — {new Date(j.scheduled_start).toLocaleString()}
                      </SelectItem>
                    ))}
                    {(jobsQ.data ?? []).length === 0 && (
                      <div className="px-2 py-1.5 text-sm text-muted-foreground">No upcoming assigned jobs</div>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Suggested teammate (optional)</Label>
                <Select value={coverId} onValueChange={setCoverId}>
                  <SelectTrigger><SelectValue placeholder="Anyone" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Anyone</SelectItem>
                    {(rosterQ.data ?? []).map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.full_name ?? "Teammate"}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="swap-reason">Reason</Label>
                <Textarea id="swap-reason" value={swapReason} onChange={(e) => setSwapReason(e.target.value)} rows={3} placeholder="Why do you need this swap?" />
              </div>
              <Button type="submit" disabled={swapMut.isPending}>
                {swapMut.isPending ? "Submitting…" : "Submit swap request"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>My shift swap requests</CardTitle></CardHeader>
          <CardContent>
            {swapsQ.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (swapsQ.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No requests yet.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {(swapsQ.data ?? []).map((r) => (
                  <li key={r.id} className="py-3 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium">{r.job_label ?? "Job"}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Suggested: {r.proposed_covering_employee_name ?? "Anyone"}
                      </p>
                      {r.reason && <p className="text-sm text-muted-foreground mt-1">{r.reason}</p>}
                    </div>
                    {statusBadge(r.status)}
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
