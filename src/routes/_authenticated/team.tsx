import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { AppShell, PageHeader } from "@/components/app-shell";
import {
  listTeamRoster,
  listTeamThreads,
  listTeamMessages,
  sendTeamMessage,
  type TeamMember,
  type TeamThread,
} from "@/lib/team.functions";
import { useT } from "@/lib/i18n";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Send, Users2, Megaphone, Pencil, Search, Download, Printer, MoreVertical, Filter, Plus } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { AddEmployeeDialog } from "@/components/add-employee-dialog";
import { myCapabilities, updateEmployee } from "@/lib/entities.functions";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/_authenticated/team")({
  head: () => ({ meta: [
    { title: "Team Roster | WRRCS.com" },
    { name: "description", content: "View your team roster and internal conversations." },
    { property: "og:title", content: "Team Roster | WRRCS.com" },
    { property: "og:description", content: "View your team roster and internal conversations." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: TeamPage,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-destructive">{(error as Error).message}</div>
  ),
});

function TeamPage() {
  const t = useT();
  const capsFn = useServerFn(myCapabilities);
  const { data: caps } = useQuery({ queryKey: ["my-capabilities"], queryFn: () => capsFn() });
  const [addOpen, setAddOpen] = useState(false);
  return (
    <AppShell>
      <PageHeader
        title="Team roster"
        action={caps?.canManage ? <Button onClick={() => setAddOpen(true)}><Plus className="size-4" /> Add team member</Button> : undefined}
      />
      <AddEmployeeDialog open={addOpen} onOpenChange={setAddOpen} />
      <div className="w-full px-4 md:px-8 py-6">
        <Tabs defaultValue="roster">
          <TabsList>
            <TabsTrigger value="roster">{t("Roster")}</TabsTrigger>
            <TabsTrigger value="messages">{t("Team messages")}</TabsTrigger>
          </TabsList>
          <TabsContent value="roster" className="mt-4">
            <RosterView canManage={!!caps?.canManage} showWages={!!(caps?.isOwner || caps?.canViewWages)} />
          </TabsContent>
          <TabsContent value="messages" className="mt-4">
            <TeamMessagesView />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function initialsOf(name: string | null) {
  if (!name) return "?";
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

function RosterView({ canManage, showWages }: { canManage: boolean; showWages: boolean }) {
  const qc = useQueryClient();
  const rosterFn = useServerFn(listTeamRoster);
  const updateFn = useServerFn(updateEmployee);
  const q = useQuery({ queryKey: ["team-roster"], queryFn: () => rosterFn() });
  const ownerQ = useQuery({
    queryKey: ["viewer-is-owner"],
    queryFn: async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = await supabase.rpc("is_owner");
      return !!data;
    },
  });
  const isOwner = !!ownerQ.data;
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [form, setForm] = useState({ full_name: "", address: "", phone: "", email: "" });
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [showTerminated, setShowTerminated] = useState(false);
  const [roleFilter, setRoleFilter] = useState("all");

  const openEdit = (m: TeamMember) => {
    setEditing(m);
    setForm({
      full_name: m.full_name ?? "",
      address: m.address ?? "",
      phone: m.phone ?? "",
      email: m.email ?? "",
    });
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await updateFn({
        data: {
          id: editing.id,
          full_name: form.full_name.trim() || undefined,
          address: isOwner ? form.address.trim() : undefined,
          phone: form.phone.trim(),
          email: form.email.trim() || undefined,
        },
      });
      toast.success("Team member updated");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["team-roster"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (q.isLoading) return <p className="text-sm text-muted-foreground py-8">Loading roster…</p>;
  if (q.isError) return <p className="text-sm text-destructive py-8">Could not load the roster. Please try again.</p>;
  const members = q.data ?? [];
  const canShowContact = canManage || !!members.some((m) => m.email || m.phone);
  const roles = [...new Set(members.map((m) => m.role))].sort();
  const filtered = members
    .filter((m) => (showTerminated || m.is_active) && (roleFilter === "all" || m.role === roleFilter))
    .filter((m) => [m.full_name, m.email, m.phone].some((value) => value?.toLowerCase().includes(search.trim().toLowerCase())))
    .sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""));

  const exportRoster = () => {
    const columns = ["Team member", ...(canShowContact ? ["Email", "Phone"] : []), "Access level", ...(showWages ? ["Wage"] : []), "Status"];
    const rows = filtered.map((m) => [m.full_name ?? "", ...(canShowContact ? [m.email ?? "", m.phone ?? ""] : []), m.role, ...(showWages ? [m.hourly_rate_cents == null ? "" : (m.hourly_rate_cents / 100).toFixed(2)] : []), m.is_active ? "Active" : "Terminated"]);
    const csv = [columns, ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "team-roster.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="border border-border bg-card rounded-md overflow-hidden print:border-0">
        <div className="flex flex-wrap items-center gap-3 p-3 md:p-4 border-b border-border print:hidden">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <Input aria-label="Search team members" placeholder="Search team members…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <span className="text-sm text-muted-foreground tabular-nums">{filtered.length} team member{filtered.length === 1 ? "" : "s"}</span>
          <div className="flex items-center gap-2 sm:ml-auto">
            <Switch id="show-terminated" checked={showTerminated} onCheckedChange={setShowTerminated} />
            <Label htmlFor="show-terminated" className="text-sm whitespace-nowrap">Show terminated</Label>
          </div>
          <div className="w-36">
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger aria-label="Filter by access level"><Filter className="size-4 shrink-0 mr-1" /><SelectValue placeholder="Filter" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                {roles.map((role) => <SelectItem key={role} value={role} className="capitalize">{role.replaceAll("_", " ")}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button size="icon" variant="ghost" aria-label="Download roster" title="Download roster" onClick={exportRoster}><Download className="size-4" /></Button>
          <Button size="icon" variant="ghost" aria-label="Print roster" title="Print roster" onClick={() => window.print()}><Printer className="size-4" /></Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[660px] text-left text-sm">
            <thead className="border-b border-border text-xs font-medium text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Team member</th>
                {canShowContact && <th scope="col" className="px-4 py-3 font-medium">Contact information</th>}
                <th scope="col" className="px-4 py-3 font-medium">Access level</th>
                {showWages && <th scope="col" className="px-4 py-3 font-medium">Wage</th>}
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                {canManage && <th scope="col" className="w-12 px-3 py-3 font-medium print:hidden"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((member) => (
                <tr key={member.id} className="hover:bg-muted/40 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3 min-w-36">
                      <div className="size-8 shrink-0 rounded-full bg-secondary grid place-items-center overflow-hidden text-xs font-semibold text-secondary-foreground">
                        {member.avatar_url ? <img src={member.avatar_url} alt="" className="size-full object-cover" /> : initialsOf(member.full_name)}
                      </div>
                      {canManage ? <Button variant="link" className="h-auto p-0 text-left font-medium" onClick={() => openEdit(member)}>{member.full_name ?? "—"}</Button> : <span className="font-medium">{member.full_name ?? "—"}</span>}
                    </div>
                  </td>
                  {canShowContact && <td className="px-4 py-3 text-foreground">
                    <div className="space-y-0.5 break-all">
                      <div>{member.email ?? "—"}</div>
                      {member.phone && <div className="text-muted-foreground">{member.phone}</div>}
                    </div>
                  </td>}
                  <td className="px-4 py-3 capitalize">{member.role.replaceAll("_", " ")}</td>
                  {showWages && <td className="px-4 py-3 tabular-nums whitespace-nowrap">{member.hourly_rate_cents == null ? "—" : `$${(member.hourly_rate_cents / 100).toFixed(2)}/hr`}</td>}
                  <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${member.is_active ? "bg-success/15 text-foreground" : "bg-muted text-muted-foreground"}`}>{member.is_active ? "Active" : "Terminated"}</span></td>
                  {canManage && <td className="px-3 py-3 print:hidden">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label={`Actions for ${member.full_name ?? "team member"}`}><MoreVertical className="size-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => openEdit(member)}><Pencil className="size-4" /> Edit details</DropdownMenuItem></DropdownMenuContent>
                    </DropdownMenu>
                  </td>}
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={3 + Number(canShowContact) + Number(showWages) + Number(canManage)} className="px-4 py-12 text-center text-muted-foreground">{members.length ? "No team members match your search." : "No team members yet."}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {editing?.full_name ?? "team member"}</DialogTitle>
            <DialogDescription>Update their contact details.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="tm-name">Name</Label>
              <Input id="tm-name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </div>
            {isOwner && (
              <div className="space-y-1.5">
                <Label htmlFor="tm-address">Address (private — owners only)</Label>
                <Input id="tm-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Street, city, state, zip" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="tm-phone">Phone number</Label>
              <Input id="tm-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tm-email">Email</Label>
              <Input id="tm-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type SelectedThread = { peer_id: string | null; peer_name: string | null };

function TeamMessagesView() {
  const qc = useQueryClient();
  const threadsFn = useServerFn(listTeamThreads);
  const rosterFn = useServerFn(listTeamRoster);

  const threadsQ = useQuery({
    queryKey: ["team-threads"],
    queryFn: () => threadsFn(),
    refetchInterval: 20_000,
  });
  const rosterQ = useQuery({
    queryKey: ["team-roster"],
    queryFn: () => rosterFn(),
  });

  const [selected, setSelected] = useState<SelectedThread>({
    peer_id: null,
    peer_name: null,
  });
  const [composeOpen, setComposeOpen] = useState(false);

  // Merge existing threads with roster so every teammate is reachable even
  // if there's no prior message history.
  const threads: TeamThread[] = threadsQ.data ?? [];
  // Archived/terminated staff stay out of conversations and the composer.
  const roster: TeamMember[] = (rosterQ.data ?? []).filter((m) => m.is_active);
  const seen = new Set(threads.map((t) => t.peer_id));
  const combined: TeamThread[] = [
    threads.find((t) => t.peer_id === null) ?? {
      peer_id: null,
      peer_name: null,
      last_body: "Broadcast to the whole team",
      last_at: "",
      unread: 0,
    },
    ...threads.filter((t) => t.peer_id !== null),
    ...roster
      .filter((m) => !seen.has(m.id))
      .map<TeamThread>((m) => ({
        peer_id: m.id,
        peer_name: m.full_name,
        last_body: "",
        last_at: "",
        unread: 0,
      })),
  ];

  const refreshThreads = () => qc.invalidateQueries({ queryKey: ["team-threads"] });

  return (
    <div className="grid gap-4 md:grid-cols-[280px_1fr]">
      <aside className="bg-clay-50 border border-border/60 rounded-xl ring-1 ring-black/5 overflow-hidden">
        <div className="p-3 border-b border-border/60 flex items-center justify-between">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Conversations
          </p>
          <button
            type="button"
            onClick={() => setComposeOpen((v) => !v)}
            className="text-[11px] text-brand hover:underline"
          >
            {composeOpen ? "Cancel" : "New"}
          </button>
        </div>
        {composeOpen && (
          <NewThreadPicker
            roster={roster}
            onPick={(pick) => {
              setSelected(pick);
              setComposeOpen(false);
            }}
          />
        )}
        <ul className="max-h-[60vh] overflow-y-auto divide-y divide-border/60">
          {combined.map((t) => {
            const active =
              selected.peer_id === t.peer_id ||
              (selected.peer_id === null && t.peer_id === null);
            const isBroadcast = t.peer_id === null;
            return (
              <li key={t.peer_id ?? "__broadcast__"}>
                <button
                  type="button"
                  onClick={() =>
                    setSelected({ peer_id: t.peer_id, peer_name: t.peer_name })
                  }
                  className={`w-full text-left px-3 py-2.5 flex items-center gap-2 transition-colors ${
                    active ? "bg-brand/5" : "hover:bg-clay-100"
                  }`}
                >
                  <div className="size-8 rounded-full bg-clay-200 grid place-items-center text-xs shrink-0">
                    {isBroadcast ? (
                      <Megaphone className="size-4 text-muted-foreground" />
                    ) : (
                      initialsOf(t.peer_name)
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium truncate">
                        {isBroadcast ? "Everyone" : t.peer_name ?? "Teammate"}
                      </p>
                      {t.unread > 0 && (
                        <span className="bg-brand text-brand-foreground text-[10px] rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                          {t.unread > 99 ? "99+" : t.unread}
                        </span>
                      )}
                    </div>
                    {t.last_body && (
                      <p className="text-xs text-muted-foreground truncate">
                        {t.last_body}
                      </p>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
      <ThreadView
        key={selected.peer_id ?? "__broadcast__"}
        peerId={selected.peer_id}
        peerName={selected.peer_name}
        onSent={refreshThreads}
      />
    </div>
  );
}

function NewThreadPicker({
  roster,
  onPick,
}: {
  roster: TeamMember[];
  onPick: (t: SelectedThread) => void;
}) {
  return (
    <div className="p-2 border-b border-border/60 bg-clay-100/60 max-h-52 overflow-y-auto">
      <button
        type="button"
        onClick={() => onPick({ peer_id: null, peer_name: null })}
        className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-clay-200/70 flex items-center gap-2"
      >
        <Megaphone className="size-3.5 text-muted-foreground" /> Everyone
      </button>
      {roster.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => onPick({ peer_id: m.id, peer_name: m.full_name })}
          className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-clay-200/70 flex items-center gap-2"
        >
          <Users2 className="size-3.5 text-muted-foreground" />
          {m.full_name ?? "—"}
        </button>
      ))}
    </div>
  );
}

function ThreadView({
  peerId,
  peerName,
  onSent,
}: {
  peerId: string | null;
  peerName: string | null;
  onSent: () => void;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listTeamMessages);
  const sendFn = useServerFn(sendTeamMessage);
  const [body, setBody] = useState("");
  const scrollerRef = useRef<HTMLDivElement>(null);

  const q = useQuery({
    queryKey: ["team-messages", peerId ?? "__broadcast__"],
    queryFn: () => listFn({ data: { peer_id: peerId } }),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [q.data]);

  const onSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;
    try {
      await sendFn({ data: { recipient_id: peerId, body: trimmed } });
      setBody("");
      qc.invalidateQueries({
        queryKey: ["team-messages", peerId ?? "__broadcast__"],
      });
      onSent();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send");
    }
  };

  return (
    <section className="bg-clay-50 border border-border/60 rounded-xl ring-1 ring-black/5 flex flex-col min-h-[60vh]">
      <header className="px-4 py-3 border-b border-border/60 flex items-center gap-2">
        {peerId === null ? (
          <>
            <Megaphone className="size-4 text-muted-foreground" />
            <p className="font-medium text-sm">Everyone · broadcast</p>
          </>
        ) : (
          <>
            <Users2 className="size-4 text-muted-foreground" />
            <p className="font-medium text-sm">{peerName ?? "Teammate"}</p>
          </>
        )}
      </header>
      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (q.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No messages yet — say hi.</p>
        ) : (
          (q.data ?? []).map((m) => (
            <div key={m.id} className="text-sm">
              <div className="flex items-baseline gap-2">
                <span className="font-medium">{m.sender_name ?? "—"}</span>
                <span className="text-[11px] text-muted-foreground">
                  {format(new Date(m.created_at), "MMM d, h:mma")}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-foreground">{m.body}</p>
            </div>
          ))
        )}
      </div>
      <form
        onSubmit={onSend}
        className="border-t border-border/60 p-3 flex items-end gap-2"
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend(e as unknown as React.FormEvent);
            }
          }}
          rows={1}
          placeholder={
            peerId === null
              ? "Message the whole team…"
              : `Message ${peerName ?? "teammate"}…`
          }
          className="flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40"
        />
        <button
          type="submit"
          disabled={!body.trim()}
          className="inline-flex items-center gap-1 bg-brand text-brand-foreground text-sm font-medium rounded-lg px-3 py-2 disabled:opacity-40"
        >
          <Send className="size-4" /> Send
        </button>
      </form>
    </section>
  );
}
