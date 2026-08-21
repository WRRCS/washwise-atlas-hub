import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 1.6;

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Scrollable + pinch-zoomable surface for wide content (e.g. the week grid).
 * Drag with a finger to pan, pinch to zoom, or use the on-screen controls.
 */
export function ZoomPanSurface({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const isMobile = useIsMobile();
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Fit the content to the viewport width the first time we know the form factor.
  useEffect(() => {
    if (initialized) return;
    const el = containerRef.current;
    if (!el) return;
    const inner = el.firstElementChild as HTMLElement | null;
    if (!inner) return;
    const needed = inner.scrollWidth;
    const available = el.clientWidth;
    if (needed > 0 && available > 0 && needed > available) {
      setZoom(clamp(available / needed, MIN_ZOOM, 1));
    }
    setInitialized(true);
  }, [initialized, isMobile]);

  const applyZoom = useCallback((next: number, anchorX?: number, anchorY?: number) => {
    const el = containerRef.current;
    const prev = zoomRef.current;
    const clamped = clamp(next, MIN_ZOOM, MAX_ZOOM);
    if (clamped === prev) return;
    const k = clamped / prev;
    if (el) {
      const rect = el.getBoundingClientRect();
      const px = (anchorX ?? rect.width / 2 + rect.left) - rect.left;
      const py = (anchorY ?? rect.height / 2 + rect.top) - rect.top;
      const sx = el.scrollLeft;
      const sy = el.scrollTop;
      requestAnimationFrame(() => {
        el.scrollLeft = (sx + px) * k - px;
        el.scrollTop = (sy + py) * k - py;
      });
    }
    zoomRef.current = clamped;
    setZoom(clamped);
  }, []);

  const applyZoomRef = useRef(applyZoom);
  useEffect(() => {
    applyZoomRef.current = applyZoom;
  }, [applyZoom]);

  // Trackpad pinch / ctrl+wheel zoom (non-passive so we can preventDefault).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      applyZoomRef.current(zoomRef.current * Math.exp(-dy * 0.0018), e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Two-finger pinch on touch screens.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const pts = new Map<number, { x: number; y: number }>();
    let startDist = 0;
    let startZoom = 1;

    const dist = () => {
      const [a, b] = [...pts.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const center = () => {
      const [a, b] = [...pts.values()];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        startDist = dist();
        startZoom = zoomRef.current;
      }
    };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && startDist > 0) {
        e.preventDefault();
        const c = center();
        applyZoomRef.current((startZoom * dist()) / startDist, c.x, c.y);
      }
    };
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) startDist = 0;
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move, { passive: false });
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("pointerleave", up);
    };
  }, []);

  return (
    <div className={`relative ${className}`}>
      <div
        ref={containerRef}
        className="overflow-auto overscroll-x-contain rounded-xl ring-1 ring-black/10 bg-card"
        style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-x pan-y" }}
      >
        <div style={{ zoom, width: "max-content", minWidth: "100%" }}>{children}</div>
      </div>

      <div className="mt-2 flex items-center justify-end gap-1.5">
        <span className="text-[11px] text-muted-foreground mr-1 tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => applyZoom(zoomRef.current / 1.2)}
          className="size-8 grid place-items-center rounded-lg border border-border/60 bg-card hover:bg-clay-100"
        >
          <Minus className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => applyZoom(zoomRef.current * 1.2)}
          className="size-8 grid place-items-center rounded-lg border border-border/60 bg-card hover:bg-clay-100"
        >
          <Plus className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Reset zoom"
          onClick={() => applyZoom(1)}
          className="size-8 grid place-items-center rounded-lg border border-border/60 bg-card hover:bg-clay-100"
        >
          <RotateCcw className="size-4" />
        </button>
      </div>
    </div>
  );
}
