// Server-only helper for the voice agent's LLM turn.
// Uses Lovable AI Gateway (Gemini 2.5 Flash) with OpenAI-compatible tool calling.
// Swap this file to change the underlying AI stack (OpenAI Realtime, ElevenLabs, etc.);
// the Twilio routes and DB schema stay the same.

const MODEL = "google/gemini-2.5-flash";
const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

export type VoiceChatMsg =
  | { role: "system" | "user" | "assistant"; content: string }
  | { role: "assistant"; content: string | null; tool_calls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; tool_call_id: string; content: string };

export const VOICE_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "save_caller_info",
      description: "Save the caller's contact and service request details as a new lead. Call this ONLY after you have collected at least a name and phone (or address).",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Full name of caller" },
          phone: { type: "string", description: "Callback phone number in any format" },
          address: { type: "string", description: "Service address if provided" },
          email: { type: "string", description: "Email if provided" },
          service_interest: { type: "string", description: "What service they want (e.g. 'weekly cleaning', 'lawn mowing')" },
          notes: { type: "string", description: "Any other details or requests" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "end_call",
      description: "Politely end the call. Use when the caller says goodbye, all needed info is collected, or the caller is done.",
      parameters: {
        type: "object",
        properties: {
          farewell: { type: "string", description: "Final message to say before hanging up" },
        },
        required: ["farewell"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "transfer_to_human",
      description: "Transfer the call to a live human. Use only when caller explicitly asks for a human or the situation is urgent.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string" },
        },
        required: ["reason"],
      },
    },
  },
] as const;

export type VoiceToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type VoiceAiResult = {
  reply: string | null;
  tool_calls: VoiceToolCall[];
  usage: { prompt_tokens: number; completion_tokens: number };
};

export async function runVoiceTurn(messages: VoiceChatMsg[]): Promise<VoiceAiResult> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

  const resp = await fetch(GATEWAY, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      messages,
      tools: VOICE_TOOLS,
      tool_choice: "auto",
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Voice AI error [${resp.status}]: ${text.slice(0, 300)}`);
  }

  const json = await resp.json();
  const choice = json?.choices?.[0]?.message ?? {};
  const rawToolCalls = Array.isArray(choice.tool_calls) ? choice.tool_calls : [];
  const tool_calls: VoiceToolCall[] = rawToolCalls.map((t: any) => {
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(t?.function?.arguments ?? "{}"); } catch { /* ignore */ }
    return { id: String(t.id), name: String(t?.function?.name ?? ""), args };
  });

  return {
    reply: typeof choice.content === "string" ? choice.content : null,
    tool_calls,
    usage: {
      prompt_tokens: Number(json?.usage?.prompt_tokens ?? 0),
      completion_tokens: Number(json?.usage?.completion_tokens ?? 0),
    },
  };
}

// Escape user-provided text before injecting into TwiML (which is XML).
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
