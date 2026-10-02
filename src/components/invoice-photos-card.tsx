import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Link2, ImagePlus, Check } from "lucide-react";
import { listInvoicePhotoChoices, setInvoicePhotos, createPhotoLink } from "@/lib/invoice-photos.functions";

const LABEL: Record<string, string> = { before: "Before", after: "After", damage: "Damage", other: "Other" };

export function InvoicePhotosCard({ invoiceId }: { invoiceId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listInvoicePhotoChoices);
  const saveFn = useServerFn(setInvoicePhotos);
  const linkFn = useServerFn(createPhotoLink);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const { data: photos = [] } = useQuery({
    queryKey: ["invoice-photos", invoiceId],
    queryFn: () => listFn({ data: { invoice_id: invoiceId } }),
  });
  const attached = photos.filter((p) => p.attached);

  const copyLink = async (id: string) => {
    try {
      const { url } = await linkFn({ data: { photo_id: id } });
      await navigator.clipboard.writeText(url);
      toast.success("Photo link copied (works for 30 days)");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="bg-card p-6 rounded-xl ring-1 ring-black/5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Photos on this invoice</h3>
          <p className="text-xs text-muted-foreground">Attached photos show on the client's payment page.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setPicked(new Set(attached.map((p) => p.id))); setOpen(true); }}
        >
          <ImagePlus className="size-4 mr-1" /> Choose photos
        </Button>
      </div>
      {attached.length === 0 ? (
        <p className="text-sm text-muted-foreground">No photos attached.</p>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {attached.map((p) => (
            <div key={p.id} className="space-y-1">
              {p.url && <img src={p.url} alt={p.caption ?? ""} className="aspect-square w-full object-cover rounded-md" />}
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{LABEL[p.photo_type] ?? p.photo_type}</span>
                <button onClick={() => copyLink(p.id)} className="inline-flex items-center gap-0.5 hover:text-foreground">
                  <Link2 className="size-3" /> Link
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Attach job photos</DialogTitle>
            <DialogDescription>Tap photos to attach them, or copy a link to any photo.</DialogDescription>
          </DialogHeader>
          {photos.length === 0 ? (
            <p className="text-sm text-muted-foreground">No job photos for this client yet.</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {photos.map((p) => {
                const on = picked.has(p.id);
                return (
                  <div key={p.id} className="space-y-1">
                    <button
                      type="button"
                      onClick={() => {
                        const n = new Set(picked);
                        on ? n.delete(p.id) : n.add(p.id);
                        setPicked(n);
                      }}
                      className={`relative block w-full rounded-md overflow-hidden ring-2 ${on ? "ring-brand" : "ring-transparent"}`}
                    >
                      {p.url && <img src={p.url} alt={p.caption ?? ""} className="aspect-square w-full object-cover" />}
                      {on && <span className="absolute top-1 right-1 rounded-full bg-brand text-brand-foreground p-0.5"><Check className="size-3" /></span>}
                    </button>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground gap-1">
                      <span className="truncate">
                        {LABEL[p.photo_type] ?? p.photo_type}
                        {p.job_date ? ` · ${format(new Date(p.job_date), "MMM d")}` : ""}
                        {p.property ? ` · ${p.property}` : ""}
                      </span>
                      <button onClick={() => copyLink(p.id)} className="shrink-0 hover:text-foreground" aria-label="Copy photo link">
                        <Link2 className="size-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button
              disabled={busy}
              className="bg-brand text-brand-foreground hover:opacity-90"
              onClick={async () => {
                setBusy(true);
                try {
                  await saveFn({ data: { invoice_id: invoiceId, photo_ids: Array.from(picked) } });
                  qc.invalidateQueries({ queryKey: ["invoice-photos", invoiceId] });
                  toast.success("Invoice photos saved");
                  setOpen(false);
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save ({picked.size})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
