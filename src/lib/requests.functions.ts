import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { formatDateRange, needsEnglishTranslation } from "@/lib/owner-inbox-alerts";

async function isOwner(supabase: any) {
  const { data } = await supabase.rpc("is_owner");
  return !!data;
}

// ---------- Time off ----------

export type TimeOffRow = {
  id: string;
  employee_id: string;
  employee_name: string | null;
  start_date: string;
  end_date: string;
  reason: string;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  owner_question: string | null;
  questioned_at: string | null;
  employee_reply: string | null;
  replied_at: string | null;
  reason_en: string | null;
  employee_reply_en: string | null;
};

const TIME_OFF_COLS = "id, employee_id, start_date, end_date, reason, status, created_at, reviewed_at, owner_question, questioned_at, employee_reply, replied_at, reason_en, employee_reply_en";

async function myProfile(supabase: any, userId: string) {
  const { data } = await supabase.from("profiles").select("tenant_id, full_name").eq("id", userId).maybeSingle();
  if (!data?.tenant_id) throw new Error("Could not resolve tenant");
  return { tenant_id: data.tenant_id as string, name: (data.full_name as string | null)?.trim() || "Employee" };
}

export const listMyTimeOff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("time_off_requests")
      .select(TIME_OFF_COLS)
      .eq("employee_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({ ...r, employee_name: null })) as TimeOffRow[];
  });

export const createTimeOff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        start_date: z.string().min(1),
        end_date: z.string().min(1),
        reason: z.string().trim().min(1).max(1000),
      })
      .refine((v) => v.end_date >= v.start_date, {
        message: "End date must be on or after start date",
        path: ["end_date"],
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const me = await myProfile(context.supabase, context.userId);
    const { data: row, error } = await context.supabase.from("time_off_requests").insert({
      tenant_id: me.tenant_id,
      employee_id: context.userId,
      start_date: data.start_date,
      end_date: data.end_date,
      reason: data.reason,
    }).select("id, created_at").single();
    if (error) throw new Error(error.message);
    const { notifyOwnerInbox } = await import("@/lib/owner-inbox-alerts.server");
    const { translation } = await notifyOwnerInbox({
      tenantId: me.tenant_id, actorId: context.userId, entityType: "time_off_request", entityId: row.id,
      eventKey: `time_off:${row.id}`, kind: "time_off", from: me.name, receivedAt: row.created_at,
      details: [["Time off requested", formatDateRange(data.start_date, data.end_date)]],
      message: data.reason, messageLabel: "Reason",
      link: "https://wrrcs.com/requests", linkLabel: "Approve, decline or ask a question",
    });
    if (translation) await saveTranslation(row.id, { reason_en: translation });
    return { ok: true };
  });

export const listPendingTimeOff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!(await isOwner(context.supabase))) throw new Error("Forbidden");
    const { data, error } = await context.supabase
      .from("time_off_requests")
      .select(TIME_OFF_COLS)
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const ids = [...new Set((data ?? []).map((r) => r.employee_id))];
    const nameMap = new Map<string, string | null>();
    if (ids.length) {
      const { data: profs } = await context.supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", ids);
      (profs ?? []).forEach((p) => nameMap.set(p.id, p.full_name));
    }
    // Requests saved before translation existed (or whose translation failed) get translated now.
    const rows = await Promise.all((data ?? []).map(async (r) => {
      const patch: { reason_en?: string; employee_reply_en?: string } = {};
      if (!r.reason_en && needsEnglishTranslation(r.reason)) {
        const { translateToEnglish } = await import("@/lib/owner-inbox-alerts.server");
        const en = await translateToEnglish(r.reason);
        if (en) patch.reason_en = en;
      }
      if (r.employee_reply && !r.employee_reply_en && needsEnglishTranslation(r.employee_reply)) {
        const { translateToEnglish } = await import("@/lib/owner-inbox-alerts.server");
        const en = await translateToEnglish(r.employee_reply);
        if (en) patch.employee_reply_en = en;
      }
      if (Object.keys(patch).length) await saveTranslation(r.id, patch);
      return { ...r, ...patch };
    }));
    return rows.map((r) => ({
      ...r,
      employee_name: nameMap.get(r.employee_id) ?? null,
    })) as TimeOffRow[];
  });

export const decideTimeOff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id: z.string().uuid(),
      decision: z.enum(["approved", "denied"]),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!(await isOwner(context.supabase))) throw new Error("Forbidden");
    const { error } = await context.supabase
      .from("time_off_requests")
      .update({
        status: data.decision,
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    const { syncApprovedTimeOff } = await import("@/lib/time-off-schedule.functions");
    await syncApprovedTimeOff(context.supabase, context.userId, data.id, data.decision);
    return { ok: true };
  });

