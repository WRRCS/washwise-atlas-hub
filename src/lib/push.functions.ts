import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getVapidPublicKey = createServerFn({ method: "GET" }).handler(async () => {
  const pub = process.env.VAPID_PUBLIC_KEY;
  if (!pub) throw new Error("Push notifications not configured");
  return { publicKey: pub };
});

const subInput = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
  user_agent: z.string().optional(),
});

export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => subInput.parse(input))
  .handler(async ({ data, context }) => {
    // Look up caller's tenant
    const { data: role } = await context.supabase
      .from("user_roles")
      .select("tenant_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!role?.tenant_id) throw new Error("No tenant for user");

    const { error } = await context.supabase
      .from("push_subscriptions" as any)
      .upsert(
        {
          tenant_id: role.tenant_id,
          user_id: context.userId,
          endpoint: data.endpoint,
          p256dh: data.p256dh,
          auth: data.auth,
          user_agent: data.user_agent ?? null,
          last_used_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deletePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ endpoint: z.string().url() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("push_subscriptions" as any)
      .delete()
      .eq("user_id", context.userId)
      .eq("endpoint", data.endpoint);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const sendTestPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: subs, error } = await supabaseAdmin
      .from("push_subscriptions" as any)
      .select("endpoint,p256dh,auth")
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    if (!subs || subs.length === 0) {
      throw new Error("No push devices registered on this account.");
    }
    const { sendWebPush } = await import("./push.server");
    let sent = 0;
    const goneEndpoints: string[] = [];
    for (const s of subs as any[]) {
      try {
        const result = await sendWebPush(
          { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth },
          { title: "Atlas test", body: "Push notifications are working.", url: "/my-jobs" },
        );
        if (result === "sent") sent += 1;
        if (result === "gone") goneEndpoints.push(s.endpoint);
      } catch (e) {
        // ignore individual failures for test
      }
    }
    if (goneEndpoints.length > 0) {
      await supabaseAdmin.from("push_subscriptions" as any).delete().in("endpoint", goneEndpoints);
    }
    return { sent, devices: subs.length };
  });
