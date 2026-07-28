import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { createJob } from "@/lib/jobs.functions";
import { listClients, listServiceTypes, listEmployees } from "@/lib/entities.functions";
import { listClientProperties } from "@/lib/client-properties.functions";

export const Route = createFileRoute("/_authenticated/jobs/new")({
  component: NewJob,
  errorComponent: ({ error }) => <div className="p-8 text-sm text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-8">Not found.</div>,
});

function NewJob() {
  const navigate = useNavigate();
  const clientsFn = useServerFn(listClients);
  const svcFn = useServerFn(listServiceTypes);
  const empFn = useServerFn(listEmployees);
  const create = useServerFn(createJob);

  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: () => clientsFn({}) });
  const { data: services = [] } = useQuery({ queryKey: ["services"], queryFn: () => svcFn({}) });
  const { data: employees = [] } = useQuery({ queryKey: ["employees"], queryFn: () => empFn({}) });

  const [clientId, setClientId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [assignee, setAssignee] = useState("");
  const [start, setStart] = useState(() => {
    const d = new Date(); d.setHours(9, 0, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [durationMin, setDurationMin] = useState(120);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const propsFn = useServerFn(listClientProperties);
  const { data: properties = [] } = useQuery({
    queryKey: ["client-properties", clientId],
    queryFn: () => propsFn({ data: { client_id: clientId } }),
    enabled: !!clientId,
  });

  const selectedClient = clients.find((c) => c.id === clientId) ?? null;
  const selectedProperty = properties.find((p) => p.id === propertyId) ?? null;

  // Auto-select primary/only property when client changes
  useEffect(() => {
    if (!clientId) { setPropertyId(""); return; }
    if (properties.length === 0) { setPropertyId(""); return; }
    if (!properties.find((p) => p.id === propertyId)) {
      const primary = properties.find((p) => p.is_primary) ?? properties[0];
      setPropertyId(primary.id);
    }
  }, [clientId, properties, propertyId]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId || !serviceId || !start) return;
    setSaving(true);
    try {
      const startDate = new Date(start);
      const endDate = new Date(startDate.getTime() + durationMin * 60_000);
      await create({
        data: {
          client_id: clientId,
          service_type_id: serviceId,
          scheduled_start: startDate.toISOString(),
          scheduled_end: endDate.toISOString(),
          assigned_employee_ids: assignee ? [assignee] : [],
          notes: notes || undefined,
        },
      });
      toast.success("Job created");
      navigate({ to: "/jobs" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="New Job" subtitle="Schedule a cleaning and assign a cleaner." />
      <div className="max-w-2xl mx-auto w-full px-6 md:px-8 py-8">
        {clients.length === 0 && (
          <div className="mb-6 rounded-lg bg-warning/10 text-sm p-4">
            You need a client first. <a href="/clients" className="font-medium text-brand hover:underline">Add a client →</a>
          </div>
        )}
        <form onSubmit={onSubmit} className="space-y-5 bg-card p-6 rounded-xl ring-1 ring-black/5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Client">
              <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Select…</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{[c.first_name, c.last_name].filter(Boolean).join(" ")}</option>)}
              </select>
            </Field>
            <Field label="Service address">
              <Input value={selectedClient?.service_address ?? ""} disabled placeholder="From client record" />
            </Field>
            <Field label="Service">
              <select value={serviceId} onChange={(e) => {
                setServiceId(e.target.value);
                const s = services.find((x) => x.id === e.target.value);
                if (s) setDurationMin(s.default_duration_minutes);
              }} className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Select…</option>
                {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Cleaner">
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Unassigned</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name ?? e.email}</option>)}
              </select>
            </Field>
            <Field label="Start">
              <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
            </Field>
            <Field label="Duration (min)">
              <Input type="number" min={30} step={15} value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))} />
            </Field>
          </div>
          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Access code, special instructions…" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => navigate({ to: "/jobs" })}>Cancel</Button>
            <Button type="submit" disabled={saving} className="bg-brand text-brand-foreground hover:opacity-90">{saving ? "…" : "Create job"}</Button>
          </div>
        </form>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
