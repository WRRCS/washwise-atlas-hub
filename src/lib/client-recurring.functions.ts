import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const RULES = ["weekly", "biweekly", "every3weeks", "every4weeks", "monthly", "monthly_dow"] as const;

export type ClientSeries = {
  group_id: string;
  rule: string | null;
  end: string | null;
  next_start: string | null;
  upcoming: number;
  property: string | null;
  service: string | null;
};

export const listClientSeries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<ClientSeries[]> => {
    const { data: rows, error } = await context.supabase
      .from("jobs")
      .select("recurrence_group_id, recurrence_rule, recurrence_end, scheduled_start, status, property:client_properties(label), service:service_types(name)")
      .eq("client_id", data.clientId)
      .not("recurrence_group_id", "is", null)
      .order("scheduled_start", { ascending: true })
      .limit(2000);
    if (error) throw new Error(error.message);
    const now = Date.now();
    const map = new Map<string, ClientSeries>();
    for (const r of (rows ?? []) as any[]) {
      const g = r.recurrence_group_id as string;
      let s = map.get(g);
      if (!s) {
        s = { group_id: g, rule: null, end: null, next_start: null, upcoming: 0, property: null, service: null };
        map.set(g, s);
      }
      s.rule = r.recurrence_rule ?? s.rule;
      s.end = r.recurrence_end;
      s.property = r.property?.label ?? s.property;
      s.service = r.service?.name ?? s.service;
      if (new Date(r.scheduled_start).getTime() >= now && r.status === "scheduled") {
        s.upcoming++;
        if (!s.next_start) s.next_start = r.scheduled_start;
      }
    }
    return [...map.values()].filter((s) => s.rule || s.upcoming);
  });

export const updateClientSeries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      groupId: z.string().uuid(),
      rule: z.enum(RULES).nullable(),
      end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: isMgr } = await sb.rpc("is_owner_or_manager" as any);
    if (!isMgr) throw new Error("Only owners and managers can change repeating appointments.");

    const nowISO = new Date().toISOString();
    const { data: future, error } = await sb
      .from("jobs")
      .select("id, tenant_id")
      .eq("recurrence_group_id", data.groupId)
      .eq("status", "scheduled")
      .gte("scheduled_start", nowISO)
      .order("scheduled_start", { ascending: true });
    if (error) throw new Error(error.message);
    const list = future ?? [];

    // Keep the next upcoming visit as the new starting point; remove the rest
    // so they can be rebuilt with the new pattern.
    const toDelete = list.slice(1).map((j) => j.id);
    if (toDelete.length) {
      const { error: delErr } = await sb.from("jobs").delete().in("id", toDelete);
      if (delErr) throw new Error(delErr.message);
    }

    const { error: upErr } = await sb
      .from("jobs")
      .update({ recurrence_rule: data.rule, recurrence_end: data.rule ? data.end : null, is_recurring: !!data.rule })
      .eq("recurrence_group_id", data.groupId);
    if (upErr) throw new Error(upErr.message);

    let created = 0;
    if (data.rule) {
      const tenantId = list[0]?.tenant_id;
      const { extendRecurringSeries } = await import("@/lib/recurrence.server");
      const r = await extendRecurringSeries(sb, { tenantId });
      created = r.created;
    }
    return { removed: toDelete.length, created };
  });
