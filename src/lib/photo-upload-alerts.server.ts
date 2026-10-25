import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { groupPhotoUploads, photoAlertData, photoAlertKey, photoAlertClaimId, PHOTO_UPLOAD_QUIET_MS } from './photo-upload-alerts';
const SETTING = 'system:photo-upload-email-settings';
type Settings = { enabled: boolean; recipient_id: string | null; starts_at: string };
export async function manager(context: { supabase: SupabaseClient<Database>; userId: string }) {
  const { data: allowed } = await context.supabase.rpc('is_owner_or_manager');
  if (!allowed) throw new Error('Owner or manager access required');
  const { data: profile } = await context.supabase.from('profiles').select('tenant_id').eq('id', context.userId).single();
  if (!profile) throw new Error('No profile');
  return profile.tenant_id;
}
export async function readSettings(db: SupabaseClient<Database>, tenantId: string): Promise<Settings> {
  const { data, error } = await db.from('activity_log').select('description').eq('tenant_id', tenantId).eq('action_type', SETTING).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? JSON.parse(data.description) : { enabled: false, recipient_id: null, starts_at: new Date().toISOString() };
}
/** Runs inside a live upload request, never a dispatcher or fire-and-forget task. */
export async function notifySavedPhotoBatch(db: SupabaseClient<Database>, tenantId:string, jobId:string, uploaderId:string, batchPhotoIds:string[]) {
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const settings = await readSettings(supabaseAdmin,tenantId);
  if (!settings.enabled || !settings.recipient_id) return;
  const { data: cleanerRole } = await supabaseAdmin.from('user_roles').select('id').eq('tenant_id',tenantId).eq('user_id',uploaderId).in('role',['owner','manager']).limit(1).maybeSingle();
  if (cleanerRole) return; // Cleaner uploads only, not owner uploads.
  const { data: roles } = await supabaseAdmin.from('user_roles').select('id').eq('tenant_id',tenantId).eq('user_id',settings.recipient_id).in('role',['owner','manager']).limit(1).maybeSingle();
  const { data: recipient } = await supabaseAdmin.from('profiles').select('email').eq('tenant_id',tenantId).eq('id',settings.recipient_id).eq('is_active',true).maybeSingle();
  if (!roles || !recipient?.email) return;
  const { data: savedBatch, error: batchError } = await db.from('job_photos').select('id,uploaded_at').eq('job_id',jobId).eq('uploaded_by',uploaderId).in('id',batchPhotoIds).gte('uploaded_at',settings.starts_at).order('uploaded_at');
  if (batchError) throw new Error(batchError.message);
  if (!savedBatch?.length) return;
  const batchLast = savedBatch.at(-1);
  if (!batchLast) return;
  const batchEvent = await photoAlertClaimId(`batch:${photoAlertKey(tenantId,jobId,uploaderId,savedBatch.map(p => p.id))}`);
  const { error: batchRecordError } = await supabaseAdmin.from('activity_log').insert({ id:batchEvent,tenant_id:tenantId,actor_id:uploaderId,entity_type:'job',entity_id:jobId,action_type:'system:photo-upload-email-batch',description:JSON.stringify({ photoIds:savedBatch.map(p => p.id),completed_at:batchLast.uploaded_at }) });
  if (batchRecordError && batchRecordError.code !== '23505') throw new Error(batchRecordError.message);
  // Keep this authenticated request alive until the uploader has been quiet.
  // Concurrent requests re-read the same saved rows and use the same provider key.
  let rows: { id:string; uploaded_at:string; uploaded_by:string|null; job_id:string }[] = [];
  for (;;) {
    const { data, error } = await db.from('job_photos').select('id,uploaded_at,uploaded_by,job_id').eq('job_id',jobId).eq('uploaded_by',uploaderId).gte('uploaded_at',settings.starts_at).order('uploaded_at');
    if (error) throw new Error(error.message);
    rows = data ?? [];
    const latest = rows.at(-1);
    if (!latest) return;
    const remaining = PHOTO_UPLOAD_QUIET_MS - (Date.now() - Date.parse(latest.uploaded_at));
    if (remaining <= 0) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(remaining + 100, PHOTO_UPLOAD_QUIET_MS)));
  }
  const current = await readSettings(supabaseAdmin,tenantId);
  if (!current.enabled || current.recipient_id !== settings.recipient_id) return;
  const { data: job } = await db.from('jobs').select('id,service_address,service_location_label,scheduled_start').eq('id',jobId).eq('tenant_id',tenantId).single();
  const { data: clientJob } = await supabaseAdmin.from('jobs').select('client:clients(first_name,last_name)').eq('id',jobId).eq('tenant_id',tenantId).single();
  const { data: cleaner } = await db.from('profiles').select('full_name').eq('id',uploaderId).single();
  if (!job) return;
  const { data: batchEvents, error: batchReadError } = await supabaseAdmin.from('activity_log').select('description').eq('tenant_id',tenantId).eq('entity_id',jobId).eq('actor_id',uploaderId).eq('action_type','system:photo-upload-email-batch').gte('created_at',settings.starts_at);
  if (batchReadError) throw new Error(batchReadError.message);
  const batches = (batchEvents ?? []).map(event => JSON.parse(event.description) as { photoIds:string[]; completed_at:string });
  const completedRows = batches.map(batch => ({ id:batch.photoIds.join(','),uploaded_at:batch.completed_at,uploaded_by:uploaderId,job_id:jobId,photoIds:batch.photoIds }));
  const { sendTemplateEmail } = await import('./email-templates/send-email');
  for (const groupedBatches of groupPhotoUploads(completedRows)) {
    const ids = [...new Set(groupedBatches.flatMap(batch => batch.photoIds))].filter(id => rows.some(row => row.id === id));
    if (!ids.length) continue;
    const key = photoAlertKey(tenantId,jobId,uploaderId,ids);
    // Deterministic primary key prevents concurrent claims and refresh duplicates.
    const id = await photoAlertClaimId(key);
    const { error: claim } = await supabaseAdmin.from('activity_log').insert({ id,tenant_id:tenantId,actor_id:uploaderId,entity_type:'job',entity_id:jobId,action_type:'system:photo-upload-email-sending',description:JSON.stringify({ status:'sending',photoCount:ids.length }) });
    if (claim?.code === '23505') {
      const { data: previous } = await supabaseAdmin.from('activity_log').select('action_type,created_at').eq('id',id).single();
      if (!previous || previous.action_type === 'system:photo-upload-email-sent' || previous.action_type === 'system:photo-upload-email-suppressed' || (previous.action_type === 'system:photo-upload-email-sending' && Date.now() - Date.parse(previous.created_at) < 120_000)) continue;
      const { data: reclaimed } = await supabaseAdmin.from('activity_log').update({ action_type:'system:photo-upload-email-sending',created_at:new Date().toISOString() }).eq('id',id).eq('action_type',previous.action_type).eq('created_at',previous.created_at).select('id').maybeSingle();
      if (!reclaimed) continue;
    } else if (claim) throw new Error(claim.message);
    const templateData = photoAlertData({ ...job, client:clientJob?.client },cleaner?.full_name || 'Cleaner',ids.length);
    let status = 'failed'; let failure:string|null = null;
    try {
      const result = await sendTemplateEmail('photo-upload',recipient.email,{ templateData,idempotencyKey:key });
      status = result.sent ? 'sent' : 'suppressed';
      if (!result.sent) failure = result.reason;
    } catch (error) {
      failure = error instanceof Error ? error.message : 'Email send failed';
    }
    const masked = recipient.email.replace(/^(.).+(@.*)$/,'$1***$2');
    const { error } = await supabaseAdmin.from('activity_log').update({ action_type:`system:photo-upload-email-${status}`, description:JSON.stringify({ ...templateData,status,recipient:masked,error:failure }) }).eq('id',id);
    if (error) console.error('Photo email delivery log failed',error.message);
  }
}