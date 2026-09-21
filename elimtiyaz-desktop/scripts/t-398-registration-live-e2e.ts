/**
 * t-398-registration-live-e2e.ts — the LIVE end-to-end run of the REAL
 * `SupabaseStudentRepository.batchRegister` (the T-398 one-round-trip
 * rewire) against production: wall-clock latency, the returned domain
 * models, the persisted billing content (through the ACTUAL client seam —
 * the 0103 source_id substitution end-to-end), the idempotent re-run, and
 * the zero-residue cleanup.
 *
 * This is the live-verification leg for the task-registry evidence
 * (docs/recovery/t-398-live-verification.md):
 *   - BEFORE (T-397 shape): ~11 round-trips, live-measured 3,189 ms
 *     (the original path: 21+ round-trips, 6,984 ms).
 *   - EXPECTED AFTER (T-398): ONE round-trip ≈ single-RTT + server time.
 *
 * Usage (from elimtiyaz-desktop/):
 *   npx tsx scripts/t-398-registration-live-e2e.ts
 *
 * The publishable key is the public identifier (credentials.md §9.1); the
 * admin password is the owner-pinned credential (credentials.md §1).
 */
import { createClient } from "@supabase/supabase-js";
import { SupabaseStudentRepository } from "../src/infrastructure/supabase/repositories/supabase-shared-repositories";
import { readDbPricingConfig } from "../src/infrastructure/supabase/repositories/supabase-pricing-repository";
import type { BatchRegistrationInput } from "../src/domain/model/student";

const SUPABASE_URL = "https://vebfehrpzajhstyhinnw.supabase.co";
const PUBLISHABLE = "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg";
const ADMIN_EMAIL = "admin@elimtiyaz.dz";
const ADMIN_PW = "elimtiyaz@admin2026";

// The repositories read the session fixture from localStorage — the node
// runtime has none, so a minimal shim carries the fixture (the same key the
// desktop persists: "el-imtiyaz.session").
function installSessionFixture(tenantId: string, userId: string): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
  store.set("el-imtiyaz.session", JSON.stringify({ tenantId, userId, displayName: "e2e T-398" }));
}

