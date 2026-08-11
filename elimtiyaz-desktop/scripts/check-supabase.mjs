#!/usr/bin/env node
/**
 * Supabase diagnostics — plain Node.js, no build step required.
 *
 * Run with:
 *   cd elimtiyaz-desktop
 *   node scripts/check-supabase.mjs
 *
 * Set env vars first:
 *   export SUPABASE_URL=https://your-project.supabase.co
 *   export SUPABASE_ANON_KEY=your-anon-key
 *   export TENANT_ID=00000000-0000-0000-0000-000000000001   # optional
 *
 * Or pass them inline:
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/check-supabase.mjs
 *
 * This script verifies:
 *   1. Supabase is reachable.
 *   2. The tenant_id exists in the `tenants` table (FK target for parents/students).
 *   3. `upsert_parent_from_import` accepts the migration 0028 params
 *      (p_transport_destination, p_city_tier).
 *   4. `upsert_student_from_import` accepts the migration 0028 params
 *      (p_grade_level_code, p_transport_tier, p_payment_plan).
 *
 * If check 3 or 4 FAIL, you need to apply migration 0028:
 *   - Open the Supabase SQL Editor
 *   - Paste the contents of supabase/migrations/0028_shared_schema_extensions.sql
 *   - Run it (idempotent — safe to re-run)
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const TENANT_ID = process.env.TENANT_ID || "00000000-0000-0000-0000-000000000001";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("ERROR: SUPABASE_URL and SUPABASE_ANON_KEY must be set.");
  console.error("");
  console.error("Get them from the desktop app: Settings → Configuration tab.");
  console.error("Or from the Supabase dashboard: Settings → API.");
  console.error("");
  console.error("Then run:");
  console.error("  SUPABASE_URL=https://xxx.supabase.co \\");
  console.error("  SUPABASE_ANON_KEY=eyJxxx \\");
  console.error("  node scripts/check-supabase.mjs");
  process.exit(1);
}

const rpcUrl = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc`;
const headers = {
  "apikey": SUPABASE_ANON_KEY,
  "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
  "Prefer": "return=representation",
};

function sep(label) {
  console.log("");
  console.log(`── ${label} ${"─".repeat(Math.max(0, 60 - label.length))}`);
}

async function rpc(name, body) {
  const res = await fetch(`${rpcUrl}/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { ok: res.ok, status: res.status, body: json };
}

async function restGet(table, query) {
  const url = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${table}?${query}`;
  const res = await fetch(url, { headers: { ...headers, Accept: "application/json" } });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { ok: res.ok, status: res.status, body: json };
}

async function restDelete(table, query) {
  const url = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${table}?${query}`;
  const res = await fetch(url, { method: "DELETE", headers });
  return { ok: res.ok, status: res.status };
}

async function main() {
  console.log("=== Supabase Diagnostics ===");
  console.log(`URL:       ${SUPABASE_URL}`);
  console.log(`Anon key:  ${SUPABASE_ANON_KEY.slice(0, 20)}...`);
  console.log(`Tenant ID: ${TENANT_ID}`);

  // ── Check 1: connectivity ─────────────────────────────────────────────
  sep("1. Connectivity (can we reach Supabase?)");
  try {
    const r = await restGet("tenants", "select=id&limit=1");
    if (!r.ok) {
      console.log(`   FAIL: HTTP ${r.status}`);
      console.log(`   ${typeof r.body === "string" ? r.body : JSON.stringify(r.body)}`);
      console.log("   → The URL/key may be wrong, or the table doesn't exist.");
    } else {
      console.log("   OK: Supabase is reachable.");
    }
  } catch (e) {
    console.log(`   FAIL: ${e.message}`);
    console.log("   → Network error — check the URL.");
  }

  // ── Check 2: tenant exists ────────────────────────────────────────────
  sep("2. Tenant exists (FK target for parents/students)");
  try {
    const r = await restGet("tenants", `select=id,name&id=eq.${TENANT_ID}`);
    if (!r.ok) {
      console.log(`   FAIL: HTTP ${r.status} — ${JSON.stringify(r.body)}`);
    } else {
      const rows = r.body;
      if (!Array.isArray(rows) || rows.length === 0) {
        console.log(`   FAIL: tenant ${TENANT_ID} does NOT exist in 'tenants' table.`);
        console.log("   → Every parent/student insert will fail with FK violation.");
        console.log("   → Fix: INSERT INTO tenants (id, name) VALUES (...);");
      } else {
        console.log(`   OK: tenant exists (${rows[0].name}).`);
      }
    }
  } catch (e) {
    console.log(`   FAIL: ${e.message}`);
  }

  // ── Check 3: upsert_parent_from_import accepts 0028 params ────────────
  sep("3. upsert_parent_from_import signature (migration 0028)");
  const parentRes = await rpc("upsert_parent_from_import", {
    p_tenant_id: TENANT_ID,
    p_parent_code: "PAR-DIAG-TEST",
    p_first_name: "DIAG",
    p_last_name: "TEST",
    p_display_name: "DIAG TEST",
    p_primary_phone: "(inconnu)",
    // Migration 0028 params — if the migration isn't applied, these cause PGRST202.
    p_transport_destination: null,
    p_city_tier: null,
  });
  if (!parentRes.ok) {
    const msg = typeof parentRes.body === "object" ? parentRes.body.message : String(parentRes.body);
    console.log(`   FAIL: HTTP ${parentRes.status}`);
    console.log(`   ${msg}`);
    if (msg && (msg.includes("PGRST202") || msg.includes("Could not find the function") || msg.includes("parameter"))) {
      console.log("");
      console.log("   >>> MIGRATION 0028 IS NOT APPLIED <<<");
      console.log("   The function exists but rejects the new params:");
      console.log("     p_transport_destination, p_city_tier");
      console.log("");
      console.log("   FIX:");
      console.log("     1. Open the Supabase SQL Editor");
      console.log("     2. Paste the contents of:");
      console.log("        supabase/migrations/0028_shared_schema_extensions.sql");
      console.log("     3. Run it (idempotent — safe to re-run)");
    } else if (msg && (msg.includes("foreign key") || msg.includes("violates"))) {
      console.log("");
      console.log("   >>> TENANT_ID FK VIOLATION <<<");
      console.log(`   The tenant ${TENANT_ID} doesn't exist in 'tenants'.`);
      console.log("   Fix: INSERT INTO tenants (id, name) VALUES (...);");
    } else if (parentRes.status === 401 || parentRes.status === 403) {
      console.log("");
      console.log("   >>> AUTH / RLS ISSUE <<<");
      console.log("   The anon key is rejected, or RLS blocks the write.");
    }
  } else {
    console.log("   OK: upsert_parent_from_import accepts the 0028 params.");
    // Clean up the test parent.
    await restDelete("parents", "parent_code=eq.PAR-DIAG-TEST");
  }

  // ── Check 4: upsert_student_from_import accepts 0028 params ───────────
  sep("4. upsert_student_from_import signature (migration 0028)");
  // First create a test parent to attach the student to.
  const parentRes2 = await rpc("upsert_parent_from_import", {
    p_tenant_id: TENANT_ID,
    p_parent_code: "PAR-DIAG-TEST2",
    p_first_name: "DIAG",
    p_last_name: "TEST2",
    p_display_name: "DIAG TEST2",
    p_primary_phone: "(inconnu)",
  });
  const testParentId =
    parentRes2.ok && Array.isArray(parentRes2.body) ? parentRes2.body[0]?.parent_id : null;
  if (!testParentId) {
    console.log("   SKIP: could not create test parent (see check 3).");
  } else {
    const studentRes = await rpc("upsert_student_from_import", {
      p_tenant_id: TENANT_ID,
      p_student_code: "ELV-DIAG-TEST",
      p_parent_id: testParentId,
      p_first_name: "DIAG",
      p_last_name: "STUDENT",
      p_display_name: "DIAG STUDENT",
      // Migration 0028 params.
      p_grade_level_code: "1ap",
      p_transport_tier: null,
      p_payment_plan: "tranches",
    });
    if (!studentRes.ok) {
      const msg = typeof studentRes.body === "object" ? studentRes.body.message : String(studentRes.body);
      console.log(`   FAIL: HTTP ${studentRes.status}`);
      console.log(`   ${msg}`);
      if (msg && (msg.includes("PGRST202") || msg.includes("Could not find the function") || msg.includes("parameter"))) {
        console.log("");
        console.log("   >>> MIGRATION 0028 IS NOT APPLIED <<<");
        console.log("   Apply 0028_shared_schema_extensions.sql via the Supabase SQL Editor.");
      }
    } else {
      console.log("   OK: upsert_student_from_import accepts the 0028 params.");
    }
    // Clean up.
    await restDelete("students", "student_code=eq.ELV-DIAG-TEST");
    await restDelete("parents", "parent_code=eq.PAR-DIAG-TEST2");
  }

  console.log("");
  console.log("=== Done ===");
}

main().catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(1);
});
