import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type Lang = "en" | "uk";

/** Returns the signed-in user's chosen app language, or null if never chosen. */
export const getMyLanguage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("profiles")
      .select("language")
      .eq("id", context.userId)
      .maybeSingle();
    return { language: ((data as any)?.language ?? null) as Lang | null };
  });

export const setMyLanguage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ language: z.enum(["en", "uk"]) }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ language: data.language } as any)
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const, language: data.language };
  });
