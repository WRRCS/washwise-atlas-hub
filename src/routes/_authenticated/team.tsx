import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import {
  listTeamRoster,
  listTeamThreads,
  listTeamMessages,
  sendTeamMessage,
  type TeamMember,
  type TeamThread,
} from "@/lib/team.functions";
import { Mail, Phone, Send } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/team")({
  component: TeamPage,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-destructive">{error.message}</div>
  ),
});

function TeamPage() {
  return (
    <AppShell>
      <PageHeader title="Team" subtitle="Your teammates and internal messages" />
      <div className="max-w-5xl w-full mx-auto px-6 md:px-8 py-6">
        <RosterView />
      </div>
    </AppShell>
  );
}

function initialsOf(name: string | null) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

function RosterView() {
  const rosterFn = useServerFn(listTeamRoster);
  const q = useQuery({ queryKey: ["team-roster"], queryFn: () => rosterFn() });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const members = q.data ?? [];
  if (!members.length)
    return <p className="text-sm text-muted-foreground">No teammates yet.</p>;

  // Contact visibility is enforced server-side — email/phone are null when
  // the viewer isn't allowed to see them.
  const anyContact = members.some((m) => m.email || m.phone);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {members.map((m) => (
        <RosterCard key={m.id} member={m} showContact={anyContact} />
      ))}
    </div>
  );
}

