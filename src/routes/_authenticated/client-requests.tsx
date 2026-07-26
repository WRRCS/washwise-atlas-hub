import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Inbox, Check, X } from "lucide-react";
import {
  listClientRequests,
  approveClientRequest,
  dismissClientRequest,
  type ClientRequestRow,
} from "@/lib/client-requests.functions";

export const Route = createFileRoute("/_authenticated/client-requests")({
  component: ClientRequestsPage,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-destructive">{error.message}</div>
  ),
});

function ClientRequestsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listClientRequests);
  const approveFn = useServerFn(approveClientRequest);
  const dismissFn = useServerFn(dismissClientRequest);
  const [filter, setFilter] = useState<"pending" | "all">("pending");

  const { data: requests = [], isLoading } = useQuery<ClientRequestRow[]>({
    queryKey: ["client-requests"],
    queryFn: () => listFn(),
    refetchInterval: 30_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["client-requests"] });

  const onApprove = async (id: string) => {
    try {
      const res = await approveFn({ data: { id } });
      toast.success(res.added_to_job ? "Approved — added to the job's notes." : "Approved.");
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't approve that request");
    }
  };
  const onDismiss = async (id: string) => {
    try {
      await dismissFn({ data: { id } });
      toast.success("Dismissed");
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't dismiss that request");
    }
  };

  const filtered = filter === "pending" ? requests.filter((r) => r.status === "pending") : requests;

  return (
    <>
      <PageHeader
        title="Client requests"
        subtitle="Special requests clients added from their portal"
      />
      <div className="max-w-3xl mx-auto w-full px-4 sm:px-6 md:px-8 py-6 space-y-4">
        <div className="flex gap-2">
          {(["pending", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-lg border capitalize transition-colors ${
                filter === f
                  ? "border-brand bg-brand/5 text-brand"
                  : "border-border hover:bg-clay-100"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center bg-card rounded-xl ring-1 ring-black/5">
            <Inbox className="size-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Nothing here.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((r) => (
              <div key={r.id} className="bg-card rounded-xl ring-1 ring-black/5 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{r.client_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                      {r.job_scheduled_start &&
                        ` · for the ${format(new Date(r.job_scheduled_start), "MMM d")} appointment`}
                    </p>
                  </div>
                  <span
                    className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ${
                      r.status === "pending"
                        ? "bg-warning/15 text-warning"
                        : r.status === "approved"
                          ? "bg-success/15 text-success"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {r.status}
                  </span>
                </div>
                <p className="text-sm mt-2 whitespace-pre-wrap">{r.body}</p>
                {r.status === "pending" && (
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" onClick={() => onApprove(r.id)}>
                      <Check className="size-3.5 mr-1" /> Approve
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => onDismiss(r.id)}>
                      <X className="size-3.5 mr-1" /> Dismiss
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
