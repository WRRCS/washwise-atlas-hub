import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "fs";
const env = Object.fromEntries(readFileSync("/dev-server/.env","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^"|"$/g,"")]}));
const demo = JSON.parse(readFileSync("/tmp/training/demo.json","utf8"));
const out: Record<string, any> = {};
for (const who of ["maria","oksana"]) {
  const c = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: `training.${who}@example.com`, password: demo.pw });
  if (error) throw error;
  out[who] = data.session;
}
writeFileSync("/tmp/training/sessions.json", JSON.stringify(out));
console.log("sessions ok");
