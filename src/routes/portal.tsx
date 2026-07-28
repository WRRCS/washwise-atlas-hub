import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/portal")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Client Portal — Wash Rinse Repeat Cleaning" },
      { name: "description", content: "View your appointments, invoices, and messages." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PortalSignIn,
});

function PortalSignIn() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/portal/dashboard", replace: true });
    });
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const clean = email.trim().toLowerCase();
      const { data: known, error: rpcErr } = await supabase.rpc("portal_email_is_client", { _email: clean });
      if (rpcErr) throw rpcErr;
      if (!known) {
        toast.error("We don't recognize that email. Please contact us if you're an existing client.");
        return;
      }
      const { error } = await supabase.auth.signInWithOtp({
        email: clean,
        options: {
          shouldCreateUser: true,
          data: { portal_client: true },
          emailRedirectTo: `${window.location.origin}/portal/dashboard`,
        },
      });
      if (error) throw error;
      setSent(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send sign-in link");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-clay-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2.5 mb-4">
            <div className="size-7 rounded bg-brand grid place-items-center">
              <div className="size-2 rounded-full bg-clay-50" />
            </div>
            <span className="text-xl font-medium tracking-tight">Client Portal</span>
          </div>
          <p className="text-sm text-muted-foreground">Wash Rinse Repeat Cleaning</p>
        </div>

        <div className="rounded-xl bg-card ring-1 ring-black/5 p-6 space-y-5">
          {sent ? (
            <div className="space-y-3 text-center">
              <h1 className="text-lg font-medium">Check your email</h1>
              <p className="text-sm text-muted-foreground">
                We sent a sign-in link to <span className="font-medium text-foreground">{email}</span>.
                Click it to access your portal.
              </p>
              <Button variant="ghost" size="sm" onClick={() => { setSent(false); setEmail(""); }}>
                Use a different email
              </Button>
            </div>
          ) : (
            <>
              <div>
                <h1 className="text-lg font-medium">Sign in</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Enter your email and we'll send a one-time sign-in link.
                </p>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Sending…" : "Email me a sign-in link"}
                </Button>
              </form>
            </>
          )}
          <p className="text-xs text-muted-foreground text-center">
            Are you staff? <Link to="/auth" className="underline">Sign in here</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
