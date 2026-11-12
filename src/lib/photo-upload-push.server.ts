import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { photoAlertClaimId, photoAlertData, photoAlertKey, PHOTO_UPLOAD_QUIET_MS } from './photo-upload-alerts';
import { latestPhotoPushPrefs, photoPushMessage, PHOTO_PUSH_PREF, PHOTO_PUSH_RECORD_TYPES, unannouncedPhotoIds } from './photo-upload-push';
import type { PushPayload, PushTarget } from './push.server';

type Deps = { admin: SupabaseClient<Database>; send: (target: PushTarget, payload: PushPayload) => Promise<'sent' | 'gone'>; wait?: (ms: number) => Promise<void> };

/** Opted-in, active owners/managers for a tenant, keyed by user id with their opt-in time. */
export async function photoPushRecipients(admin: SupabaseClient<Database>, tenantId: string) {
  const { data: prefRows, error } = await admin.from('activity_log').select('actor_id,description,created_at').eq('tenant_id', tenantId).eq('action_type', PHOTO_PUSH_PREF);
  if (error) throw new Error(error.message);
  const prefs = latestPhotoPushPrefs(prefRows ?? []);
  const enabledIds = [...prefs].filter(([, p]) => p.enabled).map(([id]) => id);
  if (!enabledIds.length) return new Map<string, string>();
  const { data: roles } = await admin.from('user_roles').select('user_id').eq('tenant_id', tenantId).in('role', ['owner', 'manager']).in('user_id', enabledIds);
  const { data: active } = await admin.from('profiles').select('id').eq('tenant_id', tenantId).eq('is_active', true).in('id', enabledIds);
  const allowed = new Set((roles ?? []).map(r => r.user_id));
  const out = new Map<string, string>();
  for (const p of active ?? []) if (allowed.has(p.id)) out.set(p.id, prefs.get(p.id)!.starts_at);
  return out;
}

/**
 * Sends one app notification per grouped cleaner photo upload to each opted-in owner/manager.
 * Runs inside the live upload request (no queue). At-most-once per recipient and photo set.
 */
