import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/app-shell";
import { getTenantGpsSettings, updateTenantGpsSettings, purgeExpiredGps } from "@/lib/time.functions";

export const Route = createFileRoute("/_authenticated/settings/business")({
  component: BusinessSettingsPage,
});

function BusinessSettingsPage() {
  const qc = useQueryClient();
  const fetchSettings = useServerFn(getTenantGpsSettings);
  const updateSettings = useServerFn(updateTenantGpsSettings);
  const purge = useServerFn(purgeExpiredGps);

  const q = useQuery({ queryKey: ["tenant-gps-settings"], queryFn: () => fetchSettings() });
  const [track, setTrack] = useState(false);
  const [days, setDays] = useState(90);

  useEffect(() => {
    if (q.data) {
      setTrack(q.data.track_gps);
      setDays(q.data.gps_retention_days);
    }
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => updateSettings({ data: { track_gps: track, gps_retention_days: days } }),
    onSuccess: () => {
      toast.success("Settings saved");
      qc.invalidateQueries({ queryKey: ["tenant-gps-settings"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save"),
  });

  const runPurge = useMutation({
    mutationFn: () => purge(),
    onSuccess: (r: any) => toast.success(`Purged ${r?.purged ?? 0} old GPS records`),
    onError: (e: any) => toast.error(e?.message ?? "Failed to purge"),
  });

  return (
    <AppShell>
      <PageHeader title="Business profile" subtitle="Company-wide preferences" />
      <div className="max-w-2xl w-full mx-auto px-6 md:px-8 py-6 space-y-6">
        <section className="bg-card rounded-xl ring-1 ring-black/5 p-6">
          <h2 className="text-lg font-medium mb-1">Employee GPS tracking</h2>
          <p className="text-sm text-muted-foreground mb-4">
            When enabled, employees are asked for their device location the moment they tap Clock In or Clock Out.
            Location is <strong>never</strong> collected in the background — only at those two explicit taps.
            Employees may still clock in if they decline; you'll simply see no location for that entry.
          </p>

          <label className="flex items-center gap-3 py-3 border-t border-border/60">
            <input
              type="checkbox"
              checked={track}
              onChange={(e) => setTrack(e.target.checked)}
              className="size-4"
            />
            <span className="text-sm font-medium">Track employee GPS on clock-in</span>
          </label>

          <div className="border-t border-border/60 pt-4">
            <label className="block text-sm font-medium mb-1">GPS data retention (days)</label>
            <p className="text-xs text-muted-foreground mb-2">
              Coordinates older than this are automatically cleared. Default: 90 days.
            </p>
            <input
              type="number"
              min={1}
              max={3650}
              value={days}
              onChange={(e) => setDays(Number(e.target.value) || 90)}
              className="w-32 border border-border rounded-lg px-3 py-2 text-sm bg-clay-50 tabular-nums"
            />
          </div>

          <div className="flex justify-between items-center mt-6 pt-4 border-t border-border/60">
            <button
              type="button"
              onClick={() => runPurge.mutate()}
              disabled={runPurge.isPending}
              className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4 disabled:opacity-50"
            >
              {runPurge.isPending ? "Purging…" : "Purge expired GPS data now"}
            </button>
            <button
              type="button"
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="bg-brand text-brand-foreground text-sm font-medium rounded-lg px-4 py-2 hover:opacity-90 disabled:opacity-50"
            >
              {save.isPending ? "Saving…" : "Save changes"}
            </button>
          </div>
        </section>

        <p className="text-xs text-muted-foreground">
          🛡️ Privacy: employees can see their own GPS history in their timesheet. Owners can view GPS only for jobs
          they manage — never personal movements outside working hours.
        </p>
      </div>
    </AppShell>
  );
}
