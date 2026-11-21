import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { isAppUrl } from "@/lib/app-origin";

/**
 * Client portal sign-in link. The "is this a client?" check happens here on the server and the
 * answer is never returned, so nobody can use the sign-in box to find out who is a client.
 */
export const requestPortalSignIn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ email: z.string().trim().toLowerCase().email().max(255), origin: z.string().url().max(300) }).parse(input),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    if (!isAppUrl(data.origin)) return { ok: true };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: match } = await supabaseAdmin
      .from("clients").select("id").ilike("email", data.email.replace(/[\\%_]/g, (c) => `\\${c}`)).eq("is_active", true).limit(1);
    if (!match?.length) return { ok: true };

    const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
    const sb = createClient(process.env["SUPABASE_URL"]!, key, {
      auth: { persistSession: false, autoRefreshToken: false, storage: undefined, flowType: "implicit" },
      global: {
        fetch: (input, init) => {
          const h = new Headers(init?.headers);
          if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
          h.set("apikey", key);
          return fetch(input, { ...init, headers: h });
        },
      },
    });
    const { error } = await sb.auth.signInWithOtp({
      email: data.email,
      options: {
        shouldCreateUser: true,
        data: { portal_client: true },
        emailRedirectTo: `${new URL(data.origin).origin}/portal/dashboard`,
      },
    });
    if (error) console.error("portal sign-in link failed", error.message);
    return { ok: true };
  });
