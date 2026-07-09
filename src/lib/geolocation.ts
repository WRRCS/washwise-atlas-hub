export type CapturedGps = {
  latitude: number;
  longitude: number;
  accuracy_meters: number | null;
};

export type GpsResult =
  | { status: "ok"; gps: CapturedGps }
  | { status: "unsupported" }
  | { status: "denied" }
  | { status: "error"; message: string };

export function captureGps(timeoutMs = 10000): Promise<GpsResult> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ status: "unsupported" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          status: "ok",
          gps: {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy_meters: pos.coords.accuracy ?? null,
          },
        }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) resolve({ status: "denied" });
        else resolve({ status: "error", message: err.message });
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

// Approx meters between two lat/lng points (Haversine).
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
