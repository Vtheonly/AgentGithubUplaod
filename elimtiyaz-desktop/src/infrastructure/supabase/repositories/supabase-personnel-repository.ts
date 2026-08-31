/**
 * SupabasePersonnelRepository + SupabaseDepartmentRepository — Supabase-backed
 * implementations of the personnel entity (plan §09) and workforce departments
 * (migration 0010).
 *
 * Tables (source of truth = `supabase/migrations/`):
 *   - `personnel`     — migration 0009_attendance_hr.sql
 *   - `departments`   — migration 0010_workforce.sql
 *   - `roles`         — migration 0003_rbac.sql (lookup: code ↔ uuid)
 *
 * SCOPE (Task DESKTOP-1 / Task 4 — "basic personnel repository"):
 *   Implements the FULL `PersonnelRepository` interface (entity CRUD:
 *   observe / observeByCategory / observeById / observeByUserId / create /
 *   update / delete) and the FULL `DepartmentRepository` interface.
 *
 *   Every OTHER workforce repository stays on the mock layer (they are NOT
 *   part of the PersonnelRepository interface): releve (timesheet ledger),
 *   shifts, schedules, tasks, workforceAttendance, leaveRequests,
 *   performanceReviews, chat, onboarding. No method delegation is needed
 *   because those live in their own repository slots — see
 *   `getSupabaseRepositories()` which keeps them mock-backed.
 *
 * DOCUMENTED MAPPING LIMITATIONS (DB schema is the source of truth):
 *   1. `staff_category` — the DB CHECK constraint only allows
 *      ('administration', 'teaching', 'support', 'medical') while the domain
 *      has 8 categories. teacher↔teaching is exact; maintenance / driver /
 *      buyer / warehouse / worker collapse to 'support' on write and read
 *      back as "support". The precise category remains derivable from
 *      `roleId` (roles table has all 11 role codes).
 *   2. `status` — the DB has no enum column; status is reconstructed from
 *      `deleted_at` / `is_active` / `end_date`. "on_leave" cannot be
 *      represented and reads back as "active".
 *   3. `payment_method` — DB CHECK allows cash / bank_transfer / check only;
 *      "mobile_money" is stored as NULL.
 *   4. `weekly_hours_target` / `weekly_hours_logged` — no DB columns. Read
 *      back as 40 (the employee form's default) / 0; the entered value is not
 *      persisted.
 *   5. `avatar_url` — no DB column; always null on read.
 *   6. `deletePersonnel` — soft-delete (`deleted_at = now()`), preserving the
 *      releve_entries / audit history (same convention as parents). Archived
 *      personnel read back with status "archived".
 *   7. Departments: `parentId` has no DB column (org-chart nesting is not
 *      persisted); `color` tailwind tokens map to the brand palette hex
 *      values (tailwind.config.cjs).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PersonnelRepository,
  Observable,
} from "../../../domain/repository/repository";
import type { DepartmentRepository } from "../../../domain/repository/workforce-repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { supabaseErrorToAppError } from "../supabase-client";
import { SubjectBehavior, derived } from "../../mock/subject-behavior";
import { Role } from "../../../core/rbac/roles";
import type {
  Personnel,
  PersonnelStatus,
  StaffCategory,
} from "../../../domain/model/personnel";
import type { Department } from "../../../domain/model/workforce";
import type { PersonnelRow, DepartmentRow, RoleRow } from "../types";
import { getTenantId, isUuid } from "./supabase-shared-repositories";
import { CacheFreshness } from "../cache-freshness";

// ============================================================================
// Helpers
// ============================================================================

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * FNV-1a 32-bit stable hash, hex-encoded (6 chars) — same routine as the
 * shared repositories. Used to derive deterministic personnel / department
 * codes so re-creating the same entity cannot collide blindly.
 */
function stableHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, 6).toUpperCase();
}

