import {createServerFn} from '@tanstack/react-start';
import {z} from 'zod';
import {requireSupabaseAuth} from '@/integrations/supabase/auth-middleware';
const choice=z.object({enabled:z.boolean(),recipient_id:z.string().uuid().nullable()});
export const getClockEmailSettings=createServerFn({method:'GET'}).middleware([requireSupabaseAuth]).handler(async({context})=>{
  const {manager}=await import('./photo-upload-alerts.server');
  const tenantId=await manager(context);
  const {supabaseAdmin:db}=await import('@/integrations/supabase/client.server');
  const {readClockEmailSettings}=await import('./clock-email-alerts.server');
  const {data:logs,error}=await db.from('activity_log').select('id,description,created_at').eq('tenant_id',tenantId).in('action_type',['system:clock-email-sending','system:clock-email-accepted','system:clock-email-failed']).order('created_at',{ascending:false}).limit(30);
  if(error) throw new Error(error.message);
  return {settings:await readClockEmailSettings(db,tenantId),logs:logs??[]};
});
export const saveClockEmailSettings=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator((input:unknown)=>z.object({clock_in:choice,clock_out:choice,confirmed:z.boolean()}).parse(input)).handler(async({data,context})=>{
  const {manager}=await import('./photo-upload-alerts.server');
  const tenantId=await manager(context);
  const {supabaseAdmin:db}=await import('@/integrations/supabase/client.server');
  const {readClockEmailSettings,CLOCK_SETTING}=await import('./clock-email-alerts.server');
  const previous=await readClockEmailSettings(db,tenantId);
  for(const setting of [data.clock_in,data.clock_out]) {
    if(setting.enabled && (!setting.recipient_id || !data.confirmed)) throw new Error('Confirm the Outlook sender and recipient before enabling');
    if(!setting.recipient_id) continue;
    const {data:role}=await db.from('user_roles').select('id').eq('tenant_id',tenantId).eq('user_id',setting.recipient_id).in('role',['owner','manager']).limit(1).maybeSingle();
    const {data:recipient}=await db.from('profiles').select('email').eq('tenant_id',tenantId).eq('id',setting.recipient_id).eq('is_active',true).maybeSingle();
    if(!role || !recipient?.email) throw new Error('Choose an active owner or manager with an email');
  }
  const now=new Date().toISOString();
  const next={confirmed:data.confirmed,clock_in:{...data.clock_in,starts_at:previous.clock_in.enabled && data.clock_in.enabled && previous.clock_in.recipient_id===data.clock_in.recipient_id?previous.clock_in.starts_at:now},clock_out:{...data.clock_out,starts_at:previous.clock_out.enabled && data.clock_out.enabled && previous.clock_out.recipient_id===data.clock_out.recipient_id?previous.clock_out.starts_at:now}};
  const {error}=await db.from('activity_log').insert({tenant_id:tenantId,actor_id:context.userId,action_type:CLOCK_SETTING,entity_type:'tenant',entity_id:tenantId,description:JSON.stringify(next)});
  if(error) throw new Error(error.message);
  return {ok:true};
});