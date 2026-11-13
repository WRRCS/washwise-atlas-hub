import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildClientSchedules, composeScheduleEmail, scheduleSendStatus, type ScheduleSendStatus } from "@/lib/client-schedule";

const Range = z.object({ from: z.string().datetime(), to: z.string().datetime() });

export type ClientSchedulePreview = {
  client_id: string;
  client_name: string;
  has_email: boolean;
  lines: string[];
  status: ScheduleSendStatus;
  last_sent_at: string | null;
};

async function loadWeek(context: any, from: string, to: string) {
  const sb = context.supabase;
  const { data: allowed } = await sb.rpc("is_owner_or_manager");
  if (!allowed) throw new Error("Only owners and managers can send schedules to clients.");
  const { data: tenantId } = await sb.rpc("current_tenant_id");
  if (!tenantId) throw new Error("No workspace");
  const [{ data: tenant }, { data: jobs, error }, { data: sends }] = await Promise.all([
    sb.from("tenants").select("name, timezone").eq("id", tenantId).maybeSingle(),
    sb.from("jobs")
      .select("client_id, status, scheduled_start, scheduled_end, service_address, service_location_label, location_needs_review, property:client_properties!jobs_property_id_fkey(label,address), service:service_types(name)")
      .eq("tenant_id", tenantId)
      // Only cleanings that haven't started yet; past days aren't news to clients.
      .gte("scheduled_start", new Date(Math.max(Date.parse(from), Date.now())).toISOString())
      .lt("scheduled_start", to)
      .not("client_id", "is", null),
    sb.from("client_schedule_sends")
      .select("client_id, fingerprint, sent_at")
      .eq("tenant_id", tenantId)
      .eq("period_start", from)
      .order("sent_at", { ascending: false }),
  ]);
  if (error) throw new Error(error.message);
  const tz = (tenant as any)?.timezone || "America/Los_Angeles";
  const schedules = buildClientSchedules(
    (jobs ?? []).map((j: any) => ({ ...j, service_name: j.service?.name ?? null })),
    tz,
  );
  const last = new Map<string, { fingerprint: string; sent_at: string }>();
  for (const s of (sends ?? []) as any[]) if (!last.has(s.client_id)) last.set(s.client_id, s);
  const ids = [...schedules.keys()];
  // Client emails aren't readable by signed-in staff; the caller is verified above.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: clients } = ids.length
    ? await supabaseAdmin.from("clients").select("id, first_name, last_name, company_name, email").eq("tenant_id", tenantId).in("id", ids)
    : { data: [] as any[] };
  const byId = new Map((clients ?? []).map((c: any) => [c.id, c]));
  return { tenantId: tenantId as string, businessName: (tenant as any)?.name || "Wash Rinse Repeat Cleaning", schedules, last, byId };
}

/** What each client would receive for this week; nothing is sent. */
export const previewClientSchedules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Range.parse(input))
  .handler(async ({ data, context }): Promise<ClientSchedulePreview[]> => {
    const { schedules, last, byId } = await loadWeek(context, data.from, data.to);
    return [...schedules.entries()].map(([client_id, s]) => {
      const c: any = byId.get(client_id) ?? {};
      const prev = last.get(client_id);
      return {
        client_id,
        client_name: [c.first_name, c.last_name].filter(Boolean).join(" ") || c.company_name || "Client",
        has_email: !!c.email?.trim(),
        lines: s.lines,
        status: scheduleSendStatus(s.fingerprint, prev?.fingerprint),
        last_sent_at: prev?.sent_at ?? null,
      };
    }).sort((a, b) => a.client_name.localeCompare(b.client_name));
  });

/** The only way clients hear about their schedule: an owner/manager presses send. */
export const sendClientSchedules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Range.extend({ client_ids: z.array(z.string().uuid()).min(1).max(300) }).parse(input))
  .handler(async ({ data, context }) => {
    const { tenantId, businessName, schedules, last, byId } = await loadWeek(context, data.from, data.to);
    const { sendLovableEmail } = await import("@lovable.dev/email-js");
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    let sent = 0;
    const skipped: string[] = [];
    for (const id of new Set(data.client_ids)) {
      const s = schedules.get(id);
      const c: any = byId.get(id);
      const name = c ? [c.first_name, c.last_name].filter(Boolean).join(" ") || c.company_name || "Client" : "Client";
      if (!s || !c) { skipped.push(`${name} (no cleanings this week)`); continue; }
      const to = c.email?.trim();
      if (!to) { skipped.push(`${name} (no email)`); continue; }
      if (scheduleSendStatus(s.fingerprint, last.get(id)?.fingerprint) === "sent") { skipped.push(`${name} (already has this schedule)`); continue; }
      const { subject, body } = composeScheduleEmail(c.first_name, s.lines, businessName);
      try {
        await sendLovableEmail(
          {
            to,
            from: "Wash Rinse Repeat Cleaning <info@washrinserepeatcleaning.com>",
            sender_domain: "notify.washrinserepeatcleaning.com",
            subject,
            html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#222">${esc(body).replace(/\n/g, "<br>")}</div>`,
            text: body,
            purpose: "transactional",
            idempotency_key: `client-schedule-${id}-${data.from}-${s.fingerprint.length}-${hash(s.fingerprint)}`,
            label: "client_schedule",
          },
          { apiKey: process.env["LOVABLE_API_KEY"]!, sendUrl: process.env["LOVABLE_SEND_URL"] },
        );
      } catch (e: any) {
        skipped.push(`${name} (email failed: ${e?.message ?? "unknown error"})`);
        continue;
      }
      sent++;
      await context.supabase.from("client_schedule_sends").insert({
        tenant_id: tenantId, client_id: id, period_start: data.from, period_end: data.to,
        fingerprint: s.fingerprint, body, sent_to: to, sent_by: context.userId,
      } as never);
      await context.supabase.from("client_messages").insert({
        tenant_id: tenantId, client_id: id, sender_type: "business", sender_user_id: context.userId,
        body: `${subject}\n\n${body}`,
      } as never);
    }
    return { sent, skipped };
  });

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
