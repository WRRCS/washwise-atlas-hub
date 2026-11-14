import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildClientSchedules, channelIncludes, composeScheduleEmail, composeScheduleText, scheduleSendStatus, type ScheduleSendStatus } from "@/lib/client-schedule";

const Range = z.object({ from: z.string().datetime(), to: z.string().datetime() });

export type ClientSchedulePreview = {
  client_id: string;
  client_name: string;
  has_email: boolean;
  has_phone: boolean;
  lines: string[];
  status: ScheduleSendStatus;
  text_status: ScheduleSendStatus;
  last_sent_at: string | null;
};

export type ClientSchedulePreviewResult = { clients: ClientSchedulePreview[]; texting_ready: boolean };

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
      .select("client_id, channel, fingerprint, sent_at")
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
  // Latest send per client and channel ("email" | "text").
  const last = new Map<string, { fingerprint: string; sent_at: string }>();
  for (const s of (sends ?? []) as any[]) { const k = `${s.client_id}:${s.channel ?? "email"}`; if (!last.has(k)) last.set(k, s); }
  const ids = [...schedules.keys()];
  // Client emails aren't readable by signed-in staff; the caller is verified above.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: clients } = ids.length
    ? await supabaseAdmin.from("clients").select("id, first_name, last_name, company_name, email, phone").eq("tenant_id", tenantId).in("id", ids)
    : { data: [] as any[] };
  const byId = new Map((clients ?? []).map((c: any) => [c.id, c]));
  const { data: cfg } = await sb.from("voice_agent_config").select("twilio_phone_number").eq("tenant_id", tenantId).maybeSingle();
  return { tenantId: tenantId as string, savedTextNumber: (cfg as any)?.twilio_phone_number ?? null, businessName: (tenant as any)?.name || "Wash Rinse Repeat Cleaning", schedules, last, byId };
}

/** What each client would receive for this week; nothing is sent. */
export const previewClientSchedules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Range.parse(input))
  .handler(async ({ data, context }): Promise<ClientSchedulePreviewResult> => {
    const { schedules, last, byId } = await loadWeek(context, data.from, data.to);
    const { normalizePhoneE164 } = await import("@/lib/phone");
    const { twilioConfigured } = await import("@/lib/sms.server");
    const clients = [...schedules.entries()].map(([client_id, s]) => {
      const c: any = byId.get(client_id) ?? {};
      const prevEmail = last.get(`${client_id}:email`), prevText = last.get(`${client_id}:text`);
      return {
        client_id,
        client_name: [c.first_name, c.last_name].filter(Boolean).join(" ") || c.company_name || "Client",
        has_email: !!c.email?.trim(),
        has_phone: !!normalizePhoneE164(c.phone ?? null),
        lines: s.lines,
        status: scheduleSendStatus(s.fingerprint, prevEmail?.fingerprint),
        text_status: scheduleSendStatus(s.fingerprint, prevText?.fingerprint),
        last_sent_at: [prevEmail?.sent_at, prevText?.sent_at].filter(Boolean).sort().pop() ?? null,
      };
    }).sort((a, b) => a.client_name.localeCompare(b.client_name));
    return { clients, texting_ready: twilioConfigured() };
  });

/** The only way clients hear about their schedule: an owner/manager presses send. */
export const sendClientSchedules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Range.extend({
    client_ids: z.array(z.string().uuid()).min(1).max(300),
    channel: z.enum(["email", "text", "both"]).default("email"),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { tenantId, savedTextNumber, schedules, last, byId } = await loadWeek(context, data.from, data.to);
    const wantEmail = channelIncludes(data.channel, "email"), wantText = channelIncludes(data.channel, "text");
    const { sendLovableEmail } = await import("@lovable.dev/email-js");
    const { normalizePhoneE164 } = await import("@/lib/phone");
    const { sendViaTwilio, businessTextNumber, twilioConfigured } = await import("@/lib/sms.server");
    let fromNumber: string | null = null;
    if (wantText) {
      if (!twilioConfigured()) throw new Error("Texting isn't set up yet, so nothing was sent.");
      fromNumber = normalizePhoneE164(await businessTextNumber(savedTextNumber));
      if (!fromNumber) throw new Error("No business texting number found, so nothing was sent.");
    }
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    let sent = 0, texted = 0;
    const skipped: string[] = [];
    const record = (id: string, channel: "email" | "text", fingerprint: string, body: string, to: string) =>
      context.supabase.from("client_schedule_sends").insert({
        tenant_id: tenantId, client_id: id, period_start: data.from, period_end: data.to, channel,
        fingerprint, body, sent_to: to, sent_by: context.userId,
      } as never);
    for (const id of new Set(data.client_ids)) {
      const s = schedules.get(id);
      const c: any = byId.get(id);
      const name = c ? [c.first_name, c.last_name].filter(Boolean).join(" ") || c.company_name || "Client" : "Client";
      if (!s || !c) { skipped.push(`${name} (no cleanings this week)`); continue; }

      if (wantEmail) {
        const to = c.email?.trim();
        if (!to) skipped.push(`${name} (no email)`);
        else if (scheduleSendStatus(s.fingerprint, last.get(`${id}:email`)?.fingerprint) === "sent") skipped.push(`${name} (already emailed this schedule)`);
        else {
          const { subject, body } = composeScheduleEmail(c.first_name, s.lines);
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
            sent++;
            await record(id, "email", s.fingerprint, body, to);
            await context.supabase.from("client_messages").insert({
              tenant_id: tenantId, client_id: id, sender_type: "business", sender_user_id: context.userId,
              body: `${subject}\n\n${body}`,
            } as never);
          } catch (e: any) {
            skipped.push(`${name} (email failed: ${e?.message ?? "unknown error"})`);
          }
        }
      }

      if (wantText && fromNumber) {
        const to = normalizePhoneE164(c.phone ?? null);
        if (!to) skipped.push(`${name} (no mobile number)`);
        else if (scheduleSendStatus(s.fingerprint, last.get(`${id}:text`)?.fingerprint) === "sent") skipped.push(`${name} (already texted this schedule)`);
        else {
          const body = composeScheduleText(c.first_name, s.lines);
          try {
            const sid = await sendViaTwilio({ to, from: fromNumber, body });
            texted++;
            await record(id, "text", s.fingerprint, body, to);
            await context.supabase.from("sms_messages").insert({
              tenant_id: tenantId, client_id: id, direction: "outbound", from_number: fromNumber, to_number: to,
              body, status: "sent", twilio_sid: sid, sent_by: context.userId,
            } as never);
          } catch (e: any) {
            skipped.push(`${name} (text failed: ${e?.message ?? "unknown error"})`);
          }
        }
      }
    }
    return { sent, texted, skipped };
  });

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