/** Domain StaffCategory (9 values) → DB staff_category (4 values, migration 0009 CHECK). */
const CATEGORY_TO_DB: Record<StaffCategory, "administration" | "teaching" | "support" | "medical"> = {
  teacher: "teaching",
  administration: "administration",
  support: "support",
  maintenance: "support",
  driver: "support",
  buyer: "support",
  warehouse: "support",
  worker: "support",
  // VAULT §09.07 — Médical / Thérapie maps to its own DB category.
  medical: "medical",
};

/** DB staff_category → domain StaffCategory (lossy for the support family — see header note 1). */
const CATEGORY_FROM_DB: Record<"administration" | "teaching" | "support" | "medical", StaffCategory> = {
  administration: "administration",
  teaching: "teacher",
  support: "support",
  medical: "support",
};

/** Domain color token → hex (tailwind.config.cjs brand/status palette). */
const COLOR_TO_HEX: Record<string, string> = {
  "brand-blue": "#349bd4",
  "brand-blue-deep": "#2b7fb0",
  "brand-gold": "#c8a98c",
  "brand-brown": "#836c68",
  "brand-slate": "#3b464c",
  "status-success": "#3fa66e",
  "status-warning": "#c8a98c",
  "status-danger": "#c0504d",
  "status-info": "#6ec1e4",
};

/**
 * Hex → domain color token (reverse lookup, falls back to brand-blue).
 * FIRST-WINS: two tokens share the same hex (brand-gold and status-warning
 * are both #c8a98c, brand-blue-light and status-info both #6ec1e4) — the
 * brand token wins because it is listed first.
 */
const HEX_TO_COLOR: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [token, hex] of Object.entries(COLOR_TO_HEX)) {
    if (!(hex.toLowerCase() in map)) map[hex.toLowerCase()] = token;
  }
  return map;
})();

// ============================================================================
// Roles lookup (uuid ↔ Role code) — migration 0003
// ============================================================================

/**
 * Lazy-cached bidirectional map between `roles.id` (uuid, stored on
 * personnel.role_id) and `roles.code` (the domain Role enum value).
 */
export class RoleLookup {
  private byCode = new Map<string, string>();
  private byId = new Map<string, string>();
  private loaded = false;

  constructor(private readonly client: SupabaseClient) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const { data, error } = await this.client.from("roles").select("id, code");
      if (error) throw error;
      for (const row of (data ?? []) as Pick<RoleRow, "id" | "code">[]) {
        this.byCode.set(row.code, row.id);
        this.byId.set(row.id, row.code);
      }
    } catch {
      // Leave the maps empty — personnel rows read back with the default role.
    }
  }

  /** Role code (domain) → roles.id (uuid). Null when unknown. */
  toId(code: string): string | null {
    return this.byCode.get(code) ?? null;
  }

  /** roles.id (uuid) → Role code (domain). Null when unknown. */
  toCode(id: string | null): string | null {
    if (!id) return null;
    return this.byId.get(id) ?? null;
  }
}

// ============================================================================
// Personnel row ↔ domain mapping
// ============================================================================

