import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type GpsFix = {
  latitude: number;
  longitude: number;
  accuracy_meters?: number | null;
};

export type MyJobRow = {
  id: string;
  status: "scheduled" | "in_progress" | "completed" | "canceled";
  scheduled_start: string;
  scheduled_end: string;
  notes: string | null;
  client: { id: string; first_name: string | null; last_name: string | null; service_address: string | null } | null;
  service: { id: string; name: string; color: string | null } | null;
  open_entry: { id: string; started_at: string; has_gps: boolean } | null;
};

export type TimeEntryRow = {
  id: string;
  job_id: string;
  started_at: string;
  ended_at: string | null;
  notes: string | null;
  clock_in_latitude: number | null;
  clock_in_longitude: number | null;
  clock_in_accuracy_meters: number | null;
  clock_out_latitude: number | null;
  clock_out_longitude: number | null;
  clock_out_accuracy_meters: number | null;
  consent_given_at: string | null;
  job: { id: string; client: { first_name: string | null; last_name: string | null } | null } | null;
};

export type TenantGpsSettings = {
  track_gps: boolean;
  gps_retention_days: number;
};

const gpsSchema = z
  .object({
    latitude: z.number(),
    longitude: z.number(),
    accuracy_meters: z.number().nullable().optional(),
  })
  .optional()
  .nullable();

function getClientIp(): string | null {
  try {
    const req = getRequest();
    if (!req) return null;
    const fwd = req.headers.get("x-forwarded-for");
    if (fwd) return fwd.split(",")[0]!.trim();
    return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? null;
  } catch {
    return null;
  }
}

export const listMyJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { from?: string; to?: string }) => input)
  .handler(async ({ data, context }): Promise<MyJobRow[]> => {
    const uid = context.userId;
    const { data: links, error: le } = await context.supabase
      .from("job_employees")
      .select("job_id")
      .eq("employee_id", uid);
    if (le) throw new Error(le.message);
    const jobIds = (links ?? []).map((l: any) => l.job_id);
    if (!jobIds.length) return [];

    let q = context.supabase
      .from("jobs")
      .select("id, status, scheduled_start, scheduled_end, notes, client:clients(id,first_name,last_name,service_address), service:service_types(id,name,color)")
      .in("id", jobIds)
      .order("scheduled_start", { ascending: true });
    if (data.from) q = q.gte("scheduled_start", data.from);
    if (data.to) q = q.lt("scheduled_start", data.to);
    const { data: jobs, error } = await q;
    if (error) throw new Error(error.message);

    const { data: entries } = await context.supabase
      .from("time_entries")
      .select("id, job_id, started_at, clock_in_latitude")
      .eq("user_id", uid)
      .is("ended_at", null)
      .in("job_id", jobIds);
    const openMap = new Map<string, { id: string; started_at: string; has_gps: boolean }>();
    for (const e of entries ?? []) {
      openMap.set((e as any).job_id, {
        id: (e as any).id,
        started_at: (e as any).started_at,
        has_gps: (e as any).clock_in_latitude !== null,
      });
    }

    return (jobs ?? []).map((j: any) => ({ ...j, open_entry: openMap.get(j.id) ?? null })) as MyJobRow[];
  });

export const getTenantGpsSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TenantGpsSettings> => {
    const { data: prof } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (!prof) throw new Error("Profile not found");
    const { data: t, error } = await context.supabase
      .from("tenants")
      .select("track_gps, gps_retention_days")
      .eq("id", (prof as any).tenant_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      track_gps: !!(t as any)?.track_gps,
      gps_retention_days: (t as any)?.gps_retention_days ?? 90,
    };
  });