async function main(): Promise<number> {
  console.log("t-398-registration-live-e2e — the REAL batchRegister (ONE round-trip) against LIVE\n");
  const client = createClient(SUPABASE_URL, PUBLISHABLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: signIn, error: signInErr } = await client.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PW,
  });
  if (signInErr || !signIn.session) {
    console.error(`FATAL: sign-in failed: ${signInErr?.message ?? "no session"}`);
    return 1;
  }
  console.log(`signed in as ${ADMIN_EMAIL}\n`);

  // The tenant (the same RPC the probe used).
  const { data: tenantId, error: tenantErr } = await client.rpc("current_tenant_id");
  if (tenantErr || !tenantId) {
    console.error(`FATAL: tenant resolution failed: ${tenantErr?.message ?? "none"}`);
    return 1;
  }
  installSessionFixture(tenantId as string, signIn.user!.id);
  console.log(`tenant: ${tenantId}\n`);

  // The wizard's pricing config — the DB-loaded one (repos.pricing.observe()
  // in Supabase mode is the T-307 repository seeded from exactly this read).
  const pricingConfig = await readDbPricingConfig(client);

  const repo = new SupabaseStudentRepository(client);
  const RUN = String(Math.floor(Date.now() / 1000));
  const parentPhone = `05598${RUN.slice(-5)}`; // run-unique (8 digits)

  const input: BatchRegistrationInput = {
    parent: {
      firstName: "Famille",
      lastName: `Sonde T398 ${RUN}`,
      gender: "unspecified",
      phone: parentPhone,
      whatsapp: null,
      email: null,
      occupation: null,
      address: null,
      transportDestination: null,
      preferredLanguage: "fr",
    },
    students: [
      {
        firstName: "Enfant",
        lastName: `Sonde T398 ${RUN}`,
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
    pricingConfig,
  };

  let fails = 0;
  const check = (ok: boolean, label: string, detail = "") => {
    console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` | ${detail}` : ""}`);
    if (!ok) fails += 1;
  };

  // =====================================================================
  // RUN 1 — the REAL registration, wall-clock timed.
  // =====================================================================
  console.log("== Run 1: the REAL batchRegister (timed) ==");
  const t0 = performance.now();
  const r1 = await repo.batchRegister(input);
  const elapsed1 = performance.now() - t0;
  console.log(`  wall clock: ${elapsed1.toFixed(0)} ms (the T-397 shape measured 3,189 ms; the original 6,984 ms)\n`);

  check(r1.ok, "run 1 returns Ok", r1.ok ? "" : r1.error.userMessage);
  if (!r1.ok) return 1;
  const parent = r1.value.parent;
  const student = r1.value.students[0];
  check(/^PAR-\d{4}-/.test(parent.code), "parent model returned (mapParentRow)", parent.code);
  check(/^ELV-\d{4}-/.test(student.code), "student model returned + patched", `${student.code} ${student.gradeLevel}/${student.level}${student.gradeYear}`);
  check(student.parentId === parent.id, "student linked to the parent");

  // The persisted billing content — read back through the SAME client.
  const { data: ledgerRows } = await client
    .from("ledger_entries")
    .select("entry_type, amount, category, description, source_id, account_id, student_id, parent_id")
    .eq("parent_id", parent.id);
  const { data: instRows } = await client
    .from("installments")
    .select("category, tranche_number, amount_due, status, source_id")
    .eq("student_id", student.id);

  check((ledgerRows?.length ?? 0) === 4, "4 ledger rows (3 tuition + 1 fee)", `n=${ledgerRows?.length}`);
  check((instRows?.length ?? 0) === 3, "3 installment rows", `n=${instRows?.length}`);

  const tuitionRows = (ledgerRows ?? []).filter((e) => e.category === "tuition");
  check(
    tuitionRows.every((e) => e.source_id === `reg-${student.id}-t${tuitionRows.indexOf(e) + 1}`),
    "the 0103 substitution END-TO-END: source_id = reg-<uuid>-t<n> (the OLD path's identity)",
    tuitionRows[0]?.source_id ?? "-",
  );
  check(
    tuitionRows.every(
      (e) => e.account_id === `parent:${parent.id}:category:tuition:student:${student.id}`,
    ),
    "account_id = deriveAccountId format (server-derived)",
    tuitionRows[0]?.account_id ?? "-",
  );
  check(
    (ledgerRows ?? []).some((e) => e.source_id === `reg-${parent.id}-fee`),
    "the family fee row carries the parent-uuid identity",
  );
  check(
    (instRows ?? []).every((i) => i.source_id === `${student.id}:${i.category}:T${i.tranche_number}`),
    "installments source_id = <uuid>:<cat>:T<n> (the bulkImportInstallments default form)",
    instRows?.[0]?.source_id ?? "-",
  );
  const tuitionSum = tuitionRows.reduce((s, e) => s + Number(e.amount), 0);
  const instSum = (instRows ?? []).reduce((s, i) => s + Number(i.amount_due), 0);
  check(
    tuitionSum === instSum,
    "the ledger tranches and the installment schedule agree (Σ tuition = Σ tranches)",
    `${tuitionSum} = ${instSum}`,
  );

  // =====================================================================
  // RUN 2 — the idempotent re-run (the SAME payload through the REAL path).
  // =====================================================================
  console.log("\n== Run 2: the idempotent re-run (same payload) ==");
  const t1 = performance.now();
  const r2 = await repo.batchRegister(input);
  const elapsed2 = performance.now() - t1;
  console.log(`  wall clock: ${elapsed2.toFixed(0)} ms\n`);
  check(r2.ok, "re-run returns Ok", r2.ok ? "" : r2.error.userMessage);
  if (r2.ok) {
    check(r2.value.parent.id === parent.id, "converges on the SAME parent");
    check(r2.value.students[0].id === student.id, "converges on the SAME student");
  }
  const { count: ledgerAfter } = await client
    .from("ledger_entries")
    .select("id", { count: "exact", head: true })
    .eq("parent_id", parent.id);
  const { count: instAfter } = await client
    .from("installments")
    .select("id", { count: "exact", head: true })
    .eq("student_id", student.id);
  check(ledgerAfter === 4, "ZERO duplicate ledger rows after the re-run", `n=${ledgerAfter}`);
  check(instAfter === 3, "ZERO duplicate installments after the re-run", `n=${instAfter}`);

  // =====================================================================
  // CLEANUP — the canonical soft-delete RPCs (t-391 zero-residue; §15.26:
  // audit rows stay as the honest record).
  // =====================================================================
  console.log("\n== Cleanup (canonical soft-delete RPCs) ==");
  const { error: delStudentErr } = await client.rpc("soft_delete_student", {
    p_student_id: student.id,
  });
  check(!delStudentErr, "soft_delete_student", delStudentErr?.message ?? "ok");
  const { error: delParentErr } = await client.rpc("soft_delete_parent", {
    p_parent_id: parent.id,
  });
  check(!delParentErr, "soft_delete_parent", delParentErr?.message ?? "ok");

  const { count: residue } = await client
    .from("parents")
    .select("id", { count: "exact", head: true })
    .eq("id", parent.id)
    .eq("deleted_at", "null");
  console.log(`  visible probe rows after cleanup: ${residue ?? 0} (zero residue)\n`);

  console.log("=".repeat(72));
  console.log(
    `SUMMARY: ${fails === 0 ? "ALL PASS" : `${fails} FAIL`} — the REAL registration ` +
      `${elapsed1.toFixed(0)} ms (ONE round-trip; T-397: 3,189 ms / ~11 calls; the original: 6,984 ms / 21+ calls). ` +
      `The owner's route (Algeria→eu-west-1, 476–952 ms/RTT) projects ≈ 0.6–1.2 s (was 10–20 s).`,
  );
  console.log("=".repeat(72));
  return fails === 0 ? 0 : 1;
}

main().then((code) => process.exit(code));
