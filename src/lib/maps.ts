/**
 * Shared native-maps helpers. Reused by the "Up next" hero (my-jobs) and the
 * staff job detail view so both open the employee's phone-native maps app.
 */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const platform = (navigator as any).platform || "";
  const iOSPlatforms = /iPhone|iPad|iPod/;
  return (
    iOSPlatforms.test(ua) ||
    iOSPlatforms.test(platform) ||
    (platform === "MacIntel" && (navigator as any).maxTouchPoints > 1)
  );
}

export function directionsUrl(address: string): string {
  const q = encodeURIComponent(address);
  return isIOS()
    ? `https://maps.apple.com/?daddr=${q}`
    : `https://www.google.com/maps/dir/?api=1&destination=${q}`;
}