export const updateTenantGpsSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        track_gps: z.boolean(),
        gps_retention_days: z.number().int().min(1).max(3650),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (!prof) throw new Error("Profile not found");
    const { error } = await context.supabase
      .from("tenants")
      .update({ track_gps: data.track_gps, gps_retention_days: data.gps_retention_days })
      .eq("id", (prof as any).tenant_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const logGpsConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        consent_method: z.enum(["explicit_opt_in", "denied", "device_permission_denied"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (!prof) throw new Error("Profile not found");
    const ip = getClientIp();
    const { error } = await context.supabase.from("gps_consent_log").insert({
      tenant_id: (prof as any).tenant_id,
      employee_id: context.userId,
      consent_method: data.consent_method,
      ip_address: ip,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const purgeExpiredGps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: prof } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (!prof) throw new Error("Profile not found");
    const { data, error } = await context.supabase.rpc("purge_expired_gps", { _tenant: (prof as any).tenant_id });
    if (error) throw new Error(error.message);
    return { purged: (data as number) ?? 0 };
  });

export const clockIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        job_id: z.string().uuid(),
        gps: gpsSchema,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (!prof) throw new Error("Profile not found");
    const gps = data.gps ?? null;
    const now = new Date().toISOString();
    const { data: entry, error } = await context.supabase
      .from("time_entries")
      .insert({
        job_id: data.job_id,
        user_id: context.userId,
        tenant_id: (prof as any).tenant_id,
        started_at: now,
        clock_in_latitude: gps?.latitude ?? null,
        clock_in_longitude: gps?.longitude ?? null,
        clock_in_accuracy_meters: gps?.accuracy_meters ?? null,
        consent_given_at: gps ? now : null,
      })
      .select("id, started_at, clock_in_latitude, clock_in_longitude, clock_in_accuracy_meters")
      .single();
    if (error) throw new Error(error.message);
    const { error: ue } = await context.supabase
      .from("jobs")
      .update({ status: "in_progress", actual_start: now })
      .eq("id", data.job_id)
      .in("status", ["scheduled", "in_progress"]);
    if (ue) throw new Error(ue.message);
    return entry;
  });

export const clockOut = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        entry_id: z.string().uuid(),
        notes: z.string().optional(),
        gps: gpsSchema,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const endedAt = new Date().toISOString();
    const gps = data.gps ?? null;
    const { data: entry, error } = await context.supabase
      .from("time_entries")
      .update({
        ended_at: endedAt,
        notes: data.notes ?? null,
        clock_out_latitude: gps?.latitude ?? null,
        clock_out_longitude: gps?.longitude ?? null,
        clock_out_accuracy_meters: gps?.accuracy_meters ?? null,
      })
      .eq("id", data.entry_id)
      .eq("user_id", context.userId)
      .select("id, started_at, ended_at, job_id, notes, clock_out_latitude, clock_out_longitude")
      .single();
    if (error) throw new Error(error.message);
    return entry;
  });

export const listMyTimeEntries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { from: string; to: string }) => input)
  .handler(async ({ data, context }): Promise<TimeEntryRow[]> => {
    const { data: rows, error } = await context.supabase
      .from("time_entries")
      .select("id, job_id, started_at, ended_at, notes, clock_in_latitude, clock_in_longitude, clock_in_accuracy_meters, clock_out_latitude, clock_out_longitude, clock_out_accuracy_meters, consent_given_at, job:jobs(id, client:clients(first_name,last_name))")
      .eq("user_id", context.userId)
      .gte("started_at", data.from)
      .lt("started_at", data.to)
      .order("started_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (rows ?? []) as any;
  });

export type JobGpsEntry = {
  id: string;
  employee_id: string;
  employee_name: string | null;
  started_at: string;
  ended_at: string | null;
  clock_in_latitude: number | null;
  clock_in_longitude: number | null;
  clock_in_accuracy_meters: number | null;
  clock_out_latitude: number | null;
  clock_out_longitude: number | null;
  clock_out_accuracy_meters: number | null;
};

export const listJobGps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { job_id: string }) => input)
  .handler(async ({ data, context }): Promise<JobGpsEntry[]> => {
    const { data: rows, error } = await context.supabase
      .from("time_entries")
      .select("id, user_id, started_at, ended_at, clock_in_latitude, clock_in_longitude, clock_in_accuracy_meters, clock_out_latitude, clock_out_longitude, clock_out_accuracy_meters, profile:profiles!time_entries_user_id_fkey(id, full_name)")
      .eq("job_id", data.job_id)
      .order("started_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      id: r.id,
      employee_id: r.user_id,
      employee_name: r.profile?.full_name ?? null,
      started_at: r.started_at,
      ended_at: r.ended_at,
      clock_in_latitude: r.clock_in_latitude,
      clock_in_longitude: r.clock_in_longitude,
      clock_in_accuracy_meters: r.clock_in_accuracy_meters,
      clock_out_latitude: r.clock_out_latitude,
      clock_out_longitude: r.clock_out_longitude,
      clock_out_accuracy_meters: r.clock_out_accuracy_meters,
    }));
  });
