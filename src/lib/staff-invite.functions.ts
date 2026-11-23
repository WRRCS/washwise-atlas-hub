import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Public on purpose: the emailed invite code is the credential. Exchanges a
 * valid, unused, unexpired code for a single-use sign-in token that the
 * employee's browser redeems right away. Returns no personal details.
 */
export const redeemInviteLink = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ code: z.string().min(20).max(200) }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { redeemStaffInvite } = await import("@/lib/staff-invite.server");
    return redeemStaffInvite(supabaseAdmin, data.code);
  });
