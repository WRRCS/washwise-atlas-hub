import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getPhotoEmailSettings, savePhotoEmailSettings } from '@/lib/photo-upload-alerts.functions';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';

export function PhotoEmailSettings() {
  const load = useServerFn(getPhotoEmailSettings);
  const save = useServerFn(savePhotoEmailSettings);
  const qc = useQueryClient();
  const query = useQuery({ queryKey:['photo-email-settings'],queryFn:() => load() });
  const [enabled,setEnabled] = useState(false);
  const [recipient,setRecipient] = useState('');
  const [busy,setBusy] = useState(false);
  useEffect(() => { if (query.data) { setEnabled(query.data.settings.enabled);setRecipient(query.data.settings.recipient_id ?? ''); } },[query.data]);
  return <section className="border-b border-border pb-6 space-y-4" aria-label="Photo upload emails">
    <h3 className="font-semibold">Cleaner photo upload emails</h3>
    {query.error ? <p className="text-destructive">Unable to load photo email settings.</p> : <>
      <label className="flex items-center gap-3"><Switch checked={enabled} onCheckedChange={setEnabled} disabled={query.isLoading || busy} />{enabled ? 'Enabled' : 'Off'}</label>
      <label className="block text-sm">Owner/admin recipient
        <select aria-label="Photo email recipient" value={recipient} onChange={e => setRecipient(e.target.value)} className="block mt-2 w-full max-w-lg border border-input bg-background rounded-md p-2">
          <option value="">Choose recipient</option>{query.data?.recipients.map(r => <option key={r.id} value={r.id}>{r.full_name || 'Owner/manager'} · {r.email}</option>)}
        </select>
      </label>
      <p className="text-sm text-muted-foreground">One recipient per upload alert. Closely spaced uploads are grouped after 20 seconds without new photos. Client emails and texts remain on hold.</p>
      <Button disabled={busy || query.isLoading || (enabled && !recipient)} onClick={async () => {
        setBusy(true);
        try { await save({ data:{ enabled,recipient_id:recipient || null } });await qc.invalidateQueries({ queryKey:['photo-email-settings'] });toast.success('Photo email settings saved'); }
        catch (e) { toast.error(e instanceof Error ? e.message : 'Unable to save'); }
        finally { setBusy(false); }
      }}>{busy ? 'Saving…' : 'Save photo email settings'}</Button>
      <h4 className="text-sm font-semibold">Recent photo email delivery</h4>
      <ul className="space-y-2 text-sm">{query.data?.logs.map(log => {
        const detail = JSON.parse(log.description);
        return <li key={log.id} className="border-t border-border pt-2 break-words">{detail.status} · {detail.cleanerName} · {detail.propertyName} · {detail.photoCount} photos · {detail.recipient}{detail.error && <span className="block text-destructive">{detail.error}</span>}</li>;
      })}</ul>
      {!query.data?.logs.length && <p className="text-sm text-muted-foreground">No photo emails sent yet.</p>}
    </>}
  </section>;
}