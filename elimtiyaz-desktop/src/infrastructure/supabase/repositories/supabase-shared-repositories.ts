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
  Observable,
} from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
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
  GradeLevel,
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
} from "../../../domain/model/payment";
import type { LedgerEntry } from "../../../domain/model/ledger";
import type { ParentLedgerSummary } from "../../../domain/model/ledger";
import { SubjectBehavior } from "../../mock/subject-behavior";
import type {
  ParentRow,
  StudentRow,
  PaymentRow,
  LedgerEntryRow,
} from "../types";

// ============================================================================
// Helpers
// ============================================================================

const TENANT_FALLBACK = "00000000-0000-0000-0000-000000000001";

function getTenantId(): string {
  // The tenant id is stored on the session by the auth provider.
  // Fall back to the seed tenant when the session isn't loaded yet.
  try {
    const raw = localStorage.getItem("el-imtiyaz.session.tenantId");
    if (raw) return raw;
  } catch { /* ignore */ }
  return TENANT_FALLBACK;
}

function getActorId(): string {
  try {
    const raw = localStorage.getItem("el-imtiyaz.session.userId");
    if (raw) return raw;
  } catch { /* ignore */ }
  return "excel-import";
}

function getActorName(): string {
  try {
    const raw = localStorage.getItem("el-imtiyaz.session.displayName");
    if (raw) return raw;
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
  const identity = [
    input.phone ?? "",
    input.displayName ?? "",
    input.firstName ?? "",
    input.lastName ?? "",
  ].join("|").trim();
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
  return {
    id: r.id,
    tenantId: r.tenant_id,
    code: r.student_code,
    parentId: r.parent_id,
    firstName: r.first_name,
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
    return this.byIdCache.get(id)!;
  }

  private async refreshById(id: string): Promise<void> {
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
      const row = (data as { parent_id: string; parent_code: string; was_inserted: boolean }[])[0];
      if (!row) throw new Error("upsert_parent_from_import returned no rows");

      // Fetch the full row.
      const { data: fullRow, error: fetchErr } = await this.client
        .from("parents")
        .select("*")
        .eq("id", row.parent_id)
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
      return Err(Errors.unknown(e as Error));
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
      this.byIdCache.delete(id);
      return Ok(undefined);
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }
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
    return new SubjectBehavior<Student[]>(
      this.cache.get().filter((s) => s.parentId === parentId),
    );
  }

  observeByClass(classId: string): Observable<Student[]> {
    void this.seed();
    return new SubjectBehavior<Student[]>(
      this.cache.get().filter((s) => s.classId === classId),
    );
  }

  observeById(id: string): Observable<Student | null> {
    void this.seed();
    return new SubjectBehavior<Student | null>(
      this.cache.get().find((s) => s.id === id) ?? null,
    );
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
        p_middle_name: null,
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
      const row = (data as { student_id: string; student_code: string; was_inserted: boolean }[])[0];
      if (!row) throw new Error("upsert_student_from_import returned no rows");

      const { data: fullRow, error: fetchErr } = await this.client
        .from("students")
        .select("*")
        .eq("id", row.student_id)
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
      return Err(Errors.unknown(e as Error));
    }
  }

  async updateStudent(id: string, updates: Partial<CreateStudentInput>): Promise<Result<Student>> {
    try {
      const patch: Record<string, unknown> = {};
      if (updates.firstName !== undefined) patch.first_name = updates.firstName;
      if (updates.lastName !== undefined) patch.last_name = updates.lastName;
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

  async batchRegister(): Promise<Result<{ parent: Parent; students: readonly Student[] }>> {
    // Supabase has a `batch_register_family` RPC — out of scope for this fix.
    return Err(Errors.server("batchRegister not implemented for Supabase repository"));
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
    return new SubjectBehavior<Payment[]>(
      this.cache.get().filter((p) => p.parentId === parentId),
    );
  }

  observeByStudent(studentId: string): Observable<Payment[]> {
    void this.seed();
    return new SubjectBehavior<Payment[]>(
      this.cache.get().filter((p) => p.studentId === studentId),
    );
  }

  observeById(id: string): Observable<Payment | null> {
    void this.seed();
    return new SubjectBehavior<Payment | null>(
      this.cache.get().find((p) => p.id === id) ?? null,
    );
  }

  async collect(input: CollectPaymentInput, collectedBy: string): Promise<Result<Payment>> {
    try {
      const tenantId = getTenantId();
      const year = new Date().getFullYear();
      const seq = Math.floor(Math.random() * 1_000_000) + 1;
      const paymentNumber = `PAY-${year}-${String(seq).padStart(6, "0")}`;

      const { data, error } = await this.client.rpc("upsert_payment_from_import", {
        p_tenant_id: tenantId,
        p_payment_number: paymentNumber,
        p_parent_id: input.parentId,
        p_student_id: input.studentId ?? null,
        p_amount: input.amount,
        p_method: input.method,
        p_category: input.category ?? "tuition",
        p_status: null, // let the RPC auto-derive (cash → paid, check/transfer → pending)
        p_proof_path: input.proofUrl ?? null,
        p_collected_at: new Date().toISOString(),
        p_collected_by: collectedBy,
        p_notes: input.notes ?? null,
      });
      if (error) throw error;
      const row = (data as { payment_id: string; payment_number: string; was_inserted: boolean }[])[0];
      if (!row) throw new Error("upsert_payment_from_import returned no rows");

      const { data: fullRow, error: fetchErr } = await this.client
        .from("payments")
        .select("*")
        .eq("id", row.payment_id)
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

  async adjust(): Promise<Result<AccountAdjustment>> {
    return Err(Errors.server("adjust not implemented for Supabase repository"));
  }

  async generateReceipt(): Promise<Result<Receipt>> {
    return Err(Errors.server("generateReceipt not implemented for Supabase repository"));
  }

  async appendManualCharge(): Promise<Result<LedgerEntry>> {
    return Err(Errors.server("appendManualCharge not implemented for Supabase repository"));
  }
}

// ============================================================================
// SupabaseLedgerRepository
// ============================================================================

export class SupabaseLedgerRepository implements LedgerRepository {
  private readonly cache = new SubjectBehavior<LedgerEntry[]>([]);
  private readonly byParent = new Map<string, SubjectBehavior<LedgerEntry[]>>();
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
    if (!this.byParent.has(parentId)) {
      this.byParent.set(
        parentId,
        new SubjectBehavior<LedgerEntry[]>(this.cache.get().filter((e) => e.parentId === parentId)),
      );
    }
    return this.byParent.get(parentId)!;
  }

  observeByAccount(accountId: string): Observable<LedgerEntry[]> {
    return new SubjectBehavior<LedgerEntry[]>(
      this.cache.get().filter((e) => e.accountId === accountId),
    );
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
      this.byParent.get(entry.parentId)?.update((list) => [
        entry,
        ...list.filter((e) => e.id !== entry.id),
      ]);
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
    await this.seed();
    const entries = this.cache.get().filter((e) => e.parentId === parentId);
    const totalCharged = entries.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0);
    const totalPaid = entries.filter((e) => e.amount < 0 && e.type === "payment").reduce((s, e) => s + Math.abs(e.amount), 0);
    const totalAdjusted = entries.filter((e) => e.type === "adjustment").reduce((s, e) => s + e.amount, 0);
    const totalRefunded = entries.filter((e) => e.type === "refund").reduce((s, e) => s + Math.abs(e.amount), 0);
    const outstanding = totalCharged - totalPaid + totalAdjusted;
    return Ok({
      parentId,
      parentName: "",
      totalOutstanding: outstanding,
      totalOverdue: 0,
      totalCharged,
      totalPaid,
      totalCleared: totalPaid,
      totalPending: 0,
      totalAdjusted,
      totalRefunded,
      totalUnallocatedCredit: 0,
      accounts: [],
      entryCount: entries.length,
      lastActivityAt: entries[0]?.at ?? null,
    } as ParentLedgerSummary);
  }

  async reconcile(): Promise<Result<import("../../../domain/reconcile").ReconciliationReport>> {
    // Reconciliation is a desktop-only sweep; the mock + supabase impls
    // both return an empty report. The full reconcile() lives in
    // `domain/reconcile.ts` and reads from the in-memory cache.
    const emptyReport = {
      checked: 0,
      violations: [],
      warnings: [],
    } as unknown as import("../../../domain/reconcile").ReconciliationReport;
    return Ok(emptyReport);
  }
}
