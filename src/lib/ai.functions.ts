import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const MODEL = "google/gemini-2.5-flash";
// Rough $ per 1M tokens for gemini-2.5-flash (input ~$0.075, output ~$0.30). Cents per token.
const COST_IN_CENTS_PER_TOKEN = 0.075 / 10000;
const COST_OUT_CENTS_PER_TOKEN = 0.30 / 10000;

export type ChatMessage = { role: "user" | "assistant"; content: string; timestamp: string };

const sendSchema = z.object({
  message: z.string().min(1).max(4000),
  conversation_id: z.string().uuid().optional(),
});

async function buildContext(supabase: any, tenantId: string): Promise<string> {
  const [
    { data: tenant },
    { data: jobs },
    { data: invoices },
    { data: clients },
    { data: notes },
    { data: sops },
    { data: inventory },
    { data: activity },
  ] = await Promise.all([
    supabase.from("tenants").select("name, ai_assistant_enabled").eq("id", tenantId).maybeSingle(),
    supabase.from("jobs").select("id, scheduled_start, status, notes, price_cents, client_id, clients(first_name,last_name)").eq("tenant_id", tenantId).order("scheduled_start", { ascending: false }).limit(30),
    supabase.from("invoices").select("number, status, total_cents, issue_date, due_date, paid_at, clients(first_name,last_name)").eq("tenant_id", tenantId).order("issue_date", { ascending: false }).limit(20),
    // No client CPNI (email/phone) is sent to the model.
    supabase.from("clients").select("id, first_name, last_name, created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(50),
    supabase.from("client_notes").select("content, created_at, client_id, clients(first_name,last_name)").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(20),
    supabase.from("sops").select("id, title, description").eq("tenant_id", tenantId).limit(20),
    supabase.from("inventory_items").select("name, quantity_on_hand, low_stock_threshold, unit").eq("tenant_id", tenantId),
    supabase.from("activity_log").select("action_type, description, created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(15),
  ]);

  const fmtClient = (c: any) => c ? `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Unknown" : "Unknown";
  const money = (c: number) => `$${((c ?? 0) / 100).toFixed(2)}`;

  const lowInv = (inventory ?? []).filter((i: any) => i.low_stock_threshold != null && Number(i.quantity_on_hand) <= Number(i.low_stock_threshold));

  const lines: string[] = [];
  lines.push(`## Business: ${tenant?.name ?? "Unknown"}`);
  lines.push(`Today: ${new Date().toISOString().slice(0, 10)}`);

  lines.push(`\n## Recent Jobs (last 30)`);
  (jobs ?? []).forEach((j: any) => {
    lines.push(`- ${j.scheduled_start?.slice(0,10)} | ${fmtClient(j.clients)} | ${j.status} | ${money(j.price_cents)}${j.notes ? ` | notes: ${String(j.notes).slice(0,100)}` : ""}`);
  });

  lines.push(`\n## Recent Invoices`);
  (invoices ?? []).forEach((i: any) => {
    lines.push(`- ${i.number} | ${fmtClient(i.clients)} | ${i.status} | ${money(i.total_cents)} | due ${i.due_date}${i.paid_at ? ` | paid ${i.paid_at.slice(0,10)}` : ""}`);
  });

  lines.push(`\n## Clients (${clients?.length ?? 0})`);
  (clients ?? []).slice(0, 30).forEach((c: any) => {
    lines.push(`- ${fmtClient(c)}${c.email ? ` <${c.email}>` : ""}`);
  });

  if (notes && notes.length) {
    lines.push(`\n## Recent Client Notes`);
    notes.forEach((n: any) => {
      lines.push(`- ${fmtClient(n.clients)}: ${String(n.content).slice(0, 160)}`);
    });
  }

  if (sops && sops.length) {
    lines.push(`\n## Active SOPs`);
    sops.forEach((s: any) => lines.push(`- ${s.title}${s.description ? ` — ${String(s.description).slice(0,80)}` : ""}`));
  }

  if (lowInv.length) {
    lines.push(`\n## Low Inventory`);
    lowInv.forEach((i: any) => lines.push(`- ${i.name}: ${i.quantity_on_hand} ${i.unit ?? ""} (threshold ${i.low_stock_threshold})`));
  }

  if (activity && activity.length) {
    lines.push(`\n## Recent Activity`);
    activity.forEach((a: any) => lines.push(`- ${a.created_at?.slice(0,10)} ${a.action_type}: ${a.description}`));
  }

  return lines.join("\n");
}

export const sendAiMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => sendSchema.parse(i))
  .handler(async ({ data, context }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI is not configured");

    // Resolve tenant + gate
    const { data: profile, error: profileErr } = await context.supabase
      .from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    if (profileErr) throw new Error(profileErr.message);
    const tenantId = profile?.tenant_id;
    if (!tenantId) throw new Error("No tenant");

    const { data: tenant } = await context.supabase
      .from("tenants").select("name, ai_assistant_enabled").eq("id", tenantId).maybeSingle();
    if (!tenant?.ai_assistant_enabled) throw new Error("WRRCS AI is disabled for this workspace");

    // Load or create conversation
    let convoId = data.conversation_id;
    let history: ChatMessage[] = [];
    if (convoId) {
      const { data: c, error } = await context.supabase
        .from("ai_conversations").select("id, messages").eq("id", convoId).eq("user_id", context.userId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!c) throw new Error("Conversation not found");
      history = (c.messages as ChatMessage[]) ?? [];
    }

    const context_str = await buildContext(context.supabase, tenantId);
    const systemPrompt = `You are WRRCS AI assistant for ${tenant?.name ?? "this cleaning business"}, a cleaning business.
You have access to recent jobs, invoices, clients, notes, SOPs and inventory data scoped strictly to this tenant.

Help the owner or employee with tasks like:
• Summarize client history ("Tell me about the Johnson account")
• Draft emails ("Draft thank-you note for last week's Airbnb host")
• Suggest quotes ("Suggest pricing for a new commercial client")
• Flag risks ("Which clients haven't booked this month?")
• Answer questions about their own business data

Be concise and actionable. Use bullet points when listing things.
Never invent data you don't have access to — if the answer isn't in the context below, say you don't have that data.
Do not reveal API keys, secrets, or internal identifiers. Do not answer questions about other businesses.

--- BUSINESS CONTEXT ---
${context_str}
--- END CONTEXT ---`;

    const userMsg: ChatMessage = { role: "user", content: data.message, timestamp: new Date().toISOString() };
    const messagesForAi = [
      { role: "system", content: systemPrompt },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: data.message },
    ];

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: MODEL, messages: messagesForAi }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      if (resp.status === 429) throw new Error("WRRCS AI is rate limited — please retry shortly.");
      if (resp.status === 402) throw new Error("AI credits exhausted — please add credits in workspace billing.");
      throw new Error(`AI error: ${text.slice(0, 200)}`);
    }
    const json = await resp.json();
    const reply = json?.choices?.[0]?.message?.content ?? "I couldn't generate a response.";
    const usage = json?.usage ?? {};
    const promptTokens = Number(usage.prompt_tokens ?? 0);
    const completionTokens = Number(usage.completion_tokens ?? 0);
    const totalTokens = Number(usage.total_tokens ?? promptTokens + completionTokens);
    const costCents = promptTokens * COST_IN_CENTS_PER_TOKEN + completionTokens * COST_OUT_CENTS_PER_TOKEN;

    const assistantMsg: ChatMessage = { role: "assistant", content: reply, timestamp: new Date().toISOString() };
    const nextHistory = [...history, userMsg, assistantMsg];

    // Save conversation
    if (!convoId) {
      const title = data.message.slice(0, 60);
      const { data: inserted, error } = await context.supabase
        .from("ai_conversations")
        .insert({ tenant_id: tenantId, user_id: context.userId, title, messages: nextHistory })
        .select("id").single();
      if (error) throw new Error(error.message);
      convoId = inserted.id;
    } else {
      const { error } = await context.supabase
        .from("ai_conversations").update({ messages: nextHistory }).eq("id", convoId);
      if (error) throw new Error(error.message);
    }

    // Log usage
    await context.supabase.from("ai_usage_log").insert({
      tenant_id: tenantId, user_id: context.userId, conversation_id: convoId, model: MODEL,
      prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: totalTokens,
      estimated_cost_cents: costCents,
    });

    return { reply, conversation_id: convoId, messages: nextHistory };
  });

