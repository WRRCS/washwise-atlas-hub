import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell, PageHeader, BrandButton } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { LogIn, Pencil, ShieldCheck } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  listEmployees, inviteEmployee, updateEmployee, impersonateEmployee, setRole,
  listEmployeePermissions, setEmployeePermissions, amIOwner,
} from "@/lib/entities.functions";

export const Route = createFileRoute("/_authenticated/employees")({
  component: Employees,
  errorComponent: ({ error }) => <div className="p-8 text-sm text-destructive">{error.message}</div>,
});

type Employee = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  role: string;
  last_sign_in_at: string | null;
};

function Employees() {
  const qc = useQueryClient();
  const listFn = useServerFn(listEmployees);
  const inviteFn = useServerFn(inviteEmployee);
  const updateFn = useServerFn(updateEmployee);
  const impersonateFn = useServerFn(impersonateEmployee);
  const roleFn = useServerFn(setRole);
  const permsFn = useServerFn(listEmployeePermissions);
  const savePermsFn = useServerFn(setEmployeePermissions);
  const ownerFn = useServerFn(amIOwner);

  const { data = [] } = useQuery({ queryKey: ["employees"], queryFn: () => listFn() });
  const { data: permsData = [] } = useQuery({ queryKey: ["employee_permissions"], queryFn: () => permsFn() });
  const { data: ownerInfo } = useQuery({ queryKey: ["am_i_owner"], queryFn: () => ownerFn() });
  const isOwner = !!ownerInfo?.isOwner;
  const permsMap = new Map(
    (permsData as Array<{ employee_id: string; can_view_employee_contacts: boolean; can_view_pricing: boolean }>).map((p) => [p.employee_id, p]),
  );

  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({ full_name: "", email: "", phone: "" });
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [editForm, setEditForm] = useState({ phone: "", is_active: true, full_name: "" });
  const [saving, setSaving] = useState(false);

  const employees = (data as Employee[]).filter((e) => e.role !== "owner");
  const owners = (data as Employee[]).filter((e) => e.role === "owner");

  const savePerms = async (employee_id: string, next: { can_view_employee_contacts: boolean; can_view_pricing: boolean }) => {
    try {
      await savePermsFn({ data: { employee_id, ...next } });
      qc.invalidateQueries({ queryKey: ["employee_permissions"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update access");
    }
  };

  const submitInvite = async () => {
    setInviting(true);
    try {
      await inviteFn({ data: { ...invite, redirect_to: window.location.origin } });
      toast.success("Invitation sent");
      setInviteOpen(false);
      setInvite({ full_name: "", email: "", phone: "" });
      qc.invalidateQueries({ queryKey: ["employees"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to invite");
    } finally {
      setInviting(false);
    }
  };

  const openEdit = (e: Employee) => {
    setEditing(e);
    setEditForm({ phone: e.phone ?? "", is_active: e.is_active, full_name: e.full_name ?? "" });
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await updateFn({ data: { id: editing.id, ...editForm } });
      toast.success("Updated");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["employees"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (e: Employee) => {
    if (!confirm(`Deactivate ${e.full_name ?? e.email}? They'll keep their history but can't sign in.`)) return;
    try {
      await updateFn({ data: { id: e.id, is_active: false } });
      toast.success("Deactivated");
      qc.invalidateQueries({ queryKey: ["employees"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const reactivate = async (e: Employee) => {
    try {
      await updateFn({ data: { id: e.id, is_active: true } });
      toast.success("Reactivated");
      qc.invalidateQueries({ queryKey: ["employees"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const impersonate = async (e: Employee) => {
    if (!confirm(`Open ${e.full_name ?? e.email}'s session in a new tab? A one-time sign-in link will be generated.`)) return;
    try {
      const { url } = await impersonateFn({ data: { user_id: e.id, redirect_to: window.location.origin + "/jobs" } });
      if (url) window.open(url, "_blank", "noopener");
      else toast.error("Could not generate link");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const togglePromote = async (e: Employee) => {
    const next = e.role === "owner" ? "employee" : "owner";
    try {
      await roleFn({ data: { user_id: e.id, role: next } });
      toast.success(`Set to ${next}`);
      qc.invalidateQueries({ queryKey: ["employees"] });
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
  };

  return (
    <AppShell>
      <PageHeader
        title="Employees"
        subtitle="Cleaners on your team"
        action={<BrandButton onClick={() => setInviteOpen(true)}>Invite employee</BrandButton>}
      />
      <div className="max-w-6xl mx-auto w-full px-6 md:px-8 py-8 space-y-8">
        <Section title="Cleaners" rows={employees} empty="No cleaners yet. Invite your first team member.">
          {(e) => (
            <EmployeeRow
              e={e}
              onEdit={() => openEdit(e)}
              onImpersonate={() => impersonate(e)}
              onDeactivate={() => (e.is_active ? deactivate(e) : reactivate(e))}
              onPromote={() => togglePromote(e)}
            />
          )}
        </Section>

        {owners.length > 0 && (
          <Section title="Owners" rows={owners} empty="">
            {(e) => (
              <EmployeeRow
                e={e}
                onEdit={() => openEdit(e)}
                onImpersonate={() => impersonate(e)}
                onDeactivate={() => (e.is_active ? deactivate(e) : reactivate(e))}
                onPromote={() => togglePromote(e)}
              />
            )}
          </Section>
        )}
      </div>

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite employee</DialogTitle>
            <DialogDescription>They'll get an email with a sign-in link.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="fn">Full name</Label>
              <Input id="fn" value={invite.full_name} onChange={(e) => setInvite({ ...invite, full_name: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="em">Email</Label>
              <Input id="em" type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="ph">Phone</Label>
              <Input id="ph" value={invite.phone} onChange={(e) => setInvite({ ...invite, phone: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button onClick={submitInvite} disabled={inviting || !invite.email || !invite.full_name}>
              {inviting ? "Sending..." : "Send invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit employee</DialogTitle>
            <DialogDescription>{editing?.email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="efn">Full name</Label>
              <Input id="efn" value={editForm.full_name} onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="eph">Phone</Label>
              <Input id="eph" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={editForm.is_active} onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })} />
              Active
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Section({ title, rows, empty, children }: { title: string; rows: Employee[]; empty: string; children: (e: Employee) => React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="bg-white rounded-xl ring-1 ring-black/5 overflow-hidden">
          <div className="hidden md:grid grid-cols-[1.5fr_1.5fr_1fr_0.8fr_1fr_auto] gap-4 px-5 py-3 border-b border-border/60 text-xs uppercase tracking-wider text-muted-foreground">
            <div>Name</div><div>Email</div><div>Phone</div><div>Status</div><div>Last login</div><div></div>
          </div>
          <div className="divide-y divide-border/60">
            {rows.map((e) => (
              <div key={e.id}>{children(e)}</div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function EmployeeRow({ e, onEdit, onImpersonate, onDeactivate, onPromote }: {
  e: Employee;
  onEdit: () => void;
  onImpersonate: () => void;
  onDeactivate: () => void;
  onPromote: () => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[1.5fr_1.5fr_1fr_0.8fr_1fr_auto] gap-2 md:gap-4 items-center px-5 py-4">
      <div className="font-medium">{e.full_name ?? "—"}</div>
      <div className="text-sm text-muted-foreground truncate">{e.email}</div>
      <div className="text-sm text-muted-foreground">{e.phone ?? "—"}</div>
      <div>
        <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full ${e.is_active ? "bg-emerald-50 text-emerald-700" : "bg-clay-200 text-muted-foreground"}`}>
          {e.is_active ? "Active" : "Inactive"}
        </span>
      </div>
      <div className="text-sm text-muted-foreground">{formatLast(e.last_sign_in_at)}</div>
      <div className="flex items-center gap-2 justify-end">
        <Button size="sm" variant="ghost" onClick={onImpersonate} title="Open a sign-in link in a new tab">
          <LogIn className="size-3.5 mr-1.5" /> Impersonate
        </Button>
        <Button size="sm" variant="outline" onClick={onEdit}>
          <Pencil className="size-3.5 mr-1.5" /> Edit
        </Button>
        <Button size="sm" variant="outline" onClick={onPromote} className="hidden lg:inline-flex">
          {e.role === "owner" ? "Demote" : "Promote"}
        </Button>
        <Button size="sm" variant="outline" onClick={onDeactivate} className={e.is_active ? "text-destructive hover:text-destructive" : ""}>
          {e.is_active ? "Deactivate" : "Reactivate"}
        </Button>
      </div>
    </div>
  );
}

function formatLast(iso: string | null) {
  if (!iso) return "Never";
  const d = new Date(iso);
  const now = Date.now();
  const diff = Math.floor((now - d.getTime()) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
}
