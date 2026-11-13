/**
 * The app's own address and the card-payment link that goes into client emails.
 *
 * The pay page is public at `/pay/<invoice id>`, so the link must point at the
 * app itself — never at the marketing website saved on the business profile.
 */

/** Used when the request's own address can't be read (background work, tests). */
export const FALLBACK_APP_ORIGIN = "https://wrrcs.com";

/** Keep only a bare `https://host` — no path, no query, no trailing slash. */
export function normalizeAppOrigin(raw: string | null | undefined): string {
  const value = (raw ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[^/\s]+$/.test(value) ? value : "";
}

/** Public card-payment page for one invoice. */
export function invoicePayUrl(origin: string | null | undefined, invoiceId: string): string {
  const base = normalizeAppOrigin(origin) || FALLBACK_APP_ORIGIN;
  return `${base}/pay/${invoiceId}`;
}
