import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { xmlEscape } from "@/lib/voice-ai.server";

// Twilio POSTs here when a call comes in.
// Configure in Twilio: Phone Numbers → your number → Voice → A Call Comes In →
//   POST https://<your-domain>/api/public/twilio/voice/<tenantId>/incoming
export const Route = createFileRoute("/api/public/twilio/voice/$tenantId/incoming")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const tenantId = params.tenantId;
        const form = await request.formData();
        const callSid = String(form.get("CallSid") ?? "");
        const from = String(form.get("From") ?? "");
        const to = String(form.get("To") ?? "");

        const admin = createClient<Database>(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );

        const { data: cfg } = await admin
          .from("voice_agent_config")
          .select("enabled, greeting, voice, language, twilio_phone_number, system_prompt, forward_number")
          .eq("tenant_id", tenantId).maybeSingle();

        if (!cfg || !cfg.enabled) {
          return twiml(`<Response><Say>This number is not configured. Goodbye.</Say><Hangup/></Response>`);
        }
        // Anti-spoofing: if a phone number is configured, require it matches Twilio's "To".
        if (cfg.twilio_phone_number && cfg.twilio_phone_number !== to) {
          return twiml(`<Response><Say>Number mismatch. Goodbye.</Say><Hangup/></Response>`);
        }

        // Create the call row + seed system prompt as first turn
        const { data: call, error } = await admin.from("voice_calls").insert({
          tenant_id: tenantId, call_sid: callSid, from_number: from, to_number: to,
          direction: "inbound", status: "in-progress",
        } as never).select("id").single();
        if (error) {
          return twiml(`<Response><Say>We're having trouble. Please try again later.</Say><Hangup/></Response>`);
        }

        await admin.from("voice_call_turns").insert({
          tenant_id: tenantId, call_id: call.id, seq: 0,
          role: "system",
          content: `${cfg.system_prompt}\n\nCaller phone number on record: ${from}. Do not read it back unless asked. Keep responses under 40 words. Speak naturally.`,
        } as never);
        await admin.from("voice_call_turns").insert({
          tenant_id: tenantId, call_id: call.id, seq: 1,
          role: "assistant", content: cfg.greeting,
        } as never);

        const voice = cfg.voice || "Polly.Joanna";
        const lang = cfg.language || "en-US";
        const gatherUrl = `/api/public/twilio/voice/${tenantId}/gather`;

        const body =
`<Response>
  <Say voice="${xmlEscape(voice)}" language="${xmlEscape(lang)}">${xmlEscape(cfg.greeting)}</Say>
  <Gather input="speech" action="${gatherUrl}" method="POST" speechTimeout="auto" language="${xmlEscape(lang)}">
    <Say voice="${xmlEscape(voice)}" language="${xmlEscape(lang)}">Please go ahead.</Say>
  </Gather>
  <Say voice="${xmlEscape(voice)}" language="${xmlEscape(lang)}">I didn't hear anything. Goodbye.</Say>
  <Hangup/>
</Response>`;
        return twiml(body);
      },
    },
  },
});

function twiml(body: string): Response {
  return new Response(body, { headers: { "Content-Type": "text/xml; charset=utf-8" } });
}
