import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { listProperties, listClients, createProperty } from "@/lib/entities.functions";

export const Route = createFileRoute("/_authenticated/properties")({
  component: Properties,
  errorComponent: ({ error }) => <div className="p-8 text-sm text-destructive">{error.message}</div>,
});

function Properties() {
  const qc = useQueryClient();
  const listFn = useServerFn(listProperties);
  const clientsFn = useServerFn(listClients);
  const createFn = useServerFn(createProperty);
  const { data: properties = [] } = useQuery({ queryKey: ["properties"], queryFn: () => listFn({}) });
  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: () => clientsFn({}) });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    client_id: "", nickname: "", address_line1: "", address_line2: "", city: "", state: "", postal_code: "", access_notes: "", bedrooms: "", bathrooms: "", square_feet: "",
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.client_id) return toast.error("Pick a client");
    try {
      await createFn({ data: {
        client_id: form.client_id,
        nickname: form.nickname || undefined,
        address_line1: form.address_line1,
        address_line2: form.address_line2 || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        postal_code: form.postal_code || undefined,
        access_notes: form.access_notes || undefined,
        bedrooms: form.bedrooms ? Number(form.bedrooms) : undefined,
        bathrooms: form.bathrooms ? Number(form.bathrooms) : undefined,
        square_feet: form.square_feet ? Number(form.square_feet) : undefined,
      } });
      toast.success("Property added");
      setOpen(false);
      setForm({ client_id: "", nickname: "", address_line1: "", address_line2: "", city: "", state: "", postal_code: "", access_notes: "", bedrooms: "", bathrooms: "", square_feet: "" });
      qc.invalidateQueries({ queryKey: ["properties"] });
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
  };

  return (
    <>
      <PageHeader title="Properties" subtitle="Addresses you service, with access notes."
        action={<Button onClick={() => setOpen((v) => !v)} className="bg-brand text-brand-foreground hover:opacity-90">+ New property</Button>} />
      <div className="max-w-5xl mx-auto w-full px-6 md:px-8 py-8 space-y-6">
        {open && (
          <form onSubmit={submit} className="bg-card p-6 rounded-xl ring-1 ring-black/5 grid md:grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Client *</Label>
              <select required value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                <option value="">Select…</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5"><Label>Nickname</Label><Input value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} placeholder="e.g. Highland Unit 4B" /></div>
            <div className="space-y-1.5 md:col-span-2"><Label>Address *</Label><Input required value={form.address_line1} onChange={(e) => setForm({ ...form, address_line1: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>City</Label><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>State / ZIP</Label><div className="flex gap-2"><Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} className="w-16" /><Input value={form.postal_code} onChange={(e) => setForm({ ...form, postal_code: e.target.value })} /></div></div>
            <div className="space-y-1.5"><Label>Bedrooms</Label><Input type="number" value={form.bedrooms} onChange={(e) => setForm({ ...form, bedrooms: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Bathrooms</Label><Input type="number" step="0.5" value={form.bathrooms} onChange={(e) => setForm({ ...form, bathrooms: e.target.value })} /></div>
            <div className="space-y-1.5 md:col-span-2"><Label>Access notes</Label><Textarea rows={2} value={form.access_notes} onChange={(e) => setForm({ ...form, access_notes: e.target.value })} placeholder="Lockbox code, parking, etc." /></div>
            <div className="md:col-span-2 flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" className="bg-brand text-brand-foreground hover:opacity-90">Save</Button></div>
          </form>
        )}
        {properties.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No properties yet.</div>
        ) : (
          <div className="grid gap-3">
            {properties.map((p) => (
              <div key={p.id} className="bg-card p-5 rounded-xl ring-1 ring-black/5">
                <div className="flex justify-between">
                  <div>
                    <h3 className="text-base font-medium">{p.nickname ?? p.address_line1}</h3>
                    <p className="text-sm text-muted-foreground">{p.address_line1}{p.city && `, ${p.city}`}{p.state && ` ${p.state}`} · {p.client?.name}</p>
                    {p.access_notes && <p className="text-xs text-muted-foreground mt-2">🔑 {p.access_notes}</p>}
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    {p.bedrooms != null && <p>{p.bedrooms} bd / {p.bathrooms ?? "?"} ba</p>}
                    {p.square_feet && <p>{p.square_feet} sqft</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
