import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { type StripeEnv, createStripeClient, getStripeErrorMessage } from "@/lib/stripe.server";

export type VerifyCheckoutResult =
  | { paid: true; amount_total: number | null; currency: string | null; mode: string | null }
  | { paid: false; reason: string };

/**
 * Verify a Stripe Checkout Session server-side before showing "paid" to the user.
 * Prevents forged/random session_id URLs from showing a false success.
 */
export const verifyCheckoutSession = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({
      session_id: z.string().trim().min(10).max(200),
      environment: z.enum(["sandbox", "live"]),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<VerifyCheckoutResult> => {
    try {
      const stripe = createStripeClient(data.environment as StripeEnv);
      const session = await stripe.checkout.sessions.retrieve(data.session_id);
      const isPaid =
        session.payment_status === "paid" ||
        session.status === "complete" ||
        session.payment_status === "no_payment_required";
      if (!isPaid) {
        return { paid: false, reason: `Session status: ${session.status ?? "unknown"} / ${session.payment_status ?? "unknown"}` };
      }
      return {
        paid: true,
        amount_total: session.amount_total ?? null,
        currency: session.currency ?? null,
        mode: session.mode ?? null,
      };
    } catch (error) {
      return { paid: false, reason: getStripeErrorMessage(error) };
    }
  });
