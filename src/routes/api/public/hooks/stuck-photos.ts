import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

// Cron endpoint: emails the owner about cleaner photos that reached storage but
// never finished saving to their cleaning. Called by pg_cron with the private scheduler secret.
export const Route = createFileRoute("/api/public/hooks/stuck-photos")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.PUSH_CRON_SECRET;
        const provided = request.headers.get("x-cron-secret");
        if (!expected || !provided) return new Response("Unauthorized", { status: 401 });
        const a = Buffer.from(provided);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { alertStuckPhotos } = await import("@/lib/stuck-photo-alerts.server");
        try {
          const result = await alertStuckPhotos(supabaseAdmin);
          return Response.json({ ok: true, ...result });
        } catch (err) {
          return Response.json({ ok: false, error: err instanceof Error ? err.message : "failed" }, { status: 500 });
        }
      },
    },
  },
});