async function saveTranslation(id: string, patch: { reason_en?: string; employee_reply_en?: string }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("time_off_requests").update(patch).eq("id", id);
  if (error) console.error("Saving translation failed", error.message);
}

export const askTimeOffQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), question: z.string().trim().min(1).max(2000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!(await isOwner(context.supabase))) throw new Error("Forbidden");
    const { data: rows, error } = await context.supabase
      .from("time_off_requests")
      .update({ owner_question: data.question, questioned_at: new Date().toISOString(), questioned_by: context.userId, employee_reply: null, replied_at: null, employee_reply_en: null })
      .eq("id", data.id)
      .eq("status", "pending")
      .select("id");
    if (error) throw new Error(error.message);
    if (!rows?.length) throw new Error("This request was already decided");
    return { ok: true };
  });

export const replyTimeOffQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), reply: z.string().trim().min(1).max(2000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const me = await myProfile(context.supabase, context.userId);
    const { data: repliedAt, error } = await context.supabase.rpc("reply_time_off_question", { _id: data.id, _reply: data.reply });
    if (error) throw new Error(error.message);
    const { data: req } = await context.supabase.from("time_off_requests").select("start_date, end_date, owner_question").eq("id", data.id).maybeSingle();
    const { notifyOwnerInbox } = await import("@/lib/owner-inbox-alerts.server");
    const { translation } = await notifyOwnerInbox({
      tenantId: me.tenant_id, actorId: context.userId, entityType: "time_off_request", entityId: data.id,
      eventKey: `time_off_reply:${data.id}:${repliedAt}`, kind: "time_off_reply", from: me.name, receivedAt: String(repliedAt),
      details: [
        ...(req ? [["Time off requested", formatDateRange(req.start_date, req.end_date)] as [string, string]] : []),
        ...(req?.owner_question ? [["Your question", req.owner_question] as [string, string]] : []),
      ],
      message: data.reply, messageLabel: "Answer",
      link: "https://wrrcs.com/requests", linkLabel: "Approve, decline or ask another question",
    });
    if (translation) await saveTranslation(data.id, { employee_reply_en: translation });
    return { ok: true };
  });

// ---------- Shift swap ----------

export type ShiftSwapRow = {
  id: string;
  job_id: string;
  job_label: string | null;
  requesting_employee_id: string;
  requesting_employee_name: string | null;
  proposed_covering_employee_id: string | null;
  proposed_covering_employee_name: string | null;
  reason: string | null;
  status: string;
  created_at: string;
  reviewed_at: string | null;
};

export type MyUpcomingJob = {
  id: string;
  scheduled_start: string;
  client_name: string | null;
};

export const listMyUpcomingAssignedJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: assigns, error } = await context.supabase
      .from("job_employees")
      .select("job_id")
      .eq("employee_id", context.userId);
    if (error) throw new Error(error.message);
    const ids = (assigns ?? []).map((a) => a.job_id);
    if (!ids.length) return [] as MyUpcomingJob[];
    const { data: jobs } = await context.supabase
      .from("jobs")
      .select("id, scheduled_start, client_id, status")
      .in("id", ids)
      .gte("scheduled_start", new Date().toISOString())
      .in("status", ["scheduled", "in_progress"])
      .order("scheduled_start");
    const clientIds = [...new Set((jobs ?? []).map((j) => j.client_id).filter(Boolean))];
    const nameMap = new Map<string, string | null>();
    if (clientIds.length) {
      const { data: cs } = await context.supabase
        .from("clients")
        .select("id, first_name, last_name")
        .in("id", clientIds);
      (cs ?? []).forEach((c) => {
        const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || null;
        nameMap.set(c.id, name);
      });
    }
    return (jobs ?? []).map<MyUpcomingJob>((j) => ({
      id: j.id,
      scheduled_start: j.scheduled_start,
      client_name: j.client_id ? nameMap.get(j.client_id) ?? null : null,
    }));
  });

