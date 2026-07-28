import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AppShell, PageHeader } from "@/components/app-shell";
import {
  amIClientChatCapable,
  getClientChatThread,
  listClientChats,
  markClientChatRead,
  sendClientChatMessage,
} from "@/lib/client-chat.functions";
import { MessageSquare, Send, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/_authenticated/client-chat")({
  component: ClientChatPage,
  head: () => ({
    meta: [
      { title: "Client Chat — WRRCS" },
      { name: "description", content: "Manager inbox for client portal messages." },
    ],
  }),
});

function ClientChatPage() {
  const capabilityFn = useServerFn(amIClientChatCapable);
  const listFn = useServerFn(listClientChats);
  const threadFn = useServerFn(getClientChatThread);
  const readFn = useServerFn(markClientChatRead);
  const sendFn = useServerFn(sendClientChatMessage);
  const qc = useQueryClient();

  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: cap, isLoading: capLoading } = useQuery({
    queryKey: ["client-chat-capable"],
    queryFn: () => capabilityFn(),
  });

  const capable = !!cap?.capable;

  const { data: conversations = [] } = useQuery({
    queryKey: ["client-chat-list"],
    queryFn: () => listFn(),
    enabled: capable,
    refetchInterval: 20_000,
  });

  const { data: thread = [] } = useQuery({
    queryKey: ["client-chat-thread", selected],
    queryFn: () => threadFn({ data: { client_id: selected! } }),
    enabled: !!selected && capable,
    refetchInterval: 10_000,
  });

  const markRead = useMutation({
    mutationFn: (client_id: string) => readFn({ data: { client_id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["client-chat-list"] }),
  });

  const send = useMutation({
    mutationFn: (body: string) =>
      sendFn({ data: { client_id: selected!, body } }),
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["client-chat-thread", selected] });
      qc.invalidateQueries({ queryKey: ["client-chat-list"] });
    },
  });

  useEffect(() => {
    if (selected) markRead.mutate(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [thread]);

  if (!capLoading && !capable) {
    return (
      <AppShell>
        <PageHeader title="Client chat" />
        <div className="max-w-2xl mx-auto p-8">
          <div className="rounded-xl border border-border/60 bg-clay-100 p-6 flex gap-3">
            <ShieldAlert className="size-5 text-brand shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium">Access restricted</p>
              <p className="text-muted-foreground mt-1">
                Only owners and managers with the <em>Manage Clients & Employees</em>{" "}
                permission can view client portal messages.
              </p>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title="Client chat"
        subtitle="Messages from clients using the portal."
      />
      <div className="flex-1 flex min-h-0">
        <aside className="w-80 border-r border-border/60 overflow-y-auto shrink-0">
          {conversations.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No client messages yet.
            </div>
          ) : (
            <ul>
              {conversations.map((c) => {
                const active = c.client_id === selected;
                return (
                  <li key={c.client_id}>
                    <button
                      onClick={() => setSelected(c.client_id)}
                      className={`w-full text-left px-4 py-3 border-b border-border/40 hover:bg-clay-100 transition-colors ${active ? "bg-clay-100" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-sm truncate">{c.client_name}</p>
                        {c.unread_count > 0 && (
                          <span className="bg-brand text-brand-foreground text-[10px] font-medium rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                            {c.unread_count}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-1">
                        {c.last_sender === "business" ? "You: " : ""}
                        {c.last_message}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {new Date(c.last_message_at).toLocaleString()}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section className="flex-1 flex flex-col min-w-0">
          {!selected ? (
            <div className="flex-1 grid place-items-center text-sm text-muted-foreground">
              <div className="text-center">
                <MessageSquare className="size-8 mx-auto mb-2 opacity-40" />
                Select a conversation to begin.
              </div>
            </div>
          ) : (
            <>
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-3">
                {thread.map((m) => {
                  const mine = m.sender_type === "business";
                  return (
                    <div
                      key={m.id}
                      className={`flex ${mine ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-md rounded-2xl px-4 py-2 text-sm ${
                          mine
                            ? "bg-brand text-brand-foreground"
                            : "bg-clay-200/70"
                        }`}
                      >
                        {!mine && (
                          <p className="text-[10px] font-medium mb-0.5 opacity-70">
                            Client
                          </p>
                        )}
                        {mine && m.sender_name && (
                          <p className="text-[10px] font-medium mb-0.5 opacity-70">
                            {m.sender_name}
                          </p>
                        )}
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        <p className="text-[10px] mt-1 opacity-60">
                          {new Date(m.created_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  );
                })}
                {thread.length === 0 && (
                  <p className="text-center text-sm text-muted-foreground">
                    No messages yet.
                  </p>
                )}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const body = draft.trim();
                  if (!body || send.isPending) return;
                  send.mutate(body);
                }}
                className="border-t border-border/60 p-4 flex gap-2"
              >
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Reply to client…"
                  className="flex-1 rounded-lg border border-border/60 bg-clay-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
                />
                <button
                  type="submit"
                  disabled={!draft.trim() || send.isPending}
                  className="inline-flex items-center gap-2 bg-brand text-brand-foreground text-sm font-medium rounded-lg px-4 py-2 disabled:opacity-50"
                >
                  <Send className="size-4" />
                  Send
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </AppShell>
  );
}
