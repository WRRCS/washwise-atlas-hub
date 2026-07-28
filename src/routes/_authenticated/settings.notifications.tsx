import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { PageHeader } from "@/components/app-shell";
import {
  listTemplates,
  updateTemplate,
  getReminderLead,
  setReminderLead,
  listRecentNotifications,
  type NotificationTemplate,
} from "@/lib/notifications.functions";
import { amIOwner } from "@/lib/entities.functions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StaffReminderPrefs } from "@/components/reminder-prefs-editor";
import { BulkReminderPrefsEditor } from "@/components/bulk-reminder-prefs-editor";

export const Route = createFileRoute("/_authenticated/settings/notifications")({
  component: NotificationsSettings,
  errorComponent: ({ error }) => <div className="p-8 text-sm text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-8">Not found.</div>,
});

const SAMPLE: Record<string, string> = {
  client_first_name: "Jamie",
  client_name: "Jamie Rivera",
  service_name: "Residential Cleaning",
  scheduled_start: "Sat, Jul 4 at 10:00 AM",
  invoice_number: "WRR-2026-042",
  total: "$180.00",
  due_date: "Jul 18, 2026",
  pay_link: "https://pay.example.com/inv/xyz",
  employee_name: "Alex Chen",
  completed_at: "Jul 3 at 2:15 PM",
  job_link: "https://atlas.example.com/jobs/abc",
};

function render(body: string, vars: Record<string, string>) {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}

