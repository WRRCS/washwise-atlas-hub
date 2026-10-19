import { useEffect, useRef, useState } from "react";
import { Download, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { deliverPhotoFile, preparePhotoExport, type DownloadPhoto, type PhotoExportContext } from "@/lib/photo-downloads";

export function usePhotoDownloads(photos: DownloadPhoto[], context: PhotoExportContext, allCleaners: boolean) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [jpeg, setJpeg] = useState(false);
  const [ready, setReady] = useState<Awaited<ReturnType<typeof preparePhotoExport>> | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const start = async (items: DownloadPhoto[], zip: boolean) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(""); setReady(null); setProgress("Preparing images…");
    try {
      const result = await preparePhotoExport(items, context, { zip, jpeg, groupByCleaner: allCleaners,
        onProgress: (done, total) => { if (mounted.current) setProgress(`${done} / ${total} photos prepared${done === total && zip ? " · Creating ZIP…" : ""}`); },
      });
      if (!mounted.current) return;
      if (result.failures.length) setError(`Incomplete download: ${result.failures.join("; ")}`);
      if (matchMedia("(pointer: coarse)").matches || result.failures.length) setReady(result);
      else await deliverPhotoFile(result.blob, result.filename);
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "Photo download failed — please try again"); }
    finally { locked.current = false; if (mounted.current) { setBusy(false); setProgress(""); } }
  };
  const toggle = (id: string) => setSelected(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const singleButton = (photo: DownloadPhoto) => <Button variant="outline" size="sm" disabled={busy} onClick={() => start([photo], false)}><Download className="size-4" /> Download</Button>;
  const toolbar = photos.length > 0 && <div className="space-y-3 mb-4">
    <div className="flex flex-wrap gap-2 items-center">
      <Button variant="outline" size="sm" disabled={busy} onClick={() => setSelected(selected.size === photos.length ? new Set() : new Set(photos.map(p => p.id)))}>{selected.size === photos.length ? "Clear selection" : "Select all"}</Button>
      <Button variant="outline" size="sm" disabled={busy || !selected.size} onClick={() => start(photos.filter(p => selected.has(p.id)), true)}><Download className="size-4" /> Download selected ({photos.filter(p => selected.has(p.id)).length}) · ZIP</Button>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => start(photos, true)}><Download className="size-4" /> {allCleaners ? "Download all cleaners’ photos" : "Download all photos"} · ZIP</Button>
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={jpeg} disabled={busy} onCheckedChange={v => setJpeg(v === true)} /> JPEG copies</label>
    </div>
    <p className="text-xs text-muted-foreground">Extract ZIP images before uploading to Turno. After uploading to Turno, you can delete the downloaded files. Your originals remain in WRRCS.</p>
    {busy && <p role="status" className="flex gap-2 items-center text-sm"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" />{progress}</p>}
    {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
    {ready && <div className="flex flex-wrap gap-2"><Button onClick={async () => { try { await deliverPhotoFile(ready.blob, ready.filename); setReady(null); } catch { setError("Could not save the file — please try again"); } }}><Download className="size-4" /> {ready.failures.length ? "Save incomplete ZIP" : "Save prepared download"}</Button><Button size="icon" variant="ghost" aria-label="Discard prepared download" onClick={() => setReady(null)}><X className="size-4" /></Button></div>}
  </div>;
  return { toolbar, singleButton, selected, toggle, busy };
}