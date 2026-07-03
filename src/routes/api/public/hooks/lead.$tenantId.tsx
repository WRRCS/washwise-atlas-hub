import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Public webhook — GoDaddy (or any external form) POSTs a lead here.
// URL shape: /api/public/hooks/lead/:tenantId?token=xxx
// Payload: { name, email, phone, message, service }
export const Route = createFileRoute("/api/public/hooks/lead/$tenantId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token") ?? "";
        const tenantId = params.tenantId;

        const admin = createClient<Database>(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );

        const { data: integ } = await admin
          .from("integrations")
          .select("settings, is_connected")
          .eq("tenant_id", tenantId)
          .eq("provider", "godaddy")
          .maybeSingle();

        const expected = (integ?.settings as { webhook_token?: string } | null)?.webhook_token;
        if (!expected || !token || token !== expected) {
          return new Response("Invalid token", { status: 401 });
        }
        if (!integ?.is_connected) {
          return new Response("Integration not enabled", { status: 403 });
        }

        let payload: Record<string, unknown> = {};
        try {
          const ct = request.headers.get("content-type") ?? "";
          if (ct.includes("application/json")) {
            payload = (await request.json()) as Record<string, unknown>;
          } else {
            const form = await request.formData();
            for (const [k, v] of form.entries()) payload[k] = typeof v === "string" ? v : v.name;
          }
        } catch { /* ignore */ }

        const name = String(payload.name ?? payload.full_name ?? "").trim();
        const [first, ...rest] = name.split(/\s+/);
        const { error } = await admin.from("clients").insert({
          tenant_id: tenantId,
          first_name: first || null,
          last_name: rest.join(" ") || null,
          email: payload.email ? String(payload.email) : null,
          phone: payload.phone ? String(payload.phone) : null,
          notes: `Lead from GoDaddy website\n\n${JSON.stringify(payload, null, 2)}`,
        } as never);
        if (error) return new Response(error.message, { status: 500 });
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
