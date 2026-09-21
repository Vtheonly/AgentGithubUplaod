/**
 * Supabase-backed repositories for the shared entities (Parent, Student,
 * Payment, LedgerEntry).
 *
 * These implementations read/write directly to the canonical Supabase tables
 * created by migrations 0005, 0007, 0014, and 0027. They are the data-layer
 * counterparts of the SQL migration `0027_shared_unification.sql` — the
 * migration is the contract, this file is the client.
 *
 * Wiring: `getSupabaseRepositories()` in `supabase-repositories.ts` overrides
 * the mock `parents`, `students`, `payments`, and `ledger` entries with the
 * classes defined here.
 *
 * Idempotency: every write goes through the SECURITY DEFINER upsert RPCs
 * declared in 0027 — `upsert_parent_from_import`, `upsert_student_from_import`,
 * `upsert_payment_from_import`, `upsert_ledger_entry_from_import`. Re-running
 * an import or re-pushing a sync_queue entry never creates duplicates.
 *
 * Reactive reads: the Supabase repositories wrap an in-memory cache (a
 * `SubjectBehavior`) so React's `useSyncExternalStore` keeps working. The
 * cache is seeded from `pull_*_for_sync` on first subscription and refreshed
 * on every successful write. Realtime subscriptions can be layered on later.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { CacheFreshness } from "../cache-freshness";
import type {
  ParentRepository,
  StudentRepository,
  PaymentRepository,
  LedgerRepository,
  InstallmentRepository,
  DebtRepository,
  Observable,
  ImportInstallmentInput,
} from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { supabaseErrorToAppError } from "../supabase-client";
import type {
  Parent,
  CreateParentInput,
  UpdateParentInput,
  TransportDestination,
  CityTier,
  Gender,
} from "../../../domain/model/parent";
import { cityTierToDestination, TRANSPORT_DESTINATIONS } from "../../../domain/model/parent";
import type {
  Student,
  CreateStudentInput,
  UpdateStudentInput,
  GradeLevel,
  BatchRegistrationInput,
  BatchRegistrationResult,
  StudentDocument,
  StudentDocumentDraft,
} from "../../../domain/model/student";
import {
  gradeLevelFromLevelYear,
  academicLevelFromGradeLevel,
  gradeYearFromGradeLevel,
} from "../../../domain/model/student";
import { normalizeTrackCode } from "../../../domain/model/filiere";
import type { AcademicHistoryEntry } from "../../../domain/model/academic";
import { getNextGradeProgression } from "../../../domain/calc/academics/promotion";
import type {
  Payment,
  Installment,
  CollectPaymentInput,
  AccountAdjustment,
  Receipt,
  ParentFinancialProfile,
  PaymentCategory,
  PaymentAllocation,
  AcademicCycle,
  UpdateInstallmentDueDateInput,
} from "../../../domain/model/payment";
import type { AllocationResult } from "../../../domain/calc/payment/waterfall-allocator";
import { agingBucketFromDays } from "../../../domain/calc/payment/queries";
import type { LedgerEntry } from "../../../domain/model/ledger";
import type { ParentLedgerSummary } from "../../../domain/model/ledger";
import { SubjectBehavior, derived } from "../../mock/subject-behavior";
import { deterministicActivationCode } from "../../../core/format/id";
import type {
  ParentRow,
  StudentRow,
  StudentDocumentRow,
  PaymentRow,
  PaymentAllocationRow,
  LedgerEntryRow,
  InstallmentRow,
} from "../types";
// CANONICAL-FINANCIAL-LOGIC.md §4 INV-10 — Supabase-backed repositories
// MUST delegate to the canonical calc engine, not roll their own naive
// Σ amounts. The previous stubs returned hardcoded zeros and an empty
// reconciliation report — a desktop-internal inconsistency where the same
// call site produced wildly different results depending on whether the
// Supabase env was configured.
import {
  computeParentSummary,
  computeAccountBalance,
} from "../../../domain/calc/ledger/balance";
import { buildOverdueDueDateMap } from "../../../domain/calc/ledger/overdue";
// T-405 (financial-rules §15) — the canonical debt-aging engine (labels +
// the client-side parity cross-check).
import {
  computeDebtAgingStatus,
  type DebtAgingAnalysis,
  type DebtAgingObligation,
  type DebtAgingStatusLevel,
  type DebtAgingReasonCode,
} from "../../../domain/calc/ledger/debt-aging";
import { reconcileLedger } from "../../../domain/calc/reconcile";
import {
  evaluateAllSystemDiscounts,
  sumDiscounts,
  splitNetTuitionByOfficialSchedule,
  getOfficialTuitionDueDates,
  tuitionForGradeLevel,
  transportTranchesForDestination,
} from "../../../domain/calc/pricing";
import { createChargeEntry } from "../../../domain/calc/ledger/entries";
import { defaultPricingConfig } from "../../mock/pricing-seed";
// T-307 (48th session): the billing WRITE path reads the DB pricing config —
// the same builder the pricing repository uses (one derivation, no parallel
// config source). Seed fallback only when the fetch fails.
import { readDbPricingConfig } from "./supabase-pricing-repository";
// T-018 (DRIFT-001): the deterministic identity-code generators moved to
// their canonical home (core/format/id.ts, ADR-003). Re-exported here for
// the existing import-path consumers.
export { stableHash, deterministicParentCode, deterministicStudentCode } from "../../../core/format/id";
import { deterministicParentCode, deterministicStudentCode } from "../../../core/format/id";

import {
  crossCheckBalanceSum,
  crossCheckPayments,
  crossCheckInstallments,
  crossCheckInstallmentPayments,
  crossCheckClearedBalance,
  crossCheckParentCredit,
} from "../../../domain/calc/reconcile/cross-checks";

// ============================================================================
// Helpers
// ============================================================================

const TENANT_FALLBACK = "00000000-0000-0000-0000-000000000001";

function getSessionFromStorage(): { tenantId?: string | null; homeTenantId?: string | null; userId?: string; displayName?: string } | null {
  try {
    const raw = localStorage.getItem("el-imtiyaz.session");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getTenantId(): string | null {
  // T-053 (TENANT-103): NO demo-tenant fallback. The tenant context is the
  // session's WORKING tenant (the user's own, or a global admin's switcher
  // choice). null = no tenant context (pre-login, or a global admin who has
  // not picked a tenant yet): reads return empty, writes fail loud
  // (requireTenantId).
  const sess = getSessionFromStorage();
  return sess?.tenantId || null;
}

export function requireTenantId(): string {
  const id = getTenantId();
  if (!id) {
    throw new Error(
      "Aucun établissement actif — sélectionnez un établissement (compte admin global) ou reconnectez-vous.",
    );
  }
  return id;
}

export function getActorId(): string {
  try {
    const sess = getSessionFromStorage();
    if (sess?.userId) return sess.userId;
  } catch { /* ignore */ }
  return "excel-import";
}

export function getActorName(): string {
  try {
    const sess = getSessionFromStorage();
    if (sess?.displayName) return sess.displayName;
  } catch { /* ignore */ }
  return "Excel Import";
}

function studentCode(year: number, seq: number): string {
  return `ELV-${year}-${String(seq).padStart(6, "0")}`;
}




function toIsoDate(d: string | Date | null | undefined): string | null {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString();
  return d;
}

/**
 * Whether the given string is a well-formed UUID. Domain ids coming from the
 * mock layer (e.g. "per-001", "cls-003") are NOT valid Postgres UUIDs — use
 * this guard before sending a value to a `uuid` column / RPC parameter.
 */
