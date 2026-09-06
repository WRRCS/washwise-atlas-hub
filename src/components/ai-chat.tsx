import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { MessageCircle, X, Send, Plus, Trash2, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import {
  sendAiMessage,
  listAiConversations,
  getAiConversation,
  deleteAiConversation,
  getAiSettings,
  type ChatMessage,
} from "@/lib/ai.functions";

const SUGGESTED = [
  "Which clients haven't booked this month?",
  "Draft a thank-you note for last week's Airbnb host",
  "Summarize my top revenue clients",
];

export function AiChat() {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [convoId, setConvoId] = useState<string | undefined>(undefined);
  const [convos, setConvos] = useState<Array<{ id: string; title: string | null; updated_at: string }>>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const send = useServerFn(sendAiMessage);
  const list = useServerFn(listAiConversations);
  const load = useServerFn(getAiConversation);
  const del = useServerFn(deleteAiConversation);
  const settings = useServerFn(getAiSettings);

  useEffect(() => {
    settings().then((s) => setEnabled(s.enabled)).catch(() => setEnabled(false));
  }, []);

  useEffect(() => {
    if (open && enabled) list().then(setConvos).catch(() => {});
  }, [open, enabled]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  const openConvo = async (id: string) => {
    const c = await load({ data: { id } });
    if (c) {
      setConvoId(c.id);
      setMessages((c.messages as ChatMessage[]) ?? []);
    }
  };

  const newConvo = () => {
    setConvoId(undefined);
    setMessages([]);
    setError(null);
  };

  const removeConvo = async (id: string) => {
    await del({ data: { id } });
    setConvos((prev) => prev.filter((c) => c.id !== id));
    if (id === convoId) newConvo();
  };

  const submit = async (text: string) => {
    if (!text.trim() || sending) return;
    setError(null);
    const optimistic: ChatMessage = { role: "user", content: text, timestamp: new Date().toISOString() };
    setMessages((m) => [...m, optimistic]);
    setInput("");
    setSending(true);
    try {
      const res = await send({ data: { message: text, conversation_id: convoId } });
      setMessages(res.messages);
      setConvoId(res.conversation_id);
      const fresh = await list();
      setConvos(fresh);
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong");
      setMessages((m) => m.slice(0, -1));
    } finally {
      setSending(false);
    }
  };

  if (enabled === false) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 md:bottom-6 right-4 md:right-6 z-30 flex items-center gap-2 bg-brand text-brand-foreground rounded-full px-4 py-3 shadow-lg hover:opacity-90 transition-opacity text-sm font-medium"
        aria-label="Ask WRRCS"
      >
        <MessageCircle className="size-4" />
        Ask WRRCS
      </button>

      {open && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-md h-full bg-clay-50 border-l border-border/60 flex flex-col shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="p-4 border-b border-border/60 flex items-center justify-between">
              <div>
                <h2 className="font-medium tracking-tight">WRRCS AI</h2>
                <p className="text-xs text-muted-foreground">Ask about your business data</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={newConvo} className="p-2 hover:bg-clay-200 rounded-md" title="New conversation">
                  <Plus className="size-4" />
                </button>
                <button onClick={() => setOpen(false)} className="p-2 hover:bg-clay-200 rounded-md">
                  <X className="size-4" />
                </button>
              </div>
            </header>

            {convos.length > 0 && (
              <div className="px-4 py-2 border-b border-border/60 max-h-32 overflow-y-auto">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Recent</p>
                <div className="space-y-0.5">
                  {convos.slice(0, 8).map((c) => (
                    <div key={c.id} className={`flex items-center gap-1 group text-xs rounded px-2 py-1 ${c.id === convoId ? "bg-brand/5 text-brand" : "hover:bg-clay-200/50"}`}>
                      <button onClick={() => openConvo(c.id)} className="flex-1 text-left truncate">
                        {c.title ?? "Untitled"}
                      </button>
                      <button onClick={() => removeConvo(c.id)} className="opacity-0 group-hover:opacity-100 p-0.5">
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Try one of these:</p>
                  {SUGGESTED.map((s) => (
                    <button
                      key={s}
                      onClick={() => submit(s)}
                      className="block w-full text-left text-sm bg-clay-100 hover:bg-clay-200/70 rounded-lg px-3 py-2 ring-1 ring-black/5 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    m.role === "user" ? "bg-brand text-brand-foreground" : "bg-clay-100 ring-1 ring-black/5"
                  }`}>
                    {m.role === "user" ? (
                      <p className="whitespace-pre-wrap">{m.content}</p>
                    ) : (
                      <div className="prose prose-sm max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1">
                        <ReactMarkdown>{m.content}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {sending && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" /> WRRCS AI is thinking…
                </div>
              )}

              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>

            <form
              onSubmit={(e) => { e.preventDefault(); submit(input); }}
              className="p-3 border-t border-border/60 flex gap-2"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask WRRCS anything…"
                className="flex-1 text-sm bg-clay-100 rounded-lg px-3 py-2 ring-1 ring-black/5 focus:outline-none focus:ring-brand"
                disabled={sending}
              />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                className="bg-brand text-brand-foreground rounded-lg px-3 py-2 disabled:opacity-40"
              >
                <Send className="size-4" />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
