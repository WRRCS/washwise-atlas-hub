import { createFileRoute } from "@tanstack/react-router";
import { verifyTwilioSignature } from "@/lib/twilio-signature.server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { runVoiceTurn, xmlEscape, type VoiceChatMsg } from "@/lib/voice-ai.server";

// Twilio POSTs here after each caller utterance is transcribed.
export const Route = createFileRoute("/api/public/twilio/voice/$tenantId/gather")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const tenantId = params.tenantId;
        const form = await request.formData();
        // Reject anything not signed by Twilio with our account auth token.
        if (!verifyTwilioSignature(request, form)) {
          return new Response("Invalid signature", { status: 403 });
        }
        const callSid = String(form.get("CallSid") ?? "");
        const speech = String(form.get("SpeechResult") ?? "").trim();
        const from = String(form.get("From") ?? "");

        const admin = createClient<Database>(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );

        const { data: cfg } = await admin
          .from("voice_agent_config").select("voice, language, forward_number")
          .eq("tenant_id", tenantId).maybeSingle();
        const voice = cfg?.voice || "Polly.Joanna";
        const lang = cfg?.language || "en-US";

        const { data: call } = await admin
          .from("voice_calls").select("id").eq("call_sid", callSid).eq("tenant_id", tenantId).maybeSingle();
        if (!call) return twiml(sayHangup(voice, lang, "I lost track of this call. Goodbye."));

        const { data: existingTurns } = await admin
          .from("voice_call_turns")
          .select("seq, role, content, tool_name, tool_args, tool_result")
          .eq("call_id", call.id).order("seq", { ascending: true });
        const turns = existingTurns ?? [];
        const nextSeq = (turns[turns.length - 1]?.seq ?? -1) + 1;

        // Save the user turn
        if (speech) {
          await admin.from("voice_call_turns").insert({
            tenant_id: tenantId, call_id: call.id, seq: nextSeq,
            role: "user", content: speech,
          } as never);
        }

        // Rebuild messages for the model
        const messages: VoiceChatMsg[] = [];
        for (const t of turns) {
          if (t.role === "system" || t.role === "user") {
            if (t.content) messages.push({ role: t.role as "system" | "user", content: t.content });
          } else if (t.role === "assistant") {
            if (t.tool_name) {
              messages.push({
                role: "assistant",
                content: t.content ?? null,
                tool_calls: [{
                  id: `call_${t.seq}`,
                  type: "function",
                  function: { name: t.tool_name, arguments: JSON.stringify(t.tool_args ?? {}) },
                }],
              });
            } else if (t.content) {
              messages.push({ role: "assistant", content: t.content });
            }
          } else if (t.role === "tool") {
            messages.push({
              role: "tool",
              tool_call_id: `call_${t.seq - 1}`,
              content: JSON.stringify(t.tool_result ?? {}),
            });
          }
        }
        if (speech) messages.push({ role: "user", content: speech });

        // Run the model (with a small safety loop for tool calls)
        let assistantSeq = nextSeq + 1;
        let finalReply = "";
        let action: "gather" | "hangup" | "transfer" = "gather";
        let transferNumber = "";

        for (let step = 0; step < 3; step++) {
          let result;
          try {
            result = await runVoiceTurn(messages);
          } catch (e: any) {
            const msg = "I'm having trouble right now. Please call back in a moment.";
            await admin.from("voice_call_turns").insert({
              tenant_id: tenantId, call_id: call.id, seq: assistantSeq,
              role: "assistant", content: msg,
            } as never);
            return twiml(sayHangup(voice, lang, msg));
          }

          if (result.tool_calls.length > 0) {
            for (const tc of result.tool_calls) {
              let toolResult: Record<string, unknown> = { ok: false };
              if (tc.name === "save_caller_info") {
                toolResult = await saveCallerInfo(admin, tenantId, call.id, from, tc.args);
              } else if (tc.name === "end_call") {
                action = "hangup";
                finalReply = String(tc.args.farewell ?? "Thanks for calling. Goodbye.");
                toolResult = { ok: true };
              } else if (tc.name === "transfer_to_human") {
                if (cfg?.forward_number) {
                  action = "transfer";
                  transferNumber = cfg.forward_number;
                  finalReply = "Connecting you now.";
                  toolResult = { ok: true, transferred_to: cfg.forward_number };
                } else {
                  toolResult = { ok: false, error: "No forward number configured" };
                }
              }

              // Record assistant tool_call turn + tool result turn
              await admin.from("voice_call_turns").insert({
                tenant_id: tenantId, call_id: call.id, seq: assistantSeq,
                role: "assistant", content: result.reply,
                tool_name: tc.name, tool_args: tc.args as never,
              } as never);
              await admin.from("voice_call_turns").insert({
                tenant_id: tenantId, call_id: call.id, seq: assistantSeq + 1,
                role: "tool", tool_name: tc.name, tool_result: toolResult as never,
              } as never);
              messages.push({
                role: "assistant",
                content: result.reply,
                tool_calls: [{ id: tc.id, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.args) } }],
              });
              messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(toolResult) });
              assistantSeq += 2;
            }
            if (action !== "gather") break;
            continue; // ask model for the next reply after tool results
          }

          finalReply = result.reply ?? "I'm sorry, I didn't catch that.";
          await admin.from("voice_call_turns").insert({
            tenant_id: tenantId, call_id: call.id, seq: assistantSeq,
            role: "assistant", content: finalReply,
          } as never);
          break;
        }

        if (action === "hangup") {
          return twiml(sayHangup(voice, lang, finalReply));
        }
        if (action === "transfer") {
          return twiml(
`<Response>
  <Say voice="${xmlEscape(voice)}" language="${xmlEscape(lang)}">${xmlEscape(finalReply)}</Say>
  <Dial>${xmlEscape(transferNumber)}</Dial>
</Response>`);
        }

        const gatherUrl = `/api/public/twilio/voice/${tenantId}/gather`;
        return twiml(
`<Response>
  <Gather input="speech" action="${gatherUrl}" method="POST" speechTimeout="auto" language="${xmlEscape(lang)}">
    <Say voice="${xmlEscape(voice)}" language="${xmlEscape(lang)}">${xmlEscape(finalReply)}</Say>
  </Gather>
  <Say voice="${xmlEscape(voice)}" language="${xmlEscape(lang)}">Are you still there? Goodbye.</Say>
  <Hangup/>
</Response>`);
      },
    },
  },
});

