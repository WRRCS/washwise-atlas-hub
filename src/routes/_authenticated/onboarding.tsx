import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Check, ChevronRight } from "lucide-react";
import {
  getOnboardingState,
  saveBusinessProfile,
  getServiceTypeSelections,
  saveServiceTypeSelections,
  saveScheduleSettings,
  completeOnboarding,
  type ServiceTypeOption,
} from "@/lib/onboarding.functions";

export const Route = createFileRoute("/_authenticated/onboarding")({
  component: OnboardingPage,
});

const STEPS = ["Business", "Services", "Prices", "Durations", "Hours", "Finish"] as const;

const TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Phoenix", "America/Anchorage", "Pacific/Honolulu", "Europe/London",
];
const LOCALES = [
  { v: "en-US", label: "English (US)" },
  { v: "en-GB", label: "English (UK)" },
];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function OnboardingPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fetchState = useServerFn(getOnboardingState);
  const fetchServices = useServerFn(getServiceTypeSelections);
  const saveProfile = useServerFn(saveBusinessProfile);
  const saveServices = useServerFn(saveServiceTypeSelections);
  const saveSchedule = useServerFn(saveScheduleSettings);
  const finish = useServerFn(completeOnboarding);

  const stateQ = useQuery({ queryKey: ["onboarding-state"], queryFn: () => fetchState() });
  const svcQ = useQuery({ queryKey: ["onboarding-services"], queryFn: () => fetchServices() });

  const [step, setStep] = useState(0);
  // profile
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [timezone, setTimezone] = useState("America/New_York");
  const [locale, setLocale] = useState("en-US");
  // services
  const [services, setServices] = useState<ServiceTypeOption[]>([]);
  // schedule
  const [hours, setHours] = useState<Record<string, { start: string; end: string; closed?: boolean }>>(
    Object.fromEntries(DAYS.map(d => [d, { start: "08:00", end: "17:00", closed: d === "Sun" }]))
  );
  const [quietStart, setQuietStart] = useState("21:00");
  const [quietEnd, setQuietEnd] = useState("08:00");

  useEffect(() => {
    if (stateQ.data) {
      if (stateQ.data.onboarding_completed) {
        navigate({ to: "/dashboard", replace: true });
        return;
      }
      setName(stateQ.data.name ?? "");
      setEmail(stateQ.data.business_email ?? "");
      setPhone(stateQ.data.business_phone ?? "");
      setAddress(stateQ.data.address ?? "");
      setTimezone(stateQ.data.timezone ?? "America/New_York");
      setLocale(stateQ.data.locale ?? "en-US");
      if (stateQ.data.business_hours) setHours(stateQ.data.business_hours as typeof hours);
      if (stateQ.data.quiet_hours) {
        setQuietStart(stateQ.data.quiet_hours.start);
        setQuietEnd(stateQ.data.quiet_hours.end);
      }
    }
  }, [stateQ.data, navigate]);

  useEffect(() => {
    if (svcQ.data) setServices(svcQ.data);
  }, [svcQ.data]);

  const busy = useMutation({
    mutationFn: async (action: "profile" | "services" | "schedule" | "done") => {
      if (action === "profile") {
        await saveProfile({ data: { name, business_email: email || null, business_phone: phone || null, address: address || null, timezone, locale } });
      } else if (action === "services") {
        await saveServices({ data: { services } });
      } else if (action === "schedule") {
        await saveSchedule({ data: { business_hours: hours, quiet_hours: { start: quietStart, end: quietEnd } } });
      } else {
        await finish();
      }
    },
    onError: (e: any) => toast.error(e?.message ?? "Something went wrong"),
  });

  const next = async () => {
    if (step === 0) await busy.mutateAsync("profile");
    else if (step === 1 || step === 2 || step === 3) await busy.mutateAsync("services");
    else if (step === 4) await busy.mutateAsync("schedule");
    else if (step === 5) {
      await busy.mutateAsync("done");
      await qc.invalidateQueries({ queryKey: ["onboarding-state"] });
      toast.success("You're all set. Welcome to WRRCS.com.");
      navigate({ to: "/dashboard", replace: true });
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const back = () => setStep((s) => Math.max(0, s - 1));

  if (stateQ.isLoading || svcQ.isLoading) {
    return <div className="min-h-screen grid place-items-center text-muted-foreground text-sm">Loading…</div>;
  }

  const selectedServices = services.filter(s => s.selected);
  const canProceed = step === 0 ? name.trim().length > 0 : step === 1 ? selectedServices.length > 0 : true;

  return (
    <div className="min-h-screen bg-clay-50 py-8 md:py-12">
      <div className="max-w-2xl mx-auto px-4">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2.5 mb-3">
            <div className="size-7 rounded bg-brand grid place-items-center">
              <div className="size-2 rounded-full bg-clay-50" />
            </div>
            <span className="text-xl font-medium tracking-tight">WRRCS.com</span>
          </div>
          <p className="text-sm text-muted-foreground">Let's set up your workspace ({step + 1} of {STEPS.length})</p>
        </div>

        {/* stepper */}
        <div className="flex items-center gap-1.5 mb-6">
          {STEPS.map((label, i) => (
            <div key={label} className="flex-1">
              <div className={`h-1 rounded-full ${i <= step ? "bg-brand" : "bg-black/10"}`} />
              <p className={`text-[10px] mt-1 text-center ${i === step ? "text-foreground" : "text-muted-foreground"}`}>{label}</p>
            </div>
          ))}
        </div>

        <div className="bg-card rounded-xl ring-1 ring-black/5 p-6 md:p-8 space-y-4">
          {step === 0 && (
            <div className="space-y-3">
              <h2 className="text-xl font-medium mb-2">Tell us about your business</h2>
              <div><Label htmlFor="n">Business name *</Label><Input id="n" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} /></div>
              <div><Label htmlFor="e">Business email</Label><Input id="e" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={255} /></div>
              <div><Label htmlFor="p">Phone</Label><Input id="p" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} /></div>
              <div><Label htmlFor="a">Address</Label><Input id="a" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={500} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="tz">Timezone</Label>
                  <select id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full h-9 px-3 rounded-md ring-1 ring-black/10 bg-background text-sm">
                    {TIMEZONES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <Label htmlFor="lc">Language</Label>
                  <select id="lc" value={locale} onChange={(e) => setLocale(e.target.value)} className="w-full h-9 px-3 rounded-md ring-1 ring-black/10 bg-background text-sm">
                    {LOCALES.map(l => <option key={l.v} value={l.v}>{l.label}</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <h2 className="text-xl font-medium mb-2">Which services do you offer?</h2>
              <p className="text-sm text-muted-foreground">Pick at least one. You can add more later.</p>
              <div className="grid gap-2">
                {services.map((s, i) => (
                  <label key={s.kind} className={`flex items-center gap-3 p-3 rounded-lg ring-1 cursor-pointer transition ${s.selected ? "ring-brand bg-brand/5" : "ring-black/10 hover:ring-black/20"}`}>
                    <Checkbox checked={s.selected} onCheckedChange={(v) => {
                      const copy = [...services]; copy[i] = { ...s, selected: !!v }; setServices(copy);
                    }} />
                    <span className="text-sm flex-1">{s.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <h2 className="text-xl font-medium mb-2">Set default prices</h2>
              <p className="text-sm text-muted-foreground">Prices are per job. Adjust anytime in Services.</p>
              <div className="space-y-2">
                {selectedServices.map((s) => (
                  <div key={s.kind} className="flex items-center gap-3">
                    <span className="text-sm flex-1">{s.name}</span>
                    <span className="text-muted-foreground text-sm">$</span>
                    <Input
                      type="number" min={0} step={5}
                      value={(s.default_price_cents / 100).toString()}
                      onChange={(e) => {
                        const cents = Math.max(0, Math.round(Number(e.target.value) * 100));
                        setServices(services.map(x => x.kind === s.kind ? { ...x, default_price_cents: cents } : x));
                      }}
                      className="w-28"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <h2 className="text-xl font-medium mb-2">Set default durations</h2>
              <p className="text-sm text-muted-foreground">Duration in minutes per job.</p>
              <div className="space-y-2">
                {selectedServices.map((s) => (
                  <div key={s.kind} className="flex items-center gap-3">
                    <span className="text-sm flex-1">{s.name}</span>
                    <Input
                      type="number" min={15} step={15} max={1440}
                      value={s.default_duration_minutes}
                      onChange={(e) => {
                        const mins = Math.max(15, Math.min(1440, Number(e.target.value) || 15));
                        setServices(services.map(x => x.kind === s.kind ? { ...x, default_duration_minutes: mins } : x));
                      }}
                      className="w-28"
                    />
                    <span className="text-muted-foreground text-sm w-12">min</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <h2 className="text-xl font-medium mb-2">Business hours</h2>
              <div className="space-y-2">
                {DAYS.map(d => (
                  <div key={d} className="flex items-center gap-3">
                    <span className="text-sm w-12">{d}</span>
                    <Checkbox
                      checked={!hours[d]?.closed}
                      onCheckedChange={(v) => setHours({ ...hours, [d]: { ...hours[d], closed: !v } })}
                    />
                    <Input type="time" value={hours[d]?.start ?? "08:00"} disabled={hours[d]?.closed}
                      onChange={(e) => setHours({ ...hours, [d]: { ...hours[d], start: e.target.value } })} className="w-32" />
                    <span className="text-muted-foreground text-sm">to</span>
                    <Input type="time" value={hours[d]?.end ?? "17:00"} disabled={hours[d]?.closed}
                      onChange={(e) => setHours({ ...hours, [d]: { ...hours[d], end: e.target.value } })} className="w-32" />
                  </div>
                ))}
              </div>
              <div className="pt-4 border-t border-black/5">
                <h3 className="text-base font-medium mb-2">SMS quiet hours</h3>
                <p className="text-sm text-muted-foreground mb-2">No automated texts to clients during this window.</p>
                <div className="flex items-center gap-3">
                  <Input type="time" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} className="w-32" />
                  <span className="text-muted-foreground text-sm">to</span>
                  <Input type="time" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} className="w-32" />
                </div>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-3">
              <h2 className="text-xl font-medium mb-2">You're ready to go</h2>
              <p className="text-sm text-muted-foreground">
                Your workspace is set up. Billing can be configured later from Settings.
              </p>
              <ul className="space-y-2 mt-4">
                <li className="flex items-center gap-2 text-sm"><Check className="size-4 text-brand" /> Business profile saved</li>
                <li className="flex items-center gap-2 text-sm"><Check className="size-4 text-brand" /> {selectedServices.length} service type{selectedServices.length === 1 ? "" : "s"} configured</li>
                <li className="flex items-center gap-2 text-sm"><Check className="size-4 text-brand" /> Business hours &amp; quiet hours set</li>
                <li className="flex items-center gap-2 text-sm text-muted-foreground"><Check className="size-4" /> Billing setup — <span className="underline">skip for now</span></li>
              </ul>
            </div>
          )}

          <div className="flex justify-between pt-4 border-t border-black/5">
            <Button variant="ghost" onClick={back} disabled={step === 0 || busy.isPending}>Back</Button>
            <Button onClick={next} disabled={!canProceed || busy.isPending}>
              {busy.isPending ? "Saving…" : step === STEPS.length - 1 ? "Enter WRRCS.com" : "Continue"}
              {!busy.isPending && step < STEPS.length - 1 && <ChevronRight className="ml-1 size-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
