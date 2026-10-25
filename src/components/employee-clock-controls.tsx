import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Clock, Coffee, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { employeeClockAction } from "@/lib/employee-clock.functions";
import { getMyShift } from "@/lib/time.functions";

export function EmployeeClockControls() {
  const getShift = useServerFn(getMyShift);
  const action = useServerFn(employeeClockAction);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["my-shift"], queryFn: () => getShift(), refetchInterval: 15000 });
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (value: "start_work" | "start_lunch" | "end_lunch" | "clock_out") => {
    if (busy) return;
    setBusy(true);
    try {
      await action({ data: { action: value, description: value === "start_work" ? description : undefined } });
      setOpen(false);
      ["my-shift", "my-jobs", "job-visit", "my-timesheet", "timesheet", "reports"].forEach(key => void qc.invalidateQueries({ queryKey: [key] }));
      toast.success(value === "start_lunch" ? "On unpaid lunch" : value === "clock_out" ? "Clocked out" : "Paid work tracking started");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update clock"); }
    finally { setBusy(false); }
  };
  const shift = q.data;
  const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
  return (
    <section aria-label="Employee clock" className="mb-4 border-y border-border py-4 flex flex-wrap items-center justify-between gap-3">
      <div role="status" className="text-sm">
        {q.isLoading ? "Loading clock…" : q.error ? "Clock unavailable" : shift ? <><strong>{shift.kind === "lunch" ? "On unpaid lunch" : shift.on_site_since ? "On site" : shift.kind === "work" ? "Unassigned work" : "Drive / other"}</strong><span className="text-muted-foreground"> · since {time(shift.kind === "lunch" ? shift.started_at : shift.on_site_since ?? shift.last_left_at ?? shift.started_at)}</span>{shift.kind === "work" && <div className="text-muted-foreground break-words">{shift.description}</div>}</> : "Clocked out"}
      </div>
      <div className="flex flex-wrap gap-2">
        {!shift ? <Button variant="outline" disabled={q.isLoading || !!q.error || busy} onClick={() => setOpen(true)}><Clock className="size-4" />Clock in without a scheduled job</Button> : shift.kind === "lunch" ? <Button disabled={busy} onClick={() => run("end_lunch")}><Play className="size-4" />End lunch / Resume work</Button> : <><Button variant="outline" disabled={busy} onClick={() => run("start_lunch")}><Coffee className="size-4" />Start unpaid lunch</Button><Button variant="outline" disabled={busy} onClick={() => run("clock_out")}><Square className="size-4" />Clock out for the day</Button></>}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent><DialogHeader><DialogTitle>Clock in without a scheduled job</DialogTitle></DialogHeader>
          <form onSubmit={e => { e.preventDefault(); void run("start_work"); }} className="space-y-4">
            <label className="block text-sm font-medium">Work description<input autoFocus required minLength={3} maxLength={300} value={description} onChange={e => setDescription(e.target.value)} className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2" /></label>
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={busy || description.trim().length < 3}><Play className="size-4" />Clock in</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}