import content from "./cleaner-training.json";
import type { Lang } from "@/lib/i18n";

export type TrainingSection = {
  id: string;
  title: string;
  intro: string;
  steps: string[];
  tip?: string;
  images: string[];
};

export type TrainingGuide = {
  title: string;
  subtitle: string;
  sampleNote: string;
  downloadLabel: string;
  printLabel: string;
  contentsLabel: string;
  stepLabel: string;
  tipLabel: string;
  sections: TrainingSection[];
};

/** One shared source for the in-app page and the printable PDFs. */
export const CLEANER_TRAINING = content as Record<Lang, TrainingGuide>;

export const TRAINING_PDF: Record<Lang, string> = {
  en: "/training/WRRCS-Cleaner-Training-EN.pdf",
  uk: "/training/WRRCS-Cleaner-Training-UK.pdf",
};

const files = import.meta.glob("../assets/training/*.jpg", { eager: true, import: "default" }) as Record<string, string>;

/** Screenshot for a language; falls back to the English capture. */
export function trainingImage(lang: Lang, key: string): string | null {
  return files[`../assets/training/${lang}-${key}.jpg`] ?? files[`../assets/training/en-${key}.jpg`] ?? null;
}
