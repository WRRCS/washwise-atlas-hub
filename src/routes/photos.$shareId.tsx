import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, Loader2, X } from "lucide-react";
import { getSharedPhotos } from "@/lib/photo-share.functions";
import {
  preparePhotoExport,
  buildPhotoZip,
  triggerDownload,
  deliverPhotoFile,
  zipFilename,
  type DownloadPhoto,
} from "@/lib/photo-downloads";

export const Route = createFileRoute("/photos/$shareId")({
  loader: ({ params }) => getSharedPhotos({ data: { id: params.shareId } }),
  head: () => ({
    meta: [
      { title: "Job photos — Wash Rinse Repeat Cleaning" },
      { name: "description", content: "Photos shared from a Wash Rinse Repeat Cleaning visit." },
      { property: "og:title", content: "Job photos — Wash Rinse Repeat Cleaning" },
      { property: "og:description", content: "Photos shared from a Wash Rinse Repeat Cleaning visit." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SharedPhotosPage,
});

function SharedPhotosPage() {
  const data = Route.useLoaderData();
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const context = useMemo(() => {
    const title = data?.title ?? "";
    const [, property = "photos", date = ""] = title.split(" · ");
    return { property, date: date.replace(/\s/g, "-") };
  }, [data]);

  if (!data) {
    return (
      <main className="min-h-screen grid place-items-center p-6 text-center">
        <p className="text-muted-foreground">This photo link has been revoked or doesn't exist.</p>
      </main>
    );
  }

  const toDownloadPhoto = (p: (typeof data.photos)[number]): DownloadPhoto => ({
    id: p.id,
    storage_path: "",
    url: p.url,
    uploaded_by: null,
    uploader_name: p.uploader_name,
  });

  const downloadOne = async (p: (typeof data.photos)[number]) => {
    setError(null);
    setProgress("Preparing photo…");
    try {
      const { files } = await preparePhotoExport([toDownloadPhoto(p)], context, {});
      await deliverPhotoFile(files[0].blob, files[0].filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setProgress(null);
    }
  };

  const downloadAll = async () => {
    setError(null);
    try {
      const { files, failures } = await preparePhotoExport(data.photos.map(toDownloadPhoto), context, {
        onProgress: (done, total) => setProgress(`Preparing ${done} of ${total}…`),
      });
      triggerDownload(await buildPhotoZip(files), zipFilename(context));
      if (failures.length) setError(`Some photos could not be included: ${failures.join("; ")}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setProgress(null);
    }
  };

  const groups = new Map<string, typeof data.photos>();
  for (const p of data.photos) {
    if (!groups.has(p.uploader_name)) groups.set(p.uploader_name, []);
    groups.get(p.uploader_name)!.push(p);
  }

  return (
    <main className="max-w-5xl mx-auto p-4 sm:p-8 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {data.business && <p className="text-xs uppercase tracking-wider text-muted-foreground">{data.business}</p>}
          <h1 className="text-xl font-semibold">{data.title}</h1>
          <p className="text-sm text-muted-foreground">
            {data.photos.length} photo{data.photos.length === 1 ? "" : "s"} · tap a photo to view full size
          </p>
        </div>
        <button
          type="button"
          onClick={downloadAll}
          disabled={!!progress}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:opacity-90 disabled:opacity-50"
        >
          {progress ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          {progress ?? `Download all (${data.photos.length})`}
        </button>
      </header>
      <p className="text-xs text-muted-foreground">
        "Download all" saves one ZIP file — extract it to get the individual photos.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {[...groups.entries()].map(([name, photos]) => (
        <section key={name} className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">{name}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {photos.map((p) => (
              <div key={p.id} className="space-y-1">
                <button type="button" onClick={() => setLightbox(p.id)} className="block w-full">
                  <img src={p.url} alt={p.caption ?? ""} className="aspect-square w-full object-cover rounded-lg" />
                </button>
                <div className="flex items-center justify-between gap-1">
                  {p.caption ? <p className="text-xs text-muted-foreground truncate">{p.caption}</p> : <span />}
                  <button
                    type="button"
                    onClick={() => downloadOne(p)}
                    disabled={!!progress}
                    className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline disabled:opacity-50"
                  >
                    <Download className="size-3" /> Download
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {lightbox && (() => {
        const p = data.photos.find((x) => x.id === lightbox);
        if (!p) return null;
        return (
          <div
            className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4"
            onClick={() => setLightbox(null)}
          >
            <div className="flex gap-2 mb-2" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => downloadOne(p)}
                className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20"
              >
                <Download className="size-4" /> Download
              </button>
              <button
                type="button"
                onClick={() => setLightbox(null)}
                className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20"
              >
                <X className="size-4" /> Close
              </button>
            </div>
            <img src={p.url} alt={p.caption ?? ""} className="max-h-[80vh] max-w-full object-contain rounded-lg" />
          </div>
        );
      })()}
    </main>
  );
}
