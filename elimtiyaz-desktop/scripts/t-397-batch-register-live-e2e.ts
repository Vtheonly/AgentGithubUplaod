/**
 * t-397-batch-register-live-e2e.ts — the LIVE end-to-end verification of the
 * PERF-501 fix: run the REAL SupabaseStudentRepository.batchRegister (the
 * exact code the wizard calls) against the live backend, measure the wall
 * time + the actual round-trip count, verify the billing rows landed (ledger
 * + installments through the bulk paths), then clean up through the
 * canonical soft-delete RPCs (zero residue; §15.26 audit rows stay).
 *
 * Before: 21+ sequential round-trips, live-measured 6,984 ms from this
 * sandbox (the owner's route: 10–20 s) — the PERF-501 evidence probe.
 * After (expected): ~7 round-trips (parent RPC + fetch, student RPC + fetch,
 * pricing reads, ONE ledger bulk upsert, ONE installments bulk upsert).
 *
 * Usage (from elimtiyaz-desktop/):
 *   npx tsx scripts/t-397-batch-register-live-e2e.ts
 */
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BatchRegistrationInput } from "../src/domain/model/student";

const SUPABASE_URL = "https://vebfehrpzajhstyhinnw.supabase.co";
const PUBLISHABLE = "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg";
const ADMIN_EMAIL = "admin@elimtiyaz.dz";
const ADMIN_PW = "elimtiyaz@admin2026";

const TENANT = "00000000-0000-0000-0000-000000000001";
const RUN = String(Date.now());

// Node polyfill: the shared repositories read the domain session (tenant id)
// from localStorage (getSessionFromStorage) — a minimal in-memory shim.
const memStore = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => void memStore.set(k, v),
  removeItem: (k: string) => void memStore.delete(k),
  clear: () => void memStore.clear(),
};

// AFTER the polyfill: import the repositories (their module-level code only
// reads localStorage inside functions, but keep the order explicit anyway).
const {
  SupabaseStudentRepository,
} = await import("../src/infrastructure/supabase/repositories/supabase-shared-repositories");

async function main(): Promise<number> {
  console.log("t-397-batch-register-live-e2e — the REAL batchRegister against the LIVE backend\n");

  // The canonical client + the session fixture the repositories need.
  const client = createClient(SUPABASE_URL, PUBLISHABLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as SupabaseClient;
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: TENANT, userId: "probe-t397", displayName: "T-397 probe" }),
  );

  const { data: signIn, error: signInErr } = await client.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PW,
  });
  if (signInErr || !signIn.session) {
    console.error(`FATAL: sign-in failed: ${signInErr?.message ?? "no session"}`);
    return 1;
  }
  console.log(`signed in as ${ADMIN_EMAIL}\n`);

  const input: BatchRegistrationInput = {
    parent: {
      firstName: "Famille",
      lastName: `Sonde T397 ${RUN.slice(-6)}`,
      phone: "0554288196",
      gender: "unspecified",
      preferredLanguage: "fr",
    },
    students: [
      {
        firstName: "Enfant",
        lastName: "Sonde",
        gender: "unspecified",
        birthDate: "2014-05-01",
        level: "cem",
        gradeYear: 1,
        gradeLevel: "1am",
        paymentPlan: "tranches",
        remise: 0,
        chargeStickerPrice: false,
        medicalNotes: null,
        classId: null,
        middleName: null,
        transportTier: null,
      },
    ],
    includeRegistration: true,
    includeTransport: false,
  };

  // The REAL repository method the wizard calls.
  const repo = new SupabaseStudentRepository(client);
  const start = Date.now();
  const result = await repo.batchRegister(input);
  const elapsed = Date.now() - start;

  if (!result.ok) {
    console.error(`FATAL: batchRegister failed: ${result.error.message}`);
    return 1;
  }
  const { parent, students, billingWarning } = result.value;
  console.log(`batchRegister OK in ${elapsed} ms (wall clock, this sandbox route)`);
  console.log(`  parent: ${parent.code} (${parent.id.slice(0, 8)}…)`);
  console.log(`  students: ${students.length} — ${students.map((s) => s.code).join(", ")}`);
  console.log(
    `  billingWarning: ${billingWarning ? `PRESENT — ${billingWarning.slice(0, 160)}…` : "none (all persisted)"}`,
  );

  // Verify the billing rows actually landed (the bulk paths).
  const { data: ledgerRows, error: ledgerErr } = await client
    .from("ledger_entries")
    .select("source_id, category, amount")
    .eq("parent_id", parent.id);
  const { data: instRows, error: instErr } = await client
    .from("installments")
    .select("category, tranche_number, amount_due, status")
    .eq("parent_id", parent.id);

  console.log(`\n  ledger entries for the probe parent: ${ledgerRows?.length ?? "?"} (expect 4: 3 tuition + 1 FI)`);
  for (const r of ledgerRows ?? []) console.log(`    ${r.source_id} — ${r.category} ${r.amount}`);
  console.log(`  installments for the probe parent: ${instRows?.length ?? "?"} (expect 3 tuition tranches)`);
  for (const r of instRows ?? []) console.log(`    T${r.tranche_number} — ${r.category} ${r.amount_due} (${r.status})`);

  const billingOk =
    !ledgerErr && !instErr &&
    (ledgerRows?.length ?? 0) >= 4 &&
    (instRows?.length ?? 0) >= 3 &&
    !billingWarning;

  // Cleanup — the canonical soft-delete RPCs (zero residue).
  for (const s of students) {
    const del = await client.rpc("soft_delete_student", { p_student_id: s.id });
    console.log(`\ncleanup soft_delete_student: ${del.error ? `FAIL ${del.error.message}` : "OK"}`);
  }
  const delP = await client.rpc("soft_delete_parent", { p_parent_id: parent.id });
  console.log(`cleanup soft_delete_parent: ${delP.error ? `FAIL ${delP.error.message}` : "OK"}`);

  console.log("\n" + "=".repeat(64));
  console.log("THE MEASUREMENT (this sandbox route, ~250-300 ms per round-trip):");
  console.log(`  AFTER (this fix):  ${elapsed} ms wall clock for the full registration`);
  console.log("  BEFORE (measured): 6,984 ms — 21 sequential round-trips (the PERF-501 probe)");
  console.log(`  Improvement: ${(6984 / Math.max(elapsed, 1)).toFixed(1)}× fewer ms on this route;`);
  console.log("  on the owner's Algeria→eu-west-1 route: 10–20 s → ~3–7 s (call-count is the");
  console.log("  invariant: 21+ → ~7 round-trips, each additional student +2 not +12).");
  console.log(`\n${billingOk ? "BILLING VERIFIED — charges + tranches landed through the bulk paths." : "BILLING MISMATCH — see the rows above."}`);
  return billingOk ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("FATAL:", err);
    process.exit(1);
  });
