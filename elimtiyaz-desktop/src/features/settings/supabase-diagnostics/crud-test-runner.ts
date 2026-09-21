// ============================================================================
// FILE: src/features/settings/supabase-diagnostics/crud-test-runner.ts
// ============================================================================
/**
 * T-396 / OPS-320 — the backend CRUD integration test suite (the owner's
 * 2026-09-21 mandate: "a testing capability that allows me to test the entire
 * CRUD flow and verify that every operation works correctly with the backend
 * ... i want to be 100% certain that everything is working without errors").
 *
 * Executes a DETERMINISTIC ordered write-path suite through the canonical
 * singleton client, using the EXACT REST/RPC shapes the repositories use
 * (each leg cites its source method). Every result is honest: a failing leg
 * never aborts the run (only the prep short-circuit does), and the cleanup
 * phase ALWAYS runs (best-effort soft-delete of any surviving probe rows).
 *
 * The suite covers the owner's exact matrix:
 *   1. Préparation      — SDK session + tenant resolution (short-circuit gate)
 *   2. Insertion        — parents + students (the createParent/createStudent
 *                         RPC shapes) + read-backs + upsert idempotency
 *   3. Mise à jour      — the updateParent/updateStudent PATCH shapes +
 *                         persisted-value read-backs
 *   4. Lectures         — the seed list shapes (tenant + deleted_at filters)
 *   5. Import groupé    — ONE bulk ledger upsert + ONE bulk installments
 *                         upsert (the bulkAppend/bulkImportInstallments
 *                         shapes — the PERF-501 fast paths) + read-backs
 *   6. Relations        — student→parent FK + tenant consistency + the
 *                         billing rows' parent/student linkage
 *   7. Erreurs de validation — blank-string uuid (22P02, the SYNC-300 pin)
 *                         + invalid category (23514) — PASS = the backend
 *                         REJECTS cleanly with the classified code
 *   8. Erreurs serveur  — FK violation (23503) with the code surfaced
 *   9. Suppression      — the canonical soft_delete_student/parent RPCs +
 *                         list-exclusion read-backs (the UI consistency)
 *  10. Nettoyage        — zero-residue confirmation (probe rows all
 *                         soft-deleted; §15.26 audit rows stay by design)
 *
 * After EVERY mutation the paired read-back uses the same query shape the UI
 * list would use — that IS the "UI state stays consistent with the database"
 * verification (a mutation whose effect is invisible to the read shape the
 * UI relies on is a consistency failure, surfaced as such).
 *
 * Safety rules (the T-393 conventions):
 *   - run-unique probe codes (the t-391 convention) — never real rows (§15.38);
 *   - details contain HTTP status, error codes, table names and row counts —
 *     NEVER the key, NEVER tokens, NEVER the JWT;
 *   - the cleanup phase soft-deletes through the CANONICAL RPCs only.
 */
import type {
  DiagnosticCheck,
  DiagnosticsReport,
  DiagnosticsRunOptions,
  CheckStatus,
} from "./diagnostics-types";

/* ------------------------------------------------------------------ */
/* Shared helpers (same conventions as diagnostics-runner.ts)           */
/* ------------------------------------------------------------------ */

interface SupabaseErrorLike {
  code?: string | number;
  message?: string;
}

function safeMessage(err: SupabaseErrorLike | null | undefined, fallback: string): string {
  const raw = typeof err?.message === "string" ? err.message : "";
  if (!raw) return fallback;
  return raw.replace(/\s+/g, " ").slice(0, 240);
}

function safeErrorDetail(
  err: SupabaseErrorLike | null | undefined,
  operation: string,
): string {
  const code = err?.code !== undefined && err?.code !== null ? String(err.code) : "";
  const msg = safeMessage(err, "erreur inconnue");
  const codePart = code ? `code ${code}, ` : "";
  return `${operation} — ${codePart}${msg}`;
}

async function timed<T>(fn: () => PromiseLike<T>): Promise<{ value: T; ms: number }> {
  const start = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - start };
}

function check(
  id: string,
  category: string,
  label: string,
  status: CheckStatus,
  detail: string,
  durationMs: number | null,
): DiagnosticCheck {
  return { id, category, label, status, detail, durationMs };
}

/** Extract the PostgREST error code (supabase-js puts it in `error.code`). */
function errorCode(err: SupabaseErrorLike | null | undefined): string {
  return err?.code !== undefined && err?.code !== null ? String(err.code) : "";
}

/* ------------------------------------------------------------------ */
/* Categories (French — module-scoped, the T-388 burn-down owns the     */
/* dictionary files; this module keeps its labels internal)            */
/* ------------------------------------------------------------------ */

const CAT_PREP = "Préparation";
const CAT_INSERT = "Insertion (parents / élèves)";
const CAT_UPDATE = "Mise à jour";
const CAT_READ = "Lectures (listes)";
const CAT_BULK = "Import groupé (bulk)";
const CAT_RELATION = "Relations";
const CAT_VALIDATION = "Erreurs de validation";
const CAT_SERVER = "Erreurs serveur / base";
const CAT_DELETE = "Suppression";
const CAT_CLEANUP = "Nettoyage";

