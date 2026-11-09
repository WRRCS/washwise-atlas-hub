import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Download, Lightbulb, Printer } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { useLanguage, type Lang } from "@/lib/i18n";
import { CLEANER_TRAINING, TRAINING_PDF, trainingImage } from "@/lib/cleaner-training";

export const Route = createFileRoute("/_authenticated/training")({
  component: TrainingPage,
  head: () => ({
    meta: [
      { title: "Cleaner Training · WRRCS" },
      { name: "description", content: "Step-by-step training for new WRRCS cleaners, in English and Ukrainian." },
      { property: "og:title", content: "Cleaner Training · WRRCS" },
      { property: "og:description", content: "Step-by-step training for new WRRCS cleaners, in English and Ukrainian." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const LANGS: { value: Lang; label: string }[] = [
  { value: "en", label: "English" },
  { value: "uk", label: "Українська" },
];

function TrainingPage() {
  const { lang: appLang } = useLanguage();
  const [lang, setLang] = useState<Lang>(appLang);
  useEffect(() => setLang(appLang), [appLang]);
  const guide = CLEANER_TRAINING[lang];

  return (
    <AppShell>
      <PageHeader
        title={guide.title}
        subtitle={guide.subtitle}
        action={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <div className="flex rounded-lg bg-clay-100 p-1" role="group" aria-label="Training language">
              {LANGS.map((l) => (
                <button
                  key={l.value}
                  type="button"
                  onClick={() => setLang(l.value)}
                  aria-pressed={lang === l.value}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    lang === l.value ? "bg-clay-50 text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        }
      />
      <div className="max-w-3xl w-full mx-auto px-6 md:px-8 py-6 space-y-8" lang={lang}>
        <div className="flex flex-wrap gap-2 print:hidden">
          <a
            href={TRAINING_PDF[lang]}
            download
            className="inline-flex items-center gap-2 rounded-lg bg-brand text-brand-foreground px-4 py-2.5 text-sm font-medium hover:opacity-90"
          >
            <Download className="size-4" /> {guide.downloadLabel}
          </a>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium hover:bg-clay-100"
          >
            <Printer className="size-4" /> {guide.printLabel}
          </button>
        </div>

        <p className="text-sm text-muted-foreground rounded-lg bg-clay-100 px-4 py-3">{guide.sampleNote}</p>

        <nav aria-label={guide.contentsLabel} className="rounded-xl border border-border/60 bg-card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">{guide.contentsLabel}</h2>
          <ol className="grid gap-1.5 sm:grid-cols-2 text-sm">
            {guide.sections.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-brand hover:underline">
                  {i + 1}. {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {guide.sections.map((s, i) => (
          <section key={s.id} id={s.id} className="scroll-mt-24 rounded-2xl border border-border/60 bg-card p-5 md:p-6 break-inside-avoid">
            <div className="flex items-baseline gap-3">
              <span className="grid place-items-center size-8 shrink-0 rounded-full bg-brand/10 text-brand text-sm font-semibold">{i + 1}</span>
              <h2 className="text-xl font-semibold leading-tight">{s.title}</h2>
            </div>
            <p className="mt-3 text-[15px] leading-relaxed">{s.intro}</p>
            <ol className="mt-4 space-y-2.5">
              {s.steps.map((step, k) => (
                <li key={k} className="flex gap-3 text-[15px] leading-relaxed">
                  <span className="mt-0.5 grid place-items-center size-6 shrink-0 rounded-full bg-clay-100 text-xs font-semibold text-muted-foreground">{k + 1}</span>
                  <span className="min-w-0">{step}</span>
                </li>
              ))}
            </ol>
            {s.tip && (
              <p className="mt-4 flex gap-2 rounded-lg bg-brand/5 border border-brand/20 px-4 py-3 text-sm">
                <Lightbulb className="size-4 shrink-0 mt-0.5 text-brand" />
                <span><strong>{guide.tipLabel}:</strong> {s.tip}</span>
              </p>
            )}
            {s.images.length > 0 && (
              <div className={`mt-5 grid gap-4 ${s.images.length > 1 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"} justify-items-center`}>
                {s.images.map((key) => {
                  const src = trainingImage(lang, key);
                  if (!src) return null;
                  return (
                    <img
                      key={key}
                      src={src}
                      alt={`${s.title} — screenshot`}
                      loading="lazy"
                      width={300}
                      height={649}
                      className="w-full max-w-[280px] h-auto rounded-2xl border border-border shadow-sm"
                    />
                  );
                })}
              </div>
            )}
          </section>
        ))}
      </div>
    </AppShell>
  );
}
