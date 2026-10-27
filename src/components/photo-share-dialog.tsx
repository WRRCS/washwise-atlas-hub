import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Copy, Mail, ExternalLink, Link2, Ban, RotateCcw, Loader2 } from "lucide-react";
import {
  createPhotoShareLink,
  listPhotoShareLinks,
  setPhotoShareLinkRevoked,
  type PhotoShareLinkRow,
} from "@/lib/photo-share.functions";
import type { DownloadPhoto } from "@/lib/photo-downloads";

type ShareablePhoto = DownloadPhoto & { url: string | null };

export function PhotoShareDialog({
  jobId,
  photos,
  open,
  onClose,
}: {
  jobId: string;
  photos: ShareablePhoto[];
  open: boolean;
  onClose: () => void;
}) {
  const createFn = useServerFn(createPhotoShareLink);
  const listFn = useServerFn(listPhotoShareLinks);
  const revokeFn = useServerFn(setPhotoShareLinkRevoked);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [links, setLinks] = useState<PhotoShareLinkRow[]>([]);
  const [busy, setBusy] = useState(false);

  const refreshLinks = async () => {
    try {
      setLinks(await listFn({ data: { job_id: jobId } }));
    } catch {
      /* list is best-effort */
    }
  };

  useEffect(() => {
    if (open) {
      setSelected(new Set(photos.map((p) => p.id)));
      setCreatedUrl(null);
      void refreshLinks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, jobId]);

  const groups = useMemo(() => {
    const map = new Map<string, ShareablePhoto[]>();
    for (const p of photos) {
      const key = p.uploaded_by ?? "legacy-unattributed";
      const group = map.get(key) ?? [];
      group.push(p);
      map.set(key, group);
    }
    return [...map.entries()];
  }, [photos]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const generate = async () => {
    if (!selected.size) return;
    setBusy(true);
    try {
      const { url } = await createFn({
        data: { job_id: jobId, photo_ids: [...selected], origin: window.location.origin },
      });
      setCreatedUrl(url);
      await refreshLinks();
      toast.success("Gallery link created");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const setRevoked = async (id: string, revoked: boolean) => {
    try {
      await revokeFn({ data: { id, revoked } });
      await refreshLinks();
      toast.success(revoked ? "Link revoked — it no longer shows photos" : "Link reactivated");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const mailto = createdUrl
    ? `mailto:?subject=${encodeURIComponent("Job photo gallery")}&body=${encodeURIComponent(`Here is the photo gallery:\n\n${createdUrl}\n\nNo login is needed to view or download the photos.`)}`
    : "#";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gallery-dialog max-w-2xl h-[min(48rem,calc(100dvh-2rem))] flex flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-4 py-4 pr-12 text-left">
          <DialogTitle>Share Photo Gallery</DialogTitle>
          <DialogDescription>
            {selected.size} of {photos.length} photos selected
          </DialogDescription>
        </DialogHeader>

        {createdUrl && (
          <div className="shrink-0 space-y-2 border-b border-border/60 p-3">
            <input
              readOnly
              value={createdUrl}
              aria-label="Gallery link"
              onFocus={(e) => e.currentTarget.select()}
              className="w-full min-w-0 rounded-md border bg-muted px-3 py-2 text-sm"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={async () => {
                  try { await navigator.clipboard.writeText(createdUrl); toast.success("Link copied"); }
                  catch { toast.error("Couldn't copy — press and hold the link to copy it"); }
                }}
              >
                <Copy className="size-4 mr-1" /> Copy Link
              </Button>
              <Button asChild className="bg-brand text-brand-foreground hover:opacity-90">
                <a href={mailto}><Mail className="size-4 mr-1" /> Email Gallery</a>
              </Button>
              <Button asChild variant="ghost">
                <a href={createdUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-4 mr-1" /> Open Gallery</a>
              </Button>
            </div>
          </div>
        )}

        <div className="gallery-body min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">{selected.size} of {photos.length} selected</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setSelected(new Set(photos.map((p) => p.id)))}>
              Select all
            </Button>
            <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          {groups.map(([employeeId, list]) => (
            <div key={employeeId}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-sm font-semibold">{list[0]?.uploader_name ?? "Legacy / unattributed"}</p>
                <Button size="sm" variant="ghost" onClick={() => setSelected(prev => {
                  const next = new Set(prev);
                  const all = list.every(photo => next.has(photo.id));
                  for (const photo of list) { if (all) next.delete(photo.id); else next.add(photo.id); }
                  return next;
                })}>{list.every(photo => selected.has(photo.id)) ? "Clear employee" : "Select employee"}</Button>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {list.map((p) => {
                  const on = selected.has(p.id);
                  return (
                    <Button
                      variant="ghost"
                      key={p.id}
                      type="button"
                      onClick={() => toggle(p.id)}
                      aria-label={`Select photo ${p.id} by ${p.uploader_name ?? "Legacy / unattributed"}`}
                      className={`relative h-auto p-0 rounded-lg overflow-hidden border-2 ${on ? "border-brand" : "border-transparent opacity-50"}`}
                      aria-pressed={on}
                    >
                      {p.url && <img src={p.url} alt="" className="aspect-square w-full object-cover" />}
                      <span
                        className={`absolute top-1 right-1 size-5 rounded-full text-[11px] grid place-items-center ${
                          on ? "bg-brand text-brand-foreground" : "bg-background/80 text-muted-foreground"
                        }`}
                      >
                        {on ? "✓" : ""}
                      </span>
                    </Button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {links.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Existing gallery links</p>
            {links.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm">
                <div>
                  <p className="font-medium">
                    {l.photo_count} photo{l.photo_count === 1 ? "" : "s"} ·{" "}
                    {new Date(l.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </p>
                  <p className={l.revoked_at ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>
                    {l.revoked_at ? "Revoked — link no longer works" : "Active"}
                  </p>
                </div>
                {l.revoked_at ? (
                  <Button size="sm" variant="outline" onClick={() => setRevoked(l.id, false)}>
                    <RotateCcw className="size-4 mr-1" /> Reactivate
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setRevoked(l.id, true)}>
                    <Ban className="size-4 mr-1" /> Revoke Link
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
        </div>
        <DialogFooter className="shrink-0 border-t bg-background px-4 py-3 flex-row flex-wrap items-center justify-end">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={generate} disabled={busy || !selected.size} className="bg-brand text-brand-foreground hover:opacity-90">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
            {busy ? "Creating…" : "Create Share Link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