export async function pushSavedPhotoBatch(db: SupabaseClient<Database>, tenantId: string, jobId: string, uploaderId: string, batchPhotoIds: string[], deps?: Deps) {
  const admin = deps?.admin ?? (await import('@/integrations/supabase/client.server')).supabaseAdmin;
  const send = deps?.send ?? (await import('./push.server')).sendWebPush;
  const wait = deps?.wait ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const { data: uploaderRole } = await admin.from('user_roles').select('id').eq('tenant_id', tenantId).eq('user_id', uploaderId).in('role', ['owner', 'manager']).limit(1).maybeSingle();
  if (uploaderRole) return; // Cleaner uploads only.
  const recipients = await photoPushRecipients(admin, tenantId);
  recipients.delete(uploaderId);
  if (!recipients.size) return;
  const earliest = [...recipients.values()].sort()[0];
  const { data: saved, error: savedError } = await db.from('job_photos').select('id').eq('job_id', jobId).eq('uploaded_by', uploaderId).in('id', batchPhotoIds).gte('uploaded_at', earliest);
  if (savedError) throw new Error(savedError.message);
  if (!saved?.length) return;
  // Wait until the cleaner has been quiet so a burst of photos becomes one notification.
  let rows: { id: string; uploaded_at: string }[] = [];
  for (;;) {
    const { data, error } = await db.from('job_photos').select('id,uploaded_at').eq('job_id', jobId).eq('uploaded_by', uploaderId).gte('uploaded_at', earliest).order('uploaded_at');
    if (error) throw new Error(error.message);
    rows = data ?? [];
    const latest = rows.at(-1);
    if (!latest) return;
    const remaining = PHOTO_UPLOAD_QUIET_MS - (Date.now() - Date.parse(latest.uploaded_at));
    if (remaining <= 0) break;
    await wait(Math.min(remaining + 100, PHOTO_UPLOAD_QUIET_MS));
  }
  const { data: job } = await admin.from('jobs').select('id,service_address,service_location_label,scheduled_start,client:clients(first_name,last_name)').eq('id', jobId).eq('tenant_id', tenantId).single();
  const { data: cleaner } = await admin.from('profiles').select('full_name').eq('id', uploaderId).single();
  if (!job) return;
  const { data: records, error: recordsError } = await admin.from('activity_log').select('description').eq('tenant_id', tenantId).eq('entity_id', jobId).eq('actor_id', uploaderId).in('action_type', [...PHOTO_PUSH_RECORD_TYPES]);
  if (recordsError) throw new Error(recordsError.message);
  const parsed = (records ?? []).map(r => { try { return JSON.parse(r.description) as { recipient_id?: string; photoIds?: string[] }; } catch { return {}; } });
  for (const [recipientId, startsAt] of recipients) {
    const announced = new Set(parsed.filter(r => r.recipient_id === recipientId).flatMap(r => r.photoIds ?? []));
    const ids = unannouncedPhotoIds(rows, startsAt, announced);
    if (!ids.length) continue;
    const id = await photoAlertClaimId(`push:${recipientId}:${photoAlertKey(tenantId, jobId, uploaderId, ids)}`);
    const { error: claim } = await admin.from('activity_log').insert({ id, tenant_id: tenantId, actor_id: uploaderId, entity_type: 'job', entity_id: jobId, action_type: 'system:photo-upload-push-sending', description: JSON.stringify({ recipient_id: recipientId, photoIds: ids }) });
    if (claim?.code === '23505') continue; // Another request already owns this notification.
    if (claim) throw new Error(claim.message);
    const data = photoAlertData(job as never, cleaner?.full_name || 'Cleaner', ids.length, uploaderId);
    const message = photoPushMessage(data, jobId, uploaderId);
    const { data: subs } = await admin.from('push_subscriptions').select('endpoint,p256dh,auth').eq('tenant_id', tenantId).eq('user_id', recipientId);
    let sent = 0; const gone: string[] = []; let failure: string | null = subs?.length ? null : 'No app notification device registered';
    for (const s of subs ?? []) {
      try {
        const result = await send({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, { ...message, recipientUserId: recipientId, ttlSeconds: 6 * 3600 });
        if (result === 'sent') sent++; else gone.push(s.endpoint);
      } catch (e) { failure = e instanceof Error ? e.message : 'Push failed'; }
    }
    if (gone.length) await admin.from('push_subscriptions').delete().in('endpoint', gone);
    const status = sent ? 'sent' : 'failed';
    const { error } = await admin.from('activity_log').update({ action_type: `system:photo-upload-push-${status}`, description: JSON.stringify({ recipient_id: recipientId, photoIds: ids, status, devices: subs?.length ?? 0, accepted: sent, cleanerName: data.cleanerName, propertyName: data.propertyName, photoCount: ids.length, error: sent ? null : failure }) }).eq('id', id);
    if (error) console.error('Photo push log failed', error.message);
  }
}

/** Runs email and app notifications side by side so the upload request waits for the quiet window once. */
export async function announceSavedPhotoBatch(db: SupabaseClient<Database>, tenantId: string, jobId: string, uploaderId: string, photoIds: string[]) {
  const { notifySavedPhotoBatch } = await import('./photo-upload-alerts.server');
  const [email, push] = await Promise.allSettled([
    notifySavedPhotoBatch(db, tenantId, jobId, uploaderId, photoIds),
    pushSavedPhotoBatch(db, tenantId, jobId, uploaderId, photoIds),
  ]);
  if (push.status === 'rejected') console.error('Photo app notification failed', push.reason instanceof Error ? push.reason.message : 'Unknown error');
  if (email.status === 'rejected') throw email.reason;
}
