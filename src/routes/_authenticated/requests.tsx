import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  listPendingTimeOff,
  decideTimeOff,
  listPendingShiftSwaps,
  decideShiftSwap,
} from "@/lib/requests.functions";

export const Route = createFileRoute("/_authenticated/requests")({
  head: () => ({
    meta: [
      { title: "Requests · Atlas" },
      { name: "description", content: "Approve or deny time-off and shift-swap requests." },
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
      <PageHeader title="Requests" subtitle="Approve or deny time-off and shift-swap requests." />
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
                  <li key={r.id} className="py-3 flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{r.employee_name ?? "Employee"}</p>
                      <p className="text-sm">{r.start_date} → {r.end_date}</p>
                      <p className="text-sm text-muted-foreground mt-0.5">{r.reason}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => toMut.mutate({ id: r.id, decision: "approved" })} disabled={toMut.isPending}>Approve</Button>
                      <Button size="sm" variant="outline" onClick={() => toMut.mutate({ id: r.id, decision: "denied" })} disabled={toMut.isPending}>Deny</Button>
                    </div>
                  </li>
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
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Requested by {r.requesting_employee_name ?? "Employee"} · Suggested cover: {r.proposed_covering_employee_name ?? "Anyone"}
                      </p>
                      {r.reason && <p className="text-sm text-muted-foreground mt-1">{r.reason}</p>}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => swMut.mutate({ id: r.id, decision: "approved" })} disabled={swMut.isPending}>Approve</Button>
                      <Button size="sm" variant="outline" onClick={() => swMut.mutate({ id: r.id, decision: "denied" })} disabled={swMut.isPending}>Deny</Button>
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
