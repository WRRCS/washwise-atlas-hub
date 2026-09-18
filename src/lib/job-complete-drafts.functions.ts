import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type JobCompleteDraft = {
  id: string;
  client_id: string;
  job_id: string | null;
  subject: string;
  body: string;
  photo_ids: string[];
  status: "draft" | "sent" | "discarded";
  created_at: string;
  sent_at: string | null;
  client_name: string | null;
  photo_urls: string[];
};

/** Drafts waiting for an owner/manager to review and send. */
export const listJobCompleteDrafts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<JobCompleteDraft[]> => {
    const { data, error } = await context.supabase
      .from("client_message_drafts")
      .select("id, client_id, job_id, subject, body, photo_ids, status, created_at, sent_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<Omit<JobCompleteDraft, "client_name" | "photo_urls">>;
    if (!rows.length) return [];

    const clientIds = [...new Set(rows.map((r) => r.client_id))];
    const { data: clients } = await context.supabase
      .from("clients")
      .select("id, first_name, last_name, company_name")
      .in("id", clientIds);
    const names = new Map<string, string>();
    for (const c of clients ?? []) {
      const n = (c as any).company_name || [(c as any).first_name, (c as any).last_name].filter(Boolean).join(" ");
      names.set(c.id as string, n);
    }

    const photoIds = [...new Set(rows.flatMap((r) => r.photo_ids ?? []))];
    const paths = new Map<string, string>();
    if (photoIds.length) {
      const { data: photos } = await context.supabase
        .from("job_photos")
        .select("id, storage_path")
        .in("id", photoIds);
      for (const p of photos ?? []) paths.set(p.id as string, p.storage_path as string);
    }

    return Promise.all(
      rows.map(async (r) => ({
        ...r,
        client_name: names.get(r.client_id) ?? null,
        photo_urls: (
          await Promise.all(
            (r.photo_ids ?? []).map(async (pid) => {
              const path = paths.get(pid);
              if (!path) return null;
              const { data: s } = await context.supabase.storage.from("job-photos").createSignedUrl(path, 3600);
              return s?.signedUrl ?? null;
            }),
          )
        ).filter((u): u is string => !!u),
      })),
    );
  });

export const updateJobCompleteDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id: z.string().uuid(),
      subject: z.string().trim().min(1).max(200).optional(),
      body: z.string().trim().max(4000).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.subject !== undefined) patch.subject = data.subject;
    if (data.body !== undefined) patch.body = data.body;
    const { error } = await context.supabase
      .from("client_message_drafts")
      .update(patch as never)
      .eq("id", data.id)
      .eq("status", "draft");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Nothing reaches the client until someone presses send here. */
export const sendJobCompleteDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: draft, error } = await context.supabase
      .from("client_message_drafts")
      .select("id, tenant_id, client_id, subject, body, status")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!draft || (draft as any).status !== "draft") throw new Error("That message has already been handled.");

    const { error: me } = await context.supabase.from("client_messages").insert({
      tenant_id: (draft as any).tenant_id,
      client_id: (draft as any).client_id,
      sender_type: "business",
      sender_user_id: context.userId,
      body: `${(draft as any).subject}\n\n${(draft as any).body}`,
    } as never);
    if (me) throw new Error(me.message);

    const { error: ue } = await context.supabase
      .from("client_message_drafts")
      .update({ status: "sent", sent_at: new Date().toISOString(), sent_by: context.userId } as never)
      .eq("id", data.id);
    if (ue) throw new Error(ue.message);
    return { ok: true };
  });

export const discardJobCompleteDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("client_message_drafts")
      .update({ status: "discarded" } as never)
      .eq("id", data.id)
      .eq("status", "draft");
    if (error) throw new Error(error.message);
    return { ok: true };
  });
