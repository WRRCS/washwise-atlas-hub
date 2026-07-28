import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { format } from "date-fns";

export const Route = createFileRoute("/portal/dashboard")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "My Portal — Wash Rinse Repeat Cleaning" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PortalDashboard,
});

type PortalData = {
  clients: Array<{ id: string; tenant_id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null; service_address: string | null }>;
  tenants: Array<{ id: string; name: string; business_email: string | null; business_phone: string | null; logo_url: string | null; primary_color: string | null }>;
  jobs: Array<{ id: string; client_id: string; status: string; scheduled_start: string; scheduled_end: string; actual_end: string | null; service_name: string | null; price_cents: number }>;
  invoices: Array<{ id: string; number: string; status: string; total_cents: number; issue_date: string; due_date: string | null; paid_at: string | null; pay_link: string | null; client_id: string }>;
  messages: Array<{ id: string; client_id: string; sender_type: "client" | "business"; body: string; created_at: string; read_at: string | null }>;
  requests: Array<{ id: string; client_id: string; status: string; requested_date: string | null; notes: string | null; service_type_id: string | null; created_at: string }>;
};

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function PortalDashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) navigate({ to: "/portal", replace: true });
      else setChecking(false);
    });
  }, [navigate]);

  const { data, isLoading } = useQuery({
    queryKey: ["portal-data"],
    enabled: !checking,
    queryFn: async (): Promise<PortalData> => {
      const { data, error } = await supabase.rpc("portal_get_data");
      if (error) throw error;
      return data as unknown as PortalData;
    },
  });

  const [activeClientId, setActiveClientId] = useState<string | null>(null);
  useEffect(() => {
    if (data?.clients?.length && !activeClientId) setActiveClientId(data.clients[0].id);
  }, [data, activeClientId]);

  const sendMessage = useMutation({
    mutationFn: async (body: string) => {
      const { error } = await supabase.rpc("portal_send_message", { _client_id: activeClientId!, _body: body });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-data"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to send"),
  });

  const requestService = useMutation({
    mutationFn: async (input: { requested_date: string | null; notes: string }) => {
      const { error } = await supabase.rpc("portal_request_service", {
        _client_id: activeClientId!,
        _service_type_id: null,
        _requested_date: input.requested_date,
        _notes: input.notes,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Request sent — we'll be in touch shortly.");
      qc.invalidateQueries({ queryKey: ["portal-data"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to submit"),
  });

  const handleSignOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/portal", replace: true });
  };

  if (checking || isLoading) {
    return <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">Loading your portal…</div>;
  }
  if (!data || data.clients.length === 0) {
    return (
      <div className="min-h-screen grid place-items-center px-4">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-xl font-medium">No account found</h1>
          <p className="text-sm text-muted-foreground">We couldn't find any client records matching your email. Please contact us so we can link your account.</p>
          <Button onClick={handleSignOut}>Sign out</Button>
        </div>
      </div>
    );
  }

  const client = data.clients.find((c) => c.id === activeClientId) ?? data.clients[0];
  const tenant = data.tenants.find((t) => t.id === client.tenant_id);
  const jobs = data.jobs.filter((j) => j.client_id === client.id);
  const invoices = data.invoices.filter((i) => i.client_id === client.id);
  const messages = data.messages.filter((m) => m.client_id === client.id);
  const requests = data.requests.filter((r) => r.client_id === client.id);
  const upcoming = jobs.filter((j) => j.status === "scheduled" || j.status === "in_progress");
  const past = jobs.filter((j) => j.status === "completed" || j.status === "canceled");
  const openInvoices = invoices.filter((i) => i.status !== "paid" && i.status !== "void" && i.status !== "cancelled");

  return (
    <div className="min-h-screen bg-clay-50">
      <header className="border-b bg-white">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {tenant?.logo_url ? (
              <img src={tenant.logo_url} alt="" className="h-9 w-9 rounded object-contain" />
            ) : (
              <div className="size-9 rounded bg-brand grid place-items-center">
                <div className="size-2 rounded-full bg-clay-50" />
              </div>
            )}
            <div>
              <div className="text-sm font-medium">{tenant?.name ?? "Client Portal"}</div>
              <div className="text-xs text-muted-foreground">Hi, {client.first_name ?? client.email}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {data.clients.length > 1 && (
              <select
                className="text-sm border rounded px-2 py-1.5 bg-background"
                value={client.id}
                onChange={(e) => setActiveClientId(e.target.value)}
              >
                {data.clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
                ))}
              </select>
            )}
            <Button variant="ghost" size="sm" onClick={handleSignOut}>Sign out</Button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        <Tabs defaultValue="jobs">
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="jobs">Jobs</TabsTrigger>
            <TabsTrigger value="invoices">
              Invoices{openInvoices.length > 0 && <Badge variant="secondary" className="ml-2">{openInvoices.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="messages">Messages</TabsTrigger>
            <TabsTrigger value="request">Request service</TabsTrigger>
          </TabsList>

          <TabsContent value="jobs" className="space-y-6 mt-6">
            <section>
              <h2 className="text-sm font-medium text-muted-foreground mb-3">Upcoming</h2>
              {upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No upcoming appointments.</p>
              ) : (
                <div className="space-y-2">
                  {upcoming.map((j) => <JobCard key={j.id} job={j} />)}
                </div>
              )}
            </section>
            <section>
              <h2 className="text-sm font-medium text-muted-foreground mb-3">Past</h2>
              {past.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No past appointments yet.</p>
              ) : (
                <div className="space-y-2">
                  {past.slice(0, 20).map((j) => <JobCard key={j.id} job={j} />)}
                </div>
              )}
            </section>
          </TabsContent>

          <TabsContent value="invoices" className="mt-6 space-y-2">
            {invoices.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No invoices yet.</p>
            ) : (
              invoices.map((inv) => (
                <div key={inv.id} className="rounded-lg bg-card ring-1 ring-black/5 p-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium">#{inv.number}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Issued {format(new Date(inv.issue_date), "MMM d, yyyy")}
                      {inv.due_date && ` · Due ${format(new Date(inv.due_date), "MMM d")}`}
                    </div>
                    <div className="mt-1"><StatusBadge status={inv.status} /></div>
                  </div>
                  <div className="text-right">
                    <div className="text-base font-medium">{money(inv.total_cents)}</div>
                    {inv.status !== "paid" && (
                      <Link to="/pay/$invoiceId" params={{ invoiceId: inv.id }} className="text-xs text-brand hover:underline">
                        Pay now →
                      </Link>
                    )}
                  </div>
                </div>
              ))
            )}
          </TabsContent>

          <TabsContent value="messages" className="mt-6">
            <MessageThread
              messages={messages}
              onSend={(body) => sendMessage.mutateAsync(body)}
              sending={sendMessage.isPending}
            />
          </TabsContent>

          <TabsContent value="request" className="mt-6">
            <RequestForm
              onSubmit={(v) => requestService.mutateAsync(v)}
              submitting={requestService.isPending}
              recent={requests.slice(0, 5)}
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function JobCard({ job }: { job: PortalData["jobs"][number] }) {
  const start = new Date(job.scheduled_start);
  return (
    <div className="rounded-lg bg-card ring-1 ring-black/5 p-4 flex items-start justify-between gap-3">
      <div>
        <div className="text-sm font-medium">{job.service_name ?? "Service"}</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {format(start, "EEE, MMM d · h:mm a")}
        </div>
        <div className="mt-1"><StatusBadge status={job.status} /></div>
      </div>
      <div className="text-sm font-medium text-muted-foreground">{money(job.price_cents)}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    scheduled: "bg-blue-100 text-blue-800",
    in_progress: "bg-amber-100 text-amber-800",
    completed: "bg-emerald-100 text-emerald-800",
    canceled: "bg-slate-100 text-slate-700",
    draft: "bg-slate-100 text-slate-700",
    sent: "bg-blue-100 text-blue-800",
    overdue: "bg-rose-100 text-rose-800",
    paid: "bg-emerald-100 text-emerald-800",
    void: "bg-slate-100 text-slate-700",
    cancelled: "bg-slate-100 text-slate-700",
  };
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${map[status] ?? "bg-slate-100 text-slate-700"}`}>{status.replace("_", " ")}</span>;
}

function MessageThread({ messages, onSend, sending }: { messages: PortalData["messages"]; onSend: (b: string) => Promise<unknown>; sending: boolean }) {
  const [body, setBody] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    await onSend(body.trim());
    setBody("");
  };
  return (
    <div className="rounded-lg bg-card ring-1 ring-black/5 flex flex-col h-[500px]">
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground italic text-center pt-6">No messages yet. Send us a note below.</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.sender_type === "client" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${m.sender_type === "client" ? "bg-brand text-brand-foreground" : "bg-muted"}`}>
                <div className="whitespace-pre-wrap">{m.body}</div>
                <div className={`text-[10px] mt-1 ${m.sender_type === "client" ? "text-brand-foreground/70" : "text-muted-foreground"}`}>
                  {format(new Date(m.created_at), "MMM d, h:mm a")}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      <form onSubmit={submit} className="border-t p-3 flex gap-2">
        <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Type a message…" />
        <Button type="submit" disabled={sending || !body.trim()}>{sending ? "…" : "Send"}</Button>
      </form>
    </div>
  );
}

function RequestForm({ onSubmit, submitting, recent }: { onSubmit: (v: { requested_date: string | null; notes: string }) => Promise<unknown>; submitting: boolean; recent: PortalData["requests"] }) {
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notes.trim()) {
      toast.error("Please describe what you need.");
      return;
    }
    await onSubmit({ requested_date: date || null, notes: notes.trim() });
    setDate("");
    setNotes("");
  };
  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="rounded-lg bg-card ring-1 ring-black/5 p-5 space-y-4">
        <div>
          <h2 className="text-base font-medium">Request a service</h2>
          <p className="text-sm text-muted-foreground mt-1">Tell us what you need and when. We'll confirm by message.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="date">Preferred date (optional)</Label>
          <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="notes">What do you need?</Label>
          <Textarea id="notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Deep clean, 3 bed / 2 bath, prefer mornings…" />
        </div>
        <Button type="submit" disabled={submitting}>{submitting ? "Sending…" : "Submit request"}</Button>
      </form>

      {recent.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-2">Recent requests</h3>
          <div className="space-y-2">
            {recent.map((r) => (
              <div key={r.id} className="rounded-lg bg-card ring-1 ring-black/5 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(r.created_at), "MMM d, yyyy")}
                    {r.requested_date && ` · Wants ${format(new Date(r.requested_date), "MMM d")}`}
                  </span>
                  <StatusBadge status={r.status} />
                </div>
                {r.notes && <div className="mt-1 whitespace-pre-wrap">{r.notes}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
