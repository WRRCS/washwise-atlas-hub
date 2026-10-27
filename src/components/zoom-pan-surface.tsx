import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Scrollable surface for wide content (e.g. the week grid).
 * Content always remains at its natural 100% size.
 */
export function ZoomPanSurface({
  children,
  className = "",
  scrollClassName = "",
}: {
  children: React.ReactNode;
  className?: string;
  scrollClassName?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({ overflow: false, left: false, right: false });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => {
      const remaining = container.scrollWidth - container.clientWidth;
      setScrollState({ overflow: remaining > 1, left: container.scrollLeft > 1, right: container.scrollLeft < remaining - 1 });
    };
    const observer = new ResizeObserver(update);
    observer.observe(container);
    if (container.firstElementChild) observer.observe(container.firstElementChild);
    container.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      container.removeEventListener("scroll", update);
    };
  }, []);

  const scrollDays = (direction: number) => {
    const container = containerRef.current;
    if (!container) return;
    const employeeColumn = container.querySelector(".schedule-row > :first-child")?.getBoundingClientRect().width ?? 0;
    container.scrollBy({ left: direction * Math.max(100, container.clientWidth - employeeColumn), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };

  useEffect(() => {
    try {
      window.localStorage.removeItem("schedule-zoom");
    } catch {
      /* storage unavailable */
    }
  }, []);

  return (
    <div className={`relative min-w-0 max-w-full ${className}`}>
      {scrollState.overflow && (
        <div className="schedule-scroll-controls items-center justify-end gap-2 pb-2">
          <Button type="button" variant="outline" size="icon" aria-label="Scroll schedule left" title="Scroll schedule left" disabled={!scrollState.left} onClick={() => scrollDays(-1)}><ChevronLeft className="size-4" /></Button>
          <Button type="button" variant="outline" size="icon" aria-label="Scroll schedule right" title="Scroll schedule right" disabled={!scrollState.right} onClick={() => scrollDays(1)}><ChevronRight className="size-4" /></Button>
        </div>
      )}
      <div
        ref={containerRef}
        className={`overflow-auto overscroll-x-contain rounded-xl ring-1 ring-black/10 bg-card ${scrollClassName}`}
        style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-x pan-y" }}
      >
        <div className="w-full min-w-0">{children}</div>
      </div>
    </div>
  );
}
