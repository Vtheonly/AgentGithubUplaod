/**
 * realtime-probe.mjs — live evidence for the REALTIME-105 publication-gap
 * discovery (60th session, 2026-09-13) — also the RED control for T-337.
 *
 * Proves two things with real websocket events:
 *   1. A postgres_changes subscription on `assessments` (NOT a member of
 *      the supabase_realtime publication) delivers NO events when the
 *      canonical upsert RPC writes a row.
 *   2. The realtime machinery itself works: a subscription on `audit_logs`
 *      (a publication member since migration 0085) DOES deliver events.
 *
 * RUN LOCATION: from a repo root whose node_modules carries
 * @supabase/supabase-js (the desktop or the website — e.g.
 * `cd elimtiyaz-desktop && npm install && node scripts/realtime-probe.mjs`
 * — the 60th session ran it from the website checkout).
 * Env: SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY (owner-supplied,
 * never committed). The probe writes + deletes ONE disposable assessment
 * row and ONE audit_logs row (audit rows are append-only by design and
 * stay as the honest record — action `probe.realtime_test`).
 */
import { createClient } from "@supabase/supabase-js";

const URL = "https://hkvkefubghbbotgnteir.supabase.co";
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STUDENT = "2800fade-f79e-41e0-8918-96c2ac009a53"; // MED AMIR (test parent bound)
const TENANT = "00000000-0000-0000-0000-000000000001";

// 1. sign in as the test parent (password grant)
const tok = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({
    email: "session60-grades-e2e@elimtiyaz-test.dz",
    password: "E2e-Session60-Pass!",
  }),
}).then((r) => r.json());
const parentJwt = tok.access_token;
console.log("parent JWT acquired:", Boolean(parentJwt));

// 2. parent client (RLS-scoped realtime)
const parent = createClient(URL, ANON, {
  realtime: { params: { eventsPerSecond: 5 } },
  auth: { persistSession: false },
});
await parent.auth.setSession({ access_token: parentJwt, refresh_token: tok.refresh_token });

const events = { assessments: [], audit_logs: [] };

const chA = parent
  .channel("probe-assessments")
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "assessments", filter: `student_id=eq.${STUDENT}` },
    (payload) => events.assessments.push(payload),
  )
  .subscribe();

// 3. admin client subscribes to audit_logs (publication member)
const adminTok = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@elimtiyaz.dz", password: "elimtiyaz@admin2026" }),
}).then((r) => r.json());
const admin = createClient(URL, ANON, { auth: { persistSession: false } });
await admin.auth.setSession({ access_token: adminTok.access_token, refresh_token: adminTok.refresh_token });
const svc = createClient(URL, SERVICE, { auth: { persistSession: false } });

const chB = admin
  .channel("probe-audit-logs")
  .on(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: "audit_logs" },
    (payload) => events.audit_logs.push(payload),
  )
  .subscribe();

// wait for SUBSCRIBED
await new Promise((r) => setTimeout(r, 3000));
console.log("assessments channel state:", chA.state, "| audit channel state:", chB.state);

// 4. write an assessment row (canonical RPC) + an audit row via service key
const up = await svc.rpc("upsert_assessment_from_import", {
  p_tenant_id: TENANT,
  p_student_id: STUDENT,
  p_subject_id: "90543bdb-d90e-44db-8d96-4c064a0c6ac9", // MATH
  p_term: 3,
  p_academic_year: "2026-2027",
  p_devoir1: 10,
  p_devoir2: 10,
  p_examen: 10,
  p_coefficient: 4,
});
console.log("assessment upsert:", JSON.stringify(up).slice(0, 120));

const audit = await svc.from("audit_logs").insert({
  tenant_id: TENANT,
  action: "probe.realtime_test",
  entity_type: "probe",
  entity_id: "00000000-0000-0000-0000-000000000000",
  actor_id: null,
  before_json: null,
  after_json: null,
});
console.log("audit insert error:", audit.error ? audit.error.message : "none");

// 5. wait for events
await new Promise((r) => setTimeout(r, 8000));
console.log("\n=== RESULTS ===");
console.log("assessments events received:", events.assessments.length, "(expected 0 — not in publication)");
console.log("audit_logs events received:", events.audit_logs.length, "(expected >=1 — publication member)");

// 6. cleanup the probe rows
const del = await svc.from("assessments").delete().eq("student_id", STUDENT).eq("term", 3);
console.log("probe assessment cleanup:", del.error ? del.error.message : "ok");
await svc.removeChannel(chA);
await admin.removeChannel(chB);
parent.removeAllChannels();
process.exit(0);
