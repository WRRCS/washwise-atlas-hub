import { beforeEach, describe, expect, it } from 'vitest';
import { pushSavedPhotoBatch } from '../../src/lib/photo-upload-push.server';
import { latestPhotoPushPrefs, photoPushMessage } from '../../src/lib/photo-upload-push';

const state = { logs: [] as any[], photos: [] as any[], subs: [] as any[], roles: [] as any[], sends: [] as any[] };
function query(table: string) {
  const filters: ((r: any) => boolean)[] = []; let patch: any; let insert: any; let del = false;
  const q: any = {
    select: () => q, eq: (k: string, v: any) => { filters.push(r => r[k] === v); return q; },
    in: (k: string, v: any[]) => { filters.push(r => v.includes(r[k])); return q; },
    gte: (k: string, v: any) => { filters.push(r => r[k] >= v); return q; },
    order: () => q, limit: () => q,
    insert: (r: any) => { insert = r; return q; }, update: (r: any) => { patch = r; return q; }, delete: () => { del = true; return q; },
    single: () => run(true), maybeSingle: () => run(true), then: (a: any, b: any) => run(false).then(a, b),
  };
  async function run(single: boolean) {
    const source: Record<string, any[]> = {
      activity_log: state.logs, job_photos: state.photos, push_subscriptions: state.subs, user_roles: state.roles,
      profiles: [{ id: 'owner', tenant_id: 'tenant', is_active: true }, { id: 'cleaner', tenant_id: 'tenant', is_active: true, full_name: 'Dalton Inkster' }],
      jobs: [{ id: 'job', tenant_id: 'tenant', service_address: '5099 Fern Street', service_location_label: 'Beach Bum', scheduled_start: '2026-11-11T18:00:00Z', client: { first_name: 'Sean', last_name: 'Ryan' } }],
    };
    if (insert) {
      if (state.logs.some(r => r.id && r.id === insert.id)) return { data: null, error: { code: '23505' } };
      state.logs.push({ ...insert, created_at: new Date().toISOString() }); return { data: null, error: null };
    }
    let rows = (source[table] ?? []).filter(r => filters.every(f => f(r)));
    if (del) { state.subs = state.subs.filter(r => !rows.includes(r)); return { data: null, error: null }; }
    if (patch) rows.forEach(r => Object.assign(r, patch));
    return { data: single ? rows[0] ?? null : rows, error: null };
  }
  return q;
}
const db: any = { from: query };
const deps = { admin: db, wait: async () => {}, send: async (target: any, payload: any) => { state.sends.push({ target, payload }); return 'sent' as const; } };
const old = (s: number) => new Date(Date.now() - s * 1000).toISOString();

beforeEach(() => {
  state.roles = [{ tenant_id: 'tenant', user_id: 'owner', role: 'owner' }];
  state.logs = [{ tenant_id: 'tenant', actor_id: 'owner', action_type: 'system:photo-upload-push-pref', description: JSON.stringify({ enabled: true, starts_at: old(3600) }), created_at: old(3600) }];
  state.photos = [0, 1, 2].map(i => ({ id: `p${i}`, job_id: 'job', uploaded_by: 'cleaner', uploaded_at: old(120 - i) }));
  state.subs = [{ tenant_id: 'tenant', user_id: 'owner', endpoint: 'https://push.example/owner', p256dh: 'k', auth: 'a' }];
  state.sends = [];
});

describe('photo upload app notifications', () => {
  it('sends the owner one notification for a group of cleaner photos', async () => {
    await pushSavedPhotoBatch(db, 'tenant', 'job', 'cleaner', ['p0', 'p1', 'p2'], deps);
    expect(state.sends).toHaveLength(1);
    expect(state.sends[0].payload.title).toBe('Dalton Inkster uploaded 3 photos');
    expect(state.sends[0].payload.recipientUserId).toBe('owner');
    expect(state.sends[0].payload.url).toBe('/jobs/job?cleaner=cleaner#photos');
  });
  it('never notifies twice for the same photos, even with overlapping requests', async () => {
    await Promise.all([pushSavedPhotoBatch(db, 'tenant', 'job', 'cleaner', ['p0', 'p1'], deps), pushSavedPhotoBatch(db, 'tenant', 'job', 'cleaner', ['p2'], deps)]);
    await pushSavedPhotoBatch(db, 'tenant', 'job', 'cleaner', ['p2'], deps);
    expect(state.sends).toHaveLength(1);
  });
  it('sends nothing when the owner has not turned photo notifications on', async () => {
    state.logs.push({ tenant_id: 'tenant', actor_id: 'owner', action_type: 'system:photo-upload-push-pref', description: JSON.stringify({ enabled: false, starts_at: old(10) }), created_at: old(10) });
    await pushSavedPhotoBatch(db, 'tenant', 'job', 'cleaner', ['p0'], deps);
    expect(state.sends).toHaveLength(0);
  });
  it('ignores photos uploaded by an owner or manager', async () => {
    state.roles.push({ tenant_id: 'tenant', user_id: 'cleaner', role: 'manager' });
    await pushSavedPhotoBatch(db, 'tenant', 'job', 'cleaner', ['p0'], deps);
    expect(state.sends).toHaveLength(0);
  });
  it('does not send to employees who are not owners or managers', async () => {
    state.roles = [];
    await pushSavedPhotoBatch(db, 'tenant', 'job', 'cleaner', ['p0'], deps);
    expect(state.sends).toHaveLength(0);
  });
  it('uses the latest saved choice and singular wording for one photo', () => {
    const prefs = latestPhotoPushPrefs([
      { actor_id: 'a', description: '{"enabled":true,"starts_at":"x"}', created_at: '2026-11-01' },
      { actor_id: 'a', description: '{"enabled":false,"starts_at":"y"}', created_at: '2026-11-02' },
    ]);
    expect(prefs.get('a')?.enabled).toBe(false);
    expect(photoPushMessage({ cleanerName: 'Masha', propertyName: 'Fern', appointmentDate: 'Nov 11', photoCount: 1 }, 'j', 'u').title).toBe('Masha uploaded 1 photo');
  });
});
