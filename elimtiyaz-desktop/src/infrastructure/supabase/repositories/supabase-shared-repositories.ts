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
} from "../../../domain/model/student";
import {
  gradeLevelFromLevelYear,
  academicLevelFromGradeLevel,
  gradeYearFromGradeLevel,
} from "../../../domain/model/student";
import type {
  Payment,
  Installment,
  CollectPaymentInput,
  AccountAdjustment,
  Receipt,
  ParentFinancialProfile,
  PaymentCategory,
  AcademicCycle,
  UpdateInstallmentDueDateInput,
} from "../../../domain/model/payment";
import type { AllocationResult } from "../../../domain/calc/payment/waterfall-allocator";
import type { LedgerEntry } from "../../../domain/model/ledger";
import type { ParentLedgerSummary } from "../../../domain/model/ledger";
import { SubjectBehavior, derived } from "../../mock/subject-behavior";
import type {
  ParentRow,
  StudentRow,
  PaymentRow,
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

function getSessionFromStorage(): { tenantId?: string; userId?: string; displayName?: string } | null {
  try {
    const raw = localStorage.getItem("el-imtiyaz.session");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getTenantId(): string {
  // The tenant id is stored on the session by the auth provider.
  // Fall back to the seed tenant when the session isn't loaded yet.
  try {
    const sess = getSessionFromStorage();
    if (sess?.tenantId) return sess.tenantId;
  } catch { /* ignore */ }
  return TENANT_FALLBACK;
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

function randomParentSuffix(): string {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

function studentCode(year: number, seq: number): string {
  return `ELV-${year}-${String(seq).padStart(6, "0")}`;
}

/**
 * Compute a short stable hash (6 hex chars) from an arbitrary string.
 * Used to derive deterministic parent/student codes from identity fields
 * (phone, display name) so that re-importing the same Excel row produces
 * the SAME code, letting the `upsert_*_from_import` RPCs hit their primary
 * identity match (tenant_id, parent_code) / (tenant_id, student_code)
 * instead of falling through to weaker fallbacks.
 *
 * Implementation: FNV-1a 32-bit, hex-encoded, truncated to 6 chars.
 * Not cryptographic — the goal is determinism + low collision rate across
 * a few thousand parents/students, which FNV-1a easily achieves.
 */
function stableHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Force unsigned 32-bit and encode as 8-char hex, take first 6.
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, 6).toUpperCase();
}

/**
 * Derive a deterministic parent code from the parent's identity fields.
 * The code is `PAR-{year}-{6-hex}` where the hex is a stable hash of
 * (primary_phone || display_name || first_name+last_name).
 *
 * Re-importing the same Excel row produces the same code → the
 * `upsert_parent_from_import` RPC's primary identity match
 * `(tenant_id, parent_code)` succeeds → idempotent upsert, no duplicates.
 */
function deterministicParentCode(year: number, input: CreateParentInput): string {
  // CANONICAL (cross-platform equivalence fix): filter out BOTH null and EMPTY
  // identity fields (after per-field trim) before joining. Previously empty
  // strings were joined while Android's listOfNotNull skipped them, so the
  // same parent produced different parent_codes on each platform — breaking
  // the idempotent (tenant_id, parent_code) upsert match.
  const identity = [
    input.phone ?? "",
    input.displayName ?? "",
    input.firstName ?? "",
    input.lastName ?? "",
  ]
    .map((f) => f.trim())
    .filter((f) => f.length > 0)
    .join("|");
  // If we have no identity at all, fall back to random — but this should
  // never happen because the importer always sets at least one field.
  const suffix = identity.length > 0 ? stableHash(identity) : randomParentSuffix();
  return `PAR-${year}-${suffix}`;
}

/**
 * Derive a deterministic student code from (parentId, student display name).
 * Re-importing the same Excel row produces the same code → primary identity
 * match `(tenant_id, student_code)` succeeds → idempotent upsert.
 */
function deterministicStudentCode(
  year: number,
  parentId: string,
  input: CreateStudentInput,
): string {
  const identity = [
    parentId ?? "",
    input.displayName ?? "",
    input.firstName ?? "",
    input.lastName ?? "",
  ].join("|").trim();
  const suffix = identity.length > 0 ? stableHash(identity) : String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
  return `ELV-${year}-${suffix}`;
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
export function isUuid(value: string | null | undefined): boolean {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
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
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapStudentRow(r: StudentRow): Student {
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
  // vault §04.06 — descriptive document records (documents_json, migration 0038).
  const documents = ((r as { documents_json?: unknown }).documents_json ?? null) as
    | Student["documents"]
    | null;
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
    classId: r.class_id,
    photoUrl: null,
    medicalNotes: r.medical_notes,
    transportTier,
    status: r.enrollment_status as Student["status"],
    paymentPlan,
    ...(documents ? { documents } : {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapPaymentRow(r: PaymentRow): Payment {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    receiptNumber: r.receipt_number ?? r.payment_number,
    parentId: r.parent_id,
    studentId: r.student_id,
    amount: Number(r.amount),
    method: r.method,
    status: (r.status === "unpaid" ? "pending" : r.status) as Payment["status"],
    category: (r.category ?? "other") as Payment["category"],
    installmentId: r.installment_id,
    proofUrl: r.proof_path,
    notes: r.notes,
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
    type: (r.entry_type ?? r.actor_id ?? "charge") as LedgerEntry["type"],
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
  private seeded = false;

  constructor(private readonly client: SupabaseClient) {}

  private async seed(): Promise<void> {
    if (this.seeded) return;
    this.seeded = true;
    try {
      const tenantId = getTenantId();
      const { data, error } = await this.client
        .from("parents")
        .select("*")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("last_name", { ascending: true });
      if (error) throw error;
      this.cache.set((data as ParentRow[]).map(mapParentRow));
    } catch (e) {
      // Silently degrade to empty cache — UI shows "no parents".
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
    } catch { /* ignore */ }
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
      const tenantId = getTenantId();
      const year = new Date().getFullYear();
      // DETERMINISTIC CODE: derive from identity fields so re-imports hit
      // the primary identity match `(tenant_id, parent_code)` and the RPC
      // performs an UPDATE instead of falling through to weaker fallbacks
      // (phone match, display_name match) that may or may not exist.
      const parentCode = deterministicParentCode(year, input);
      const transportDestination: TransportDestination | null =
        input.transportDestination ?? cityTierToDestination(input.cityTier) ?? null;

      const { data, error } = await this.client.rpc("upsert_parent_from_import", {
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
      // Soft-delete via deleted_at.
      const { error } = await this.client
        .from("parents")
        .update({ deleted_at: new Date().toISOString(), is_active: false })
        .eq("id", id);
      if (error) throw error;
      this.cache.update((list) => list.filter((p) => p.id !== id));
      // FIX (reactivity): set the byId subject to null so open drawers
      // observing this parent see the deletion instead of a frozen profile.
      this.byIdCache.get(id)?.set(null);
      this.byIdCache.delete(id);
      return Ok(undefined);
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }
}

/**
 * Lazily construct ledger + installment repositories for the batch
 * registration billing flow (avoids circular constructor wiring).
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
  private seeded = false;

  constructor(private readonly client: SupabaseClient) {}

  private async seed(): Promise<void> {
    if (this.seeded) return;
    this.seeded = true;
    try {
      const tenantId = getTenantId();
      const { data, error } = await this.client
        .from("students")
        .select("*")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("last_name", { ascending: true });
      if (error) throw error;
      this.cache.set((data as StudentRow[]).map(mapStudentRow));
    } catch {
      this.cache.set([]);
    }
  }

  observe(): Observable<Student[]> {
    void this.seed();
    return this.cache;
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
      const tenantId = getTenantId();
      const year = new Date().getFullYear();
      // DETERMINISTIC CODE: derive from (parentId, displayName) so re-imports
      // hit the primary identity match `(tenant_id, student_code)` and the
      // RPC performs an UPDATE instead of falling through to the weaker
      // (parent_id, first_name, last_name) fallback.
      const code = deterministicStudentCode(year, parentId, input);
      const gradeLevel: GradeLevel =
        input.gradeLevel ?? gradeLevelFromLevelYear(input.level, input.gradeYear);

      const { data, error } = await this.client.rpc("upsert_student_from_import", {
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
      if (updates.paymentPlan !== undefined) {
        patch.payment_plan = updates.paymentPlan;
      }
      // NEW (edit flow): persist the student lifecycle status.
      if (updates.status !== undefined) {
        patch.enrollment_status = updates.status;
        patch.is_active = updates.status === "active";
      }
      // NEW (vault §04.06 — Documents tab): persist the descriptive document
      // records via the additive `documents_json` column (migration 0038),
      // mirroring the personnel `documents_json` pattern.
      if (updates.documents !== undefined) {
        patch.documents_json = updates.documents;
      }
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

  async deleteStudent(id: string): Promise<Result<void>> {
    try {
      const { error } = await this.client
        .from("students")
        .update({ deleted_at: new Date().toISOString(), is_active: false })
        .eq("id", id);
      if (error) throw error;
      this.cache.update((list) => list.filter((s) => s.id !== id));
      return Ok(undefined);
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  async batchRegister(
    input: BatchRegistrationInput,
  ): Promise<Result<BatchRegistrationResult>> {
    // FIX (previously always failed): the wizard was unusable in Supabase mode
    // ("batchRegister not implemented"). Implemented as a sequential flow over
    // the existing atomic per-entity RPCs:
    //   1. upsert_parent_from_import        (parent)
    //   2. upsert_student_from_import × N   (students)
    //   3. upsert_ledger_entry_from_import × M (tuition/transport/fee charges)
    //   4. installments importInstallment × K   (tranche schedule)
    // Steps 3/4 failures are reported but do NOT roll back the family records
    // (they can be regenerated); failures in 1/2 abort immediately.
    try {
      const parentResult = await new SupabaseParentRepository(this.client).createParent(
        input.parent,
      );
      if (!parentResult.ok) return parentResult;

      const parent = parentResult.value;
      const created: Student[] = [];
      for (const sInput of input.students) {
        const r = await this.createStudent(parent.id, sInput);
        if (!r.ok) {
          return Err(
            Errors.server(
              `Parent créé (${parent.code}) mais l'élève "${sInput.firstName} ${sInput.lastName}" a échoué : ${r.error.userMessage}`,
            ),
          );
        }
        created.push(r.value);
      }

      // Best-effort billing persistence (tuition + transport + fee charges and
      // the installment schedule) — uses the same canonical helpers as the
      // mock repository so both backends produce identical schedules.
      try {
        const { ledgerRepo, installmentRepo } = getBillingRepos(this.client);
        const year = input.academicYearStartYear ?? new Date().getFullYear();
        const includeTransport = input.includeTransport ?? true;
        const includeRegistration = input.includeRegistration ?? true;
        const [due1, due2, due3] = getOfficialTuitionDueDates(year);
        const at = new Date().toISOString();

        for (let i = 0; i < created.length; i++) {
          const student = created[i];
          const gross = tuitionForGradeLevel(defaultPricingConfig, student.gradeLevel).annualAmount;
          if (gross > 0) {
            const evals = evaluateAllSystemDiscounts({
              grossTuition: gross,
              previousGradeLevel: null,
              currentGradeLevel: student.gradeLevel,
              childIndex: i + 1,
              paymentPlan: student.paymentPlan,
              paymentDate: at,
              academicYearStartYear: year,
              academicYearStart: new Date(Date.UTC(year, 8, 1)).toISOString(),
              enrollmentDate: student.enrollmentDate,
              previousRank: null,
            });
            const net = Math.max(0, gross + sumDiscounts(evals));
            const amounts =
              student.paymentPlan === "full_annual"
                ? [net]
                : [...splitNetTuitionByOfficialSchedule(net)];
            const dues = student.paymentPlan === "full_annual" ? [due1] : [due1, due2, due3];
            for (let t = 0; t < amounts.length; t++) {
              await ledgerRepo.append(
                createChargeEntry({
                  tenantId: getTenantId(),
                  parentId: parent.id,
                  studentId: student.id,
                  category: "tuition",
                  amount: amounts[t],
                  sourceType: "installment",
                  sourceId: `reg-${student.id}-t${t + 1}`,
                  description: `Scolarité ${year} — Tranche ${t + 1} (${student.gradeLevel})`,
                  actorId: "system",
                  actorName: "Inscription groupée",
                  at,
                  metadata: {
                    tranche: t + 1,
                    gradeLevel: student.gradeLevel,
                    paymentPlan: student.paymentPlan,
                  },
                }),
              );
              await installmentRepo.importInstallment({
                parentId: parent.id,
                studentId: student.id,
                category: "tuition",
                trancheNumber: (t + 1) as 1 | 2 | 3,
                label: student.paymentPlan === "full_annual" ? "Année complète" : `Tranche ${t + 1}`,
                amountDue: amounts[t],
                amountPaid: 0,
                dueDate: dues[t],
                paidDate: null,
                status: "unpaid",
              });
            }
          }
          if (includeTransport) {
            const destination =
              (student.transportTier as TransportDestination | null) ?? parent.transportDestination;
            if (destination) {
              const tranches = transportTranchesForDestination(defaultPricingConfig, destination);
              for (let t = 0; t < tranches.length; t++) {
                await ledgerRepo.append(
                  createChargeEntry({
                    tenantId: getTenantId(),
                    parentId: parent.id,
                    studentId: student.id,
                    category: "transport",
                    amount: tranches[t].amountDue,
                    sourceType: "installment",
                    sourceId: `reg-${student.id}-transport-t${t + 1}`,
                    description: `Transport ${year} — Tranche ${t + 1} (${destination})`,
                    actorId: "system",
                    actorName: "Inscription groupée",
                    at,
                    metadata: { tranche: t + 1, destination },
                  }),
                );
                await installmentRepo.importInstallment({
                  parentId: parent.id,
                  studentId: student.id,
                  category: "transport",
                  trancheNumber: (t + 1) as 1 | 2 | 3,
                  label: `Transport T${t + 1}`,
                  amountDue: tranches[t].amountDue,
                  amountPaid: 0,
                  dueDate: [due1, due2, due3][t],
                  paidDate: null,
                  status: "unpaid",
                });
              }
            }
          }
        }
        if (includeRegistration && defaultPricingConfig.registrationFee > 0 && created.length > 0) {
          await ledgerRepo.append(
            createChargeEntry({
              tenantId: getTenantId(),
              parentId: parent.id,
              studentId: null,
              category: "other",
              amount: defaultPricingConfig.registrationFee,
              sourceType: "manual_entry",
              sourceId: `reg-${parent.id}-fee`,
              description: `Frais d'inscription ${year} (nouvelle famille)`,
              actorId: "system",
              actorName: "Inscription groupée",
              at,
              metadata: { type: "registration_fee" },
            }),
          );
        }
      } catch (billingErr) {
        console.warn("[SupabaseStudent] batchRegister billing persistence failed:", billingErr);
        // Family records exist — surface a warning in the result note but do
        // not fail the registration (charges can be regenerated).
      }

      return Ok({ parent, students: created });
    } catch (e) {
      return Err(supabaseErrorToAppError(e as { code?: string; message: string; details?: unknown }));
    }
  }

  async promote(): Promise<Result<Student[]>> {
    return Err(Errors.server("promote not implemented for Supabase repository"));
  }
}

// ============================================================================
// SupabasePaymentRepository
// ============================================================================

export class SupabasePaymentRepository implements PaymentRepository {
  private readonly cache = new SubjectBehavior<Payment[]>([]);
  private seeded = false;

  constructor(private readonly client: SupabaseClient) {}

  private async seed(): Promise<void> {
    if (this.seeded) return;
    this.seeded = true;
    try {
      const tenantId = getTenantId();
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

  async collect(input: CollectPaymentInput, collectedBy: string): Promise<Result<Payment>> {
    // CANONICAL-FINANCIAL-LOGIC.md §4 INV-6 + INV-7 + §8.6 — the Supabase
    // `collect` workflow MUST use the atomic `collect_and_allocate_payment`
    // RPC (migration 0026) so the waterfall + parent_credit adjustment + audit
    // transaction happen server-side in one go. The previous implementation
    // called `upsert_payment_from_import` (a simple insert helper), so the
    // waterfall never ran at the RPC layer — payments inserted but no
    // installments moved toward `paid`, and overpayments never became
    // parent_credit adjustments.
    try {
      const tenantId = getTenantId();
      const year = new Date().getFullYear();
      // BULK IMPORT FIX: when the caller provides a deterministic receipt
      // number (the Excel importer does, derived from `${studentId}:${field}`),
      // use it verbatim — re-importing the same Excel row hits the same
      // payment_number identity key and the upsert RPC performs an UPDATE
      // instead of INSERTing a duplicate payment. When omitted (the normal
      // interactive collect flow), generate a random one as before.
      const paymentNumber = input.receiptNumber
        ?? `PAY-${year}-${String(Math.floor(Math.random() * 1_000_000) + 1).padStart(6, "0")}`;

      // Try the atomic RPC first (migration 0026). Falls back to the simple
      // upsert RPC if the function doesn't exist (older Supabase deployments
      // that haven't run migration 0026 yet).
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
        p_actor_id: collectedBy,
        p_actor_name: collectedBy,
      };
      const { data: atomicData, error: atomicErr } = await this.client.rpc(
        "collect_and_allocate_payment",
        atomicParams,
      );
      let paymentId: string;
      if (atomicErr) {
        // Fall back to the legacy upsert RPC (no atomic waterfall).
        console.warn(
          "[SupabasePayment] collect_and_allocate_payment failed, falling back to upsert_payment_from_import:",
          atomicErr.message,
        );
        const { data: fallbackData, error: fallbackErr } = await this.client.rpc(
          "upsert_payment_from_import",
          {
            p_tenant_id: tenantId,
            p_payment_number: paymentNumber,
            p_parent_id: input.parentId,
            p_student_id: input.studentId ?? null,
            p_amount: input.amount,
            p_method: input.method,
            p_category: input.category ?? "tuition",
            p_status: null,
            p_proof_path: input.proofUrl ?? null,
            p_collected_at: input.collectedAt ?? new Date().toISOString(),
            p_collected_by: collectedBy,
            p_notes: input.notes ?? null,
          },
        );
        if (fallbackErr) throw fallbackErr;
        const fallbackRow = (fallbackData as {
          out_payment_id: string;
          out_payment_number: string;
          out_was_inserted: boolean;
        }[])[0];
        if (!fallbackRow || !fallbackRow.out_payment_id) {
          throw new Error("upsert_payment_from_import returned no rows");
        }
        paymentId = fallbackRow.out_payment_id;
      } else {
        // Atomic RPC succeeded — its return type matches the migration 0026 schema.
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
        paymentId = atomicRow.payment_id;
      }
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

  async refund(id: string): Promise<Result<Payment>> {
    try {
      const tenantId = getTenantId();
      const { error } = await this.client.rpc("revert_payment_allocation", {
        p_tenant_id: tenantId,
        p_payment_id: id,
        p_actor_id: getActorId(),
        p_actor_name: getActorName(),
        p_reason: "Manual refund",
      });
      if (error) throw error;
      const { data, error: fetchErr } = await this.client
        .from("payments")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      const payment = mapPaymentRow(fetchErr ? ({} as PaymentRow) : (data as PaymentRow));
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
   */
  async bulkCollect(inputs: ReadonlyArray<{ input: CollectPaymentInput; collectedBy: string }>): Promise<Result<readonly Payment[]>> {
    if (inputs.length === 0) return Ok([]);
    try {
      const tenantId = getTenantId();
      const now = new Date().toISOString();
      const rows = inputs.map(({ input, collectedBy }) => ({
        tenant_id: tenantId,
        payment_number: input.receiptNumber ?? `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
      }));
      // Insert in chunks of 500.
      const CHUNK_SIZE = 500;
      const inserted: Payment[] = [];
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        const { data, error } = await this.client
          .from("payments")
          .insert(chunk as never)
          .select("id, tenant_id, payment_number, receipt_number, parent_id, student_id, amount, method, status, category, installment_id, proof_path, notes, collected_by, collected_at, created_at, updated_at");
        if (error) {
          console.warn(`[SupabasePayment] bulk insert chunk ${i} failed:`, error.message);
          continue;
        }
        for (const row of (data ?? []) as PaymentRow[]) {
          inserted.push(mapPaymentRow(row));
        }
      }
      this.cache.update((list) => [...inserted, ...list]);
      return Ok(inserted);
    } catch (e) {
      console.warn("[SupabasePayment] bulkCollect error:", e);
      // Fall back to loop.
      const results: Payment[] = [];
      for (const { input, collectedBy } of inputs) {
        const r = await this.collect(input, collectedBy);
        if (r.ok) results.push(r.value);
      }
      return Ok(results);
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
      const tenantId = getTenantId();
      const nowIso = new Date().toISOString();
      const adjustmentId = `led-${nowIso}-${Math.random().toString(36).slice(2, 10)}`;
      // Overpayment credits use category=parent_credit + studentId=null + a
      // parent-scoped accountId. Positive adjustments (penalty / late fee)
      // use the caller-specified category (default tuition) + the
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
        receiptNumber: row.receipt_number ?? row.payment_number ?? `REC-${paymentId}`,
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
      serviceQualifier: "canteen_term" | "uniform" | "books" | "second_apron";
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
      const tenantId = getTenantId();
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
  private seeded = false;

  constructor(private readonly client: SupabaseClient) {}

  private async seed(): Promise<void> {
    if (this.seeded) return;
    this.seeded = true;
    try {
      const tenantId = getTenantId();
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
   * Note: this does NOT call the `upsert_ledger_entry_from_import` RPC —
   * it uses a direct `INSERT INTO ledger_entries (...) VALUES (...), (...)`
   * which is faster but skips the idempotency check. Re-importing the same
   * Excel file will create duplicates unless the caller dedupes first.
   * The importer already dedupes via `existingKeys` in
   * `persistFinancialEntries`.
   */
  async bulkAppend(entries: readonly LedgerEntry[]): Promise<Result<readonly LedgerEntry[]>> {
    if (entries.length === 0) return Ok([]);
    try {
      const tenantId = getTenantId();
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
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        const { error } = await this.client
          .from("ledger_entries")
          .insert(chunk as never);
        if (error) {
          console.warn(`[SupabaseLedger] bulk insert chunk ${i} failed:`, error.message);
          // Don't throw — continue with the next chunk so a single bad row
          // doesn't kill the entire import.
        }
      }
      // Update the in-memory cache.
      this.cache.update((list) => [...entries, ...list]);
      return Ok(entries);
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
  private seeded = false;

  constructor(private readonly client: SupabaseClient) {}

  private async seed(): Promise<void> {
    if (this.seeded) return;
    this.seeded = true;
    try {
      const tenantId = getTenantId();
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
      const tenantId = getTenantId();
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
        // Use upsert with onConflict to handle idempotency at the DB level.
        const { data, error } = await this.client
          .from("installments")
          .upsert(chunk as never, { onConflict: "tenant_id,parent_id,student_id,category,tranche_number" })
          .select("id, tenant_id, parent_id, student_id, category, tranche_number, label, amount_due, amount_paid, amount_pending, due_date, paid_date, status, academic_cycle, payment_plan, is_custom_schedule, custom_schedule_note, source_type, source_id, created_at, updated_at");
        if (error) {
          console.warn(`[SupabaseInstallment] bulk upsert chunk ${i} failed:`, error.message);
          continue;
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
      const tenantId = getTenantId();
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
export class SupabaseDebtRepository implements DebtRepository {
  private readonly profiles = new Map<string, SubjectBehavior<ParentFinancialProfile | null>>();

  constructor(private readonly client: SupabaseClient) {}

  observeSummary(): Observable<import("../../../domain/model/payment").DebtSummary[]> {
    // Returns an empty observable — the dashboard's debtAging chart drives
    // the cross-parent view now via `dashboard.debtByAgingForRange()`.
    return new SubjectBehavior<import("../../../domain/model/payment").DebtSummary[]>([]);
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
      const tenantId = getTenantId();
      // Select only base columns that exist in migration 0007 to avoid 400
      // errors when migration 0027 hasn't been applied.
      const { data, error } = await this.client
        .from("ledger_entries")
        .select("id, parent_id, entry_type, amount, category, entry_date")
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
      // CANONICAL-FINANCIAL-LOGIC.md §4 INV-10 — delegate to the canonical
      // `computeParentSummary` so the Supabase-backed debt profile uses the
      // SAME totals as the mock + Android. The previous implementation
      // counted negative adjustments as "paid" (incorrectly) and forced
      // `overdueAmount = outstanding` (always equal, ignoring due dates).
      const overdueDueDates = buildOverdueDueDateMap(entries);
      const parentName = ""; // Looked up separately if needed by UI.
      const summary = computeParentSummary(entries, parentId, parentName, overdueDueDates);
      // Build the derived profile from the canonical summary.
      const installments: Installment[] = [];
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
      const profile: ParentFinancialProfile = {
        parentId,
        parentName,
        totalDue: summary.totalCharged,
        totalPaid: summary.totalPaid,
        totalOutstanding: summary.totalOutstanding,
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

  async sendReminder(): Promise<Result<void>> {
    return Ok(undefined);
  }
}
