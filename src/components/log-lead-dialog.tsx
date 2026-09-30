import { useState, type FormEvent, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createLead, LEAD_SOURCES } from "@/lib/leads.functions";

/**
 * Fast lead entry from anywhere in the app: a call, a text, an Airbnb/VRBO
 * message, a referral, or a walk-in. Saves a prospect without creating a
 * client record first — conversion to a client happens later from the lead.
 */
export function LogLeadDialog({
  children,
  onSaved,
}: {
  children: ReactNode;
  onSaved?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [source, setSource] = useState<string>("airbnb");
  const [service, setService] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");

  const blank = () => {
    setName("");
    setPhone("");
    setEmail("");
    setSource("airbnb");
    setService("");
    setAddress("");
    setNotes("");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Who is it? Add a name so you can find them later.");
      return;
    }
    setSaving(true);
    try {
      const res = await createLead({
        data: {
          name: name.trim(),
          phone: phone.trim() || null,
          email: email.trim() || null,
          source: source as never,
          service_interest: service.trim() || null,
          address: address.trim() || null,
          notes: notes.trim() || null,
        },
      });
      toast.success(`Logged ${name.trim()}`);
      blank();
      setOpen(false);
      onSaved?.(res.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save that lead.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Log a lead</DialogTitle>
          <DialogDescription>
            Save a prospect the moment they reach out. Nothing is sent to them and no client
            record is created until you turn this into a booking.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Where did they come from?
            </span>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {LEAD_SOURCES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setSource(s.value)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                    source === s.value
                      ? "border-brand bg-brand/5 text-brand font-medium"
                      : "border-border hover:bg-clay-100"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="lead-name" className="text-xs">
                Name
              </Label>
              <Input
                id="lead-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Sean Ryan"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lead-phone" className="text-xs">
                Phone
              </Label>
              <Input
                id="lead-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 555-0100"
                inputMode="tel"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lead-email" className="text-xs">
                Email
              </Label>
              <Input
                id="lead-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="they@example.com"
                inputMode="email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lead-service" className="text-xs">
                What they want
              </Label>
              <Input
                id="lead-service"
                value={service}
                onChange={(e) => setService(e.target.value)}
                placeholder="Turnover, weekly clean…"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lead-address" className="text-xs">
              Property or address
            </Label>
            <Input
              id="lead-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Beach Bum — 1234 Coast Ave"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lead-notes" className="text-xs">
              Notes
            </Label>
            <Textarea
              id="lead-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Asked about Saturday availability, has two dogs…"
              rows={3}
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-sm rounded-lg border border-input px-3 py-2 hover:bg-clay-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="text-sm rounded-lg bg-brand text-brand-foreground px-4 py-2 font-medium hover:opacity-90 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save lead"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
