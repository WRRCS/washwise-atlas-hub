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
          return back(`error:token_exchange`);
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
          }
        } catch { /* ignore */ }

        const sb = admin();
        const now = Math.floor(Date.now() / 1000);
        const settings = {
          environment: qboEnv(),
          company_name: companyName,
          access_expires_at: now + tokens.expires_in,
        };

        const { error: upErr } = await sb.from("integrations").update({
          is_connected: true,
          connected_at: new Date().toISOString(),
          external_account_id: realmId,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          settings: settings as any,
        }).eq("tenant_id", v.tenantId).eq("provider", "quickbooks");

        if (upErr) return back(`error:save_failed`);
        return back("connected");
      },
    },
  },
});
