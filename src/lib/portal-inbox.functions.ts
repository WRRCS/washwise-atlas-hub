import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Client-portal sends go through the server so the owner gets an email after the save. */
async function clientInfo(clientId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("clients").select("tenant_id, first_name, last_name").eq("id", clientId).maybeSingle();
  if (!data) return null;
  return { tenantId: data.tenant_id as string, name: [data.first_name, data.last_name].filter(Boolean).join(" ").trim() || "Client" };
}

export const portalSendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ client_id: z.string().uuid(), body: z.string().trim().min(1).max(4000) }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: id, error } = await context.supabase.rpc("portal_send_message", { _client_id: data.client_id, _body: data.body });
    if (error) throw new Error(error.message);
    const client = await clientInfo(data.client_id);
    if (client && id) {
      const { notifyOwnerInbox } = await import("@/lib/owner-inbox-alerts.server");
      await notifyOwnerInbox({
        tenantId: client.tenantId, actorId: context.userId, entityType: "client_message", entityId: String(id),
        eventKey: `client_message:${id}`, kind: "client_message", from: client.name, receivedAt: new Date().toISOString(),
        details: [["Sent through", "Client chat (client portal)"]],
        message: data.body, link: `https://wrrcs.com/client-chat`, linkLabel: "Open client chat",
      });
    }
    return { ok: true };
  });

export const portalRequestService = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ client_id: z.string().uuid(), requested_date: z.string().nullable(), notes: z.string().max(4000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: id, error } = await context.supabase.rpc("portal_request_service", {
      _client_id: data.client_id,
      _service_type_id: null as unknown as string,
      _requested_date: (data.requested_date || null) as unknown as string,
      _notes: data.notes,
    });
    if (error) throw new Error(error.message);
    const client = await clientInfo(data.client_id);
    if (client && id) {
      const { formatDateRange } = await import("@/lib/owner-inbox-alerts");
      const { notifyOwnerInbox } = await import("@/lib/owner-inbox-alerts.server");
      await notifyOwnerInbox({
        tenantId: client.tenantId, actorId: context.userId, entityType: "client_service_request", entityId: String(id),
        eventKey: `client_request:${id}`, kind: "client_request", from: client.name, receivedAt: new Date().toISOString(),
        details: [["Requested date", data.requested_date ? formatDateRange(data.requested_date, data.requested_date).replace(" (1 day)", "") : "Not given"]],
        message: data.notes.trim() || "(No notes)", messageLabel: "Notes",
        link: `https://wrrcs.com/clients/${data.client_id}`, linkLabel: "Open client",
      });
    }
    return { ok: true };
  });
