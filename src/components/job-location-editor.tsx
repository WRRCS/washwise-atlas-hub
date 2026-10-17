import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MapPin } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { listClientProperties } from "@/lib/client-properties.functions";
import { updateJobLocation } from "@/lib/jobs.functions";

export function JobLocationEditor({ jobId, clientId, propertyId, recurring }: { jobId: string; clientId: string; propertyId: string | null; recurring: boolean }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(propertyId ?? "");
  const [scope, setScope] = useState<"this" | "future">("this");
  const [saving, setSaving] = useState(false);
  const list = useServerFn(listClientProperties);
  const save = useServerFn(updateJobLocation);
  const qc = useQueryClient();
  const { data: properties = [] } = useQuery({ queryKey: ["client-properties", clientId], queryFn: () => list({ data: { client_id: clientId } }), enabled: open });
  if (!open) return <Button variant="outline" size="sm" onClick={() => setOpen(true)}><MapPin className="size-4" /> Change location</Button>;
  return <div className="space-y-2">
    <select aria-label="Appointment property" className="w-full rounded-md border border-input bg-background p-2 text-sm" value={selected} onChange={(e) => setSelected(e.target.value)}>
      <option value="">Select property…</option>
      {properties.map((p) => <option key={p.id} value={p.id}>{p.label} — {p.address}</option>)}
    </select>
    {recurring && <select aria-label="Location change applies to" className="w-full rounded-md border border-input bg-background p-2 text-sm" value={scope} onChange={(e) => setScope(e.target.value === "future" ? "future" : "this")}>
      <option value="this">This appointment only</option><option value="future">This and future scheduled appointments</option>
    </select>}
    <div className="flex gap-2"><Button size="sm" disabled={!selected || saving} onClick={async () => {
      setSaving(true);
      try {
        await save({ data: { id: jobId, property_id: selected, scope } });
        await Promise.all(["job", "jobs", "my-jobs", "client-jobs"].map((key) => qc.invalidateQueries({ queryKey: [key] })));
        setOpen(false); toast.success("Appointment location updated");
      } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save location"); }
      finally { setSaving(false); }
    }}>{saving ? "Saving…" : "Save location"}</Button><Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
  </div>;
}