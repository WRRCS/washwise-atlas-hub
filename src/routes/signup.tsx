import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Check } from "lucide-react";

export const Route = createFileRoute("/signup")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Start your free trial — Atlas" },
      { name: "description", content: "Run your cleaning business without the chaos. AI-powered scheduling, invoicing, and team management built specifically for cleaning services. Start your free trial today." },
      { property: "og:title", content: "Start your free trial — Atlas" },
      { property: "og:description", content: "AI-powered ops for cleaning businesses. Start free." },
    ],
  }),
  component: SignupPage,
});

type Tier = "starter" | "growth" | "scale";

const TIERS: Array<{ id: Tier; name: string; price: string; blurb: string; limits: string[] }> = [
  { id: "starter", name: "Starter", price: "$49", blurb: "For solo operators", limits: ["Up to 50 jobs / month", "1 owner + 3 employees", "Core scheduling & invoicing"] },
  { id: "growth", name: "Growth", price: "$99", blurb: "For growing crews", limits: ["Up to 200 jobs / month", "Unlimited employees", "Atlas AI assistant", "Turno integration"] },
  { id: "scale", name: "Scale", price: "$199", blurb: "For established teams", limits: ["Unlimited jobs", "Unlimited AI queries", "Priority support", "Custom integrations"] },
];

function SignupPage() {
  const navigate = useNavigate();
  const [tier, setTier] = useState<Tier>("growth");
  const [businessName, setBusinessName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/onboarding", replace: true });
    });
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessName.trim()) return toast.error("Business name is required");
    setLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email, password,
        options: {
          emailRedirectTo: window.location.origin,
          data: {
            full_name: fullName,
            signup_business_name: businessName.trim(),
            signup_plan_tier: tier,
          },
        },
      });
      if (error) throw error;
      toast.success("Workspace created. Let's finish setting things up.");
      navigate({ to: "/onboarding", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-clay-50">
      <header className="px-6 py-5 flex items-center justify-between max-w-6xl mx-auto">
        <div className="inline-flex items-center gap-2.5">
          <div className="size-7 rounded bg-brand grid place-items-center">
            <div className="size-2 rounded-full bg-clay-50" />
          </div>
          <span className="text-xl font-medium tracking-tight">Atlas</span>
        </div>
        <Link to="/auth" className="text-sm text-muted-foreground hover:text-foreground">Sign in</Link>
      </header>

      <main className="max-w-6xl mx-auto px-6 pb-16">
        <section className="text-center py-10 md:py-16">
          <h1 className="text-4xl md:text-5xl font-medium tracking-tight max-w-3xl mx-auto">
            Run your cleaning business without the chaos.
          </h1>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
            AI-powered scheduling, invoicing, and team management — built specifically for cleaning services.
          </p>
          <ul className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <li className="inline-flex items-center gap-1.5"><Check className="size-4" /> Smart scheduling</li>
            <li className="inline-flex items-center gap-1.5"><Check className="size-4" /> Auto invoicing</li>
            <li className="inline-flex items-center gap-1.5"><Check className="size-4" /> Team GPS check-in</li>
            <li className="inline-flex items-center gap-1.5"><Check className="size-4" /> Turno integration</li>
          </ul>
        </section>

        <section className="grid md:grid-cols-3 gap-4 mb-10">
          {TIERS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTier(t.id)}
              className={`text-left rounded-xl p-5 ring-1 transition ${
                tier === t.id ? "bg-card ring-brand shadow-sm" : "bg-card/60 ring-black/5 hover:ring-black/10"
              }`}
            >
              <div className="flex items-baseline justify-between">
                <h3 className="text-lg font-medium">{t.name}</h3>
                <div className={`size-4 rounded-full ring-1 ${tier === t.id ? "bg-brand ring-brand" : "ring-black/20"}`} />
              </div>
              <p className="text-xs text-muted-foreground">{t.blurb}</p>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-2xl font-medium">{t.price}</span>
                <span className="text-sm text-muted-foreground">/mo</span>
              </div>
              <ul className="mt-3 space-y-1.5">
                {t.limits.map((l) => (
                  <li key={l} className="text-sm text-muted-foreground inline-flex items-start gap-1.5">
                    <Check className="size-3.5 mt-0.5 flex-none" /> {l}
                  </li>
                ))}
              </ul>
            </button>
          ))}
        </section>

        <section className="max-w-md mx-auto bg-card rounded-xl ring-1 ring-black/5 p-6">
          <h2 className="text-lg font-medium mb-1">Create your workspace</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Free 14-day trial · No credit card required
          </p>
          <form onSubmit={submit} className="space-y-3">
            <div>
              <Label htmlFor="bn">Business name</Label>
              <Input id="bn" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Acme Cleaning Co." required maxLength={100} />
            </div>
            <div>
              <Label htmlFor="fn">Your name</Label>
              <Input id="fn" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Doe" maxLength={100} />
            </div>
            <div>
              <Label htmlFor="em">Email</Label>
              <Input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={255} />
            </div>
            <div>
              <Label htmlFor="pw">Password</Label>
              <Input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Creating workspace…" : `Start ${TIERS.find(t => t.id === tier)?.name} trial`}
            </Button>
            <p className="text-xs text-center text-muted-foreground">
              By signing up you agree to our terms of service.
            </p>
          </form>
        </section>
      </main>
    </div>
  );
}
