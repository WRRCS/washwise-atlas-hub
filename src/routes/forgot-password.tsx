import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/forgot-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Reset your password — Atlas" },
      { name: "description", content: "Request a password reset link for your Atlas account." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setSent(true);
      toast.success("Check your email for a reset link.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send reset email");
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
          <p className="text-sm text-muted-foreground">Reset your password</p>
        </div>

        <div className="rounded-xl bg-card ring-1 ring-black/5 p-6 space-y-5">
          {sent ? (
            <div className="space-y-3 text-sm">
              <p>If an account exists for <span className="font-medium">{email}</span>, we've sent a password reset link.</p>
              <p className="text-muted-foreground">The link expires in 1 hour.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
              </div>
              <Button type="submit" disabled={loading} className="w-full bg-brand text-brand-foreground hover:opacity-90">
                {loading ? "…" : "Send reset link"}
              </Button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          <Link to="/auth" className="underline hover:text-foreground">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
