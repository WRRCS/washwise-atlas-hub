import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";

type Props = {
  status: string | null | undefined;
  cancelAt?: string | null;
};

/**
 * Small app-wide banner shown when the subscription is in trouble
 * (past_due / unpaid / canceled with future access) or scheduled to cancel.
 */
export function DunningBanner({ status, cancelAt }: Props) {
  if (!status) return null;
  const isDunning = status === "past_due" || status === "unpaid";
  const scheduledCancel = status === "canceled" && cancelAt && new Date(cancelAt) > new Date();
  if (!isDunning && !scheduledCancel) return null;

  const message = isDunning
    ? "Payment past due — we're retrying automatically. Update your card to avoid losing access."
    : `Subscription cancels ${cancelAt ? new Date(cancelAt).toLocaleDateString() : "at period end"}.`;

  return (
    <div className="w-full bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-900 flex items-center justify-center gap-3">
      <AlertTriangle className="size-4 shrink-0" />
      <span>{message}</span>
      <Link to="/settings/billing" className="font-medium underline">Manage billing</Link>
    </div>
  );
}
