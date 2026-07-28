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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mail, Phone, Send, Users2, Megaphone } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/team")({
  component: TeamPage,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-destructive">{error.message}</div>
  ),
});

function TeamPage() {
  return (
    <AppShell>
      <PageHeader title="Team" subtitle="Your teammates and internal chat" />
      <div className="max-w-5xl w-full mx-auto px-6 md:px-8 py-6">
        <Tabs defaultValue="roster">
          <TabsList>
            <TabsTrigger value="roster">Roster</TabsTrigger>
            <TabsTrigger value="messages">Team messages</TabsTrigger>
          </TabsList>
          <TabsContent value="roster" className="mt-4">
            <RosterView />
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
  const roster: TeamMember[] = rosterQ.data ?? [];
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