async function saveCallerInfo(
  admin: ReturnType<typeof createClient<Database>>,
  tenantId: string,
  callId: string,
  fromNumber: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const name = String(args.name ?? "").trim();
  const phone = String(args.phone ?? fromNumber ?? "").trim() || null;
  const email = String(args.email ?? "").trim() || null;
  const address = String(args.address ?? "").trim() || null;
  const service = String(args.service_interest ?? "").trim() || null;
  const notes = String(args.notes ?? "").trim() || null;
  const [first, ...rest] = name.split(/\s+/);

  const { data: newClient, error: ce } = await admin.from("clients").insert({
    tenant_id: tenantId,
    first_name: first || null,
    last_name: rest.join(" ") || null,
    email, phone,
    service_address: address,
    notes: [
      "Lead from voice AI",
      service ? `Interested in: ${service}` : null,
      notes ? `Notes: ${notes}` : null,
    ].filter(Boolean).join("\n\n"),
  } as never).select("id").maybeSingle();
  if (ce) return { ok: false, error: ce.message };

  const { data: newLead, error: le } = await admin.from("leads").insert({
    tenant_id: tenantId,
    client_id: newClient?.id ?? null,
    source: "voice_ai",
    status: "new",
    service_interest: service,
    notes,
    payload: { ...args, from_number: fromNumber, _received_at: new Date().toISOString() },
  } as never).select("id").maybeSingle();
  if (le) return { ok: false, error: le.message };

  if (newLead?.id) {
    await admin.from("voice_calls").update({ lead_id: newLead.id } as never).eq("id", callId);
  }

  return { ok: true, lead_id: newLead?.id, client_id: newClient?.id };
}

function twiml(body: string): Response {
  return new Response(body, { headers: { "Content-Type": "text/xml; charset=utf-8" } });
}

function sayHangup(voice: string, lang: string, msg: string): string {
  return `<Response><Say voice="${xmlEscape(voice)}" language="${xmlEscape(lang)}">${xmlEscape(msg)}</Say><Hangup/></Response>`;
}
