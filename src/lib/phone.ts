// Shared phone-number normalization. clients.phone is free-text
// (e.g. "(555) 555-0100", "555-0100", "+15555550100"), but Twilio's
// webhooks and REST API always use E.164 (+15555550100). Every place that
// compares or sends a phone number to Twilio must go through this first,
// or client matching / outbound sends will silently fail.
//
// Pure function, no I/O — safe to import from client or server code.
export function normalizePhoneE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.trim().startsWith("+")) return `+${digits}`;
  // Fallback: assume US number missing formatting, or an already-international
  // number without a leading '+'. Best effort — don't silently drop it.
  return `+${digits}`;
}

export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizePhoneE164(a);
  const nb = normalizePhoneE164(b);
  return !!na && !!nb && na === nb;
}
