import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PhotoType = "before" | "after" | "other";

export type JobPhotoRow = {
  id: string;
  job_id: string;
  storage_path: string;
  caption: string | null;
  photo_type: PhotoType;
  taken_at: string | null;
  uploaded_at: string;
  uploaded_by: string | null;
  url: string | null;
  uploader_name: string | null;
};

export const createJobPhotoUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      job_id: z.string().uuid(),
      file_name: z.string().trim().min(1).max(200),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase
      .from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    if (!prof) throw new Error("No profile");
    const safe = data.file_name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${prof.tenant_id}/${data.job_id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
    const { data: signed, error } = await context.supabase.storage
      .from("job-photos")
      .createSignedUploadUrl(path);
    if (error) throw new Error(error.message);
    return { path, token: signed.token, signedUrl: signed.signedUrl };
  });

export const registerJobPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      job_id: z.string().uuid(),
      storage_path: z.string().min(1),
      caption: z.string().trim().max(300).optional(),
      photo_type: z.enum(["before", "after", "other"]).default("other"),
      taken_at: z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase
      .from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    if (!prof) throw new Error("No profile");
    const { data: row, error } = await context.supabase
      .from("job_photos")
      .insert({
        tenant_id: prof.tenant_id,
        job_id: data.job_id,
        storage_path: data.storage_path,
        caption: data.caption || null,
        photo_type: data.photo_type,
        taken_at: data.taken_at ?? null,
        uploaded_by: context.userId,
      })
      .select("id").single();
    if (error) throw new Error(error.message);
    return row;
  });

export const completeJobWithPhotos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      job_id: z.string().uuid(),
      photos: z.array(z.object({
        storage_path: z.string().min(1),
        caption: z.string().trim().max(300).optional(),
        photo_type: z.enum(["before", "after", "other"]).default("other"),
      })).default([]),
      entry_id: z.string().uuid().optional(),
      notes: z.string().trim().max(2000).optional(),
      supplies_used: z.array(z.object({
        item_id: z.string().uuid(),
        quantity: z.coerce.number().positive(),
      })).default([]),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase
      .from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
    if (!prof) throw new Error("No profile");
    const endedAt = new Date().toISOString();

    if (data.photos.length) {
      const rows = data.photos.map((p) => ({
        tenant_id: prof.tenant_id,
        job_id: data.job_id,
        storage_path: p.storage_path,
        caption: p.caption || null,
        photo_type: p.photo_type,
        uploaded_by: context.userId,
      }));
      const { error: pe } = await context.supabase.from("job_photos").insert(rows);
      if (pe) throw new Error(pe.message);
    }

    if (data.entry_id) {
      const { error: te } = await context.supabase
        .from("time_entries")
        .update({ ended_at: endedAt, notes: data.notes ?? null })
        .eq("id", data.entry_id)
        .eq("user_id", context.userId);
      if (te) throw new Error(te.message);
    }

    if (data.supplies_used.length) {
      const rows = data.supplies_used.map((s) => ({
        tenant_id: prof.tenant_id,
        item_id: s.item_id,
        change_amount: -Math.abs(s.quantity),
        reason: "job_usage",
        job_id: data.job_id,
        created_by: context.userId,
      }));
      const { error: se } = await context.supabase.from("inventory_transactions").insert(rows);
      if (se) throw new Error(se.message);
    }

    const { error: je } = await context.supabase
      .from("jobs")
      .update({ status: "completed", actual_end: endedAt })
      .eq("id", data.job_id);
    if (je) throw new Error(je.message);

    return { ok: true };
  });


export const listJobPhotos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ job_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<JobPhotoRow[]> => {
    const { data: rows, error } = await context.supabase
      .from("job_photos")
      .select("id, job_id, storage_path, caption, photo_type, taken_at, uploaded_at, uploaded_by")
      .eq("job_id", data.job_id)
      .order("uploaded_at", { ascending: true });
    if (error) throw new Error(error.message);

    const uploaderIds = Array.from(new Set((rows ?? []).map((r) => r.uploaded_by).filter((v): v is string => !!v)));
    const nameMap = new Map<string, string | null>();
    if (uploaderIds.length) {
      const { data: profs } = await context.supabase.from("profiles").select("id, full_name").in("id", uploaderIds);
      (profs ?? []).forEach((p) => nameMap.set(p.id, p.full_name));
    }

    const signed = await Promise.all((rows ?? []).map(async (p) => {
      const { data: s } = await context.supabase.storage.from("job-photos").createSignedUrl(p.storage_path, 3600);
      return {
        ...p,
        photo_type: p.photo_type as PhotoType,
        url: s?.signedUrl ?? null,
        uploader_name: nameMap.get(p.uploaded_by ?? "") ?? null,
      } as JobPhotoRow;
    }));
    return signed;
  });

export const deleteJobPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: photo } = await context.supabase
      .from("job_photos").select("storage_path").eq("id", data.id).maybeSingle();
    if (photo?.storage_path) {
      await context.supabase.storage.from("job-photos").remove([photo.storage_path]);
    }
    const { error } = await context.supabase.from("job_photos").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const logPhotoShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ photo_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: photo, error: pe } = await context.supabase
      .from("job_photos").select("job_id, tenant_id").eq("id", data.photo_id).maybeSingle();
    if (pe) throw new Error(pe.message);
    if (!photo) throw new Error("Photo not found");
    const { error } = await context.supabase.from("photo_share_log").insert({
      tenant_id: photo.tenant_id,
      job_id: photo.job_id,
      photo_id: data.photo_id,
      shared_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
