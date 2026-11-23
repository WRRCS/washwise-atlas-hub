// Server-only: texts cleaners their schedule reminders (appointment_reminder_employee rows on the
// "sms" channel). Employees only — never clients. At-most-once per row (delivery_claimed_at claim).
import { appointmentReminderStale, reminderTextBody, reminderTextDue } from "@/lib/employee-reminder-sms";

type Db = any;

export async function dispatchEmployeeReminderTexts(db: Db, now: Date = new Date()): Promise<{ sent: number; skipped: number }> {
  const out = { sent: 0, skipped: 0 };
  const { data: rows, error } = await db
    .from("notifications")
    .select("id,tenant_id,recipient_id,payload,scheduled_for")
    .eq("channel", "sms")
    .eq("recipient_type", "employee")
    .eq("template_name", "appointment_reminder_employee")
    .eq("status", "pending")
    .is("recalled_at", null)
    .is("delivery_claimed_at", null)
    .lte("scheduled_for", now.toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(50);
  if (error) throw new Error(error.message);
  if (!rows?.length) return out;

  const { twilioConfigured, sendViaTwilio, businessTextNumber } = await import("@/lib/sms.server");
  const { normalizePhoneE164 } = await import("@/lib/phone");
  const { claimPushDelivery } = await import("@/lib/cleaner-action-reminders.server");
  const fromByTenant = new Map<string, string | null>();

  for (const n of rows as any[]) {
    const fail = async (msg: string, recalled = false) => {
      await db.from("notifications").update(recalled ? { recalled_at: new Date().toISOString(), error: msg } : { status: "failed", error: msg }).eq("id", n.id);
      out.skipped++;
    };
    if (reminderTextDue(n.scheduled_for, now) === "expired") {
      if (await claimPushDelivery(db, n.id)) await fail("expired: not sent in time");
      continue;
    }
    // Texting not set up yet: leave the row waiting; it expires on its own if it stays too long.
    if (!fromByTenant.has(n.tenant_id)) {
      const { data: cfg } = await db.from("voice_agent_config").select("twilio_phone_number").eq("tenant_id", n.tenant_id).maybeSingle();
      fromByTenant.set(n.tenant_id, twilioConfigured() ? normalizePhoneE164(await businessTextNumber(cfg?.twilio_phone_number ?? null)) : null);
    }
    const from = fromByTenant.get(n.tenant_id);
    if (!from) continue;
    if (!(await claimPushDelivery(db, n.id))) continue;
    try {
      const jobId = typeof n.payload?.job_id === "string" ? n.payload.job_id : null;
      if (!jobId) { await fail("no cleaning"); continue; }
      const [{ data: job }, { data: link }, { data: prof }, { data: tenant }] = await Promise.all([
        db.from("jobs").select("status,scheduled_start,assigned_to,published_at,client_id").eq("id", jobId).eq("tenant_id", n.tenant_id).maybeSingle(),
        db.from("job_employees").select("scheduled_start").eq("job_id", jobId).eq("employee_id", n.recipient_id).maybeSingle(),
        db.from("profiles").select("phone,language,is_active,tenant_id").eq("id", n.recipient_id).maybeSingle(),
        db.from("tenants").select("timezone").eq("id", n.tenant_id).maybeSingle(),
      ]);
      if (appointmentReminderStale(job, !!link, n.recipient_id, n.payload?.scheduled_start, link?.scheduled_start)) { await fail("suppressed: appointment changed", true); continue; }
      if (!prof || prof.tenant_id !== n.tenant_id || !prof.is_active) { await fail("suppressed: not an active team member", true); continue; }
      const to = normalizePhoneE164(prof.phone ?? null);
      if (!to) { await fail("no phone number on file"); continue; }
      const { data: client } = job.client_id
        ? await db.from("clients").select("first_name,last_name,company_name").eq("id", job.client_id).maybeSingle()
        : { data: null };
      const clientName = [client?.first_name, client?.last_name].filter(Boolean).join(" ") || client?.company_name || "your client";
      const body = reminderTextBody({ clientName, startISO: link?.scheduled_start ?? job.scheduled_start, tz: tenant?.timezone || "America/Los_Angeles", language: prof.language });
      await sendViaTwilio({ to, from, body });
      await db.from("notifications").update({ status: "sent", sent_at: new Date().toISOString(), error: null }).eq("id", n.id);
      out.sent++;
    } catch (e) {
      await fail(e instanceof Error ? e.message : "text failed");
    }
  }
  return out;
}