function mapPersonnelRow(
  row: Record<string, any>,
  roleCode: string | null,
): Personnel {
  const deletedAt = row.deleted_at ?? null;
  const endDate = row.end_date ?? null;
  let status: PersonnelStatus;
  if (deletedAt) status = "archived";
  else if (row.is_active === false && endDate) status = "terminated";
  else if (row.is_active === false) status = "suspended";
  else status = "active";

  // notes: stored as a JSON array in the text column (header note in the
  // class doc) — plain-text values are wrapped into a single note entry.
  let notes: Personnel["notes"] = [];
  if (typeof row.notes === "string" && row.notes.trim().length > 0) {
    try {
      const parsed = JSON.parse(row.notes);
      if (Array.isArray(parsed)) notes = parsed as Personnel["notes"];
      else
        notes = [
          {
            id: `note-${row.id}`,
            authorId: "system",
            authorName: "Système",
            body: row.notes,
            createdAt: row.updated_at ?? nowIso(),
          },
        ];
    } catch {
      notes = [
        {
          id: `note-${row.id}`,
          authorId: "system",
          authorName: "Système",
          body: row.notes,
          createdAt: row.updated_at ?? nowIso(),
        },
      ];
    }
  }

  const emergency = (row.emergency_contact ?? {}) as Record<string, unknown>;
  const emergencyContact =
    typeof emergency.name === "string" && (emergency.name as string).length > 0
      ? {
          name: String(emergency.name),
          phone: String(emergency.phone ?? ""),
          relation: String(emergency.relation ?? "—"),
        }
      : null;

  const dbCategory = (row.staff_category ?? "support") as keyof typeof CATEGORY_FROM_DB;

  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id ?? null,
    firstName: row.first_name,
    lastName: row.last_name,
    staffCategory: CATEGORY_FROM_DB[dbCategory] ?? "support",
    roleId: (roleCode as Role) ?? Role.SupportStaff,
    departmentId: row.department_id ?? null,
    supervisorId: row.supervisor_id ?? null,
    position: row.position ?? "",
    phone: row.primary_phone ?? "",
    email: row.email ?? null,
    address: row.address ?? null,
    hireDate: row.hire_date ?? "",
    terminationDate: endDate,
    salary: row.base_salary != null ? Number(row.base_salary) : null,
    paymentMethod: (row.payment_method ?? null) as Personnel["paymentMethod"],
    bankAccount: row.bank_account ?? null,
    // No DB columns — see header note 4.
    weeklyHoursTarget: 40,
    weeklyHoursLogged: 0,
    avatarUrl: null,
    status,
    bonuses: (row.bonuses_json ?? []) as Personnel["bonuses"],
    documents: (row.documents_json ?? []) as Personnel["documents"],
    notes,
    emergencyContact,
    dateOfBirth: row.date_of_birth ?? null,
    nationalId: row.national_id ?? null,
  };
}

/** Domain Personnel patch → personnel table row patch (snake_case). */
function personnelToPatch(
  p: Partial<Personnel>,
  roles: RoleLookup,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (p.firstName !== undefined) patch.first_name = p.firstName;
  if (p.lastName !== undefined) patch.last_name = p.lastName;
  if (p.staffCategory !== undefined)
    patch.staff_category = CATEGORY_TO_DB[p.staffCategory];
  if (p.roleId !== undefined) {
    const roleId = roles.toId(p.roleId as string);
    // Unknown role codes keep the previous value (null only when unset).
    if (roleId) patch.role_id = roleId;
  }
  if (p.departmentId !== undefined)
    patch.department_id = isUuid(p.departmentId) ? p.departmentId : null;
  if (p.supervisorId !== undefined)
    patch.supervisor_id = isUuid(p.supervisorId) ? p.supervisorId : null;
  if (p.userId !== undefined)
    patch.user_id = isUuid(p.userId) ? p.userId : null;
  if (p.position !== undefined) patch.position = p.position;
  if (p.phone !== undefined) patch.primary_phone = p.phone;
  if (p.email !== undefined) patch.email = p.email;
  if (p.address !== undefined) patch.address = p.address;
  if (p.hireDate !== undefined) patch.hire_date = p.hireDate;
  if (p.dateOfBirth !== undefined) patch.date_of_birth = p.dateOfBirth || null;
  if (p.nationalId !== undefined) patch.national_id = p.nationalId || null;
  if (p.salary !== undefined) patch.base_salary = p.salary;
  if (p.paymentMethod !== undefined) {
    // "mobile_money" violates the DB CHECK constraint (header note 3).
    patch.payment_method =
      p.paymentMethod === "cash" ||
      p.paymentMethod === "bank_transfer" ||
      p.paymentMethod === "check"
        ? p.paymentMethod
        : null;
  }
  if (p.bankAccount !== undefined) patch.bank_account = p.bankAccount;
  if (p.bonuses !== undefined) patch.bonuses_json = p.bonuses;
  if (p.documents !== undefined) patch.documents_json = p.documents;
  if (p.notes !== undefined) {
    // JSON-encoded array in the text `notes` column (round-trips via the
    // mapper above).
    patch.notes = p.notes.length > 0 ? JSON.stringify(p.notes) : null;
  }
  if (p.emergencyContact !== undefined) {
    patch.emergency_contact = p.emergencyContact
      ? {
          name: p.emergencyContact.name,
          phone: p.emergencyContact.phone,
          relation: p.emergencyContact.relation,
        }
      : {};
  }
  if (p.status !== undefined) {
    // Reconstruct is_active / end_date / deleted_at from the domain status.
    patch.is_active = p.status === "active" || p.status === "on_leave";
    if (p.status === "terminated") patch.end_date = p.terminationDate ?? nowIso().slice(0, 10);
    if (p.status === "archived") patch.deleted_at = nowIso();
  }
  if (p.terminationDate !== undefined) patch.end_date = p.terminationDate || null;
  return patch;
}

