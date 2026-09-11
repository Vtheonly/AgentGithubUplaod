#!/usr/bin/env node
/**
 * T-310 end-to-end live probe — the owner's exact complaint closed with
 * evidence: a payment collected via the desktop's EXACT RPC path (with
 * p_actor_name = NULL, as the fixed caller passes) must produce an audit
 * row whose canonical columns carry the details and whose actor block
 * shows a resolved display name + role (not a UUID).
 */
const SUPABASE_URL = "https://hkvkefubghbbotgnteir.supabase.co";
const SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhrdmtlZnViZ2hiYm90Z250ZWlyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTAwNDY4NCwiZXhwIjoyMTAwNTgwNjg0fQ.1CeNAMFfrIw4GQsTr3COLC5TO_uYtN1-oOmCrx1OuzM";
const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };
const TENANT = "00000000-0000-0000-0000-000000000001";

async function main() {
  // 1. The admin profile (the desktop session user) — for actor resolution.
  const prof = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?select=id,auth_user_id,display_name,email&limit=3`, { headers: H });
  const profiles = await prof.json();
  console.log("profiles:", JSON.stringify(profiles, null, 2));
  const actor = profiles.find((p) => p.display_name) ?? profiles[0];

  // 2. A parent with open installments (the waterfall target).
  const ins = await fetch(
    `${SUPABASE_URL}/rest/v1/installments?select=parent_id,student_id,category,amount_due,amount_paid,status&status=neq.paid&tenant_id=eq.${TENANT}&limit=5`,
    { headers: H },
  );
  const installments = await ins.json();
  console.log("open installments (sample):", JSON.stringify(installments.slice(0, 3), null, 2));
  if (!installments.length) { console.log("NO open installments — probe needs a parent with dues"); return; }
  const target = installments[0];

  // 3. The desktop's EXACT call (p_actor_name: null — the T-310 fix).
  const rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/collect_and_allocate_payment`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      p_tenant_id: TENANT,
      p_parent_id: target.parent_id,
      p_student_id: target.student_id ?? null,
      p_amount: 100,
      p_method: "cash",
      p_category: target.category ?? "tuition",
      p_installment_id: null,
      p_proof_path: null,
      p_notes: "T-310 live probe (AUDIT-502 e2e evidence)",
      p_actor_id: actor.auth_user_id ?? actor.id,
      p_actor_name: null,
    }),
  });
  const rpcBody = await rpc.text();
  console.log("\nRPC status:", rpc.status, "body:", rpcBody.slice(0, 400));
  const result = JSON.parse(rpcBody);
  if (!Array.isArray(result) || !result[0]?.payment_id) { console.log("RPC FAILED — aborting"); return; }
  const paymentId = result[0].payment_id;

  // 4. THE assertion set: the audit row for this payment.
  const auditRes = await fetch(
    `${SUPABASE_URL}/rest/v1/audit_logs?select=*&entity_id=eq.${paymentId}&action=eq.payment.collect&limit=1`,
    { headers: H },
  );
  const [entry] = await auditRes.json();
  console.log("\n=== THE AUDIT ROW (the owner's complaint, live evidence) ===");
  console.log(JSON.stringify({
    actor_name: entry.actor_name,
    actor_role: entry.actor_role,
    before_json: entry.before_json,
    after_json: entry.after_json,
    diff_column_type: typeof entry.diff,
  }, null, 2));

  const checks = [
    ["actor_name is a DISPLAY NAME (not the UUID)", entry.actor_name && entry.actor_name !== (actor.auth_user_id ?? actor.id) && !/^[0-9a-f-]{36}$/.test(entry.actor_name)],
    ["actor_role resolved", typeof entry.actor_role === "string" && entry.actor_role.length > 0],
    ["after_json carries the payment details", entry.after_json && typeof entry.after_json === "object" && "amount" in entry.after_json && "receipt" in entry.after_json],
    ["before_json is null (INSERT semantics)", entry.before_json === null],
  ];
  let allOk = true;
  for (const [name, ok] of checks) { console.log(`  ${ok ? "PASS" : "FAIL"} — ${name}`); if (!ok) allOk = false; }

  // 5. The desktop mapper's treatment of THIS live row (the drawer pipeline).
  const before = entry.before_json ?? null;
  let after = entry.after_json ?? null;
  if (before == null && after == null && entry.diff != null) {
    const raw = typeof entry.diff === "string" ? JSON.parse(entry.diff) : entry.diff;
    after = raw; // flat
  }
  const diff = before != null || after != null ? JSON.stringify({ before, after }) : null;
  console.log("\nMapper output (what the drawer now receives):");
  console.log("  diff != null:", diff != null);
  if (after) {
    console.log("  after.amount:", after.amount, "| after.receipt:", after.receipt, "| after.status:", after.status);
  }
  console.log("\nE2E PROBE:", allOk && diff != null ? "GREEN — the owner's payment-audit complaint is closed LIVE" : "RED");
}
main().catch((e) => { console.error(e); process.exit(1); });
