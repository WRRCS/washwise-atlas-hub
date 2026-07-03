import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SopListRow = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  updated_at: string;
  service: { id: string; name: string; color: string | null } | null;
  step_count: number;
  attachment_count: number;
};

export type SopStep = {
  id: string;
  step_number: number;
  title: string;
  description: string | null;
  reference_photo_path: string | null;
  reference_photo_url: string | null;
};

export type SopAttachment = {
  id: string;
  storage_path: string;
  original_filename: string;
  caption: string | null;
  uploaded_at: string;
  url: string | null;
};

export type SopDetail = {
  id: string;
  service_type_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  updated_at: string;
  service: { id: string; name: string; color: string | null } | null;
  steps: SopStep[];
  attachments: SopAttachment[];
};

async function tenantId(context: any) {
  const { data: prof } = await context.supabase
    .from("profiles").select("tenant_id").eq("id", context.userId).maybeSingle();
  if (!prof) throw new Error("No profile");
  return prof.tenant_id as string;
}

async function signSopPath(context: any, path: string | null | undefined) {
  if (!path) return null;
  const { data } = await context.supabase.storage.from("sop-photos").createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

// ---------- List ----------

export const listSops = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SopListRow[]> => {
    const { data: rows, error } = await context.supabase
      .from("sops")
      .select("id, name, description, is_active, updated_at, service:service_types(id,name,color)")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    const ids = (rows ?? []).map((r: any) => r.id);
    const counts = new Map<string, { steps: number; atts: number }>();
    ids.forEach((id) => counts.set(id, { steps: 0, atts: 0 }));
    if (ids.length) {
      const [{ data: steps }, { data: atts }] = await Promise.all([
        context.supabase.from("sop_steps").select("sop_id").in("sop_id", ids),
        context.supabase.from("sop_attachments").select("sop_id").in("sop_id", ids),
      ]);
      for (const s of steps ?? []) {
        const c = counts.get((s as any).sop_id)!;
        c.steps += 1;
      }
      for (const a of atts ?? []) {
        const c = counts.get((a as any).sop_id)!;
        c.atts += 1;
      }
    }
    return (rows ?? []).map((r: any) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      is_active: r.is_active,
      updated_at: r.updated_at,
      service: r.service,
      step_count: counts.get(r.id)?.steps ?? 0,
      attachment_count: counts.get(r.id)?.atts ?? 0,
    }));
  });

// ---------- Get by id ----------

async function fetchSopDetail(context: any, sopId: string): Promise<SopDetail | null> {
  const { data: sop, error } = await context.supabase
    .from("sops")
    .select("id, service_type_id, name, description, is_active, updated_at, service:service_types(id,name,color)")
    .eq("id", sopId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!sop) return null;
  const [{ data: steps }, { data: atts }] = await Promise.all([
    context.supabase.from("sop_steps")
      .select("id, step_number, title, description, reference_photo_path")
      .eq("sop_id", sopId).order("step_number", { ascending: true }),
    context.supabase.from("sop_attachments")
      .select("id, storage_path, original_filename, caption, uploaded_at")
      .eq("sop_id", sopId).order("uploaded_at", { ascending: true }),
  ]);
  const signedSteps: SopStep[] = await Promise.all((steps ?? []).map(async (s: any) => ({
    ...s,
    reference_photo_url: await signSopPath(context, s.reference_photo_path),
  })));
  const signedAtts: SopAttachment[] = await Promise.all((atts ?? []).map(async (a: any) => ({
    ...a,
    url: await signSopPath(context, a.storage_path),
  })));
  return { ...(sop as any), steps: signedSteps, attachments: signedAtts };
}

export const getSop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => fetchSopDetail(context, data.id));

// Get the active SOP for a service type (for job detail views)
export const getSopForServiceType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ service_type_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: sop } = await context.supabase
      .from("sops")
      .select("id")
      .eq("service_type_id", data.service_type_id)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sop) return null;
    return fetchSopDetail(context, (sop as any).id);
  });

// ---------- Upload URL ----------

