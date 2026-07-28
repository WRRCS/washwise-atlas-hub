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
  listEmployeePermissions, setEmployeePermissions, myCapabilities,
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
  const capsFn = useServerFn(myCapabilities);
  const permsFn = useServerFn(listEmployeePermissions);
  const savePermsFn = useServerFn(setEmployeePermissions);

  const { data = [] } = useQuery({ queryKey: ["employees"], queryFn: () => listFn() });
  const { data: permsData = [] } = useQuery({ queryKey: ["employee_permissions"], queryFn: () => permsFn() });
  const { data: caps } = useQuery({ queryKey: ["my-capabilities"], queryFn: () => capsFn() });
  const isOwner = !!caps?.isOwner;
  const canManage = !!(caps?.isOwner || caps?.canManage);
  const permsMap = new Map(
    (permsData as Array<{
      employee_id: string;
      can_view_employee_contacts: boolean;
      can_view_pricing: boolean;
      can_view_client_cpni: boolean;
      can_schedule: boolean;
      can_manage_clients_employees: boolean;
      can_view_wages: boolean;
    }>).map((p) => [p.employee_id, p]),
  );

  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({ full_name: "", email: "", phone: "" });
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [editForm, setEditForm] = useState({ phone: "", is_active: true, full_name: "" });
  const [saving, setSaving] = useState(false);

  const employees = (data as Employee[]).filter((e) => e.role !== "owner");
  const owners = (data as Employee[]).filter((e) => e.role === "owner");

  const savePerms = async (
    employee_id: string,
    next: {
      can_view_employee_contacts: boolean;
      can_view_pricing: boolean;
      can_view_client_cpni: boolean;
      can_schedule: boolean;
      can_manage_clients_employees: boolean;
      can_view_wages: boolean;
    },
  ) => {
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
      await inviteFn({ data: { ...invite, redirect_to: window.location.origin + "/reset-password" } });
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

  const changeRole = async (e: Employee, next: "owner" | "manager" | "employee") => {
    if (next === e.role) return;
    try {
      await roleFn({ data: { user_id: e.id, role: next } });
      toast.success(`Set to ${next}`);
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["employee_permissions"] });
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
              isOwnerViewer={isOwner}
              perms={permsMap.get(e.id) ?? null}
              onSavePerms={(next) => savePerms(e.id, next)}
              onEdit={() => openEdit(e)}
              onImpersonate={() => impersonate(e)}
              onDeactivate={() => (e.is_active ? deactivate(e) : reactivate(e))}
              onChangeRole={(r) => changeRole(e, r)}
            />
          )}
        </Section>

        {owners.length > 0 && (
          <Section title="Owners" rows={owners} empty="">
            {(e) => (
              <EmployeeRow
                e={e}
                isOwnerViewer={isOwner}
                perms={null}
                onSavePerms={() => {}}
                onEdit={() => openEdit(e)}
                onImpersonate={() => impersonate(e)}
                onDeactivate={() => (e.is_active ? deactivate(e) : reactivate(e))}
                onChangeRole={(r) => changeRole(e, r)}
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
            <DialogDescription>They'll get an email with a link to set their password and sign in.</DialogDescription>
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

type Role = "owner" | "manager" | "employee";
type PermsRow = {
  employee_id: string;
  can_view_employee_contacts: boolean;
  can_view_pricing: boolean;
  can_view_client_cpni: boolean;
  can_schedule: boolean;
  can_manage_clients_employees: boolean;
  can_view_wages: boolean;
};

const EMPTY_PERMS = {
  can_view_employee_contacts: false,
  can_view_pricing: false,
  can_view_client_cpni: false,
  can_schedule: false,
  can_manage_clients_employees: false,
  can_view_wages: false,
};

function EmployeeRow({ e, isOwnerViewer, perms, onSavePerms, onEdit, onImpersonate, onDeactivate, onChangeRole }: {
  e: Employee;
  isOwnerViewer: boolean;
  perms: PermsRow | null;
  onSavePerms: (next: typeof EMPTY_PERMS) => void;
  onEdit: () => void;
  onImpersonate: () => void;
  onDeactivate: () => void;
  onChangeRole: (r: Role) => void;
}) {
  const showAccess = isOwnerViewer && e.role !== "owner";
  const current = {
    can_view_employee_contacts: perms?.can_view_employee_contacts ?? false,
    can_view_pricing: perms?.can_view_pricing ?? false,
    can_view_client_cpni: perms?.can_view_client_cpni ?? false,
    can_schedule: perms?.can_schedule ?? false,
    can_manage_clients_employees: perms?.can_manage_clients_employees ?? false,
    can_view_wages: perms?.can_view_wages ?? false,
  };
  const activeCount = Object.values(current).filter(Boolean).length;
  const summary = activeCount === 0 ? "Default" : `${activeCount} on`;
  const roleColor =
    e.role === "owner" ? "bg-brand-orange/10 text-brand-orange" :
    e.role === "manager" ? "bg-brand-cyan/10 text-brand-cyan" :
    "bg-clay-100 text-muted-foreground";
  const toggle = (key: keyof typeof EMPTY_PERMS, v: boolean) => onSavePerms({ ...current, [key]: v });
  return (
    <div className="grid grid-cols-1 md:grid-cols-[1.5fr_1.5fr_1fr_0.8fr_1fr_auto] gap-2 md:gap-4 items-center px-5 py-4">
      <div className="font-medium flex items-center gap-2 flex-wrap">
        <span>{e.full_name ?? "—"}</span>
        <span className={`inline-flex items-center text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full ${roleColor}`}>
          {e.role}
        </span>
        {showAccess && (
          <>
            <InlinePermBadge label="Contacts" on={current.can_view_employee_contacts} />
            <InlinePermBadge label="Pricing" on={current.can_view_pricing} />
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ring-1 ring-black/10 hover:bg-clay-100 transition"
                  title="Manage access"
                >
                  <ShieldCheck className="size-3" />
                  Access • {summary}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-80" align="start">
                <div className="space-y-4">
                  <div>
                    <div className="text-sm font-medium">Access for {e.full_name ?? "this employee"}</div>
                    <div className="text-xs text-muted-foreground">
                      {e.role === "manager"
                        ? "Managers can be granted extra access as they grow into the role."
                        : "Extra permissions beyond the employee default."}
                    </div>
                  </div>
                  <PermToggle
                    label="View team contact info"
                    hint="See phone & email of other employees."
                    checked={current.can_view_employee_contacts}
                    onChange={(v) => toggle("can_view_employee_contacts", v)}
                  />
                  <PermToggle
                    label="View pricing & invoices"
                    hint="See job prices and invoice amounts."
                    checked={current.can_view_pricing}
                    onChange={(v) => toggle("can_view_pricing", v)}
                  />
                  <div className="border-t border-border/60 pt-3 space-y-4">
                    <PermToggle
                      label="Schedule & assignments"
                      hint="Create/edit jobs, assign employees, approve time off."
                      checked={current.can_schedule}
                      onChange={(v) => toggle("can_schedule", v)}
                    />
                    <PermToggle
                      label="Manage clients & employees"
                      hint="Add/edit clients and employees. Includes client-to-manager chat."
                      checked={current.can_manage_clients_employees}
                      onChange={(v) => toggle("can_manage_clients_employees", v)}
                    />
                    <PermToggle
                      label="View client contact info (CPNI)"
                      hint="See client phone, email, and billing info."
                      checked={current.can_view_client_cpni}
                      onChange={(v) => toggle("can_view_client_cpni", v)}
                    />
                    <PermToggle
                      label="View wages & hourly rates"
                      hint="See team hourly pay and labor costs. Owner-only by default."
                      checked={current.can_view_wages}
                      onChange={(v) => toggle("can_view_wages", v)}
                    />
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </>
        )}
      </div>
      <div className="text-sm text-muted-foreground truncate">{e.email ?? "—"}</div>
      <div className="text-sm text-muted-foreground">{e.phone ?? "—"}</div>
      <div>
        <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full ${e.is_active ? "bg-emerald-50 text-emerald-700" : "bg-clay-200 text-muted-foreground"}`}>
          {e.is_active ? "Active" : "Inactive"}
        </span>
      </div>
      <div className="text-sm text-muted-foreground">{formatLast(e.last_sign_in_at)}</div>
      <div className="flex items-center gap-2 justify-end flex-wrap">
        <Button size="sm" variant="ghost" onClick={onImpersonate} title="Open a sign-in link in a new tab">
          <LogIn className="size-3.5 mr-1.5" /> Impersonate
        </Button>
        <Button size="sm" variant="outline" onClick={onEdit}>
          <Pencil className="size-3.5 mr-1.5" /> Edit
        </Button>
        {isOwnerViewer && (
          <select
            value={e.role}
            onChange={(ev) => onChangeRole(ev.target.value as Role)}
            className="text-xs h-8 rounded-md border border-input bg-background px-2"
            title="Change role"
          >
            <option value="employee">Employee</option>
            <option value="manager">Manager</option>
            <option value="owner">Owner</option>
          </select>
        )}
        <Button size="sm" variant="outline" onClick={onDeactivate} className={e.is_active ? "text-destructive hover:text-destructive" : ""}>
          {e.is_active ? "Deactivate" : "Reactivate"}
        </Button>
      </div>
    </div>
  );
}

function PermToggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-sm">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function InlinePermBadge({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full ring-1 ${
        on
          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
          : "bg-clay-100 text-muted-foreground ring-black/5"
      }`}
      title={`${label}: ${on ? "On" : "Off"}`}
    >
      <span className={`size-1.5 rounded-full ${on ? "bg-emerald-500" : "bg-clay-400"}`} />
      {label} {on ? "on" : "off"}
    </span>
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
