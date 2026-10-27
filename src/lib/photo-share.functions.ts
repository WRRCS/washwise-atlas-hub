import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// One shareable gallery link for a selected set of a job's photos.
// Links never expire on their own; an owner/manager revokes them manually.
export const createPhotoShareLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      job_id: z.string().uuid(),
      photo_ids: z.array(z.string().uuid()).min(1),
      origin: z.string().url(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { data: job } = await sb.from("jobs").select("id, tenant_id").eq("id", data.job_id).maybeSingle();
    if (!job) throw new Error("Job not found");
    const { data: reviewer, error: roleError } = await context.supabase.rpc('is_owner_or_manager');
    if (roleError || !reviewer) throw new Error('Only owners and managers can create photo links');
    const { data: eligible, error: photoError } = await context.supabase
      .from('job_photos')
      .select('id')
      .eq('tenant_id', job.tenant_id)
      .eq('job_id', job.id)
      .in('id', data.photo_ids);
    if (photoError) throw new Error(photoError.message);
    const eligibleIds = (eligible ?? []).map((p: { id: string }) => p.id);
    if (eligibleIds.length !== data.photo_ids.length)
      throw new Error('Some selected photos do not belong to this appointment');
    const { data: row, error } = await sb
      .from("photo_share_links")
      .insert({
        tenant_id: job.tenant_id,
        job_id: data.job_id,
        photo_type: null,
        photo_ids: eligibleIds,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message.includes("row-level") ? "Only owners and managers can create photo links" : error.message);
    return { id: row.id as string, url: `${data.origin.replace(/\/$/, "")}/photos/${row.id}` };
  });

export type PhotoShareLinkRow = {
  id: string;
  created_at: string;
  revoked_at: string | null;
  photo_count: number;
};

// Owner/manager: list existing gallery links for a job so they can be revoked.
export const listPhotoShareLinks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ job_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<PhotoShareLinkRow[]> => {
    const { data: reviewer } = await context.supabase.rpc('is_owner_or_manager');
    if (!reviewer) throw new Error('Only owners and managers can view photo links');
    const { data: rows, error } = await (context.supabase as any)
      .from("photo_share_links")
      .select("id, created_at, revoked_at, photo_ids")
      .eq("job_id", data.job_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      id: r.id,
      created_at: r.created_at,
      revoked_at: r.revoked_at,
      photo_count: Array.isArray(r.photo_ids) ? r.photo_ids.length : 0,
    }));
  });

// Owner/manager: revoke (or reactivate) a gallery link. Revocation is immediate.
export const setPhotoShareLinkRevoked = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), revoked: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: reviewer } = await context.supabase.rpc('is_owner_or_manager');
    if (!reviewer) throw new Error('Only owners and managers can change photo links');
    const { error } = await (context.supabase as any)
      .from("photo_share_links")
      .update({ revoked_at: data.revoked ? new Date().toISOString() : null })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type SharedPhotos = {
  title: string;
  business: string | null;
  photos: {
    id: string;
    url: string;
    caption: string | null;
    photo_type: string;
    uploader_name: string;
  }[];
};

// Public: anyone with the (unguessable) link can view these photos.
// The link row is re-loaded and re-checked on EVERY request, so a revoked
// link stops serving immediately. Signed image URLs are minted fresh per
// request and expire within an hour, so previously issued URLs cannot
// keep granting access after revocation.
export const getSharedPhotos = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }): Promise<SharedPhotos | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    const { data: link } = await sb.from("photo_share_links").select("*").eq("id", data.id).maybeSingle();
    if (!link || link.revoked_at) return null;
    if (new Date(link.expires_at) < new Date()) return null;
    const { data: photos } = await sb
      .from("job_photos")
      .select("id, storage_path, caption, photo_type, uploaded_by")
      .eq("tenant_id", link.tenant_id)
      .eq("job_id", link.job_id)
      .in("id", link.photo_ids ?? [])
      .order("uploaded_at", { ascending: true });
    if (!photos?.length) return null;
    const uploaderIds = [...new Set(photos.map((p: any) => p.uploaded_by).filter(Boolean))];
    const [{ data: job }, { data: tenant }, { data: uploaders }] = await Promise.all([
      sb.from("jobs").select("scheduled_start, service_location_label, client:clients(first_name,last_name)").eq("tenant_id", link.tenant_id).eq("id", link.job_id).maybeSingle(),
      sb.from("tenants").select("name").eq("id", link.tenant_id).maybeSingle(),
      uploaderIds.length
        ? sb.from("profiles").select("id, full_name").in("id", uploaderIds)
        : Promise.resolve({ data: [] }),
    ]);
    const nameById = new Map((uploaders ?? []).map((u: any) => [u.id, u.full_name ?? "Team member"]));
    const signed = await Promise.all(
      photos.map(async (p: any) => {
        const { data: s } = await sb.storage.from("job-photos").createSignedUrl(p.storage_path, 3600);
        return s?.signedUrl
          ? {
              id: p.id as string,
              url: s.signedUrl as string,
              caption: p.caption as string | null,
              photo_type: p.photo_type as string,
              uploader_name: (nameById.get(p.uploaded_by) as string) ?? "Team member",
            }
          : null;
      }),
    );
    const date = job?.scheduled_start
      ? new Date(job.scheduled_start).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" })
      : "";
    return {
      title: ["Job photos", job?.service_location_label, date].filter(Boolean).join(" · "),
      business: tenant?.name ?? null,
      photos: signed.filter(Boolean) as SharedPhotos["photos"],
    };
  });
