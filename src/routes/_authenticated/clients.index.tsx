import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Fragment, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { listClients, createClient, myCapabilities, setClientArchived } from "@/lib/entities.functions";
import { listClientProperties } from "@/lib/client-properties.functions";
import { Plus, Search, MapPin, Mail, Phone, MoreHorizontal, Archive, RotateCcw, ChevronRight, ChevronDown } from "lucide-react";


export const Route = createFileRoute("/_authenticated/clients/")({
  component: ClientsPage,
  errorComponent: ({ error }) => <div className="p-8 text-sm text-destructive">{error.message}</div>,
});

function fullName(c: { first_name: string | null; last_name: string | null }) {
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || "—";
}

function ClientsPage() {
  const navigate = useNavigate();
  const capsFn = useServerFn(myCapabilities);
  const capsQ = useQuery({ queryKey: ["my-capabilities"], queryFn: () => capsFn() });
  const canAccess = !!(capsQ.data?.isOwner || capsQ.data?.canManage);
  useEffect(() => {
    if (capsQ.data && !canAccess) {
      navigate({ to: "/my-jobs", replace: true });
    }
  }, [capsQ.data, canAccess, navigate]);
  const listFn = useServerFn(listClients);
  const { data = [], isLoading } = useQuery({
    queryKey: ["clients"],
    queryFn: () => listFn({}),
    enabled: canAccess,
  });
  const qc = useQueryClient();
  const archiveFn = useServerFn(setClientArchived);
  const archive = useMutation({
    mutationFn: (vars: { id: string; archived: boolean }) => archiveFn({ data: vars }),
    onSuccess: (_d, vars) => {
      toast.success(vars.archived ? "Moved to Previous Clients" : "Moved back to current clients");
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["report-client-directory"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"active" | "inactive" | "all">("active");
  const [expanded, setExpanded] = useState<string | null>(null);


  const counts = useMemo(() => {
    const active = data.filter((c) => c.is_active).length;
    return { all: data.length, active, inactive: data.length - active };
  }, [data]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let rows = data;
    if (status === "active") rows = rows.filter((c) => c.is_active);
    else if (status === "inactive") rows = rows.filter((c) => !c.is_active);
    if (!needle) return rows;
    return rows.filter((c) =>
      [fullName(c), c.email, c.phone, c.service_address].some((v) => (v ?? "").toLowerCase().includes(needle)),
    );
  }, [data, q, status]);

  if (capsQ.isLoading) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  if (capsQ.data && !canAccess) return null;


  return (
    <>
      <PageHeader
        title="Clients"
        subtitle={`${counts.active} current · ${counts.inactive} previous`}
        action={
          <Button onClick={() => setOpen(true)} className="bg-brand text-brand-foreground hover:opacity-90">
            <Plus className="size-4 mr-1.5" /> New client
          </Button>
        }
      />
      <div className="max-w-6xl mx-auto w-full px-6 md:px-8 py-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg ring-1 ring-black/5 bg-card p-1 text-sm">
            {([["active", "Current"], ["inactive", "Previous Clients"], ["all", "All"]] as const).map(([s, label]) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={`px-3 py-1.5 rounded-md transition-colors ${
                  status === s ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label} <span className="ml-1 opacity-70">({counts[s]})</span>
              </button>
            ))}
          </div>

          <div className="relative max-w-sm flex-1 min-w-[200px]">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients…" className="pl-9" />
          </div>
        </div>

        <div className="bg-card rounded-xl ring-1 ring-black/5 overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              {data.length === 0 ? "No clients yet. Add your first one." : "No matches."}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-clay-100/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="w-8 px-2 py-3" />
                  <th className="text-left px-5 py-3 font-medium">Name</th>
                  <th className="text-left px-5 py-3 font-medium hidden md:table-cell">Email</th>
                  <th className="text-left px-5 py-3 font-medium hidden md:table-cell">Phone</th>
                  <th className="text-left px-5 py-3 font-medium">Service address</th>
                  <th className="w-10 px-2 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <Fragment key={c.id}>
                  <tr className="border-t border-border/60 hover:bg-clay-100/40 transition-colors">
                    <td className="px-2 py-3">
                      <button
                        onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                        aria-label={`Show properties for ${fullName(c)}`}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        {expanded === c.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      </button>
                    </td>
                    <td className="px-5 py-3">
                      <Link to="/clients/$clientId" params={{ clientId: c.id }} className="font-medium hover:text-brand">
                        {fullName(c)}
                      </Link>
                      {!c.is_active && <span className="ml-2 text-[10px] uppercase text-muted-foreground">previous</span>}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground hidden md:table-cell">{c.email ?? "—"}</td>
                    <td className="px-5 py-3 text-muted-foreground hidden md:table-cell">{c.phone ?? "—"}</td>
                    <td className="px-5 py-3 text-muted-foreground truncate max-w-[300px]">{c.service_address ?? "—"}</td>
                    <td className="px-2 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8" aria-label={`Options for ${fullName(c)}`}>
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {c.is_active ? (
                            <DropdownMenuItem onClick={() => archive.mutate({ id: c.id, archived: true })}>
                              <Archive className="size-4 mr-2" /> Move to Previous Clients
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={() => archive.mutate({ id: c.id, archived: false })}>
                              <RotateCcw className="size-4 mr-2" /> Move back to current clients
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                  {expanded === c.id && (
                    <tr className="bg-clay-100/30 border-t border-border/60">
                      <td />
                      <td colSpan={4} className="px-5 py-3">
                        <PropertyRows clientId={c.id} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>

          )}
        </div>

        {/* Mobile card list hint */}
        <div className="md:hidden text-xs text-muted-foreground flex items-center gap-1"><MapPin className="size-3" /> Tap a name to view details</div>
      </div>

      <NewClientDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function PropertyRows({ clientId }: { clientId: string }) {
  const listFn = useServerFn(listClientProperties);
  const { data = [], isLoading } = useQuery({
    queryKey: ["client-properties", clientId],
    queryFn: () => listFn({ data: { client_id: clientId } }),
  });
  if (isLoading) return <div className="text-xs text-muted-foreground">Loading properties…</div>;
  if (data.length === 0) return <div className="text-xs text-muted-foreground">No properties yet for this client.</div>;
  return (
    <ul className="space-y-1.5">
      {data.map((p) => (
        <li key={p.id} className="text-sm">
          <Link
            to="/clients/$clientId"
            params={{ clientId }}
            search={{ property: p.id }}
            className="inline-flex items-center gap-2 hover:text-brand"
          >
            <MapPin className="size-3.5 text-muted-foreground" />
            <span className="font-medium">{p.label}</span>
            <span className="text-muted-foreground">{p.address}</span>
            {p.service_frequency && <span className="text-xs text-muted-foreground">· {p.service_frequency}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function NewClientDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const create = useServerFn(createClient);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    first_name: "", last_name: "", email: "", phone: "",
    billing_address: "", service_address: "",
    property_label: "", property_type: "", service_frequency: "",
    square_footage: "", bedrooms: "", bathrooms: "",
    key_location: "", access_notes: "", pets: "", parking_notes: "", special_instructions: "",
  });

  const reset = () => setForm({
    first_name: "", last_name: "", email: "", phone: "",
    billing_address: "", service_address: "",
    property_label: "", property_type: "", service_frequency: "",

    square_footage: "", bedrooms: "", bathrooms: "",
    key_location: "", access_notes: "", pets: "", parking_notes: "", special_instructions: "",
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.first_name.trim()) {
      toast.error("First name is required");
      return;
    }
    if (!form.service_address.trim()) {
      toast.error("A service address is required — it creates the client's first property");
      return;
    }
    setSaving(true);
    try {
      const created = await create({
        data: {
          property_label: form.property_label.trim() || undefined,
          property_type: form.property_type.trim() || undefined,
          property_address: form.service_address.trim() || undefined,
          service_frequency: form.service_frequency.trim() || undefined,
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          billing_address: form.billing_address.trim() || undefined,
          service_address: form.service_address.trim() || undefined,
          square_footage: form.square_footage ? Number(form.square_footage) : null,
          bedrooms: form.bedrooms ? Number(form.bedrooms) : null,
          bathrooms: form.bathrooms ? Number(form.bathrooms) : null,
          key_location: form.key_location.trim() || undefined,
          access_notes: form.access_notes.trim() || undefined,
          pets: form.pets.trim() || undefined,
          parking_notes: form.parking_notes.trim() || undefined,
          special_instructions: form.special_instructions.trim() || undefined,
        },
      });
      toast.success("Client created");
      qc.invalidateQueries({ queryKey: ["clients"] });
      reset();
      onOpenChange(false);
      if (created?.id) navigate({ to: "/clients/$clientId", params: { clientId: created.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const upd = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New client</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-6">
          <section className="space-y-3">
            <h4 className="text-xs uppercase tracking-wider text-muted-foreground">Contact</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="First name *"><Input value={form.first_name} onChange={upd("first_name")} required /></Field>
              <Field label="Last name"><Input value={form.last_name} onChange={upd("last_name")} /></Field>
              <Field label="Email"><Input type="email" value={form.email} onChange={upd("email")} /></Field>
              <Field label="Phone"><Input value={form.phone} onChange={upd("phone")} /></Field>
            </div>
          </section>

          <section className="space-y-3">
            <h4 className="text-xs uppercase tracking-wider text-muted-foreground">First property / location</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Property name"><Input value={form.property_label} onChange={upd("property_label")} placeholder="Home, Beach Bum…" /></Field>
              <Field label="Property type"><Input value={form.property_type} onChange={upd("property_type")} placeholder="Residence, Airbnb…" /></Field>
              <Field label="Service frequency"><Input value={form.service_frequency} onChange={upd("service_frequency")} placeholder="Weekly, bi-weekly…" /></Field>
            </div>
            <Field label="Service address *"><Textarea rows={2} value={form.service_address} onChange={upd("service_address")} /></Field>
            <Field label="Billing address"><Textarea rows={2} value={form.billing_address} onChange={upd("billing_address")} placeholder="Leave blank if same as service" /></Field>
          </section>

          <section className="space-y-3">
            <h4 className="text-xs uppercase tracking-wider text-muted-foreground">Property specs (optional)</h4>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Sq. ft."><Input type="number" min={0} value={form.square_footage} onChange={upd("square_footage")} /></Field>
              <Field label="Bedrooms"><Input type="number" min={0} value={form.bedrooms} onChange={upd("bedrooms")} /></Field>
              <Field label="Bathrooms"><Input type="number" step="0.5" min={0} value={form.bathrooms} onChange={upd("bathrooms")} /></Field>
            </div>
            <Field label="Key location"><Input value={form.key_location} onChange={upd("key_location")} placeholder="Lockbox 1234, under mat, etc." /></Field>
            <Field label="Access notes"><Textarea rows={2} value={form.access_notes} onChange={upd("access_notes")} /></Field>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Pets"><Input value={form.pets} onChange={upd("pets")} placeholder="Friendly dog, cat in bedroom, etc." /></Field>
              <Field label="Parking"><Input value={form.parking_notes} onChange={upd("parking_notes")} /></Field>
            </div>
            <Field label="Special instructions"><Textarea rows={3} value={form.special_instructions} onChange={upd("special_instructions")} /></Field>
          </section>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving} className="bg-brand text-brand-foreground hover:opacity-90">
              {saving ? "Saving…" : "Create client"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

// helpers used above for icon imports (kept to keep lucide tree-shakable)
void Mail; void Phone;
