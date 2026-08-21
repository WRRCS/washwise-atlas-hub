import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/** Thin banner shown when the device loses connectivity. Cached data stays readable. */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 bg-amber-500 text-black text-xs font-medium px-4 py-2 flex items-center justify-center gap-2">
      <WifiOff className="size-3.5" />
      Offline — showing your last synced schedule. Changes will send when you reconnect.
    </div>
  );
}
