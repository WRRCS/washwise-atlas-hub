/** Owner email alerts for incoming requests and messages (pure helpers, safe for tests). */
export type InboxAlertKind =
  | "time_off"
  | "time_off_reply"
  | "shift_swap"
  | "client_message"
  | "client_request"
  | "employee_message";

export const INBOX_ALERT_TITLES: Record<InboxAlertKind, string> = {
  time_off: "Time off request",
  time_off_reply: "Time off request — employee answer",
  shift_swap: "Shift swap request",
  client_message: "Client message",
  client_request: "Client request",
  employee_message: "Employee message",
};

/** Cyrillic text (Ukrainian) gets translated into English before emailing. */
export function needsEnglishTranslation(text: string | null | undefined): boolean {
  return /[\u0400-\u04FF]/.test(text ?? "");
}

export function inboxAlertSubject(kind: InboxAlertKind, from: string): string {
  return `${INBOX_ALERT_TITLES[kind]} — ${from.trim() || "Unknown sender"}`;
}

const TZ = "America/Los_Angeles";

/** e.g. "Saturday, November 14, 2026 at 9:33 PM PST" */
export function formatReceivedAt(iso: string): string {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(d);
  return `${date} at ${time}`;
}

/** Calendar dates (YYYY-MM-DD) shown as "Monday, November 17, 2026", ranges joined with "through". */
export function formatDateRange(start: string, end: string): string {
  const fmt = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
  };
  if (start === end) return `${fmt(start)} (1 day)`;
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
  return `${fmt(start)} through ${fmt(end)} (${days} days)`;
}

export type InboxAlertInput = {
  kind: InboxAlertKind;
  from: string;
  receivedAt: string;
  details?: Array<[label: string, value: string]>;
  message: string;
  messageLabel?: string;
  translation?: string | null;
  translationFailed?: boolean;
  link: string;
  linkLabel: string;
};

export function inboxAlertText(a: InboxAlertInput): string {
  const lines = [INBOX_ALERT_TITLES[a.kind], "", `From: ${a.from}`, `Received: ${formatReceivedAt(a.receivedAt)}`];
  for (const [label, value] of a.details ?? []) lines.push(`${label}: ${value}`);
  lines.push("");
  const label = a.messageLabel ?? "Message";
  if (a.translation) {
    lines.push(`${label} (translated from Ukrainian):`, a.translation, "", "Original:", a.message);
  } else {
    lines.push(`${label}:`, a.message);
    if (a.translationFailed) lines.push("", "(This message looks like Ukrainian, but the English translation could not be made.)");
  }
  lines.push("", `${a.linkLabel}: ${a.link}`);
  return lines.join("\n");
}
