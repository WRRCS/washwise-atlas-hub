import { useEffect, useRef, useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sopDocumentKind } from "@/lib/sop-document";
import { sopContentIsCovered } from "@/lib/sop-content";

export function SopDocumentPreview({ url, filename, readableText = "", onCovered }: { url: string | null; filename: string; readableText?: string; onCovered?: () => void }) {
  const pages = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(100);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const kind = sopDocumentKind(filename);

  useEffect(() => {
    let disposed = false;
    const abort = new AbortController();
    let destroy: (() => void) | undefined;
    setLoading(true);
    setError(null);
    setZoom(100);
    const container = pages.current;
    container?.replaceChildren();
    async function load() {
      if (!url) throw new Error("This SOP file is unavailable. Close and reopen the SOP to try again, or contact the office.");
      if (kind === "unsupported") throw new Error("This document format cannot be previewed. Ask the office to save a PDF version. The original file is still available to download.");
      if (kind === "image") return;
      const response = await fetch(url, { signal: abort.signal });
      if (!response.ok) throw new Error("The SOP could not load. Close and reopen it to try again, or contact the office.");
      if (kind === "text") {
        const value = await response.text();
        if (sopContentIsCovered(value, readableText)) {
          if (!disposed) onCovered?.();
          return;
        }
        if (!disposed) setText(value);
        return;
      }
      const [pdfjs, worker] = await Promise.all([
        import("pdfjs-dist"),
        import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
      ]);
      if (disposed) return;
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const task = pdfjs.getDocument({ data: new Uint8Array(await response.arrayBuffer()) });
      destroy = () => { void task.destroy(); };
      const pdf = await task.promise;
      if (readableText.trim()) {
        const text: string[] = [];
        let hasUnrepresentedVisuals = false;
        for (let n = 1; n <= pdf.numPages; n++) {
          if (disposed) return;
          const page = await pdf.getPage(n);
          const [content, operators] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
          const pageText = content.items.flatMap((item) => "str" in item ? [item.str] : []).join(" ");
          // A scanned page or diagram may contain unique instructions not in extracted text.
          if (!pageText.trim() || operators.fnArray.some((op) => [pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.constructPath].includes(op))) hasUnrepresentedVisuals = true;
          text.push(pageText);
        }
        if (!hasUnrepresentedVisuals && sopContentIsCovered(text.join(" "), readableText)) {
          if (!disposed) onCovered?.();
          return;
        }
      }
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        if (disposed || !container) return;
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.className = "block w-full h-auto rounded border border-border";
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", `${filename}, page ${pageNumber} of ${pdf.numPages}`);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("The SOP preview could not display on this device.");
        await page.render({ canvasContext: context, viewport }).promise;
        if (disposed) return;
        container.append(canvas);
        if (pageNumber === 1) setLoading(false);
      }
    }
    load().then(() => { if (!disposed) setLoading(false); }).catch((e: unknown) => {
      if (!disposed) {
        setError(e instanceof Error ? e.message : "The SOP could not load. Please try again.");
        setLoading(false);
      }
    });
    return () => { disposed = true; abort.abort(); destroy?.(); container?.replaceChildren(); };
  }, [url, kind, filename, readableText, onCovered]);

  return (
    <section aria-label={`Preview of ${filename}`} className="min-w-0 space-y-3">
      {!error && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="icon" title="Zoom out" aria-label="Zoom out" disabled={zoom <= 75} onClick={() => setZoom((v) => Math.max(75, v - 25))}><Minus /></Button>
          <span className="w-12 text-center text-sm tabular-nums">{zoom}%</span>
          <Button variant="outline" size="icon" title="Zoom in" aria-label="Zoom in" disabled={zoom >= 250} onClick={() => setZoom((v) => Math.min(250, v + 25))}><Plus /></Button>
          <Button variant="ghost" size="icon" title="Fit to width" aria-label="Fit to width" onClick={() => setZoom(100)}><RotateCcw /></Button>
        </div>
      )}
      {loading && <p role="status" className="text-sm text-muted-foreground">Loading SOP document…</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="overflow-x-auto overscroll-contain">
        <div style={{ width: `${zoom}%` }} className="mx-auto space-y-3">
          <div ref={pages} className="space-y-3" />
          {kind === "text" && !error && <p className="whitespace-pre-wrap break-words text-base leading-relaxed">{text}</p>}
          {kind === "image" && url && !error && <img src={url} alt={filename} className="w-full h-auto" onError={() => setError("The SOP image could not load. Please reopen it or contact the office.")} />}
        </div>
      </div>
    </section>
  );
}