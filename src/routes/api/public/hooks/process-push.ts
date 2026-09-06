import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

// Cron endpoint: processes pending push-channel notifications and sends them
// out via Web Push. Called by pg_cron every minute. Auth via Supabase anon
// `apikey` header (bypasses site auth under /api/public/*).

type NotificationRow = {
  id: string;
  tenant_id: string;
  recipient_type: "client" | "employee" | "owner";
  recipient_id: string;
  template_name: string;
  payload: Record<string, unknown>;
};

type TemplateRow = { subject: string | null; body: string };
type SubRow = { endpoint: string; p256dh: string; auth: string };

function render(text: string, vars: Record<string, unknown>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = vars[k];
    return v == null ? "" : String(v);
  });
}

export const Route = createFileRoute("/api/public/hooks/process-push")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Private shared secret (not the publishable key, which anyone can read
        // from the browser bundle). Set on the pg_cron job header.
        const expected = process.env.PUSH_CRON_SECRET;
        const provided = request.headers.get("x-cron-secret");
        if (!expected || !provided) return new Response("Unauthorized", { status: 401 });
        const a = Buffer.from(provided);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { sendWebPush } = await import("@/lib/push.server");

        // Fetch batch of pending push notifications
        const { data: pending, error } = await supabaseAdmin
          .from("notifications")
          .select("id,tenant_id,recipient_type,recipient_id,template_name,payload")
          .eq("channel", "push")
          .eq("status", "pending")
          .lte("scheduled_for", new Date().toISOString())
          .order("scheduled_for", { ascending: true })
          .limit(50);
        if (error) {
          return new Response(JSON.stringify({ error: error.message }), { status: 500 });
        }

        const rows = (pending ?? []) as NotificationRow[];
        let processed = 0;
        let deliveries = 0;
        const goneEndpoints: string[] = [];

        for (const n of rows) {
          try {
            // Template
            const { data: tpl } = await supabaseAdmin
              .from("notification_templates")
              .select("subject,body")
              .eq("tenant_id", n.tenant_id)
              .eq("channel", "push")
              .eq("name", n.template_name)
              .maybeSingle();
            const t = (tpl as TemplateRow | null) ?? { subject: "WRRCS.com", body: "" };
            const title = render(t.subject ?? "WRRCS.com", n.payload);
            const body = render(t.body ?? "", n.payload);
            const url = pickUrl(n);

            // Resolve subscriptions for recipient
            let subs: SubRow[] = [];
            if (n.recipient_type === "employee" || n.recipient_type === "owner") {
              const { data } = await supabaseAdmin
                .from("push_subscriptions")
                .select("endpoint,p256dh,auth")
                .eq("user_id", n.recipient_id);
              subs = (data ?? []) as SubRow[];
            } else {
              const { data } = await supabaseAdmin
                .from("push_subscriptions")
                .select("endpoint,p256dh,auth")
                .eq("client_id", n.recipient_id);
              subs = (data ?? []) as SubRow[];
            }

            if (subs.length === 0) {
              // Nothing to deliver; mark sent so it doesn't loop
              await supabaseAdmin
                .from("notifications")
                .update({ status: "sent", sent_at: new Date().toISOString(), error: "no devices" })
                .eq("id", n.id);
              processed += 1;
              continue;
            }

            let anySent = false;
            for (const s of subs) {
              try {
                const r = await sendWebPush(s, { title, body, url, tag: n.template_name });
                if (r === "sent") {
                  anySent = true;
                  deliveries += 1;
                } else if (r === "gone") {
                  goneEndpoints.push(s.endpoint);
                }
              } catch (e) {
                // continue
              }
            }
            await supabaseAdmin
              .from("notifications")
              .update({
                status: anySent ? "sent" : "failed",
                sent_at: anySent ? new Date().toISOString() : null,
                error: anySent ? null : "delivery failed",
              })
              .eq("id", n.id);
            processed += 1;
          } catch (e: any) {
            await supabaseAdmin
              .from("notifications")
              .update({ status: "failed", error: e?.message ?? "error" })
              .eq("id", n.id);
            processed += 1;
          }
        }

        if (goneEndpoints.length > 0) {
          await supabaseAdmin
            .from("push_subscriptions")
            .delete()
            .in("endpoint", goneEndpoints);
        }

        return new Response(
          JSON.stringify({ processed, deliveries, removed: goneEndpoints.length }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});

function pickUrl(n: NotificationRow): string {
  const jobId = (n.payload as any)?.job_id;
  if (n.recipient_type === "employee" || n.recipient_type === "owner") {
    if (jobId) return `/jobs/${jobId}`;
    if (n.template_name.startsWith("push_job")) return "/my-jobs";
    return "/dashboard";
  }
  // client portal
  if (n.template_name === "push_client_invoice") return "/portal/dashboard";
  return "/portal/dashboard";
}