function RosterCard({ member, showContact }: { member: TeamMember; showContact: boolean }) {
  return (
    <article className="bg-clay-50 border border-border/60 rounded-xl p-4 ring-1 ring-black/5 flex items-center gap-4">
      <div className="size-12 rounded-full bg-clay-200 overflow-hidden grid place-items-center text-sm font-medium shrink-0">
        {member.avatar_url ? (
          <img src={member.avatar_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <span>{initialsOf(member.full_name)}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium truncate">{member.full_name ?? "—"}</p>
        <p className="text-xs text-muted-foreground capitalize">{member.role}</p>
        {showContact && (member.email || member.phone) && (
          <div className="mt-1 space-y-0.5">
            {member.email && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                <Mail className="size-3 shrink-0" /> {member.email}
              </p>
            )}
            {member.phone && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Phone className="size-3 shrink-0" /> {member.phone}
              </p>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function MessagesView() {
  const qc = useQueryClient();
  const threadsFn = useServerFn(listTeamThreads);
  const messagesFn = useServerFn(listTeamMessages);
  const sendFn = useServerFn(sendTeamMessage);
  const rosterFn = useServerFn(listTeamRoster);

  const [meId, setMeId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMeId(data.user?.id ?? null));
  }, []);

  const rosterQ = useQuery({ queryKey: ["team-roster"], queryFn: () => rosterFn() });
  const threadsQ = useQuery({
    queryKey: ["team-threads"],
    queryFn: () => threadsFn(),
    refetchInterval: 15_000,
  });

  // Selection: undefined = none yet, null = broadcast, string = peer id
  const [selected, setSelected] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (selected === undefined && threadsQ.data) {
      // Default to broadcast so a first-time user always has a thread open.
      setSelected(null);
    }
  }, [threadsQ.data, selected]);

  const mergedThreads = useMemo<TeamThread[]>(() => {
    const base = threadsQ.data ?? [];
    const hasBroadcast = base.some((t) => t.peer_id === null);
    return hasBroadcast
      ? base
      : [
          { peer_id: null, peer_name: null, last_body: "No messages yet", last_at: "", unread: 0 },
          ...base,
        ];
  }, [threadsQ.data]);

  const peers = useMemo(
    () => (rosterQ.data ?? []).filter((m) => m.id !== meId),
    [rosterQ.data, meId],
  );

  const activePeerId = selected === undefined ? null : selected;
  const messagesQ = useQuery({
    queryKey: ["team-messages", activePeerId ?? "__broadcast__"],
    queryFn: () => messagesFn({ data: { peer_id: activePeerId } }),
    enabled: selected !== undefined,
    refetchInterval: 10_000,
  });

  useEffect(() => {
    // After loading a thread, refresh unread counts.
    if (messagesQ.data) qc.invalidateQueries({ queryKey: ["team-threads"] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messagesQ.data]);

  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const onSend = async () => {
    if (!body.trim()) return;
    setSending(true);
    try {
      await sendFn({ data: { recipient_id: activePeerId, body: body.trim() } });
      setBody("");
      qc.invalidateQueries({
        queryKey: ["team-messages", activePeerId ?? "__broadcast__"],
      });
      qc.invalidateQueries({ queryKey: ["team-threads"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messagesQ.data]);

  return (
    <div className="grid md:grid-cols-[280px_1fr] gap-4 h-[70vh]">
      {/* Threads list */}
      <aside className="bg-clay-50 border border-border/60 rounded-xl ring-1 ring-black/5 flex flex-col overflow-hidden">
        <div className="p-3 border-b border-border/60">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Conversations
          </p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {mergedThreads.map((t) => {
            const isActive =
              (activePeerId === null && t.peer_id === null) ||
              (activePeerId !== null && t.peer_id === activePeerId);
            return (
              <button
                key={t.peer_id ?? "broadcast"}
                onClick={() => setSelected(t.peer_id)}
                className={`w-full text-left px-3 py-2 border-b border-border/40 hover:bg-clay-100 ${
                  isActive ? "bg-clay-100" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">
                    {t.peer_id === null ? "Everyone" : t.peer_name ?? "Teammate"}
                  </span>
                  {t.unread > 0 && (
                    <span className="bg-brand text-brand-foreground text-[10px] font-medium rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                      {t.unread > 99 ? "99+" : t.unread}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">{t.last_body}</p>
                {t.last_at && (
                  <p className="text-[10px] text-muted-foreground">
                    {formatDistanceToNow(new Date(t.last_at), { addSuffix: true })}
                  </p>
                )}
              </button>
            );
          })}
        </div>
        {/* Start a new direct thread */}
        <div className="p-3 border-t border-border/60">
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground block mb-1">
            Direct message
          </label>
          <select
            className="w-full text-sm bg-clay-100 border border-border/60 rounded-md px-2 py-1"
            value=""
            onChange={(e) => {
              if (e.target.value) setSelected(e.target.value);
            }}
          >
            <option value="">Choose a teammate…</option>
            {peers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name ?? "Teammate"}
              </option>
            ))}
          </select>
        </div>
      </aside>

      {/* Message pane */}
      <section className="bg-clay-50 border border-border/60 rounded-xl ring-1 ring-black/5 flex flex-col overflow-hidden">
        <div className="p-3 border-b border-border/60">
          <p className="text-sm font-medium">
            {activePeerId === null
              ? "Everyone (broadcast)"
              : peers.find((p) => p.id === activePeerId)?.full_name ??
                mergedThreads.find((t) => t.peer_id === activePeerId)?.peer_name ??
                "Teammate"}
          </p>
          <p className="text-xs text-muted-foreground">
            {activePeerId === null
              ? "Visible to every teammate in your business."
              : "Only you and this teammate can see this thread."}
          </p>
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
          {messagesQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !(messagesQ.data ?? []).length ? (
            <p className="text-sm text-muted-foreground">No messages yet.</p>
          ) : (
            (messagesQ.data ?? []).map((m) => {
              const mine = m.sender_id === meId;
              return (
                <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                      mine
                        ? "bg-brand text-brand-foreground"
                        : "bg-clay-100 text-foreground"
                    }`}
                  >
                    {!mine && (
                      <p className="text-[10px] uppercase tracking-wider opacity-70 mb-0.5">
                        {m.sender_name ?? "Teammate"}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap">{m.body}</p>
                    <p className="text-[10px] opacity-60 mt-1">
                      {formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSend();
          }}
          className="p-3 border-t border-border/60 flex gap-2"
        >
          <input
            type="text"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={
              activePeerId === null
                ? "Message the whole team…"
                : "Write a message…"
            }
            className="flex-1 bg-clay-100 border border-border/60 rounded-md px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={sending || !body.trim()}
            className="inline-flex items-center gap-1.5 bg-brand text-brand-foreground text-sm font-medium rounded-lg px-3 py-2 hover:opacity-90 disabled:opacity-50"
          >
            <Send className="size-4" /> Send
          </button>
        </form>
      </section>
    </div>
  );
}
