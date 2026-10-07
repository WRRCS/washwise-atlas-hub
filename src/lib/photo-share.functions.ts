import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// One shareable page link for a job's photos (a whole group, or a single photo). Valid 30 days.
export const createPhotoShareLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      job_id: z.string().uuid(),
      photo_type: z.enum(["before", "after", "damage", "other"]).nullable().optional(),
      photo_id: z.string().uuid().optional(),
      origin: z.string().url(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { data: job } = await sb.from("jobs").select("id, tenant_id").eq("id", data.job_id).maybeSingle();
    if (!job) throw new Error("Job not found");
    const { data: row, error } = await sb
      .from("photo_share_links")
      .insert({
        tenant_id: job.tenant_id,
        job_id: data.job_id,
        photo_type: data.photo_type ?? null,
        photo_ids: data.photo_id ? [data.photo_id] : null,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message.includes("row-level") ? "Only owners and managers can create photo links" : error.message);
    return { url: `${data.origin.replace(/\/$/, "")}/photos/${row.id}` };
  });

export type SharedPhotos = {
  title: string;
  business: string | null;
  expires_at: string;
  photos: { id: string; url: string; caption: string | null; photo_type: string }[];
};

// Public: anyone with the (unguessable) link can view these photos until it expires.
export const getSharedPhotos = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }): Promise<SharedPhotos | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    const { data: link } = await sb.from("photo_share_links").select("*").eq("id", data.id).maybeSingle();
    if (!link || new Date(link.expires_at) < new Date()) return null;
    let q = sb.from("job_photos").select("id, storage_path, caption, photo_type").eq("job_id", link.job_id);
    if (link.photo_ids?.length) q = q.in("id", link.photo_ids);
    else if (link.photo_type) q = q.eq("photo_type", link.photo_type);
    const [{ data: photos }, { data: job }, { data: tenant }] = await Promise.all([
      q.order("uploaded_at", { ascending: true }),
      sb.from("jobs").select("scheduled_start, client:clients(name)").eq("id", link.job_id).maybeSingle(),
      sb.from("tenants").select("name").eq("id", link.tenant_id).maybeSingle(),
    ]);
    const signed = await Promise.all(
      (photos ?? []).map(async (p: any) => {
        const { data: s } = await sb.storage.from("job-photos").createSignedUrl(p.storage_path, 3600);
        return s?.signedUrl ? { id: p.id, url: s.signedUrl, caption: p.caption, photo_type: p.photo_type } : null;
      }),
    );
    const label = link.photo_ids?.length ? "Photo" : link.photo_type ? `${link.photo_type[0].toUpperCase()}${link.photo_type.slice(1)} photos` : "Job photos";
    const date = job?.scheduled_start
      ? new Date(job.scheduled_start).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" })
      : "";
    return {
      title: [label, job?.client?.name, date].filter(Boolean).join(" · "),
      business: tenant?.name ?? null,
      expires_at: link.expires_at,
      photos: signed.filter(Boolean) as SharedPhotos["photos"],
    };
  });
