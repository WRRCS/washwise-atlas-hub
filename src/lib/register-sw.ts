// Guarded service worker registration wrapper.
// Registers /sw.js only in production non-preview contexts. In dev/preview/iframe or ?sw=off,
// it unregisters any existing /sw.js so stale workers don't survive.
// Leaves /push-sw.js (web push messaging worker) untouched.

const APP_SW_PATH = "/sw.js";

function isRefusedContext(): boolean {
  if (!import.meta.env.PROD) return true;
  if (typeof window === "undefined") return true;
  try {
    if (window.top !== window.self) return true;
  } catch {
    return true;
  }
  const host = window.location.hostname;
  if (host.startsWith("id-preview--") || host.startsWith("preview--")) return true;
  if (host === "lovableproject.com" || host.endsWith(".lovableproject.com")) return true;
  if (host === "lovableproject-dev.com" || host.endsWith(".lovableproject-dev.com")) return true;
  if (host === "beta.lovable.dev" || host.endsWith(".beta.lovable.dev")) return true;
  if (new URLSearchParams(window.location.search).get("sw") === "off") return true;
  return false;
}

async function unregisterAppSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.allSettled(
      regs
        .filter((r) => {
          const url = r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || "";
          return url.endsWith(APP_SW_PATH);
        })
        .map((r) => r.unregister()),
    );
  } catch {
    /* ignore */
  }
}

export async function registerAppSW() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (isRefusedContext()) {
    await unregisterAppSW();
    return;
  }
  try {
    await navigator.serviceWorker.register(APP_SW_PATH, { scope: "/" });
  } catch {
    /* ignore */
  }
}
