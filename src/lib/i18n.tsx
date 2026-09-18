import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getMyLanguage, setMyLanguage, type Lang } from "@/lib/language.functions";

export type { Lang };

const STORAGE_KEY = "wrrcs.lang";

/**
 * Ukrainian translations keyed by the English source text.
 * Missing keys fall back to English, so untranslated screens still work.
 */
const UK: Record<string, string> = {
  // Navigation / shell
  "My jobs": "Мої зміни",
  Schedule: "Графік",
  Team: "Команда",
  "Time off & swaps": "Відпустки та обміни",
  "Client chat": "Чат з клієнтом",
  Language: "Мова",
  "Sign out": "Вийти",
  Menu: "Меню",

  // Language setup
  "Choose your language": "Оберіть свою мову",
  "You can change this later in Language settings.": "Це можна змінити пізніше в налаштуваннях мови.",
  English: "English",
  Ukrainian: "Українська",
  Save: "Зберегти",
  Saved: "Збережено",
  "App language": "Мова застосунку",

  // My jobs
  "Your assigned work and time tracking": "Ваші призначені роботи та облік часу",
  "Today & upcoming": "Сьогодні та найближчі",
  "My schedule": "Мій графік",
  "My timesheet": "Мій табель",
  "Currently on the clock": "Зараз на зміні",
  "Up next today": "Наступне сьогодні",
  "Your next appointment": "Ваш наступний візит",
  "Clock in": "Почати зміну",
  "Clock out": "Завершити зміну",
  "View SOP": "Переглянути інструкцію",
  "Complete with photos": "Завершити з фото",
  "Tap for directions": "Натисніть для маршруту",
  "Notes for this visit": "Нотатки до цього візиту",
  With: "Разом з",
  Teammate: "Колега",
  "Job notes": "Нотатки до роботи",
  "Key / access": "Ключі / доступ",
  "Access notes": "Нотатки щодо доступу",
  Pets: "Тварини",
  Parking: "Паркування",
  "Special instructions": "Особливі вказівки",
  "Client note": "Нотатка клієнта",
  "Loading…": "Завантаження…",
  "No upcoming jobs assigned to you.": "Немає призначених вам робіт.",
  Done: "Виконано",
  "Location captured": "Місцезнаходження збережено",
  "Clocked in": "Зміну розпочато",
  "Failed to clock in": "Не вдалося розпочати зміну",
  "Complete job": "Завершити роботу",
  "Attach any before/after photos before marking complete.": "Додайте фото «до/після» перед завершенням.",
  Photos: "Фото",
  "Take photo": "Зробити фото",
  "Choose from gallery": "Вибрати з галереї",
  Notes: "Нотатки",
  "Supplies used": "Використані матеріали",
  Cancel: "Скасувати",
  Saving: "Збереження",
  "Job completed": "Роботу завершено",
  "Failed to complete job": "Не вдалося завершити роботу",
  Service: "Послуга",
  Hours: "Години",
  Total: "Разом",
  "No time entries yet.": "Записів часу ще немає.",
  "No jobs this week.": "Цього тижня робіт немає.",

  // SOP viewer
  SOP: "Інструкція",
  "Loading SOP…": "Завантаження інструкції…",
  "No SOP has been created for this service type yet.": "Для цього типу послуги інструкцію ще не створено.",
  "No service type on this job.": "У цій роботі немає типу послуги.",
  "Mark SOP reviewed": "Позначити інструкцію переглянутою",
  "SOP marked reviewed": "Інструкцію позначено переглянутою",
  "No steps yet.": "Кроків ще немає.",
  Attachments: "Вкладення",
  Checklist: "Чекліст",

  // Time off & swaps
  "Time off": "Відпустка",
  "Request time off": "Запит на відпустку",
  "Shift swaps": "Обмін змінами",
  "Request a swap": "Запит на обмін",
  "Start date": "Дата початку",
  "End date": "Дата завершення",
  Reason: "Причина",
  Submit: "Надіслати",
  "No requests yet.": "Запитів ще немає.",
  "No upcoming assigned jobs": "Немає найближчих призначених робіт",
  Anyone: "Будь-хто",
  Pending: "На розгляді",
  Approved: "Затверджено",
  Denied: "Відхилено",

  // Team
  "Your teammates": "Ваші колеги",
  "Team messages": "Повідомлення команди",
  Roster: "Склад команди",
  "Your teammates and internal chat": "Ваші колеги та внутрішній чат",
  "Request days off or ask a teammate to cover a shift.": "Запросіть вихідні або попросіть колегу підмінити вас.",
  "Send message": "Надіслати повідомлення",
  Message: "Повідомлення",
};

type Ctx = {
  lang: Lang;
  ready: boolean;
  needsSetup: boolean;
  setLang: (l: Lang) => void;
};

const LanguageContext = createContext<Ctx>({ lang: "en", ready: true, needsSetup: false, setLang: () => {} });

function readStored(): Lang | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "uk" || v === "en" ? v : null;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");
  const [hydrated, setHydrated] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const getFn = useServerFn(getMyLanguage);
  const setFn = useServerFn(setMyLanguage);

  useEffect(() => {
    const stored = readStored();
    if (stored) setLangState(stored);
    setHydrated(true);
  }, []);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => active && setSignedIn(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setSignedIn(!!session));
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const q = useQuery({
    queryKey: ["my-language"],
    queryFn: () => getFn(),
    enabled: signedIn,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    const server = q.data?.language ?? null;
    if (server) {
      setLangState(server);
      if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, server);
    }
  }, [q.data?.language]);

  const setLang = useCallback(
    (l: Lang) => {
      setLangState(l);
      if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, l);
      setFn({ data: { language: l } }).catch(() => {});
    },
    [setFn],
  );

  const value = useMemo<Ctx>(
    () => ({
      lang,
      ready: hydrated && (!signedIn || !q.isLoading),
      needsSetup: signedIn && q.isSuccess && (q.data?.language ?? null) === null,
      setLang,
    }),
    [lang, hydrated, signedIn, q.isLoading, q.isSuccess, q.data?.language, setLang],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  return useContext(LanguageContext);
}

/** Translate an English UI string into the active language. */
export function useT() {
  const { lang } = useContext(LanguageContext);
  return useCallback((s: string) => (lang === "uk" ? (UK[s] ?? s) : s), [lang]);
}

/** Pick a Ukrainian database value when available, otherwise the English one. */
export function usePick() {
  const { lang } = useContext(LanguageContext);
  return useCallback(
    (en: string | null | undefined, uk: string | null | undefined) =>
      (lang === "uk" ? (uk?.trim() ? uk : en) : en) ?? "",
    [lang],
  );
}
