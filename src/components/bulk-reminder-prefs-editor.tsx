import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Users } from "lucide-react";
import {
  listEmployeeReminderPrefs,
  bulkUpsertReminderPrefs,
  REMINDER_LEAD_OPTIONS,
  type ReminderChannel,
} from "@/lib/reminder-prefs.functions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

const CHANNEL_OPTIONS: Array<{ value: ReminderChannel; label: string }> = [
  { value: "push", label: "Push" },
  { value: "email", label: "Email" },
  { value: "sms", label: "Text" },
];

function summarize(mins: number[]): string {
  if (!mins.length) return "—";
  return mins
    .slice()
    .sort((a, b) => b - a)
    .map((m) => REMINDER_LEAD_OPTIONS.find((o) => o.value === m)?.label ?? `${m}m before`)
    .join(", ");
}

export function BulkReminderPrefsEditor() {
  const qc = useQueryClient();
  const listFn = useServerFn(listEmployeeReminderPrefs);
  const bulkFn = useServerFn(bulkUpsertReminderPrefs);

  const q = useQuery({
    queryKey: ["employee-reminder-prefs"] as const,
    queryFn: () => listFn(),
  });

  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [enabled, setEnabled] = useState(true);
  const [leads, setLeads] = useState<Set<number>>(new Set([60]));
  const [channels, setChannels] = useState<Set<ReminderChannel>>(new Set(["push"]));

  const filtered = useMemo(() => {
    const rows = q.data ?? [];
    const f = filter.trim().toLowerCase();
    if (!f) return rows;
    return rows.filter(
      (r) =>
        (r.full_name ?? "").toLowerCase().includes(f) ||
        (r.email ?? "").toLowerCase().includes(f),
    );
  }, [q.data, filter]);

  const allVisibleSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.user_id));

  const mut = useMutation({
    mutationFn: async () => {
      const user_ids = Array.from(selected);
      return bulkFn({
        data: {
          user_ids,
          lead_minutes: Array.from(leads).sort((a, b) => b - a),
          channels: Array.from(channels),
          enabled,
        },
      });
    },
    onSuccess: (res: any) => {
      toast.success(`Updated ${res?.updated ?? 0} employee${res?.updated === 1 ? "" : "s"}`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["employee-reminder-prefs"] });
    },
    onError: (e: any) => {
      toast.error(e?.message ?? "Failed to apply changes");
    },
  });

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleLead = (v: number) =>
    setLeads((prev) => {
      const next = new Set(prev);
      next.has(v) ? next.delete(v) : next.add(v);
      return next;
    });

  const toggleChannel = (v: ReminderChannel) =>
    setChannels((prev) => {
      const next = new Set(prev);
      next.has(v) ? next.delete(v) : next.add(v);
      return next;
    });

  const canApply = selected.size > 0 && leads.size > 0 && channels.size > 0 && !mut.isPending;

  return (
    <div className="bg-card rounded-xl ring-1 ring-black/5 p-6">
      <div className="flex items-start gap-3 mb-4">
        <div className="mt-1 h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <Users className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">Bulk employee reminders</h3>
          <p className="text-xs text-muted-foreground">
            Apply the same reminder schedule to multiple employees at once. Overrides each selected person's current preferences.
          </p>
        </div>
      </div>

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading employees…</p>
      ) : q.isError ? (
        <p className="text-sm text-destructive">{(q.error as Error).message}</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {/* Left: employee list */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Input
                placeholder="Search employees…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="h-9"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const ids = filtered.map((r) => r.user_id);
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (allVisibleSelected) ids.forEach((id) => next.delete(id));
                    else ids.forEach((id) => next.add(id));
                    return next;
                  });
                }}
              >
                {allVisibleSelected ? "Clear" : "All"}
              </Button>
            </div>
            <div className="max-h-80 overflow-auto rounded-md ring-1 ring-black/5 divide-y">
              {filtered.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">No employees match.</div>
              ) : (
                filtered.map((r) => (
                  <label
                    key={r.user_id}
                    className="flex items-start gap-3 p-3 hover:bg-muted/40 cursor-pointer"
                  >
                    <Checkbox
                      checked={selected.has(r.user_id)}
                      onCheckedChange={() => toggle(r.user_id)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">
                        {r.full_name ?? r.email ?? "Unnamed"}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {r.is_default ? "Default schedule" : summarize(r.lead_minutes)}
                        {" · "}
                        {r.enabled ? r.channels.join(", ") : "off"}
                      </div>
                    </div>
                  </label>
                ))
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {selected.size} selected
            </div>
          </div>

          {/* Right: settings + apply */}
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-md ring-1 ring-black/5 p-3">
              <div>
                <div className="text-sm font-medium">Reminders enabled</div>
                <div className="text-xs text-muted-foreground">Turn off to silence all reminders for selected employees.</div>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>

            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Lead times</Label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {REMINDER_LEAD_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className="flex items-center gap-2 rounded-md ring-1 ring-black/5 p-2 cursor-pointer hover:bg-muted/40"
                  >
                    <Checkbox
                      checked={leads.has(opt.value)}
                      onCheckedChange={() => toggleLead(opt.value)}
                    />
                    <span className="text-sm">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Channels</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {CHANNEL_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className="flex items-center gap-2 rounded-md ring-1 ring-black/5 px-3 py-2 cursor-pointer hover:bg-muted/40"
                  >
                    <Checkbox
                      checked={channels.has(opt.value)}
                      onCheckedChange={() => toggleChannel(opt.value)}
                    />
                    <span className="text-sm">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <Button
              type="button"
              disabled={!canApply}
              onClick={() => mut.mutate()}
              className="w-full"
            >
              {mut.isPending
                ? "Applying…"
                : `Apply to ${selected.size} employee${selected.size === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
