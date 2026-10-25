import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

// Cron endpoint: processes pending push-channel notifications and sends them
// out via Web Push. Called by pg_cron every minute with a private scheduler secret.

type NotificationRow = {
  id: string;
  tenant_id: string;
  recipient_type: "client" | "employee" | "owner";
  recipient_id: string;
  template_name: string;
  payload: Record<string, unknown>;
  action_reminder_key: string | null;
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
        const { enqueueActionReminders, currentActionReminder } = await import("@/lib/cleaner-action-reminders.server");
        await enqueueActionReminders(supabaseAdmin);

        // Fetch batch of pending push notifications
        const { data: pending, error } = await supabaseAdmin
          .from("notifications")
          .select("id,tenant_id,recipient_type,recipient_id,template_name,payload,action_reminder_key")
          .eq("channel", "push")
          .eq("status", "pending")
          .is("recalled_at", null)
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
            // At-most-once claim: do not retry uncertain deliveries after a process crash.
            const {data: claimed,error: claimError} = await supabaseAdmin.from("notifications")
              .update({delivery_claimed_at:new Date().toISOString()}).eq("id",n.id).eq("status","pending").is("delivery_claimed_at",null).select("id");
            if(claimError)throw new Error(claimError.message);
            if(!claimed?.length)continue;
            let action = n.action_reminder_key ? await currentActionReminder(supabaseAdmin,n) : null;
            if(n.action_reminder_key && !action) {
              await supabaseAdmin.from("notifications").update({recalled_at:new Date().toISOString(),error:"suppressed: action complete, lunch, disabled, expired or appointment changed"}).eq("id",n.id);
              processed++;continue;
            }
            // Existing appointment reminders must not survive cancellation, completion or reassignment.
            if(n.template_name==="appointment_reminder_employee" && typeof n.payload.job_id==="string") {
              const {data: job}=await supabaseAdmin.from("jobs").select("status,scheduled_start,assigned_to").eq("id",n.payload.job_id).eq("tenant_id",n.tenant_id).maybeSingle();
              const {data: links}=await supabaseAdmin.from("job_employees").select("id").eq("job_id",n.payload.job_id).eq("employee_id",n.recipient_id);
              const stale=!job || ["canceled","completed"].includes(job.status) || (!links?.length && job.assigned_to!==n.recipient_id) || (typeof n.payload.scheduled_start==="string" && Date.parse(n.payload.scheduled_start)!==Date.parse(job.scheduled_start));
              if(stale) {await supabaseAdmin.from("notifications").update({recalled_at:new Date().toISOString(),error:"suppressed: appointment changed"}).eq("id",n.id);processed++;continue;}
            }
            // Template
            const { data: tpl } = await supabaseAdmin
              .from("notification_templates")
              .select("subject,body")
              .eq("tenant_id", n.tenant_id)
              .eq("channel", "push")
              .eq("name", n.template_name)
              .maybeSingle();
            const t = (tpl as TemplateRow | null) ?? { subject: "WRRCS.com", body: "" };
            const title = action?.title ?? render(t.subject ?? "WRRCS.com", n.payload);
            const body = action?.body ?? render(t.body ?? "", n.payload);
            const url = action?.url ?? pickUrl(n);

            // Resolve subscriptions for recipient
            let subs: SubRow[] = [];
            if (n.recipient_type === "employee" || n.recipient_type === "owner") {
              const { data } = await supabaseAdmin
                .from("push_subscriptions")
                .select("endpoint,p256dh,auth")
                .eq("tenant_id",n.tenant_id)
                .eq("user_id", n.recipient_id);
              subs = (data ?? []) as SubRow[];
            } else {
              const { data } = await supabaseAdmin
                .from("push_subscriptions")
                .select("endpoint,p256dh,auth")
                .eq("tenant_id",n.tenant_id)
                .eq("client_id", n.recipient_id);
              subs = (data ?? []) as SubRow[];
            }

            if (subs.length === 0) {
              // Nothing to deliver; mark sent so it doesn't loop
              await supabaseAdmin
                .from("notifications")
                .update({ status: "failed", sent_at: null, error: "no registered push devices" })
                .eq("id", n.id);
              processed += 1;
              continue;
            }

            let anySent = false;
            let lastError: string | null = null;
            for (const s of subs) {
              try {
                if(n.action_reminder_key) {
                  action=await currentActionReminder(supabaseAdmin,n);
                  if(!action){lastError="suppressed before delivery: action or appointment changed";break;}
                }
                const r = await sendWebPush(s, { title:action?.title ?? title, body:action?.body ?? body, url:action?.url ?? url, tag: n.action_reminder_key ?? n.template_name });
                if (r === "sent") {
                  anySent = true;
                  deliveries += 1;
                } else if (r === "gone") {
                  goneEndpoints.push(s.endpoint);
                }
              } catch (e) {
                lastError=e instanceof Error?e.message:"Push delivery failed";
              }
            }
            await supabaseAdmin
              .from("notifications")
              .update({
                status: anySent ? "sent" : "failed",
                sent_at: anySent ? new Date().toISOString() : null,
                error: anySent ? null : lastError ?? "delivery failed or subscription expired",
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
    if (n.template_name === "push_team_message") return "/team";
    if (jobId) return `/jobs/${jobId}`;
    if (n.template_name.startsWith("push_job")) return "/my-jobs";
    return "/dashboard";
  }
  // client portal
  if (n.template_name === "push_client_invoice") return "/portal/dashboard";
  return "/portal/dashboard";
}
