import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { listVoiceCalls, getVoiceCall } from "@/lib/voice.functions";

export const Route = createFileRoute("/_authenticated/voice")({
  component: VoiceCallsPage,
});

function VoiceCallsPage() {
  const fetchCalls = useServerFn(listVoiceCalls);
  const fetchOne = useServerFn(getVoiceCall);
  const calls = useQuery({ queryKey: ["voice-calls"], queryFn: () => fetchCalls() });
  const [selected, setSelected] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ["voice-call", selected],
    queryFn: () => fetchOne({ data: { id: selected! } }),
    enabled: !!selected,
  });

  const fmtDur = (s: number | null) => s ? `${Math.floor(s / 60)}m ${s % 60}s` : "—";
  const fmtDate = (d: string) => new Date(d).toLocaleString();

  return (
    <AppShell>
      <PageHeader
        title="Voice AI Calls"
        subtitle="Call log and transcripts from your AI receptionist"
        right={<Link to="/settings/voice" className="btn btn-sm">Voice settings</Link>}
      />
      <div className="max-w-6xl mx-auto p-6 md:p-8">
        <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
          <div className="bg-clay-100 rounded-lg ring-1 ring-black/5 divide-y divide-black/5 max-h-[70vh] overflow-auto">
            {calls.isLoading && <div className="p-4 text-sm">Loading…</div>}
            {calls.data && calls.data.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground">
                No calls yet. Configure your Twilio number in{" "}
                <Link to="/settings/voice" className="underline">voice settings</Link>.
              </div>
            )}
            {calls.data?.map((c: any) => (
              <button key={c.id} onClick={() => setSelected(c.id)}
                className={`w-full text-left p-3 hover:bg-white/60 ${selected === c.id ? "bg-white/80" : ""}`}>
                <div className="flex justify-between text-sm font-medium">
                  <span>{c.from_number || "Unknown"}</span>
                  <span className="text-xs text-muted-foreground">{fmtDur(c.duration_sec)}</span>
                </div>
                <div className="text-xs text-muted-foreground">{fmtDate(c.started_at)}</div>
                <div className="text-xs mt-1">
                  <span className="inline-block px-1.5 py-0.5 rounded bg-black/5">{c.status}</span>
                  {c.lead_id && <span className="ml-1 inline-block px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">lead</span>}
                </div>
              </button>
            ))}
          </div>

          <div className="bg-clay-100 rounded-lg ring-1 ring-black/5 p-4 min-h-[70vh]">
            {!selected && <div className="text-sm text-muted-foreground">Select a call to view its transcript.</div>}
            {detail.data && (
              <div className="space-y-3">
                <div className="text-sm">
                  <div><strong>From:</strong> {detail.data.call.from_number}</div>
                  <div><strong>To:</strong> {detail.data.call.to_number}</div>
                  <div><strong>Started:</strong> {fmtDate(detail.data.call.started_at)}</div>
                  <div><strong>Duration:</strong> {fmtDur(detail.data.call.duration_sec)}</div>
                  {detail.data.call.recording_url && (
                    <div><strong>Recording:</strong>{" "}
                      <a className="underline" href={detail.data.call.recording_url} target="_blank" rel="noreferrer">Listen</a>
                    </div>
                  )}
                  {detail.data.call.lead_id && (
                    <div><strong>Lead:</strong>{" "}
                      <Link to="/leads/$leadId" params={{ leadId: detail.data.call.lead_id }} className="underline">
                        Open lead
                      </Link>
                    </div>
                  )}
                </div>
                <div className="border-t border-black/10 pt-3 space-y-2 max-h-[55vh] overflow-auto">
                  {detail.data.turns.filter((t: any) => t.role !== "system").map((t: any) => (
                    <div key={t.id} className={`text-sm ${t.role === "user" ? "text-blue-900" : t.role === "tool" ? "text-purple-800" : "text-emerald-900"}`}>
                      <div className="text-xs font-medium uppercase">{t.role}{t.tool_name ? ` · ${t.tool_name}` : ""}</div>
                      {t.content && <div className="whitespace-pre-wrap">{t.content}</div>}
                      {t.tool_args && <pre className="text-xs bg-white/60 rounded p-2 mt-1">{JSON.stringify(t.tool_args, null, 2)}</pre>}
                      {t.tool_result && <pre className="text-xs bg-white/60 rounded p-2 mt-1">{JSON.stringify(t.tool_result, null, 2)}</pre>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
