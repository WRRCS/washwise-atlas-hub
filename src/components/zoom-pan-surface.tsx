import { useEffect, useRef } from "react";

/**
 * Scrollable surface for wide content (e.g. the week grid).
 * Content always remains at its natural 100% size.
 */
export function ZoomPanSurface({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      window.localStorage.removeItem("schedule-zoom");
    } catch {
      /* storage unavailable */
    }
  }, []);

  return (
    <div className={`relative ${className}`}>
      <div
        ref={containerRef}
        className="overflow-auto overscroll-x-contain rounded-xl ring-1 ring-black/10 bg-card"
        style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-x pan-y" }}
      >
        <div className="min-w-full w-max">{children}</div>
      </div>
    </div>
  );
}
