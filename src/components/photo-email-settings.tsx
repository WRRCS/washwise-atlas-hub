import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getPhotoEmailSettings, savePhotoEmailSettings } from '@/lib/photo-upload-alerts.functions';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Checkbox } from '@/components/ui/checkbox';
import { OUTLOOK_SENDER } from '@/lib/owner-email-events';

export function PhotoEmailSettings() {
  const load = useServerFn(getPhotoEmailSettings);
  const save = useServerFn(savePhotoEmailSettings);
  const qc = useQueryClient();
  const query = useQuery({ queryKey:['photo-email-settings'],queryFn:() => load() });
  const [enabled,setEnabled] = useState(false);
  const [recipient,setRecipient] = useState('');
  const [busy,setBusy] = useState(false);
  const [provider,setProvider] = useState<'managed'|'outlook'>('outlook');
  const [confirmed,setConfirmed] = useState(false);
  useEffect(() => { if (query.data) { setEnabled(query.data.settings.enabled);setRecipient(query.data.settings.recipient_id ?? '');setProvider(query.data.settings.provider ?? (query.data.settings.enabled ? 'managed' : 'outlook'));setConfirmed(query.data.settings.confirmed ?? false); } },[query.data]);
  return <section className="border-b border-border pb-6 space-y-4" aria-label="Photo upload emails">
    <h3 className="font-semibold">Cleaner photo upload emails</h3>
    {query.error ? <p className="text-destructive">Unable to load photo email settings.</p> : <>
      <label className="flex items-center gap-3"><Switch checked={enabled} onCheckedChange={setEnabled} disabled={query.isLoading || busy} />{enabled ? 'Enabled' : 'Off'}</label>
      <label className="block text-sm">Send using<select aria-label="Photo email sender" value={provider} onChange={e=>{setProvider(e.target.value==='outlook'?'outlook':'managed');setConfirmed(false);}} className="block mt-2 w-full max-w-lg border border-input bg-background rounded-md p-2"><option value="outlook">Outlook · {OUTLOOK_SENDER}</option><option value="managed">Existing WRRCS app email sender</option></select></label>
      <label className="block text-sm">Owner/admin recipient
        <select aria-label="Photo email recipient" value={recipient} onChange={e => {setRecipient(e.target.value);setConfirmed(false);}} className="block mt-2 w-full max-w-lg border border-input bg-background rounded-md p-2">
          <option value="">Choose recipient</option>{query.data?.recipients.map(r => <option key={r.id} value={r.id}>{r.full_name || 'Owner/manager'} · {r.email}</option>)}
        </select>
      </label>
      <p className="text-sm text-muted-foreground">One recipient per upload alert. Closely spaced uploads are grouped after 20 seconds without new photos. Client emails and texts remain on hold.</p>
      {provider==='outlook'&&<label className="flex items-start gap-3 text-sm"><Checkbox aria-label="Confirm photo email addresses" checked={confirmed} onCheckedChange={v=>setConfirmed(v===true)}/>I confirm this Outlook sender and the selected recipient.</label>}
      <Button disabled={busy || query.isLoading || (enabled && (!recipient || (provider==='outlook'&&!confirmed)))} onClick={async () => {
        setBusy(true);
        try { await save({ data:{ enabled,recipient_id:recipient || null,provider,confirmed } });await qc.invalidateQueries({ queryKey:['photo-email-settings'] });toast.success('Photo email settings saved'); }
        catch (e) { toast.error(e instanceof Error ? e.message : 'Unable to save'); }
        finally { setBusy(false); }
      }}>{busy ? 'Saving…' : 'Save photo email settings'}</Button>
      <h4 className="text-sm font-semibold">Recent photo email delivery</h4>
      <p className="text-sm text-muted-foreground">Accepted / sent means provider acceptance, not confirmed delivery. Outlook failures are not automatically resent.</p>
      <ul className="space-y-2 text-sm">{query.data?.logs.map(log => {
        const detail = JSON.parse(log.description);
        return <li key={log.id} className="border-t border-border pt-2 break-words">{detail.status} · {detail.cleanerName} · {detail.propertyName} · {detail.photoCount} photos · {detail.recipient}{detail.error && <span className="block text-destructive">{detail.error}</span>}</li>;
      })}</ul>
      {!query.data?.logs.length && <p className="text-sm text-muted-foreground">No photo emails sent yet.</p>}
    </>}
  </section>;
}