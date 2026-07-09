import { useEffect, useState } from "react";
import { ClientOnly } from "@tanstack/react-router";
import type { JobGpsEntry } from "@/lib/time.functions";
import { distanceMeters } from "@/lib/geolocation";

// Leaflet CSS + default marker icon fix loaded lazily on the client.
async function ensureLeaflet() {
  // @ts-ignore side-effect CSS
  await import("leaflet/dist/leaflet.css");
  const L = await import("leaflet");
  // Fix marker icons under bundlers
  // @ts-ignore
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });
  return L;
}

type Props = { entries: JobGpsEntry[] };

function LeafletMap({ entries }: Props) {
  const [ready, setReady] = useState<any>(null);
  const [rl, setRl] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const L = await ensureLeaflet();
      const mod = await import("react-leaflet");
      setReady(L);
      setRl(mod);
    })();
  }, []);

  const points = entries.flatMap((e) => {
    const p: { kind: "in" | "out"; lat: number; lng: number; acc: number | null; label: string }[] = [];
    if (e.clock_in_latitude !== null && e.clock_in_longitude !== null) {
      p.push({
        kind: "in",
        lat: e.clock_in_latitude,
        lng: e.clock_in_longitude,
        acc: e.clock_in_accuracy_meters,
        label: `${e.employee_name ?? "Employee"} · clock-in`,
      });
    }
    if (e.clock_out_latitude !== null && e.clock_out_longitude !== null) {
      p.push({
        kind: "out",
        lat: e.clock_out_latitude,
        lng: e.clock_out_longitude,
        acc: e.clock_out_accuracy_meters,
        label: `${e.employee_name ?? "Employee"} · clock-out`,
      });
    }
    return p;
  });

  if (!points.length) return <p className="text-sm text-muted-foreground">No GPS coordinates recorded for this job.</p>;
  if (!ready || !rl) return <div className="h-64 rounded-lg bg-clay-100 grid place-items-center text-xs text-muted-foreground">Loading map…</div>;

  const { MapContainer, TileLayer, Marker, Popup, Circle } = rl;
  const center: [number, number] = [
    points.reduce((s, p) => s + p.lat, 0) / points.length,
    points.reduce((s, p) => s + p.lng, 0) / points.length,
  ];

  return (
    <div>
      <div className="h-64 rounded-lg overflow-hidden ring-1 ring-black/5">
        <MapContainer center={center} zoom={16} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {points.map((p, i) => (
            <Marker key={`m-${i}`} position={[p.lat, p.lng]}>
              <Popup>{p.label}</Popup>
            </Marker>
          ))}
          {points.map((p, i) =>
            p.acc ? (
              <Circle
                key={`c-${i}`}
                center={[p.lat, p.lng]}
                radius={p.acc}
                pathOptions={{ color: p.kind === "in" ? "#059669" : "#ea580c", weight: 1, fillOpacity: 0.1 }}
              />
            ) : null,
          )}
        </MapContainer>
      </div>
      <ul className="mt-3 text-xs text-muted-foreground space-y-1">
        {entries.map((e) => {
          const hasBoth =
            e.clock_in_latitude !== null && e.clock_out_latitude !== null &&
            e.clock_in_longitude !== null && e.clock_out_longitude !== null;
          const dist = hasBoth
            ? distanceMeters(
                { lat: e.clock_in_latitude!, lng: e.clock_in_longitude! },
                { lat: e.clock_out_latitude!, lng: e.clock_out_longitude! },
              )
            : null;
          return (
            <li key={e.id}>
              <span className="font-medium text-foreground">{e.employee_name ?? "Employee"}</span>
              {e.clock_in_accuracy_meters !== null && <> · in ±{Math.round(e.clock_in_accuracy_meters)}m</>}
              {e.clock_out_accuracy_meters !== null && <> · out ±{Math.round(e.clock_out_accuracy_meters)}m</>}
              {dist !== null && <> · drift {dist < 1000 ? `${Math.round(dist)}m` : `${(dist / 1000).toFixed(2)}km`}</>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function JobGpsMap(props: Props) {
  return (
    <ClientOnly fallback={<div className="h-64 rounded-lg bg-clay-100" />}>
      <LeafletMap {...props} />
    </ClientOnly>
  );
}