// ============================================================================
// SupabasePersonnelRepository
// ============================================================================

export class SupabasePersonnelRepository implements PersonnelRepository {
  private readonly cache = new SubjectBehavior<Personnel[]>([]);
  private readonly byIdCache = new Map<string, SubjectBehavior<Personnel | null>>();
  private readonly roles: RoleLookup;
  // T-034/CROSS-104: TTL + focus freshness policy (replaces the one-shot seeded flag)
  private readonly freshness = new CacheFreshness();

  constructor(
    private readonly client: SupabaseClient,
    roles?: RoleLookup,
  ) {
    this.roles = roles ?? new RoleLookup(client);
  }

  /** Fetch all non-deleted personnel rows of the tenant into the cache. */
  private async refresh(): Promise<void> {
    try {
      await this.roles.load();
      const { data, error } = await this.client
        .from("personnel")
        .select("*")
        .eq("tenant_id", getTenantId())
        .is("deleted_at", null)
        .order("last_name", { ascending: true });

      if (error) throw error;
      const mapped = (data ?? []).map((row: Record<string, any>) =>
        mapPersonnelRow(row, this.roles.toCode(row.role_id)),
      );
      this.cache.set(mapped);
      // Keep per-id subjects fresh for open detail drawers.
      for (const [id, subject] of this.byIdCache) {
        subject.set(mapped.find((p) => p.id === id) ?? null);
      }
    } catch {
      // Silently degrade to the current cache.
    }
  }

  private seed(): void {
    if (!this.freshness.shouldReseed()) return;
    this.freshness.markSeeded();
    void this.refresh();
  }

  observe(): Observable<Personnel[]> {
    this.seed();
    return this.cache;
  }

  observeByCategory(category: string): Observable<Personnel[]> {
    this.seed();
    return derived(
      [this.cache],
      () => this.cache.get().filter((p) => p.staffCategory === category),
    );
  }

  observeById(id: string): Observable<Personnel | null> {
    this.seed();
    if (!this.byIdCache.has(id)) {
      this.byIdCache.set(id, new SubjectBehavior<Personnel | null>(null));
    }
    return derived(
      [this.cache, this.byIdCache.get(id)!],
      () => this.cache.get().find((p) => p.id === id) ?? this.byIdCache.get(id)?.get() ?? null,
    );
  }

  /**
   * Lookup by auth userId (iteration 9) — the personnel dashboard tabs resolve
   * the signed-in staff member through this stream.
   */
  observeByUserId(userId: string): Observable<Personnel | null> {
    this.seed();
    return derived(
      [this.cache],
      () => this.cache.get().find((p) => p.userId === userId) ?? null,
    );
  }

