import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type InvoicePhotoChoice = {
  id: string;
  job_id: string;
  photo_type: string;
  caption: string | null;
  job_date: string | null;
  property: string | null;
  url: string | null;
  attached: boolean;
};

const LINK_SECONDS = 60 * 60 * 24 * 30; // 30 days

// Photos from this client's jobs (newest first), flagged if already attached.
export const listInvoicePhotoChoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ invoice_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<InvoicePhotoChoice[]> => {
    const sb = context.supabase as any;
    const { data: inv, error } = await sb
      .from("invoices").select("client_id, job_id, photo_ids").eq("id", data.invoice_id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv) return [];
    const attached = new Set<string>(inv.photo_ids ?? []);
    const { data: jobs } = await sb
      .from("jobs")
      .select("id, scheduled_start, property:client_properties!jobs_property_id_fkey(label)")
      .eq("client_id", inv.client_id)
      .order("scheduled_start", { ascending: false })
      .limit(60);
    const jobMap = new Map<string, any>((jobs ?? []).map((j: any) => [j.id, j]));
    if (!jobMap.size) return [];
    const { data: photos } = await sb
      .from("job_photos")
      .select("id, job_id, photo_type, caption, storage_path, uploaded_at")
      .in("job_id", Array.from(jobMap.keys()))
      .order("uploaded_at", { ascending: false })
      .limit(300);
    const rows: any[] = [...(photos ?? [])];
    // Always include already-attached photos, even if they fall outside the
    // recent-jobs / photo caps above — otherwise Save would silently drop them.
    const missing = Array.from(attached).filter((id) => !rows.some((r) => r.id === id));
    if (missing.length) {
      const { data: extra } = await sb
        .from("job_photos")
        .select("id, job_id, photo_type, caption, storage_path, uploaded_at")
        .in("id", missing);
      rows.push(...(extra ?? []));
      const extraJobIds = Array.from(new Set((extra ?? []).map((p: any) => p.job_id).filter((id: string) => !jobMap.has(id))));
      if (extraJobIds.length) {
        const { data: extraJobs } = await sb
          .from("jobs")
          .select("id, scheduled_start, property:client_properties!jobs_property_id_fkey(label)")
          .in("id", extraJobIds);
        for (const j of extraJobs ?? []) jobMap.set(j.id, j);
      }
    }
    return Promise.all(
      (photos ?? []).map(async (p: any) => {
        const { data: s } = await sb.storage.from("job-photos").createSignedUrl(p.storage_path, 3600);
        const j = jobMap.get(p.job_id);
        return {
          id: p.id,
          job_id: p.job_id,
          photo_type: p.photo_type,
          caption: p.caption,
          job_date: j?.scheduled_start ?? null,
          property: j?.property?.label ?? null,
          url: s?.signedUrl ?? null,
          attached: attached.has(p.id),
        };
      }),
    );
  });

export const setInvoicePhotos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ invoice_id: z.string().uuid(), photo_ids: z.array(z.string().uuid()).max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any)
      .from("invoices").update({ photo_ids: data.photo_ids }).eq("id", data.invoice_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// A shareable link to one photo, valid for 30 days.
export const createPhotoLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ photo_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: p, error } = await context.supabase
      .from("job_photos").select("storage_path").eq("id", data.photo_id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!p) throw new Error("Photo not found");
    const { data: s, error: se } = await context.supabase.storage
      .from("job-photos").createSignedUrl(p.storage_path, LINK_SECONDS);
    if (se || !s) throw new Error(se?.message ?? "Could not create link");
    return { url: s.signedUrl };
  });
