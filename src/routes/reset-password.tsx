import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Set a new password — Atlas" },
      { name: "description", content: "Choose a new password for your Atlas account." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Supabase's recovery link lands here with a session in the URL hash.
    // The client picks it up automatically; wait until a session is present.
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setReady(true);
        return;
      }
      // Listen for the PASSWORD_RECOVERY event fired shortly after mount.
      const { data: sub } = supabase.auth.onAuthStateChange((event) => {
        if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
      });
      return () => sub.subscription.unsubscribe();
    };
    void check();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password updated. You're signed in.");
      navigate({ to: "/jobs", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update password");
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
            <span className="text-xl font-medium tracking-tight">Atlas</span>
          </div>
          <p className="text-sm text-muted-foreground">Set a new password</p>
        </div>

        <div className="rounded-xl bg-card ring-1 ring-black/5 p-6 space-y-5">
          {!ready ? (
            <p className="text-sm text-muted-foreground">
              Verifying your reset link…
              <br />
              <span className="text-xs">
                If this doesn't load, the link may have expired.{" "}
                <Link to="/forgot-password" className="underline">Request a new one</Link>.
              </span>
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="password">New password</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} />
              </div>
              <Button type="submit" disabled={loading} className="w-full bg-brand text-brand-foreground hover:opacity-90">
                {loading ? "…" : "Update password"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
