import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "fs";
const env = Object.fromEntries(readFileSync("/dev-server/.env", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const PW = "Tr41ning-" + Math.random().toString(36).slice(2, 10) + "!A";
const must = <T,>(r: { data: T; error: any }, what: string) => { if (r.error) throw new Error(what + ": " + r.error.message); return r.data; };

async function main() {
  const owner = must(await admin.auth.admin.createUser({ email: "training.owner@example.com", password: PW, email_confirm: true, user_metadata: { full_name: "Training Office", signup_business_name: "WRRCS Training Demo" } }), "owner");
  const ownerId = owner.user!.id;
  const prof = must(await admin.from("profiles").select("tenant_id").eq("id", ownerId).single(), "owner profile") as any;
  const tenant = prof.tenant_id as string;
  writeFileSync("/tmp/training/demo.json", JSON.stringify({ tenant, ownerId, pw: PW }));
  must(await admin.from("tenants").update({ onboarding_completed: true, timezone: "America/Los_Angeles", track_gps: false, subscription_status: "active" }).eq("id", tenant), "tenant");
  const people: Record<string, string> = {};
  for (const [key, email, name, lang] of [["maria", "training.maria@example.com", "Maria Sample", "en"], ["oksana", "training.oksana@example.com", "Оксана Зразок", "uk"], ["alex", "training.alex@example.com", "Alex Teammate", "en"]] as const) {
    must(await admin.from("allowed_signins").insert({ email, tenant_id: tenant, invited_by: ownerId }), "allow " + key);
    const u = must(await admin.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { full_name: name } }), key);
    people[key] = u.user!.id;
    must(await admin.from("profiles").update({ full_name: name, language: lang, phone: "555-0100" }).eq("id", u.user!.id), "lang " + key);
  }
  writeFileSync("/tmp/training/demo.json", JSON.stringify({ tenant, ownerId, people, pw: PW }));
  const svc = must(await admin.from("service_types").insert({ tenant_id: tenant, kind: "residential", name: "Standard Home Clean", default_duration_minutes: 150, color: "#6aa9c9" }).select("id").single(), "svc") as any;
  const svc2 = must(await admin.from("service_types").insert({ tenant_id: tenant, kind: "airbnb_turnover", name: "Vacation Rental Turnover", default_duration_minutes: 90, color: "#c9a96a" }).select("id").single(), "svc2") as any;
  const c1 = must(await admin.from("clients").insert({ tenant_id: tenant, first_name: "Jamie", last_name: "Sample", service_address: "123 Example Ave, Anytown, WA", is_active: true }).select("id").single(), "c1") as any;
  const c2 = must(await admin.from("clients").insert({ tenant_id: tenant, first_name: "Lakeview", last_name: "Rental (Sample)", service_address: "45 Demo Lane, Anytown, WA", is_active: true }).select("id").single(), "c2") as any;
  const sop1 = "Standard Home Clean — Sample SOP\n\n1. Greet the client if home, put on shoe covers.\n2. Kitchen: wipe counters, sink, stovetop and appliance fronts.\n3. Bathrooms: clean toilet, tub/shower, mirrors and sink; restock toilet paper.\n4. Bedrooms: make beds, dust surfaces.\n5. Vacuum and mop all floors, working toward the exit.\n6. Take after photos of kitchen and bathrooms.\n7. Lock up and return the key to the lockbox.";
  const p1 = must(await admin.from("client_properties").insert({ tenant_id: tenant, client_id: c1.id, label: "Home", address: "123 Example Ave, Anytown, WA", is_primary: true, is_active: true, property_type: "Residence", sop: sop1 }).select("id").single(), "p1") as any;
  const p2 = must(await admin.from("client_properties").insert({ tenant_id: tenant, client_id: c2.id, label: "Lakeview Cabin", address: "45 Demo Lane, Anytown, WA", is_primary: true, is_active: true, property_type: "Vacation rental", sop: "Turnover — Sample SOP\n\n1. Strip beds and start laundry.\n2. Clean kitchen and bathrooms.\n3. Make beds with fresh linens.\n4. Restock coffee, soap and paper goods.\n5. Photo every room before leaving." }).select("id").single(), "p2") as any;
  must(await admin.from("property_specs").insert({ tenant_id: tenant, client_id: c1.id, key_location: "Lockbox on the side gate (code from the office)", pets: "Friendly cat — keep doors closed", parking_notes: "Park on the street, not the driveway" }), "spec1");
  must(await admin.from("property_specs").insert({ tenant_id: tenant, client_id: c2.id, key_location: "Keypad on front door", access_notes: "Guests check in at 4 PM — finish on time", parking_notes: "Gravel pad by the garage" }), "spec2");
  const pt = new Date(Date.now() - 8 * 3600e3);
  const day = (off: number) => { const d = new Date(pt); d.setUTCDate(d.getUTCDate() + off); return d.toISOString().slice(0, 10); };
  const at = (off: number, hh: number, mm = 0) => new Date(`${day(off)}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00-08:00`).toISOString();
  const nowH = Number(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hour12: false }));
  const startH = Math.min(nowH + 1, 19);
  const jobs: string[] = [];
  for (const who of ["maria", "oksana"]) {
    const list = [
      { client_id: c1.id, property_id: p1.id, service_type_id: svc.id, s: at(0, startH, 0), e: at(0, startH + 2, 30), notes: "Focus on the kitchen today — client is hosting dinner.", team: true },
      { client_id: c2.id, property_id: p2.id, service_type_id: svc2.id, s: at(0, startH + 3, 0), e: at(0, startH + 4, 30), notes: null, team: false },
      { client_id: c1.id, property_id: p1.id, service_type_id: svc.id, s: at(1, 9, 0), e: at(1, 11, 30), notes: null, team: true },
      { client_id: c2.id, property_id: p2.id, service_type_id: svc2.id, s: at(2, 11, 0), e: at(2, 12, 30), notes: null, team: false },
      { client_id: c1.id, property_id: p1.id, service_type_id: svc.id, s: at(3, 9, 0), e: at(3, 11, 30), notes: null, team: false },
    ];
    for (const j of list) {
      const row = must(await admin.from("jobs").insert({ tenant_id: tenant, client_id: j.client_id, property_id: j.property_id, service_type_id: j.service_type_id, assigned_to: people[who], status: "scheduled", scheduled_start: j.s, scheduled_end: j.e, notes: j.notes, published_at: new Date().toISOString() }).select("id").single(), "job") as any;
      const emps = [people[who], ...(j.team ? [people.alex] : [])];
      must(await admin.from("job_employees").insert(emps.map((e) => ({ tenant_id: tenant, job_id: row.id, employee_id: e }))), "je");
      const steps = [["Kitchen counters and sink", "Кухонні стільниці та мийка"], ["Bathrooms", "Ванні кімнати"], ["Floors vacuumed and mopped", "Підлоги пропилососені та вимиті"], ["After photos taken", "Фото «після» зроблено"]];
      for (const e of emps) must(await admin.from("job_sop_items").insert(steps.map(([l, u], i) => ({ tenant_id: tenant, job_id: row.id, position: i, label: l, label_uk: u, employee_id: e }))), "sop items");
      jobs.push(row.id);
    }
  }
  const tpl = [["Glass cleaner", "bottle"], ["All-purpose spray", "bottle"], ["Microfiber cloths", "pack"], ["Toilet bowl cleaner", "bottle"], ["Trash bags", "roll"]];
  for (const [i, [n, u]] of tpl.entries()) {
    const t = must(await admin.from("caddy_template_items").insert({ tenant_id: tenant, name: n, unit: u, default_qty: 1, sort_order: i, is_active: true }).select("id").single(), "tpl") as any;
    for (const who of ["maria", "oksana"]) must(await admin.from("employee_caddy_items").insert({ tenant_id: tenant, employee_id: people[who], template_item_id: t.id, name: n, unit: u, qty: 1, sort_order: i, level_pct: [100, 75, 50, 25, 100][i] }), "caddy");
  }
  for (const who of ["maria", "oksana"]) {
    must(await admin.from("team_messages").insert({ tenant_id: tenant, sender_id: ownerId, recipient_id: people[who], body: who === "maria" ? "Welcome to the team! Reach out here with any questions." : "Ласкаво просимо до команди! Пишіть сюди, якщо будуть питання." }), "msg");
  }
  writeFileSync("/tmp/training/demo.json", JSON.stringify({ tenant, ownerId, people, pw: PW, jobs }));
  console.log("ok tenant", tenant, "jobs", jobs.length, "startH", startH);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
