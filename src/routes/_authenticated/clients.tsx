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
import { listClients, createClient } from "@/lib/entities.functions";

export const Route = createFileRoute("/_authenticated/clients")({
  component: Clients,
  errorComponent: ({ error }) => <div className="p-8 text-sm text-destructive">{error.message}</div>,
});

function Clients() {
  const qc = useQueryClient();
  const listFn = useServerFn(listClients);
  const createFn = useServerFn(createClient);
  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: () => listFn({}) });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", notes: "" });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createFn({ data: form });
      toast.success("Client added");
      setForm({ name: "", email: "", phone: "", notes: "" });
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["clients"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <>
      <PageHeader
        title="Clients"
        subtitle="People and property managers you clean for."
        action={<Button onClick={() => setOpen((v) => !v)} className="bg-brand text-brand-foreground hover:opacity-90">+ New client</Button>}
      />
      <div className="max-w-5xl mx-auto w-full px-6 md:px-8 py-8 space-y-6">
        {open && (
          <form onSubmit={submit} className="bg-card p-6 rounded-xl ring-1 ring-black/5 grid md:grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Name *</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div className="space-y-1.5 md:col-span-2"><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <div className="md:col-span-2 flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" className="bg-brand text-brand-foreground hover:opacity-90">Save</Button></div>
          </form>
        )}
        {clients.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No clients yet.</div>
        ) : (
          <div className="grid gap-3">
            {clients.map((c) => (
              <div key={c.id} className="bg-card p-5 rounded-xl ring-1 ring-black/5 flex justify-between items-center">
                <div>
                  <h3 className="text-base font-medium">{c.name}</h3>
                  <p className="text-sm text-muted-foreground">{c.email ?? "—"} · {c.phone ?? "—"}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Properties</p>
                  <p className="text-sm font-medium tabular-nums">{c.properties?.[0]?.count ?? 0}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
