import { createFileRoute } from "@tanstack/react-router";

// Public — Intuit redirects the user's browser here after they approve.
// URL shape: /api/public/qbo/callback?code=&state=&realmId=
export const Route = createFileRoute("/api/public/qbo/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const realmId = url.searchParams.get("realmId");
        const error = url.searchParams.get("error");

        const back = (msg: string) =>
          new Response(null, { status: 302, headers: { Location: `/settings/integrations?qbo=${encodeURIComponent(msg)}` } });

        if (error) return back(`error:${error}`);
        if (!code || !state || !realmId) return back("error:missing_params");

        const { verifyState, exchangeCode, admin, qboApiBase, qboEnv } = await import("@/lib/qbo.server");
        const v = await verifyState(state);
        if (!v) return back("error:invalid_state");

        let tokens;
        try {
          tokens = await exchangeCode(code);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[qbo callback] token exchange failed:", msg);
          return back(`error:token_exchange:${msg.slice(0, 120)}`);
        }

        // Best-effort: pull company name for display.
        let companyName: string | null = null;
        try {
          const r = await fetch(`${qboApiBase()}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=70`, {
            headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: "application/json" },
          });
          if (r.ok) {
            const j = await r.json() as { CompanyInfo?: { CompanyName?: string } };
            companyName = j.CompanyInfo?.CompanyName ?? null;
          } else {
            console.error("[qbo callback] companyinfo fetch failed:", r.status, (await r.text()).slice(0, 200));
          }
        } catch (e) {
          console.error("[qbo callback] companyinfo error:", e);
        }

        const sb = admin();
        const now = Math.floor(Date.now() / 1000);
        const settings = {
          environment: qboEnv(),
          company_name: companyName,
          access_expires_at: now + tokens.expires_in,
        };

        const { error: upErr, count } = await sb.from("integrations").update({
          is_connected: true,
          connected_at: new Date().toISOString(),
          external_account_id: realmId,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          settings: settings as any,
        }, { count: "exact" }).eq("tenant_id", v.tenantId).eq("provider", "quickbooks");

        if (upErr) {
          console.error("[qbo callback] save failed:", upErr);
          return back(`error:save_failed:${upErr.message.slice(0, 120)}`);
        }
        if (!count) {
          // No integration row existed — insert one.
          const { error: insErr } = await sb.from("integrations").insert({
            tenant_id: v.tenantId,
            provider: "quickbooks",
            is_connected: true,
            connected_at: new Date().toISOString(),
            external_account_id: realmId,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            settings: settings as any,
          });
          if (insErr) {
            console.error("[qbo callback] insert failed:", insErr);
            return back(`error:save_failed:${insErr.message.slice(0, 120)}`);
          }
        }
        return back("connected");
      },
    },
  },
});
