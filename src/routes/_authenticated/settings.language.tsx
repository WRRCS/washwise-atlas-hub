import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Check, Globe } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { useLanguage, useT, type Lang } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/settings/language")({
  component: LanguageSettingsPage,
  head: () => ({
    meta: [
      { title: "Language · WRRCS" },
      { name: "description", content: "Choose whether the app is shown in English or Ukrainian." },
      { property: "og:title", content: "Language · WRRCS" },
      { property: "og:description", content: "Choose whether the app is shown in English or Ukrainian." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const OPTIONS: { value: Lang; label: string; hint: string }[] = [
  { value: "en", label: "English", hint: "Show the app in English" },
  { value: "uk", label: "Українська", hint: "Показувати застосунок українською" },
];

function LanguageSettingsPage() {
  return (
    <AppShell>
      <LanguageSettingsBody />
    </AppShell>
  );
}

function LanguageSettingsBody() {
  const { lang, setLang } = useLanguage();
  const t = useT();

  return (
    <>
      <PageHeader title={t("Language")} subtitle={t("App language")} />
      <div className="max-w-xl w-full mx-auto px-6 md:px-8 py-6 space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Globe className="size-4" />
          {t("You can change this later in Language settings.")}
        </div>
        {OPTIONS.map((o) => {
          const active = lang === o.value;
          return (
            <button
              key={o.value}
              onClick={() => {
                setLang(o.value);
                toast.success(o.value === "uk" ? "Мову збережено" : "Language saved");
              }}
              className={`w-full text-left rounded-xl border px-4 py-3 transition-colors flex items-center justify-between gap-3 ${
                active ? "border-brand bg-brand/5" : "border-border/60 hover:bg-clay-100"
              }`}
            >
              <span>
                <span className="block font-medium">{o.label}</span>
                <span className="block text-xs text-muted-foreground">{o.hint}</span>
              </span>
              {active && <Check className="size-4 text-brand shrink-0" />}
            </button>
          );
        })}
      </div>
    </>
  );
}
