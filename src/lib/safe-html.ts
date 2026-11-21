import DOMPurify from "dompurify";

/** Strip scripts, event handlers and unsafe URLs from saved template HTML before showing it in the app. */
export function safeHtml(html: string | null | undefined): string {
  if (!html) return "";
  if (!DOMPurify.isSupported) return "";
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ["style", "form", "input", "button", "iframe"] });
}
