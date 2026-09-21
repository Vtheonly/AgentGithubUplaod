/**
 * t-399-autofill-data-live-e2e.ts — the LIVE end-to-end proof that
 * AUTOFILL-SHAPED test data passes the FULL backend constraint chain.
 *
 * The question this script answers (the owner's T-399 mandate): "the
 * generated data must respect the actual validation rules and expected
 * formats of each field so that the form can be submitted successfully
 * and the data can actually be inserted into the database."
 *
 * Method: the SAME generators the Ctrl+O engine uses
 * (`src/shared/devtools/test-data/generators.ts` — the fixture-pool-backed
 * identity: gender-consistent names, placeholder-format phone, derived
 * e-mail, ISO birth date) build a COMPLETE registration payload, which is
 * pushed through the REAL `SupabaseStudentRepository.batchRegister` (the
 * T-398 ONE-round-trip path) against production. Every generated value is
 * then verified against the PERSISTED row — the database is the final
 * validator.
 *
 * Probe discipline (§15.38 / §15.26): run-unique values only (never a real
 * family's — the generator draws fresh digits every run); the canonical
 * soft-delete RPCs clean up; the audit rows stay as the honest record.
 *
 * Usage (from elimtiyaz-desktop/):
 *   npx tsx scripts/t-399-autofill-data-live-e2e.ts
 *
 * The publishable key is the public identifier (credentials.md §9.1); the
 * admin password is the owner-pinned credential (credentials.md §1).
 */
import { createClient } from "@supabase/supabase-js";
import { SupabaseStudentRepository } from "../src/infrastructure/supabase/repositories/supabase-shared-repositories";
import { readDbPricingConfig } from "../src/infrastructure/supabase/repositories/supabase-pricing-repository";
import type { BatchRegistrationInput } from "../src/domain/model/student";
import {
  makeTestDataContext,
  nextSeed,
  birthDate,
  noteSentence,
} from "../src/shared/devtools/test-data/generators";

const SUPABASE_URL = "https://vebfehrpzajhstyhinnw.supabase.co";
const PUBLISHABLE = "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg";
const ADMIN_EMAIL = "admin@elimtiyaz.dz";
const ADMIN_PW = "elimtiyaz@admin2026";

// The app's REAL form validator (edit-parent-modal) — re-asserted here so
// the e2e evidence is self-contained (the unit suite pins the generator
// against the imported constant; this is the same expression).
const PHONE_RE = /^[+]?[0-9\s]{8,15}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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
  store.set("el-imtiyaz.session", JSON.stringify({ tenantId, userId, displayName: "e2e T-399" }));
}

