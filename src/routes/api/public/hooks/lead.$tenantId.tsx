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

        // Basic length caps to protect the DB from junk submissions.
        const clip = (v: unknown, max = 500): string | null => {
          if (v === undefined || v === null) return null;
          const s = String(v).trim();
          if (!s) return null;
          return s.slice(0, max);
        };

        const rawName = clip(payload.name ?? payload.full_name ?? "", 200) ?? "";
        const [first, ...rest] = rawName.split(/\s+/);
        const email = clip(payload.email, 255);
        const phone = clip(payload.phone, 60);
        const message = clip(payload.message ?? payload.notes, 2000);
        const service = clip(payload.service ?? payload.service_type ?? payload.subject, 200);
        const source = clip(payload.source, 60) ?? "godaddy_website";
        const isTest = String(payload._test ?? "").toLowerCase() === "true";

        // Create the client record so existing screens (Clients) still work.
        const { data: newClient, error: clientErr } = await admin.from("clients").insert({
          tenant_id: tenantId,
          first_name: first || null,
          last_name: rest.join(" ") || null,
          email,
          phone,
          notes: [
            `Lead from ${source}${isTest ? " (TEST)" : ""}`,
            service ? `Interested in: ${service}` : null,
            message ? `Message:\n${message}` : null,
          ].filter(Boolean).join("\n\n"),
        } as never).select("id").maybeSingle();
        if (clientErr) return new Response(clientErr.message, { status: 500 });

        // Create the lead record for lifecycle tracking.
        const { error: leadErr } = await admin.from("leads").insert({
          tenant_id: tenantId,
          client_id: newClient?.id ?? null,
          source,
          status: "new",
          service_interest: service,
          notes: message,
          payload: { ...payload, _received_at: new Date().toISOString() },
        } as never);
        if (leadErr) return new Response(leadErr.message, { status: 500 });

        // Notify tenant owners.
        const { data: owners } = await admin
          .from("user_roles")
          .select("user_id")
          .eq("tenant_id", tenantId)
          .eq("role", "owner");
        if (owners && owners.length > 0) {
          const displayName = rawName || email || phone || "Unknown lead";
          const rows = owners.map((o: { user_id: string }) => ({
            tenant_id: tenantId,
            recipient_type: "employee" as const,
            recipient_id: o.user_id,
            channel: "email" as const,
            template_name: "new_lead_owner",
            payload: {
              subject: `New website lead: ${displayName}${isTest ? " (TEST)" : ""}`,
              body_text: [
                `New lead received from ${source}${isTest ? " (TEST submission)" : ""}.`,
                ``,
                `Name: ${displayName}`,
                email ? `Email: ${email}` : null,
                phone ? `Phone: ${phone}` : null,
                service ? `Service interest: ${service}` : null,
                message ? `Message:\n${message}` : null,
              ].filter(Boolean).join("\n"),
              client_id: newClient?.id ?? null,
            },
            scheduled_for: new Date().toISOString(),
          }));
          await admin.from("notifications").insert(rows as never);
        }

        return new Response(JSON.stringify({ ok: true, test: isTest }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
