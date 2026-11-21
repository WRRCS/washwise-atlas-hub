import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPublicInvoicePhotos, previewPublicInvoicePhotos, type InvoicePhoto } from "@/lib/invoice-checkout.functions";

export const Route = createFileRoute("/pay_/$invoiceId/photos")({
  validateSearch: (search: Record<string, unknown>): { preview?: boolean; k?: string } => ({
    preview: search.preview === true || search.preview === 1 || search.preview === "1" ? true : undefined,
    k: typeof search.k === "string" && search.k ? search.k : undefined,
  }),
  component: InvoicePhotosPage,
  ssr: false,
  head: () => ({
    meta: [
      { title: "Service photos — Wash Rinse Repeat Cleaning" },
      { name: "description", content: "Photos from your Wash Rinse Repeat Cleaning service." },
      { property: "og:title", content: "Service photos — Wash Rinse Repeat Cleaning" },
      { property: "og:description", content: "Photos from your Wash Rinse Repeat Cleaning service." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  errorComponent: ({ error }) => <div className="p-8 text-sm text-destructive">{(error as Error).message}</div>,
});

const TYPE_LABEL: Record<string, string> = { before: "Before", after: "After", damage: "Damage", other: "" };

function InvoicePhotosPage() {
  const { invoiceId } = Route.useParams();
  const { preview, k } = Route.useSearch();
  const getFn = useServerFn(getPublicInvoicePhotos);
  const previewFn = useServerFn(previewPublicInvoicePhotos);
  const { data, isLoading } = useQuery({
    queryKey: ["public-invoice-photos", invoiceId, !!preview, k ?? ""],
    queryFn: () => (preview ? previewFn({ data: { id: invoiceId } }) : getFn({ data: { id: invoiceId, k: k ?? "" } })),
    staleTime: 30 * 60_000,
  });

  const back = (
    <Link to="/pay/$invoiceId" params={{ invoiceId }} search={preview ? { preview: true } : { k }} className="text-sm font-medium underline underline-offset-4">
      ← Back to invoice
    </Link>
  );

  if (isLoading) return <div className="p-8 text-sm text-muted-foreground">Loading photos…</div>;
  if (!data || "error" in data) return <div className="max-w-md mx-auto p-8 space-y-4"><p className="text-sm text-destructive">{(data as { error: string })?.error ?? "Photos not found"}</p>{back}</div>;

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="max-w-3xl mx-auto p-4 sm:p-8">
        <div className="mb-4">{back}</div>
        <h1 className="text-xl font-semibold mb-1">Photos from your service</h1>
        <p className="text-sm text-muted-foreground mb-5">
          {data.number ? `Invoice ${data.number} · ` : ""}{data.photos.length === 1 ? "1 photo" : `${data.photos.length} photos`} · Tap a photo to see it full size.
        </p>
        {data.photos.length === 0 ? (
          <p className="text-sm text-muted-foreground">No photos are attached to this invoice.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {data.photos.map((p, i) => <PhotoTile key={i} photo={p} index={i} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function PhotoTile({ photo, index }: { photo: InvoicePhoto; index: number }) {
  const label = TYPE_LABEL[photo.photo_type] ?? "";
  return (
    <a href={photo.url} target="_blank" rel="noreferrer" className="relative block rounded-md overflow-hidden bg-muted ring-1 ring-black/5">
      {photo.thumb_url ? (
        <img src={photo.thumb_url} alt={photo.caption ?? `Service photo ${index + 1}`} loading="lazy" decoding="async" className="aspect-square w-full object-cover" />
      ) : (
        <span className="aspect-square w-full flex items-center justify-center text-sm font-medium text-muted-foreground">Open photo {index + 1}</span>
      )}
      {label && <span className="absolute left-1.5 top-1.5 rounded bg-background/90 px-1.5 py-0.5 text-[11px] font-medium">{label}</span>}
    </a>
  );
}
