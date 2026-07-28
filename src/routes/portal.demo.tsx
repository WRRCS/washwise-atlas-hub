import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { format, addDays, subDays } from "date-fns";

export const Route = createFileRoute("/portal/demo")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Client Portal Preview — Atlas" },
      { name: "description", content: "Preview of the Atlas client portal experience." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PortalDemo,
});

const now = new Date();
const demo = {
  tenant: { name: "Wash Rinse Repeat Cleaning" },
  client: { first_name: "Jamie", email: "jamie@example.com" },
  jobs: [
    { id: "1", status: "scheduled", scheduled_start: addDays(now, 2).toISOString(), service_name: "Standard Clean", price_cents: 18500 },
    { id: "2", status: "scheduled", scheduled_start: addDays(now, 16).toISOString(), service_name: "Standard Clean", price_cents: 18500 },
    { id: "3", status: "completed", scheduled_start: subDays(now, 12).toISOString(), service_name: "Deep Clean", price_cents: 42000 },
    { id: "4", status: "completed", scheduled_start: subDays(now, 26).toISOString(), service_name: "Standard Clean", price_cents: 18500 },
  ],
  invoices: [
    { id: "inv1", number: "1043", status: "sent", total_cents: 18500, issue_date: subDays(now, 3).toISOString(), due_date: addDays(now, 11).toISOString() },
    { id: "inv2", number: "1039", status: "paid", total_cents: 42000, issue_date: subDays(now, 12).toISOString(), due_date: subDays(now, 2).toISOString() },
    { id: "inv3", number: "1032", status: "paid", total_cents: 18500, issue_date: subDays(now, 26).toISOString(), due_date: subDays(now, 16).toISOString() },
  ],
  messages: [
    { id: "m1", sender_type: "business" as const, body: "Hi Jamie! Just confirming your clean this Thursday at 10am.", created_at: subDays(now, 1).toISOString() },
    { id: "m2", sender_type: "client" as const, body: "Perfect, thanks! Please use the side gate — code is 4412.", created_at: subDays(now, 1).toISOString() },
    { id: "m3", sender_type: "business" as const, body: "Got it, we'll see you then 🧼", created_at: subDays(now, 1).toISOString() },
  ],
  requests: [
    { id: "r1", status: "pending", requested_date: addDays(now, 7).toISOString(), notes: "Would love a window add-on next visit if possible.", created_at: subDays(now, 2).toISOString() },
  ],
};

const money = (c: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(c / 100);

function PortalDemo() {
  const upcoming = demo.jobs.filter((j) => j.status === "scheduled");
  const past = demo.jobs.filter((j) => j.status === "completed");
  const openInvoices = demo.invoices.filter((i) => i.status !== "paid");

  return (
    <div className="min-h-screen bg-clay-50">
      <div className="bg-amber-100 border-b border-amber-200 text-amber-900 text-xs px-4 py-2 text-center">
        Preview mode — this is what your clients will see. <Link to="/portal" className="underline font-medium">Go to real portal →</Link>
      </div>
      <header className="border-b bg-white">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded bg-brand grid place-items-center">
              <div className="size-2 rounded-full bg-clay-50" />
            </div>
            <div>
              <div className="text-sm font-medium">{demo.tenant.name}</div>
              <div className="text-xs text-muted-foreground">Hi, {demo.client.first_name}</div>
            </div>
          </div>
          <Button variant="ghost" size="sm">Sign out</Button>
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
              <div className="space-y-2">{upcoming.map((j) => <JobCard key={j.id} job={j} />)}</div>
            </section>
            <section>
              <h2 className="text-sm font-medium text-muted-foreground mb-3">Past</h2>
              <div className="space-y-2">{past.map((j) => <JobCard key={j.id} job={j} />)}</div>
            </section>
          </TabsContent>

          <TabsContent value="invoices" className="mt-6 space-y-2">
            {demo.invoices.map((inv) => (
              <div key={inv.id} className="rounded-lg bg-card ring-1 ring-black/5 p-4 flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium">#{inv.number}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Issued {format(new Date(inv.issue_date), "MMM d, yyyy")} · Due {format(new Date(inv.due_date), "MMM d")}
                  </div>
                  <div className="mt-1"><StatusBadge status={inv.status} /></div>
                </div>
                <div className="text-right">
                  <div className="text-base font-medium">{money(inv.total_cents)}</div>
                  {inv.status !== "paid" && <span className="text-xs text-brand">Pay now →</span>}
                </div>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="messages" className="mt-6">
            <div className="rounded-lg bg-card ring-1 ring-black/5 flex flex-col h-[500px]">
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {demo.messages.map((m) => (
                  <div key={m.id} className={`flex ${m.sender_type === "client" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${m.sender_type === "client" ? "bg-brand text-brand-foreground" : "bg-muted"}`}>
                      <div className="whitespace-pre-wrap">{m.body}</div>
                      <div className={`text-[10px] mt-1 ${m.sender_type === "client" ? "text-brand-foreground/70" : "text-muted-foreground"}`}>
                        {format(new Date(m.created_at), "MMM d, h:mm a")}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <form onSubmit={(e) => e.preventDefault()} className="border-t p-3 flex gap-2">
                <Input placeholder="Type a message…" />
                <Button type="submit">Send</Button>
              </form>
            </div>
          </TabsContent>

          <TabsContent value="request" className="mt-6">
            <RequestDemo recent={demo.requests} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function JobCard({ job }: { job: (typeof demo.jobs)[number] }) {
  return (
    <div className="rounded-lg bg-card ring-1 ring-black/5 p-4 flex items-start justify-between gap-3">
      <div>
        <div className="text-sm font-medium">{job.service_name}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{format(new Date(job.scheduled_start), "EEE, MMM d · h:mm a")}</div>
        <div className="mt-1"><StatusBadge status={job.status} /></div>
      </div>
      <div className="text-sm font-medium text-muted-foreground">{money(job.price_cents)}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    scheduled: "bg-blue-100 text-blue-800",
    completed: "bg-emerald-100 text-emerald-800",
    sent: "bg-blue-100 text-blue-800",
    paid: "bg-emerald-100 text-emerald-800",
    pending: "bg-amber-100 text-amber-800",
  };
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${map[status] ?? "bg-slate-100 text-slate-700"}`}>{status.replace("_", " ")}</span>;
}

function RequestDemo({ recent }: { recent: typeof demo.requests }) {
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <div className="space-y-6">
      <form onSubmit={(e) => e.preventDefault()} className="rounded-lg bg-card ring-1 ring-black/5 p-5 space-y-4">
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
        <Button type="submit">Submit request</Button>
      </form>
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
              <div className="mt-1 whitespace-pre-wrap">{r.notes}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
