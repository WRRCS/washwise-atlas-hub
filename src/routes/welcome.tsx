import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import wrrcLogo from "@/assets/wrrcs-logo.png.asset.json";
import { STAFF_HOME_PATH, welcomeLinkProblem } from "@/lib/staff-invite";

type WelcomeSearch = { token_hash?: string; type?: string };

export const Route = createFileRoute("/welcome")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Welcome to WRRCS" },
      { name: "description", content: "Signing you in to the WRRCS team app from your emailed link." },
      { property: "og:title", content: "Welcome to WRRCS" },
      { property: "og:description", content: "Signing you in to the WRRCS team app from your emailed link." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): WelcomeSearch => ({
    token_hash: typeof s.token_hash === "string" ? s.token_hash : undefined,
    type: typeof s.type === "string" ? s.type : undefined,
  }),
  component: WelcomePage,
});

type View =
  | { kind: "working" }
  | { kind: "problem"; reason: "expired" | "revoked" }
  | { kind: "request" }
  | { kind: "emailed"; email: string };

function WelcomePage() {
  const navigate = useNavigate();
  const { token_hash } = Route.useSearch();
  const [view, setView] = useState<View>({ kind: "working" });
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const goHome = () => navigate({ to: STAFF_HOME_PATH, replace: true });
    (async () => {
      if (token_hash) {
        // Redeem the single-use link here, in the employee's own browser.
        const { data, error: verifyError } = await supabase.auth.verifyOtp({ token_hash, type: "email" });
        if (!verifyError && data.session) return goHome();
        setView({ kind: "problem", reason: welcomeLinkProblem(verifyError?.message) });
        return;
      }
      // Links from the "email me a sign-in link" request return here too.
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const { data } = await supabase.auth.getSession();
      if (data.session) return goHome();
      if (hash.get("error") || hash.get("error_code")) {
        setView({ kind: "problem", reason: welcomeLinkProblem(hash.get("error_description")) });
        return;
      }
      setView({ kind: "request" });
    })();
  }, [token_hash, navigate]);

  const requestLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    const addr = email.trim().toLowerCase();
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: addr,
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/welcome` },
    });
    setSending(false);
    if (otpError) {
      setError(
        /signups not allowed|not found|otp_disabled/i.test(otpError.message)
          ? "We couldn't find a WRRCS team account for that email. Ask your manager to send you an invite."
          : /rate|seconds/i.test(otpError.message)
            ? "Please wait a minute before asking for another link."
            : otpError.message,
      );
      return;
    }
    setView({ kind: "emailed", email: addr });
  };

  return (
    <div className="min-h-screen bg-clay-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <img src={wrrcLogo.url} alt="Wash Rinse Repeat Cleaning Services" className="mx-auto mb-6 h-20 w-auto object-contain" />
        <div className="rounded-xl bg-card ring-1 ring-black/5 p-6 space-y-4">
          {view.kind === "working" && (
            <div role="status" className="text-center space-y-2">
              <h1 className="text-lg font-medium">Signing you in…</h1>
              <p className="text-sm text-muted-foreground">Opening My Jobs.</p>
            </div>
          )}

          {view.kind === "problem" && (
            <div className="space-y-2">
              <h1 className="text-lg font-medium">
                {view.reason === "revoked" ? "This invite was cancelled" : "This sign-in link has expired or was already used"}
              </h1>
              <p className="text-sm text-muted-foreground">
                {view.reason === "revoked"
                  ? "Ask your manager to send you a new invite."
                  : "Each link works once and only for a short time. Get a new one below — it arrives by email in a minute."}
              </p>
            </div>
          )}

          {view.kind === "request" && (
            <div className="space-y-1">
              <h1 className="text-lg font-medium">Sign in to WRRCS</h1>
              <p className="text-sm text-muted-foreground">We'll email you a one-tap sign-in link. No password needed.</p>
            </div>
          )}

          {(view.kind === "request" || (view.kind === "problem" && view.reason === "expired")) && (
            <form onSubmit={requestLink} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="welcome-email">Your work email</Label>
                <Input id="welcome-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={sending || !email.trim()} className="w-full bg-brand text-brand-foreground hover:opacity-90">
                {sending ? "Sending…" : "Email me a new sign-in link"}
              </Button>
            </form>
          )}

          {view.kind === "emailed" && (
            <div role="status" className="space-y-2">
              <h1 className="text-lg font-medium">Check your email</h1>
              <p className="text-sm text-muted-foreground">
                If {view.email} is on the WRRCS team, a new sign-in link is on its way. Tap it on this phone.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