export const createSopUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      kind: z.enum(["step", "attachment"]),
      file_name: z.string().trim().min(1).max(200),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const tid = await tenantId(context);
    const safe = data.file_name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${tid}/${data.kind}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
    const { data: signed, error } = await context.supabase.storage
      .from("sop-photos")
      .createSignedUploadUrl(path);
    if (error) throw new Error(error.message);
    return { path, token: signed.token };
  });

// ---------- Create ----------

const stepInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(3000).optional().default(""),
  reference_photo_path: z.string().optional().nullable(),
});
const attachmentInput = z.object({
  storage_path: z.string().min(1),
  original_filename: z.string().min(1).max(200),
  caption: z.string().trim().max(300).optional().default(""),
});
const createSopSchema = z.object({
  service_type_id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().default(""),
  is_active: z.boolean().optional().default(true),
  steps: z.array(stepInput).default([]),
  attachments: z.array(attachmentInput).default([]),
});

export const createSop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createSopSchema.parse(input))
  .handler(async ({ data, context }) => {
    const tid = await tenantId(context);
    const { data: sop, error } = await context.supabase
      .from("sops")
      .insert({
        tenant_id: tid,
        service_type_id: data.service_type_id,
        name: data.name,
        description: data.description || null,
        is_active: data.is_active,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const sopId = (sop as any).id as string;
    if (data.steps.length) {
      const rows = data.steps.map((s, i) => ({
        tenant_id: tid,
        sop_id: sopId,
        step_number: i + 1,
        title: s.title,
        description: s.description || null,
        reference_photo_path: s.reference_photo_path || null,
      }));
      const { error: se } = await context.supabase.from("sop_steps").insert(rows);
      if (se) throw new Error(se.message);
    }
    if (data.attachments.length) {
      const rows = data.attachments.map((a) => ({
        tenant_id: tid,
        sop_id: sopId,
        storage_path: a.storage_path,
        original_filename: a.original_filename,
        caption: a.caption || null,
        uploaded_by: context.userId,
      }));
      const { error: ae } = await context.supabase.from("sop_attachments").insert(rows);
      if (ae) throw new Error(ae.message);
    }
    return { id: sopId };
  });

// ---------- Update ----------

const updateSopSchema = createSopSchema.extend({ id: z.string().uuid() });

export const updateSop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateSopSchema.parse(input))
  .handler(async ({ data, context }) => {
    const tid = await tenantId(context);
    const { error: ue } = await context.supabase
      .from("sops")
      .update({
        service_type_id: data.service_type_id,
        name: data.name,
        description: data.description || null,
        is_active: data.is_active,
      })
      .eq("id", data.id);
    if (ue) throw new Error(ue.message);
    // Replace steps
    await context.supabase.from("sop_steps").delete().eq("sop_id", data.id);
    if (data.steps.length) {
      const rows = data.steps.map((s, i) => ({
        tenant_id: tid,
        sop_id: data.id,
        step_number: i + 1,
        title: s.title,
        description: s.description || null,
        reference_photo_path: s.reference_photo_path || null,
      }));
      const { error: se } = await context.supabase.from("sop_steps").insert(rows);
      if (se) throw new Error(se.message);
    }
    // Append any newly uploaded attachments
    if (data.attachments.length) {
      // Get existing paths
      const { data: existing } = await context.supabase
        .from("sop_attachments").select("storage_path").eq("sop_id", data.id);
      const have = new Set((existing ?? []).map((r: any) => r.storage_path));
      const newRows = data.attachments
        .filter((a) => !have.has(a.storage_path))
        .map((a) => ({
          tenant_id: tid,
          sop_id: data.id,
          storage_path: a.storage_path,
          original_filename: a.original_filename,
          caption: a.caption || null,
          uploaded_by: context.userId,
        }));
      if (newRows.length) {
        const { error: ae } = await context.supabase.from("sop_attachments").insert(newRows);
        if (ae) throw new Error(ae.message);
      }
    }
    return { ok: true };
  });

// ---------- Delete ----------

export const deleteSop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    // Collect storage paths and delete files
    const [{ data: steps }, { data: atts }] = await Promise.all([
      context.supabase.from("sop_steps").select("reference_photo_path").eq("sop_id", data.id),
      context.supabase.from("sop_attachments").select("storage_path").eq("sop_id", data.id),
    ]);
    const paths = [
      ...((steps ?? []).map((s: any) => s.reference_photo_path).filter(Boolean) as string[]),
      ...((atts ?? []).map((a: any) => a.storage_path).filter(Boolean) as string[]),
    ];
    if (paths.length) {
      await context.supabase.storage.from("sop-photos").remove(paths);
    }
    const { error } = await context.supabase.from("sops").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteSopAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: att } = await context.supabase
      .from("sop_attachments").select("storage_path").eq("id", data.id).maybeSingle();
    if ((att as any)?.storage_path) {
      await context.supabase.storage.from("sop-photos").remove([(att as any).storage_path]);
    }
    const { error } = await context.supabase.from("sop_attachments").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Duplicate ----------

