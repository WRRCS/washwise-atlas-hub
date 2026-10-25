import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { groupPhotoUploads, photoAlertData, photoAlertKey, PHOTO_UPLOAD_QUIET_MS } from './photo-upload-alerts';

const SETTING = 'photo-upload-email-settings';
type Settings = { enabled: boolean; recipient_id: string | null; starts_at: string };
async function manager(context: { supabase: SupabaseClient<Database>; userId: string }) {
  const { data: allowed } = await context.supabase.rpc('is_owner_or_manager');
  if (!allowed) throw new Error('Owner or manager access required');
  const { data: profile } = await context.supabase.from('profiles').select('tenant_id').eq('id', context.userId).single();
  if (!profile) throw new Error('No profile');
  return profile.tenant_id;
}
async function readSettings(db: SupabaseClient<Database>, tenantId: string): Promise<Settings> {
  const { data, error } = await db.from('activity_log').select('description').eq('tenant_id', tenantId).eq('action_type', SETTING).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? JSON.parse(data.description) : { enabled: false, recipient_id: null, starts_at: new Date().toISOString() };
}
export const getPhotoEmailSettings = createServerFn({ method:'GET' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const tenantId = await manager(context);
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { data: roles } = await supabaseAdmin.from('user_roles').select('user_id').eq('tenant_id',tenantId).in('role',['owner','manager']);
  const ids = [...new Set((roles ?? []).map(r => r.user_id))];
  const { data: recipients } = ids.length ? await supabaseAdmin.from('profiles').select('id,full_name,email').eq('tenant_id',tenantId).eq('is_active',true).in('id',ids) : { data:[] };
  const { data: logs } = await supabaseAdmin.from('activity_log').select('id,description,created_at').eq('tenant_id',tenantId).in('action_type',['photo-upload-email-sent','photo-upload-email-failed','photo-upload-email-suppressed']).order('created_at',{ ascending:false }).limit(30);
  return { settings:await readSettings(supabaseAdmin,tenantId), recipients:(recipients ?? []).filter(r => r.email), logs:logs ?? [] };
});
export const savePhotoEmailSettings = createServerFn({ method:'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((input:unknown) => z.object({ enabled:z.boolean(), recipient_id:z.string().uuid().nullable() }).parse(input))
  .handler(async ({ data,context }) => {
    const tenantId = await manager(context);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    if (data.recipient_id) {
      const { data: role } = await supabaseAdmin.from('user_roles').select('id').eq('tenant_id',tenantId).eq('user_id',data.recipient_id).in('role',['owner','manager']).limit(1).maybeSingle();
      const { data: profile } = await supabaseAdmin.from('profiles').select('email').eq('tenant_id',tenantId).eq('id',data.recipient_id).eq('is_active',true).maybeSingle();
      if (!role || !profile?.email) throw new Error('Choose an active owner or manager with an email address');
    } else if (data.enabled) throw new Error('Choose a recipient first');
    const previous = await readSettings(supabaseAdmin,tenantId);
    const settings = { ...data, starts_at: previous.enabled && data.enabled ? previous.starts_at : new Date().toISOString() };
    const { error } = await supabaseAdmin.from('activity_log').insert({ tenant_id:tenantId, actor_id:context.userId, action_type:SETTING, entity_type:'tenant', entity_id:tenantId, description:JSON.stringify(settings) });
    if (error) throw new Error(error.message);
    return { ok:true };
  });

/** Runs inside a live upload request, never a dispatcher or fire-and-forget task. */
export async function notifySavedPhotoBatch(db: SupabaseClient<Database>, tenantId:string, jobId:string, uploaderId:string) {
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const settings = await readSettings(supabaseAdmin,tenantId);
  if (!settings.enabled || !settings.recipient_id) return;
  const { data: cleanerRole } = await supabaseAdmin.from('user_roles').select('id').eq('tenant_id',tenantId).eq('user_id',uploaderId).in('role',['owner','manager']).limit(1).maybeSingle();
  if (cleanerRole) return; // Cleaner uploads only, not owner uploads.
  const { data: roles } = await supabaseAdmin.from('user_roles').select('id').eq('tenant_id',tenantId).eq('user_id',settings.recipient_id).in('role',['owner','manager']).limit(1).maybeSingle();
  const { data: recipient } = await supabaseAdmin.from('profiles').select('email').eq('tenant_id',tenantId).eq('id',settings.recipient_id).eq('is_active',true).maybeSingle();
  if (!roles || !recipient?.email) return;
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
  const { sendTemplateEmail } = await import('./email-templates/send-email');
  for (const group of groupPhotoUploads(rows)) {
    const key = photoAlertKey(tenantId,jobId,uploaderId,group.map(p => p.id));
    // Deterministic primary key prevents concurrent claims and refresh duplicates.
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)));
    const hex = Array.from(bytes.slice(0,16),b => b.toString(16).padStart(2,'0')).join('');
    const id = `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20)}`;
    const { error: claim } = await supabaseAdmin.from('activity_log').insert({ id,tenant_id:tenantId,actor_id:uploaderId,entity_type:'job',entity_id:jobId,action_type:'photo-upload-email-sending',description:JSON.stringify({ status:'sending',photoCount:group.length }) });
    if (claim?.code === '23505') continue;
    if (claim) throw new Error(claim.message);
    const templateData = photoAlertData({ ...job, client:clientJob?.client },cleaner?.full_name || 'Cleaner',group.length);
    let status = 'failed'; let failure:string|null = null;
    try {
      const result = await sendTemplateEmail('photo-upload',recipient.email,{ templateData,idempotencyKey:key });
      status = result.sent ? 'sent' : 'suppressed';
      if (!result.sent) failure = result.reason;
    } catch (error) {
      failure = error instanceof Error ? error.message : 'Email send failed';
    }
    const masked = recipient.email.replace(/^(.).+(@.*)$/,'$1***$2');
    const { error } = await supabaseAdmin.from('activity_log').update({ action_type:`photo-upload-email-${status}`, description:JSON.stringify({ ...templateData,status,recipient:masked,error:failure }) }).eq('id',id);
    if (error) console.error('Photo email delivery log failed',error.message);
  }
}