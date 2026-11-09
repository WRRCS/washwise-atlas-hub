import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
const env = Object.fromEntries(readFileSync("/dev-server/.env", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const admin = createClient(env.SUPABASE_URL || env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const REAL = "00000000-0000-0000-0000-000000000001";

async function main() {
  const { data: t } = await admin.from("tenants").select("id,name").eq("name", "WRRCS Training Demo");
  const ids = (t ?? []).map((x: any) => x.id).filter((id: string) => id !== REAL);
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const demoUsers = (users?.users ?? []).filter((u) => /^training\.(owner|maria|oksana|alex)@example\.com$/.test(u.email ?? ""));
  console.log("tenants", ids, "users", demoUsers.map((u) => u.email));
  if (process.argv[2] !== "--go") return;
  // Discover every public table with tenant_id and delete demo rows (children first via retries).
  const list: string[] = JSON.parse(readFileSync("/tmp/training/tenant_tables.json", "utf8"));
  for (let pass = 0; pass < 6; pass++) {
    let failed = 0;
    for (const tb of list) {
      for (const id of ids) {
        const { error } = await (admin.from(tb as any) as any).delete().eq("tenant_id", id);
        if (error) failed++;
      }
    }
    if (!failed) break; console.log('pass', pass, 'failed', failed);
  }
  await admin.from("allowed_signins").delete().in("email", demoUsers.map((u) => u.email!));
  for (const u of demoUsers) {
    for (const tb of ["user_roles", "profiles"]) await (admin.from(tb as any) as any).delete().eq(tb === "profiles" ? "id" : "user_id", u.id);
    const { error } = await admin.auth.admin.deleteUser(u.id);
    console.log("deleted user", u.email, error?.message ?? "ok");
  }
  for (const id of ids) {
    const { error } = await admin.from("tenants").delete().eq("id", id);
    console.log("deleted tenant", id, error?.message ?? "ok");
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
