import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { requestPortalLink } from "@/lib/portal.functions";

export const Route = createFileRoute("/portal-login")({
  component: PortalLoginPage,
  ssr: false,
  head: () => ({
    meta: [
      { title: "Client portal sign in — Wash Rinse Repeat Cleaning" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function PortalLoginPage() {
  const requestFn = useServerFn(requestPortalLink);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestFn({ data: { email } });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-clay-50 grid place-items-center px-4">
      <div className="w-full max-w-sm bg-card rounded-xl ring-1 ring-black/5 p-6">
        <p className="text-xs uppercase tracking-widest text-muted-foreground text-center">Wash Rinse Repeat Cleaning</p>
        <h1 className="text-xl font-medium mt-2 text-center">Client portal</h1>
        {sent ? (
          <p className="text-sm text-muted-foreground mt-6 text-center">
            If that email is on file, a sign-in link is on its way — check your inbox (and spam folder). The link is valid for 30 minutes.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-3">
            <label className="block">
              <span className="text-sm font-medium">Your email</span>
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                placeholder="you@example.com"
              />
            </label>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button
              type="submit"
              disabled={busy || !email}
              className="w-full bg-brand text-brand-foreground text-sm font-medium rounded-lg px-3 py-2 hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Sending…" : "Email me a sign-in link"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