  async createPersonnel(
    input: Omit<Personnel, "id" | "tenantId" | "weeklyHoursLogged">,
  ): Promise<Result<Personnel>> {
    await this.roles.load();

    const year = new Date().getFullYear();
    const identity = `${input.firstName}|${input.lastName}|${input.phone}`;
    const personnelCode = `PER-${year}-${stableHash(identity)}`;

    const insert: Record<string, unknown> = {
      tenant_id: getTenantId(),
      personnel_code: personnelCode,
      ...personnelToPatch(input as Partial<Personnel>, this.roles),
      is_active: input.status === "active" || input.status === "on_leave",
    };

    const { data, error } = await this.client
      .from("personnel")
      .insert(insert)
      .select()
      .single();

    if (error) {
      // personnel_code collision (unique per tenant) — retry with a random
      // suffix so two employees with identical identity fields can coexist.
      if (error.code === "23505") {
        const retry = await this.client
          .from("personnel")
          .insert({
            ...insert,
            personnel_code: `${personnelCode}-${Math.random()
              .toString(36)
              .slice(2, 5)
              .toUpperCase()}`,
          })
          .select()
          .single();
        if (retry.error) return Err(supabaseErrorToAppError(retry.error));
        return this.afterWrite(retry.data);
      }
      return Err(supabaseErrorToAppError(error));
    }
    return this.afterWrite(data);
  }

  async updatePersonnel(
    id: string,
    updates: Partial<Personnel>,
  ): Promise<Result<Personnel>> {
    await this.roles.load();
    const patch = {
      ...personnelToPatch(updates, this.roles),
      updated_at: nowIso(),
    };

    const { data, error } = await this.client
      .from("personnel")
      .update(patch)
      .eq("id", id)
      .eq("tenant_id", getTenantId())
      .select()
      .single();

    if (error) return Err(supabaseErrorToAppError(error));
    return this.afterWrite(data);
  }

  /**
   * Soft-delete (`deleted_at = now()`) — never a hard DELETE: releve_entries,
   * class homeroom references and audit history must survive (plan §09).
   */
  async deletePersonnel(id: string): Promise<Result<void>> {
    const { error } = await this.client
      .from("personnel")
      .update({ deleted_at: nowIso(), is_active: false, updated_at: nowIso() })
      .eq("id", id)
      .eq("tenant_id", getTenantId());

    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(undefined);
  }

  /** Map a freshly written row, refresh the caches, and return the domain object. */
  private async afterWrite(row: Record<string, any>): Promise<Result<Personnel>> {
    const mapped = mapPersonnelRow(row, this.roles.toCode(row.role_id));
    this.byIdCache.get(mapped.id)?.set(mapped);
    await this.refresh();
    return Ok(mapped);
  }
}

// ============================================================================
// Departments row ↔ domain mapping
// ============================================================================

function mapDepartmentRow(row: Record<string, any>): Department {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name_fr,
    description: row.description ?? "",
    color: row.color_hex ? HEX_TO_COLOR[String(row.color_hex).toLowerCase()] ?? "brand-blue" : "brand-blue",
    headId: row.head_personnel_id ?? null,
    // No `parent_id` column in the schema (header note 7).
    parentId: null,
    createdAt: row.created_at,
    archivedAt: row.is_archived ? (row.updated_at ?? row.created_at) : null,
  };
}

// ============================================================================
// SupabaseDepartmentRepository
// ============================================================================

export class SupabaseDepartmentRepository implements DepartmentRepository {
  private readonly cache = new SubjectBehavior<Department[]>([]);
  // T-034/CROSS-104: TTL + focus freshness policy (replaces the one-shot seeded flag)
  private readonly freshness = new CacheFreshness();

  constructor(private readonly client: SupabaseClient) {}

  private async refresh(): Promise<void> {
    try {
      const { data, error } = await this.client
        .from("departments")
        .select("*")
        .eq("tenant_id", getTenantId())
        .order("sort_order", { ascending: true });

      if (error) throw error;
      this.cache.set((data ?? []).map(mapDepartmentRow));
    } catch {
      // Silently degrade to the current cache.
    }
  }

