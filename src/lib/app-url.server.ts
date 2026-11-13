import { getRequestUrl } from "@tanstack/react-start/server";
import { normalizeAppOrigin } from "./invoice-pay-link";

/**
 * The address the app was actually reached on for this request
 * (https://wrrcs.com when it runs from the published site).
 * Returns "" when there is no request context.
 */
export function getAppOrigin(): string {
  try {
    const url = getRequestUrl({ xForwardedHost: true, xForwardedProto: true });
    return normalizeAppOrigin(`${url.protocol}//${url.host}`);
  } catch {
    return "";
  }
}
