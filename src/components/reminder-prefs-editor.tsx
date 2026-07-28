import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Bell } from "lucide-react";
import {
  getMyReminderPrefs,
  upsertMyReminderPrefs,
  REMINDER_LEAD_OPTIONS,
  type ReminderChannel,
  type ReminderPrefs,
} from "@/lib/reminder-prefs.functions";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const CHANNEL_LABELS: Record<ReminderChannel, string> = {
  push: "Push notification",
  email: "Email",
  sms: "Text message",
};

export type ReminderPrefsEditorProps = {
  title?: string;
  description?: string;
  loader: () => Promise<ReminderPrefs>;
  saver: (prefs: { lead_minutes: number[]; channels: ReminderChannel[]; enabled: boolean }) => Promise<unknown>;
  queryKey: readonly unknown[];
  availableChannels?: ReminderChannel[];
};

export function ReminderPrefsEditor({
  title = "Reminder schedule",
  description = "Pick when and how you'd like to be reminded of upcoming jobs.",
  loader,
  saver,
  queryKey,
  availableChannels = ["push", "email", "sms"],
}: ReminderPrefsEditorProps) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey, queryFn: loader });

  const [enabled, setEnabled] = useState(true);
  const [leads, setLeads] = useState<Set<number>>(new Set([60]));
  const [channels, setChannels] = useState<Set<ReminderChannel>>(new Set(["push"]));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!q.data) return;
    setEnabled(q.data.enabled);
    setLeads(new Set(q.data.lead_minutes));
    setChannels(new Set(q.data.channels));
  }, [q.data]);

  const toggleLead = (m: number) => {
    setLeads((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  };

  const toggleChannel = (c: ReminderChannel) => {
    setChannels((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  const save = async () => {
    if (leads.size === 0) return toast.error("Pick at least one reminder time.");
    if (channels.size === 0) return toast.error("Pick at least one delivery channel.");
    setSaving(true);
    try {
      await saver({
        lead_minutes: Array.from(leads).sort((a, b) => b - a),
        channels: Array.from(channels),
        enabled,
      });
      toast.success("Reminder schedule saved");
      qc.invalidateQueries({ queryKey });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-card rounded-xl ring-1 ring-black/5 p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-brand-accent/10 p-2 text-brand-accent">
            <Bell className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">{title}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
            {q.data?.is_default && (
              <p className="text-[11px] text-muted-foreground mt-1 italic">
                Using default schedule until you save changes.
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Switch checked={enabled} onCheckedChange={setEnabled} id="reminders-enabled" />
          <Label htmlFor="reminders-enabled" className="text-xs">
            {enabled ? "On" : "Off"}
          </Label>
        </div>
      </div>

      <div className={enabled ? "space-y-6" : "space-y-6 opacity-50 pointer-events-none"}>
        <div>
          <div className="text-xs font-medium mb-2">When to remind you</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {REMINDER_LEAD_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-2 rounded-lg border border-input p-2.5 cursor-pointer hover:bg-accent"
              >
                <Checkbox
                  checked={leads.has(opt.value)}
                  onCheckedChange={() => toggleLead(opt.value)}
                />
                <span className="text-xs">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs font-medium mb-2">How to send them</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {availableChannels.map((c) => (
              <label
                key={c}
                className="flex items-center gap-2 rounded-lg border border-input p-2.5 cursor-pointer hover:bg-accent"
              >
                <Checkbox
                  checked={channels.has(c)}
                  onCheckedChange={() => toggleChannel(c)}
                />
                <span className="text-xs">{CHANNEL_LABELS[c]}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save schedule"}
        </Button>
      </div>
    </div>
  );
}

/** Convenience wrapper for signed-in employees/owners. */
export function StaffReminderPrefs() {
  const load = useServerFn(getMyReminderPrefs);
  const save = useServerFn(upsertMyReminderPrefs);
  return (
    <ReminderPrefsEditor
      queryKey={["my-reminder-prefs"] as const}
      loader={() => load()}
      saver={(prefs) => save({ data: prefs })}
    />
  );
}
