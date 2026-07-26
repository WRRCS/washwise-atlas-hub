import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ClientRequestRow = {
  id: string;
  client_id: string;
  client_name: string;
  job_id: string | null;
  job_scheduled_start: string | null;
  body: string;
  status: "pending" | "approved" | "dismissed";
  created_at: string;
};

async function getTenant(context: any): Promise<string> {
  const { data: prof } = await context.supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", context.userId)
    .maybeSingle();
  if (!prof) throw new Error("No profile");
  return prof.tenant_id as string;
}

export const listClientRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ClientRequestRow[]> => {
    const tenantId = await getTenant(context);
    const { data, error } = await (context.supabase as any)
      .from("client_requests")
      .select(
        "id, client_id, job_id, body, status, created_at, client:clients(first_name, last_name), job:jobs(scheduled_start)",
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      id: r.id,
      client_id: r.client_id,
      client_name:
        [r.client?.first_name, r.client?.last_name].filter(Boolean).join(" ") || "Client",
      job_id: r.job_id,
      job_scheduled_start: r.job?.scheduled_start ?? null,
      body: r.body,
      status: r.status,
      created_at: r.created_at,
    }));
  });

export const getPendingClientRequestCount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<number> => {
    const tenantId = await getTenant(context);
    const { count, error } = await (context.supabase as any)
      .from("client_requests")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    return count ?? 0;
  });

export const approveClientRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const tenantId = await getTenant(context);
    const { data: req, error: fe } = await (context.supabase as any)
      .from("client_requests")
      .select("id, job_id, body, status")
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (fe) throw new Error(fe.message);
    if (!req) throw new Error("Request not found");
    if (req.status !== "pending") throw new Error("This request was already reviewed.");

    if (req.job_id) {
      const { data: job } = await context.supabase
        .from("jobs")
        .select("notes")
        .eq("id", req.job_id)
        .maybeSingle();
      const existing = job?.notes ? `${job.notes}\n\n` : "";
      const { error: ue } = await context.supabase
        .from("jobs")
        .update({ notes: `${existing}Client request: ${req.body}` } as never)
        .eq("id", req.job_id);
      if (ue) throw new Error(ue.message);
    }

    const { error } = await (context.supabase as any)
      .from("client_requests")
      .update({
        status: "approved",
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
      } as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, added_to_job: !!req.job_id };
  });

export const dismissClientRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const tenantId = await getTenant(context);
    const { error } = await (context.supabase as any)
      .from("client_requests")
      .update({
        status: "dismissed",
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
      } as never)
      .eq("id", data.id)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
