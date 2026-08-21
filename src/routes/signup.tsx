import { createFileRoute, redirect } from "@tanstack/react-router";

// Self-serve workspace signup is disabled: this is a single-business app.
// Employees join by invitation only and simply sign in at /auth.
export const Route = createFileRoute("/signup")({
  ssr: false,
  beforeLoad: () => {
    throw redirect({ to: "/auth" });
  },
});
