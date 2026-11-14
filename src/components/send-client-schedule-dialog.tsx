import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { previewClientSchedules, sendClientSchedules, type ClientSchedulePreview } from "@/lib/client-schedule.functions";

const STATUS: Record<ClientSchedulePreview["status"], { label: string; cls: string }> = {
  new: { label: "Not sent yet", cls: "bg-brand/15 text-foreground" },
  changed: { label: "Changed since last sent", cls: "bg-destructive/15 text-destructive" },
  sent: { label: "Already sent — no changes", cls: "bg-muted text-muted-foreground" },
};

/** Clients hear about their schedule only from this button. */
export function SendClientScheduleButton({ from, to, weekLabel }: { from: string; to: string; weekLabel: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Mail className="size-3.5 mr-1" /> Send schedule to clients
      </Button>
      {open && <SendDialog from={from} to={to} weekLabel={weekLabel} onClose={() => setOpen(false)} />}
    </>
  );
}

type Channel = "email" | "text" | "both";
const CHANNELS: { value: Channel; label: string }[] = [
  { value: "email", label: "Send email" },
  { value: "text", label: "Send text" },
  { value: "both", label: "Send both" },
];

function SendDialog({ from, to, weekLabel, onClose }: { from: string; to: string; weekLabel: string; onClose: () => void }) {
  const qc = useQueryClient();
  const preview = useServerFn(previewClientSchedules);
  const send = useServerFn(sendClientSchedules);
  const q = useQuery({ queryKey: ["client-schedule-preview", from, to], queryFn: () => preview({ data: { from, to } }) });
  const [channel, setChannel] = useState<Channel>("email");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const textingReady = q.data?.texting_ready ?? false;
  const rows = q.data?.clients ?? [];

  const wantEmail = channel !== "text", wantText = channel !== "email";
  /** Whether this client has anything left to receive on the chosen channel(s). */
  const canGet = (c: ClientSchedulePreview) =>
    (wantEmail && c.has_email && c.status !== "sent") || (wantText && textingReady && c.has_phone && c.text_status !== "sent");
  const reachable = (c: ClientSchedulePreview) => (wantEmail && c.has_email) || (wantText && textingReady && c.has_phone);

  useEffect(() => {
    if (q.data) setPicked(new Set(rows.filter(canGet).map((c) => c.client_id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, channel]);

  const sendM = useMutation({
    mutationFn: () => send({ data: { from, to, client_ids: [...picked], channel } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["client-schedule-preview"] });
      setConfirm(false);
      const parts = [r.sent && `emailed ${r.sent}`, r.texted && `texted ${r.texted}`].filter(Boolean);
      if (parts.length) toast.success(`Schedule ${parts.join(" and ")} client${(r.sent || r.texted) === 1 ? "" : "s"}`);
      if (r.skipped.length) toast.warning(`Not sent: ${r.skipped.join(", ")}`, { duration: 10000 });
      if (!r.skipped.length) onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not send"),
  });

  const toggle = (id: string, on: boolean) =>
    setPicked((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const how = channel === "both" ? "Email and text" : channel === "text" ? "Text" : "Email";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Send schedule to clients · {weekLabel}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Clients never get schedule notices on their own. Each checked client gets their cleanings for this week:
          the cleaning's overall time only, never which cleaners are coming.
        </p>
        <div role="radiogroup" aria-label="How to send" className="flex flex-wrap gap-2">
          {CHANNELS.map((o) => {
            const off = o.value !== "email" && !textingReady;
            return (
              <Button key={o.value} type="button" size="sm" role="radio" aria-checked={channel === o.value} disabled={off}
                variant={channel === o.value ? "default" : "outline"}
                className={channel === o.value ? "bg-brand text-brand-foreground hover:bg-brand/90" : ""}
                onClick={() => { setChannel(o.value); setConfirm(false); }}>
                {o.label}
              </Button>
            );
          })}
        </div>
        {q.data && !textingReady && (
          <p className="text-xs text-muted-foreground">Texting isn't set up yet. Once the business text number is connected, "Send text" and "Send both" turn on.</p>
        )}
        <div className="space-y-2">
          {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {q.error && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}
          {!q.isLoading && !rows.length && <p className="text-sm text-muted-foreground">No client cleanings this week.</p>}
          {rows.map((c) => {
            const ok = reachable(c);
            return (
              <label key={c.client_id} className={`flex gap-3 rounded-md border p-3 ${ok ? "cursor-pointer" : "opacity-60"}`}>
                <Checkbox
                  className="mt-0.5"
                  disabled={!ok}
                  checked={picked.has(c.client_id)}
                  onCheckedChange={(v) => toggle(c.client_id, v === true)}
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{c.client_name}</span>
                    {wantEmail && (c.has_email
                      ? <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS[c.status].cls}`}>Email: {STATUS[c.status].label}</span>
                      : <span className="text-xs text-muted-foreground">No email on file</span>)}
                    {wantText && textingReady && (c.has_phone
                      ? <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS[c.text_status].cls}`}>Text: {STATUS[c.text_status].label}</span>
                      : <span className="text-xs text-muted-foreground">No phone on file</span>)}
                  </div>
                  <ul className="text-xs text-muted-foreground">
                    {c.lines.map((l) => <li key={l}>{l}</li>)}
                  </ul>
                </div>
              </label>
            );
          })}
        </div>
        <DialogFooter>
          {confirm ? (
            <>
              <span className="mr-auto self-center text-sm">{how} {picked.size} client{picked.size === 1 ? "" : "s"} now?</span>
              <Button variant="outline" onClick={() => setConfirm(false)} disabled={sendM.isPending}>Back</Button>
              <Button className="bg-brand text-brand-foreground hover:opacity-90" onClick={() => sendM.mutate()} disabled={sendM.isPending}>
                {sendM.isPending ? "Sending…" : "Yes, send"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button className="bg-brand text-brand-foreground hover:opacity-90" disabled={!picked.size} onClick={() => setConfirm(true)}>
                {how === "Email and text" ? "Email & text" : how} {picked.size} client{picked.size === 1 ? "" : "s"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
