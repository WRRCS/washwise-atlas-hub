import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

const SETTING = 'system:photo-upload-email-settings';
export const getPhotoEmailSettings = createServerFn({ method:'GET' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { manager, readSettings } = await import('./photo-upload-alerts.server');
  const tenantId = await manager(context);
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { data: roles } = await supabaseAdmin.from('user_roles').select('user_id').eq('tenant_id',tenantId).in('role',['owner','manager']);
  const ids = [...new Set((roles ?? []).map(r => r.user_id))];
  const { data: recipients } = ids.length ? await supabaseAdmin.from('profiles').select('id,full_name,email').eq('tenant_id',tenantId).eq('is_active',true).in('id',ids) : { data:[] };
  const { data: logs } = await supabaseAdmin.from('activity_log').select('id,description,created_at').eq('tenant_id',tenantId).in('action_type',['system:photo-upload-email-sending','system:photo-upload-email-sent','system:photo-upload-email-failed','system:photo-upload-email-suppressed']).order('created_at',{ ascending:false }).limit(30);
  return { settings:await readSettings(supabaseAdmin,tenantId), recipients:(recipients ?? []).filter(r => r.email), logs:logs ?? [] };
});
export const savePhotoEmailSettings = createServerFn({ method:'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((input:unknown) => z.object({ enabled:z.boolean(), recipient_id:z.string().uuid().nullable() }).parse(input))
  .handler(async ({ data,context }) => {
    const { manager, readSettings } = await import('./photo-upload-alerts.server');
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