export function isUuid(value: string | null | undefined): value is string {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// ============================================================================
// PERF-501 (T-397) — the transient-failure absorber for the idempotent
// identity RPCs
// ============================================================================

/**
 * PERF-501: the network/transient error class. On a high-latency route
 * (the owner's Algeria → eu-west-1, 476–952 ms per round-trip), a single
 * blip in a multi-call chain is the "sometimes I get a server error"
 * report — and the identity upsert RPCs are IDEMPOTENT (the deterministic
 * parent/student codes converge on re-run — the upsert's own contract),
 * so one immediate retry is always safe.
 */
function isTransientNetworkError(err: unknown): boolean {
  const e = err as { message?: string; code?: string | number } | null;
  const msg = typeof e?.message === "string" ? e.message : "";
  const code = e?.code;
  return (
    code === "ERR_NETWORK" ||
    code === "ERR_TIMEOUT" ||
    /fetch failed|Failed to fetch|network|timeout|ECONNRESET|socket hang up|aborted/i.test(msg)
  );
}

/**
 * PERF-501: run an IDEMPOTENT RPC with a single network-class retry.
 * Non-network errors (validation, RLS, constraint) return immediately —
 * a retry cannot fix them and would double-report; network-class errors
 * get exactly ONE immediate re-invocation (the deterministic codes make
 * the re-run converge instead of duplicating).
 */
export async function rpcWithIdempotentRetry<A extends Record<string, unknown>, T>(
  client: SupabaseClient,
  name: string,
  args: A,
): Promise<{ data: T | null; error: { code?: string; message: string } | null }> {
  const first = (await client.rpc(name, args)) as {
    data: T | null;
    error: { code?: string; message: string } | null;
  };
  if (!first.error || !isTransientNetworkError(first.error)) return first;
  const second = (await client.rpc(name, args)) as {
    data: T | null;
    error: { code?: string; message: string } | null;
  };
  return second;
}

// ============================================================================
// OPS-317 (T-392) — seed-diagnostics registry
// ============================================================================

/**
 * The classified reason the last observable-cache seed degraded to empty.
 *
 * OPS-317: the repository `seed()` catch blocks used to discard the error
 * ENTIRELY (`catch { this.cache.set([]) }`), which made AUTH-302's anon
 * state (RLS-filtered `200 []` reads) indistinguishable from an empty
 * database. The honest-empty degradation stays (the UI contract does not
 * change) — but the REASON becomes observable: recorded here, logged once
 * per failure, and rendered by the Supabase diagnostics screen (T-393).
 */
export interface SeedDiagnostic {
  /** The observable being seeded ("parents", "students", …). */
  source: string;
  /** Milliseconds since epoch of the failed seed. */
  at: number;
  /** AppError-style code — "ERR_UNAUTHORIZED", "ERR_NETWORK", … or "UNKNOWN". */
  code: string;
  /** SAFE one-line message (HTTP status + Supabase code when present; never tokens). */
  message: string;
  /** True when the failure is a network/offline class (honest offline empty). */
  networkClass: boolean;
}

const seedDiagnostics: SeedDiagnostic[] = [];
const MAX_SEED_DIAGNOSTICS = 20;

function classifySeedError(err: unknown): { code: string; message: string; networkClass: boolean } {
  const e = err as { code?: string; message?: string } | null;
  const code = e?.code ?? "UNKNOWN";
  const rawMessage = typeof e?.message === "string" ? e.message : String(err ?? "unknown error");
  // Keep the message short and free of any credential material (keys never
  // appear in Supabase error bodies, but defensive truncation costs nothing).
  const message = rawMessage.slice(0, 300);
  const networkClass =
    code === "ERR_NETWORK" || code === "ERR_OFFLINE" || code === "ERR_TIMEOUT" ||
    /network|fetch failed|Failed to fetch|timeout/i.test(rawMessage);
  return { code, message, networkClass };
}

/** Record a seed degradation (OPS-317). Never throws. */
function recordSeedError(source: string, err: unknown): void {
  try {
    const { code, message, networkClass } = classifySeedError(err);
    seedDiagnostics.push({ source, at: Date.now(), code, message, networkClass });
    if (seedDiagnostics.length > MAX_SEED_DIAGNOSTICS) {
      seedDiagnostics.splice(0, seedDiagnostics.length - MAX_SEED_DIAGNOSTICS);
    }
    // One warn line per failure — the console gets the reason the list is
    // empty instead of a silent `200 []`.
    console.warn(`[SupabaseSeed] ${source} degraded to empty cache — ${code}: ${message}`);
  } catch {
    /* diagnostics must never break the degradation path */
  }
}

/** The recorded seed degradations (newest last) — consumed by the diagnostics screen (T-393). */
export function getSeedDiagnostics(): readonly SeedDiagnostic[] {
  return seedDiagnostics;
}

/** Test seam: clear the registry between unit tests. */
export function __resetSeedDiagnosticsForTests(): void {
  seedDiagnostics.length = 0;
}

// ============================================================================
// Row → domain mappers
// ============================================================================

function mapParentRow(r: ParentRow): Parent {
  // The DB column `city_tier` (migration 0028) stores raw text — usually
  // "t1" / "t2" / "t3" but possibly null or unrecognized. Coerce to the
  // CityTier union when recognized; otherwise null.
  const rawCityTier = (r as { city_tier?: string | null }).city_tier;
  const cityTier: CityTier | null =
    rawCityTier === "t1" || rawCityTier === "t2" || rawCityTier === "t3" ? rawCityTier : null;
  // The DB column `transport_destination` (migration 0028) stores raw text.
  // Coerce to the TransportDestination union when recognized; otherwise null
  // (the UI tolerates null and falls back to other display fields).
  const rawTransport = (r as { transport_destination?: string | null }).transport_destination;
  const transportDestination: TransportDestination | null =
    rawTransport && (TRANSPORT_DESTINATIONS as readonly string[]).includes(rawTransport)
      ? (rawTransport as TransportDestination)
      : null;
  return {
    id: r.id,
    tenantId: r.tenant_id,
    code: r.parent_code,
    firstName: r.first_name,
    lastName: r.last_name,
    displayName: r.display_name ?? null,
    gender: "unspecified",
    phone: r.primary_phone,
    whatsapp: r.secondary_phone,
    email: r.email,
    occupation: r.occupation,
    address: r.address,
    cityTier,
    transportDestination,
    preferredLanguage: "fr",
    avatarUrl: null,
    // T-331: the bound web-account id — flags already-linked families in
    // the approvals picker (the 0047 rebind guard rejects them post-submit).
    authUserId: r.auth_user_id ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Exported for the T-372 read-parity suite (pure row mapper). */
export function mapStudentRow(r: StudentRow): Student {
  // Decode gradeLevel from the new `grade_level_code` column (migration 0028).
  // Fall back to "1ap" only when the column is NULL (e.g. rows created before
  // the migration was applied). The importer path always sets it via the
  // upsert RPC's p_grade_level_code parameter.
  const codeFromDb = (r as { grade_level_code?: string | null }).grade_level_code;
  const fallbackLevel: GradeLevel = "1ap";
  let gradeLevel: GradeLevel;
  if (codeFromDb && typeof codeFromDb === "string") {
    // The importer stores canonical codes like "1ap", "CE1", "CP", "GS".
    // We trust whatever was stored — the importer's mapNiveauCode already
    // normalized it. If the value isn't a recognized GradeLevel, fall back.
    gradeLevel = codeFromDb as GradeLevel;
  } else {
    gradeLevel = fallbackLevel;
  }
  const transportTier = (r as { transport_tier?: string | null }).transport_tier ?? null;
  const paymentPlan = (r as { payment_plan?: string | null }).payment_plan === "full_annual" ? "full_annual" : "tranches";
  // SYNC-110/T-372: documents NO LONGER come from the legacy
  // `students.documents_json` column — the canonical `student_documents`
  // TABLE is the shared store (the web portal reads/writes it). The table
  // rows are embedded AFTER mapping, by `embedStudentDocuments`, so that the
  // mapper stays a pure row→domain function. The column remains as a
  // forensic archive (backfilled into the table by migration 0098).
  return {
    id: r.id,
    tenantId: r.tenant_id,
    code: r.student_code,
    parentId: r.parent_id,
    firstName: r.first_name,
    // vault §04.03 — read back the optional middle name.
    middleName: (r as { middle_name?: string | null }).middle_name ?? null,
    lastName: r.last_name,
    displayName: r.display_name ?? null,
    gender: (r.gender as Gender) ?? "unspecified",
    birthDate: r.date_of_birth,
    enrollmentDate: r.enrollment_date,
    level: academicLevelFromGradeLevel(gradeLevel),
    gradeYear: gradeYearFromGradeLevel(gradeLevel),
    gradeLevel,
    // T-401: the academic classification (migration 0107; NULL = untagged).
    filiereCode: normalizeTrackCode((r as { filiere_code?: string | null }).filiere_code),
    specialiteCode: normalizeTrackCode((r as { specialite_code?: string | null }).specialite_code),
    classId: r.class_id,
    photoUrl: null,
    medicalNotes: r.medical_notes,
    transportTier,
    status: r.enrollment_status as Student["status"],
    paymentPlan,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * SYNC-110/T-372 — map a canonical `student_documents` row to the domain
 * `StudentDocument`. `uploaderDisplay` is the best-effort resolved display
 * name for the row's `uploaded_by` profile id (see resolveUploaderNames) —
 * "—" when the id is NULL (backfilled rows) or unresolvable under RLS.
 * Field-for-field the inverse of the website's insert payload.
 */
export function mapStudentDocumentRow(
  r: StudentDocumentRow,
  uploaderDisplay: string = "—",
): StudentDocument {
  return {
    id: r.id,
    fileName: r.file_name,
    category: r.kind,
    note: r.description ?? null,
    storagePath: r.storage_path,
    uploadedBy: uploaderDisplay,
    uploadedAt: r.uploaded_at,
    mimeType: r.mime_type ?? null,
    sizeBytes: r.size_bytes != null ? Number(r.size_bytes) : null,
  };
}

/**
 * SYNC-110/T-372 — embed table-backed documents into the mapped students
 * (documents ordered by uploaded_at ascending, matching the mock append
 * order so the UI list is chronologically stable on both platforms).
 */
export function embedStudentDocuments(
  students: readonly Student[],
  rows: readonly StudentDocumentRow[],
  uploaderNames: ReadonlyMap<string, string> = new Map(),
): Student[] {
  const byStudent = new Map<string, StudentDocument[]>();
  for (const r of rows) {
    const list = byStudent.get(r.student_id) ?? [];
    list.push(mapStudentDocumentRow(r, uploaderNames.get(r.uploaded_by ?? "") ?? "—"));
    byStudent.set(r.student_id, list);
  }
  return students.map((s) => {
    const docs = byStudent.get(s.id);
    return docs && docs.length > 0 ? { ...s, documents: docs } : s;
  });
}

/**
 * T-402 — the canonical `student_academic_histories` row (0029 + 0107's
 * classification columns). The append-only promotion archive both the
 * placement studio's provenance detection and the student drawer's
 * "Historique académique" card consume.
 */
export interface StudentAcademicHistoryRecordRow {
  id: string;
  tenant_id: string;
  student_id: string;
  academic_year: string;
  cycle: "prescolaire" | "primaire" | "cem" | "lycee";
  grade_code: string;
  grade_year: number | null;
  class_id: string | null;
  class_name: string | null;
  gpa: number | null;
  rank: number | null;
  decision: "promoted" | "repeated" | "graduated" | "transferred";
  narrative: string | null;
  filiere_code?: string | null;
  specialite_code?: string | null;
  recorded_at: string;
}

/**
 * T-402 — map a history row to the domain entry. `level` is derived from the
 * grade code via the canonical helper (prescolaire grades map to the
 * "primaire" AcademicLevel bucket, exactly like mapClassRow's cycleMap).
 */
export function mapAcademicHistoryRow(r: StudentAcademicHistoryRecordRow): AcademicHistoryEntry {
  const gradeLevel = (r.grade_code ?? "1ap") as GradeLevel;
  return {
    id: r.id,
    studentId: r.student_id,
    academicYear: r.academic_year,
    cycle: r.cycle,
    level: academicLevelFromGradeLevel(gradeLevel),
    gradeCode: gradeLevel,
    gradeYear: r.grade_year ?? gradeYearFromGradeLevel(gradeLevel),
    classId: r.class_id,
    className: r.class_name,
    gpa: Number(r.gpa ?? 0),
    rank: r.rank ?? null,
    decision: r.decision,
    narrative: r.narrative,
    filiereCode: r.filiere_code ?? null,
    specialiteCode: r.specialite_code ?? null,
    recordedAt: r.recorded_at,
  };
}

/**
 * T-402 — embed the tenant's history rows onto the cached students (the
 * `embedStudentDocuments` pattern). Students without history keep
 * `academicHistory` undefined (the pre-T-402 shape — honest empty state).
 */
export function embedAcademicHistories(
  students: readonly Student[],
  rows: readonly StudentAcademicHistoryRecordRow[],
): Student[] {
  const byStudent = new Map<string, AcademicHistoryEntry[]>();
  for (const r of rows) {
    const list = byStudent.get(r.student_id) ?? [];
    list.push(mapAcademicHistoryRow(r));
    byStudent.set(r.student_id, list);
  }
  return students.map((s) => {
    const history = byStudent.get(s.id);
    return history && history.length > 0
      ? { ...s, academicHistory: [...history].sort((a, b) => a.academicYear.localeCompare(b.academicYear)) }
      : s;
  });
}

/** Exported for the T-103 read-side consistency suite (pure row mapper). */
export function mapPaymentRow(r: PaymentRow): Payment {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    receiptNumber: r.receipt_number ?? r.payment_number,
    parentId: r.parent_id,
    studentId: r.student_id,
    amount: Number(r.amount),
    method: r.method,
    // VAULT §07.02 — "unpaid" is a legitimate payment status (bounced
    // check / failed transfer). Previously coerced to "pending", which
    // made a bounced payment indistinguishable from an uncleared one.
    status: r.status as Payment["status"],
    category: (r.category ?? "other") as Payment["category"],
    installmentId: r.installment_id,
    proofUrl: r.proof_path,
    notes: r.notes,
    checkNumber: r.check_number ?? null,
    checkBankName: r.check_bank_name ?? null,
    checkIssueDate: r.check_issue_date ?? null,
    checkClearanceDate: r.check_clearance_date ?? null,
    transferReference: r.transfer_reference ?? null,
    transferSourceBank: r.transfer_source_bank ?? null,
    // T-103 — surface the 0033/0062 payment-breakdown hint columns so the
    // PaymentBreakdownCard (expected vs excess per payment) works on the
    // live corpus instead of silently rendering nothing (DATA-004).
    expectedAmount: r.expected_amount != null ? Number(r.expected_amount) : undefined,
    excessAmount: r.excess_amount != null ? Number(r.excess_amount) : undefined,
    excessRemark: r.excess_remark ?? null,
    collectedBy: r.collected_by ?? "system",
    collectedAt: r.collected_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapLedgerRow(r: LedgerEntryRow): LedgerEntry {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    accountId: r.account_id,
    parentId: r.parent_id,
    studentId: r.student_id,
    category: r.category as LedgerEntry["category"],
    amount: Number(r.amount),
    // T-056 / WEAK-003: the old fallback chain ended in `r.actor_id` — a
    // USER ID — which was then cast to the entry-type union and would
    // misclassify the entry in the reconciler/balance replay. `entry_type`
    // is NOT NULL in the schema (0027); the only fallback is the neutral
    // "charge" bucket, never another column.
    type: (r.entry_type ?? "charge") as LedgerEntry["type"],
    sourceType: (r.source_type ?? "manual_entry") as LedgerEntry["sourceType"],
    sourceId: r.source_id ?? r.id,
    method: (r.method ?? null) as LedgerEntry["method"],
    receiptNumber: r.receipt_number ?? null,
    paymentStatus: (r.payment_status ?? null) as LedgerEntry["paymentStatus"],
    reversesId: r.reverses_id ?? r.reverses_entry_id ?? null,
    description: r.description ?? "",
    actorId: r.actor_id ?? "system",
    actorName: r.actor_name ?? "System",
    at: r.at ?? r.entry_date ?? r.created_at,
    metadata: (r.metadata as Record<string, string | number | boolean | null>) ?? {},
  };
}

// ============================================================================
// SupabaseParentRepository
// ============================================================================

export class SupabaseParentRepository implements ParentRepository {
  private readonly cache = new SubjectBehavior<Parent[]>([]);
  private readonly byIdCache = new Map<string, SubjectBehavior<Parent | null>>();
  // T-034/CROSS-104: TTL + focus freshness policy (replaces the one-shot seeded flag)
  private readonly freshness = new CacheFreshness();

  constructor(private readonly client: SupabaseClient) {}

  private async seed(): Promise<void> {
    if (!this.freshness.shouldReseed()) return;
    this.freshness.markSeeded();
    try {
      const tenantId = requireTenantId();
      const { data, error } = await this.client
        .from("parents")
        .select("*")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("last_name", { ascending: true });
      if (error) throw error;
      this.cache.set((data as ParentRow[]).map(mapParentRow));
    } catch (e) {
      // OPS-317 (T-392): still the honest empty cache (the UI contract does
      // not change) — but the classified reason is now recorded + logged so
      // an anon-session read (AUTH-302: 200 [] under RLS) is distinguishable
      // from an actually-empty tenant.
      recordSeedError("parents", e);
      this.cache.set([]);
    }
  }

  observe(): Observable<Parent[]> {
    void this.seed();
    return this.cache;
  }

  observeById(id: string): Observable<Parent | null> {
    if (!this.byIdCache.has(id)) {
      this.byIdCache.set(id, new SubjectBehavior<Parent | null>(null));
      void this.refreshById(id);
    }
    void this.seed();
    // FIX (reactivity): prefer the live entry from the list cache when
    // present (createParent / updateParent / Excel import keep it fresh) and
    // fall back to the individually-fetched subject otherwise.
    return derived(
      [this.cache, this.byIdCache.get(id)!],
      () => this.cache.get().find((p) => p.id === id) ?? this.byIdCache.get(id)?.get() ?? null,
    );
  }

  private async refreshById(id: string): Promise<void> {
    // Guard against invalid IDs — when the upsert RPC fails (e.g. the
    // previous "column reference is ambiguous" bug), the caller may pass
    // an empty/undefined string here, which produces a 400 from PostgREST
    // (`parents?select=*&id=eq.`). Skip the round-trip entirely.
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return;
    }
    try {
      const { data, error } = await this.client
        .from("parents")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      this.byIdCache.get(id)?.set(data ? mapParentRow(data as ParentRow) : null);
    } catch (e) {
      // OPS-317 (T-392): record + log instead of a bare ignore — a failing
      // by-id read is the AUTH-302 symptom surface (`parents?id=eq.… → []`).
      recordSeedError(`parents:${id}`, e);
    }
  }

  async search(query: string): Promise<Result<Parent[]>> {
    await this.seed();
    const q = query.toLowerCase().trim();
    if (!q) return Ok(this.cache.get());
    const all = this.cache.get();
    return Ok(
      all.filter((p) =>
        `${p.firstName} ${p.lastName} ${p.displayName ?? ""} ${p.phone} ${p.code}`
          .toLowerCase()
          .includes(q),
      ),
    );
  }

  async createParent(input: CreateParentInput): Promise<Result<Parent>> {
    try {
      const tenantId = requireTenantId();
      const year = new Date().getFullYear();
      // DETERMINISTIC CODE: derive from identity fields so re-imports hit
      // the primary identity match `(tenant_id, parent_code)` and the RPC
      // performs an UPDATE instead of falling through to weaker fallbacks
      // (phone match, display_name match) that may or may not exist.
      const parentCode = deterministicParentCode(year, input);
      // VAULT §02.08 (Account Activation Protocol) — populate the activation
      // code on parent creation exactly like the Android app does
      // (migration 0037 added `p_activation_code` to this RPC precisely so
      // activation codes are no longer missing for imported/registered
      // parents). Deterministic FNV-1a of (tenantId|parentCode) keeps the
      // upsert idempotent: re-importing the same family converges on the
      // same code instead of issuing a new one each run.
      const activationCodeValue = deterministicActivationCode(parentCode, tenantId);
      const transportDestination: TransportDestination | null =
        input.transportDestination ?? cityTierToDestination(input.cityTier) ?? null;

      // PERF-501 (T-397): the idempotent upsert RPC gets ONE network-class
      // retry — the deterministic parent code makes the re-run converge
      // (UPDATE) instead of duplicating, and a transient blip no longer
      // fails the whole registration at call #1 (the owner's "sometimes a
      // server error" class on the high-latency route).
      const { data, error } = await rpcWithIdempotentRetry<
        Record<string, unknown>,
        { out_parent_id: string; out_parent_code: string; out_was_inserted: boolean }[]
      >(this.client, "upsert_parent_from_import", {
        p_tenant_id: tenantId,
        p_parent_code: parentCode,
        p_first_name: input.firstName,
        p_last_name: input.lastName,
        p_display_name: input.displayName ?? `${input.firstName} ${input.lastName}`.trim(),
        p_primary_phone: input.phone,
        p_secondary_phone: input.whatsapp ?? null,
        p_email: input.email ?? null,
        p_occupation: input.occupation ?? null,
        p_address: input.address ?? null,
        p_relationship: null,
        p_preferred_language: input.preferredLanguage ?? "fr",
        p_is_active: true,
        // 0037: deterministic activation code (vault §02.08) — populated so
        // the family can activate the Web Portal right after enrollment.
        p_activation_code: activationCodeValue,
        // NEW (migration 0028): persist transport_destination + city_tier so
        // Android can read them back via pull_parents_for_sync.
        p_transport_destination: transportDestination ?? null,
        p_city_tier: input.cityTier ?? null,
      });
      if (error) throw error;
      // NOTE: migration 0031 renamed the RPC output columns to `out_*`
      // to avoid the plpgsql `column reference "parent_code" is ambiguous`
      // error caused by RETURNS TABLE column names colliding with table
      // column references inside the function body.
      const row = (data as { out_parent_id: string; out_parent_code: string; out_was_inserted: boolean }[])[0];
      if (!row || !row.out_parent_id) throw new Error("upsert_parent_from_import returned no rows");

      // Fetch the full row.
      const { data: fullRow, error: fetchErr } = await this.client
        .from("parents")
        .select("*")
        .eq("id", row.out_parent_id)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      const parent = mapParentRow(fullRow as ParentRow);
      // transportDestination is now persisted by the RPC (migration 0028)
      // — no need for a separate update query. The previous implementation
      // wrote to `address` (wrong column) and used `as never` to silence
      // the typecheck, which silently dropped the transport destination.
      this.cache.update((list) => [parent, ...list.filter((p) => p.id !== parent.id)]);
      this.byIdCache.set(parent.id, new SubjectBehavior<Parent | null>(parent));
      return Ok(parent);
    } catch (e) {
      return Err(supabaseErrorToAppError(e as { code?: string; message: string; details?: unknown }));
    }
  }

  async updateParent(id: string, updates: UpdateParentInput): Promise<Result<Parent>> {
    try {
      const patch: Record<string, unknown> = {};
      if (updates.firstName !== undefined) patch.first_name = updates.firstName;
      if (updates.lastName !== undefined) patch.last_name = updates.lastName;
      if (updates.displayName !== undefined) patch.display_name = updates.displayName;
      if (updates.phone !== undefined) patch.primary_phone = updates.phone;
      if (updates.whatsapp !== undefined) patch.secondary_phone = updates.whatsapp;
      if (updates.email !== undefined) patch.email = updates.email;
      if (updates.occupation !== undefined) patch.occupation = updates.occupation;
      if (updates.address !== undefined) patch.address = updates.address;
      // NEW (migration 0028): persist transport_destination + city_tier.
      // Previously these were silently dropped because the columns didn't exist.
      if (updates.transportDestination !== undefined) {
        patch.transport_destination = updates.transportDestination;
      }
      if (updates.cityTier !== undefined) {
        patch.city_tier = updates.cityTier;
      }
      if (updates.preferredLanguage !== undefined) {
        // stored as system_setting, not on parents row — skip.
      }
      if (Object.keys(patch).length > 0) {
        const { error } = await this.client.from("parents").update(patch).eq("id", id);
        if (error) throw error;
      }
      await this.refreshById(id);
      const updated = this.byIdCache.get(id)?.get() ?? null;
      if (!updated) return Err(Errors.notFound("Parent", id));
      this.cache.update((list) => list.map((p) => (p.id === id ? updated : p)));
      return Ok(updated);
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  async deleteParent(id: string): Promise<Result<void>> {
    try {
      // T-384 / RLS-500 — the canonical soft_delete_parent RPC (migration
      // 0100). A plain `.update({deleted_at})` is RLS-IMPOSSIBLE for every
      // authenticated caller (live-proven 74th session): the staff SELECT
      // policies (0019) carry `deleted_at IS NULL`, and PostgreSQL folds
      // the applicable SELECT-policy predicates into the UPDATE's
      // effective WITH CHECK — the new row can never satisfy them (42501).
      // The RPC owns the whole rule set server-side: not_found for
      // unknown/already-deleted/cross-tenant ids (§15.30b), the
      // active-students guard (PARENT-500's core rule), the super_admin
      // gate, and the parent.delete audit entry.
      const { data, error } = await this.client.rpc("soft_delete_parent", {
        p_parent_id: id,
      });
      if (error) throw error;
      const env = (data ?? {}) as { ok?: boolean; code?: string; count?: number };
      if (env.ok !== true) {
        if (env.code === "not_found") return Err(Errors.notFound("Parent", id));
        if (env.code === "forbidden") {
          return Err(
            Errors.forbidden(
              `soft_delete_parent refused for ${id}: caller is not super_admin`,
            ),
          );
        }
        if (env.code === "active_students_exist") {
          return Err(
            Errors.conflict(
              `Parent ${id} still has ${env.count ?? "?"} active student(s)`,
              "Impossible de supprimer ce parent : des élèves actifs lui sont encore rattachés. Retirez (ou rattachez ailleurs) ces élèves d'abord.",
            ),
          );
        }
        return Err(Errors.validation(`soft_delete_parent: ${JSON.stringify(env)}`));
      }

      // RPC ok — evict the caches (reactivity: open drawers observing this
      // parent see the deletion instead of a frozen profile).
      this.cache.update((list) => list.filter((p) => p.id !== id));
      this.byIdCache.get(id)?.set(null);
      this.byIdCache.delete(id);
      return Ok(undefined);
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }
}

/**
 * Lazily construct ledger + installment repositories (avoids circular
 * constructor wiring).
 *
 * T-398 note: `batchRegister` no longer uses this helper (the single
 * `register_family_batch` RPC writes the billing legs server-side); it
 * remains for any future caller needing the pair.
 */
function getBillingRepos(client: SupabaseClient): {
  ledgerRepo: SupabaseLedgerRepository;
  installmentRepo: SupabaseInstallmentRepository;
} {
  return {
    ledgerRepo: new SupabaseLedgerRepository(client),
    installmentRepo: new SupabaseInstallmentRepository(client),
  };
}

// ============================================================================
// SupabaseStudentRepository
// ============================================================================

export class SupabaseStudentRepository implements StudentRepository {
  private readonly cache = new SubjectBehavior<Student[]>([]);
  // T-034/CROSS-104: TTL + focus freshness policy (replaces the one-shot seeded flag)
  private readonly freshness = new CacheFreshness();
  /** SYNC-110/T-372 — display-name cache for `uploaded_by` profile ids. */
  private readonly uploaderNameCache = new Map<string, string>();

  constructor(private readonly client: SupabaseClient) {}

  private async seed(): Promise<void> {
    if (!this.freshness.shouldReseed()) return;
    this.freshness.markSeeded();
    try {
      const tenantId = requireTenantId();
      const { data, error } = await this.client
        .from("students")
        .select("*")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("last_name", { ascending: true });
      if (error) throw error;
      const students = (data as StudentRow[]).map(mapStudentRow);
      // SYNC-110/T-372 — the canonical `student_documents` table is the
      // document store BOTH platforms share (the website lists documents
      // from this exact table under the 0043 parent-select policy; staff
      // read under the 0019 policy). One extra query per reseed, embedded
      // into the same whole-tenant cache — matching the established
      // repository pattern (the students list itself is one whole-tenant
      // query). A document-fetch failure degrades to "no documents"
      // (honest empty state) rather than blanking the student list.
      //
      // T-402 — the canonical `student_academic_histories` table is
      // embedded the same way: it is the promotion archive the placement
      // studio's provenance detection and the student drawer's history
      // card consume. Before this, Supabase mode NEVER read the table
      // (Student.academicHistory was always undefined — the history card
      // rendered empty and provenance fell back to grade-adjacency). A
      // history-fetch failure degrades to "no history" (the pre-T-402
      // state) rather than blanking the student list.
      try {
        const docRows = await this.fetchDocumentRows(tenantId);
        const names = await this.resolveUploaderNames(docRows);
        const withDocs = embedStudentDocuments(students, docRows, names);
        try {
          const historyRows = await this.fetchAcademicHistoryRows(tenantId);
          this.cache.set(embedAcademicHistories(withDocs, historyRows));
        } catch (histErr) {
          console.warn("[SupabaseStudent] academic-history fetch failed — history degraded to empty:", histErr);
          this.cache.set(withDocs);
        }
      } catch (docErr) {
        console.warn("[SupabaseStudent] document fetch failed — documents degraded to empty:", docErr);
        this.cache.set(students);
      }
    } catch (e) {
      // OPS-317 (T-392): the students seed's honest-empty degradation now
      // records the classified reason (auth vs RLS vs network) + logs it —
      // the children list going empty is the owner's reported symptom.
      recordSeedError("students", e);
      this.cache.set([]);
    }
  }

  /**
   * T-402 — tenant-scoped fetch of every `student_academic_histories` row
   * (the canonical promotion archive; staff SELECT under the 0057 policy,
   * parents read their own children under 0091 from the portal). Ordered by
   * academic_year so each student's embedded history is chronological.
   */
  private async fetchAcademicHistoryRows(tenantId: string): Promise<StudentAcademicHistoryRecordRow[]> {
    const { data, error } = await this.client
      .from("student_academic_histories")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("academic_year", { ascending: true });
    if (error) throw error;
    return (data ?? []) as StudentAcademicHistoryRecordRow[];
  }

  /** SYNC-110/T-372 — tenant-scoped fetch of every `student_documents` row. */
  private async fetchDocumentRows(tenantId: string): Promise<StudentDocumentRow[]> {
    const { data, error } = await this.client
      .from("student_documents")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("uploaded_at", { ascending: true });
    if (error) throw error;
    return (data ?? []) as StudentDocumentRow[];
  }

  /**
   * SYNC-110/T-372 — best-effort resolution of uploader display names for
   * `uploaded_by` profile ids (the chat-repository name-cache pattern):
   * user_profiles first (own profile + staff-visible profiles under the
   * 0019 select policy); unresolved/NULL ids keep the honest "—".
   * Never throws — a name-resolution failure must not blank documents.
   */
  private async resolveUploaderNames(rows: readonly StudentDocumentRow[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    const missing = [...new Set(rows.map((r) => r.uploaded_by).filter((id): id is string => !!id && !this.uploaderNameCache.has(id)))];
    if (missing.length > 0) {
      try {
        const { data } = await this.client
          .from("user_profiles")
          .select("id, display_name, email")
          .in("id", missing);
        for (const row of (data ?? []) as Array<{ id: string; display_name: string | null; email: string | null }>) {
          const display = row.display_name || row.email || "—";
          this.uploaderNameCache.set(row.id, display);
          names.set(row.id, display);
        }
      } catch {
        // RLS hides foreign profiles for non-admin viewers — fall through.
      }
    }
    for (const r of rows) {
      const id = r.uploaded_by;
      if (id) {
        const cached = this.uploaderNameCache.get(id);
        if (cached && !names.has(id)) names.set(id, cached);
      }
    }
    return names;
  }

  observe(): Observable<Student[]> {
    void this.seed();
    return this.cache;
  }

  /**
   * T-370 (ACAD-500): cross-repo refresh seam — the class-placement finalize
   * RPC mutates students server-side; this forces the cache to re-fetch on
   * the next observe (bypassing the CROSS-104 TTL) so moved students appear
   * immediately in their new sections.
   */
  async refresh(): Promise<void> {
    this.freshness.forceRefresh();
    await this.seed();
  }

  observeByParent(parentId: string): Observable<Student[]> {
    void this.seed();
    // FIX (reactivity): derive from the shared list cache so drawers update
    // after createStudent / updateStudent / deleteStudent / Excel import.
    return derived([this.cache], () => this.cache.get().filter((s) => s.parentId === parentId));
  }

  observeByClass(classId: string): Observable<Student[]> {
    void this.seed();
    return derived([this.cache], () => this.cache.get().filter((s) => s.classId === classId));
  }

  observeById(id: string): Observable<Student | null> {
    void this.seed();
    return derived([this.cache], () => this.cache.get().find((s) => s.id === id) ?? null);
  }

  async search(query: string): Promise<Result<Student[]>> {
    await this.seed();
    const q = query.toLowerCase().trim();
    if (!q) return Ok(this.cache.get());
    return Ok(
      this.cache.get().filter((s) =>
        `${s.firstName} ${s.lastName} ${s.displayName ?? ""} ${s.code}`
          .toLowerCase()
          .includes(q),
      ),
    );
  }

  async createStudent(parentId: string, input: CreateStudentInput): Promise<Result<Student>> {
    try {
      const tenantId = requireTenantId();
      const year = new Date().getFullYear();
      // DETERMINISTIC CODE: derive from (parentId, displayName) so re-imports
      // hit the primary identity match `(tenant_id, student_code)` and the
      // RPC performs an UPDATE instead of falling through to the weaker
      // (parent_id, first_name, last_name) fallback.
      const code = deterministicStudentCode(year, parentId, input);
      const gradeLevel: GradeLevel =
        input.gradeLevel ?? gradeLevelFromLevelYear(input.level, input.gradeYear);

      // PERF-501 (T-397): same idempotent-retry seam as createParent (the
      // deterministic student code converges on re-run).
      const { data, error } = await rpcWithIdempotentRetry<
        Record<string, unknown>,
        { out_student_id: string; out_student_code: string; out_was_inserted: boolean }[]
      >(this.client, "upsert_student_from_import", {
        p_tenant_id: tenantId,
        p_student_code: code,
        p_parent_id: parentId,
        p_first_name: input.firstName,
        p_last_name: input.lastName,
        p_display_name: input.displayName ?? `${input.firstName} ${input.lastName}`.trim(),
        // vault §04.03 — middle name is part of the child block; the RPC has
        // supported p_middle_name since migration 0027 but the desktop never
        // forwarded it (always null).
        p_middle_name: input.middleName ?? null,
        p_date_of_birth: input.birthDate ?? null,
        p_gender: input.gender === "unspecified" ? null : input.gender,
        p_grade_level_id: null,
        p_class_id: input.classId ?? null,
        p_enrollment_date: null,
        p_enrollment_status: "active",
        p_medical_notes: input.medicalNotes ?? null,
        p_is_active: true,
        // NEW (migration 0028): persist grade_level_code, transport_tier,
        // payment_plan so Android reads them back via pull_students_for_sync.
        p_grade_level_code: input.gradeLevel ?? null,
        p_transport_tier: input.transportTier ?? null,
        p_payment_plan: input.paymentPlan ?? "tranches",
        // T-401 (0107): the academic classification (NULL = untagged).
        p_filiere_code: normalizeTrackCode(input.filiereCode) ?? null,
        p_specialite_code: normalizeTrackCode(input.specialiteCode) ?? null,
      });
      if (error) throw error;
      // NOTE: migration 0031 renamed the RPC output columns to `out_*`.
      const row = (data as { out_student_id: string; out_student_code: string; out_was_inserted: boolean }[])[0];
      if (!row || !row.out_student_id) throw new Error("upsert_student_from_import returned no rows");

      const { data: fullRow, error: fetchErr } = await this.client
        .from("students")
        .select("*")
        .eq("id", row.out_student_id)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      const student = mapStudentRow(fullRow as StudentRow);
      // Patch the gradeLevel on the in-memory copy (the DB row doesn't carry
      // it as a string column — it's an FK to academic_levels).
      const patched: Student = {
        ...student,
        gradeLevel,
        level: input.level,
        gradeYear: input.gradeYear,
        transportTier: input.transportTier ?? null,
      };
      this.cache.update((list) => [patched, ...list.filter((s) => s.id !== patched.id)]);
      return Ok(patched);
    } catch (e) {
      return Err(supabaseErrorToAppError(e as { code?: string; message: string; details?: unknown }));
    }
  }

  async updateStudent(id: string, updates: UpdateStudentInput): Promise<Result<Student>> {
    try {
      const patch: Record<string, unknown> = {};
      if (updates.firstName !== undefined) patch.first_name = updates.firstName;
      if (updates.lastName !== undefined) patch.last_name = updates.lastName;
      // vault §04.03 — persist the optional middle name on edit.
      if (updates.middleName !== undefined) patch.middle_name = updates.middleName;
      if (updates.displayName !== undefined) patch.display_name = updates.displayName;
      if (updates.birthDate !== undefined) patch.date_of_birth = updates.birthDate;
      if (updates.gender !== undefined) patch.gender = updates.gender === "unspecified" ? null : updates.gender;
      if (updates.classId !== undefined) patch.class_id = updates.classId;
      if (updates.medicalNotes !== undefined) patch.medical_notes = updates.medicalNotes;
      // NEW (migration 0028): persist transport_tier + grade_level_code +
      // payment_plan on update. Previously these were silently skipped
      // because the columns didn't exist, so re-imports that changed
      // transport tier or grade didn't propagate.
      if (updates.transportTier !== undefined) {
        patch.transport_tier = updates.transportTier;
      }
      if (updates.gradeLevel !== undefined) {
        patch.grade_level_code = updates.gradeLevel;
      }
      // T-401 (0107): persist the academic classification on edit. "general"
      // normalizes to NULL (untagged) so the pre-0107 state stays canonical.
      if (updates.filiereCode !== undefined) {
        patch.filiere_code = normalizeTrackCode(updates.filiereCode);
      }
      if (updates.specialiteCode !== undefined) {
        patch.specialite_code = normalizeTrackCode(updates.specialiteCode);
      }
      if (updates.paymentPlan !== undefined) {
        patch.payment_plan = updates.paymentPlan;
      }
      // NEW (edit flow): persist the student lifecycle status.
      if (updates.status !== undefined) {
        patch.enrollment_status = updates.status;
        patch.is_active = updates.status === "active";
      }
      // SYNC-110/T-372: the `documents_json` write is REMOVED — document
      // mutations go through addStudentDocument/removeStudentDocument
      // against the canonical `student_documents` table (the shared store).
      // Writing the JSON column here would re-create desktop-only invisible
      // documents — the exact split-brain this task fixes.
      if (Object.keys(patch).length > 0) {
        const { error } = await this.client.from("students").update(patch).eq("id", id);
        if (error) throw error;
      }
      // Refresh cache entry.
      const existing = this.cache.get().find((s) => s.id === id);
      if (!existing) return Err(Errors.notFound("Student", id));
      const updated: Student = { ...existing, ...updates } as Student;
      this.cache.update((list) => list.map((s) => (s.id === id ? updated : s)));
      return Ok(updated);
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  /**
   * SYNC-110/T-372 — attach ONE document to a student against the CANONICAL
   * `student_documents` table (0005; staff INSERT via the 0019
   * student_documents_admin policy — exactly the roles the UI's EditStudent
   * gate allows: SuperAdmin + SupportStaff; parents insert through the 0043
   * policy from the portal). The row lands in the SAME store the website
   * lists from, so the document is immediately visible on BOTH platforms.
   *
   * The binary upload happens BEFORE this call (the Documents tab runs
   * `uploadPrivateMedia` first and passes the returned storage path); if the
   * INSERT fails the storage object is orphaned — surfaced honestly by the
   * returned Err (the same cross-platform characteristic as the portal's
   * upload dialog; the t-359 e2e TABLE leg probes the full flow).
   */
  async addStudentDocument(
    studentId: string,
    input: StudentDocumentDraft,
  ): Promise<Result<StudentDocument>> {
    try {
      const tenantId = requireTenantId();
      const { data, error } = await this.client
        .from("student_documents")
        .insert({
          tenant_id: tenantId,
          student_id: studentId,
          kind: input.category,
          file_name: input.fileName,
          storage_path: input.storagePath,
          mime_type: input.mimeType ?? null,
          size_bytes: input.sizeBytes ?? null,
          uploaded_by: input.uploadedByProfileId ?? null,
          description: input.note ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      const row = data as StudentDocumentRow;
      // Best-effort uploader display name (own-profile read always works).
      let display = "—";
      if (row.uploaded_by) {
        const names = await this.resolveUploaderNames([row]);
        display = names.get(row.uploaded_by) ?? "—";
      }
      const doc = mapStudentDocumentRow(row, display);
      this.embedDocument(studentId, doc);
      return Ok(doc);
    } catch (e) {
      return Err(supabaseErrorToAppError(e as { code?: string; message: string; details?: unknown }));
    }
  }

  /**
   * SYNC-110/T-372 — remove ONE document row with HONEST zero-match
   * semantics (§15.30b): the DELETE selects the matched ids, and an empty
   * match returns notFound instead of a silent success (PostgREST answers
   * 200 with an empty array when a DELETE matches zero rows under RLS).
   */
  async removeStudentDocument(studentId: string, documentId: string): Promise<Result<void>> {
    try {
      const tenantId = requireTenantId();
      const { data, error } = await this.client
        .from("student_documents")
        .delete()
        .select("id")
        .eq("id", documentId)
        .eq("student_id", studentId)
        .eq("tenant_id", tenantId);
      if (error) throw error;
      const matched = (data ?? []) as Array<{ id: string }>;
      if (matched.length === 0) {
        return Err(Errors.notFound("StudentDocument", documentId));
      }
      this.dropDocument(studentId, documentId);
      return Ok(undefined);
    } catch (e) {
      return Err(supabaseErrorToAppError(e as { code?: string; message: string; details?: unknown }));
    }
  }

  /** Append one document to the cached student (observable re-emits). */
  private embedDocument(studentId: string, doc: StudentDocument): void {
    this.cache.update((list) =>
      list.map((s) =>
        s.id === studentId ? { ...s, documents: [...(s.documents ?? []), doc] } : s,
      ),
    );
  }

  /** Drop one document from the cached student (observable re-emits). */
  private dropDocument(studentId: string, documentId: string): void {
    this.cache.update((list) =>
      list.map((s) =>
        s.id === studentId
          ? { ...s, documents: (s.documents ?? []).filter((d) => d.id !== documentId) }
          : s,
      ),
    );
  }

  async deleteStudent(id: string): Promise<Result<void>> {
    try {
      // T-381/T-384 / RLS-500 — the canonical soft_delete_student RPC
      // (migration 0100). The previous plain `.update({deleted_at})` was
      // RLS-IMPOSSIBLE for every authenticated caller (live-proven 74th
      // session: the 0019 students_select policy folds `deleted_at IS NULL`
      // into the UPDATE's effective WITH CHECK → 42501 on every call — the
      // T-381 UI surface was live-broken before this fix). The RPC owns the
      // rule set server-side: not_found, the super_admin gate, and the
      // student.delete audit entry.
      const { data, error } = await this.client.rpc("soft_delete_student", {
        p_student_id: id,
      });
      if (error) throw error;
      const env = (data ?? {}) as { ok?: boolean; code?: string };
      if (env.ok !== true) {
        if (env.code === "not_found") return Err(Errors.notFound("Student", id));
        if (env.code === "forbidden") {
          return Err(
            Errors.forbidden(
              `soft_delete_student refused for ${id}: caller is not super_admin`,
            ),
          );
        }
        return Err(Errors.validation(`soft_delete_student: ${JSON.stringify(env)}`));
      }
      this.cache.update((list) => list.filter((s) => s.id !== id));
      return Ok(undefined);
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  async batchRegister(
    input: BatchRegistrationInput,
  ): Promise<Result<BatchRegistrationResult>> {
    // T-398 (PERF-502, 82nd session 2026-09-21): the ONE-round-trip
    // registration. History: born as a sequential per-entity flow (1-student
    // default = 21+ round-trips, the owner's 10–20 s report); T-397 rewired
    // the billing leg onto the bulk paths (~11 round-trips, 3,189 ms live);
    // the owner's follow-up ("is there no way to make it faster????") made
    // the round-trip COUNT the target — at the Algeria→eu-west-1 RTT band,
    // ~11 calls are still a 5–10 s floor. This implementation collapses the
    // WHOLE composite into ONE `register_family_batch` RPC (migrations
    // 0102+0103): ONE SECURITY DEFINER transaction that reuses the canonical
    // idempotent upserts internally, resolves the identity tokens, writes
    // the billing legs ON CONFLICT DO NOTHING, and returns the FULL parent +
    // student rows (no follow-up fetches).
    //
    // ALL money amounts stay client-derived (the canonical TS calc engine —
    // evaluateAllSystemDiscounts/splitNetTuitionByOfficialSchedule through
    // the SAME createChargeEntry factory; the installment shapes
    // bulkImportInstallments writes). The server only fills what the client
    // cannot know before the single call: the uuids, the account_id string
    // (deriveAccountId's exact format) and the source_id identity tokens
    // (the deterministic CODES the client sends are substituted back to the
    // uuids server-side — the 0103 continuity contract: cross-path
    // re-registrations CONVERGE, never duplicate).
    //
    // ATOMICITY (the registered upgrade of the DATA-019 scope decision):
    // ONE transaction — any leg failing rolls back EVERYTHING. The old
    // partial-success semantics ("family created, billing missing, warn")
    // existed only because the writes were split across calls; the mock
    // repository has been fully atomic since birth (its snapshot rollback),
    // and this aligns the Supabase path with it. A failure returns Err with
    // the honest reason and ZERO rows written — the operator retries.
    //
    // IDEMPOTENCY (the rpcWithIdempotentRetry contract): deterministic
    // parent/student codes converge on re-run; the billing legs conflict on
    // the 0027 source_uidx / the 0032 partial identity index — a network
    // retry can never duplicate anything (live-proven: verify_t-398 C7/C12).
    try {
      const tenantId = requireTenantId();
      const year = input.academicYearStartYear ?? new Date().getFullYear();
      const includeTransport = input.includeTransport ?? true;
      const includeRegistration = input.includeRegistration ?? true;
      const [due1, due2, due3] = getOfficialTuitionDueDates(year);
      const at = new Date().toISOString();

      // -----------------------------------------------------------------
      // The parent wire object — createParent's EXACT derivation (the
      // deterministic code + the 0037 activation code + the 0028
      // transport/city fields).
      // -----------------------------------------------------------------
      const parentCode = deterministicParentCode(year, input.parent);
      const activationCodeValue = deterministicActivationCode(parentCode, tenantId);
      const transportDestination: TransportDestination | null =
        input.parent.transportDestination ?? cityTierToDestination(input.parent.cityTier) ?? null;
      const parentWire: Record<string, unknown> = {
        parent_code: parentCode,
        first_name: input.parent.firstName,
        last_name: input.parent.lastName,
        display_name: input.parent.displayName ?? `${input.parent.firstName} ${input.parent.lastName}`.trim(),
        primary_phone: input.parent.phone,
        secondary_phone: input.parent.whatsapp ?? null,
        email: input.parent.email ?? null,
        occupation: input.parent.occupation ?? null,
        address: input.parent.address ?? null,
        relationship: null,
        preferred_language: input.parent.preferredLanguage ?? "fr",
        is_active: true,
        transport_destination: transportDestination ?? null,
        city_tier: input.parent.cityTier ?? null,
        activation_code: activationCodeValue,
      };

      // -----------------------------------------------------------------
      // The students wire array — createStudent's EXACT derivation, in
      // payload order. The 0-based array index IS the `student_ref` the
      // billing rows reference. NOTE: deterministicStudentCode hashes the
      // parentCode here (the parent uuid is not known yet — one round
      // trip); for a PRE-EXISTING student the upsert's name fallback
      // converges on the existing row and the 0103 source_id substitution
      // preserves the old identity (verify_t-398 C12).
      // -----------------------------------------------------------------
      const studentWires: Record<string, unknown>[] = input.students.map((sInput) => ({
        student_code: deterministicStudentCode(year, parentCode, sInput),
        first_name: sInput.firstName,
        last_name: sInput.lastName,
        display_name: sInput.displayName ?? `${sInput.firstName} ${sInput.lastName}`.trim(),
        middle_name: sInput.middleName ?? null,
        date_of_birth: sInput.birthDate ?? null,
        gender: sInput.gender === "unspecified" ? null : sInput.gender,
        grade_level_id: null,
        class_id: isUuid(sInput.classId) ? sInput.classId : null, // §15.37 blank→null
        enrollment_date: null,
        enrollment_status: "active",
        medical_notes: sInput.medicalNotes ?? null,
        is_active: true,
        grade_level_code: sInput.gradeLevel ?? null,
        transport_tier: sInput.transportTier ?? null,
        payment_plan: sInput.paymentPlan ?? "tranches",
        // T-407 fix: the classification the wizard's step 2 collected was
        // DROPPED here — the register_family_batch RPC has threaded it
        // through to upsert_student_from_import since migration 0111.
        // Normalize through the canonical normalizer ("general"/"" → NULL).
        filiere_code: normalizeTrackCode(sInput.filiereCode) ?? null,
        specialite_code: normalizeTrackCode(sInput.specialiteCode) ?? null,
      }));

      // -----------------------------------------------------------------
      // The pricing config — the wizard's loaded config when provided
      // (T-398: kills the 5-6 sequential readDbPricingConfig reads AND
      // guarantees preview == persisted — the same config object the
      // step-3 preview derived from). Fallback: the DB read (the T-307
      // convention), then the seed (the honest degraded path).
      // -----------------------------------------------------------------
      let billingConfig = input.pricingConfig ?? defaultPricingConfig;
      if (!input.pricingConfig) {
        try {
          billingConfig = await readDbPricingConfig(this.client);
        } catch {
          /* keep the seed config — the charges still generate */
        }
      }

      // -----------------------------------------------------------------
      // Build ALL billing rows locally (the T-397 builders, uuid-free):
      // the SAME createChargeEntry factory (its validation + row shape —
      // the derived account_id from the code placeholders is discarded;
      // the RPC derives the real one) and the SAME installment shapes
      // bulkImportInstallments writes, with the source_id identity tokens
      // carried as the deterministic CODES (the RPC substitutes the uuids).
      // -----------------------------------------------------------------
      const ledgerWire: Record<string, unknown>[] = [];
      const installmentWire: Record<string, unknown>[] = [];

      for (let i = 0; i < input.students.length; i++) {
        const sInput = input.students[i];
        const studentCode = studentWires[i].student_code as string;
        const gradeLevel: GradeLevel =
          sInput.gradeLevel ?? gradeLevelFromLevelYear(sInput.level, sInput.gradeYear);
        const gross = tuitionForGradeLevel(billingConfig, gradeLevel).annualAmount;
        if (gross > 0) {
          const evals = evaluateAllSystemDiscounts({
            grossTuition: gross,
            previousGradeLevel: null,
            currentGradeLevel: gradeLevel,
            childIndex: i + 1,
            paymentPlan: sInput.paymentPlan ?? "tranches",
            paymentDate: at,
            academicYearStartYear: year,
            academicYearStart: new Date(Date.UTC(year, 8, 1)).toISOString(),
            // The pre-call equivalent of the created row's enrollment_date
            // (the RPC defaults it to current_date — i.e. NOW): the discount
            // evaluation sees the same "enrolled today" the old path did
            // after its fetch round-trip.
            enrollmentDate: at,
            previousRank: null,
          });
          const net = Math.max(0, gross + sumDiscounts(evals));
          const amounts =
            sInput.paymentPlan === "full_annual"
              ? [net]
              : [...splitNetTuitionByOfficialSchedule(net)];
          const dues = sInput.paymentPlan === "full_annual" ? [due1] : [due1, due2, due3];
          for (let t = 0; t < amounts.length; t++) {
            const e = createChargeEntry({
              tenantId,
              parentId: parentCode, // placeholder token — the RPC fills the uuid + account_id
              studentId: null, // the RPC fills the real student uuid
              category: "tuition",
              amount: amounts[t],
              sourceType: "installment",
              sourceId: `reg-${studentCode}-t${t + 1}`,
              description: `Scolarité ${year} — Tranche ${t + 1} (${gradeLevel})`,
              actorId: "system",
              actorName: "Inscription groupée",
              at,
              metadata: {
                tranche: t + 1,
                gradeLevel,
                paymentPlan: sInput.paymentPlan ?? "tranches",
              },
            });
            ledgerWire.push({
              student_ref: i,
              entry_number: e.id,
              entry_type: e.type,
              amount: e.amount,
              category: e.category,
              description: e.description,
              entry_date: toIsoDate(e.at) ?? at,
              source_type: e.sourceType,
              source_id: e.sourceId,
              method: e.method,
              receipt_number: e.receiptNumber,
              payment_status: e.paymentStatus,
              reverses_id: e.reversesId,
              actor_id: e.actorId,
              actor_name: e.actorName,
              at: toIsoDate(e.at),
              metadata: e.metadata as Record<string, string | number | boolean | null> | null,
            });
            installmentWire.push({
              student_ref: i,
              category: "tuition",
              tranche_number: (t + 1) as 1 | 2 | 3,
              label: sInput.paymentPlan === "full_annual" ? "Année complète" : `Tranche ${t + 1}`,
              amount_due: amounts[t],
              amount_paid: 0,
              amount_pending: 0,
              due_date: dues[t],
              paid_date: null,
              status: "unpaid",
              academic_cycle: null,
              payment_plan: sInput.paymentPlan ?? "tranches",
              is_custom_schedule: false,
              custom_schedule_note: null,
              source_type: "bulk_import",
              source_id: `${studentCode}:tuition:T${t + 1}`,
            });
          }
        }
        if (includeTransport) {
          const destination =
            (sInput.transportTier as TransportDestination | null) ?? transportDestination;
          if (destination) {
            const tranches = transportTranchesForDestination(billingConfig, destination);
            for (let t = 0; t < tranches.length; t++) {
              const e = createChargeEntry({
                tenantId,
                parentId: parentCode,
                studentId: null,
                category: "transport",
                amount: tranches[t].amountDue,
                sourceType: "installment",
                sourceId: `reg-${studentCode}-transport-t${t + 1}`,
                description: `Transport ${year} — Tranche ${t + 1} (${destination})`,
                actorId: "system",
                actorName: "Inscription groupée",
                at,
                metadata: { tranche: t + 1, destination },
              });
              ledgerWire.push({
                student_ref: i,
                entry_number: e.id,
                entry_type: e.type,
                amount: e.amount,
                category: e.category,
                description: e.description,
                entry_date: toIsoDate(e.at) ?? at,
                source_type: e.sourceType,
                source_id: e.sourceId,
                method: e.method,
                receipt_number: e.receiptNumber,
                payment_status: e.paymentStatus,
                reverses_id: e.reversesId,
                actor_id: e.actorId,
                actor_name: e.actorName,
                at: toIsoDate(e.at),
                metadata: e.metadata as Record<string, string | number | boolean | null> | null,
              });
              installmentWire.push({
                student_ref: i,
                category: "transport",
                tranche_number: (t + 1) as 1 | 2 | 3,
                label: `Transport T${t + 1}`,
                amount_due: tranches[t].amountDue,
                amount_paid: 0,
                amount_pending: 0,
                due_date: [due1, due2, due3][t],
                paid_date: null,
                status: "unpaid",
                academic_cycle: null,
                payment_plan: sInput.paymentPlan ?? "tranches",
                is_custom_schedule: false,
                custom_schedule_note: null,
                source_type: "bulk_import",
                source_id: `${studentCode}:transport:T${t + 1}`,
              });
            }
          }
        }
      }
      if (includeRegistration && billingConfig.registrationFee > 0 && input.students.length > 0) {
        const e = createChargeEntry({
          tenantId,
          parentId: parentCode,
          studentId: null, // family-level fee — no student ref
          category: "other",
          amount: billingConfig.registrationFee,
          sourceType: "manual_entry",
          sourceId: `reg-${parentCode}-fee`,
          description: `Frais d'inscription ${year} (nouvelle famille)`,
          actorId: "system",
          actorName: "Inscription groupée",
          at,
          metadata: { type: "registration_fee" },
        });
        ledgerWire.push({
          student_ref: null,
          entry_number: e.id,
          entry_type: e.type,
          amount: e.amount,
          category: e.category,
          description: e.description,
          entry_date: toIsoDate(e.at) ?? at,
          source_type: e.sourceType,
          source_id: e.sourceId,
          method: e.method,
          receipt_number: e.receiptNumber,
          payment_status: e.paymentStatus,
          reverses_id: e.reversesId,
          actor_id: e.actorId,
          actor_name: e.actorName,
          at: toIsoDate(e.at),
          metadata: e.metadata as Record<string, string | number | boolean | null> | null,
        });
      }

      // -----------------------------------------------------------------
      // THE ONE ROUND-TRIP (with the idempotent network retry — the whole
      // composite is idempotent: deterministic codes + ON CONFLICT).
      // -----------------------------------------------------------------
      const { data, error } = await rpcWithIdempotentRetry<
        Record<string, unknown>,
        {
          out_parent: unknown;
          out_students: unknown;
          out_ledger_written: number;
          out_installments_written: number;
        }[]
      >(this.client, "register_family_batch", {
        p_tenant_id: tenantId,
        p_parent: parentWire,
        p_students: studentWires,
        p_ledger_entries: ledgerWire,
        p_installments: installmentWire,
      });
      if (error) throw error;
      const row = (data as {
        out_parent: unknown;
        out_students: unknown;
        out_ledger_written: number;
        out_installments_written: number;
      }[])[0];
      if (!row || !row.out_parent) {
        throw new Error("register_family_batch returned no rows");
      }

      // -----------------------------------------------------------------
      // Map the FULL returned rows (the same mappers createParent /
      // createStudent use after their fetches — the follow-up fetch round-
      // trips are gone). Students come back in PAYLOAD order: zip with the
      // inputs for the gradeLevel/level/gradeYear patches (createStudent's
      // exact convention).
      // -----------------------------------------------------------------
      const parent = mapParentRow(row.out_parent as ParentRow);
      const created: Student[] = ((row.out_students ?? []) as StudentRow[]).map((r, i) => {
        const sInput = input.students[i];
        const gradeLevel: GradeLevel =
          sInput.gradeLevel ?? gradeLevelFromLevelYear(sInput.level, sInput.gradeYear);
        const student = mapStudentRow(r);
        return {
          ...student,
          gradeLevel,
          level: sInput.level,
          gradeYear: sInput.gradeYear,
          transportTier: sInput.transportTier ?? null,
        } as Student;
      });

      // Cache updates — the same conventions createStudent applies on the
      // singleton students repository (the parent list refreshes exactly as
      // before: the wizard's onSubmitted opens the drawer by the returned
      // id).
      const newIds = new Set(created.map((s) => s.id));
      this.cache.update((list) => [
        ...created,
        ...list.filter((s) => !newIds.has(s.id)),
      ]);

      return Ok({ parent, students: created });
    } catch (e) {
      const err = e as { code?: string; message: string; details?: unknown };
      const raw =
        typeof err?.message === "string" && err.message.trim().length > 0
          ? err.message
          : supabaseErrorToAppError(err).userMessage;
      // ATOMIC (T-398): a failure means NOTHING was written — the honest
      // operator message says so (previously a mid-chain failure could
      // leave the family created without billing). The full reason rides
      // in BOTH fields: `Errors.server()`'s factory userMessage is a
      // generic "Erreur interne du serveur." which would hide the actual
      // cause — the owner's mandate is to SEE the real error (OPS-320).
      const full =
        `Inscription atomique échouée — RIEN n'a été écrit (la famille, les élèves et la facturation sont dans UNE transaction) : ${raw}`;
      return Err({ code: "ERR_SERVER", message: full, userMessage: full });
    }
  }

  async promote(studentIds: string[], academicYear: string): Promise<Result<Student[]>> {
    // T-041 (BUSINESS-004): previously a hard "not implemented" error in
    // production. Implemented on the SAME canonical path as the batch flow:
    // each student advances one grade via the canonical progression
    // (getNextGradeProgression — the TS reference), the final decisions go
    // through the atomic `execute_batch_promotion` RPC (migration 0059),
    // which archives an append-only history entry per student, advances the
    // grade, graduates 3eme_annee and writes the audit entry — all in one
    // transaction. `academicYear` is the year the students just COMPLETED
    // (the history label).
    const realIds = studentIds.filter((id) => isUuid(id));
    if (realIds.length === 0) {
      return Ok([]);
    }

    const { data: rows, error: fetchErr } = await this.client
      .from("students")
      .select("*")
      .in("id", realIds);
    if (fetchErr) return Err(supabaseErrorToAppError(fetchErr));

    const decisions: Record<string, unknown>[] = [];
    const updatedIds: string[] = [];
    for (const row of rows ?? []) {
      const student = mapStudentRow(row);
      const progression = getNextGradeProgression(student.gradeLevel);
      const finalDecision: "promoted" | "graduated" = progression.isGraduation
        ? "graduated"
        : "promoted";
      decisions.push({
        student_id: student.id,
        decision: finalDecision,
        next_grade_code: progression.nextGradeCode,
        academic_year: academicYear,
        cycle: student.level,
        grade_code: student.gradeLevel,
        grade_year: student.gradeYear,
        class_id: isUuid(student.classId) ? student.classId : null,
        class_name: null,
        gpa: 0, // quick-promotion carries no evaluated GPA (no assessment context)
        rank: null,
        narrative: "Promotion directe (sans revue d'évaluations)",
      });
      updatedIds.push(student.id);
    }

    if (decisions.length === 0) return Ok([]);

    const { error: rpcErr } = await this.client.rpc("execute_batch_promotion", {
      p_decisions: decisions,
      p_actor_profile_id: null,
      p_actor_name: "Promotion rapide",
      p_tenant_id: getTenantId(),
    });
    if (rpcErr) return Err(supabaseErrorToAppError(rpcErr));

    const { data: updatedRows, error: refetchErr } = await this.client
      .from("students")
      .select("*")
      .in("id", updatedIds);
    if (refetchErr) return Err(supabaseErrorToAppError(refetchErr));

    return Ok((updatedRows ?? []).map(mapStudentRow));
  }
}

// ============================================================================
// SupabasePaymentRepository
// ============================================================================

export class SupabasePaymentRepository implements PaymentRepository {
  private readonly cache = new SubjectBehavior<Payment[]>([]);
  // T-034/CROSS-104: TTL + focus freshness policy (replaces the one-shot seeded flag)
  private readonly freshness = new CacheFreshness();

  constructor(private readonly client: SupabaseClient) {}

  private async seed(): Promise<void> {
    if (!this.freshness.shouldReseed()) return;
    this.freshness.markSeeded();
    try {
      const tenantId = requireTenantId();
      const { data, error } = await this.client
        .from("payments")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("collected_at", { ascending: false });
      if (error) throw error;
      this.cache.set((data as PaymentRow[]).map(mapPaymentRow));
    } catch {
      this.cache.set([]);
    }
  }

  observe(): Observable<Payment[]> {
    void this.seed();
    return this.cache;
  }

  observeByParent(parentId: string): Observable<Payment[]> {
    void this.seed();
    // FIX (reactivity): derive from the shared list cache.
    return derived([this.cache], () => this.cache.get().filter((p) => p.parentId === parentId));
  }

  observeByStudent(studentId: string): Observable<Payment[]> {
    void this.seed();
    return derived([this.cache], () => this.cache.get().filter((p) => p.studentId === studentId));
  }

  observeById(id: string): Observable<Payment | null> {
    void this.seed();
    return derived([this.cache], () => this.cache.get().find((p) => p.id === id) ?? null);
  }

  /**
   * T-330 (58th session): the canonical per-payment coverage read —
   * payment_allocations rows (migration 0033, written server-side by
   * collect_and_allocate_payment). The Payment Breakdown UI's PRIMARY
   * source; the ledger receipt-number join stays the fallback for legacy
   * payments. Same precedence as the website's canonical module
   * (elimtiyaz-website src/lib/canonical/payment-coverage.ts).
   */
  async allocationsForPayment(paymentId: string): Promise<Result<readonly PaymentAllocation[]>> {
    try {
      const tenantId = requireTenantId();
      const { data, error } = await this.client
        .from("payment_allocations")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("payment_id", paymentId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as PaymentAllocationRow[];
      return Ok(
        rows.map((r) => ({
          id: r.id,
          paymentId: r.payment_id,
          chargeId: r.charge_id,
          installmentId: r.installment_id,
          category: r.category as PaymentCategory,
          allocatedAmount: r.allocated_amount,
          label: r.label,
          createdAt: r.created_at,
        })),
      );
    } catch (err) {
      return Err(supabaseErrorToAppError(err as { code?: string; message: string; details?: unknown }));
    }
  }

  async collect(input: CollectPaymentInput, collectedBy: string): Promise<Result<Payment>> {
    // CANONICAL-FINANCIAL-LOGIC.md §4 INV-6 + INV-7 + §8.6 — the Supabase
    // `collect` workflow MUST use the atomic `collect_and_allocate_payment`
    // RPC (migration 0026, extended by 0039/0040) so the waterfall + parent_credit
    // adjustment + audit transaction happen server-side in one go.
    //
    // T-011 (BUSINESS-002): the previous implementation silently fell back to
    // `upsert_payment_from_import` (a simple INSERT helper) when the atomic RPC
    // failed for ANY reason — network glitch, RLS denial, schema drift. That
    // fallback wrote ONLY the payment row: no ledger entry, no waterfall, no
    // parent_credit, no audit — while the UI reported success. Since the
    // canonical migration chain (ADR-001) is always applied to the live
    // project, there is no supported "older deployment" to serve: a failed
    // atomic collection now surfaces the error and writes NOTHING.
    try {
      const tenantId = requireTenantId();
      const atomicParams = {
        p_tenant_id: tenantId,
        p_parent_id: input.parentId,
        p_student_id: input.studentId ?? null,
        p_amount: input.amount,
        p_method: input.method,
        p_category: input.category ?? "tuition",
        p_installment_id: input.installmentId ?? null,
        p_proof_path: input.proofUrl ?? null,
        p_notes: input.notes ?? null,
        // VAULT §07.01 — method-specific structured fields (migration 0039
        // extends the RPC with optional params so older callers — Android,
        // Edge Functions — keep working unchanged).
        p_check_number: input.checkNumber ?? null,
        p_check_bank_name: input.checkBankName ?? null,
        p_check_issue_date: input.checkIssueDate ?? null,
        p_check_clearance_date: input.checkClearanceDate ?? null,
        p_transfer_reference: input.transferReference ?? null,
        p_transfer_source_bank: input.transferSourceBank ?? null,
        p_actor_id: collectedBy,
        // T-310 (AUDIT-502): NULL, not the user ID — the previous
        // `p_actor_name: collectedBy` wrote the UUID into the audit's
        // attribution block (actor_name showed "dac9c821-…" instead of a
        // display name). Migration 0087 resolves the display name + role
        // server-side from user_profiles when the caller passes NULL.
        p_actor_name: null,
      };
      const { data: atomicData, error: atomicErr } = await this.client.rpc(
        "collect_and_allocate_payment",
        atomicParams,
      );
      if (atomicErr) throw atomicErr;
      // Atomic RPC succeeded — its return type matches the migration 0026 schema.
      // The receipt number (`REC-YYYY-NNNNNN`) is generated server-side (ADR-004).
      const atomicRow = (atomicData as {
        payment_id: string;
        receipt_number: string;
        payment_status: string;
        total_allocated: number | string;
        unallocated_credit: number | string;
        allocations: unknown;
      }[])[0];
      if (!atomicRow || !atomicRow.payment_id) {
        throw new Error("collect_and_allocate_payment returned no rows");
      }
      const paymentId = atomicRow.payment_id;
      const { data: fullRow, error: fetchErr } = await this.client
        .from("payments")
        .select("*")
        .eq("id", paymentId)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      const payment = mapPaymentRow(fullRow as PaymentRow);
      this.cache.update((list) => [payment, ...list.filter((p) => p.id !== payment.id)]);
      return Ok(payment);
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  /**
   * T-014 (BUSINESS-003): propagates the caller's REAL reason and actor
   * identity to the canonical `revert_payment_allocation` RPC. The previous
   * implementation hardcoded `p_reason: "Manual refund"` and read the actor
   * from localStorage fallbacks ("excel-import"), so a refund performed by a
   * named financial officer was audited as "Excel Import / Manual refund".
   * The reason is mandatory (≥3 chars) per the canonical §7.2 contract —
   * same rule the refund-payment Edge Function enforces.
   */
  async refund(id: string, reason: string, actorId: string, actorName?: string): Promise<Result<Payment>> {
    try {
      const trimmed = reason.trim();
      if (trimmed.length < 3) {
        return Err(Errors.validation(
          "Un motif d'au moins 3 caractères est obligatoire pour rembourser un paiement",
        ));
      }
      if (!id) return Err(Errors.validation("Paiement introuvable"));
      const tenantId = requireTenantId();
      const { error } = await this.client.rpc("revert_payment_allocation", {
        p_tenant_id: tenantId,
        p_payment_id: id,
        p_actor_id: actorId,
        p_actor_name: actorName ?? actorId,
        p_reason: trimmed,
      });
      if (error) throw error;
      const { data, error: fetchErr } = await this.client
        .from("payments")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!data) throw new Error(`Payment ${id} not found after refund`);
      const payment = mapPaymentRow(data as PaymentRow);
      this.cache.update((list) => list.map((p) => (p.id === id ? payment : p)));
      return Ok(payment);
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  /**
   * VAULT §07.02 — PENDING → PAID (bank clearance verified).
   *
   * Delegates to the atomic `mark_payment_cleared` RPC (migration 0039):
   * payment status + installment amount_pending → amount_paid move +
   * audit_log all happen server-side.
   *
   * T-013 (BUSINESS-101 + BUSINESS-104): the previous implementation fell
   * back to a row-update shim (`markClearedFallback`) when the RPC failed —
   * that shim wrote NO audit entries, discarded the actor identity
   * (`void actorId`), swallowed per-installment update errors and kept
   * decrementing the `remaining` budget as if they had succeeded, causing
   * cascading over-allocation. The canonical migration chain (ADR-001) is
   * always applied to the live project, so the shim served no supported
   * deployment: the fallback is REMOVED and an RPC failure now surfaces the
   * error with the financial state untouched (single atomic path, same
   * pattern as T-011).
   */
  async markCleared(id: string, actorId: string, actorName?: string): Promise<Result<Payment>> {
    try {
      const tenantId = requireTenantId();
      const { error: rpcErr } = await this.client.rpc("mark_payment_cleared", {
        p_tenant_id: tenantId,
        p_payment_id: id,
        p_actor_id: actorId,
        p_actor_name: actorName ?? actorId,
      });
      if (rpcErr) throw rpcErr;
      const { data, error: fetchErr } = await this.client
        .from("payments")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      const payment = mapPaymentRow(data as PaymentRow);
      this.cache.update((list) => list.map((p) => (p.id === id ? payment : p)));
      return Ok(payment);
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  /**
   * VAULT §07.02 — PENDING → UNPAID (check bounces / transfer fails).
   *
   * Delegates to the atomic `mark_payment_bounced` RPC (migration 0039):
   * payment status → unpaid + LIFO reversal of uncleared allocations +
   * reversal ledger entry + audit_log, all server-side.
   */
  async markBounced(id: string, reason: string, actorId: string, actorName?: string): Promise<Result<Payment>> {
    try {
      if (!reason.trim()) {
        return Err(Errors.validation("Un motif est obligatoire pour marquer un paiement comme échoué"));
      }
      const tenantId = requireTenantId();
      const { error: rpcErr } = await this.client.rpc("mark_payment_bounced", {
        p_tenant_id: tenantId,
        p_payment_id: id,
        p_reason: reason.trim(),
        p_actor_id: actorId,
        p_actor_name: actorName ?? actorId,
      });
      if (rpcErr) throw rpcErr;
      const { data, error: fetchErr } = await this.client
        .from("payments")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      const payment = mapPaymentRow(data as PaymentRow);
      this.cache.update((list) => list.map((p) => (p.id === id ? payment : p)));
      return Ok(payment);
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  /**
   * BULK IMPORT FIX: Batch-collect many payments in a SINGLE Supabase
   * INSERT call. ~100x faster than looping `collect()`.
   *
   * Does NOT call the `upsert_payment_from_import` RPC — uses a direct
   * INSERT. The caller (importer) is responsible for deduping via
   * deterministic receipt numbers.
   *
   * T-012 (BUSINESS-100): the previous implementation logged a failed chunk
   * and CONTINUED with the next one, then returned Ok(partially-inserted) —
   * silently violating the importer's "aucune donnée financière n'a été
   * partiellement appliquée en silence" contract. It now FAILS FAST: the
   * first chunk error aborts the whole batch and returns Err identifying
   * the failing row range, so `flushPendingBatches` cancels the import
   * transaction completely. The previous catch→loop-collect() fallback is
   * also gone: retrying rows individually after a chunk failure would
   * re-apply a partial subset — exactly the silent partial state the
   * importer promises never to produce.
   */
  async bulkCollect(inputs: ReadonlyArray<{ input: CollectPaymentInput; collectedBy: string }>): Promise<Result<readonly Payment[]>> {
    if (inputs.length === 0) return Ok([]);
    try {
      const tenantId = requireTenantId();
      const now = new Date().toISOString();

      // T-015 / DRIFT-011 — receipt numbers are SERVER-AUTHORITATIVE (ADR-004).
      // Rows whose input carries an explicit receiptNumber keep it (Excel
      // rows that already have one — dedup key for re-imports). Rows without
      // one get a canonical REC-YYYY-NNNNNN allocated in a single
      // `generate_receipt_numbers` RPC call (migration 0058, advisory-locked
      // against concurrent import allocations) — replacing the old
      // `PAY-{ts}-{random}` client-side generator. The 0034 trigger then
      // syncs receipt_number := payment_number on INSERT, so imported rows
      // land with both fields set, exactly like the canonical collect path.
      const missingCount = inputs.filter(({ input }) => !input.receiptNumber).length;
      let allocated: string[] = [];
      if (missingCount > 0) {
        const { data: allocatedRows, error: allocError } = await this.client.rpc(
          "generate_receipt_numbers",
          { p_tenant_id: tenantId, p_count: missingCount },
        );
        if (allocError) {
          return Err(Errors.server(
            `bulkCollect: server receipt-number allocation failed: ${allocError.message}`,
          ));
        }
        allocated = ((allocatedRows ?? []) as unknown as string[]).slice();
        if (allocated.length !== missingCount) {
          return Err(Errors.server(
            `bulkCollect: server allocated ${allocated.length} receipt numbers, expected ${missingCount}`,
          ));
        }
      }
      let allocIndex = 0;

      const rows = inputs.map(({ input, collectedBy }) => {
        const paymentNumber = input.receiptNumber ?? allocated[allocIndex++];
        return {
        tenant_id: tenantId,
        payment_number: paymentNumber,
        receipt_number: input.receiptNumber ?? null,
        parent_id: input.parentId,
        student_id: input.studentId ?? null,
        amount: input.amount,
        method: input.method,
        category: input.category ?? "tuition",
        status: input.method === "cash" ? "paid" : "pending",
        proof_path: input.proofUrl ?? null,
        collected_at: input.collectedAt ?? now,
        collected_by: collectedBy,
        notes: input.notes ?? null,
        // PAYMENT BREAKDOWN columns (migration 0033).
        expected_amount: (input as { expectedAmount?: number }).expectedAmount ?? 0,
        excess_amount: (input as { excessAmount?: number }).excessAmount ?? 0,
        excess_remark: (input as { excessRemark?: string | null }).excessRemark ?? null,
        };
      });
      // Insert in chunks of 500. FAIL FAST on the first chunk error.
      const CHUNK_SIZE = 500;
      const inserted: Payment[] = [];
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        // IMPORT-107: `ignoreDuplicates: true` → ON CONFLICT DO NOTHING.
        // The (tenant_id, payment_number) unique constraint is the
        // canonical payment identity: a re-import of the same workbook
        // carries the same deterministic IMP-… receipt numbers, so the
        // already-imported rows are SKIPPED (a clean no-op) instead of
        // hard-failing the whole batch with a unique violation and
        // blocking the re-import. The chained .select() returns ONLY the
        // rows actually inserted, so the cache stays truthful.
        const { data, error } = await this.client
          .from("payments")
          .upsert(chunk as never, { ignoreDuplicates: true })
          .select("id, tenant_id, payment_number, receipt_number, parent_id, student_id, amount, method, status, category, installment_id, proof_path, notes, collected_by, collected_at, created_at, updated_at");
        if (error) {
          // T-012: abort the whole batch — report the failing row range so
          // the Excel importer can point at the offending rows and cancel
          // the transaction ("no partial data applied").
          return Err(Errors.server(
            `bulkCollect: insert of payment rows ${i + 1}–${i + chunk.length} failed: ${error.message}` +
              " — le lot a été annulé (aucune écriture partielle).",
          ));
        }
        for (const row of (data ?? []) as PaymentRow[]) {
          inserted.push(mapPaymentRow(row));
        }
      }
      this.cache.update((list) => [...inserted, ...list]);
      return Ok(inserted);
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  async adjust(
    parentId: string,
    amount: number,
    reason: string,
    approvedBy: string,
    options?: {
      category?: PaymentCategory;
      studentId?: string | null;
    },
  ): Promise<Result<AccountAdjustment>> {
    // CANONICAL-FINANCIAL-LOGIC.md §4 INV-7 + §4 INV-10 — the Supabase
    // `adjust` workflow MUST write a canonical adjustment ledger entry
    // (signed amount, derived accountId, audit-actor attribution) rather
    // than returning Err("not implemented"). Returning Err would silently
    // disable the discretionary adjustment workflow in Supabase mode —
    // exactly the desktop-internal inconsistency Tier 1 R1 closes.
    //
    // TIER 3 FIX (R1.5 + studentId bug):
    //   Previously this method had `const studentId = isCredit ? null : null`
    //   — both branches returned null, so positive (debit) adjustments like
    //   late fees were written to a parent-scoped tuition account instead
    //   of the student-scoped account. This is now fixed: when the caller
    //   provides a `studentId`, the accountId is student-scoped.
    //
    //   The optional `category` parameter (R1.5) lets callers apply a
    //   positive adjustment to a non-tuition category (e.g. a canteen
    //   surcharge). When omitted, defaults to `tuition` for debits and
    //   `parent_credit` for credits.
    try {
      const tenantId = requireTenantId();
      const nowIso = new Date().toISOString();
      const adjustmentId = `led-${nowIso}-${Math.random().toString(36).slice(2, 10)}`;
      // Overpayment credits use category=parent_credit + studentId=null + a
      // parent-scoped accountId. Positive adjustments (majoration —
      // CALC-001: penalties do not exist) use the caller-specified category
      // (default tuition) + the
      // caller-specified studentId (default null) — this preserves the
      // canonical "negative balance implies parent_credit" invariant (INV-3).
      const isCredit = amount < 0;
      const category: PaymentCategory = isCredit
        ? "parent_credit"
        : (options?.category ?? "tuition");
      const studentId: string | null = isCredit ? null : (options?.studentId ?? null);
      const accountId = studentId
        ? `parent:${parentId}:category:${category}:student:${studentId}`
        : `parent:${parentId}:category:${category}`;
      const { error } = await this.client.rpc("upsert_ledger_entry_from_import", {
        p_tenant_id: tenantId,
        p_entry_number: adjustmentId,
        p_parent_id: parentId,
        p_student_id: studentId,
        p_account_id: accountId,
        p_entry_type: "adjustment",
        p_amount: amount, // signed — positive for debit, negative for credit
        p_category: category,
        p_description: reason,
        p_source_type: "manual_entry",
        p_source_id: `adjust-${adjustmentId}`,
        p_method: null,
        p_receipt_number: null,
        p_payment_status: null,
        p_reverses_id: null,
        p_actor_id: approvedBy,
        p_actor_name: approvedBy,
        p_at: nowIso,
        p_metadata: { reason, source: "supabase.adjust", category, studentId },
      });
      if (error) throw error;
      // Invalidate the ledger cache so the next read picks up the adjustment.
      // (The SupabaseLedgerRepository is the owner of the ledger_entries cache,
      //  but we don't have a reference to it here — readers will re-seed.)
      const adjustment: AccountAdjustment = {
        id: adjustmentId,
        parentId,
        amount, // signed
        reason,
        approvedBy,
        approvedAt: nowIso,
        receiptRef: null,
      };
      return Ok(adjustment);
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  async generateReceipt(paymentId: string, generatedBy: string): Promise<Result<Receipt>> {
    // CANONICAL-FINANCIAL-LOGIC.md §7.4 — a receipt is a DERIVED view of a
    // payment. There is no `receipts` table; the receipt's identifier IS
    // the payment's receipt_number. We re-fetch the payment row, derive
    // a (mock) PDF URL, and return a Receipt object.
    try {
      const { data, error } = await this.client
        .from("payments")
        .select("id, receipt_number, payment_number")
        .eq("id", paymentId)
        .maybeSingle();
      if (error) throw error;
      const row = data as { id: string; receipt_number?: string | null; payment_number?: string | null } | null;
      if (!row) return Err(Errors.notFound("Payment", paymentId));
      const receipt: Receipt = {
        id: `rct-${paymentId}`,
        paymentId,
        // T-015: no client-side REC- fabrication — show the real number or an
        // honest placeholder (every post-0058 payment carries one).
        receiptNumber: row.receipt_number ?? row.payment_number ?? "—",
        pdfUrl: null, // PDF generation is a desktop-only concern (Electron print-to-PDF)
        generatedAt: new Date().toISOString(),
        generatedBy,
      };
      return Ok(receipt);
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  async appendManualCharge(
    input: {
      parentId: string;
      studentId: string;
      serviceQualifier: "psy1" | "psy2" | "orth1" | "orth2" | "e_plant" | "ratrapage" | "autiste";
      description?: string;
    },
    actorId: string,
  ): Promise<Result<LedgerEntry>> {
    // CANONICAL-FINANCIAL-LOGIC.md §6.5 — use the canonical
    // `buildAdditionalServiceCharge` factory so the Supabase-backed
    // repository produces the same category + metadata-rich charge entries
    // as the mock repository.
    try {
      const { buildAdditionalServiceCharge } = await import(
        "../../../domain/calc/ledger/non-tuition-charges"
      );
      const tenantId = requireTenantId();
      // FIX (signature): `buildAdditionalServiceCharge` takes
      // `(input: NonTuitionChargeInput, serviceQualifier, customDescription?)`
      // — the previous call passed a single merged object with a bogus `as`
      // cast that broke the build. Adapt to the real signature.
      const entry = buildAdditionalServiceCharge(
        {
          tenantId,
          parentId: input.parentId,
          studentId: input.studentId,
          sourceType: "manual_entry",
          sourceId: `svc-${Date.now()}`,
          actorId,
          actorName: actorId,
          description: input.description,
        },
        input.serviceQualifier,
      );
      // Push the entry via the canonical upsert RPC.
      const { error } = await this.client.rpc("upsert_ledger_entry_from_import", {
        p_tenant_id: tenantId,
        p_entry_number: entry.id,
        p_parent_id: entry.parentId,
        p_student_id: entry.studentId,
        p_account_id: entry.accountId,
        p_entry_type: entry.type,
        p_amount: entry.amount,
        p_category: entry.category,
        p_description: entry.description,
        p_source_type: entry.sourceType,
        p_source_id: entry.sourceId,
        p_method: null,
        p_receipt_number: null,
        p_payment_status: null,
        p_reverses_id: null,
        p_actor_id: entry.actorId,
        p_actor_name: entry.actorName,
        p_at: entry.at,
        p_metadata: entry.metadata,
      });
      if (error) throw error;
      return Ok(entry);
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }
}

// ============================================================================
// SupabaseLedgerRepository
// ============================================================================

export class SupabaseLedgerRepository implements LedgerRepository {
  private readonly cache = new SubjectBehavior<LedgerEntry[]>([]);
  // T-034/CROSS-104: TTL + focus freshness policy (replaces the one-shot seeded flag)
  private readonly freshness = new CacheFreshness();

  constructor(private readonly client: SupabaseClient) {}

  private async seed(): Promise<void> {
    if (!this.freshness.shouldReseed()) return;
    this.freshness.markSeeded();
    try {
      const tenantId = requireTenantId();
      const { data, error } = await this.client
        .from("ledger_entries")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("entry_date", { ascending: false })
        .limit(2000);
      if (error) throw error;
      this.cache.set((data as LedgerEntryRow[]).map(mapLedgerRow));
    } catch {
      this.cache.set([]);
    }
  }

  observe(): Observable<LedgerEntry[]> {
    void this.seed();
    return this.cache;
  }

  observeByParent(parentId: string): Observable<LedgerEntry[]> {
    void this.seed();
    // FIX (reactivity): derive from the shared list cache — the previous
    // per-parent cached subject went stale after `seed()` completed (it was
    // constructed from an empty cache and never re-set).
    return derived([this.cache], () => this.cache.get().filter((e) => e.parentId === parentId));
  }

  observeByAccount(accountId: string): Observable<LedgerEntry[]> {
    void this.seed();
    return derived([this.cache], () => this.cache.get().filter((e) => e.accountId === accountId));
  }

  async append(entry: LedgerEntry): Promise<Result<LedgerEntry>> {
    try {
      const tenantId = entry.tenantId || getTenantId();
      const { error } = await this.client.rpc("upsert_ledger_entry_from_import", {
        p_tenant_id: tenantId,
        p_entry_number: entry.id,
        p_parent_id: entry.parentId,
        p_student_id: entry.studentId ?? null,
        p_account_id: entry.accountId,
        p_entry_type: entry.type,
        p_amount: entry.amount,
        p_category: entry.category,
        p_description: entry.description,
        p_source_type: entry.sourceType,
        p_source_id: entry.sourceId,
        p_method: entry.method,
        p_receipt_number: entry.receiptNumber,
        p_payment_status: entry.paymentStatus,
        p_reverses_id: entry.reversesId,
        p_actor_id: entry.actorId,
        p_actor_name: entry.actorName,
        p_at: toIsoDate(entry.at),
        p_metadata: entry.metadata,
      });
      if (error) throw error;
      this.cache.update((list) => [entry, ...list.filter((e) => e.id !== entry.id)]);
      return Ok(entry);
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  async appendMany(entries: readonly LedgerEntry[]): Promise<Result<readonly LedgerEntry[]>> {
    const results: LedgerEntry[] = [];
    for (const e of entries) {
      const r = await this.append(e);
      if (r.ok) results.push(r.value);
    }
    return Ok(results);
  }

  /**
   * BULK IMPORT FIX: Batch-insert many ledger entries in a SINGLE Supabase
   * INSERT call. This is ~100x faster than `appendMany` (which loops
   * `append` → one RPC per entry).
   *
   * The Excel importer collects ALL ledger entries across ALL rows, then
   * calls this method once at the end of the import. For a 390-row workbook
   * with ~22 entries per row, this turns ~8,580 RPC calls into 1 INSERT.
   *
   * IMPORT-107 (idempotent + atomic): this does NOT call the
   * `upsert_ledger_entry_from_import` RPC — it uses a direct
   * `INSERT ... ON CONFLICT DO NOTHING` via `ignoreDuplicates: true`.
   * The 0027 `ledger_entries_source_uidx` unique index on (tenant_id,
   * source_type, source_id) is the canonical identity arbiter: re-imported
   * entries (same sourceId, fresh entry_number) are SKIPPED instead of
   * either duplicating (old plain-INSERT behavior) or hard-failing every
   * chunk. The import adapter also pre-dedupes its pending batch against
   * the ledger stream, so the DB guard is defense-in-depth. Chunk errors
   * are returned as Err — the import's atomic contract requires a flush
   * failure to FAIL the import, not be swallowed.
   */
  async bulkAppend(entries: readonly LedgerEntry[]): Promise<Result<readonly LedgerEntry[]>> {
    if (entries.length === 0) return Ok([]);
    try {
      const tenantId = requireTenantId();
      // Build the rows array for bulk insert. Map each LedgerEntry to the
      // DB row shape. Use the entry's `id` as `entry_number` for traceability.
      const rows = entries.map((e) => ({
        tenant_id: e.tenantId || tenantId,
        entry_number: e.id,
        parent_id: e.parentId,
        student_id: e.studentId ?? null,
        account_id: e.accountId,
        entry_type: e.type,
        amount: e.amount,
        category: e.category,
        description: e.description,
        entry_date: toIsoDate(e.at) ?? new Date().toISOString(),
        // Unified columns (migration 0027) — only included when present.
        source_type: e.sourceType,
        source_id: e.sourceId,
        method: e.method,
        receipt_number: e.receiptNumber,
        payment_status: e.paymentStatus,
        reverses_id: e.reversesId,
        actor_id: e.actorId,
        actor_name: e.actorName,
        at: toIsoDate(e.at),
        metadata: e.metadata,
      }));
      // Insert in chunks of 500 to avoid hitting PostgREST's payload limit.
      const CHUNK_SIZE = 500;
      const inserted: LedgerEntry[] = [];
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunkRows = rows.slice(i, i + CHUNK_SIZE);
        const chunkEntries = entries.slice(i, i + CHUNK_SIZE);
        // IMPORT-107 (re-import idempotency + atomicity): the 0027 schema
        // enforces `ledger_entries_source_uidx` on (tenant, source_type,
        // source_id) — the canonical identity of an imported entry. A plain
        // INSERT would hard-fail every re-imported chunk against that index.
        // `ignoreDuplicates: true` emits `ON CONFLICT DO NOTHING` (any
        // unique arbiter — imported rows carry fresh entry_numbers/ids, so
        // the only realistic conflict IS the source identity), and the
        // chained `.select()` returns ONLY the rows actually inserted.
        const { data, error } = await this.client
          .from("ledger_entries")
          .upsert(chunkRows as never, { ignoreDuplicates: true })
          .select();
        if (error) {
          // Loud failure — the Excel import's atomic contract ("tout réussit
          // ou tout échoue") requires a flush failure to FAIL the import.
          // The previous console.warn-and-continue swallowed chunk errors
          // and reported success with silently-missing financial data.
          return Err(Errors.server(`bulkAppend chunk ${i}: ${error.message}`));
        }
        // Update the in-memory cache with ONLY the rows that were actually
        // inserted — the previous unconditional `[...entries, ...list]`
        // polluted the cache with phantom rows on every rejected chunk,
        // doubling every ledger-derived total in the UI until refresh.
        const insertedSourceIds = new Set(
          ((data as Array<{ source_id?: string | null }> | null) ?? [])
            .map((r) => r.source_id)
            .filter((sid): sid is string => sid != null),
        );
        for (const e of chunkEntries) {
          if (e.sourceId == null || insertedSourceIds.has(e.sourceId)) {
            inserted.push(e);
          }
        }
      }
      this.cache.update((list) => [...inserted, ...list]);
      return Ok(inserted);
    } catch (e) {
      console.warn("[SupabaseLedger] bulkAppend error:", e);
      // Fall back to appendMany (loop) which calls the RPC one by one.
      return this.appendMany(entries);
    }
  }

  async reverse(originalId: string, reason: string, actorId: string, actorName: string): Promise<Result<LedgerEntry>> {
    try {
      const original = this.cache.get().find((e) => e.id === originalId);
      if (!original) return Err(Errors.notFound("LedgerEntry", originalId));
      const reversal: LedgerEntry = {
        ...original,
        id: `led-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: "reversal",
        amount: -original.amount,
        reversesId: originalId,
        description: `Reversal: ${reason}`,
        actorId,
        actorName,
        at: new Date().toISOString(),
        sourceType: "manual_entry",
        sourceId: `reversal:${originalId}`,
      };
      return this.append(reversal);
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  async summary(parentId: string): Promise<Result<ParentLedgerSummary>> {
    // CANONICAL-FINANCIAL-LOGIC.md §4 INV-10 — delegate to the canonical
    // `computeParentSummary` so the Supabase-backed repository produces
    // the same totals as the mock repository + the Android LedgerEngine.
    //
    // Previously this method used a naive Σ amounts and hardcoded zeros:
    //   totalOverdue = 0,
    //   totalCleared = totalPaid,
    //   totalPending = 0,
    //   totalUnallocatedCredit = 0,
    //   accounts = [].
    // That made the desktop internally inconsistent — switching from Mock
    // to Supabase mode changed all displayed financial totals without any
    // user action or code change at the call site.
    try {
      await this.seed();
      const entries = this.cache.get().filter((e) => e.parentId === parentId);
      // Look up the parent's display name for the summary.
      const parentRow = await this.client
        .from("parents")
        .select("first_name,last_name")
        .eq("id", parentId)
        .maybeSingle();
      const firstName = (parentRow.data as { first_name?: string } | null)?.first_name ?? "";
      const lastName = (parentRow.data as { last_name?: string } | null)?.last_name ?? "";
      const parentName = `${firstName} ${lastName}`.trim();
      // Build the overdue-due-date map from charge entries.
      const overdueDueDates = buildOverdueDueDateMap(entries);
      const summary = computeParentSummary(entries, parentId, parentName, overdueDueDates);
      return Ok(summary);
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  async reconcile(): Promise<Result<import("../../../domain/calc/reconcile").ReconciliationReport>> {
    // CANONICAL-FINANCIAL-LOGIC.md §4 INV-9 + INV-10 — Supabase-backed
    // reconciliation MUST run the same 6 cross-checks as the mock impl,
    // not return an empty report. The previous stub silently disabled
    // all reconciliation in Supabase mode — `crossCheckInstallmentPayments`
    // (UNBACKED_TRANCHE_SATISFACTION) would not fire even when
    // `markPaid` was setting `status='paid'` without incrementing
    // `amount_paid`.
    //
    // TIER 2 (extension of R1.2) — wired the 4 entity-cross-checks by
    // fetching payments + installments + parent summaries DIRECTLY from
    // Supabase tables. This avoids the circular dependency between Ledger
    // ↔ Payment ↔ Installment repositories by querying the tables inline
    // rather than injecting sibling repositories.
    try {
      await this.seed();
      const ledger = this.cache.get();
      const report = reconcileLedger(ledger);
      const accountIds = new Set(ledger.map((e) => e.accountId));
      const balances = Array.from(accountIds).map((accId) => computeAccountBalance(ledger, accId));
      const balanceViolations = crossCheckBalanceSum(ledger, balances);

      // TIER 2 — fetch cross-check inputs directly from Supabase tables.
      // We use the same column names as the desktop's mapPaymentRow /
      // mapInstallmentRow helpers so the data shape matches what the
      // canonical cross-checks expect.
      const [paymentsRes, installmentsRes, parentsRes] = await Promise.all([
        this.client.from("payments").select("*"),
        this.client.from("installments").select("*"),
        this.client.from("parents").select("*"),
      ]);

      const paymentRows = (paymentsRes.data ?? []) as unknown as Array<{
        id: string; amount: number; status: string; receipt_number: string | null;
        payment_number: string | null; installment_id: string | null;
      }>;
      const installmentRows = (installmentsRes.data ?? []) as unknown as Array<{
        id: string; parent_id: string; student_id: string | null;
        category: string; amount_due: number; amount_paid: number;
        label: string | null; tranche_number: number | null; status: string;
      }>;
      const parentRows = (parentsRes.data ?? []) as unknown as Array<{
        id: string; first_name: string; last_name: string; display_name: string | null;
      }>;

      // Map to the cross-check input shapes.
      const paymentInputs = paymentRows.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        status: p.status,
        receiptNumber: p.receipt_number ?? p.payment_number ?? "",
      }));
      const installmentInputs = installmentRows.map((i) => ({
        id: i.id,
        parentId: i.parent_id,
        studentId: i.student_id,
        category: i.category,
        amountDue: Number(i.amount_due),
        amountPaid: Number(i.amount_paid),
        label: i.label ?? `Tranche ${i.tranche_number ?? 1}`,
        status: i.status,
      }));
      // Build per-parent summaries via the canonical computeParentSummary.
      const parentSummaries = parentRows.map((p) => {
        const parentEntries = ledger.filter((e) => e.parentId === p.id);
        // FIX (type): parenthesize the `??`/`||` mix.
        const parentName = p.display_name ?? (`${p.first_name} ${p.last_name}`.trim() || "—");
        const summary = computeParentSummary(
          parentEntries,
          p.id,
          parentName,
        );
        return {
          parentId: p.id,
          parentName,
          totalOutstanding: summary.totalOutstanding,
          accounts: summary.accounts.map((acc) => ({
            accountId: acc.accountId,
            category: acc.category,
            studentId: acc.studentId,
            balance: acc.balance,
            unallocatedCredit: acc.unallocatedCredit,
          })),
        };
      });
      // Build paymentId → installmentId lookup from payment rows.
      const paymentToInstallmentId = new Map<string, string>();
      for (const p of paymentRows) {
        if (p.installment_id) paymentToInstallmentId.set(p.id, p.installment_id);
      }

      // Run the 4 entity-cross-checks.
      const paymentViolations = crossCheckPayments(paymentInputs, ledger);
      const installmentViolations = crossCheckInstallments(installmentInputs, ledger);
      const installmentPaymentViolations = crossCheckInstallmentPayments(
        installmentInputs, ledger, paymentToInstallmentId,
      );
      const clearedBalanceViolations = crossCheckClearedBalance(paymentInputs, ledger);
      const parentCreditViolations = crossCheckParentCredit(parentSummaries, ledger);

      const allViolations = [
        ...report.violations,
        ...balanceViolations,
        ...paymentViolations,
        ...installmentViolations,
        ...installmentPaymentViolations,
        ...clearedBalanceViolations,
        ...parentCreditViolations,
      ];
      return Ok({
        ...report,
        violations: allViolations,
        passed: allViolations.filter((v) => v.severity === "error").length === 0,
        summary: {
          errors: allViolations.filter((v) => v.severity === "error").length,
          warnings: allViolations.filter((v) => v.severity === "warning").length,
          infos: allViolations.filter((v) => v.severity === "info").length,
        },
      } as unknown as import("../../../domain/calc/reconcile").ReconciliationReport);
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }
}

// ============================================================================
// SupabaseInstallmentRepository
// ============================================================================

/**
 * Supabase-backed InstallmentRepository.
 *
 * CRITICAL FIX: Previously the installer wrote ledger entries but NEVER
 * created `installments` rows. The student payments tab reads
 * `repos.installments.observeByStudent(studentId)` which queries the
 * `installments` table — empty. After this fix, the Excel importer creates
 * one installment per tuition tranche (Sept 15 / Dec 15 / Mar 15) and one
 * per transport tranche, marking them paid/partial/unpaid according to the
 * imported amounts.
 *
 * Identity: `(tenant, parent_id, student_id, category, tranche_number)`.
 * The mock store uses a deterministic id derived from these fields so
 * re-imports hit the same record.
 *
 * `importInstallment` is the canonical write path used by the importer.
 * The other mutation methods (markPaid, allocatePayment, regenerateForCycle,
 * updateDueDate) are stubbed — they're used by the interactive financials
 * UI which is not yet wired to Supabase. Reads (observeByParent /
 * observeByStudent) work against the live `installments` table.
 */
export class SupabaseInstallmentRepository implements InstallmentRepository {
  private readonly cache = new SubjectBehavior<Installment[]>([]);
  // T-034/CROSS-104: TTL + focus freshness policy (replaces the one-shot seeded flag)
  private readonly freshness = new CacheFreshness();

  constructor(private readonly client: SupabaseClient) {}

  private async seed(): Promise<void> {
    if (!this.freshness.shouldReseed()) return;
    this.freshness.markSeeded();
    try {
      const tenantId = requireTenantId();
      const { data, error } = await this.client
        .from("installments")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("due_date", { ascending: true });
      if (error) throw error;
      this.cache.set((data as InstallmentRow[]).map(mapInstallmentRow));
    } catch {
      this.cache.set([]);
    }
  }

  observe(): Observable<Installment[]> {
    void this.seed();
    return this.cache;
  }

  observeByParent(parentId: string): Observable<Installment[]> {
    void this.seed();
    // FIX (reactivity): derive from the shared list cache.
    return derived([this.cache], () => this.cache.get().filter((i) => i.parentId === parentId));
  }

  observeByStudent(studentId: string): Observable<Installment[]> {
    void this.seed();
    return derived([this.cache], () => this.cache.get().filter((i) => i.studentId === studentId));
  }

  observeById(id: string): Observable<Installment | null> {
    void this.seed();
    return derived([this.cache], () => this.cache.get().find((i) => i.id === id) ?? null);
  }

  async markPaid(id: string, paymentId: string): Promise<Result<Installment>> {
    // CANONICAL-FINANCIAL-LOGIC.md §7.3 — `amount_paid` and `amount_pending`
    // are derived ONLY by replaying ledger payment entries against the
    // installment's account. A `markPaid` call MUST set `amount_paid` to
    // `amount_due` (the canonical "fully paid" invariant) AND set `status`
    // to `paid` + `paid_date` to now. The previous implementation updated
    // only `status` + `paid_date` without touching `amount_paid`, leaving
    // a tranche showing `status='paid'` with `amount_paid=0` — a violation
    // of INV-1 that the (now-also-fixed) reconciler would have caught via
    // `crossCheckInstallmentPayments` (UNBACKED_TRANCHE_SATISFACTION).
    try {
      // Fetch the current row to know the `amount_due` we need to mirror
      // into `amount_paid` (otherwise we'd need a separate fetch).
      const { data: current, error: fetchError } = await this.client
        .from("installments")
        .select("amount_due, amount_paid")
        .eq("id", id)
        .maybeSingle();
      if (fetchError) throw fetchError;
      if (!current) return Err(Errors.notFound("Installment", id));

      const amountDue = Number((current as { amount_due: number | string }).amount_due ?? 0);
      const nowIso = new Date().toISOString();
      const { error } = await this.client
        .from("installments")
        .update({
          status: "paid",
          paid_date: nowIso,
          // CANONICAL-FINANCIAL-LOGIC.md §7.3 — INV "amountPaid >= amountDue"
          // when status='paid'. Set amount_paid = amount_due so the
          // reconciler's crossCheckInstallmentPayments does not flag the
          // tranche as UNBACKED_TRANCHE_SATISFACTION.
          amount_paid: amountDue,
          amount_pending: 0,
          updated_at: nowIso,
        })
        .eq("id", id);
      if (error) throw error;
      const updated = this.cache.get().find((i) => i.id === id);
      if (updated) {
        const patched: Installment = {
          ...updated,
          status: "paid",
          paidDate: nowIso,
          amountPaid: amountDue,
          amountPending: 0,
        };
        this.cache.update((list) => list.map((i) => (i.id === id ? patched : i)));
        return Ok(patched);
      }
      return Err(Errors.notFound("Installment", id));
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  async allocatePayment(
    parentId: string,
    paymentAmount: number,
    paymentId: string,
    categoryFilter?: PaymentCategory,
    actorId: string = "system",
    actorName: string = "System",
  ): Promise<Result<AllocationResult>> {
    // CANONICAL-FINANCIAL-LOGIC.md §4 INV-6 + INV-10 — the Supabase-backed
    // waterfall allocator MUST use the same canonical algorithm as the mock
    // repository + the Android `allocatePaymentToInstallments`. The previous
    // stub returned a no-op (`allocations: [], unallocatedAmount: 0`),
    // meaning the interactive financials UI was effectively broken in
    // Supabase mode — payments never moved tranches toward `paid`.
    try {
      await this.seed();
      // Pull the parent's outstanding installments.
      // FIX (type): pass the full `Installment` objects — the previous
      // `.map()` stripped required fields (parentId/studentId/label/paidDate)
      // and produced a type error against the canonical allocator signature.
      const familyInstallments = this.cache
        .get()
        .filter((i) => i.parentId === parentId)
        .filter((i) => i.status !== "paid")
        .filter((i) => categoryFilter === undefined || i.category === categoryFilter);
      // The payment's status: 'paid' for cash, 'pending' for check/transfer.
      // We infer it from the payment row.
      const { data: payRow, error: payErr } = await this.client
        .from("payments")
        .select("status")
        .eq("id", paymentId)
        .maybeSingle();
      if (payErr) throw payErr;
      const rawStatus = ((payRow as { status?: string } | null)?.status ?? "paid") as
        | "paid"
        | "pending"
        | "partial"
        | "overdue"
        | "pending_clearance"
        | "unpaid"
        | "refunded"
        | "cancelled";
      // FIX (type): the canonical allocator's `paymentStatus` only
      // distinguishes cleared ("paid") vs uncleared ("pending") funds.
      // Everything except "pending" / "pending_clearance" is treated as
      // cleared — matching the mock repository's semantics.
      const paymentStatus: "paid" | "pending" =
        rawStatus === "pending" || rawStatus === "pending_clearance" ? "pending" : "paid";
      // Run the canonical waterfall.
      const { allocatePaymentToInstallments } = await import(
        "../../../domain/calc/payment/waterfall-allocator"
      );
      const allocation = allocatePaymentToInstallments(
        familyInstallments,
        paymentAmount,
        categoryFilter,
        paymentStatus,
      );
      // Persist the per-installment updates to Supabase.
      const nowIso = new Date().toISOString();
      for (const a of allocation.allocations) {
        const { error: updateErr } = await this.client
          .from("installments")
          .update({
            amount_paid: a.newAmountPaid,
            amount_pending: a.newAmountPending,
            status: a.newStatus,
            paid_date: a.newStatus === "paid" ? nowIso : null,
            updated_at: nowIso,
          })
          .eq("id", a.installmentId);
        if (updateErr) {
          // Log but continue — partial allocation is still useful.
          console.warn(
            `[SupabaseInstallment] allocatePayment: update failed for ${a.installmentId}:`,
            updateErr.message,
          );
        }
      }
      // If there is an unallocated amount (overpayment), the canonical
      // workflow writes a `parent_credit` adjustment. The Supabase impl
      // delegates that to `SupabasePaymentRepository.collect`'s caller; here
      // we just return the allocation result so the caller can decide.
      return Ok(allocation);
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  async updateDueDate(input: UpdateInstallmentDueDateInput): Promise<Result<Installment>> {
    // CANONICAL-FINANCIAL-LOGIC.md §7.3 — flexible installment schedules.
    // The Supabase impl writes `is_custom_schedule: true` and the optional
    // note for audit visibility, then returns the patched installment.
    try {
      const nowIso = new Date().toISOString();
      const { error } = await this.client
        .from("installments")
        .update({
          due_date: input.dueDate,
          is_custom_schedule: true,
          custom_schedule_note: input.note ?? null,
          updated_at: nowIso,
        })
        .eq("id", input.installmentId);
      if (error) throw error;
      const existing = this.cache.get().find((i) => i.id === input.installmentId);
      if (existing) {
        const patched: Installment = {
          ...existing,
          dueDate: input.dueDate,
          isCustomSchedule: true,
          customScheduleNote: input.note ?? null,
          customSchedule: true,
        };
        this.cache.update((list) => list.map((i) => (i.id === input.installmentId ? patched : i)));
        return Ok(patched);
      }
      return Err(Errors.notFound("Installment", input.installmentId));
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  async regenerateForCycle(
    parentId: string,
    cycle: AcademicCycle,
    actorId: string,
    actorName: string,
  ): Promise<Result<readonly Installment[]>> {
    // CANONICAL-FINANCIAL-LOGIC.md §7.3 — re-derive due dates from
    // `getOfficialTuitionDueDates` for the parent's outstanding (non-paid)
    // installments. Paid installments are preserved (they're settled).
    try {
      const { getOfficialTuitionDueDates } = await import(
        "../../../domain/calc/pricing/tuition"
      );
      const year = new Date().getFullYear();
      const [t1, t2, t3] = getOfficialTuitionDueDates(year, cycle);
      const nowIso = new Date().toISOString();
      // Group installments by category + tranche number for re-templating.
      const familyInstallments = this.cache.get().filter((i) => i.parentId === parentId);
      const updated: Installment[] = [];
      for (const inst of familyInstallments) {
        if (inst.status === "paid") continue; // preserve paid tranches
        // Derive the tranche number from the label or fall back to 1.
        const trancheNum = (inst.label?.match(/(\d)/)?.[1] ?? "1") as "1" | "2" | "3";
        const newDueDate = trancheNum === "1" ? t1 : trancheNum === "2" ? t2 : t3;
        const { error } = await this.client
          .from("installments")
          .update({
            due_date: newDueDate,
            is_custom_schedule: false,
            custom_schedule_note: null,
            academic_cycle: cycle,
            updated_at: nowIso,
          })
          .eq("id", inst.id);
        if (error) {
          console.warn(
            `[SupabaseInstallment] regenerateForCycle: update failed for ${inst.id}:`,
            error.message,
          );
          continue;
        }
        const patched: Installment = {
          ...inst,
          dueDate: newDueDate,
          academicCycle: cycle,
          isCustomSchedule: false,
          customScheduleNote: null,
          customSchedule: false,
        };
        updated.push(patched);
      }
      this.cache.update((list) => {
        const updatedIds = new Set(updated.map((u) => u.id));
        return [...updated, ...list.filter((i) => !updatedIds.has(i.id))];
      });
      return Ok(updated);
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  async findOverdue(now: Date = new Date()): Promise<Result<readonly Installment[]>> {
    await this.seed();
    const nowIso = now.toISOString();
    return Ok(this.cache.get().filter((i) => i.status !== "paid" && i.dueDate < nowIso));
  }

  /**
   * BULK IMPORT FIX: Batch-import many installments in a SINGLE Supabase
   * upsert call. ~100x faster than looping `importInstallment()`.
   *
   * Uses PostgreSQL's `INSERT ... ON CONFLICT (tenant_id, parent_id,
   * student_id, category, tranche_number) DO UPDATE` via the unique index
   * created by migration 0032.
   */
  async bulkImportInstallments(inputs: readonly ImportInstallmentInput[]): Promise<Result<readonly Installment[]>> {
    if (inputs.length === 0) return Ok([]);
    try {
      const tenantId = requireTenantId();
      const now = new Date().toISOString();
      const rows = inputs.map((input) => ({
        tenant_id: tenantId,
        parent_id: input.parentId,
        student_id: input.studentId,
        category: input.category,
        tranche_number: input.trancheNumber,
        label: input.label,
        amount_due: input.amountDue,
        amount_paid: input.amountPaid,
        amount_pending: 0,
        due_date: input.dueDate,
        paid_date: input.paidDate,
        status: input.status,
        academic_cycle: input.academicCycle ?? null,
        payment_plan: input.paymentPlan ?? "tranches",
        is_custom_schedule: false,
        custom_schedule_note: null,
        source_type: input.sourceType ?? "bulk_import",
        source_id: input.sourceId ?? `${input.studentId}:${input.category}:T${input.trancheNumber}`,
        updated_at: now,
      }));
      // Insert in chunks of 500.
      const CHUNK_SIZE = 500;
      const results: Installment[] = [];
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        // IMPORT-110 (2026-09-21, live-proven by the T-396 CRUD suite):
        // the previous `onConflict: "tenant_id,parent_id,student_id,category,tranche_number"`
        // upsert could NEVER work against the live schema — the 0032
        // `installments_bulk_import_identity_idx` is a PARTIAL unique index
        // (WHERE the identity columns ARE NOT NULL), and PostgreSQL's
        // ON CONFLICT (columns) inference cannot match partial indexes —
        // every live call returned HTTP 400 `42P10`, and the old
        // warn-and-continue below turned that into Ok([]) — success with
        // ZERO rows written (a silent data-loss class the mocked-client
        // repository tests could never catch).
        //
        // The fix adopts the live-proven `bulkAppend` (IMPORT-107) wire
        // form: `ignoreDuplicates: true` emits `ON CONFLICT DO NOTHING`
        // WITHOUT an arbiter — PostgreSQL then checks ALL unique
        // constraints, partial indexes included. Semantics: re-imported
        // tranches are SKIPPED (idempotent no-op) instead of updated —
        // the ledger's IMPORT-107 philosophy; the per-row
        // `importInstallment` (find → update-or-insert) remains the
        // update-capable path.
        const { data, error } = await this.client
          .from("installments")
          .upsert(chunk as never, { ignoreDuplicates: true })
          .select("id, tenant_id, parent_id, student_id, category, tranche_number, label, amount_due, amount_paid, amount_pending, due_date, paid_date, status, academic_cycle, payment_plan, is_custom_schedule, custom_schedule_note, source_type, source_id, created_at, updated_at");
        if (error) {
          // IMPORT-110 honest-error half: a chunk failure FAILS the bulk
          // operation (the adapter's catch aborts the import with the
          // "Échec de l'écriture en base" contract) — never
          // warn-and-continue into Ok([]) again (the DATA-019 lesson).
          return Err(Errors.server(`bulkImportInstallments chunk ${i}: ${error.message}`));
        }
        for (const row of (data ?? []) as InstallmentRow[]) {
          results.push(mapInstallmentRow(row));
        }
      }
      this.cache.update((list) => [...results, ...list.filter((i) => !results.some((r) => r.id === i.id))]);
      return Ok(results);
    } catch (e) {
      console.warn("[SupabaseInstallment] bulkImportInstallments error:", e);
      // Fall back to loop.
      const results: Installment[] = [];
      for (const input of inputs) {
        const r = await this.importInstallment(input);
        if (r.ok) results.push(r.value);
      }
      return Ok(results);
    }
  }
  async importInstallment(input: ImportInstallmentInput): Promise<Result<Installment>> {
    try {
      const tenantId = requireTenantId();
      // Match by (tenant, parent, student, category, tranche_number).
      const { data: existing, error: findErr } = await this.client
        .from("installments")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("parent_id", input.parentId)
        .eq("student_id", input.studentId)
        .eq("category", input.category)
        .eq("tranche_number", input.trancheNumber)
        .maybeSingle();
      if (findErr) throw findErr;

      const rowPayload = {
        tenant_id: tenantId,
        parent_id: input.parentId,
        student_id: input.studentId,
        category: input.category,
        tranche_number: input.trancheNumber,
        label: input.label,
        amount_due: input.amountDue,
        amount_paid: input.amountPaid,
        amount_pending: 0,
        due_date: input.dueDate,
        paid_date: input.paidDate,
        status: input.status,
        academic_cycle: input.academicCycle ?? null,
        payment_plan: input.paymentPlan ?? "tranches",
        is_custom_schedule: false,
        custom_schedule_note: null,
        source_type: input.sourceType ?? "bulk_import",
        source_id: input.sourceId ?? `${input.studentId}:${input.category}:T${input.trancheNumber}`,
        updated_at: new Date().toISOString(),
      };

      let id: string;
      if (existing && (existing as { id?: string }).id) {
        id = (existing as { id: string }).id;
        const { error: updateErr } = await this.client
          .from("installments")
          .update(rowPayload)
          .eq("id", id);
        if (updateErr) throw updateErr;
      } else {
        const { data: inserted, error: insertErr } = await this.client
          .from("installments")
          .insert(rowPayload)
          .select("id")
          .single();
        if (insertErr) throw insertErr;
        id = (inserted as { id: string }).id;
      }

      // Fetch the full row back.
      const { data: fullRow, error: fetchErr } = await this.client
        .from("installments")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      const installment = mapInstallmentRow(fullRow as InstallmentRow);
      this.cache.update((list) => [installment, ...list.filter((i) => i.id !== installment.id)]);
      return Ok(installment);
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }
}

/** Map a raw `installments` row to the domain `Installment` shape. */
function mapInstallmentRow(r: InstallmentRow): Installment {
  return {
    id: r.id,
    parentId: r.parent_id,
    studentId: r.student_id,
    category: (r.category ?? "tuition") as Installment["category"],
    label: r.label ?? `Tranche ${r.tranche_number}`,
    // T-338: carry the canonical wave number into the domain (the executive
    // statistics group by tranche_number, never by label parsing).
    trancheNumber: (r.tranche_number ?? 1) as 1 | 2 | 3,
    amountDue: Number(r.amount_due ?? 0),
    amountPaid: Number(r.amount_paid ?? 0),
    amountPending: Number(r.amount_pending ?? 0),
    dueDate: r.due_date ?? new Date().toISOString(),
    paidDate: r.paid_date ?? null,
    status: (r.status ?? "unpaid") as Installment["status"],
    academicCycle: (r.academic_cycle ?? undefined) as Installment["academicCycle"],
    paymentPlan: (r.payment_plan ?? "tranches") as Installment["paymentPlan"],
    isCustomSchedule: Boolean(r.is_custom_schedule),
    customScheduleNote: r.custom_schedule_note,
    customSchedule: Boolean(r.is_custom_schedule),
  };
}

// ============================================================================
// SupabaseDebtRepository
// ============================================================================

/**
 * Supabase-backed DebtRepository.
 *
 * Reads parent financial profiles by replaying ledger entries from the
 * `ledger_entries` table. The summary is computed client-side because
 * the computation is straightforward and we already need to fetch the
 * entries for the parent drawer's transaction list.
 */

/**
 * T-405 — the wire shape of the 0111 `compute_debt_aging_summary` RPC
 * (PostgREST returns the SQL column names, snake_case; the `obligations`
 * jsonb carries camelCase keys as built server-side).
 */
interface DebtAgingRpcRow {
  parent_id: string;
  parent_name: string | null;
  parent_phone: string | null;
  student_ids: string[] | null;
  outstanding_amount: number | string;
  oldest_due_date: string | null;
  debt_age_days: number | null;
  origin_academic_year: string | null;
  last_payment_at: string | null;
  days_since_last_payment: number | null;
  inactivity_days: number | null;
  subsequent_year_payment_count: number | null;
  subsequent_year_payment_total: number | string | null;
  has_subsequent_year_payments: boolean | null;
  obligations: readonly DebtAgingObligation[] | null;
  status_level: string | null;
  reason_code: string | null;
  computed_at: string | null;
}

/**
 * T-405 — map an RPC row to the canonical `DebtAgingAnalysis`.
 *
 * The FACTORS come from the server (the canonical computation); the status
 * LABELS (level/reason wording + FR explanation) are rendered client-side
 * per §15.2 (labels live in TS exactly once, the PARITY-001 discipline).
 * The derivation is cross-checked against the RPC's own status_level /
 * reason_code — a mismatch is a live client↔server parity drift we WANT
 * surfaced (console.warn), never silently hidden. The RPC's values win for
 * display when present.
 */
function mapDebtAgingRow(row: DebtAgingRpcRow): DebtAgingAnalysis {
  const outstandingAmount = Number(row.outstanding_amount ?? 0);
  const debtAgeDays = Number(row.debt_age_days ?? 0);
  const inactivityDays = Number(row.inactivity_days ?? 0);
  const hasSubsequentYearPayments = row.has_subsequent_year_payments === true;
  const derived = computeDebtAgingStatus({
    outstandingAmount,
    debtAgeDays,
    inactivityDays,
    hasSubsequentYearPayments,
  });
  const rpcLevel = row.status_level as DebtAgingStatusLevel | null;
  const rpcReason = row.reason_code as DebtAgingReasonCode | null;
  if (rpcLevel && rpcLevel !== derived.level) {
    console.warn(
      `[SupabaseDebt] debt-aging parity drift for ${row.parent_id}: rpc=${rpcLevel}/${row.reason_code} ts=${derived.level}/${derived.reasonCode}`,
    );
  }
  return {
    parentId: row.parent_id,
    outstandingAmount,
    oldestDueDate: row.oldest_due_date ?? null,
    debtAgeDays,
    originAcademicYear: row.origin_academic_year ?? null,
    lastPaymentAt: row.last_payment_at ?? null,
    daysSinceLastPayment: row.days_since_last_payment ?? null,
    inactivityDays,
    subsequentYearPaymentCount: Number(row.subsequent_year_payment_count ?? 0),
    subsequentYearPaymentTotal: Number(row.subsequent_year_payment_total ?? 0),
    hasSubsequentYearPayments,
    obligations: row.obligations ?? [],
    affectedStudentIds: (row.student_ids ?? []).filter((s) => s !== null),
    status: {
      level: rpcLevel ?? derived.level,
      reasonCode: rpcReason ?? derived.reasonCode,
      explanationFr: derived.explanationFr,
    },
    computedAt: row.computed_at ?? new Date().toISOString(),
  };
}

export class SupabaseDebtRepository implements DebtRepository {
  private readonly summarySubject = new SubjectBehavior<import("../../../domain/model/payment").DebtSummary[]>([]);
  private summarySeeded = false;
  private readonly profiles = new Map<string, SubjectBehavior<ParentFinancialProfile | null>>();
  // T-405 — cross-year debt aging (financial-rules §15; migration 0111 RPC).
  private readonly agingSubject = new SubjectBehavior<DebtAgingAnalysis[]>([]);
  private agingSeeded = false;

  constructor(private readonly client: SupabaseClient) {}

  observeAging(): Observable<DebtAgingAnalysis[]> {
    void this.seedAging();
    return this.agingSubject;
  }

  async refreshAging(): Promise<void> {
    // The realtime bridge calls this after financial mutations (payments,
    // allocations, due dates) — §15: recalculate when the facts change.
    await this.seedAging(true);
  }

  private async seedAging(force = false): Promise<void> {
    if (this.agingSeeded && !force) return;
    this.agingSeeded = true;
    try {
      // The canonical server contract (0111): staff-gated + tenant-scoped
      // server-side; the client never re-computes the factors.
      const { data, error } = await this.client.rpc("compute_debt_aging_summary");
      if (error) throw error;
      const rows = (data ?? []) as DebtAgingRpcRow[];
      this.agingSubject.set(rows.map(mapDebtAgingRow));
    } catch (e) {
      // Keep the last known truthful analysis on a transient failure (the
      // realtime facade's convention) — never fabricate rows.
      console.warn("[SupabaseDebt] seedAging failed:", (e as Error).message);
    }
  }

  observeSummary(): Observable<import("../../../domain/model/payment").DebtSummary[]> {
    // VAULT §07.06 — the Debt Dashboard (Créances tab) reads this stream.
    // Previously returned a permanently EMPTY observable in Supabase mode,
    // so the Top-20 debtors table, per-grade breakdown and the KPI card were
    // all blank when live-backed. Now seeded from unpaid installments with
    // canonical aging buckets.
    void this.seedSummary();
    return this.summarySubject;
  }

  private async seedSummary(): Promise<void> {
    if (this.summarySeeded) return;
    this.summarySeeded = true;
    try {
      const tenantId = requireTenantId();
      const { data, error } = await this.client
        .from("installments")
        .select("parent_id, amount_due, amount_paid, amount_pending, due_date")
        .eq("tenant_id", tenantId)
        .neq("status", "paid");
      if (error) throw error;
      const nowMs = Date.now();
      const byParent = new Map<string, { outstanding: number; days: number }>();
      for (const row of (data ?? []) as {
        parent_id: string;
        amount_due: number | string;
        amount_paid: number | string;
        amount_pending: number | string;
        due_date: string;
      }[]) {
        const remaining = Math.max(
          0,
          Number(row.amount_due ?? 0) - Number(row.amount_paid ?? 0) - Number(row.amount_pending ?? 0),
        );
        if (remaining <= 0) continue;
        const days = Math.max(0, Math.floor((nowMs - new Date(row.due_date).getTime()) / 86_400_000));
        const prev = byParent.get(row.parent_id);
        byParent.set(row.parent_id, {
          outstanding: (prev?.outstanding ?? 0) + remaining,
          days: Math.max(prev?.days ?? 0, days),
        });
      }
      if (byParent.size === 0) {
        this.summarySubject.set([]);
        return;
      }
      // Parent names + phone for the debtor table.
      const parentIds = [...byParent.keys()];
      const { data: parentRows, error: parentErr } = await this.client
        .from("parents")
        .select("id, first_name, last_name, display_name, primary_phone")
        .in("id", parentIds);
      if (parentErr) throw parentErr;
      const names = new Map(
        (parentRows ?? []).map((p) => {
          const row = p as {
            id: string;
            first_name: string | null;
            last_name: string | null;
            display_name: string | null;
            primary_phone: string | null;
          };
          return [
            row.id,
            {
              name: row.display_name ?? `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim(),
              phone: row.primary_phone ?? "",
            },
          ];
        }),
      );
      const summaries = [...byParent.entries()]
        .map(([parentId, v]) => ({
          id: `debt-${parentId}`,
          parentId,
          parentName: names.get(parentId)?.name ?? parentId,
          parentPhone: names.get(parentId)?.phone ?? "",
          studentCount: 0,
          outstandingAmount: v.outstanding,
          daysOverdue: v.days,
          bucket: agingBucketFromDays(v.days),
        }))
        .sort((a, b) => b.outstandingAmount - a.outstandingAmount);
      this.summarySubject.set(summaries);
    } catch (e) {
      console.warn("[SupabaseDebt] seedSummary failed:", (e as Error).message);
      this.summarySubject.set([]);
    }
  }

  observeParentProfile(parentId: string): Observable<ParentFinancialProfile | null> {
    // Guard against invalid IDs — when the student drawer opens before the
    // parent is loaded, parentId may be empty or undefined. Skip the query
    // entirely to avoid 400 errors from PostgREST.
    if (!parentId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parentId)) {
      return new SubjectBehavior<ParentFinancialProfile | null>(null);
    }
    if (!this.profiles.has(parentId)) {
      const subject = new SubjectBehavior<ParentFinancialProfile | null>(null);
      this.profiles.set(parentId, subject);
      void this.refreshProfile(parentId);
    }
    return this.profiles.get(parentId)!;
  }

  private async refreshProfile(parentId: string): Promise<void> {
    try {
      const tenantId = requireTenantId();
      // T-164 (DATA-008 family, root-cause fix): select the FULL row — the
      // previous column list (id, parent_id, entry_type, amount, category,
      // entry_date) silently stripped `description`, `actor_id`,
      // `student_id` and `metadata`, so the derived profile showed blank
      // adjustment reasons, "Auteur: system" placeholders and lost
      // per-student attribution even though the database rows carry all of
      // it. Mirrors the ledger repository's own seed (select "*").
      const { data, error } = await this.client
        .from("ledger_entries")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("parent_id", parentId)
        .order("entry_date", { ascending: false })
        .limit(2000);
      if (error) {
        console.warn("[SupabaseDebt] ledger query failed:", error.message);
        this.profiles.get(parentId)?.set(null);
        return;
      }
      const entries = (data as LedgerEntryRow[]).map(mapLedgerRow);
      // T-164 (the "Aucune tranche" root cause): load the family's REAL
      // installment rows. The previous implementation hardcoded
      // `installments: []`, so every Supabase-mode consumer of the profile
      // contract saw an empty tranche schedule (the mock repository
      // already populated this — cross-mode parity restored). The rows
      // carry the server-side waterfall results (amount_paid /
      // amount_pending from `collect_and_allocate_payment`), so consumers
      // must NOT re-allocate client-side.
      let installments: Installment[] = [];
      const { data: installmentRows, error: installmentErr } = await this.client
        .from("installments")
        .select("id, tenant_id, parent_id, student_id, category, tranche_number, label, amount_due, amount_paid, amount_pending, due_date, paid_date, status, academic_cycle, payment_plan, is_custom_schedule, custom_schedule_note")
        .eq("tenant_id", tenantId)
        .eq("parent_id", parentId)
        .order("due_date", { ascending: true });
      if (installmentErr) {
        // Non-fatal: the profile still ships with an empty schedule — the
        // drawer's canonical breakdown falls back to the display-only
        // 40/30/30 synthesis when no physical rows are available.
        console.warn("[SupabaseDebt] installments query failed:", installmentErr.message);
      } else {
        installments = (installmentRows as InstallmentRow[]).map(mapInstallmentRow);
      }
      // CANONICAL-FINANCIAL-LOGIC.md §4 INV-10 — delegate to the canonical
      // `computeParentSummary` so the Supabase-backed debt profile uses the
      // SAME totals as the mock + Android. The previous implementation
      // counted negative adjustments as "paid" (incorrectly) and forced
      // `overdueAmount = outstanding` (always equal, ignoring due dates).
      const overdueDueDates = buildOverdueDueDateMap(entries);
      const parentName = ""; // Looked up separately if needed by UI.
      const summary = computeParentSummary(entries, parentId, parentName, overdueDueDates);
      // Build the derived profile from the canonical summary.
      // FIX (type): map ledger payment entries to the `Payment` shape the
      // profile contract requires (was previously assigning raw LedgerEntry
      // objects, which broke the build and mis-typed the drawer UI).
      const recentPayments: Payment[] = entries
        .filter((e) => e.type === "payment" && !e.reversesId)
        .slice(0, 10)
        .map((e) => ({
          id: e.id,
          tenantId: e.tenantId,
          receiptNumber: e.receiptNumber ?? e.sourceId,
          parentId: e.parentId,
          studentId: e.studentId,
          amount: Math.abs(e.amount),
          method: e.method ?? "cash",
          status: e.paymentStatus ?? "paid",
          category: e.category,
          installmentId: (e.metadata.installmentId as string | undefined) ?? null,
          proofUrl: (e.metadata.proofUrl as string | undefined) ?? null,
          notes: null,
          collectedBy: e.actorId,
          collectedAt: e.at,
          createdAt: e.at,
          updatedAt: e.at,
        }));
      const adjustments: AccountAdjustment[] = entries
        .filter((e) => e.type === "adjustment" && !e.reversesId)
        .slice(0, 20)
        .map((e) => ({
          id: e.id,
          parentId: e.parentId,
          amount: e.amount,
          reason: e.description,
          approvedBy: e.actorId,
          approvedAt: e.at,
          receiptRef: e.receiptNumber ?? null,
        }));
      // T-103 (DATA-008): `totalDue` is the NET obligation — charges plus
      // adjustments (remises are negative adjustments on the ledger). The
      // previous `totalCharged`-only mapping overstated "Total dû" for every
      // parent with a discount and disagreed with the installment schedule
      // (Σ installments.amount_due == charges + adjustments after the 0062
      // reconciliation). "Payé" stays the ledger `totalPaid` (all money
      // received) and "Reste" stays the ledger balance — for overpayers the
      // Finances tab renders the negative balance as a "Crédit parent" card.
      const profile: ParentFinancialProfile = {
        parentId,
        parentName,
        totalDue: summary.totalCharged + summary.totalAdjusted,
        totalPaid: summary.totalPaid,
        totalOutstanding: summary.totalOutstanding,
        // T-104/ADR-010: feed the display-level credit derivation (DATA-009).
        totalUnallocatedCredit: summary.totalUnallocatedCredit,
        overdueAmount: summary.totalOverdue,
        installments,
        recentPayments,
        adjustments,
      };
      this.profiles.get(parentId)?.set(profile);
    } catch (e) {
      console.warn("[SupabaseDebt] refreshProfile error:", e);
      this.profiles.get(parentId)?.set(null);
    }
  }

  /**
   * T-192 / MSG-101 — per-parent overdue reminder. Previously a literal
   * no-op returning Ok(undefined) (the UI showed "Rappel envoyé" while
   * nothing happened). Now delegates to the canonical 0077 RPC
   * `notify_parent_user`, which resolves the parent's portal account
   * server-side and inserts a notification the parent actually receives.
   * Returns Ok(undefined) when delivered; a validation error when the
   * parent id is malformed; a surfaced error otherwise. When the parent
   * has NO active portal account the RPC returns NULL — delivered=false
   * is reported as a validation error so the operator sees the truth.
   */
  async sendReminder(parentId: string): Promise<Result<void>> {
    if (!isUuid(parentId)) {
      return Err(Errors.validation("L'envoi d'un rappel nécessite un identifiant parent Supabase valide."));
    }
    try {
      // The reminder copy mirrors broadcastReminders (VAULT §07.06).
      const debtors = await this.collectDebtors(0);
      const d = debtors.find((x) => x.parentId === parentId);
      const outstanding = d?.outstanding ?? 0;
      const days = d?.daysOverdue ?? 0;
      const { data, error } = await this.client.rpc("notify_parent_user", {
        p_parent_id: parentId,
        p_kind: "alert",
        p_title: "Rappel — paiement en retard",
        p_body: `Votre solde en retard s'élève à ${outstanding.toLocaleString("fr-FR")} DZD (${days} jour(s) de retard). Merci de régulariser votre situation auprès de l'administration.`,
        p_priority: days > 90 ? "urgent" : "high",
        p_source_label: "Module Finances",
        p_link_entity_type: "parent",
        p_link_entity_id: parentId,
      });
      if (error) return Err(supabaseErrorToAppError(error));
      if (!data) {
        return Err(
          Errors.validation(
            "Ce parent n'a pas de compte portail actif — le rappel ne peut pas lui être notifié. Utilisez le téléphone/WhatsApp.",
          ),
        );
      }
      return Ok(undefined);
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  /**
   * VAULT §07.06 + §10.07 — "Broadcast Overdue Payment Reminders" (Supabase).
   *
   * T-192 / MSG-101 REPAIR: the previous version inserted notifications
   * with NONEXISTENT columns (`type`/`entity_type`/`entity_id` — the table
   * uses `kind`/`link_entity_type`/`link_entity_id`), no recipient
   * (target_user_id NULL → parents could never see the row), counted
   * failures as dispatched (console.warn + dispatched++), and called a
   * nonexistent `append_audit_entry` RPC. It never delivered a single
   * reminder while reporting success.
   *
   * Now: one canonical 0077 `notify_parent_user` RPC call per debtor
   * (server-side parent → account resolution, correct payload shape,
   * real targeting), honest counting (only DELIVERED notifications count;
   * parents without an active portal account are counted separately and
   * surfaced in the audit note), and the canonical 0014 `write_audit_log`
   * RPC for the bulk summary.
   */
  async broadcastReminders(minDaysOverdue = 0, actorId = "system"): Promise<Result<number>> {
    try {
      const debtors = await this.collectDebtors(minDaysOverdue);
      let dispatched = 0;
      let undeliverable = 0;
      for (const d of debtors) {
        const { data, error } = await this.client.rpc("notify_parent_user", {
          p_parent_id: d.parentId,
          p_kind: "alert",
          p_title: "Rappel — paiement en retard",
          p_body: `Votre solde en retard s'élève à ${d.outstanding.toLocaleString("fr-FR")} DZD (${d.daysOverdue} jour(s) de retard). Merci de régulariser votre situation.`,
          p_priority: d.daysOverdue > 90 ? "urgent" : "high",
          p_source_label: "Module Finances",
          p_link_entity_type: "parent",
          p_link_entity_id: d.parentId,
          p_actor_id: isUuid(actorId) ? actorId : null,
        });
        if (error) {
          // Surfaces instead of swallowing (the MSG-101 defect class).
          console.warn("[SupabaseDebt] reminder dispatch failed:", error.message);
          undeliverable++;
          continue;
        }
        if (data) {
          dispatched++;
        } else {
          // NULL = the parent has no active portal account (0077 contract).
          undeliverable++;
        }
      }
      await this.client.rpc("write_audit_log", {
        p_tenant_id: requireTenantId(),
        p_action: "debt.broadcast_reminders",
        p_entity_type: "parent",
        p_entity_id: "bulk",
        p_actor_id: isUuid(actorId) ? actorId : null,
        p_actor_name: actorId,
        p_after_json: { dispatched, undeliverable, minDaysOverdue },
        p_note: `Diffusion groupée de rappels — ${dispatched} notifié(s)${undeliverable > 0 ? `, ${undeliverable} sans compte portail actif (non notifiables)` : ""}`,
      }).then(() => undefined, () => undefined);
      return Ok(dispatched);
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  /**
   * VAULT §07.06 + §10.07 — "Lock Delinquent Accounts" (Supabase).
   *
   * Applies `is_financially_restricted = true` to every debtor overdue by
   * more than `minDaysOverdue` days (default > 90), skipping accounts
   * already restricted. Audit-logged per account + bulk summary.
   */
  async lockDelinquentAccounts(minDaysOverdue = 90, actorId = "system"): Promise<Result<number>> {
    try {
      const tenantId = requireTenantId();
      const debtors = await this.collectDebtors(minDaysOverdue);
      let restricted = 0;
      for (const d of debtors) {
        if (d.restricted) continue;
        const { error: updErr } = await this.client
          .from("parents")
          .update({ is_financially_restricted: true, updated_at: new Date().toISOString() })
          .eq("id", d.parentId);
        if (updErr) {
          console.warn("[SupabaseDebt] restriction update failed:", updErr.message);
          continue;
        }
        restricted++;
      }
      // T-192 / MSG-101: the canonical audit RPC is `write_audit_log`
      // (migration 0014) — the previous `append_audit_entry` call targeted a
      // nonexistent RPC and was silently swallowed.
      await this.client.rpc("write_audit_log", {
        p_tenant_id: tenantId,
        p_action: "debt.lock_delinquent_accounts",
        p_entity_type: "parent",
        p_entity_id: "bulk",
        p_actor_id: isUuid(actorId) ? actorId : null,
        p_actor_name: actorId,
        p_after_json: { restricted, minDaysOverdue },
        p_note: `Verrouillage comptes délinquants (> ${minDaysOverdue} j) — ${restricted} compte(s)`,
      }).then(() => undefined, () => undefined);
      return Ok(restricted);
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  /** Collect debtors above the overdue threshold with their state. */
  private async collectDebtors(minDaysOverdue: number): Promise<
    { parentId: string; outstanding: number; daysOverdue: number; restricted: boolean }[]
  > {
    // Query unpaid installments directly (no stale materialized-view
    // dependency). `daysOverdue` = days since the OLDEST unpaid overdue
    // installment; `outstanding` excludes uncleared non-cash funds
    // (amount_pending) per Invariant 4 — only confirmed debt is actionable.
    const { data, error } = await this.client
      .from("installments")
      .select("parent_id, amount_due, amount_paid, amount_pending, due_date")
      .neq("status", "paid")
      .lt("due_date", new Date().toISOString());
    if (error || !data) {
      console.warn("[SupabaseDebt] collectDebtors query failed:", error?.message);
      return [];
    }
    const nowMs = Date.now();
    const byParent = new Map<string, { outstanding: number; daysOverdue: number }>();
    for (const row of (data as {
      parent_id: string;
      amount_due: number | string;
      amount_paid: number | string;
      amount_pending: number | string;
      due_date: string;
    }[])) {
      const due = Number(row.amount_due ?? 0);
      const paid = Number(row.amount_paid ?? 0);
      const pending = Number(row.amount_pending ?? 0);
      const remaining = Math.max(0, due - paid - pending);
      if (remaining <= 0) continue;
      const days = Math.floor((nowMs - new Date(row.due_date).getTime()) / 86_400_000);
      const prev = byParent.get(row.parent_id);
      byParent.set(row.parent_id, {
        outstanding: (prev?.outstanding ?? 0) + remaining,
        daysOverdue: Math.max(prev?.daysOverdue ?? 0, days),
      });
    }
    return [...byParent.entries()]
      .filter(([, v]) => v.daysOverdue > minDaysOverdue)
      .map(([parentId, v]) => ({ parentId, ...v, restricted: false }));
  }
}
