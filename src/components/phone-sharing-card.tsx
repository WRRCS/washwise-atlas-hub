import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Phone } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type Sharing = { phone: string | null; share: boolean };

/** Lets each team member choose whether teammates can see their phone number. */
export function PhoneSharingCard() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["my-phone-sharing"],
    queryFn: async (): Promise<Sharing> => {
      const { data, error } = await supabase.rpc("my_phone_sharing");
      if (error) throw new Error(error.message);
      const d = (data ?? {}) as Partial<Sharing>;
      return { phone: d.phone ?? null, share: !!d.share };
    },
  });
  const [phone, setPhone] = useState("");
  const [share, setShare] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!q.data) return;
    setPhone(q.data.phone ?? "");
    setShare(q.data.share);
  }, [q.data]);

  if (!q.data) return null;
  const dirty = phone.trim() !== (q.data.phone ?? "") || share !== q.data.share;

  const save = async () => {
    if (share && !phone.trim()) {
      toast.error(t("Add your phone number before sharing it"));
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("set_my_phone_sharing", { _share: share, _phone: phone.trim() });
    setSaving(false);
    if (error) {
      toast.error(t(error.message));
      return;
    }
    toast.success(t(share ? "Your phone number is now shared with the team" : "Your phone number is hidden from the team"));
    qc.invalidateQueries({ queryKey: ["my-phone-sharing"] });
    qc.invalidateQueries({ queryKey: ["team-roster"] });
  };

  return (
    <section aria-labelledby="phone-sharing-title" className="mb-4 rounded-md border border-border bg-card p-4 print:hidden">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground">
          <Phone className="size-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h2 id="phone-sharing-title" className="font-semibold text-foreground">{t("Share your phone number with the team?")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("This is your choice. Your phone number is private unless you turn sharing on.")}</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>{t("Check or type your phone number below.")}</li>
              <li>{t("Turn on “Show my phone number to teammates” if you want coworkers to be able to call or text you.")}</li>
              <li>{t("Tap Save. You can turn it off at any time.")}</li>
            </ol>
            <p className="mt-2 text-sm text-muted-foreground">{t("Owners and managers can always see your phone number. Your email, address and pay are never shared with teammates.")}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_1fr] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="my-team-phone">{t("My phone number")}</Label>
              <Input id="my-team-phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="flex items-center gap-2 sm:pb-2">
              <Switch id="share-my-phone" checked={share} onCheckedChange={setShare} />
              <Label htmlFor="share-my-phone" className="text-sm">{t("Show my phone number to teammates")}</Label>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={save} disabled={saving || !dirty}>{saving ? t("Saving…") : t("Save")}</Button>
            <span className="text-sm text-muted-foreground">
              {q.data.share ? t("Right now: teammates can see your phone number.") : t("Right now: your phone number is hidden from teammates.")}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
