import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { PageHeader } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageSquare, Send, User } from "lucide-react";
import {
  listConversations,
  getThread,
  markThreadRead,
  sendSms,
  type ConversationRow,
  type SmsMessageRow,
} from "@/lib/sms.functions";

export const Route = createFileRoute("/_authenticated/messages")({
  validateSearch: (search: Record<string, unknown>) => ({
    clientId: typeof search.clientId === "string" ? search.clientId : undefined,
    phone: typeof search.phone === "string" ? search.phone : undefined,
    name: typeof search.name === "string" ? search.name : undefined,
  }),
  component: MessagesPage,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-destructive">{error.message}</div>
  ),
});

type Selection = { client_id: string | null; counterparty_number: string };

function MessagesPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listConversations);
  const threadFn = useServerFn(getThread);
  const markReadFn = useServerFn(markThreadRead);
  const sendFn = useServerFn(sendSms);

  const deepLink = Route.useSearch();
  const [selected, setSelected] = useState<Selection | null>(
    deepLink.clientId && deepLink.phone
      ? { client_id: deepLink.clientId, counterparty_number: deepLink.phone }
      : null,
  );
  const [draft, setDraft] = useState("");

  const { data: conversations = [], isLoading } = useQuery<ConversationRow[]>({
    queryKey: ["sms-conversations"],
    queryFn: () => listFn(),
    refetchInterval: 15_000,
  });

  const threadKey = selected ? (selected.client_id ?? selected.counterparty_number) : null;
  const { data: thread = [] } = useQuery<SmsMessageRow[]>({
    queryKey: ["sms-thread", threadKey],
    queryFn: () =>
      threadFn({
        data: {
          client_id: selected!.client_id,
          counterparty_number: selected!.counterparty_number,
        },
      }),
    enabled: !!selected,
    refetchInterval: selected ? 10_000 : false,
  });

  useEffect(() => {
    if (!selected) return;
    markReadFn({
      data: { client_id: selected.client_id, counterparty_number: selected.counterparty_number },
    })
      .then(() => qc.invalidateQueries({ queryKey: ["sms-conversations"] }))
      .catch(() => {});
  }, [selected?.client_id, selected?.counterparty_number]);

  const selectedConvo = useMemo(
    () =>
      conversations.find((c) => (selected?.client_id ?? selected?.counterparty_number) === c.key),
    [conversations, selected],
  );

  const onSend = async () => {
    if (!selected || !draft.trim()) return;
    const body = draft;
    setDraft("");
    try {
      await sendFn({
        data: {
          client_id: selected.client_id,
          to_number: selected.client_id ? null : selected.counterparty_number,
          body,
        },
      });
      qc.invalidateQueries({ queryKey: ["sms-thread", threadKey] });
      qc.invalidateQueries({ queryKey: ["sms-conversations"] });
    } catch (err) {
      setDraft(body);
      toast.error(err instanceof Error ? err.message : "Failed to send");
    }
  };

  return (
    <>
      <PageHeader
        title="Messages"
        subtitle="Shared SMS inbox — every manager sees the same thread"
      />
      <div className="max-w-6xl mx-auto w-full px-4 sm:px-6 md:px-8 py-6">
        <div className="bg-card rounded-xl ring-1 ring-black/5 overflow-hidden flex h-[calc(100vh-220px)] min-h-[420px]">
          <div className="w-full sm:w-72 border-r border-border/60 overflow-y-auto shrink-0">
            {isLoading ? (
              <div className="p-6 text-sm text-muted-foreground">Loading…</div>
            ) : conversations.length === 0 ? (
              <div className="p-8 text-center">
                <MessageSquare className="size-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No conversations yet.</p>
              </div>
            ) : (
              conversations.map((c) => {
                const active = (selected?.client_id ?? selected?.counterparty_number) === c.key;
                return (
                  <button
                    key={c.key}
                    onClick={() =>
                      setSelected({
                        client_id: c.client_id,
                        counterparty_number: c.counterparty_number,
                      })
                    }
                    className={`w-full text-left px-4 py-3 border-b border-border/40 transition-colors ${
                      active ? "bg-brand/5" : "hover:bg-clay-100/50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">
                        {c.client_name ?? c.counterparty_number}
                      </span>
                      {c.unread_count > 0 && (
                        <Badge className="bg-brand text-brand-foreground shrink-0">
                          {c.unread_count}
                        </Badge>
                      )}
                    </div>
                    {!c.client_name && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">Unmatched number</p>
                    )}
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {c.last_direction === "outbound" ? "You: " : ""}
                      {c.last_message}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {formatDistanceToNow(new Date(c.last_message_at), { addSuffix: true })}
                    </p>
                  </button>
                );
              })
            )}
          </div>

          <div className="hidden sm:flex flex-1 flex-col min-w-0">
            {!selected ? (
              <div className="flex-1 grid place-items-center text-sm text-muted-foreground">
                Select a conversation
              </div>
            ) : (
              <>
                <div className="px-5 py-3 border-b border-border/60 flex items-center gap-2">
                  <User className="size-4 text-muted-foreground" />
                  <span className="font-medium text-sm">
                    {selectedConvo?.client_name ?? deepLink.name ?? selected.counterparty_number}
                  </span>
                  {selectedConvo?.client_name && (
                    <span className="text-xs text-muted-foreground">
                      {selected.counterparty_number}
                    </span>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto p-5 space-y-3">
                  {thread.map((m) => (
                    <div
                      key={m.id}
                      className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${
                          m.direction === "outbound"
                            ? "bg-brand text-brand-foreground rounded-br-sm"
                            : "bg-clay-100 text-foreground rounded-bl-sm"
                        }`}
                      >
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        <p
                          className={`text-[10px] mt-1 ${m.direction === "outbound" ? "text-brand-foreground/70" : "text-muted-foreground"}`}
                        >
                          {format(new Date(m.created_at), "p")}
                          {m.direction === "outbound" && m.status && ` · ${m.status}`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="p-4 border-t border-border/60 flex gap-2">
                  <textarea
                    className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none"
                    rows={1}
                    placeholder="Type a message…"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        onSend();
                      }
                    }}
                  />
                  <Button onClick={onSend} disabled={!draft.trim()}>
                    <Send className="size-4" />
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
