import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/app-shell";
import { getVoiceConfig, updateVoiceConfig } from "@/lib/voice.functions";

export const Route = createFileRoute("/_authenticated/settings/voice")({
  component: VoiceSettingsPage,
});

function VoiceSettingsPage() {
  const qc = useQueryClient();
  const fetchCfg = useServerFn(getVoiceConfig);
  const saveCfg = useServerFn(updateVoiceConfig);
  const cfg = useQuery({ queryKey: ["voice-config"], queryFn: () => fetchCfg() });

  const [form, setForm] = useState({
    enabled: false, greeting: "", system_prompt: "", voice: "Polly.Joanna",
    language: "en-US", forward_number: "", twilio_phone_number: "",
  });

  useEffect(() => {
    if (cfg.data) {
      const d: any = cfg.data;
      setForm({
        enabled: !!d.enabled,
        greeting: d.greeting ?? "",
        system_prompt: d.system_prompt ?? "",
        voice: d.voice ?? "Polly.Joanna",
        language: d.language ?? "en-US",
        forward_number: d.forward_number ?? "",
        twilio_phone_number: d.twilio_phone_number ?? "",
      });
    }
  }, [cfg.data]);

  const save = useMutation({
    mutationFn: () => saveCfg({ data: {
      enabled: form.enabled,
      greeting: form.greeting,
      system_prompt: form.system_prompt,
      voice: form.voice,
      language: form.language,
      forward_number: form.forward_number || null,
      twilio_phone_number: form.twilio_phone_number || null,
    } }),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["voice-config"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const tenantId = (cfg.data as any)?.tenant_id ?? "";
  const incomingUrl = tenantId ? `${origin}/api/public/twilio/voice/${tenantId}/incoming` : "";
  const statusUrl = tenantId ? `${origin}/api/public/twilio/voice/${tenantId}/status` : "";

  return (
    <AppShell>
      <PageHeader title="Voice AI Agent" subtitle="AI receptionist that answers calls, collects lead info, and creates leads" />
      <div className="max-w-3xl mx-auto p-6 md:p-8 space-y-6">
        {cfg.isLoading && <div>Loading…</div>}
        {cfg.data && (
          <>
            <section className="bg-clay-100 rounded-lg ring-1 ring-black/5 p-5 space-y-4">
              <label className="flex items-center gap-3">
                <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
                <span className="font-medium">Enable voice AI</span>
              </label>

              <Field label="Twilio phone number (E.164, e.g. +15555550123)">
                <input className="input w-full" value={form.twilio_phone_number}
                  onChange={(e) => setForm({ ...form, twilio_phone_number: e.target.value })} />
              </Field>

              <Field label="Greeting (spoken when call connects)">
                <textarea className="input w-full min-h-[80px]" value={form.greeting}
                  onChange={(e) => setForm({ ...form, greeting: e.target.value })} />
              </Field>

              <Field label="AI system prompt (agent behavior + business context)">
                <textarea className="input w-full min-h-[140px]" value={form.system_prompt}
                  onChange={(e) => setForm({ ...form, system_prompt: e.target.value })} />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Voice">
                  <select className="input w-full" value={form.voice} onChange={(e) => setForm({ ...form, voice: e.target.value })}>
                    <option value="Polly.Joanna">Polly Joanna (F, US)</option>
                    <option value="Polly.Matthew">Polly Matthew (M, US)</option>
                    <option value="Polly.Amy">Polly Amy (F, UK)</option>
                    <option value="Polly.Brian">Polly Brian (M, UK)</option>
                    <option value="alice">alice (default)</option>
                  </select>
                </Field>
                <Field label="Language">
                  <select className="input w-full" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
                    <option value="en-US">English (US)</option>
                    <option value="en-GB">English (UK)</option>
                    <option value="es-US">Spanish (US)</option>
                    <option value="fr-FR">French</option>
                  </select>
                </Field>
              </div>

              <Field label="Forward number for &quot;talk to a human&quot; requests (optional)">
                <input className="input w-full" value={form.forward_number}
                  onChange={(e) => setForm({ ...form, forward_number: e.target.value })}
                  placeholder="+15555550199" />
              </Field>

              <button className="btn btn-primary" disabled={save.isPending}
                onClick={() => save.mutate()}>
                {save.isPending ? "Saving…" : "Save"}
              </button>
            </section>

            <section className="bg-clay-100 rounded-lg ring-1 ring-black/5 p-5 space-y-3">
              <h2 className="font-medium">Twilio webhook URLs</h2>
              <p className="text-sm text-muted-foreground">
                In your Twilio Console, open the phone number and set these:
              </p>
              <UrlRow label="A call comes in (POST)" url={incomingUrl} />
              <UrlRow label="Status callback (POST)" url={statusUrl} />
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-sm font-medium mb-1">{label}</div>
      {children}
    </label>
  );
}

function UrlRow({ label, url }: { label: string; url: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex gap-2 items-center">
        <code className="text-xs break-all flex-1 bg-white/60 rounded px-2 py-1">{url || "…"}</code>
        <button className="btn btn-sm" onClick={() => { if (url) { navigator.clipboard.writeText(url); toast.success("Copied"); } }}>Copy</button>
      </div>
    </div>
  );
}
