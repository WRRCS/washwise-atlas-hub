import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Twilio POSTs call status events here (completed, failed, busy, no-answer).
// Configure in Twilio: statusCallback URL for the phone number.
export const Route = createFileRoute("/api/public/twilio/voice/$tenantId/status")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const tenantId = params.tenantId;
        const form = await request.formData();
        const callSid = String(form.get("CallSid") ?? "");
        const status = String(form.get("CallStatus") ?? "");
        const duration = Number(form.get("CallDuration") ?? 0) || null;
        const recordingUrl = String(form.get("RecordingUrl") ?? "") || null;
        const recordingSid = String(form.get("RecordingSid") ?? "") || null;

        const admin = createClient<Database>(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );

        const patch: Record<string, unknown> = { status };
        if (duration) patch.duration_sec = duration;
        if (recordingUrl) patch.recording_url = recordingUrl;
        if (recordingSid) patch.recording_sid = recordingSid;
        if (["completed", "failed", "busy", "no-answer", "canceled"].includes(status)) {
          patch.ended_at = new Date().toISOString();
        }

        await admin.from("voice_calls").update(patch as never)
          .eq("call_sid", callSid).eq("tenant_id", tenantId);

        return new Response("ok");
      },
    },
  },
});
