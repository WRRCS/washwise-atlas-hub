import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { normalizePhoneE164 } from "@/lib/phone";

// Twilio POSTs here when a client texts the tenant's number.
// Configure in Twilio: Phone Numbers → your number → Messaging →
// "A Message Comes In" → POST https://<your-domain>/api/public/twilio/sms/<tenantId>/incoming
export const Route = createFileRoute("/api/public/twilio/sms/$tenantId/incoming")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const tenantId = params.tenantId;
        const form = await request.formData();
        const from = String(form.get("From") ?? "");
        const to = String(form.get("To") ?? "");
        const body = String(form.get("Body") ?? "");
        const sid = String(form.get("MessageSid") ?? "");

        const admin = createClient<Database>(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );

        // Anti-spoofing: confirm this tenant owns the "To" number. Same
        // pattern as the existing voice.$tenantId.incoming.ts webhook —
        // SMS shares the tenant's Twilio number stored on voice_agent_config.
        const { data: cfg } = await admin
          .from("voice_agent_config")
          .select("twilio_phone_number")
          .eq("tenant_id", tenantId)
          .maybeSingle();

        const normalizedTo = normalizePhoneE164(to);
        if (
          !cfg?.twilio_phone_number ||
          normalizePhoneE164(cfg.twilio_phone_number) !== normalizedTo
        ) {
          return twiml();
        }

        // Match the sender to an existing client. clients.phone is free-text
        // (e.g. "(555) 555-0100") while Twilio's "From" is always E.164, so
        // normalize both sides before comparing rather than a raw eq() match.
        const normalizedFrom = normalizePhoneE164(from);
        let clientId: string | null = null;
        if (normalizedFrom) {
          const { data: candidates } = await admin
            .from("clients")
            .select("id, phone")
            .eq("tenant_id", tenantId)
            .not("phone", "is", null);
          const match = (candidates ?? []).find(
            (c) => normalizePhoneE164(c.phone) === normalizedFrom,
          );
          clientId = match?.id ?? null;
        }

        await (admin as any).from("sms_messages").insert({
          tenant_id: tenantId,
          client_id: clientId,
          direction: "inbound",
          from_number: from,
          to_number: to,
          body,
          status: "received",
          twilio_sid: sid || null,
        } as never);

        // Unmatched numbers still get stored (client_id null) and surface in
        // the inbox as "unmatched" — same idea as the existing leads webhook,
        // so a text from a wrong number or a not-yet-a-client lead isn't lost.

        return twiml();
      },
    },
  },
});

function twiml(): Response {
  return new Response("<Response/>", { headers: { "Content-Type": "text/xml; charset=utf-8" } });
}
