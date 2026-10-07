import { createFileRoute } from "@tanstack/react-router";
import { getSharedPhotos } from "@/lib/photo-share.functions";

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
  if (!data) {
    return (
      <main className="min-h-screen grid place-items-center p-6 text-center">
        <p className="text-muted-foreground">This photo link has expired or doesn't exist.</p>
      </main>
    );
  }
  return (
    <main className="max-w-5xl mx-auto p-4 sm:p-8 space-y-4">
      <header>
        {data.business && <p className="text-xs uppercase tracking-wider text-muted-foreground">{data.business}</p>}
        <h1 className="text-xl font-semibold">{data.title}</h1>
        <p className="text-sm text-muted-foreground">{data.photos.length} photo{data.photos.length === 1 ? "" : "s"} · tap a photo to open full size</p>
      </header>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {data.photos.map((p) => (
          <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="block space-y-1">
            <img src={p.url} alt={p.caption ?? ""} className="aspect-square w-full object-cover rounded-lg" />
            {p.caption && <p className="text-xs text-muted-foreground">{p.caption}</p>}
          </a>
        ))}
      </div>
    </main>
  );
}
