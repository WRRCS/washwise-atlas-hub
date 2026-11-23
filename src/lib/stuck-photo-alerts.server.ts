import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { OUTLOOK_SENDER } from "./owner-email-events";
import { photoAlertClaimId } from "./photo-upload-alerts";
import { groupStuckPhotos, stuckPhotoEmail, STUCK_PHOTO_GRACE_MS, STUCK_PHOTO_LOOKBACK_MS } from "./stuck-photo-alerts";

/**
 * Emails the owner's mailbox about cleaner photos stored but never attached to their cleaning.
 * Each stored file is claimed once in activity_log, so a photo is never reported twice.
 */
export async function alertStuckPhotos(db: SupabaseClient<Database>, now = Date.now(), send?: (to: string, subject: string, text: string) => Promise<unknown>) {
  const { data, error } = await db.rpc("stuck_job_photo_uploads", {
    p_after: new Date(now - STUCK_PHOTO_LOOKBACK_MS).toISOString(),
    p_before: new Date(now - STUCK_PHOTO_GRACE_MS).toISOString(),
  });
  if (error) throw new Error(error.message);
  let emailed = 0;
  for (const group of groupStuckPhotos(data ?? [])) {
    const { data: role } = await db.from("user_roles").select("id").eq("tenant_id", group.tenantId).eq("user_id", group.uploaderId).in("role", ["owner", "manager"]).limit(1).maybeSingle();
    if (role) continue; // Cleaner photos only.
    const { data: owners } = await db.from("user_roles").select("user_id").eq("tenant_id", group.tenantId).eq("role", "owner");
    const ownerIds = (owners ?? []).map((o) => o.user_id);
    if (!ownerIds.length) continue;
    const { data: recipient } = await db.from("profiles").select("email").eq("tenant_id", group.tenantId).eq("is_active", true).in("id", ownerIds).ilike("email", OUTLOOK_SENDER).limit(1).maybeSingle();
    if (!recipient?.email) continue;

    // Claim each file; only files this run claimed go in the email.
    const claims = await Promise.all(group.objects.map(async (o) => ({ o, id: await photoAlertClaimId(`stuck-photo:${o.name}`) })));
    const { data: claimed, error: claimError } = await db.from("activity_log").upsert(
      claims.map(({ id }) => ({ id, tenant_id: group.tenantId, actor_id: group.uploaderId, entity_type: "job", entity_id: group.jobId, action_type: "system:stuck-photo-email-sending", description: JSON.stringify({ status: "sending" }) })),
      { onConflict: "id", ignoreDuplicates: true },
    ).select("id");
    if (claimError) throw new Error(claimError.message);
    const mine = new Set((claimed ?? []).map((c) => c.id));
    const fresh = claims.filter((c) => mine.has(c.id));
    if (!fresh.length) continue;

    const [{ data: job }, { data: cleaner }] = await Promise.all([
      db.from("jobs").select("id,service_address,service_location_label,scheduled_start,client:clients(first_name,last_name)").eq("id", group.jobId).eq("tenant_id", group.tenantId).maybeSingle(),
      db.from("profiles").select("full_name").eq("id", group.uploaderId).maybeSingle(),
    ]);
    const client = job?.client as { first_name?: string | null; last_name?: string | null } | null | undefined;
    const mail = stuckPhotoEmail({
      cleanerName: cleaner?.full_name?.trim() || "A cleaner",
      clientName: [client?.first_name, client?.last_name].filter(Boolean).join(" ") || "Client",
      propertyName: job?.service_location_label?.trim() || job?.service_address?.trim() || "Location needs review",
      scheduledStart: job?.scheduled_start ?? null,
      jobId: group.jobId,
      uploaderId: group.uploaderId,
      storedAt: fresh.map((c) => c.o.created_at).sort(),
    });
    let status = "failed";
    let failure: string | null = null;
    try {
      const deliver = send ?? (await import("./outlook-email.server")).sendOutlookAlert;
      await deliver(recipient.email, mail.subject, mail.text);
      status = "accepted";
      emailed += 1;
    } catch (e) {
      // Outlook has no idempotency: never replay an ambiguous send.
      failure = e instanceof Error ? e.message : "Outlook send failed";
    }
    const { error: logError } = await db.from("activity_log").update({ action_type: `system:stuck-photo-email-${status}`, description: JSON.stringify({ status, photoCount: fresh.length, error: failure }) }).in("id", fresh.map((c) => c.id));
    if (logError) console.error("Stuck photo log failed", logError.message);
  }
  return { checked: data?.length ?? 0, emailed };
}
