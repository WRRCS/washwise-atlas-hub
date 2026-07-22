import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Twilio POSTs delivery status events here (queued, sent, delivered, failed,
// undelivered). Configure as the statusCallback URL when sending via
// sendViaTwilio (see src/lib/sms.server.ts).
export const Route = createFileRoute("/api/public/twilio/sms/$tenantId/status")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const tenantId = params.tenantId;
        const form = await request.formData();
        const sid = String(form.get("MessageSid") ?? form.get("SmsSid") ?? "");
        const status = String(form.get("MessageStatus") ?? "");

        if (sid && status) {
          const admin = createClient<Database>(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { auth: { persistSession: false, autoRefreshToken: false } },
          );
          await (admin as any)
            .from("sms_messages")
            .update({ status } as never)
            .eq("twilio_sid", sid)
            .eq("tenant_id", tenantId);
        }

        return new Response("ok");
      },
    },
  },
});