export const listAiConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("ai_conversations")
      .select("id, title, updated_at")
      .eq("user_id", context.userId)
      .order("updated_at", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getAiConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: c, error } = await context.supabase
      .from("ai_conversations").select("id, title, messages").eq("id", data.id).eq("user_id", context.userId).maybeSingle();
    if (error) throw new Error(error.message);
    return c;
  });

export const deleteAiConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("ai_conversations").delete().eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getAiSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: profile } = await context.supabase.from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    if (!profile?.tenant_id) return { enabled: false, isOwner: false };
    const [{ data: tenant }, { data: isOwner }] = await Promise.all([
      context.supabase.from("tenants").select("ai_assistant_enabled").eq("id", profile.tenant_id).maybeSingle(),
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "owner" }),
    ]);
    return { enabled: !!tenant?.ai_assistant_enabled, isOwner: !!isOwner };
  });

export const setAiEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ enabled: z.boolean() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: isOwner } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "owner" });
    if (!isOwner) throw new Error("Only owners can change this setting");
    const { data: profile } = await context.supabase.from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    if (!profile?.tenant_id) throw new Error("No tenant");
    const { error } = await context.supabase.from("tenants").update({ ai_assistant_enabled: data.enabled }).eq("id", profile.tenant_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getAiUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("ai_usage_log")
      .select("created_at, total_tokens, estimated_cost_cents, user_id")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthRows = rows.filter((r: any) => r.created_at >= monthStart);
    const totalRequests = rows.length;
    const monthRequests = monthRows.length;
    const monthTokens = monthRows.reduce((s: number, r: any) => s + Number(r.total_tokens ?? 0), 0);
    const monthCostCents = monthRows.reduce((s: number, r: any) => s + Number(r.estimated_cost_cents ?? 0), 0);
    return { totalRequests, monthRequests, monthTokens, monthCostCents };
  });
