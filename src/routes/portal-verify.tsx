import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { verifyPortalLink } from "@/lib/portal.functions";

export const Route = createFileRoute("/portal-verify")({
  component: PortalVerifyPage,
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
});

function PortalVerifyPage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const verifyFn = useServerFn(verifyPortalLink);
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) {
      setError("Missing sign-in token.");
      return;
    }
    (async () => {
      try {
        const result = await verifyFn({ data: { token } });
        localStorage.setItem("portal_session", result.session_token);
        localStorage.setItem("portal_client_name", result.client_name);
        navigate({ to: "/portal", replace: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : "This link is invalid or has expired.");
      }
    })();
  }, [token]);

  return (
    <div className="min-h-screen bg-clay-50 grid place-items-center px-4">
      <div className="w-full max-w-sm bg-card rounded-xl ring-1 ring-black/5 p-6 text-center">
        {error ? (
          <>
            <p className="text-sm text-destructive">{error}</p>
            <a href="/portal-login" className="text-sm text-brand hover:underline mt-3 inline-block">Request a new link</a>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Signing you in…</p>
        )}
      </div>
    </div>
  );
}