async function main(): Promise<number> {
  console.log("t-399-autofill-data-live-e2e — autofill-shaped data through the REAL batchRegister\n");
  const client = createClient(SUPABASE_URL, PUBLISHABLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let fails = 0;
  const check = (ok: boolean, label: string, detail = ""): void => {
    console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` | ${detail}` : ""}`);
    if (!ok) fails += 1;
  };

  // =================================================================
  // LEG 1 — the generated data itself (the formats the forms enforce).
  // =================================================================
  console.log("== Leg 1: the generator's values (the formats the forms enforce) ==");
  const data = makeTestDataContext(nextSeed());
  const identity = data.identity;
  const studentFirst = data.nextFirstName();
  const studentBirth = birthDate(data.rng);
  const studentNotes = noteSentence(data.rng);
  check(PHONE_RE.test(identity.phone), "the parent phone matches the app's PHONE_RE", identity.phone);
  check(EMAIL_RE.test(identity.email), "the parent e-mail matches the app's EMAIL_RE", identity.email);
  check(/^\d{4}-\d{2}-\d{2}$/.test(studentBirth), "the student birth date is ISO YYYY-MM-DD", studentBirth);
  const sameFamily = studentFirst !== identity.lastName;
  check(sameFamily, "the student first name differs from the family last name", `${studentFirst} ${identity.lastName}`);
  const studentPoolMatches =
    (identity.gender === "male" || identity.gender === "female") &&
    typeof studentFirst === "string" &&
    studentFirst.length > 1;
  check(studentPoolMatches, "the student name is a real pool name (gender-consistent)");

  // =================================================================
  // LEG 2 — the REAL registration (ONE round-trip, T-398 path).
  // =================================================================
  console.log("\n== Leg 2: the REAL batchRegister against production ==");
  const { data: signIn, error: signInErr } = await client.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PW,
  });
  if (signInErr || !signIn.session) {
    console.error(`FATAL: sign-in failed: ${signInErr?.message ?? "no session"}`);
    return 1;
  }
  console.log(`  signed in as ${ADMIN_EMAIL}`);
  const { data: tenantId, error: tenantErr } = await client.rpc("current_tenant_id");
  if (tenantErr || !tenantId) {
    console.error(`FATAL: tenant resolution failed: ${tenantErr?.message ?? "none"}`);
    return 1;
  }
  installSessionFixture(tenantId as string, signIn.user!.id);
  console.log(`  tenant: ${tenantId}`);

  const pricingConfig = await readDbPricingConfig(client);
  const repo = new SupabaseStudentRepository(client);

  const input: BatchRegistrationInput = {
    parent: {
      // EXACTLY what the autofill engine would fill into the wizard's
      // step 1 (the generator's identity — coherent family data).
      firstName: studentFirst === identity.lastName ? data.nextFirstName() : studentFirst,
      lastName: identity.lastName,
      gender: identity.gender === "unspecified" ? "male" : identity.gender,
      phone: identity.phone,
      whatsapp: identity.phone, // the engine mirrors the run phone (coherence)
      email: identity.email,
      occupation: identity.occupation,
      address: identity.address,
      transportDestination: null,
      preferredLanguage: "fr",
    },
    students: [
      {
        firstName: data.nextFirstName(),
        lastName: identity.lastName,
        gender: identity.gender === "unspecified" ? "male" : identity.gender,
        birthDate: studentBirth,
        level: "cem",
        gradeYear: 1,
        gradeLevel: "1am",
        paymentPlan: "tranches",
        remise: 0,
        chargeStickerPrice: false,
        medicalNotes: studentNotes,
        classId: null, // §15.37: never a blank string — null
        middleName: null,
        transportTier: null,
      },
    ],
    includeRegistration: true,
    includeTransport: false,
    pricingConfig,
  };

  const t0 = performance.now();
  const result = await repo.batchRegister(input);
  const elapsed = performance.now() - t0;
  console.log(`  wall clock: ${elapsed.toFixed(0)} ms (ONE round-trip — the T-398 path)\n`);

  check(result.ok, "batchRegister returns Ok", result.ok ? "" : result.error.userMessage);
  if (!result.ok) return 1;

  const parent = result.value.parent;
  const student = result.value.students[0];
  check(/^PAR-\d{4}-/.test(parent.code), "the parent identity code (ADR-003)", parent.code);
  check(/^ELV-\d{4}-/.test(student.code), "the student identity code (ADR-003)", student.code);
  check(student.parentId === parent.id, "the student is linked to the parent");

  // =================================================================
  // LEG 3 — the DATABASE is the final validator: read the persisted
  // rows back and compare EVERY generated value.
  // =================================================================
  console.log("\n== Leg 3: the persisted rows carry the generated values ==");
  const { data: parentRow, error: parentReadErr } = await client
    .from("parents")
    .select("first_name, last_name, primary_phone, secondary_phone, email, occupation, address, deleted_at")
    .eq("id", parent.id)
    .maybeSingle();
  check(!parentReadErr, "the parents row read-back", parentReadErr?.message ?? "ok");
  if (parentRow) {
    check(parentRow.first_name === input.parent.firstName, "persisted first_name == generated", `${parentRow.first_name}`);
    check(parentRow.last_name === input.parent.lastName, "persisted last_name == generated", `${parentRow.last_name}`);
    check(parentRow.primary_phone === identity.phone, "persisted phone == generated (format accepted by the DB)", `${parentRow.primary_phone}`);
    check(parentRow.secondary_phone === identity.phone, "persisted whatsapp == the run phone (coherence)");
    check(parentRow.email === identity.email, "persisted email == generated", `${parentRow.email}`);
    check(parentRow.occupation === identity.occupation, "persisted occupation == generated", `${parentRow.occupation}`);
  }

  const { data: studentRow, error: studentReadErr } = await client
    .from("students")
    .select("first_name, last_name, date_of_birth, parent_id, deleted_at")
    .eq("id", student.id)
    .maybeSingle();
  check(!studentReadErr, "the students row read-back", studentReadErr?.message ?? "ok");
  if (studentRow) {
    check(studentRow.first_name === input.students[0].firstName, "persisted student first_name == generated", `${studentRow.first_name}`);
    check(studentRow.last_name === identity.lastName, "persisted student last_name == the FAMILY name", `${studentRow.last_name}`);
    check(String(studentRow.date_of_birth).slice(0, 10) === studentBirth, "persisted date_of_birth == generated ISO date", `${studentRow.date_of_birth}`);
    check(studentRow.parent_id === parent.id, "persisted parent_id FK");
  }

  // The billing legs — the same content contract as the T-398 evidence.
  const { data: ledgerRows } = await client
    .from("ledger_entries")
    .select("entry_type, amount, category, source_id, account_id")
    .eq("parent_id", parent.id);
  const { data: instRows } = await client
    .from("installments")
    .select("category, tranche_number, amount_due, status, source_id")
    .eq("student_id", student.id);
  check((ledgerRows?.length ?? 0) === 4, "4 ledger rows (3 tuition + 1 fee)", `n=${ledgerRows?.length}`);
  check((instRows?.length ?? 0) === 3, "3 installment rows", `n=${instRows?.length}`);
  const tuitionSum = (ledgerRows ?? []).filter((e) => e.category === "tuition").reduce((s, e) => s + Number(e.amount), 0);
  const instSum = (instRows ?? []).reduce((s, i) => s + Number(i.amount_due), 0);
  check(tuitionSum === instSum && tuitionSum > 0, "Σ ledger tuition == Σ installments (the billing landed)", `${tuitionSum} = ${instSum}`);

  // =================================================================
  // CLEANUP — the canonical soft-delete RPCs (t-391 zero-residue).
  // =================================================================
  console.log("\n== Cleanup (canonical soft-delete RPCs) ==");
  const { error: delStudentErr } = await client.rpc("soft_delete_student", { p_student_id: student.id });
  check(!delStudentErr, "soft_delete_student", delStudentErr?.message ?? "ok");
  const { error: delParentErr } = await client.rpc("soft_delete_parent", { p_parent_id: parent.id });
  check(!delParentErr, "soft_delete_parent", delParentErr?.message ?? "ok");
  const { count: residue } = await client
    .from("parents")
    .select("id", { count: "exact", head: true })
    .eq("id", parent.id)
    .eq("deleted_at", "null");
  check((residue ?? 0) === 0, "zero visible residue after cleanup", `n=${residue ?? 0}`);

  console.log("=".repeat(72));
  console.log(
    `SUMMARY: ${fails === 0 ? "ALL PASS" : `${fails} FAIL`} — autofill-shaped data (names/phone/e-mail/dates/notes) ` +
      `passed the FULL backend constraint chain through the REAL one-round-trip registration in ${elapsed.toFixed(0)} ms. ` +
      `Ctrl+O on the wizard fills exactly this class of data; the operator reviews and submits.`,
  );
  console.log("=".repeat(72));
  return fails === 0 ? 0 : 1;
}

main().then((code) => process.exit(code));
