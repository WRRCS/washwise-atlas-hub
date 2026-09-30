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
import { LogIn, Pencil, ShieldCheck, Trash2, Copy, Archive, ArchiveRestore, Mail, MoreHorizontal, Check, Smartphone, Bell, BellOff } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import {
  listEmployees, inviteEmployee, updateEmployee, impersonateEmployee, setRole,
  listEmployeePermissions, setEmployeePermissions, myCapabilities, deleteEmployee,
  sendMagicLinkInvite, getEmployeeJobDetails, updateEmployeeJobDetails,
} from "@/lib/entities.functions";
import { AddEmployeeDialog } from "@/components/add-employee-dialog";

export const Route = createFileRoute("/_authenticated/employees")({
  component: Employees,
  errorComponent: ({ error }) => <div className="p-8 text-sm text-destructive">{(error as Error).message}</div>,
});

type Employee = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  role: string;
  has_app_access: boolean;
  has_push: boolean;
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
  const deleteFn = useServerFn(deleteEmployee);
  const getJobFn = useServerFn(getEmployeeJobDetails);
  const saveJobFn = useServerFn(updateEmployeeJobDetails);

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
  const [addOpen, setAddOpen] = useState(false);
  const [invite, setInvite] = useState<{ full_name: string; email: string; phone: string; profile_id?: string }>({ full_name: "", email: "", phone: "" });
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [editForm, setEditForm] = useState({ phone: "", is_active: true, full_name: "" });
  const [job, setJob] = useState({ start_date: "", job_title: "", rate: "", address: "" });
  const [saving, setSaving] = useState(false);

  const staff = (data as Employee[]).filter((e) => e.role !== "owner");
  const employees = staff.filter((e) => e.is_active);
  const archived = staff.filter((e) => !e.is_active);
  const owners = (data as Employee[]).filter((e) => e.role === "owner");

  const appUrl = typeof window !== "undefined" ? window.location.origin : "https://wrrcs.com";
  const inviteText = (e?: Employee) =>
    [
      "You've been added to our team app.",
      "",
      `Open ${appUrl}/auth on your phone or computer.`,
      e?.email ? `I'll email a one-tap sign-in link to ${e.email} — tap it to get in. No password needed.` : "Send me your work email and I'll email you a one-tap sign-in link. No password needed.",
    ].join("\n");

  const copyInvite = async (e?: Employee) => {
    try {
      await navigator.clipboard.writeText(inviteText(e));
      toast.success("Invite link & instructions copied");
    } catch {
      toast.error("Couldn't copy — you can select the text manually");
    }
  };

  const magicLinkFn = useServerFn(sendMagicLinkInvite);
  const emailSignInLink = async (e: Employee) => {
    if (!e.email) {
      toast.error("This employee has no email address — add one first");
      return;
    }
    try {
      await magicLinkFn({ data: { employee_id: e.id, redirect_to: `${appUrl}/` } });
      toast.success(`Sign-in link emailed to ${e.email}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send the sign-in link");
    }
  };


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
    const email = invite.email;
    try {
      const res = await inviteFn({ data: invite });
      setInviteOpen(false);
      setInvite({ full_name: "", email: "", phone: "" });
      qc.invalidateQueries({ queryKey: ["employees"] });
      if (res?.id) {
        try {
          await magicLinkFn({ data: { employee_id: res.id, redirect_to: `${appUrl}/` } });
          toast.success(`Access created — sign-in link emailed to ${email}`);
        } catch {
          toast.warning("Access created, but the sign-in link couldn't be sent — press Invite on their row to try again");
        }
      } else {
        toast.success("Employee app access created");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to invite");
    } finally {
      setInviting(false);
    }
  };

  const openEdit = (e: Employee) => {
    setEditing(e);
    setEditForm({ phone: e.phone ?? "", is_active: e.is_active, full_name: e.full_name ?? "" });
    setJob({ start_date: "", job_title: "", rate: "", address: "" });
    if (isOwner) {
      getJobFn({ data: { id: e.id } }).then((d) => setJob({
        start_date: d.start_date ?? "",
        job_title: d.job_title ?? "",
        rate: d.hourly_rate_cents != null ? (d.hourly_rate_cents / 100).toFixed(2) : "",
        address: d.address ?? "",
      })).catch(() => {});
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await updateFn({ data: { id: editing.id, ...editForm } });
      if (isOwner) {
        const rate = job.rate.trim() === "" ? null : Math.round(parseFloat(job.rate) * 100);
        await saveJobFn({ data: {
          id: editing.id,
          start_date: job.start_date || null,
          job_title: job.job_title.trim() || null,
          hourly_rate_cents: rate != null && !isNaN(rate) ? rate : null,
          address: job.address.trim() || null,
        } });
      }
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
    if (!confirm(`Archive ${e.full_name ?? e.email}? They keep all their history but can't sign in. You can restore them any time.`)) return;
    try {
      await updateFn({ data: { id: e.id, is_active: false } });
      toast.success("Moved to Archived");
      qc.invalidateQueries({ queryKey: ["employees"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const reactivate = async (e: Employee) => {
    try {
      await updateFn({ data: { id: e.id, is_active: true } });
      toast.success("Restored");
      qc.invalidateQueries({ queryKey: ["employees"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const removeEmployee = async (e: Employee) => {
    const who = e.full_name ?? e.email ?? "this person";
    if (!confirm(`Permanently delete ${who}? Their login, contact details and access are removed for good. This can't be undone.`)) return;
    const done = () => {
      toast.success("Employee deleted");
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["employee_permissions"] });
    };
    try {
      const res = await deleteFn({ data: { id: e.id } });
      if (res?.ok) {
        done();
        return;
      }
      const ok = confirm(
        `${who} has past jobs or timesheets. Deleting removes them completely — those past jobs and hours stay in your records but will no longer show a name. Archive instead if you want to keep the name on the history.\n\nDelete permanently?`,
      );
      if (!ok) return;
      await deleteFn({ data: { id: e.id, force: true } });
      done();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
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
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setAddOpen(true)}>Add employee</Button>
            <BrandButton onClick={() => { setInvite({ full_name: "", email: "", phone: "", profile_id: undefined }); setInviteOpen(true); }}>Create employee access</BrandButton>
          </div>
        }
      />
      <AddEmployeeDialog open={addOpen} onOpenChange={setAddOpen} />
      <div className="max-w-6xl mx-auto w-full px-6 md:px-8 py-8 space-y-8">

        <Section title="Team" rows={employees} empty="No team members yet. Invite your first team member.">
          {(e) => (
            <EmployeeRow
              e={e}
              isOwnerViewer={isOwner}
              perms={permsMap.get(e.id) ?? null}
              onSavePerms={(next) => savePerms(e.id, next)}
              onEdit={() => openEdit(e)}
              onImpersonate={() => impersonate(e)}
              onCopyInvite={() => copyInvite(e)}
              onEmailLink={() => emailSignInLink(e)}
              onGiveAccess={() => {
                setInvite({ full_name: e.full_name ?? "", email: e.email ?? "", phone: e.phone ?? "", profile_id: e.id });
                setInviteOpen(true);
              }}
              onDeactivate={() => (e.is_active ? deactivate(e) : reactivate(e))}
              onDelete={() => removeEmployee(e)}
              onChangeRole={(r) => changeRole(e, r)}
            />
          )}
        </Section>

        {archived.length > 0 && (
          <Section title="Archived" rows={archived} empty="">
            {(e) => (
              <EmployeeRow
                e={e}
                isOwnerViewer={isOwner}
                perms={permsMap.get(e.id) ?? null}
                onSavePerms={(next) => savePerms(e.id, next)}
                onEdit={() => openEdit(e)}
                onImpersonate={() => impersonate(e)}
                onCopyInvite={() => copyInvite(e)}
                onEmailLink={() => emailSignInLink(e)}
                onDeactivate={() => reactivate(e)}
                onDelete={() => removeEmployee(e)}
                onChangeRole={(r) => changeRole(e, r)}
              />
            )}
          </Section>
        )}

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
                onCopyInvite={() => copyInvite(e)}
                onEmailLink={() => emailSignInLink(e)}
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
            <DialogTitle>Create employee app access</DialogTitle>
            <DialogDescription>We'll create their sign-in and email them a one-tap link right away — no password needed and no Lovable account required.</DialogDescription>
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
            <p className="text-xs text-muted-foreground">
              Pressing “Create access” emails them a one-tap sign-in link straight away — nothing for you to copy and nothing for them to remember.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button onClick={submitInvite} disabled={inviting || !invite.email || !invite.full_name}>
              {inviting ? "Sending invite..." : "Send invite"}
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
            {isOwner && (
              <div className="space-y-3 rounded-md border border-border bg-muted/40 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Job details — private, owners only
                </div>
                <div>
                  <Label htmlFor="ejt">Role / position</Label>
                  <Input id="ejt" placeholder="e.g. Lead cleaner" value={job.job_title} onChange={(e) => setJob({ ...job, job_title: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="esd">Start date</Label>
                    <Input id="esd" type="date" value={job.start_date} onChange={(e) => setJob({ ...job, start_date: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="erate">Pay rate ($/hour)</Label>
                    <Input id="erate" type="number" min="0" step="0.01" value={job.rate} onChange={(e) => setJob({ ...job, rate: e.target.value })} />
                  </div>
                </div>
                <div>
                  <Label htmlFor="eaddr">Home address</Label>
                  <Input id="eaddr" value={job.address} onChange={(e) => setJob({ ...job, address: e.target.value })} />
                </div>
              </div>
            )}
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
          <div className="hidden md:grid grid-cols-[minmax(0,1.3fr)_minmax(0,1.85fr)_minmax(0,0.85fr)_minmax(0,0.55fr)_minmax(0,0.6fr)_minmax(0,0.6fr)_auto] gap-x-4 px-5 py-3 border-b border-border/60 text-xs uppercase tracking-wider text-muted-foreground">
            <div>Name</div><div>Email</div><div>Phone</div><div>Status</div><div>Alerts</div><div>Last login</div><div className="text-right">Actions</div>
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

function EmployeeRow({ e, isOwnerViewer, perms, onSavePerms, onEdit, onImpersonate, onCopyInvite, onEmailLink, onGiveAccess, onDeactivate, onDelete, onChangeRole }: {
  e: Employee;
  isOwnerViewer: boolean;
  perms: PermsRow | null;
  onSavePerms: (next: typeof EMPTY_PERMS) => void;
  onEdit: () => void;
  onImpersonate: () => void;
  onCopyInvite: () => void;
  onEmailLink: () => void;
  onGiveAccess?: () => void;
  onDeactivate: () => void;
  onDelete?: () => void;

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
    <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.85fr)_minmax(0,0.85fr)_minmax(0,0.55fr)_minmax(0,0.6fr)_minmax(0,0.6fr)_auto] gap-x-4 gap-y-3 items-center px-5 py-4">
      {/* Name, role and access */}
      <div className="min-w-0">
        <div className="font-medium truncate" title={e.full_name ?? undefined}>{e.full_name ?? "—"}</div>
        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
          <span className={`inline-flex items-center text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full ${roleColor}`}>
            {e.role}
          </span>
          {showAccess ? (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ring-1 ring-black/10 hover:bg-clay-100 transition"
                  title={`Contacts ${current.can_view_employee_contacts ? "on" : "off"} · Pricing ${current.can_view_pricing ? "on" : "off"} · Tap to manage access`}
                >
                  <ShieldCheck className="size-3 text-muted-foreground" />
                  <span>{summary}</span>
                  {activeCount > 0 && <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />}
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
          ) : (
            <span className="text-[11px] text-muted-foreground">
              {e.role === "owner" ? "Full access" : "Standard access"}
            </span>
          )}
        </div>
      </div>

      {/* Email */}
      <div className="min-w-0">
        <div className="md:hidden text-[11px] uppercase tracking-wider text-muted-foreground mb-0.5">Email</div>
        <div className="text-[13px] text-foreground/80 break-words leading-snug">{e.email ?? "—"}</div>
      </div>

      {/* Phone */}
      <div className="min-w-0">
        <div className="md:hidden text-[11px] uppercase tracking-wider text-muted-foreground mb-0.5">Phone</div>
        <div className="text-sm text-foreground/80 whitespace-nowrap">{fmtPhone(e.phone)}</div>
      </div>

      {/* Status */}
      <div>
        <div className="md:hidden text-[11px] uppercase tracking-wider text-muted-foreground mb-0.5">Status</div>
        <div className="flex flex-col items-start gap-1.5">
          <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full ${e.is_active ? "bg-emerald-50 text-emerald-700" : "bg-clay-200 text-muted-foreground"}`}>
            {e.is_active ? "Active" : "Archived"}
          </span>
          <span
            className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ring-1 ${e.has_app_access ? "bg-brand-cyan/10 text-brand-cyan ring-brand-cyan/30" : "bg-clay-100 text-muted-foreground ring-black/10"}`}
            title={e.has_app_access ? "This person has a sign-in account for the app" : "No app access yet — press Invite to email them a one-tap link"}
          >
            <Smartphone className="size-3" />
            {e.has_app_access ? "Has app" : "No app yet"}
          </span>
        </div>
      </div>

      {/* Push alerts */}
      <div>
        <div className="md:hidden text-[11px] uppercase tracking-wider text-muted-foreground mb-0.5">Alerts</div>
        <span
          className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ring-1 ${e.has_push ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-clay-100 text-muted-foreground ring-black/10"}`}
          title={e.has_push ? "Phone notifications are on — they get publish alerts" : e.has_app_access ? "Has the app but hasn't turned on notifications yet" : "No app access yet — invite them first"}
        >
          {e.has_push ? <Bell className="size-3" /> : <BellOff className="size-3" />}
          {e.has_push ? "Alerts on" : "Alerts off"}
        </span>
      </div>

      {/* Last login */}
      <div>
        <div className="md:hidden text-[11px] uppercase tracking-wider text-muted-foreground mb-0.5">Last login</div>
        <div className="text-sm text-muted-foreground">{formatLast(e.last_sign_in_at)}</div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 justify-end">
        {e.email ? (
          <Button size="sm" onClick={onEmailLink} title="Email this person a one-tap sign-in link (no password needed)">
            <Mail className="size-3.5 mr-1.5" /> Invite
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={onCopyInvite} title="No email on file — copy the app link and sign-in steps instead">
            <Copy className="size-3.5 mr-1.5" /> Invite
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="size-8" title="More actions">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {onGiveAccess && !e.has_app_access && e.role !== "owner" && (
              <DropdownMenuItem onClick={onGiveAccess}>
                <ShieldCheck className="size-4 mr-2" /> Create app access
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="size-4 mr-2" /> Edit details
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onImpersonate}>
              <LogIn className="size-4 mr-2" /> Open as this person
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDeactivate}>
              {e.is_active ? (<><Archive className="size-4 mr-2" /> Archive</>) : (<><ArchiveRestore className="size-4 mr-2" /> Restore</>)}
            </DropdownMenuItem>
            {isOwnerViewer && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-muted-foreground">Change role</DropdownMenuLabel>
                {(["employee", "manager", "owner"] as Role[]).map((r) => (
                  <DropdownMenuItem key={r} onClick={() => onChangeRole(r)}>
                    {e.role === r ? <Check className="size-3.5 mr-2" /> : <span className="size-3.5 mr-2" aria-hidden />}
                    <span className="capitalize">{r}</span>
                  </DropdownMenuItem>
                ))}
              </>
            )}
            {isOwnerViewer && onDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
                  <Trash2 className="size-4 mr-2" /> Delete permanently
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
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

// Team records are typed in by hand, so numbers arrive as "904- 718- 3914",
// "(904)7183914", "+1 904.718.3914" and everything between. Rebuild the digits
// into one readable US format; anything that isn't a US number shows as typed.
function fmtPhone(raw: string | null) {
  if (!raw) return "—";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith("1")) {
    const n = digits.slice(1);
    return `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
  }
  return raw.trim();
}
