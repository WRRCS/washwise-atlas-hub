// Server-only: text each assigned cleaner when a published cleaning is canceled.
// Synchronous, at-most-once per cleaner per cleaning (activity_log claim), like
// the owner clock/photo alerts. Never texts clients.
import { cancelTextBody, shouldTextOnCancel } from "@/lib/cancel-text";

export type CancelTextJob = {
  id: string;
  tenant_id: string;
  client_id: string | null;
  status: string;
  published_at: string | null;
  scheduled_start: string;
  scheduled_end: string;
  cleaners: { employee_id: string; scheduled_start: string | null }[];
};

export type CancelTextResult = { texted: string[]; skipped: { name: string; reason: string }[]; notSetUp?: boolean };

/** Read the cleaning and its cleaners BEFORE it is canceled or deleted. */
export async function loadCancelTextJob(jobId: string): Promise<CancelTextJob | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const [{ data: job }, { data: links }] = await Promise.all([
    db.from("jobs").select("id, tenant_id, client_id, status, published_at, scheduled_start, scheduled_end").eq("id", jobId).maybeSingle(),
    db.from("job_employees").select("employee_id, scheduled_start").eq("job_id", jobId),
  ]);
  if (!job) return null;
  return { ...job, cleaners: links ?? [] };
}

export async function textCleanersAboutCancellation(job: CancelTextJob | null, actorId: string | null): Promise<CancelTextResult> {
  const result: CancelTextResult = { texted: [], skipped: [] };
  if (!job || !shouldTextOnCancel(job, new Date(), await tenantTz(job.tenant_id)) || !job.cleaners.length) return result;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { twilioConfigured, sendViaTwilio, businessTextNumber } = await import("@/lib/sms.server");
  const { normalizePhoneE164 } = await import("@/lib/phone");
  const { photoAlertClaimId } = await import("@/lib/photo-upload-alerts");
  const db = supabaseAdmin as any;

  const [{ data: tenant }, { data: cfg }, { data: client }, { data: profs }] = await Promise.all([
    db.from("tenants").select("timezone").eq("id", job.tenant_id).maybeSingle(),
    db.from("voice_agent_config").select("twilio_phone_number").eq("tenant_id", job.tenant_id).maybeSingle(),
    job.client_id ? db.from("clients").select("first_name, last_name, company_name").eq("id", job.client_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from("profiles").select("id, full_name, phone, language, is_active, tenant_id").in("id", job.cleaners.map((c) => c.employee_id)),
  ]);
  const tz = tenant?.timezone || "America/Los_Angeles";
  const from = normalizePhoneE164(await businessTextNumber(cfg?.twilio_phone_number ?? null));
  const clientName = [client?.first_name, client?.last_name].filter(Boolean).join(" ") || client?.company_name || "your client";
  const ready = twilioConfigured() && !!from;
  if (!ready) result.notSetUp = true;

  for (const c of job.cleaners) {
    const p = (profs ?? []).find((x: any) => x.id === c.employee_id);
    const name = (p?.full_name ?? "Cleaner").split(" ")[0];
    if (!p || p.tenant_id !== job.tenant_id || !p.is_active) { result.skipped.push({ name, reason: "not active" }); continue; }
    const to = normalizePhoneE164(p.phone ?? null);
    if (!to) { result.skipped.push({ name, reason: "no phone number" }); continue; }
    if (!ready) { result.skipped.push({ name, reason: "texting not set up" }); continue; }

    const body = cancelTextBody({ clientName, startISO: c.scheduled_start ?? job.scheduled_start, tz, language: p.language });
    const claimId = await photoAlertClaimId(`cancel-text:${job.id}:${c.employee_id}`);
    const detail = { job_id: job.id, employee_id: c.employee_id };
    const { error: claim } = await db.from("activity_log").insert({
      id: claimId, tenant_id: job.tenant_id, actor_id: actorId, entity_type: "job", entity_id: job.id,
      action_type: "system:cancel-text-sending", description: JSON.stringify(detail),
    });
    if (claim?.code === "23505") continue; // already texted for this cleaning
    if (claim) { result.skipped.push({ name, reason: "could not record" }); continue; }
    try {
      const sid = await sendViaTwilio({ to, from: from!, body });
      result.texted.push(name);
      await db.from("activity_log").update({ action_type: "system:cancel-text-sent", description: JSON.stringify({ ...detail, sid }) }).eq("id", claimId);
    } catch (e) {
      result.skipped.push({ name, reason: "text failed" });
      await db.from("activity_log").update({ action_type: "system:cancel-text-failed", description: JSON.stringify({ ...detail, error: e instanceof Error ? e.message : "failed" }) }).eq("id", claimId);
    }
  }
  return result;
}

/** First names of the cleaners who would get the cancellation text (for the owner's Send/Skip box). */
export async function cancelTextRecipients(job: CancelTextJob | null): Promise<string[]> {
  if (!job || !shouldTextOnCancel(job, new Date(), await tenantTz(job.tenant_id)) || !job.cleaners.length) return [];
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { normalizePhoneE164 } = await import("@/lib/phone");
  const { data: profs } = await (supabaseAdmin as any).from("profiles").select("full_name, phone, is_active, tenant_id").in("id", job.cleaners.map((c) => c.employee_id));
  return (profs ?? []).filter((p: any) => p.tenant_id === job.tenant_id && p.is_active && normalizePhoneE164(p.phone))
    .map((p: any) => (p.full_name ?? "Cleaner").split(" ")[0]);
}

async function tenantTz(tenantId: string): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await (supabaseAdmin as any).from("tenants").select("timezone").eq("id", tenantId).maybeSingle();
  return data?.timezone || "America/Los_Angeles";
}
