import { useState } from "react";
import { Globe } from "lucide-react";
import { useLanguage, type Lang } from "@/lib/i18n";

const OPTIONS: { value: Lang; label: string; hint: string }[] = [
  { value: "en", label: "English", hint: "Use the app in English" },
  { value: "uk", label: "Українська", hint: "Використовувати застосунок українською" },
];

/**
 * Shown once, the first time someone signs in, so they can pick the language
 * the app speaks to them in. Changeable later under Language settings.
 */
export function LanguageSetupDialog() {
  const { needsSetup, setLang } = useLanguage();
  const [dismissed, setDismissed] = useState(false);

  if (!needsSetup || dismissed) return null;

  const choose = (l: Lang) => {
    setLang(l);
    setDismissed(true);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 grid place-items-center p-4">
      <div className="bg-clay-50 rounded-2xl border border-border/60 w-full max-w-sm p-6 shadow-lg">
        <div className="flex items-center gap-2 mb-1">
          <Globe className="size-5 text-brand" />
          <h2 className="text-lg font-medium">Choose your language</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-1">Оберіть свою мову</p>
        <p className="text-xs text-muted-foreground mb-5">
          You can change this later under Language. · Це можна змінити пізніше в розділі «Мова».
        </p>
        <div className="space-y-2">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => choose(o.value)}
              className="w-full text-left rounded-xl border border-border/60 hover:border-brand hover:bg-brand/5 px-4 py-3 transition-colors"
            >
              <span className="block font-medium">{o.label}</span>
              <span className="block text-xs text-muted-foreground">{o.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
