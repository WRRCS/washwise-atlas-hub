import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { listMyMessages, sendPortalMessage, type PortalMessage } from "@/lib/portal.functions";
import { Send } from "lucide-react";

export const Route = createFileRoute("/portal/messages")({
  component: PortalMessagesPage,
});

function getSessionToken(): string {
  return localStorage.getItem("portal_session") ?? "";
}

function PortalMessagesPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listMyMessages);
  const sendFn = useServerFn(sendPortalMessage);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: messages = [] } = useQuery<PortalMessage[]>({
    queryKey: ["portal-messages"],
    queryFn: () => listFn({ data: { session_token: getSessionToken() } }),
    refetchInterval: 15_000,
  });

  const onSend = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    const body = draft;
    setDraft("");
    try {
      await sendFn({ data: { session_token: getSessionToken(), body } });
      qc.invalidateQueries({ queryKey: ["portal-messages"] });
    } catch (err) {
      setDraft(body);
      toast.error(err instanceof Error ? err.message : "Couldn't send that — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-160px)]">
      <div className="flex-1 overflow-y-auto space-y-3 pb-4">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground text-center mt-8">
            Message our team here anytime — we'll get back to you as soon as we can.
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.direction === "outbound" ? "justify-start" : "justify-end"}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${
                m.direction === "outbound"
                  ? "bg-clay-100 text-foreground rounded-bl-sm"
                  : "bg-brand text-brand-foreground rounded-br-sm"
              }`}
            >
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              <p
                className={`text-[10px] mt-1 ${m.direction === "outbound" ? "text-muted-foreground" : "text-brand-foreground/70"}`}
              >
                {format(new Date(m.created_at), "MMM d, p")}
              </p>
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2 border-t border-border/60 pt-3">
        <textarea
          className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none"
          rows={1}
          placeholder="Type a message to our team…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
        />
        <button
          onClick={onSend}
          disabled={busy || !draft.trim()}
          className="bg-brand text-brand-foreground rounded-lg px-3 py-2 disabled:opacity-50"
        >
          <Send className="size-4" />
        </button>
      </div>
    </div>
  );
}