async function enrichSwaps(supabase: any, rows: any[]): Promise<ShiftSwapRow[]> {
  const empIds = new Set<string>();
  const jobIds = new Set<string>();
  for (const r of rows) {
    if (r.requesting_employee_id) empIds.add(r.requesting_employee_id);
    if (r.proposed_covering_employee_id) empIds.add(r.proposed_covering_employee_id);
    if (r.job_id) jobIds.add(r.job_id);
  }
  const empMap = new Map<string, string | null>();
  if (empIds.size) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", [...empIds]);
    (profs ?? []).forEach((p: any) => empMap.set(p.id, p.full_name));
  }
  const jobMap = new Map<string, string>();
  if (jobIds.size) {
    const { data: jobs } = await supabase
      .from("jobs")
      .select("id, scheduled_start, client_id")
      .in("id", [...jobIds]);
    const cIds = [...new Set((jobs ?? []).map((j: any) => j.client_id).filter(Boolean))];
    const cMap = new Map<string, string>();
    if (cIds.length) {
      const { data: cs } = await supabase
        .from("clients")
        .select("id, first_name, last_name")
        .in("id", cIds);
      (cs ?? []).forEach((c: any) => {
        const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || "Client";
        cMap.set(c.id, name);
      });
    }
    (jobs ?? []).forEach((j: any) => {
      const d = new Date(j.scheduled_start);
      const label = `${cMap.get(j.client_id) ?? "Client"} — ${d.toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" })}`;
      jobMap.set(j.id, label);
    });
  }
  return rows.map<ShiftSwapRow>((r) => ({
    id: r.id,
    job_id: r.job_id,
    job_label: jobMap.get(r.job_id) ?? null,
    requesting_employee_id: r.requesting_employee_id,
    requesting_employee_name: empMap.get(r.requesting_employee_id) ?? null,
    proposed_covering_employee_id: r.proposed_covering_employee_id,
    proposed_covering_employee_name: r.proposed_covering_employee_id
      ? empMap.get(r.proposed_covering_employee_id) ?? null
      : null,
    reason: r.reason,
    status: r.status,
    created_at: r.created_at,
    reviewed_at: r.reviewed_at,
  }));
}

export const listMyShiftSwaps = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("shift_swap_requests")
      .select("id, job_id, requesting_employee_id, proposed_covering_employee_id, reason, status, created_at, reviewed_at")
      .eq("requesting_employee_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return enrichSwaps(context.supabase, data ?? []);
  });

export const createShiftSwap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      job_id: z.string().uuid(),
      proposed_covering_employee_id: z.string().uuid().nullable().optional(),
      reason: z.string().trim().max(1000).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const me = await myProfile(context.supabase, context.userId);
    const tenant_id = me.tenant_id;
    // Verify caller is assigned to this job
    const { data: assign } = await context.supabase
      .from("job_employees")
      .select("job_id")
      .eq("job_id", data.job_id)
      .eq("employee_id", context.userId)
      .maybeSingle();
    if (!assign) throw new Error("You are not assigned to that job");
    const { data: row, error } = await context.supabase.from("shift_swap_requests").insert({
      tenant_id,
      job_id: data.job_id,
      requesting_employee_id: context.userId,
      proposed_covering_employee_id: data.proposed_covering_employee_id ?? null,
      reason: data.reason ?? null,
    }).select("id, created_at").single();
    if (error) throw new Error(error.message);
    const [swap] = await enrichSwaps(context.supabase, [{ ...row, job_id: data.job_id, requesting_employee_id: context.userId, proposed_covering_employee_id: data.proposed_covering_employee_id ?? null, reason: data.reason ?? null, status: "pending", reviewed_at: null }]);
    const { notifyOwnerInbox } = await import("@/lib/owner-inbox-alerts.server");
    await notifyOwnerInbox({
      tenantId: tenant_id, actorId: context.userId, entityType: "shift_swap_request", entityId: row.id,
      eventKey: `shift_swap:${row.id}`, kind: "shift_swap", from: me.name, receivedAt: row.created_at,
      details: [["Cleaning to cover", swap?.job_label ?? "Cleaning"], ["Suggested teammate", swap?.proposed_covering_employee_name ?? "Anyone"]],
      message: data.reason?.trim() || "(No reason given)", messageLabel: "Reason",
      link: "https://wrrcs.com/requests", linkLabel: "Approve or decline",
    });
    return { ok: true };
  });

export const listPendingShiftSwaps = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!(await isOwner(context.supabase))) throw new Error("Forbidden");
    const { data, error } = await context.supabase
      .from("shift_swap_requests")
      .select("id, job_id, requesting_employee_id, proposed_covering_employee_id, reason, status, created_at, reviewed_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return enrichSwaps(context.supabase, data ?? []);
  });

export const decideShiftSwap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id: z.string().uuid(),
      decision: z.enum(["approved", "denied"]),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!(await isOwner(context.supabase))) throw new Error("Forbidden");
    const { error } = await context.supabase
      .from("shift_swap_requests")
      .update({
        status: data.decision,
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
