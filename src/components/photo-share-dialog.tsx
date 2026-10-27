import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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
      const name = p.uploader_name ?? "Team member";
      if (!map.has(name)) map.set(name, []);
      map.get(name)!.push(p);
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
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Share photo gallery</DialogTitle>
          <DialogDescription>
            Pick the photos to include. The link stays active until you revoke it — no login needed to view it.
          </DialogDescription>
        </DialogHeader>

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
          {groups.map(([name, list]) => (
            <div key={name}>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{name}</p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {list.map((p) => {
                  const on = selected.has(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggle(p.id)}
                      className={`relative rounded-lg overflow-hidden border-2 ${on ? "border-brand" : "border-transparent opacity-50"}`}
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
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <Button
          onClick={generate}
          disabled={busy || !selected.size}
          className="bg-brand text-brand-foreground hover:opacity-90"
        >
          {busy ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Link2 className="size-4 mr-1" />}
          Generate gallery link ({selected.size})
        </Button>

        {createdUrl && (
          <div className="space-y-2 rounded-lg border border-border/60 p-3">
            <input
              readOnly
              value={createdUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full rounded-md border bg-muted px-3 py-2 text-sm"
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
                <a href={createdUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-4 mr-1" /> Open</a>
              </Button>
            </div>
          </div>
        )}

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
      </DialogContent>
    </Dialog>
  );
}
