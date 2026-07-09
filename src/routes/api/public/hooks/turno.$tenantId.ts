import { createFileRoute } from "@tanstack/react-router";

// Turno inbound webhook. External URL:
//   POST /api/public/hooks/turno/:tenantId
// Turno (or a Zapier/Make step) must send:
//   Header  X-Turno-Signature: hex(sha256_hmac(webhook_secret, raw_body))
//   Body    JSON with reservation fields (see parseReservation below)
//
// Every failure lands in public.integration_errors so owners can see what went wrong.

type Reservation = {
  reservation_id: string;
  event?: string; // reservation.created | reservation.updated | reservation.cancelled
  property_address: string;
  checkin_at: string;   // ISO
  checkout_at: string;  // ISO
  guest_name?: string | null;
  guest_email?: string | null;
  guest_phone?: string | null;
  property_name?: string | null;
};

function normalizeAddress(a: string | null | undefined) {
  return (a ?? "")
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function streetKey(a: string) {
  // "123 Main St Apt 4, Austin TX" → "123 main st"
  const norm = normalizeAddress(a);
  const firstLine = norm.split(",")[0] ?? norm;
  return firstLine.split(" ").slice(0, 4).join(" ");
}

async function hmacHex(secret: string, body: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function parseReservation(raw: any): Reservation | null {
  if (!raw || typeof raw !== "object") return null;
  // Try a few common shapes.
  const r = raw.reservation ?? raw.data ?? raw;
  const id = r.id ?? r.reservation_id ?? r.uid;
  const address = r.property_address ?? r.address ?? r.property?.address ?? r.listing?.address;
  const checkin = r.checkin_at ?? r.check_in ?? r.checkin ?? r.start_at;
  const checkout = r.checkout_at ?? r.check_out ?? r.checkout ?? r.end_at;
  if (!id || !address || !checkin || !checkout) return null;
  return {
    reservation_id: String(id),
    event: raw.event ?? raw.type,
    property_address: String(address),
    checkin_at: String(checkin),
    checkout_at: String(checkout),
    guest_name: r.guest_name ?? r.guest?.name ?? null,
    guest_email: r.guest_email ?? r.guest?.email ?? null,
    guest_phone: r.guest_phone ?? r.guest?.phone ?? null,
    property_name: r.property_name ?? r.property?.name ?? null,
  };
}

export const Route = createFileRoute("/api/public/hooks/turno/$tenantId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const tenantId = params.tenantId;
        const rawBody = await request.text();
        const signature = request.headers.get("x-turno-signature") ?? request.headers.get("x-webhook-signature") ?? "";

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Look up the tenant's Turno secret
        const { data: integ } = await supabaseAdmin
          .from("integrations")
          .select("settings, is_connected")
          .eq("tenant_id", tenantId).eq("provider", "turno").maybeSingle();

        const secret = (integ?.settings as { webhook_secret?: string } | null)?.webhook_secret;
        if (!integ?.is_connected || !secret) {
          return new Response("Turno not connected", { status: 404 });
        }

        const expected = await hmacHex(secret, rawBody);
        const provided = signature.replace(/^sha256=/, "").trim().toLowerCase();
        if (!provided || !timingSafeEqual(expected, provided)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: any = null;
        try { payload = JSON.parse(rawBody); } catch { /* ignore */ }
        const reservation = parseReservation(payload);
        if (!reservation) {
          await supabaseAdmin.from("integration_errors").insert({
            tenant_id: tenantId, source: "turno",
            error_message: "Unrecognized reservation payload",
            inbound_payload: payload ?? { raw: rawBody.slice(0, 2000) },
          });
          return Response.json({ ok: false, reason: "unrecognized_payload" }, { status: 200 });
        }

        // Cancellation → cancel matching job(s) if any
        if (reservation.event && /cancel/i.test(reservation.event)) {
          await supabaseAdmin.from("jobs")
            .update({ status: "canceled" })
            .eq("tenant_id", tenantId)
            .eq("external_source", "turno")
            .eq("external_id", reservation.reservation_id)
            .neq("status", "completed");
          return Response.json({ ok: true, action: "canceled" });
        }

        const timing = (integ.settings as { grace_hours?: number; duration_hours?: number } | null) ?? {};
        const graceH = typeof timing.grace_hours === "number" ? timing.grace_hours : 2;
        const durationH = typeof timing.duration_hours === "number" ? timing.duration_hours : 3;

        const checkout = new Date(reservation.checkout_at);
        if (Number.isNaN(checkout.getTime())) {
          await supabaseAdmin.from("integration_errors").insert({
            tenant_id: tenantId, source: "turno",
            error_message: `Invalid checkout_at: ${reservation.checkout_at}`,
            inbound_payload: payload,
          });
          return Response.json({ ok: false }, { status: 200 });
        }
        const start = new Date(checkout.getTime() + graceH * 60 * 60 * 1000);
        const end = new Date(start.getTime() + durationH * 60 * 60 * 1000);

        // Idempotency: same reservation already processed
        const { data: existing } = await supabaseAdmin
          .from("jobs").select("id")
          .eq("tenant_id", tenantId)
          .eq("external_source", "turno")
          .eq("external_id", reservation.reservation_id)
          .maybeSingle();
        if (existing) {
          return Response.json({ ok: true, action: "duplicate_skipped", job_id: existing.id });
        }

        // Also dedupe on (property_key + date) in case reservation IDs shifted
        const startDate = start.toISOString().slice(0, 10);
        const { data: sameDay } = await supabaseAdmin
          .from("jobs")
          .select("id, client:clients!inner(service_address)")
          .eq("tenant_id", tenantId)
          .gte("scheduled_start", `${startDate}T00:00:00Z`)
          .lte("scheduled_start", `${startDate}T23:59:59Z`);
        const propKey = streetKey(reservation.property_address);
        if ((sameDay ?? []).some((j: any) => streetKey(j.client?.service_address ?? "") === propKey)) {
          await supabaseAdmin.from("integration_errors").insert({
            tenant_id: tenantId, source: "turno",
            error_message: "Duplicate turnover for property on this date — skipped",
            inbound_payload: payload,
          });
          return Response.json({ ok: true, action: "duplicate_date_skipped" });
        }

        // Match client by address
        const target = normalizeAddress(reservation.property_address);
        const { data: clients } = await supabaseAdmin
          .from("clients")
          .select("id, first_name, last_name, service_address, is_airbnb_host")
          .eq("tenant_id", tenantId);

        let clientId: string | null = null;
        const exact = (clients ?? []).find((c: any) => normalizeAddress(c.service_address) === target);
        if (exact) {
          clientId = exact.id;
        } else {
          const fuzzy = (clients ?? []).filter((c: any) => {
            const k = streetKey(c.service_address ?? "");
            return k.length > 3 && k === propKey;
          });
          if (fuzzy.length === 1) {
            clientId = fuzzy[0].id;
          } else if (fuzzy.length > 1) {
            // ambiguous — surface for manual resolution
            await supabaseAdmin.from("integration_errors").insert({
              tenant_id: tenantId, source: "turno",
              error_message: `Ambiguous address match for "${reservation.property_address}" — ${fuzzy.length} candidates. Confirm client, then reprocess.`,
              inbound_payload: payload,
            });
            return Response.json({ ok: false, reason: "ambiguous_match" }, { status: 200 });
          }
        }

        if (!clientId) {
          // Create a new Airbnb host client
          const guestFirst = reservation.property_name ?? "Airbnb";
          const { data: created, error: cErr } = await supabaseAdmin
            .from("clients")
            .insert({
              tenant_id: tenantId,
              first_name: guestFirst,
              last_name: "Host",
              service_address: reservation.property_address,
              billing_address: reservation.property_address,
              is_airbnb_host: true,
              is_active: true,
            })
            .select("id").single();
          if (cErr || !created) {
            await supabaseAdmin.from("integration_errors").insert({
              tenant_id: tenantId, source: "turno",
              error_message: `Failed to create client: ${cErr?.message ?? "unknown"}`,
              inbound_payload: payload,
            });
            return Response.json({ ok: false }, { status: 200 });
          }
          clientId = created.id;
        }

        // Find Airbnb Turnover service type
        const { data: svc } = await supabaseAdmin
          .from("service_types")
          .select("id, default_price_cents, default_duration_minutes")
          .eq("tenant_id", tenantId)
          .eq("kind", "airbnb_turnover")
          .eq("active", true)
          .order("created_at", { ascending: true })
          .limit(1).maybeSingle();
        if (!svc) {
          await supabaseAdmin.from("integration_errors").insert({
            tenant_id: tenantId, source: "turno",
            error_message: "No active 'airbnb_turnover' service type — create one in Services.",
            inbound_payload: payload,
          });
          return Response.json({ ok: false }, { status: 200 });
        }

        const { data: job, error: jErr } = await supabaseAdmin
          .from("jobs")
          .insert({
            tenant_id: tenantId,
            client_id: clientId,
            service_type_id: svc.id,
            scheduled_start: start.toISOString(),
            scheduled_end: end.toISOString(),
            status: "scheduled",
            price_cents: svc.default_price_cents ?? 0,
            external_source: "turno",
            external_id: reservation.reservation_id,
            external_metadata: {
              guest_name: reservation.guest_name,
              guest_email: reservation.guest_email,
              guest_phone: reservation.guest_phone,
              property_name: reservation.property_name,
              checkin_at: reservation.checkin_at,
              checkout_at: reservation.checkout_at,
            },
          })
          .select("id").single();

        if (jErr || !job) {
          await supabaseAdmin.from("integration_errors").insert({
            tenant_id: tenantId, source: "turno",
            error_message: `Failed to create job: ${jErr?.message ?? "unknown"}`,
            inbound_payload: payload,
          });
          return Response.json({ ok: false }, { status: 200 });
        }

        // Notify tenant owners
        const { data: owners } = await supabaseAdmin
          .from("user_roles").select("user_id")
          .eq("tenant_id", tenantId).eq("role", "owner");
        for (const o of owners ?? []) {
          await supabaseAdmin.rpc("enqueue_notification", {
            _tenant: tenantId,
            _recipient_type: "owner",
            _recipient_id: o.user_id,
            _channel: "email",
            _template_name: "turno_job_created_owner",
            _payload: {
              job_id: job.id,
              address: reservation.property_address,
              scheduled_start: start.toISOString(),
              guest_name: reservation.guest_name,
            },
            _scheduled_for: new Date().toISOString(),
          });
        }

        return Response.json({ ok: true, action: "created", job_id: job.id });
      },
    },
  },
});
