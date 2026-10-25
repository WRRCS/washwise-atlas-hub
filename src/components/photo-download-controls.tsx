import { useEffect, useRef, useState } from "react";
import { Download, Loader2, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { buildPhotoZip, deliverPhotoFile, preparePhotoExport, triggerDownload, uniquePhotoReferences, zipFilename, type DownloadPhoto, type PhotoExportContext, type PreparedPhoto } from "@/lib/photo-downloads";

type ZipState = {
  requested: DownloadPhoto[];
  files: PreparedPhoto[];
  failures: string[];
  failedPhotos: DownloadPhoto[];
  zip: Blob | null;
  filename: string;
  started: boolean;
};

/**
 * Single photos download as one image file. Selected / all photos are packaged into ONE ZIP
 * (flat, no folders) and exactly one browser download is triggered.
 */
export function usePhotoDownloads(photos: DownloadPhoto[], context: PhotoExportContext, options: { cleanerName?: string; allCleaners?: boolean } = {}) {
  photos = uniquePhotoReferences(photos);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [zipState, setZipState] = useState<ZipState | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const touch = () => matchMedia("(pointer: coarse)").matches;

  const run = async (fn: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try { await fn(); }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "Photo download failed — please try again"); }
    finally { locked.current = false; if (mounted.current) { setBusy(false); setProgress(""); } }
  };
  const progressFor = (done: number, total: number) => { if (mounted.current) setProgress(`Preparing ${Math.min(done + 1, total)} of ${total} photos…`); };

  const downloadOne = (photo: DownloadPhoto) => run(async () => {
    setProgress("Preparing photo…");
    const result = await preparePhotoExport([photo], context, {});
    await deliverPhotoFile(result.files[0].blob, result.files[0].filename);
  });

  const finishZip = async (requested: DownloadPhoto[], files: PreparedPhoto[], failures: string[], failedPhotos: DownloadPhoto[]) => {
    const filename = zipFilename(context, options.cleanerName);
    if (failedPhotos.length) {
      // Do not download an incomplete ZIP silently — let the user retry or choose to continue.
      setZipState({ requested, files, failures, failedPhotos, zip: null, filename, started: false });
      return;
    }
    setProgress(`Creating ZIP of ${files.length} photos…`);
    const zip = await buildPhotoZip(files);
    if (!mounted.current) return;
    const auto = !touch();
    if (auto) triggerDownload(zip, filename);
    setZipState({ requested, files, failures: [], failedPhotos: [], zip, filename, started: auto });
  };

  const downloadZip = (items: DownloadPhoto[]) => {
    return run(async () => {
      setZipState(null);
      const result = await preparePhotoExport(items, context, { onProgress: progressFor });
      if (!mounted.current) return;
      await finishZip(items, result.files, result.failures, result.failedPhotos);
    });
  };

  const retryMissing = () => {
    const state = zipState;
    if (!state?.failedPhotos.length) return;
    return run(async () => {
      let retried: Awaited<ReturnType<typeof preparePhotoExport>> | null = null;
      try { retried = await preparePhotoExport(state.failedPhotos, context, { onProgress: progressFor }); }
      catch { retried = null; }
      if (!mounted.current) return;
      const files = [...state.files, ...(retried?.files ?? [])];
      const order = new Map(state.requested.map((p, i) => [p.id, i]));
      files.sort((a, b) => (order.get(a.photoId) ?? 0) - (order.get(b.photoId) ?? 0));
      const failedPhotos = retried ? retried.failedPhotos : state.failedPhotos;
      const failures = retried ? retried.failures : state.failures;
      await finishZip(state.requested, files, failures, failedPhotos);
    });
  };

  const downloadIncomplete = () => {
    const state = zipState;
    if (!state) return;
    return run(async () => {
      setProgress(`Creating ZIP of ${state.files.length} photos…`);
      const zip = await buildPhotoZip(state.files);
      if (!mounted.current) return;
      const auto = !touch();
      if (auto) triggerDownload(zip, state.filename);
      setZipState({ ...state, zip, started: auto });
    });
  };

  const saveZip = async () => {
    if (!zipState?.zip || locked.current) return;
    locked.current = true; setBusy(true);
    try { await deliverPhotoFile(zipState.zip, zipState.filename); setZipState({ ...zipState, started: true }); }
    catch { setError("Could not start the ZIP download — please try again"); }
    finally { setTimeout(() => { locked.current = false; if (mounted.current) setBusy(false); }, 500); }
  };

  const toggle = (id: string) => setSelected(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const singleButton = (photo: DownloadPhoto) => <Button variant="outline" size="sm" disabled={busy} onClick={() => downloadOne(photo)}><Download className="size-4" /> Download</Button>;
  const selectedPhotos = photos.filter(p => selected.has(p.id));
  const allLabel = "Download all";
  const total = zipState ? zipState.requested.length : 0;

  const toolbar = photos.length > 0 && <div className="space-y-3 mb-4">
    <div className="flex flex-wrap gap-2 items-center">
      <Button size="sm" disabled={busy} onClick={() => downloadZip(photos)}><Download className="size-4" /> {allLabel} ({photos.length})</Button>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => setSelected(selectedPhotos.length === photos.length ? new Set() : new Set(photos.map(p => p.id)))}>{selectedPhotos.length === photos.length ? "Clear selection" : "Select all"}</Button>
      {selectedPhotos.length > 0 && <Button variant="outline" size="sm" disabled={busy} onClick={() => downloadZip(selectedPhotos)}><Download className="size-4" /> Download selected ({selectedPhotos.length})</Button>}
    </div>
    {busy && <p role="status" className="flex gap-2 items-center text-sm"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" />{progress}</p>}
    {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
    {zipState && !busy && <div className="rounded-lg border border-border/60 p-3 space-y-2">
      {zipState.failedPhotos.length > 0 && !zipState.zip && <>
        <p role="alert" className="text-sm font-medium text-destructive">
          Incomplete: {zipState.files.length} of {total} photos ready. {zipState.failedPhotos.length} could not be retrieved:
        </p>
        <ul className="text-xs text-destructive list-disc pl-5 space-y-0.5 [overflow-wrap:anywhere]">{zipState.failures.map(f => <li key={f}>{f}</li>)}</ul>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={retryMissing}><RotateCw className="size-4" /> Retry missing photos</Button>
          <Button size="sm" variant="outline" onClick={downloadIncomplete}><Download className="size-4" /> Download incomplete ZIP ({zipState.files.length} of {total})</Button>
          <Button size="icon" variant="ghost" aria-label="Dismiss" onClick={() => setZipState(null)}><X className="size-4" /></Button>
        </div>
      </>}
      {zipState.zip && <>
        <p role="status" className="text-sm [overflow-wrap:anywhere]">
          {zipState.started ? "Download started: " : "ZIP ready: "}<span className="font-medium">{zipState.filename}</span> — {zipState.files.length} of {total} photos
          {zipState.failedPhotos.length ? ` (incomplete — ${zipState.failedPhotos.length} missing)` : ""}.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={zipState.started ? "outline" : "default"} onClick={saveZip}><Download className="size-4" /> {zipState.started ? "Download ZIP again" : "Save ZIP"}</Button>
          {zipState.failedPhotos.length > 0 && <Button size="sm" variant="outline" onClick={retryMissing}><RotateCw className="size-4" /> Retry missing photos</Button>}
          <Button size="icon" variant="ghost" aria-label="Dismiss" onClick={() => setZipState(null)}><X className="size-4" /></Button>
        </div>
      </>}
    </div>}
  </div>;
  return { toolbar, singleButton, selected, toggle, busy };
}