  private seed(): void {
    if (!this.freshness.shouldReseed()) return;
    this.freshness.markSeeded();
    void this.refresh();
  }

  observe(): Observable<Department[]> {
    this.seed();
    return this.cache;
  }

  observeById(id: string): Observable<Department | null> {
    this.seed();
    return derived(
      [this.cache],
      () => this.cache.get().find((d) => d.id === id) ?? null,
    );
  }

  async createDepartment(
    input: Omit<Department, "id" | "tenantId" | "createdAt" | "archivedAt">,
  ): Promise<Result<Department>> {
    // departments.code — NOT NULL, unique per tenant, max ~8 chars by
    // convention ('ADM', 'TCH', …). Derive a stable short code from the name.
    const base = input.name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase()
      .slice(0, 4);
    const code = `${base || "DEPT"}-${stableHash(input.name)}`;

    const { data, error } = await this.client
      .from("departments")
      .insert({
        tenant_id: getTenantId(),
        code,
        name_fr: input.name,
        description: input.description || null,
        color_hex: COLOR_TO_HEX[input.color] ?? COLOR_TO_HEX["brand-blue"],
        head_personnel_id: isUuid(input.headId) ? input.headId : null,
        is_active: true,
        is_archived: false,
      })
      .select()
      .single();

    if (error) {
      // Code collision — retry with a random suffix.
      if (error.code === "23505") {
        const retry = await this.client
          .from("departments")
          .insert({
            tenant_id: getTenantId(),
            code: `${code}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`,
            name_fr: input.name,
            description: input.description || null,
            color_hex: COLOR_TO_HEX[input.color] ?? COLOR_TO_HEX["brand-blue"],
            head_personnel_id: isUuid(input.headId) ? input.headId : null,
            is_active: true,
            is_archived: false,
          })
          .select()
          .single();
        if (retry.error) return Err(supabaseErrorToAppError(retry.error));
        await this.refresh();
        return Ok(mapDepartmentRow(retry.data as DepartmentRow));
      }
      return Err(supabaseErrorToAppError(error));
    }
    await this.refresh();
    return Ok(mapDepartmentRow(data as DepartmentRow));
  }

  async updateDepartment(
    id: string,
    updates: Partial<Department>,
  ): Promise<Result<Department>> {
    const patch: Record<string, unknown> = { updated_at: nowIso() };
    if (updates.name !== undefined) patch.name_fr = updates.name;
    if (updates.description !== undefined)
      patch.description = updates.description || null;
    if (updates.color !== undefined)
      patch.color_hex = COLOR_TO_HEX[updates.color] ?? COLOR_TO_HEX["brand-blue"];
    if (updates.headId !== undefined)
      patch.head_personnel_id = isUuid(updates.headId) ? updates.headId : null;
    if (updates.archivedAt !== undefined)
      patch.is_archived = updates.archivedAt !== null;

    const { data, error } = await this.client
      .from("departments")
      .update(patch)
      .eq("id", id)
      .eq("tenant_id", getTenantId())
      .select()
      .single();

    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(mapDepartmentRow(data as DepartmentRow));
  }

  async archiveDepartment(id: string): Promise<Result<Department>> {
    return this.updateDepartment(id, { archivedAt: nowIso() });
  }

  async unarchiveDepartment(id: string): Promise<Result<Department>> {
    return this.updateDepartment(id, { archivedAt: null });
  }

  /**
   * Hard-delete. personnel.department_id is ON DELETE SET NULL (migration
   * 0010) so staff records survive; head_personnel_id likewise.
   */
  async deleteDepartment(id: string): Promise<Result<void>> {
    const { error } = await this.client
      .from("departments")
      .delete()
      .eq("id", id)
      .eq("tenant_id", getTenantId());

    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(undefined);
  }
}
