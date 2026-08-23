import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

// Cron endpoint: rolls recurring job series forward so future schedules stay
// populated. Called by pg_cron daily. Auth via private shared secret header.

export const Route = createFileRoute("/api/public/hooks/extend-recurring")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.PUSH_CRON_SECRET;
        const provided = request.headers.get("x-cron-secret");
        if (!expected || !provided) return new Response("Unauthorized", { status: 401 });
        const a = Buffer.from(provided);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { extendRecurringSeries } = await import("@/lib/recurrence.server");
        try {
          const result = await extendRecurringSeries(supabaseAdmin, { maxGroups: 200 });
          return new Response(JSON.stringify({ ok: true, ...result }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (err) {
          return new Response(
            JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "failed" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
