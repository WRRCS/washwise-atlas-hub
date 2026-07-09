// Sentry server-side capture.
// Inert unless SENTRY_DSN env var is set. Called from server functions / routes.
// Uses dynamic import so the SDK is only loaded when a DSN is configured.

let initialized: Promise<any> | null = null;

async function ensureInit(): Promise<any> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return null;
  if (initialized) return initialized;
  initialized = (async () => {
    const Sentry = await import("@sentry/react");
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? "production",
      tracesSampleRate: 0.1,
    });
    return Sentry;
  })();
  return initialized;
}

export async function captureServerError(err: unknown, context?: Record<string, unknown>): Promise<void> {
  const Sentry = await ensureInit();
  if (!Sentry) return;
  try {
    Sentry.captureException(err, { extra: context });
  } catch {
    // never let telemetry break a request
  }
}
