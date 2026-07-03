import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell, PageHeader, BrandButton } from "@/components/app-shell";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, Clock, DollarSign } from "lucide-react";
import {
  listServiceTypes, createServiceType, updateServiceType, deleteServiceType,
} from "@/lib/entities.functions";

const servicesQO = queryOptions({
  queryKey: ["service-types"],
  queryFn: () => listServiceTypes(),
});

export const Route = createFileRoute("/_authenticated/services")({
  loader: ({ context }) => context.queryClient.ensureQueryData(servicesQO),
  component: ServicesPage,
});

type ServiceType = {
  id: string;
  name: string;
  default_duration_minutes: number;
  default_price_cents: number;
  description: string | null;
  color: string;
  active: boolean;
};

type FormState = {
  id?: string;
  name: string;
  default_duration_minutes: string;
  price_dollars: string;
  description: string;
  color: string;
};

const EMPTY: FormState = {
  name: "",
  default_duration_minutes: "120",
  price_dollars: "150",
  description: "",
  color: "#6366f1",
};

function ServicesPage() {
  const { data } = useSuspenseQuery(servicesQO);
  const router = useRouter();
  const createFn = useServerFn(createServiceType);
  const updateFn = useServerFn(updateServiceType);
  const deleteFn = useServerFn(deleteServiceType);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);

  const openNew = () => { setForm(EMPTY); setOpen(true); };
  const openEdit = (s: ServiceType) => {
    setForm({
      id: s.id,
      name: s.name,
      default_duration_minutes: String(s.default_duration_minutes),
      price_dollars: (s.default_price_cents / 100).toFixed(2),
      description: s.description ?? "",
      color: s.color,
    });
    setOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        default_duration_minutes: Number(form.default_duration_minutes),
        default_price_cents: Math.round(Number(form.price_dollars) * 100),
        description: form.description,
        color: form.color,
      };
      if (form.id) {
        await updateFn({ data: { ...payload, id: form.id } });
        toast.success("Service updated");
      } else {
        await createFn({ data: payload });
        toast.success("Service created");
      }
      setOpen(false);
      router.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (s: ServiceType) => {
    if (!confirm(`Delete "${s.name}"?`)) return;
    try {
      await deleteFn({ data: { id: s.id } });
      toast.success("Service deleted");
      router.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  const services = data as ServiceType[];

  return (
    <AppShell>
      <PageHeader
        title="Service Types"
        subtitle="Catalog of cleaning services you offer"
        action={<BrandButton onClick={openNew}>New service</BrandButton>}
      />
      <div className="max-w-6xl mx-auto w-full px-6 md:px-8 py-8">
        {services.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm">No services yet.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {services.map((s) => (
              <div key={s.id} className="bg-white rounded-xl ring-1 ring-black/5 overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                <div className="h-2" style={{ backgroundColor: s.color }} />
                <div className="p-5">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="size-3 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    <h3 className="font-medium tracking-tight truncate">{s.name}</h3>
                  </div>
                  {s.description && (
                    <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{s.description}</p>
                  )}
                  <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="size-3.5" />
                      {formatDuration(s.default_duration_minutes)}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <DollarSign className="size-3.5" />
                      {(s.default_price_cents / 100).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(s)}>
                      <Pencil className="size-3.5 mr-1.5" /> Edit
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => remove(s)} className="text-destructive hover:text-destructive">
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit service" : "New service"}</DialogTitle>
            <DialogDescription>Set the default duration and price for this service.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Residential Clean" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="dur">Duration (minutes)</Label>
                <Input id="dur" type="number" min={15} step={15} value={form.default_duration_minutes}
                  onChange={(e) => setForm({ ...form, default_duration_minutes: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="price">Price (USD)</Label>
                <Input id="price" type="number" min={0} step="0.01" value={form.price_dollars}
                  onChange={(e) => setForm({ ...form, price_dollars: e.target.value })} />
              </div>
            </div>
            <div>
              <Label htmlFor="desc">Description</Label>
              <Textarea id="desc" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="color">Color</Label>
              <div className="flex items-center gap-3">
                <input id="color" type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })}
                  className="size-10 rounded-lg border border-input cursor-pointer" />
                <Input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="flex-1" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.name.trim()}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function formatDuration(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}
