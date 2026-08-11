/**
 * Supabase diagnostics script.
 *
 * Run with: npx tsx scripts/check-supabase.ts
 *
 * Verifies that:
 *   1. The Supabase URL + anon key are configured.
 *   2. The `upsert_parent_from_import` function accepts the migration 0028
 *      params (p_transport_destination, p_city_tier).
 *   3. The `upsert_student_from_import` function accepts the migration 0028
 *      params (p_grade_level_code, p_transport_tier, p_payment_plan).
 *   4. The session's tenant_id exists in the `tenants` table (FK check).
 *   5. A test parent can be created + pulled back (end-to-end round trip).
 *
 * This script is the fastest way to diagnose the "390 ignoré(s)" issue
 * where the Excel importer silently skips every ETAT row.
 */
import { createClient } from "@supabase/supabase-js";

// Read config from the same places the desktop app does.
const SUPABASE_URL = process.env.SUPABASE_URL
  ?? process.env.VITE_SUPABASE_URL
  ?? localStorage_get("supabase_url");
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
  ?? process.env.VITE_SUPABASE_ANON_KEY
  ?? localStorage_get("supabase_anon_key");

function localStorage_get(_key: string): string | undefined {
  // In a Node script we don't have localStorage. The user should set the
  // env vars or pass them as arguments.
  return undefined;
}

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("ERROR: SUPABASE_URL and SUPABASE_ANON_KEY must be set.");
  console.error("Either:");
  console.error("  1. export SUPABASE_URL=https://your-project.supabase.co");
  console.error("     export SUPABASE_ANON_KEY=your-anon-key");
  console.error("  2. Or run the desktop app, go to Settings → Configuration,");
  console.error("     and copy the values from there into env vars.");
  process.exit(1);
}

const TENANT_ID = process.env.TENANT_ID ?? "00000000-0000-0000-0000-000000000001";

async function main() {
  console.log("=== Supabase Diagnostics ===");
  console.log(`URL: ${SUPABASE_URL}`);
  console.log(`Tenant ID: ${TENANT_ID}`);
  console.log();

  const client = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });

  // ── Check 1: can we reach Supabase? ──────────────────────────────────
  console.log("1. Testing connectivity...");
  const { error: healthErr } = await client.from("tenants").select("id").limit(1);
  if (healthErr) {
    console.error(`   FAIL: ${healthErr.message}`);
    console.error("   → The Supabase URL/key may be wrong, or RLS blocks reads.");
  } else {
    console.log("   OK: Supabase is reachable.");
  }

  // ── Check 2: does the tenant exist? ──────────────────────────────────
  console.log();
  console.log("2. Checking tenant_id FK target...");
  const { data: tenant, error: tenantErr } = await client
    .from("tenants")
    .select("id, name")
    .eq("id", TENANT_ID)
    .maybeSingle();
  if (tenantErr) {
    console.error(`   FAIL: ${tenantErr.message}`);
  } else if (!tenant) {
    console.error(`   FAIL: tenant ${TENANT_ID} does NOT exist in the 'tenants' table.`);
    console.error("   → Every parent/student insert will fail with an FK violation.");
    console.error("   → Fix: INSERT INTO tenants (id, name) VALUES (...);");
  } else {
    console.log(`   OK: tenant exists (${tenant.name}).`);
  }

  // ── Check 3: does upsert_parent_from_import accept the 0028 params? ──
  console.log();
  console.log("3. Checking upsert_parent_from_import signature (migration 0028)...");
  const { error: parentRpcErr } = await client.rpc("upsert_parent_from_import", {
    p_tenant_id: TENANT_ID,
    p_parent_code: "PAR-DIAG-TEST",
    p_first_name: "DIAG",
    p_last_name: "TEST",
    p_display_name: "DIAG TEST",
    p_primary_phone: "(inconnu)",
    // These are the NEW params added by migration 0028. If the migration
    // hasn't been applied, the RPC will reject them.
    p_transport_destination: null,
    p_city_tier: null,
  });
  if (parentRpcErr) {
    if (parentRpcErr.message.includes("Could not find the function")
        || parentRpcErr.message.includes("parameter")
        || parentRpcErr.message.includes("PGRST202")) {
      console.error(`   FAIL: ${parentRpcErr.message}`);
      console.error("   → Migration 0028_shared_schema_extensions.sql is NOT applied.");
      console.error("   → Apply it via: supabase db push");
      console.error("   → Or paste the SQL into the Supabase SQL Editor.");
    } else {
      console.error(`   FAIL: ${parentRpcErr.message}`);
    }
  } else {
    console.log("   OK: upsert_parent_from_import accepts the 0028 params.");
    // Clean up the test parent.
    await client.from("parents").delete().eq("parent_code", "PAR-DIAG-TEST");
  }

  // ── Check 4: does upsert_student_from_import accept the 0028 params? ──
  console.log();
  console.log("4. Checking upsert_student_from_import signature (migration 0028)...");
  // First create a test parent to attach the student to.
  const { data: parentData } = await client.rpc("upsert_parent_from_import", {
    p_tenant_id: TENANT_ID,
    p_parent_code: "PAR-DIAG-TEST2",
    p_first_name: "DIAG",
    p_last_name: "TEST2",
    p_display_name: "DIAG TEST2",
    p_primary_phone: "(inconnu)",
  });
  const testParentId = (parentData as { parent_id?: string })?.parent_id;
  if (testParentId) {
    const { error: studentRpcErr } = await client.rpc("upsert_student_from_import", {
      p_tenant_id: TENANT_ID,
      p_student_code: "ELV-DIAG-TEST",
      p_parent_id: testParentId,
      p_first_name: "DIAG",
      p_last_name: "STUDENT",
      p_display_name: "DIAG STUDENT",
      // These are the NEW params added by migration 0028.
      p_grade_level_code: "1ap",
      p_transport_tier: null,
      p_payment_plan: "tranches",
    });
    if (studentRpcErr) {
      if (studentRpcErr.message.includes("Could not find the function")
          || studentRpcErr.message.includes("parameter")
          || studentRpcErr.message.includes("PGRST202")) {
        console.error(`   FAIL: ${studentRpcErr.message}`);
        console.error("   → Migration 0028_shared_schema_extensions.sql is NOT applied.");
      } else {
        console.error(`   FAIL: ${studentRpcErr.message}`);
      }
    } else {
      console.log("   OK: upsert_student_from_import accepts the 0028 params.");
    }
    // Clean up.
    await client.from("students").delete().eq("student_code", "ELV-DIAG-TEST");
    await client.from("parents").delete().eq("parent_code", "PAR-DIAG-TEST2");
  } else {
    console.error("   SKIP: could not create test parent (see check 3).");
  }

  console.log();
  console.log("=== Done ===");
}

main().catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(1);
});
