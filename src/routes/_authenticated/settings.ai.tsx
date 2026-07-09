import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/app-shell";
import { getAtlasSettings, setAtlasEnabled, getAtlasUsage } from "@/lib/atlas-ai.functions";

export const Route = createFileRoute("/_authenticated/settings/ai")({
  component: AiSettingsPage,
});

function AiSettingsPage() {
  const qc = useQueryClient();
  const fetchSettings = useServerFn(getAtlasSettings);
  const updateEnabled = useServerFn(setAtlasEnabled);
  const fetchUsage = useServerFn(getAtlasUsage);

  const settings = useQuery({ queryKey: ["atlas-settings"], queryFn: () => fetchSettings() });
  const usage = useQuery({ queryKey: ["atlas-usage"], queryFn: () => fetchUsage() });

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => updateEnabled({ data: { enabled } }),
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["atlas-settings"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save"),
  });

  const money = (c: number) => `$${(c / 100).toFixed(4)}`;

  return (
    <AppShell>
      <PageHeader title="AI Assistant" subtitle="Configure Atlas AI for your workspace" />
      <div className="max-w-3xl mx-auto p-6 md:p-8 space-y-6">
        <section className="bg-clay-100 rounded-lg ring-1 ring-black/5 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-medium">Enable Atlas AI</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Allow team members to ask Atlas questions about your business data. When off, the "Ask Atlas" button is hidden and no AI calls are made.
              </p>
            </div>
            <label className="inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={!!settings.data?.enabled}
                disabled={!settings.data?.isOwner || toggle.isPending}
                onChange={(e) => toggle.mutate(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-clay-200 rounded-full peer-checked:bg-brand peer-disabled:opacity-50 relative transition-colors">
                <div className="absolute left-0.5 top-0.5 size-5 bg-white rounded-full transition-transform peer-checked:translate-x-5" />
              </div>
            </label>
          </div>
          {!settings.data?.isOwner && (
            <p className="text-xs text-muted-foreground mt-3">Only owners can change this setting.</p>
          )}
        </section>

        <section className="bg-clay-100 rounded-lg ring-1 ring-black/5 p-5">
          <h2 className="font-medium mb-3">Usage this month</h2>
          {usage.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat label="Requests (month)" value={String(usage.data?.monthRequests ?? 0)} />
              <Stat label="Tokens (month)" value={(usage.data?.monthTokens ?? 0).toLocaleString()} />
              <Stat label="Est. cost (month)" value={money(usage.data?.monthCostCents ?? 0)} />
              <Stat label="Requests (total)" value={String(usage.data?.totalRequests ?? 0)} />
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-4">
            Estimates are based on published token pricing for the model in use and may differ from actual billing.
          </p>
        </section>

        <section className="bg-clay-100 rounded-lg ring-1 ring-black/5 p-5 text-sm text-muted-foreground space-y-2">
          <h2 className="font-medium text-foreground">Privacy</h2>
          <p>Atlas only sees data belonging to your workspace. Requests are strictly scoped by your tenant — no cross-business data is ever shared with the model.</p>
          <p>Conversations are stored per user; you can delete individual conversations from the chat panel at any time.</p>
        </section>
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-xl font-medium mt-1">{value}</p>
    </div>
  );
}
