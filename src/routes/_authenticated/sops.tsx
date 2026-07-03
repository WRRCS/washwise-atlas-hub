import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { queryOptions, useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell, PageHeader, BrandButton } from "@/components/app-shell";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, Copy, FileUp, Plus, X, Upload as UploadIcon, GripVertical, ImageIcon, FileText, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { listServiceTypes } from "@/lib/entities.functions";
import {
  listSops, createSop, updateSop, deleteSop, duplicateSop, getSop,
  createSopUploadUrl, bulkImportSops, deleteSopAttachment,
  type SopListRow, type SopDetail,
} from "@/lib/sops.functions";

const sopsQO = queryOptions({ queryKey: ["sops"], queryFn: () => listSops() });
const svcQO = queryOptions({ queryKey: ["service-types"], queryFn: () => listServiceTypes() });

export const Route = createFileRoute("/_authenticated/sops")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(sopsQO),
      context.queryClient.ensureQueryData(svcQO),
    ]),
  component: SopsPage,
});

type ServiceType = { id: string; name: string; color: string | null };

function SopsPage() {
  const { data: sops } = useSuspenseQuery(sopsQO);
  const { data: services } = useSuspenseQuery(svcQO);
  const router = useRouter();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const dupFn = useServerFn(duplicateSop);
  const delFn = useServerFn(deleteSop);

  const grouped = useMemo(() => {
    const m = new Map<string, { service: ServiceType | null; items: SopListRow[] }>();
    for (const s of sops as SopListRow[]) {
      const key = s.service?.id ?? "unassigned";
      const entry = m.get(key) ?? { service: (s.service as ServiceType) ?? null, items: [] };
      entry.items.push(s);
      m.set(key, entry);
    }
    return [...m.values()];
  }, [sops]);

  const onDuplicate = async (id: string) => {
    try {
      await dupFn({ data: { id } });
      toast.success("Duplicated");
      router.invalidate();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };
  const onDelete = async (s: SopListRow) => {
    if (!confirm(`Delete "${s.name}"? This removes its steps and attachments.`)) return;
    try {
      await delFn({ data: { id: s.id } });
      toast.success("Deleted");
      router.invalidate();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  return (
    <AppShell>
      <PageHeader
        title="SOPs"
        subtitle="Standard operating procedures your cleaners follow"
        action={<BrandButton onClick={() => { setEditId(null); setWizardOpen(true); }}>New SOP</BrandButton>}
      />
      <div className="max-w-6xl mx-auto w-full px-6 md:px-8 py-8 space-y-8">
        {(sops as SopListRow[]).length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm">
            No SOPs yet. Create your first one, or import from paper/Docs.
          </div>
        ) : grouped.map((g) => (
          <section key={g.service?.id ?? "unassigned"}>
            <div className="flex items-center gap-2 mb-3">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: g.service?.color ?? "#999" }} />
              <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                {g.service?.name ?? "No service type"}
              </h2>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {g.items.map((s) => (
                <article key={s.id} className="bg-white rounded-xl ring-1 ring-black/5 p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="font-medium tracking-tight">{s.name}</h3>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider font-medium ${
                      s.is_active ? "bg-green-100 text-green-800" : "bg-clay-200 text-muted-foreground"
                    }`}>
                      {s.is_active ? "Active" : "Draft"}
                    </span>
                  </div>
                  {s.description && <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{s.description}</p>}
                  <p className="text-xs text-muted-foreground mb-4">
                    {s.step_count} step{s.step_count === 1 ? "" : "s"} · {s.attachment_count} attachment{s.attachment_count === 1 ? "" : "s"}
                  </p>
                  <div className="mt-auto flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => { setEditId(s.id); setWizardOpen(true); }}>
                      <Pencil className="size-3.5 mr-1.5" /> Edit
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => onDuplicate(s.id)} title="Duplicate">
                      <Copy className="size-3.5" />
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => onDelete(s)} className="text-destructive hover:text-destructive" title="Delete">
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>

      {wizardOpen && (
        <SopWizard
          services={services as ServiceType[]}
          editId={editId}
          onClose={() => setWizardOpen(false)}
          onSaved={() => { setWizardOpen(false); router.invalidate(); }}
        />
      )}
    </AppShell>
  );
}

// ================= Wizard =================

type WizardStepDraft = {
  id: string;
  title: string;
  description: string;
  reference_photo_path: string | null;
  reference_photo_preview: string | null;
  uploading: boolean;
};
type WizardAttachmentDraft = {
  id?: string; // set for pre-existing attachments
  local_id: string;
  storage_path: string;
  original_filename: string;
  caption: string;
  preview_url: string | null;
  uploading: boolean;
};

function SopWizard({
  services, editId, onClose, onSaved,
}: {
  services: ServiceType[];
  editId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const getFn = useServerFn(getSop);
  const createFn = useServerFn(createSop);
  const updateFn = useServerFn(updateSop);
  const delAttFn = useServerFn(deleteSopAttachment);

  const existing = useQuery({
    queryKey: ["sop", editId],
    queryFn: () => getFn({ data: { id: editId! } }),
    enabled: !!editId,
  });

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [importOpen, setImportOpen] = useState(false);
  const [serviceTypeId, setServiceTypeId] = useState<string>("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [steps, setSteps] = useState<WizardStepDraft[]>([]);
  const [attachments, setAttachments] = useState<WizardAttachmentDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from existing SOP
  if (editId && existing.data && !hydrated) {
    const sop = existing.data as SopDetail;
    setServiceTypeId(sop.service_type_id);
    setName(sop.name);
    setDescription(sop.description ?? "");
    setIsActive(sop.is_active);
    setSteps(sop.steps.map((s) => ({
      id: crypto.randomUUID(),
      title: s.title,
      description: s.description ?? "",
      reference_photo_path: s.reference_photo_path,
      reference_photo_preview: s.reference_photo_url,
      uploading: false,
    })));
    setAttachments(sop.attachments.map((a) => ({
      id: a.id,
      local_id: crypto.randomUUID(),
      storage_path: a.storage_path,
      original_filename: a.original_filename,
      caption: a.caption ?? "",
      preview_url: a.url,
      uploading: false,
    })));
    setHydrated(true);
  }

  const addStep = () => setSteps((prev) => [
    ...prev,
    { id: crypto.randomUUID(), title: "", description: "", reference_photo_path: null, reference_photo_preview: null, uploading: false },
  ]);
  const removeStep = (id: string) => setSteps((prev) => prev.filter((s) => s.id !== id));
  const updateStep = (id: string, patch: Partial<WizardStepDraft>) =>
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const moveStep = (idx: number, dir: -1 | 1) => {
    setSteps((prev) => {
      const arr = prev.slice();
      const j = idx + dir;
      if (j < 0 || j >= arr.length) return prev;
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
      return arr;
    });
  };

  const canNext1 = !!serviceTypeId;
  const canNext2 = name.trim().length > 0;
  const canSave = steps.every((s) => s.title.trim().length > 0);

  const onSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const payload = {
        service_type_id: serviceTypeId,
        name: name.trim(),
        description: description.trim(),
        is_active: isActive,
        steps: steps.map((s) => ({
          title: s.title.trim(),
          description: s.description.trim(),
          reference_photo_path: s.reference_photo_path,
        })),
        attachments: attachments.map((a) => ({
          storage_path: a.storage_path,
          original_filename: a.original_filename,
          caption: a.caption,
        })),
      };
      if (editId) {
        await updateFn({ data: { id: editId, ...payload } });
        toast.success("SOP updated");
      } else {
        await createFn({ data: payload });
        toast.success("SOP created");
      }
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const onDeleteExistingAttachment = async (a: WizardAttachmentDraft) => {
    if (!a.id) {
      setAttachments((prev) => prev.filter((x) => x.local_id !== a.local_id));
      return;
    }
    if (!confirm("Remove this attachment?")) return;
    try {
      await delAttFn({ data: { id: a.id } });
      setAttachments((prev) => prev.filter((x) => x.local_id !== a.local_id));
      toast.success("Removed");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editId ? "Edit SOP" : "New SOP"}</DialogTitle>
          <DialogDescription>
            Step {step} of 4 — {step === 1 ? "Service type" : step === 2 ? "Name & description" : step === 3 ? "Steps" : "Attachments"}
          </DialogDescription>
        </DialogHeader>

        <ol className="flex items-center gap-2 mb-2 text-xs">
          {[1, 2, 3, 4].map((n) => (
            <li key={n} className="flex items-center gap-2">
              <span className={`size-6 rounded-full grid place-items-center font-medium ${
                step === n ? "bg-brand text-brand-foreground" : step > n ? "bg-brand/20 text-brand" : "bg-clay-200 text-muted-foreground"
              }`}>
                {step > n ? <Check className="size-3.5" /> : n}
              </span>
              {n < 4 && <span className="w-6 h-px bg-clay-200" />}
            </li>
          ))}
        </ol>

        {step === 1 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <Label>Service type</Label>
              {!editId && (
                <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                  <FileUp className="size-3.5 mr-1.5" /> Import existing SOP
                </Button>
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              {services.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setServiceTypeId(s.id)}
                  className={`text-left p-3 rounded-lg border transition-colors ${
                    serviceTypeId === s.id ? "border-brand bg-brand/5" : "border-input hover:bg-clay-100"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: s.color ?? "#999" }} />
                    <span className="text-sm font-medium">{s.name}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <Label htmlFor="sop-name">Name</Label>
              <Input id="sop-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Residential Deep Clean SOP" />
            </div>
            <div>
              <Label htmlFor="sop-desc">Description</Label>
              <Textarea id="sop-desc" rows={4} value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief overview of what this SOP covers…" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              Active (employees see this SOP on assigned jobs)
            </label>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            {steps.length === 0 && <p className="text-sm text-muted-foreground">No steps yet.</p>}
            {steps.map((s, i) => (
              <StepRow
                key={s.id}
                index={i}
                total={steps.length}
                step={s}
                onChange={(patch) => updateStep(s.id, patch)}
                onRemove={() => removeStep(s.id)}
                onMove={(dir) => moveStep(i, dir)}
              />
            ))}
            <Button variant="outline" onClick={addStep} className="w-full">
              <Plus className="size-4 mr-1.5" /> Add step
            </Button>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Add general PDFs or photos that apply to the whole SOP (e.g. supply list, floor plan).
            </p>
            <AttachmentsField
              items={attachments}
              onAdd={(items) => setAttachments((prev) => [...prev, ...items])}
              onUpdate={(local_id, patch) => setAttachments((prev) => prev.map((a) => a.local_id === local_id ? { ...a, ...patch } : a))}
              onRemove={onDeleteExistingAttachment}
            />
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <div className="flex-1 flex gap-2 order-2 sm:order-1">
            {step > 1 && <Button variant="outline" onClick={() => setStep((s) => (s - 1) as any)}>Back</Button>}
          </div>
          <div className="flex gap-2 order-1 sm:order-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            {step < 4 ? (
              <Button
                disabled={(step === 1 && !canNext1) || (step === 2 && !canNext2)}
                onClick={() => setStep((s) => (s + 1) as any)}
              >
                Next
              </Button>
            ) : (
              <Button disabled={saving || !canSave || !canNext1 || !canNext2} onClick={onSave}>
                {saving ? "Saving…" : editId ? "Save changes" : "Create SOP"}
              </Button>
            )}
          </div>
        </DialogFooter>

        {importOpen && (
          <ImportModal
            services={services}
            onClose={() => setImportOpen(false)}
            onDone={() => { setImportOpen(false); onSaved(); }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function StepRow({
  index, total, step, onChange, onRemove, onMove,
}: {
  index: number;
  total: number;
  step: WizardStepDraft;
  onChange: (patch: Partial<WizardStepDraft>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const uploadUrlFn = useServerFn(createSopUploadUrl);
  const fileRef = useRef<HTMLInputElement>(null);

  const onPickFile = async (file: File) => {
    onChange({ uploading: true });
    try {
      const { path, token } = await uploadUrlFn({ data: { kind: "step", file_name: file.name } });
      const { error } = await supabase.storage.from("sop-photos").uploadToSignedUrl(path, token, file, { contentType: file.type });
      if (error) throw new Error(error.message);
      const { data: signed } = await supabase.storage.from("sop-photos").createSignedUrl(path, 3600);
      onChange({ reference_photo_path: path, reference_photo_preview: signed?.signedUrl ?? URL.createObjectURL(file), uploading: false });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
      onChange({ uploading: false });
    }
  };

  return (
    <div className="bg-clay-100/60 rounded-lg p-3 ring-1 ring-black/5">
      <div className="flex items-start gap-2">
        <div className="flex flex-col items-center pt-1">
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label="Move up">
            <GripVertical className="size-4" />
          </button>
          <span className="text-xs font-medium mt-1">{index + 1}</span>
          <button type="button" onClick={() => onMove(1)} disabled={index === total - 1}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30 mt-1" aria-label="Move down">
            <GripVertical className="size-4 rotate-180" />
          </button>
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <Input placeholder="Step title" value={step.title} onChange={(e) => onChange({ title: e.target.value })} />
          <Textarea rows={2} placeholder="Details (optional)" value={step.description} onChange={(e) => onChange({ description: e.target.value })} />
          <div className="flex items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickFile(f); e.target.value = ""; }}
            />
            {step.reference_photo_preview ? (
              <>
                <img src={step.reference_photo_preview} alt="" className="size-16 object-cover rounded" />
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>Replace</Button>
                  <Button variant="outline" size="sm" onClick={() => onChange({ reference_photo_path: null, reference_photo_preview: null })}>Remove</Button>
                </div>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={step.uploading}>
                <ImageIcon className="size-3.5 mr-1.5" /> {step.uploading ? "Uploading…" : "Add reference photo"}
              </Button>
            )}
          </div>
        </div>
        <button type="button" onClick={onRemove} className="text-muted-foreground hover:text-destructive p-1" aria-label="Remove step">
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

function AttachmentsField({
  items, onAdd, onUpdate, onRemove,
}: {
  items: WizardAttachmentDraft[];
  onAdd: (items: WizardAttachmentDraft[]) => void;
  onUpdate: (local_id: string, patch: Partial<WizardAttachmentDraft>) => void;
  onRemove: (a: WizardAttachmentDraft) => void;
}) {
  const uploadUrlFn = useServerFn(createSopUploadUrl);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      const local_id = crypto.randomUUID();
      onAdd([{
        local_id, storage_path: "", original_filename: file.name, caption: "",
        preview_url: file.type.startsWith("image/") ? URL.createObjectURL(file) : null, uploading: true,
      }]);
      try {
        const { path, token } = await uploadUrlFn({ data: { kind: "attachment", file_name: file.name } });
        const { error } = await supabase.storage.from("sop-photos").uploadToSignedUrl(path, token, file, { contentType: file.type });
        if (error) throw new Error(error.message);
        onUpdate(local_id, { storage_path: path, uploading: false });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Upload failed");
        onUpdate(local_id, { uploading: false });
      }
    }
  };

  return (
    <div className="space-y-3">
      <input ref={fileRef} type="file" multiple hidden
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
      />
      <Button variant="outline" onClick={() => fileRef.current?.click()} className="w-full">
        <UploadIcon className="size-4 mr-1.5" /> Add files (PDFs, images…)
      </Button>
      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((a) => {
            const isImage = /\.(png|jpe?g|webp|gif|heic)$/i.test(a.original_filename);
            return (
              <li key={a.local_id} className="flex items-center gap-3 bg-clay-100 rounded-lg p-2">
                <div className="size-12 rounded bg-clay-200 grid place-items-center overflow-hidden shrink-0">
                  {a.preview_url ? <img src={a.preview_url} alt="" className="w-full h-full object-cover" /> :
                    isImage ? <ImageIcon className="size-4 text-muted-foreground" /> : <FileText className="size-4 text-muted-foreground" />}
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="text-sm truncate">{a.original_filename}</p>
                  <Input value={a.caption} onChange={(e) => onUpdate(a.local_id, { caption: e.target.value })}
                    placeholder="Caption (optional)" className="h-7 text-xs" />
                  {a.uploading && <p className="text-[11px] text-muted-foreground">Uploading…</p>}
                </div>
                <button type="button" onClick={() => onRemove(a)} className="text-muted-foreground hover:text-destructive p-1" aria-label="Remove">
                  <X className="size-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ============= Import Modal =============

type ImportItemDraft = {
  local_id: string;
  file: File;
  name: string;
  service_type_id: string;
  storage_path: string;
  uploading: boolean;
  uploaded: boolean;
};

function ImportModal({
  services, onClose, onDone,
}: {
  services: ServiceType[];
  onClose: () => void;
  onDone: () => void;
}) {
  const uploadUrlFn = useServerFn(createSopUploadUrl);
  const bulkFn = useServerFn(bulkImportSops);
  const fileRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<ImportItemDraft[]>([]);
  const [saving, setSaving] = useState(false);

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const drafts: ImportItemDraft[] = [];
    for (const file of Array.from(files)) {
      drafts.push({
        local_id: crypto.randomUUID(),
        file,
        name: file.name.replace(/\.[^.]+$/, ""),
        service_type_id: services[0]?.id ?? "",
        storage_path: "",
        uploading: true,
        uploaded: false,
      });
    }
    setItems((prev) => [...prev, ...drafts]);
    for (const d of drafts) {
      try {
        const { path, token } = await uploadUrlFn({ data: { kind: "attachment", file_name: d.file.name } });
        const { error } = await supabase.storage.from("sop-photos").uploadToSignedUrl(path, token, d.file, { contentType: d.file.type });
        if (error) throw new Error(error.message);
        setItems((prev) => prev.map((x) => x.local_id === d.local_id ? { ...x, storage_path: path, uploading: false, uploaded: true } : x));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Upload failed");
        setItems((prev) => prev.map((x) => x.local_id === d.local_id ? { ...x, uploading: false } : x));
      }
    }
  };

  const canSave = items.length > 0 && items.every((i) => i.uploaded && i.name.trim() && i.service_type_id);

  const onSubmit = async () => {
    setSaving(true);
    try {
      await bulkFn({
        data: {
          items: items.map((i) => ({
            name: i.name.trim(),
            service_type_id: i.service_type_id,
            storage_path: i.storage_path,
            original_filename: i.file.name,
          })),
        },
      });
      toast.success(`Imported ${items.length} SOP${items.length === 1 ? "" : "s"}`);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to import");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import existing SOPs</DialogTitle>
          <DialogDescription>
            Upload PDFs, images, or text files. Each becomes a new SOP with the file as an attachment.
          </DialogDescription>
        </DialogHeader>
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        <Button variant="outline" onClick={() => fileRef.current?.click()} className="w-full">
          <UploadIcon className="size-4 mr-1.5" /> Choose files
        </Button>
        {items.length > 0 && (
          <div className="space-y-3 mt-3">
            {items.map((it) => (
              <div key={it.local_id} className="bg-clay-100/60 rounded-lg p-3 ring-1 ring-black/5">
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="size-4 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground truncate flex-1">{it.file.name}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {it.uploading ? "Uploading…" : it.uploaded ? "Uploaded" : "Failed"}
                  </span>
                </div>
                <div className="grid sm:grid-cols-2 gap-2">
                  <Input value={it.name} onChange={(e) =>
                    setItems((prev) => prev.map((x) => x.local_id === it.local_id ? { ...x, name: e.target.value } : x))}
                    placeholder="SOP name" />
                  <select
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    value={it.service_type_id}
                    onChange={(e) =>
                      setItems((prev) => prev.map((x) => x.local_id === it.local_id ? { ...x, service_type_id: e.target.value } : x))}
                  >
                    {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onSubmit} disabled={!canSave || saving}>
            {saving ? "Importing…" : `Import ${items.length || ""} SOP${items.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
