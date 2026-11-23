import { useEffect, useState } from "react";
import { ImageIcon } from "lucide-react";
import { makeLocalThumbnail } from "@/lib/local-photo-thumb";

/** Preview of a photo still on the phone, shown from a small copy so many photos never exhaust phone memory. */
export function LocalPhotoThumb({ file, photoKey, className, dimmed }: { file: Blob; photoKey?: string; className?: string; dimmed?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let made: string | null = null;
    void makeLocalThumbnail(file, () => cancelled, undefined, photoKey).then((u) => {
      if (cancelled) { if (u) URL.revokeObjectURL(u); return; }
      made = u;
      setUrl(u);
    });
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
      setUrl(null);
    };
  }, [file, photoKey]);
  if (!url) {
    return (
      <div className={`${className ?? ""} grid place-items-center bg-clay-200 text-muted-foreground`} aria-hidden>
        <ImageIcon className="size-5" />
      </div>
    );
  }
  return <img src={url} alt="" decoding="async" className={`${className ?? ""} ${dimmed ?? ""}`} />;
}
