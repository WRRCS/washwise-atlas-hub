import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { PHOTO_PUSH_PREF, PHOTO_PUSH_RECORD_TYPES, latestPhotoPushPrefs } from './photo-upload-push';

/** The signed-in owner/manager's own photo notification choice, devices and recent alerts. */
export const getMyPhotoPushPref = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { manager } = await import('./photo-upload-alerts.server');
  const tenantId = await manager(context);
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { data: rows } = await supabaseAdmin.from('activity_log').select('actor_id,description,created_at').eq('tenant_id', tenantId).eq('action_type', PHOTO_PUSH_PREF).eq('actor_id', context.userId);
  const pref = latestPhotoPushPrefs(rows ?? []).get(context.userId);
  const { count } = await context.supabase.from('push_subscriptions').select('id', { count: 'exact', head: true }).eq('user_id', context.userId);
  const { data: logs } = await supabaseAdmin.from('activity_log').select('id,description,created_at').eq('tenant_id', tenantId).in('action_type', [...PHOTO_PUSH_RECORD_TYPES]).order('created_at', { ascending: false }).limit(60);
  const mine = (logs ?? []).filter(l => { try { return JSON.parse(l.description).recipient_id === context.userId; } catch { return false; } }).slice(0, 10);
  return { enabled: pref?.enabled ?? false, devices: count ?? 0, logs: mine };
});

export const setMyPhotoPushPref = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ enabled: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const { manager } = await import('./photo-upload-alerts.server');
    const tenantId = await manager(context);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { error } = await supabaseAdmin.from('activity_log').insert({ tenant_id: tenantId, actor_id: context.userId, action_type: PHOTO_PUSH_PREF, entity_type: 'profile', entity_id: context.userId, description: JSON.stringify({ enabled: data.enabled, starts_at: new Date().toISOString() }) });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
