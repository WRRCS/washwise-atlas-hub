import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { listEmployees } from "@/lib/entities.functions";
import { updateJobAssignees, type JobAssignee } from "@/lib/jobs.functions";

/** Owner/manager control to add, remove or swap the cleaners on one appointment. */
export function JobAssigneesEditor({ jobId, assignees, recurring }: { jobId: string; assignees: JobAssignee[]; recurring: boolean }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [scope, setScope] = useState<"this" | "future">("this");
  const [saving, setSaving] = useState(false);
  const empFn = useServerFn(listEmployees);
  const save = useServerFn(updateJobAssignees);
  const qc = useQueryClient();
  const { data: employees = [], isLoading } = useQuery({ queryKey: ["employees"], queryFn: () => empFn({}), enabled: open });
  const team = (employees as any[])
    .filter((e) => e.is_active !== false && ["employee", "manager", "owner"].includes(e.role))
    .sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""));

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => { setSelected(assignees.map((a) => a.id)); setScope("this"); setOpen(true); }}>
        <Users className="size-4" /> {assignees.length ? "Change cleaners" : "Assign cleaners"}
      </Button>
    );
  }
  const toggle = (id: string, on: boolean) => setSelected((cur) => (on ? [...cur, id] : cur.filter((x) => x !== id)));
  const unchanged = selected.length === assignees.length && assignees.every((a) => selected.includes(a.id));
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Tick everyone who should be on this appointment.</p>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading team…</p> : (
        <ul className="space-y-1.5">
          {team.map((e) => (
            <li key={e.id}>
              <label className="flex items-center gap-2 text-sm cursor-pointer min-h-8">
                <Checkbox checked={selected.includes(e.id)} onCheckedChange={(v) => toggle(e.id, v === true)} aria-label={e.full_name ?? "Team member"} />
                <span>{e.full_name ?? "Team member"}</span>
                {e.role !== "employee" && <span className="text-[11px] text-muted-foreground capitalize">({e.role})</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
      {recurring && (
        <select aria-label="Cleaner change applies to" className="w-full rounded-md border border-input bg-background p-2 text-sm" value={scope} onChange={(e) => setScope(e.target.value === "future" ? "future" : "this")}>
          <option value="this">This appointment only</option>
          <option value="future">This and future scheduled appointments</option>
        </select>
      )}
      {selected.length === 0 && <p className="text-xs text-muted-foreground">No one ticked — the appointment becomes an open shift.</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={saving || unchanged} onClick={async () => {
          setSaving(true);
          try {
            const r = await save({ data: { id: jobId, employee_ids: selected, scope } });
            await Promise.all(["job", "jobs", "my-jobs", "client-jobs"].map((key) => qc.invalidateQueries({ queryKey: [key] })));
            setOpen(false);
            toast.success(r.visits > 1 ? `Cleaners updated on ${r.visits} appointments` : "Cleaners updated");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not change cleaners");
          } finally { setSaving(false); }
        }}>{saving ? "Saving…" : "Save cleaners"}</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}
