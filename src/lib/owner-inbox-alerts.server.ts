import { OUTLOOK_SENDER } from "./owner-email-events";
import { photoAlertClaimId } from "./photo-upload-alerts";
import { inboxAlertSubject, inboxAlertText, needsEnglishTranslation, type InboxAlertInput } from "./owner-inbox-alerts";

/** Ukrainian -> English through the Lovable AI gateway; null when it cannot translate. */
export async function translateToEnglish(text: string): Promise<string | null> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey || !needsEnglishTranslation(text)) return null;
  try {
    const { createOpenAI } = await import("@ai-sdk/openai");
    const { streamText } = await import("ai");
    const provider = createOpenAI({
      baseURL: "https://ai.gateway.lovable.dev/v1",
      apiKey,
      headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    });
    const result = streamText({
      model: provider.responses("openai/gpt-6-astra"),
      instructions: "Translate the user's message from Ukrainian (or any other language) into natural English. Reply with only the English translation, nothing else. Keep names, dates, times and numbers exactly.",
      messages: [{ role: "user", content: text }],
      providerOptions: {
        openai: {
          forceReasoning: true,
          reasoningEffort: "low",
          reasoningSummary: "auto",
          store: false,
          include: ["reasoning.encrypted_content"],
        },
      },
    });
    let out = "";
    for await (const chunk of result.textStream) out += chunk;
    return out.trim() || null;
  } catch (e) {
    console.error("Translation failed", e instanceof Error ? e.message : e);
    return null;
  }
}

export type InboxAlertRequest = Omit<InboxAlertInput, "translation" | "translationFailed"> & {
  tenantId: string;
  actorId: string | null;
  entityType: string;
  /** Unique per incoming item, so the same message never emails twice. */
  eventKey: string;
  entityId: string;
};

/**
 * Emails the business owner's mailbox about something that came into the app.
 * Runs after the item is saved; never throws, so a mail problem never blocks the sender.
 */
export async function notifyOwnerInbox(req: InboxAlertRequest): Promise<{ translation: string | null }> {
  let translation: string | null = null;
  try {
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: owners } = await db.from("user_roles").select("user_id").eq("tenant_id", req.tenantId).eq("role", "owner");
    const ownerIds = (owners ?? []).map((o) => o.user_id);
    if (!ownerIds.length) return { translation };
    const { data: recipient } = await db.from("profiles").select("id,email").eq("tenant_id", req.tenantId).eq("is_active", true).in("id", ownerIds).ilike("email", OUTLOOK_SENDER).limit(1).maybeSingle();
    if (!recipient?.email) return { translation };

    const claimId = await photoAlertClaimId(`inbox-email:${req.eventKey}`);
    const base = { kind: req.kind, from: req.from, receivedAt: req.receivedAt };
    const { error: claim } = await db.from("activity_log").insert({ id: claimId, tenant_id: req.tenantId, actor_id: req.actorId, entity_type: req.entityType, entity_id: req.entityId, action_type: "system:inbox-email-sending", description: JSON.stringify({ ...base, status: "sending" }) });
    if (claim?.code === "23505") return { translation };
    if (claim) throw new Error(claim.message);

    const wantsTranslation = needsEnglishTranslation(req.message);
    translation = wantsTranslation ? await translateToEnglish(req.message) : null;
    let status = "failed";
    let failure: string | null = null;
    try {
      const { sendOutlookAlert } = await import("./outlook-email.server");
      await sendOutlookAlert(recipient.email, `${inboxAlertSubject(req.kind, req.from)} — WRRCS`, inboxAlertText({ ...req, translation, translationFailed: wantsTranslation && !translation }));
      status = "accepted";
    } catch (e) {
      failure = e instanceof Error ? e.message : "Outlook send failed";
    }
    const { error } = await db.from("activity_log").update({ action_type: `system:inbox-email-${status}`, description: JSON.stringify({ ...base, status, translated: !!translation, error: failure }) }).eq("id", claimId);
    if (error) console.error("Inbox email log failed", error.message);
  } catch (e) {
    console.error("Owner inbox alert failed", e instanceof Error ? e.message : e);
  }
  return { translation };
}
