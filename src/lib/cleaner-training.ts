import content from "./cleaner-training.json";
import type { Lang } from "@/lib/i18n";
import pdfEn from "../assets/training/WRRCS-Cleaner-Training-EN.pdf?url";
import pdfUk from "../assets/training/WRRCS-Cleaner-Training-UK.pdf?url";
import firstDayEn from "../assets/training/WRRCS-First-Day-Guide-EN.pdf?url";
import firstDayUk from "../assets/training/WRRCS-First-Day-Guide-UK.pdf?url";

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
  firstDay: FirstDayGuide;
};

export type FirstDayStep = { id: string; title: string; image: string; lines: string[] };

/** Short day-order walkthrough for a new cleaner's first shift. */
export type FirstDayGuide = {
  title: string;
  subtitle: string;
  intro: string;
  downloadLabel: string;
  fullGuideLabel: string;
  beforeTitle: string;
  before: string[];
  rememberTitle: string;
  remember: string[];
  stepWord: string;
  steps: FirstDayStep[];
};

/** One shared source for the in-app page and the printable PDFs. */
export const CLEANER_TRAINING = content as Record<Lang, TrainingGuide>;


export const TRAINING_PDF: Record<Lang, string> = { en: pdfEn, uk: pdfUk };

/** One single-language first-day PDF per language. */
export const FIRST_DAY_PDF: Record<Lang, string> = { en: firstDayEn, uk: firstDayUk };

const files = import.meta.glob("../assets/training/*.jpg", { eager: true, import: "default" }) as Record<string, string>;

/** Screenshot for a language; falls back to the English capture. */
export function trainingImage(lang: Lang, key: string): string | null {
  return files[`../assets/training/${lang}-${key}.jpg`] ?? files[`../assets/training/en-${key}.jpg`] ?? null;
}
