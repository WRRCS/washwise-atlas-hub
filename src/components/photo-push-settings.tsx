import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { toast } from 'sonner';
import { Camera } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { PushToggle } from '@/components/push-toggle';
import { getMyPhotoPushPref, setMyPhotoPushPref } from '@/lib/photo-upload-push.functions';

/** Owner/manager opt-in for their own app notifications when cleaners upload photos. */
export function PhotoPushSettings() {
  const load = useServerFn(getMyPhotoPushPref);
  const save = useServerFn(setMyPhotoPushPref);
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['photo-push-pref'], queryFn: () => load() });
  const [busy, setBusy] = useState(false);
  const enabled = query.data?.enabled ?? false;
  return (
    <section className="bg-card rounded-xl ring-1 ring-border p-6 space-y-4" aria-label="Photo upload app notifications">
      <div className="flex items-start gap-3">
        <span className="rounded-lg bg-success/10 text-success p-2"><Camera className="h-5 w-5" aria-hidden /></span>
        <div>
          <h3 className="font-semibold">App notifications when cleaners upload photos</h3>
          <p className="text-sm text-muted-foreground">Only goes to you, on the phones and computers you turn on below. Photos uploaded close together arrive as one notification about 20 seconds after the cleaner stops adding photos. Tapping it opens that appointment's photos.</p>
        </div>
      </div>
      {query.error ? <p className="text-sm text-destructive">Unable to load this setting.</p> : <>
        <label className="flex items-center gap-3 text-sm font-medium">
          <Switch aria-label="Notify me when cleaners upload photos" checked={enabled} disabled={query.isLoading || busy} onCheckedChange={async (value) => {
            setBusy(true);
            try { await save({ data: { enabled: value } }); await qc.invalidateQueries({ queryKey: ['photo-push-pref'] }); toast.success(value ? 'Photo notifications on' : 'Photo notifications off'); }
            catch (e) { toast.error(e instanceof Error ? e.message : 'Unable to save'); }
            finally { setBusy(false); }
          }} />
          {enabled ? 'On — notify me when cleaners upload photos' : 'Off'}
        </label>
        <div className="rounded-lg border border-border p-3 space-y-2">
          <p className="text-sm font-medium">This device</p>
          <p className="text-xs text-muted-foreground">Turn notifications on once on each phone or computer where you want them. {query.data ? `${query.data.devices} device${query.data.devices === 1 ? '' : 's'} registered on your account.` : ''}</p>
          <PushToggle mode="app" />
        </div>
        {enabled && query.data?.devices === 0 && <p className="rounded-md border border-warning/50 bg-warning/10 p-2 text-sm">No device is turned on yet, so nothing will arrive until you tap Enable notifications on your phone.</p>}
        {!!query.data?.logs.length && <div>
          <h4 className="text-sm font-semibold mb-1">Recent photo notifications</h4>
          <ul className="space-y-1 text-sm">{query.data.logs.map(log => {
            const d = JSON.parse(log.description);
            return <li key={log.id} className="border-t border-border pt-1 break-words">{d.status === 'sent' ? 'Sent' : d.status === 'failed' ? 'Not delivered' : 'Sending'} · {d.cleanerName ?? 'Cleaner'} · {d.propertyName ?? ''} · {d.photoCount ?? d.photoIds?.length ?? 0} photos{d.error && <span className="block text-destructive">{d.error}</span>}</li>;
          })}</ul>
        </div>}
      </>}
    </section>
  );
}
