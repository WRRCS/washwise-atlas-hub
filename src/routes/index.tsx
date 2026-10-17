import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Wash Rinse Repeat Cleaning" }, { name: "description", content: "Manage cleaning schedules and client appointments." }, { property: "og:title", content: "Wash Rinse Repeat Cleaning" }, { property: "og:description", content: "Manage cleaning schedules and client appointments." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    const { data: r } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id)
      .order("role")
      .limit(1)
      .maybeSingle();
    if (r?.role === "employee") throw redirect({ to: "/my-jobs" });
    throw redirect({ to: "/dashboard" });
  },
});
