// Sentry client-side initialization.
// Stays completely inert unless VITE_SENTRY_DSN is set — safe to ship as-is.
// To activate: add a VITE_SENTRY_DSN env var (paste from your Sentry project).
import * as Sentry from "@sentry/react";

let initialized = false;

export function initSentryClient(): void {
  if (initialized) return;
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // Reasonable defaults; tune as needed.
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
  });
  initialized = true;
}

export function captureClientError(err: unknown, context?: Record<string, unknown>): void {
  if (!import.meta.env.VITE_SENTRY_DSN) return;
  Sentry.captureException(err, { extra: context });
}