export const duplicateSop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const tid = await tenantId(context);
    const { data: src } = await context.supabase
      .from("sops")
      .select("service_type_id, name, description, is_active")
      .eq("id", data.id).maybeSingle();
    if (!src) throw new Error("SOP not found");
    const { data: newSop, error } = await context.supabase
      .from("sops")
      .insert({
        tenant_id: tid,
        service_type_id: (src as any).service_type_id,
        name: `${(src as any).name} (copy)`,
        description: (src as any).description,
        is_active: false,
      })
      .select("id").single();
    if (error) throw new Error(error.message);
    const newId = (newSop as any).id as string;
    const { data: steps } = await context.supabase
      .from("sop_steps")
      .select("step_number, title, description, reference_photo_path")
      .eq("sop_id", data.id).order("step_number");
    if (steps && steps.length) {
      await context.supabase.from("sop_steps").insert(
        (steps as any[]).map((s) => ({
          tenant_id: tid,
          sop_id: newId,
          step_number: s.step_number,
          title: s.title,
          description: s.description,
          reference_photo_path: s.reference_photo_path,
        })),
      );
    }
    return { id: newId };
  });

// ---------- Bulk import ----------

const bulkItem = z.object({
  name: z.string().trim().min(1).max(200),
  service_type_id: z.string().uuid(),
  storage_path: z.string().min(1),
  original_filename: z.string().min(1).max(200),
});

export const bulkImportSops = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ items: z.array(bulkItem).min(1) }).parse(input))
  .handler(async ({ data, context }) => {
    const tid = await tenantId(context);
    const created: string[] = [];
    for (const it of data.items) {
      const { data: sop, error } = await context.supabase
        .from("sops")
        .insert({
          tenant_id: tid,
          service_type_id: it.service_type_id,
          name: it.name,
          description: `Imported from ${it.original_filename}`,
          is_active: true,
        })
        .select("id").single();
      if (error) throw new Error(error.message);
      const sopId = (sop as any).id as string;
      created.push(sopId);
      await context.supabase.from("sop_attachments").insert({
        tenant_id: tid,
        sop_id: sopId,
        storage_path: it.storage_path,
        original_filename: it.original_filename,
        caption: "Imported document",
        uploaded_by: context.userId,
      });
      // Add a single reference step pointing to the attachment
      await context.supabase.from("sop_steps").insert({
        tenant_id: tid,
        sop_id: sopId,
        step_number: 1,
        title: "Refer to attached document",
        description: `See attached: ${it.original_filename}`,
        reference_photo_path: null,
      });
    }
    return { count: created.length, ids: created };
  });

// ---------- Reviews ----------

export const markSopReviewed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      sop_id: z.string().uuid(),
      job_id: z.string().uuid().optional().nullable(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const tid = await tenantId(context);
    const { error } = await context.supabase.from("sop_reviews").insert({
      tenant_id: tid,
      sop_id: data.sop_id,
      employee_id: context.userId,
      job_id: data.job_id ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true, reviewed_at: new Date().toISOString() };
  });

export const getLatestSopReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      sop_id: z.string().uuid(),
      job_id: z.string().uuid().optional().nullable(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("sop_reviews")
      .select("id, reviewed_at, job_id")
      .eq("sop_id", data.sop_id)
      .eq("employee_id", context.userId)
      .order("reviewed_at", { ascending: false })
      .limit(1);
    if (data.job_id) q = q.eq("job_id", data.job_id);
    const { data: rows } = await q;
    return (rows && rows[0]) ? { reviewed_at: (rows[0] as any).reviewed_at as string } : null;
  });
