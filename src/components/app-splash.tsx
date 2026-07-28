import { useEffect, useState } from "react";
import logo from "@/assets/wrrcs-logo.png.asset.json";

/**
 * In-app splash overlay. Renders on first paint and fades out once the
 * app has hydrated, giving a smooth handoff from the native OS splash
 * (iOS apple-touch-startup-image / Android manifest splash) to the app UI.
 *
 * Only shown when launched as an installed PWA (display-mode: standalone)
 * to avoid a flash on regular browser tabs.
 */
export function AppSplash() {
  const [visible, setVisible] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        // iOS Safari legacy flag
        // @ts-expect-error non-standard
        window.navigator.standalone === true;
      return standalone;
    } catch {
      return false;
    }
  });
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    // Give React a beat to paint the first authenticated screen, then fade.
    const fadeTimer = window.setTimeout(() => setFading(true), 350);
    const removeTimer = window.setTimeout(() => setVisible(false), 900);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(removeTimer);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      aria-hidden
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-white transition-opacity duration-500 ease-out"
      style={{ opacity: fading ? 0 : 1, pointerEvents: fading ? "none" : "auto" }}
    >
      <div className="flex flex-col items-center gap-6">
        <img
          src={logo.url}
          alt=""
          className="h-32 w-32 object-contain animate-in fade-in zoom-in-95 duration-500"
        />
        <div className="h-1 w-24 overflow-hidden rounded-full bg-neutral-200">
          <div className="h-full w-1/2 animate-[splash-bar_1.2s_ease-in-out_infinite] rounded-full bg-brand-accent" />
        </div>
      </div>
      <style>{`
        @keyframes splash-bar {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
      `}</style>
    </div>
  );
}
