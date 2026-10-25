import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { listJobs } from "@/lib/jobs.functions";
import { updateClockRecord } from "@/lib/employee-clock.functions";
import { zonedToUTCISO, dayKeyTZ, hourMinuteTZ } from "@/lib/tz";

export type ClockRecord = { id: string; kind: "work" | "lunch"; employee_name: string; started_at: string; ended_at: string | null; description: string; job_id: string | null };
const tz = "America/Los_Angeles";
const local = (iso: string | null) => iso ? `${dayKeyTZ(iso, tz)}T${hourMinuteTZ(iso, tz)}` : "";
const iso = (value: string) => { const [day, time] = value.split("T"); return zonedToUTCISO(day ?? "", time ?? "", tz); };
export function ClockRecordEditor({ record: r }: { record: ClockRecord }) {
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [jobId, setJobId] = useState(r.job_id ?? "");
  const [description, setDescription] = useState(r.description);
  const [busy, setBusy] = useState(false);
  const save = useServerFn(updateClockRecord);
  const jobs = useServerFn(listJobs);
  const q = useQuery({ queryKey: ["clock-review-jobs"], queryFn: () => jobs({ data: {} }), enabled: editing && r.kind === "work" });
  const qc = useQueryClient();
  const submit = async () => {
    setBusy(true);
    try {
      await save({ data: { id: r.id, started_at: iso(start), ended_at: end ? iso(end) : null, job_id: jobId || null, description } });
      ["timesheet", "my-shift", "my-timesheet", "reports"].forEach(key => void qc.invalidateQueries({ queryKey: [key] }));
      setEditing(false); toast.success("Time record corrected");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save"); }
    finally { setBusy(false); }
  };
  const time = (v: string) => new Date(v).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
  return <div data-clock-id={r.id} className="py-3 border-t border-border flex flex-wrap gap-3 items-center text-sm" aria-label={`${r.employee_name} ${r.kind === "lunch" ? "unpaid lunch" : "unassigned work"}`}>
    <div className="min-w-40"><strong>{r.employee_name}</strong><div>{r.kind === "lunch" ? "Unpaid lunch" : r.job_id ? "Work · appointment associated" : "Unassigned work · review"}</div><div className="text-muted-foreground break-words">{r.description}</div></div>
    {editing ? <form onSubmit={e => { e.preventDefault(); void submit(); }} className="flex flex-wrap gap-2 items-end flex-1">
      <label>Start (Pacific)<input required type="datetime-local" value={start} onChange={e => setStart(e.target.value)} className="block border border-input bg-background rounded-md p-2" /></label>
      <label>End (Pacific)<input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} className="block border border-input bg-background rounded-md p-2" /></label>
      <label>Description<input required minLength={3} value={description} onChange={e => setDescription(e.target.value)} className="block border border-input bg-background rounded-md p-2" /></label>
      {r.kind === "work" && <label>Appointment<select aria-label="Associate appointment" value={jobId} onChange={e => setJobId(e.target.value)} className="block max-w-72 border border-input bg-background rounded-md p-2"><option value="">Unassigned work</option>{q.data?.map(j => <option key={j.id} value={j.id}>{dayKeyTZ(j.scheduled_start,tz)} · {j.service_location_label ?? j.service_address} · {j.client?.first_name} {j.client?.last_name}</option>)}</select></label>}
      <Button disabled={busy}>Save correction</Button><Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
    </form> : <><span className="tabular-nums">{time(r.started_at)} – {r.ended_at ? time(r.ended_at) : r.kind === "lunch" ? "lunch still open" : "still clocked in"}</span><Button variant="ghost" size="icon" aria-label={`Edit ${r.kind === "lunch" ? "unpaid lunch" : "unassigned work"}`} onClick={() => { setStart(local(r.started_at)); setEnd(local(r.ended_at)); setJobId(r.job_id ?? ""); setDescription(r.description); setEditing(true); }}><Pencil className="size-4" /></Button></>}
  </div>;
}