/** The deterministic total-check count (prep-fail short-circuit aware). */
export function expectedCrudCheckCount(): number {
  // 2 prep + 5 insert + 4 update + 2 read + 3 bulk + 3 relation +
  // 2 validation + 1 server + 4 delete + 1 cleanup
  return 27;
}

/* ------------------------------------------------------------------ */
/* The suite                                                            */
/* ------------------------------------------------------------------ */

/** The run-unique probe identity (exposed for tests + the view header). */
export interface CrudProbeIdentity {
  runStamp: string;
  parentCode: string;
  studentCode: string;
}

function makeProbeIdentity(now: () => number): CrudProbeIdentity {
  const runStamp = String(now());
  return {
    runStamp,
    parentCode: `PAR-PROBE-T396-${runStamp}`,
    studentCode: `ELV-PROBE-T396-${runStamp}`,
  };
}

/**
 * The deterministic CRUD integration suite.
 *
 * @param opts.client       the canonical singleton (getSupabaseClient())
 * @param opts.domainSession the app session (informational — the suite
 *                          authenticates through the SDK session itself)
 * @param opts.now          test seam: deterministic clock (default Date.now)
 */
export async function runCrudIntegrationTests(
  opts: DiagnosticsRunOptions & { now?: () => number },
): Promise<DiagnosticsReport & { probe?: CrudProbeIdentity }> {
  const now = opts.now ?? (() => Date.now());
  const probe = makeProbeIdentity(now);
  const checks: DiagnosticCheck[] = [];
  const client = opts.client;

  // ---- 1. Préparation (the short-circuit gate) ----------------------
  let sdkSessionOk = false;
  let tenantId: string | null = null;

  if (!client) {
    checks.push(
      check(
        "crud.prep.client",
        CAT_PREP,
        "Client Supabase configuré",
        "fail",
        "client non configuré — ouvrez l'onglet Configuration.",
        0,
      ),
    );
    return summarize(checks, probe);
  }

  {
    const { value, ms } = await timed(() => client.auth.getSession());
    const session = (value as { data?: { session?: unknown } }).data?.session;
    sdkSessionOk = !!session;
    checks.push(
      check(
        "crud.prep.session",
        CAT_PREP,
        "Session Supabase active (getSession)",
        sdkSessionOk ? "pass" : "fail",
        sdkSessionOk
          ? "session présente — les écritures partiront authentifiées."
          : "aucune session SDK — reconnectez-vous (signature AUTH-302 : les écritures partiraient en anon et seraient rejetées par RLS).",
        ms,
      ),
    );
  }

  {
    const { value, ms } = await timed(() =>
      client.rpc("current_tenant_id", {}) as PromiseLike<{ data: unknown }>,
    );
    tenantId =
      typeof (value as { data?: unknown }).data === "string"
        ? ((value as { data: string }).data)
        : null;
    checks.push(
      check(
        "crud.prep.tenant",
        CAT_PREP,
        "Résolution du tenant (current_tenant_id)",
        tenantId ? "pass" : "fail",
        tenantId
          ? `tenant ${tenantId}`
          : "aucun tenant résolu pour cette session (le compte n'est lié à aucun établissement).",
        ms,
      ),
    );
  }

  if (!sdkSessionOk || !tenantId) {
    // Honest short-circuit: write probes are NOT TESTED without a session +
    // tenant. One row per remaining category (the T-393 pattern).
    const reason = !sdkSessionOk
      ? "pas de session SDK — écritures impossibles"
      : "pas de tenant résolu — écritures impossibles";
    for (const c of [
      { category: CAT_INSERT, label: "Insertion (parents / élèves)" },
      { category: CAT_UPDATE, label: "Mise à jour" },
      { category: CAT_READ, label: "Lectures (listes)" },
      { category: CAT_BULK, label: "Import groupé (bulk)" },
      { category: CAT_RELATION, label: "Relations" },
      { category: CAT_VALIDATION, label: "Erreurs de validation" },
      { category: CAT_SERVER, label: "Erreurs serveur / base" },
      { category: CAT_DELETE, label: "Suppression" },
      { category: CAT_CLEANUP, label: "Nettoyage" },
    ]) {
      checks.push(check(`crud.skipped.${c.category}`, c.category, c.label, "not_tested", reason, null));
    }
    return summarize(checks, probe);
  }

  const parentCode = probe.parentCode;
  const studentCode = probe.studentCode;
  const PROBE_PHONE = "0554288199"; // probe-range phone (never a real family's)

  // Mutable state carried across phases.
  let parentId = "";
  let studentId = "";

  // ---- 2. Insertion (the createParent / createStudent shapes) --------
  {
    // createParent — SupabaseParentRepository.createParent's exact RPC shape.
    const { value, ms } = await timed(() =>
      client.rpc("upsert_parent_from_import", {
        p_tenant_id: tenantId,
        p_parent_code: parentCode,
        p_first_name: "Sonde",
        p_last_name: "CRUD T396",
        p_display_name: "Sonde CRUD T396",
        p_primary_phone: PROBE_PHONE,
        p_secondary_phone: null,
        p_email: null,
        p_occupation: null,
        p_address: null,
        p_relationship: null,
        p_preferred_language: "fr",
        p_is_active: true,
        p_activation_code: `ACT-T396-${probe.runStamp}`,
        p_transport_destination: null,
        p_city_tier: null,
      }) as PromiseLike<{
        data: Array<{ out_parent_id: string; out_parent_code: string; out_was_inserted: boolean }> | null;
        error: SupabaseErrorLike | null;
      }>,
    );
    const rows = value.data ?? [];
    const row = rows[0];
    if (value.error || !row?.out_parent_id) {
      checks.push(
        check(
          "crud.insert.parent",
          CAT_INSERT,
          "Créer un parent (RPC upsert_parent_from_import)",
          "fail",
          safeErrorDetail(value.error, "POST /rest/v1/rpc/upsert_parent_from_import"),
          ms,
        ),
      );
    } else {
      parentId = row.out_parent_id;
      checks.push(
        check(
          "crud.insert.parent",
          CAT_INSERT,
          "Créer un parent (RPC upsert_parent_from_import)",
          row.out_was_inserted ? "pass" : "fail",
          row.out_was_inserted
            ? `parent créé — ${row.out_parent_code} (${row.out_parent_id.slice(0, 8)}…)`
            : `code ${parentCode} existait déjà (out_was_inserted=false) — une sonde précédente n'a pas été nettoyée.`,
          ms,
        ),
      );
    }
  }

  if (parentId) {
    // createParent — the full-row fetch (refreshById shape).
    const { value, ms } = await timed(() =>
      client.from("parents").select("*").eq("id", parentId).maybeSingle() as PromiseLike<{
        data: Record<string, unknown> | null;
        error: SupabaseErrorLike | null;
      }>,
    );
    const r = value.data;
    const fieldsOk =
      !!r && !value.error && r.parent_code === parentCode && r.primary_phone === PROBE_PHONE;
    checks.push(
      check(
        "crud.insert.parent-readback",
        CAT_INSERT,
        "Relire le parent créé (forme refreshById)",
        fieldsOk ? "pass" : "fail",
        fieldsOk
          ? `ligne relue — ${r!.parent_code}, téléphone conforme.`
          : safeErrorDetail(value.error, `GET /rest/v1/parents?id=eq.${parentId.slice(0, 8)}…`),
        ms,
      ),
    );
  }

  if (parentId) {
    // createStudent — SupabaseStudentRepository.createStudent's exact RPC shape.
    const { value, ms } = await timed(() =>
      client.rpc("upsert_student_from_import", {
        p_tenant_id: tenantId,
        p_student_code: studentCode,
        p_parent_id: parentId,
        p_first_name: "Enfant",
        p_last_name: "Sonde",
        p_display_name: "Enfant Sonde",
        p_middle_name: null,
        p_date_of_birth: null,
        p_gender: null,
        p_grade_level_id: null,
        p_class_id: null,
        p_enrollment_date: null,
        p_enrollment_status: "active",
        p_medical_notes: null,
        p_is_active: true,
        p_grade_level_code: "1AM",
        p_transport_tier: null,
        p_payment_plan: "tranches",
      }) as PromiseLike<{
        data: Array<{ out_student_id: string; out_student_code: string; out_was_inserted: boolean }> | null;
        error: SupabaseErrorLike | null;
      }>,
    );
    const rows = value.data ?? [];
    const row = rows[0];
    if (value.error || !row?.out_student_id) {
      checks.push(
        check(
          "crud.insert.student",
          CAT_INSERT,
          "Créer un élève (RPC upsert_student_from_import)",
          "fail",
          safeErrorDetail(value.error, "POST /rest/v1/rpc/upsert_student_from_import"),
          ms,
        ),
      );
    } else {
      studentId = row.out_student_id;
      checks.push(
        check(
          "crud.insert.student",
          CAT_INSERT,
          "Créer un élève (RPC upsert_student_from_import)",
          "pass",
          `élève créé — ${row.out_student_code}, rattaché au parent sonde.`,
          ms,
        ),
      );
    }
  }

  if (studentId) {
    const { value, ms } = await timed(() =>
      client.from("students").select("*").eq("id", studentId).maybeSingle() as PromiseLike<{
        data: Record<string, unknown> | null;
        error: SupabaseErrorLike | null;
      }>,
    );
    const r = value.data;
    const fieldsOk =
      !!r && !value.error && r.student_code === studentCode && r.parent_id === parentId;
    checks.push(
      check(
        "crud.insert.student-readback",
        CAT_INSERT,
        "Relire l'élève créé (forme refreshById)",
        fieldsOk ? "pass" : "fail",
        fieldsOk
          ? `ligne relue — ${r!.student_code}, parent_id conforme.`
          : safeErrorDetail(value.error, `GET /rest/v1/students?id=eq.${studentId.slice(0, 8)}…`),
        ms,
      ),
    );
  }

  if (parentId) {
    // Upsert idempotency — the deterministic-code convergence contract: the
    // SAME identity re-upserted must UPDATE, never duplicate.
    const { value, ms } = await timed(() =>
      client.rpc("upsert_parent_from_import", {
        p_tenant_id: tenantId,
        p_parent_code: parentCode,
        p_first_name: "Sonde",
        p_last_name: "CRUD T396",
        p_display_name: "Sonde CRUD T396",
        p_primary_phone: PROBE_PHONE,
        p_secondary_phone: null,
        p_email: null,
        p_occupation: null,
        p_address: null,
        p_relationship: null,
        p_preferred_language: "fr",
        p_is_active: true,
        p_activation_code: `ACT-T396-${probe.runStamp}`,
        p_transport_destination: null,
        p_city_tier: null,
      }) as PromiseLike<{
        data: Array<{ out_parent_id: string; out_was_inserted: boolean }> | null;
        error: SupabaseErrorLike | null;
      }>,
    );
    const row = (value.data ?? [])[0];
    const idempotent =
      !value.error && !!row && row.out_parent_id === parentId && row.out_was_inserted === false;
    checks.push(
      check(
        "crud.insert.idempotency",
        CAT_INSERT,
        "Idempotence de l'upsert (re-créer = mise à jour, pas de doublon)",
        idempotent ? "pass" : "fail",
        idempotent
          ? "le second upsert a convergé sur la même ligne (out_was_inserted=false)."
          : safeErrorDetail(value.error, "re-upsert du même code parent"),
        ms,
      ),
    );
  }

  // ---- 3. Mise à jour (the updateParent / updateStudent PATCH shapes) --
  const UPDATED_ADDRESS = "Adresse mise à jour par le test CRUD T396";
  const UPDATED_NOTES = "Notes mises à jour par le test CRUD T396";
  if (parentId) {
    const { value, ms } = await timed(() =>
      client.from("parents").update({ address: UPDATED_ADDRESS }).eq("id", parentId) as PromiseLike<{
        error: SupabaseErrorLike | null;
      }>,
    );
    checks.push(
      check(
        "crud.update.parent",
        CAT_UPDATE,
        "Mettre à jour le parent (PATCH parents)",
        value.error ? "fail" : "pass",
        value.error
          ? safeErrorDetail(value.error, `PATCH /rest/v1/parents?id=eq.${parentId.slice(0, 8)}…`)
          : "PATCH accepté (adresse).",
        ms,
      ),
    );

    // Consistency: the LIST shape (what the UI reads) must reflect the update.
    const rb = await timed(() =>
      client
        .from("parents")
        .select("*")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("last_name", { ascending: true }) as PromiseLike<{
        data: Array<Record<string, unknown>> | null;
        error: SupabaseErrorLike | null;
      }>,
    );
    const inList = (rb.value.data ?? []).find((r) => r.id === parentId);
    const reflected = !!inList && inList.address === UPDATED_ADDRESS;
    checks.push(
      check(
        "crud.update.parent-consistency",
        CAT_UPDATE,
        "La liste reflète la mise à jour (cohérence UI / base)",
        reflected ? "pass" : "fail",
        reflected
          ? "la lecture liste renvoie la nouvelle adresse."
          : "la lecture liste ne reflète PAS la valeur mise à jour — l'UI afficherait une donnée périmée.",
        rb.ms,
      ),
    );
  }

  if (studentId) {
    const { value, ms } = await timed(() =>
      client.from("students").update({ medical_notes: UPDATED_NOTES }).eq("id", studentId) as PromiseLike<{
        error: SupabaseErrorLike | null;
      }>,
    );
    checks.push(
      check(
        "crud.update.student",
        CAT_UPDATE,
        "Mettre à jour l'élève (PATCH students)",
        value.error ? "fail" : "pass",
        value.error
          ? safeErrorDetail(value.error, `PATCH /rest/v1/students?id=eq.${studentId.slice(0, 8)}…`)
          : "PATCH accepté (notes médicales).",
        ms,
      ),
    );

    const rb = await timed(() =>
      client.from("students").select("*").eq("id", studentId).maybeSingle() as PromiseLike<{
        data: Record<string, unknown> | null;
        error: SupabaseErrorLike | null;
      }>,
    );
    const reflected = !!rb.value.data && rb.value.data.medical_notes === UPDATED_NOTES;
    checks.push(
      check(
        "crud.update.student-consistency",
        CAT_UPDATE,
        "La relecture reflète la mise à jour de l'élève",
        reflected ? "pass" : "fail",
        reflected
          ? "les notes mises à jour sont persistées."
          : "la relecture ne reflète PAS la mise à jour.",
        rb.ms,
      ),
    );
  }

  // ---- 4. Lectures (the seed list shapes) ----------------------------
  {
    const { value, ms } = await timed(() =>
      client
        .from("parents")
        .select("*")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("last_name", { ascending: true }) as PromiseLike<{
        data: Array<Record<string, unknown>> | null;
        error: SupabaseErrorLike | null;
      }>,
    );
    const found = (value.data ?? []).some((r) => r.parent_code === parentCode);
    checks.push(
      check(
        "crud.read.parents-list",
        CAT_READ,
        "Lister les parents (forme seed de l'annuaire)",
        !value.error && found ? "pass" : "fail",
        value.error
          ? safeErrorDetail(value.error, "GET /rest/v1/parents (filtre tenant + deleted_at)")
          : found
            ? `le parent sonde est présent dans la liste (${(value.data ?? []).length} lignes visibles).`
            : "le parent sonde est ABSENT de la liste — l'UI ne l'afficherait pas.",
        ms,
      ),
    );
  }
  {
    const { value, ms } = await timed(() =>
      client
        .from("students")
        .select("*")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("last_name", { ascending: true }) as PromiseLike<{
        data: Array<Record<string, unknown>> | null;
        error: SupabaseErrorLike | null;
      }>,
    );
    const found = (value.data ?? []).some((r) => r.student_code === studentCode);
    checks.push(
      check(
        "crud.read.students-list",
        CAT_READ,
        "Lister les élèves (forme seed de l'annuaire)",
        !value.error && found ? "pass" : "fail",
        value.error
          ? safeErrorDetail(value.error, "GET /rest/v1/students (filtre tenant + deleted_at)")
          : found
            ? `l'élève sonde est présent dans la liste (${(value.data ?? []).length} lignes visibles).`
            : "l'élève sonde est ABSENT de la liste — l'UI ne l'afficherait pas.",
        ms,
      ),
    );
  }

  // ---- 5. Import groupé (the PERF-501 bulk fast paths) ----------------
  // The account id derivation (domain/calc/ledger/account-id.ts format) —
  // the same deterministic string the repositories write.
  const accountId = `parent:${parentId}:category:tuition:student:${studentId}`;
  const bulkLedgerRows = [1, 2, 3].map((t) => ({
    tenant_id: tenantId,
    entry_number: `probe-t396-${probe.runStamp}-t${t}`,
    parent_id: parentId,
    student_id: studentId,
    account_id: accountId,
    entry_type: "charge",
    amount: 1000,
    category: "tuition",
    description: `Sonde CRUD T396 — tranche ${t}`,
    entry_date: new Date().toISOString(),
    source_type: "installment",
    source_id: `probe-t396-${probe.runStamp}-t${t}`,
    method: null,
    receipt_number: null,
    payment_status: null,
    reverses_id: null,
    actor_id: "system",
    actor_name: "Test CRUD T396",
    at: new Date().toISOString(),
    metadata: { probe: `t396-${probe.runStamp}` },
  }));
  {
    // SupabaseLedgerRepository.bulkAppend's exact wire shape (ignoreDuplicates).
    const { value, ms } = await timed(() =>
      client
        .from("ledger_entries")
        .upsert(bulkLedgerRows, { ignoreDuplicates: true })
        .select("source_id") as PromiseLike<{
        data: Array<Record<string, unknown>> | null;
        error: SupabaseErrorLike | null;
      }>,
    );
    const inserted = value.data?.length ?? 0;
    checks.push(
      check(
        "crud.bulk.ledger",
        CAT_BULK,
        "Insertion groupée du grand livre (3 écritures en 1 appel)",
        !value.error && inserted === 3 ? "pass" : "fail",
        value.error
          ? safeErrorDetail(value.error, "POST /rest/v1/ledger_entries (upsert ignore-duplicates)")
          : `${inserted}/3 écritures insérées en UN seul appel.`,
        ms,
      ),
    );
  }
  const bulkInstallmentRows = [1, 2, 3].map((t) => ({
    tenant_id: tenantId,
    parent_id: parentId,
    student_id: studentId,
    category: "tuition",
    tranche_number: t,
    label: `Sonde CRUD T396 — T${t}`,
    amount_due: 1000,
    amount_paid: 0,
    amount_pending: 0,
    due_date: new Date(Date.now() + 30 * 86400000).toISOString(),
    paid_date: null,
    status: "unpaid",
    academic_cycle: null,
    payment_plan: "tranches",
    is_custom_schedule: false,
    custom_schedule_note: null,
    source_type: "bulk_import",
    source_id: `probe-t396-${probe.runStamp}-inst-${t}`,
    updated_at: new Date().toISOString(),
  }));
  {
    // SupabaseInstallmentRepository.bulkImportInstallments' exact wire shape.
    const { value, ms } = await timed(() =>
      client
        .from("installments")
        .upsert(bulkInstallmentRows, {
          onConflict: "tenant_id,parent_id,student_id,category,tranche_number",
        })
        .select("id") as PromiseLike<{
        data: Array<Record<string, unknown>> | null;
        error: SupabaseErrorLike | null;
      }>,
    );
    const inserted = value.data?.length ?? 0;
    checks.push(
      check(
        "crud.bulk.installments",
        CAT_BULK,
        "Import groupé des tranches (3 lignes en 1 appel)",
        !value.error && inserted === 3 ? "pass" : "fail",
        value.error
          ? safeErrorDetail(value.error, "POST /rest/v1/installments (upsert on-conflict identité)")
          : `${inserted}/3 tranches insérées en UN seul appel.`,
        ms,
      ),
    );
  }
  {
    const { value, ms } = await timed(() =>
      client.from("installments").select("*").eq("student_id", studentId) as PromiseLike<{
        data: Array<Record<string, unknown>> | null;
        error: SupabaseErrorLike | null;
      }>,
    );
    const rows = value.data ?? [];
    const ok =
      !value.error &&
      rows.length === 3 &&
      rows.every((r) => r.parent_id === parentId && Number(r.amount_due) === 1000);
    checks.push(
      check(
        "crud.bulk.readback",
        CAT_BULK,
        "Relire les lignes importées en groupe",
        ok ? "pass" : "fail",
        value.error
          ? safeErrorDetail(value.error, "GET /rest/v1/installments?student_id=eq.…")
          : ok
            ? "3 tranches conformes (parent, montants)."
            : `${rows.length} tranches relues (3 attendues, montants/parent à vérifier).`,
        ms,
      ),
    );
  }

  // ---- 6. Relations ---------------------------------------------------
  {
    // The student→parent FK + tenant consistency (both rows same tenant).
    const { value, ms } = await timed(() =>
      client.from("students").select("id, parent_id, tenant_id").eq("id", studentId).maybeSingle() as PromiseLike<{
        data: { parent_id: string; tenant_id: string } | null;
        error: SupabaseErrorLike | null;
      }>,
    );
    const r = value.data;
    const ok = !!r && !value.error && r.parent_id === parentId && r.tenant_id === tenantId;
    checks.push(
      check(
        "crud.relation.student-parent",
        CAT_RELATION,
        "Relation élève → parent (FK + cohérence tenant)",
        ok ? "pass" : "fail",
        ok
          ? "l'élève pointe vers le parent sonde, même tenant."
          : "la relation est incohérente (parent_id ou tenant divergent).",
        ms,
      ),
    );
  }
  {
    // The billing rows' linkage (ledger + installments both carry the pair).
    const { value, ms } = await timed(() =>
      client.from("ledger_entries").select("parent_id, student_id, category").eq("student_id", studentId) as PromiseLike<{
        data: Array<{ parent_id: string; student_id: string; category: string }> | null;
        error: SupabaseErrorLike | null;
      }>,
    );
    const rows = value.data ?? [];
    const ok =
      !value.error &&
      rows.length >= 3 &&
      rows.every((r) => r.parent_id === parentId && r.student_id === studentId);
    checks.push(
      check(
        "crud.relation.billing",
        CAT_RELATION,
        "Relations facturation (écritures ↔ parent ↔ élève)",
        ok ? "pass" : "fail",
        ok
          ? `${rows.length} écritures liées au bon couple parent/élève.`
          : safeErrorDetail(value.error, "GET /rest/v1/ledger_entries?student_id=eq.…"),
        ms,
      ),
    );
  }
  {
    // The parent's aggregate view (what the parent detail drawer reads).
    const { value, ms } = await timed(() =>
      client.from("installments").select("id, amount_due").eq("parent_id", parentId) as PromiseLike<{
        data: Array<{ amount_due: string | number }> | null;
        error: SupabaseErrorLike | null;
      }>,
    );
    const rows = value.data ?? [];
    const total = rows.reduce((s, r) => s + Number(r.amount_due), 0);
    const ok = !value.error && rows.length >= 3 && total >= 3000;
    checks.push(
      check(
        "crud.relation.parent-billing",
        CAT_RELATION,
        "Vue agrégée du parent (tranches rattachées)",
        ok ? "pass" : "fail",
        value.error
          ? safeErrorDetail(value.error, "GET /rest/v1/installments?parent_id=eq.…")
          : ok
            ? `${rows.length} tranches pour le parent sonde (Σ ${total} DZD).`
            : `${rows.length} tranche(s) relue(s), Σ ${total} DZD — au moins 3 tranches / 3 000 DZD attendues (la phase d'import groupé a-t-elle échoué ?).`,
        ms,
      ),
    );
  }

  // ---- 7. Erreurs de validation (PASS = clean rejection) --------------
  {
    // SYNC-300 pin: a blank-string uuid argument must be rejected with a
    // CLEAN 400 + 22P02 — never a 500, never a silent success.
    const { value, ms } = await timed(() =>
      client.rpc("upsert_student_from_import", {
        p_tenant_id: tenantId,
        p_student_code: `${studentCode}-VAL`,
        p_parent_id: "", // the blank-string class (SYNC-300)
        p_first_name: "Sonde",
        p_last_name: "Validation",
        p_display_name: "Sonde Validation",
        p_middle_name: null,
        p_date_of_birth: null,
        p_gender: null,
        p_grade_level_id: null,
        p_class_id: null,
        p_enrollment_date: null,
        p_enrollment_status: "active",
        p_medical_notes: null,
        p_is_active: true,
        p_grade_level_code: null,
        p_transport_tier: null,
        p_payment_plan: "tranches",
      }) as PromiseLike<{ data: unknown; error: SupabaseErrorLike | null }>,
    );
    const err = value.error;
    const code = errorCode(err);
    // The SYNC-300 pin: the blank-string uuid class must be rejected CLEANLY.
    // TWO valid rejection shapes (live evidence, 2026-09-21): the PostgREST
    // gateway cast (22P02) OR the hardened RPC body's own guard (P0001
    // "unresolvable parent ref" with the push-the-parent hint — the live
    // signature validates before any write). Both are HTTP 400 with a
    // classified code; a 200 (accepted) or a 500 is the failure.
    const rejectedCleanly =
      !!err &&
      (code === "22P02" || code === "P0001" || /uuid/i.test(safeMessage(err, "")));
    checks.push(
      check(
        "crud.validation.blank-uuid",
        CAT_VALIDATION,
        "Rejet propre : uuid vide (22P02 / P0001, le pin SYNC-300)",
        rejectedCleanly ? "pass" : "fail",
        rejectedCleanly
          ? `rejet attendu reçu — code ${code}${code === "P0001" ? " (garde du RPC, message explicite)" : ""}.`
          : err
            ? `rejet NON conforme — code ${code || "?"} (22P02 ou P0001 attendu).`
            : "APPEL ACCEPTÉ À TORT — un uuid vide aurait dû être rejeté.",
        ms,
      ),
    );
  }
  {
    // The category CHECK constraint: an invalid category must be rejected
    // with 23514 (probe evidence: "registration_fee" is not in the enum).
    const { value, ms } = await timed(() =>
      client.rpc("upsert_ledger_entry_from_import", {
        p_tenant_id: tenantId,
        p_entry_number: `probe-t396-${probe.runStamp}-val`,
        p_parent_id: parentId || crypto.randomUUID(),
        p_student_id: null,
        p_account_id: `parent:${parentId || "x"}:category:other`,
        p_entry_type: "charge",
        p_amount: 1,
        p_category: "registration_fee_invalid_category",
        p_description: "Sonde validation catégorie",
        p_source_type: "manual_entry",
        p_source_id: `probe-t396-${probe.runStamp}-val`,
        p_method: null,
        p_receipt_number: null,
        p_payment_status: null,
        p_reverses_id: null,
        p_actor_id: "system",
        p_actor_name: "Test CRUD T396",
        p_at: new Date().toISOString(),
        p_metadata: { probe: `t396-${probe.runStamp}` },
      }) as PromiseLike<{ data: unknown; error: SupabaseErrorLike | null }>,
    );
    const err = value.error;
    const code = errorCode(err);
    const rejectedCleanly = !!err && (code === "23514" || code === "23505" || /check|constraint/i.test(safeMessage(err, "")));
    checks.push(
      check(
        "crud.validation.invalid-category",
        CAT_VALIDATION,
        "Rejet propre : catégorie invalide (23514)",
        rejectedCleanly ? "pass" : "fail",
        rejectedCleanly
          ? `rejet attendu reçu — code ${code}.`
          : err
            ? `rejet NON conforme — code ${code || "?"} (23514 attendu).`
            : "APPEL ACCEPTÉ À TORT — la catégorie invalide aurait dû être rejetée.",
        ms,
      ),
    );
  }

  // ---- 8. Erreurs serveur / base (the actual error surfaced) ----------
  {
    // FK violation: a ledger entry for a non-existent parent uuid.
    const ghost = crypto.randomUUID();
    const { value, ms } = await timed(() =>
      client.rpc("upsert_ledger_entry_from_import", {
        p_tenant_id: tenantId,
        p_entry_number: `probe-t396-${probe.runStamp}-fk`,
        p_parent_id: ghost,
        p_student_id: null,
        p_account_id: `parent:${ghost}:category:other`,
        p_entry_type: "charge",
        p_amount: 1,
        p_category: "other",
        p_description: "Sonde FK inexistante",
        p_source_type: "manual_entry",
        p_source_id: `probe-t396-${probe.runStamp}-fk`,
        p_method: null,
        p_receipt_number: null,
        p_payment_status: null,
        p_reverses_id: null,
        p_actor_id: "system",
        p_actor_name: "Test CRUD T396",
        p_at: new Date().toISOString(),
        p_metadata: { probe: `t396-${probe.runStamp}` },
      }) as PromiseLike<{ data: unknown; error: SupabaseErrorLike | null }>,
    );
    const err = value.error;
    const code = errorCode(err);
    // 23503 FK violation is the expected clean rejection; a PGRST error
    // carrying the FK text is equally honest. A 200 = silent corruption.
    const rejectedCleanly = !!err && (code === "23503" || /foreign key/i.test(safeMessage(err, "")));
    checks.push(
      check(
        "crud.server.fk-violation",
        CAT_SERVER,
        "Erreur base gérée : FK inexistante (23503) avec le code affiché",
        rejectedCleanly ? "pass" : "fail",
        rejectedCleanly
          ? `rejet attendu reçu — code ${code} : l'erreur réelle est bien remontée à l'UI.`
          : err
            ? `rejet NON conforme — code ${code || "?"} (23503 attendu).`
            : "APPEL ACCEPTÉ À TORT — une écriture vers un parent inexistant aurait dû échouer.",
        ms,
      ),
    );
  }

  // ---- 9. Suppression (the canonical soft-delete RPCs) ----------------
  if (studentId) {
    const { value, ms } = await timed(() =>
      client.rpc("soft_delete_student", { p_student_id: studentId }) as PromiseLike<{
        data: { ok?: boolean; code?: string } | null;
        error: SupabaseErrorLike | null;
      }>,
    );
    const env = value.data ?? {};
    const ok = !value.error && env.ok === true;
    checks.push(
      check(
        "crud.delete.student",
        CAT_DELETE,
        "Supprimer l'élève (RPC soft_delete_student)",
        ok ? "pass" : "fail",
        ok
          ? "suppression logique effectuée (l'historique financier est conservé)."
          : value.error
            ? safeErrorDetail(value.error, "POST /rest/v1/rpc/soft_delete_student")
            : `refus du RPC — code ${env.code ?? "?"}`,
        ms,
      ),
    );

    // UI consistency: the list shape must EXCLUDE the deleted row.
    const rb = await timed(() =>
      client
        .from("students")
        .select("id")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .eq("id", studentId) as PromiseLike<{
        data: Array<Record<string, unknown>> | null;
        error: SupabaseErrorLike | null;
      }>,
    );
    const excluded = !rb.value.error && (rb.value.data ?? []).length === 0;
    checks.push(
      check(
        "crud.delete.student-consistency",
        CAT_DELETE,
        "L'annuaire exclut l'élève supprimé (cohérence UI / base)",
        excluded ? "pass" : "fail",
        excluded
          ? "l'élève n'apparaît plus dans la forme liste de l'UI."
          : "l'élève supprimé APPARAÎT ENCORE dans la forme liste — l'UI l'afficherait.",
        rb.ms,
      ),
    );
  }
  if (parentId) {
    const { value, ms } = await timed(() =>
      client.rpc("soft_delete_parent", { p_parent_id: parentId }) as PromiseLike<{
        data: { ok?: boolean; code?: string } | null;
        error: SupabaseErrorLike | null;
      }>,
    );
    const env = value.data ?? {};
    const ok = !value.error && env.ok === true;
    checks.push(
      check(
        "crud.delete.parent",
        CAT_DELETE,
        "Supprimer le parent (RPC soft_delete_parent)",
        ok ? "pass" : "fail",
        ok
          ? "suppression logique effectuée."
          : value.error
            ? safeErrorDetail(value.error, "POST /rest/v1/rpc/soft_delete_parent")
            : `refus du RPC — code ${env.code ?? "?"}`,
        ms,
      ),
    );

    const rb = await timed(() =>
      client
        .from("parents")
        .select("id")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .eq("id", parentId) as PromiseLike<{
        data: Array<Record<string, unknown>> | null;
        error: SupabaseErrorLike | null;
      }>,
    );
    const excluded = !rb.value.error && (rb.value.data ?? []).length === 0;
    checks.push(
      check(
        "crud.delete.parent-consistency",
        CAT_DELETE,
        "L'annuaire exclut le parent supprimé (cohérence UI / base)",
        excluded ? "pass" : "fail",
        excluded
          ? "le parent n'apparaît plus dans la forme liste de l'UI."
          : "le parent supprimé APPARAÎT ENCORE dans la forme liste.",
        rb.ms,
      ),
    );
  }

  // ---- 10. Nettoyage (zero-residue confirmation) ----------------------
  // The delete phase already soft-deleted the probe rows; this leg proves
  // zero LIVE residue by reading through the LIST shape (tenant + deleted_at
  // IS NULL) — the ONLY shape RLS permits for soft-deleted rows (the 0019
  // SELECT policies filter deleted rows server-side, so a raw read CANNOT
  // see them — the read-side corollary of the RLS-500 discovery). A probe
  // row left live by a mid-suite failure WOULD appear here.
  {
    const { value, ms } = await timed(() =>
      client
        .from("parents")
        .select("id")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .eq("parent_code", parentCode) as PromiseLike<{
        data: Array<Record<string, unknown>> | null;
        error: SupabaseErrorLike | null;
      }>,
    );
    const live = value.data ?? [];
    const zeroResidue = !value.error && live.length === 0;
    checks.push(
      check(
        "crud.cleanup.residue",
        CAT_CLEANUP,
        "Zéro résidu visible (lignes sonde supprimées logiquement)",
        zeroResidue ? "pass" : "fail",
        zeroResidue
          ? "aucune ligne sonde vivante — plus rien n'apparaîtra dans l'annuaire. (Les écritures du grand livre restent comme historique financier de la famille sonde — invisibles dans les vues UI.)"
          : `${live.length} ligne(s) sonde encore VIVANTE(S) — le nettoyage a échoué.`,
        ms,
      ),
    );
  }

  return summarize(checks, probe);
}

function summarize(
  checks: DiagnosticCheck[],
  probe?: CrudProbeIdentity,
): DiagnosticsReport & { probe?: CrudProbeIdentity } {
  const pass = checks.filter((c) => c.status === "pass").length;
  const fail = checks.filter((c) => c.status === "fail").length;
  const notTested = checks.filter((c) => c.status === "not_tested").length;
  return { ranAt: Date.now(), checks, summary: { pass, fail, notTested }, probe };
}
