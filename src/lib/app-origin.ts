/** True only for URLs on this app's own hosts, so redirects and server-side requests cannot be pointed elsewhere. */
// Only this app's own addresses: the custom domain, its published/preview hosts, and local dev.
const APP_EXACT_HOSTS = ["wrrcs.com", "www.wrrcs.com", "washwise-atlas-hub.lovable.app", "localhost"];
const APP_PROJECT_ID = "d344868a-ce88-407a-a141-0f3d42ef0e99";
export function isAppUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.username || u.password) return false;
    if (u.protocol !== "https:" && !(u.protocol === "http:" && u.hostname === "localhost")) return false;
    if (APP_EXACT_HOSTS.includes(u.hostname)) return true;
    // Preview hosts carry this project's id, e.g. id-preview--<id>.lovable.app or <id>.lovableproject.com.
    const [first = "", ...rest] = u.hostname.split(".");
    const parent = rest.join(".");
    return (parent === "lovable.app" || parent === "lovableproject.com") && (first === APP_PROJECT_ID || first.endsWith(`--${APP_PROJECT_ID}`));
  } catch {
    return false;
  }
}