function NotificationsSettings() {
  const qc = useQueryClient();
  const listFn = useServerFn(listTemplates);
  const updateFn = useServerFn(updateTemplate);
  const leadFn = useServerFn(getReminderLead);
  const setLeadFn = useServerFn(setReminderLead);
  const logsFn = useServerFn(listRecentNotifications);
  const ownerFn = useServerFn(amIOwner);

  const templates = useQuery<NotificationTemplate[]>({ queryKey: ["notification-templates"], queryFn: () => listFn() });
  const lead = useQuery<{ reminder_lead_hours: number }>({ queryKey: ["reminder-lead"], queryFn: () => leadFn() });
  const logs = useQuery<Array<{ id: string; template_name: string; channel: string; scheduled_for: string; status: string }>>({ queryKey: ["notifications-recent"], queryFn: () => logsFn() });
  const ownerInfo = useQuery({ queryKey: ["am_i_owner"], queryFn: () => ownerFn() });
  const isOwner = !!(ownerInfo.data as any)?.isOwner;

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Templates and delivery rules for client + team messaging"
      />
      <div className="max-w-6xl mx-auto w-full px-6 md:px-8 py-8 space-y-8">
        <div className="bg-card rounded-xl ring-1 ring-black/5 p-6">
          <h3 className="text-sm font-semibold mb-1">Default client reminder lead time</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Used for clients who haven't set their own reminder schedule in the client portal.
          </p>
          <LeadEditor
            initial={lead.data?.reminder_lead_hours ?? 24}
            onSave={async (h) => {
              await setLeadFn({ data: { hours: h } });
              toast.success("Saved");
              qc.invalidateQueries({ queryKey: ["reminder-lead"] });
            }}
          />
        </div>

        <StaffReminderPrefs />

        <Tabs defaultValue="templates">
          <TabsList>
            <TabsTrigger value="templates">Templates</TabsTrigger>
            <TabsTrigger value="queue">Recent queue</TabsTrigger>
          </TabsList>
          <TabsContent value="templates" className="mt-4">
            {templates.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <div className="space-y-4">
                {(templates.data ?? []).map((t) => (
                  <TemplateCard
                    key={t.id}
                    tpl={t}
                    onSave={async (patch) => {
                      await updateFn({ data: { id: t.id, ...patch } });
                      toast.success("Template saved");
                      qc.invalidateQueries({ queryKey: ["notification-templates"] });
                    }}
                  />
                ))}
              </div>
            )}
          </TabsContent>
          <TabsContent value="queue" className="mt-4">
            <div className="bg-card rounded-xl ring-1 ring-black/5 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-clay-100 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2">Template</th>
                    <th className="text-left px-4 py-2">Channel</th>
                    <th className="text-left px-4 py-2">Scheduled</th>
                    <th className="text-left px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(logs.data ?? []).map((n) => (
                    <tr key={n.id} className="border-t border-border/40">
                      <td className="px-4 py-2 font-mono text-xs">{n.template_name}</td>
                      <td className="px-4 py-2">{n.channel}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {format(new Date(n.scheduled_for), "MMM d, h:mm a")}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          n.status === "pending" ? "bg-clay-200 text-muted-foreground" :
                          n.status === "sent" ? "bg-green-100 text-green-800" :
                          "bg-red-100 text-red-800"
                        }`}>{n.status}</span>
                      </td>
                    </tr>
                  ))}
                  {!logs.data?.length && (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">No notifications queued yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

function LeadEditor({ initial, onSave }: { initial: number; onSave: (h: number) => Promise<void> }) {
  const [h, setH] = useState(initial);
  useEffect(() => setH(initial), [initial]);
  return (
    <div className="flex items-center gap-3">
      <input
        type="number"
        min={1}
        max={168}
        value={h}
        onChange={(e) => setH(parseInt(e.target.value) || 1)}
        className="w-24 rounded-lg border border-input bg-background px-3 py-2 text-sm"
      />
      <span className="text-sm text-muted-foreground">hours before appointment</span>
      <button
        onClick={() => onSave(h)}
        disabled={h === initial}
        className="ml-auto text-sm font-medium bg-brand text-brand-foreground rounded-lg px-3 py-2 hover:opacity-90 disabled:opacity-40"
      >Save</button>
    </div>
  );
}

function TemplateCard({ tpl, onSave }: { tpl: NotificationTemplate; onSave: (patch: { subject?: string | null; body?: string; is_active?: boolean }) => Promise<void> }) {
  const [subject, setSubject] = useState(tpl.subject ?? "");
  const [body, setBody] = useState(tpl.body);
  const [active, setActive] = useState(tpl.is_active);
  const dirty = subject !== (tpl.subject ?? "") || body !== tpl.body;

  const preview = useMemo(() => render(body, SAMPLE), [body]);
  const previewSubject = useMemo(() => render(subject, SAMPLE), [subject]);

  return (
    <div className="bg-card rounded-xl ring-1 ring-black/5 p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h4 className="text-sm font-semibold font-mono">{tpl.name}</h4>
          <p className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5">{tpl.channel}</p>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={active}
            onChange={async (e) => {
              setActive(e.target.checked);
              await onSave({ is_active: e.target.checked });
            }}
            className="size-4 rounded"
          />
          {active ? "Active" : "Off"}
        </label>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-3">
          {tpl.channel === "email" && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Subject</label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Body</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={tpl.channel === "sms" ? 4 : 8}
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Variables: {"{{client_first_name}}, {{service_name}}, {{scheduled_start}}, {{invoice_number}}, {{total}}, {{due_date}}, {{pay_link}}, {{employee_name}}, {{job_link}}"}
            </p>
          </div>
          <button
            onClick={async () => {
              await onSave({ subject: tpl.channel === "email" ? subject : null, body });
            }}
            disabled={!dirty}
            className="text-sm font-medium bg-brand text-brand-foreground rounded-lg px-3 py-2 hover:opacity-90 disabled:opacity-40"
          >Save changes</button>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground">Preview (with sample data)</label>
          <div className="mt-1 rounded-lg border border-border/60 bg-clay-50 p-4 text-sm">
            {tpl.channel === "email" && previewSubject && (
              <p className="font-medium mb-2 pb-2 border-b border-border/40">{previewSubject}</p>
            )}
            <p className="whitespace-pre-wrap text-muted-foreground">{preview}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
