import { Fragment } from "react";
import { useT } from "@/lib/i18n";

const URL_RE = /(https:\/\/[^\s]+)/g;

/** Renders plain text with https:// links made tappable (opens in a new tab / the Maps app on phones). */
export function LinkifiedText({ text }: { text: string }) {
  const t = useT();
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline underline-offset-2">
            {part.includes("google.com/maps") ? t("Open in Maps") : part}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
