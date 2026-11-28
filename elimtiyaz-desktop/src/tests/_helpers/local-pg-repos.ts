/**
 * T-626 — the Postgres-backed repository set for the local offline
 * database (`scripts/schema-test`, the T-625 harness).
 *
 * Mirrors `supabase-shared-repositories.ts` wire-for-wire so the REAL
 * ImportEngine + RepositoryStorageAdapter run against REAL canonical
 * RPCs / table constraints:
 *  - parents/students → upsert_parent_from_import / upsert_student_from_import
 *    (deterministic codes, out_* columns, the production payloads);
 *  - ledger/payments/installments → the chunked
 *    `INSERT ... ON CONFLICT (id) DO NOTHING RETURNING` wire form
 *    PostgREST's `ignoreDuplicates: true` emits (T-421 semantics);
 *  - the re-import preflights → keyset-paginated database reads
 *    (listImportLedgerSourceKeys / listImportPaymentNumbers /
 *    listImportInstallmentIdentities, year-scoped per T-439);
 *  - receipt numbers → the generate_receipt_numbers RPC;
 *  - installment rows → the INV-14 academic-year stamp.
 *
 * Reuses the production row mappers (mapStudentRow / mapPaymentRow /
 * mapInstallmentRow are exported from supabase-shared-repositories).
 */
import type { Client } from "pg";
import {
  mapStudentRow,
  mapPaymentRow,
  mapInstallmentRow,
} from "../../infrastructure/supabase/repositories/supabase-shared-repositories";
import {
  deterministicParentCode,
  deterministicStudentCode,
  deterministicActivationCode,
} from "../../core/format/id";
import { toIsoDate } from "../../core/format/date";
import { SubjectBehavior } from "../../infrastructure/mock/subject-behavior";
import { Ok, Err } from "../../core/result";
import { Errors } from "../../core/app-error";
import type {
  ParentRepository,
  StudentRepository,
  LedgerRepository,
  PaymentRepository,
  InstallmentRepository,
  Observable,
  ImportInstallmentInput,
} from "../../domain/repository/repository";
import type { Result } from "../../core/result";
import type { Parent, CreateParentInput, UpdateParentInput } from "../../domain/model/parent";
import type { Student, CreateStudentInput } from "../../domain/model/student";
import type { LedgerEntry } from "../../domain/model/ledger";
import type { Payment, Installment, CollectPaymentInput, PaymentCategory } from "../../domain/model/payment";

// ── Postgres-backed repositories (the production wire, mirrored) ───────────

/** Shared context: one client, the tenant, the staff actor. */
export interface PgCtx {
  client: Client;
  tenantId: string;
  profileId: string;
}

function pgErr(e: unknown): Result<never> {
  return Err(Errors.server(e instanceof Error ? e.message : String(e))) as Result<never>;
}

export class PgParentRepo implements ParentRepository {
  private readonly cache = new SubjectBehavior<Parent[]>([]);
  constructor(private readonly ctx: PgCtx) {}

  observe(): Observable<Parent[]> { return this.cache; }
  observeById(id: string): Observable<Parent | null> {
    return new SubjectBehavior<Parent | null>(null);
  }

  private mapRow(r: Record<string, unknown>): Parent {
    return {
      id: String(r.id),
      tenantId: String(r.tenant_id),
      code: String(r.parent_code),
      firstName: String(r.first_name ?? ""),
      lastName: String(r.last_name ?? ""),
      displayName: (r.display_name as string | null) ?? null,
      gender: "unspecified",
      phone: String(r.primary_phone ?? ""),
      whatsapp: (r.secondary_phone as string | null) ?? null,
      email: (r.email as string | null) ?? null,
      occupation: (r.occupation as string | null) ?? null,
      address: (r.address as string | null) ?? null,
      cityTier: null,
      transportDestination: null,
      preferredLanguage: "fr",
      avatarUrl: null,
      authUserId: (r.auth_user_id as string | null) ?? null,
      createdAt: String(r.created_at ?? ""),
      updatedAt: String(r.updated_at ?? ""),
    };
  }

  async search(query: string): Promise<Result<Parent[]>> {
    try {
      const q = query.toLowerCase().trim();
      const { rows } = await this.ctx.client.query(
        `select * from parents
         where tenant_id = $1 and deleted_at is null and is_active
           and ($2 = '' or lower(first_name || ' ' || last_name || ' ' || coalesce(display_name,'') || ' ' || primary_phone || ' ' || parent_code) like '%' || $2 || '%')
         order by last_name, first_name`,
        [this.ctx.tenantId, q],
      );
      return Ok(rows.map((r) => this.mapRow(r)));
    } catch (e) {
      return pgErr(e);
    }
  }

  /** The canonical write path — the production createParentTracked wire. */
  async createParentTracked(input: CreateParentInput): Promise<Result<{ parent: Parent; wasInserted: boolean }>> {
    try {
      const tenantId = this.ctx.tenantId;
      const year = new Date().getFullYear();
      const parentCode = deterministicParentCode(year, input);
      const activationCodeValue = deterministicActivationCode(parentCode, tenantId);
      const { rows } = await this.ctx.client.query(
        `select * from upsert_parent_from_import(
           p_tenant_id := $1, p_parent_code := $2, p_first_name := $3, p_last_name := $4,
           p_display_name := $5, p_primary_phone := $6, p_secondary_phone := $7,
           p_email := $8, p_occupation := $9, p_address := $10, p_relationship := null,
           p_preferred_language := 'fr', p_is_active := true, p_activation_code := $11,
           p_transport_destination := null, p_city_tier := null)`,
        [
          tenantId,
          parentCode,
          input.firstName,
          input.lastName,
          input.displayName ?? `${input.firstName} ${input.lastName}`.trim(),
          input.phone,
          input.whatsapp ?? null,
          input.email ?? null,
          input.occupation ?? null,
          input.address ?? null,
          activationCodeValue,
        ],
      );
      const row = rows[0];
      if (!row?.out_parent_id) throw new Error("upsert_parent_from_import returned no rows");
      const full = await this.ctx.client.query(`select * from parents where id = $1`, [row.out_parent_id]);
      return Ok({ parent: this.mapRow(full.rows[0]), wasInserted: row.out_was_inserted === true });
    } catch (e) {
      return pgErr(e);
    }
  }

  async createParent(input: CreateParentInput): Promise<Result<Parent>> {
    const r = await this.createParentTracked(input);
    return r.ok ? Ok(r.value.parent) : r as Result<Parent>;
  }

  async updateParent(id: string, updates: UpdateParentInput): Promise<Result<Parent>> {
    try {
      const sets: string[] = [];
      const vals: unknown[] = [];
      const add = (col: string, v: unknown) => {
        vals.push(v);
        sets.push(`${col} = $${vals.length}`);
      };
      if (updates.firstName !== undefined) add("first_name", updates.firstName);
      if (updates.lastName !== undefined) add("last_name", updates.lastName);
      if (updates.displayName !== undefined) add("display_name", updates.displayName);
      if (updates.phone !== undefined) add("primary_phone", updates.phone);
      if (updates.whatsapp !== undefined) add("secondary_phone", updates.whatsapp);
      if (updates.email !== undefined) add("email", updates.email);
      if (updates.occupation !== undefined) add("occupation", updates.occupation);
      if (updates.address !== undefined) add("address", updates.address);
      if (sets.length === 0) {
        const cur = await this.ctx.client.query(`select * from parents where id = $1`, [id]);
        return Ok(this.mapRow(cur.rows[0]));
      }
      vals.push(this.ctx.tenantId, id);
      const { rows } = await this.ctx.client.query(
        `update parents set ${sets.join(", ")}, updated_at = now()
         where tenant_id = $${vals.length - 1} and id = $${vals.length} returning *`,
        vals,
      );
      if (rows.length === 0) throw new Error(`updateParent: no row for ${id}`);
      return Ok(this.mapRow(rows[0]));
    } catch (e) {
      return pgErr(e);
    }
  }

  async deleteParent(id: string): Promise<Result<void>> {
    try {
      await this.ctx.client.query(
        `update parents set deleted_at = now(), is_active = false where tenant_id = $1 and id = $2`,
        [this.ctx.tenantId, id],
      );
      return Ok(undefined);
    } catch (e) {
      return pgErr(e);
    }
  }
}

export class PgStudentRepo implements StudentRepository {
  private readonly cache = new SubjectBehavior<Student[]>([]);
  constructor(private readonly ctx: PgCtx) {}

  observe(): Observable<Student[]> { return this.cache; }
  observeByParent(_parentId: string): Observable<Student[]> { return this.cache; }
  observeByClass(_classId: string): Observable<Student[]> { return this.cache; }
  observeById(_id: string): Observable<Student | null> { return new SubjectBehavior<Student | null>(null); }

  async search(query: string): Promise<Result<Student[]>> {
    try {
      const q = query.toLowerCase().trim();
      const { rows } = await this.ctx.client.query(
        `select * from students
         where tenant_id = $1 and deleted_at is null and is_active
           and ($2 = '' or lower(first_name || ' ' || last_name || ' ' || coalesce(display_name,'') || ' ' || student_code) like '%' || $2 || '%')
         order by last_name, first_name`,
        [this.ctx.tenantId, q],
      );
      return Ok(rows.map((r) => mapStudentRow(r as never)));
    } catch (e) {
      return pgErr(e);
    }
  }

  /** The canonical write path — the production createStudentTracked wire. */
  async createStudentTracked(parentId: string, input: CreateStudentInput): Promise<Result<{ student: Student; wasInserted: boolean }>> {
    try {
      const tenantId = this.ctx.tenantId;
      const year = new Date().getFullYear();
      const code = deterministicStudentCode(year, parentId, input);
      const { rows } = await this.ctx.client.query(
        `select * from upsert_student_from_import(
           p_tenant_id := $1, p_student_code := $2, p_parent_id := $3,
           p_first_name := $4, p_last_name := $5, p_display_name := $6,
           p_middle_name := $7, p_date_of_birth := $8, p_gender := $9,
           p_grade_level_id := null, p_class_id := $10, p_enrollment_date := null,
           p_enrollment_status := 'active', p_medical_notes := $11, p_is_active := true,
           p_grade_level_code := $12, p_transport_tier := $13, p_payment_plan := $14,
           p_filiere_code := $15, p_specialite_code := $16,
           p_origin_type := $17, p_previous_school_name := $18, p_previous_school_level := $19,
           p_previous_academic_year := $20, p_origin_notes := $21)`,
        [
          tenantId,
          code,
          parentId,
          input.firstName,
          input.lastName,
          input.displayName ?? `${input.firstName} ${input.lastName}`.trim(),
          input.middleName ?? null,
          input.birthDate ?? null,
          input.gender === "unspecified" ? null : input.gender,
          input.classId ?? null,
          input.medicalNotes ?? null,
          input.gradeLevel ?? null,
          input.transportTier ?? null,
          input.paymentPlan ?? "tranches",
          input.filiereCode ?? null,
          input.specialiteCode ?? null,
          input.origin?.originType ?? null,
          input.origin?.previousSchoolName ?? null,
          input.origin?.previousSchoolLevel ?? null,
          input.origin?.previousAcademicYear ?? null,
          input.origin?.originNotes ?? null,
        ],
      );
      const row = rows[0];
      if (!row?.out_student_id) throw new Error("upsert_student_from_import returned no rows");
      const full = await this.ctx.client.query(`select * from students where id = $1`, [row.out_student_id]);
      const student = mapStudentRow(full.rows[0] as never);
      const patched: Student = {
        ...student,
        gradeLevel: input.gradeLevel ?? student.gradeLevel,
        level: input.level ?? student.level,
        gradeYear: input.gradeYear ?? student.gradeYear,
        transportTier: input.transportTier ?? null,
      };
      return Ok({ student: patched, wasInserted: row.out_was_inserted === true });
    } catch (e) {
      return pgErr(e);
    }
  }

  async createStudent(parentId: string, input: CreateStudentInput): Promise<Result<Student>> {
    const r = await this.createStudentTracked(parentId, input);
    return r.ok ? Ok(r.value.student) : r as Result<Student>;
  }

  async updateStudent(id: string, updates: Partial<CreateStudentInput>): Promise<Result<Student>> {
    try {
      const sets: string[] = [];
      const vals: unknown[] = [];
      const add = (col: string, v: unknown) => {
        vals.push(v);
        sets.push(`${col} = $${vals.length}`);
      };
      if (updates.firstName !== undefined) add("first_name", updates.firstName);
      if (updates.lastName !== undefined) add("last_name", updates.lastName);
      if (updates.displayName !== undefined) add("display_name", updates.displayName);
      if (updates.medicalNotes !== undefined) add("medical_notes", updates.medicalNotes);
      if (updates.gradeLevel !== undefined) add("grade_level_code", updates.gradeLevel);
      if (updates.transportTier !== undefined) add("transport_tier", updates.transportTier);
      if (sets.length === 0) {
        const cur = await this.ctx.client.query(`select * from students where id = $1`, [id]);
        return Ok(mapStudentRow(cur.rows[0] as never));
      }
      vals.push(this.ctx.tenantId, id);
      const { rows } = await this.ctx.client.query(
        `update students set ${sets.join(", ")}, updated_at = now()
         where tenant_id = $${vals.length - 1} and id = $${vals.length} returning *`,
        vals,
      );
      if (rows.length === 0) throw new Error(`updateStudent: no row for ${id}`);
      return Ok(mapStudentRow(rows[0] as never));
    } catch (e) {
      return pgErr(e);
    }
  }

  async deleteStudent(id: string): Promise<Result<void>> {
    try {
      await this.ctx.client.query(
        `update students set deleted_at = now(), is_active = false where tenant_id = $1 and id = $2`,
        [this.ctx.tenantId, id],
      );
      return Ok(undefined);
    } catch (e) {
      return pgErr(e);
    }
  }

  async batchRegister(): Promise<Result<import("../../domain/model/student").BatchRegistrationResult>> {
    return Err(Errors.server("not implemented in the T-626 local-pg repo"));
  }
  async promote(): Promise<Result<Student[]>> {
    return Err(Errors.server("not implemented in the T-626 local-pg repo"));
  }
  async addStudentDocument(): Promise<Result<import("../../domain/model/student").StudentDocument>> {
    return Err(Errors.server("not implemented in the T-626 local-pg repo"));
  }
  async removeStudentDocument(): Promise<Result<void>> {
    return Err(Errors.server("not implemented in the T-626 local-pg repo"));
  }
}

export class PgLedgerRepo implements LedgerRepository {
  constructor(private readonly ctx: PgCtx) {}

  observe(): Observable<LedgerEntry[]> { return new SubjectBehavior<LedgerEntry[]>([]); }
  observeByParent(_parentId: string): Observable<LedgerEntry[]> { return new SubjectBehavior<LedgerEntry[]>([]); }
  observeByAccount(_accountId: string): Observable<LedgerEntry[]> { return new SubjectBehavior<LedgerEntry[]>([]); }

  async append(entry: LedgerEntry): Promise<Result<LedgerEntry>> {
    const r = await this.bulkAppendWithProgress([entry]);
    return r.ok ? Ok(r.value[0] ?? entry) : r as Result<LedgerEntry>;
  }
  async appendMany(entries: readonly LedgerEntry[]): Promise<Result<readonly LedgerEntry[]>> {
    return this.bulkAppendWithProgress(entries);
  }
  async bulkAppend(entries: readonly LedgerEntry[]): Promise<Result<readonly LedgerEntry[]>> {
    return this.bulkAppendWithProgress(entries);
  }

  /**
   * The production bulkAppendWithProgress wire form: 500-row chunks of
   * `INSERT … ON CONFLICT (id) DO NOTHING RETURNING …` — the exact SQL
   * PostgREST's `ignoreDuplicates: true` emits (T-421's live-proven
   * semantics: the PK-only arbiter cannot suppress cross-run conflicts on
   * `ledger_entries_source_uidx`; the caller's preflight is the real
   * defense). Landed-row accounting via RETURNING, like production.
   */
  async bulkAppendWithProgress(
    entries: readonly LedgerEntry[],
    onProgress?: (landedRows: number) => void,
  ): Promise<Result<readonly LedgerEntry[]>> {
    if (entries.length === 0) return Ok([]);
    try {
      const tenantId = this.ctx.tenantId;
      const CHUNK_SIZE = 500;
      const inserted: LedgerEntry[] = [];
      for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
        const chunk = entries.slice(i, i + CHUNK_SIZE);
        const values: unknown[] = [];
        const tuples = chunk.map((e) => {
          values.push(
            e.id,
            tenantId,
            e.parentId,
            e.studentId ?? null,
            e.accountId,
            e.type,
            e.amount,
            e.category,
            e.description,
            toIsoDate(e.at) ?? new Date().toISOString(),
            e.sourceType ?? null,
            e.sourceId ?? null,
            e.method ?? null,
            e.receiptNumber ?? null,
            e.paymentStatus ?? null,
            e.reversesId ?? null,
            e.actorId ?? null,
            e.actorName ?? null,
            toIsoDate(e.at),
            e.metadata ? JSON.stringify(e.metadata) : null,
          );
          const base = values.length - 20;
          return `(${Array.from({ length: 20 }, (_, k) => `$${base + k + 1}`).join(",")})`;
        });
        const { rows } = await this.ctx.client.query(
          `insert into ledger_entries (
             entry_number, tenant_id, parent_id, student_id, account_id, entry_type,
             amount, category, description, entry_date, source_type, source_id,
             method, receipt_number, payment_status, reverses_id, actor_id, actor_name,
             at, metadata
           ) values ${tuples.join(",")}
           on conflict (id) do nothing
           returning source_id`,
          values,
        );
        const landedSourceIds = new Set(
          rows.map((r) => (r as { source_id?: string | null }).source_id).filter((s): s is string => s != null),
        );
        for (const e of chunk) {
          if (e.sourceId == null || landedSourceIds.has(e.sourceId)) inserted.push(e);
        }
        onProgress?.(inserted.length);
      }
      return Ok(inserted);
    } catch (e) {
      const insertedCount = 0;
      return Err(Errors.server(
        `bulkAppend chunk: ${e instanceof Error ? e.message : String(e)}` +
          (insertedCount > 0 ? " — ATTENTION : état PARTIEL." : " — aucun bloc n'avait encore été écrit (état intact)."),
      ));
    }
  }

  /** The T-421 re-import preflight — keyset-paginated, fail-closed. */
  async listImportLedgerSourceKeys(): Promise<Set<string>> {
    const tenantId = this.ctx.tenantId;
    const keys = new Set<string>();
    let lastId: string | null = null;
    for (;;) {
      const { rows }: { rows: Array<{ id: string; source_type: string | null; source_id: string | null }> } = await this.ctx.client.query(
        `select id, source_type, source_id from ledger_entries
         where tenant_id = $1 and ($2::uuid is null or id > $2)
         order by id asc limit 1000`,
        [tenantId, lastId],
      );
      for (const r of rows) {
        if (r.source_type != null && r.source_id != null) {
          keys.add(`${r.source_type}|${r.source_id}`);
        }
      }
      if (rows.length < 1000) break;
      lastId = rows[rows.length - 1].id;
    }
    return keys;
  }

  async reverse(_originalId: string, _reason: string, _actorId: string, _actorName: string): Promise<Result<LedgerEntry>> {
    return Err(Errors.server("not implemented in the T-626 local-pg repo"));
  }
  async summary(_parentId: string): Promise<Result<import("../../domain/model/ledger").ParentLedgerSummary>> {
    return Err(Errors.server("not implemented in the T-626 local-pg repo"));
  }
  async reconcile(): Promise<Result<import("../../domain/calc/reconcile").ReconciliationReport>> {
    return Err(Errors.server("not implemented in the T-626 local-pg repo"));
  }
}

export class PgPaymentRepo implements PaymentRepository {
  constructor(private readonly ctx: PgCtx) {}

  observe(): Observable<Payment[]> { return new SubjectBehavior<Payment[]>([]); }
  observeByParent(_parentId: string): Observable<Payment[]> { return new SubjectBehavior<Payment[]>([]); }
  observeByStudent(_studentId: string): Observable<Payment[]> { return new SubjectBehavior<Payment[]>([]); }
  observeById(_id: string): Observable<Payment | null> { return new SubjectBehavior<Payment | null>(null); }

  /**
   * The production bulkCollectWithProgress wire form: server receipt-number
   * allocation (generate_receipt_numbers RPC) then 500-row chunks of
   * `INSERT … ON CONFLICT (id) DO NOTHING RETURNING …` with honest landed
   * accounting.
   */
  async bulkCollectWithProgress(
    inputs: ReadonlyArray<{ input: CollectPaymentInput; collectedBy: string }>,
    onProgress?: (landedRows: number) => void,
  ): Promise<Result<readonly Payment[]>> {
    if (inputs.length === 0) return Ok([]);
    try {
      const tenantId = this.ctx.tenantId;
      const now = new Date().toISOString();
      const missingCount = inputs.filter(({ input }) => !input.receiptNumber).length;
      let allocated: string[] = [];
      if (missingCount > 0) {
        const { rows: allocRows } = await this.ctx.client.query(
          `select * from generate_receipt_numbers($1, $2)`,
          [tenantId, missingCount],
        );
        allocated = allocRows.map((r) => r.receipt_number);
        if (allocated.length !== missingCount) {
          throw new Error(`server allocated ${allocated.length} receipt numbers, expected ${missingCount}`);
        }
      }
      let allocIndex = 0;
      const CHUNK_SIZE = 500;
      const inserted: Payment[] = [];
      for (let i = 0; i < inputs.length; i += CHUNK_SIZE) {
        const chunk = inputs.slice(i, i + CHUNK_SIZE);
        const values: unknown[] = [];
        const tuples = chunk.map(({ input, collectedBy }) => {
          const paymentNumber = input.receiptNumber ?? allocated[allocIndex++];
          values.push(
            tenantId,
            paymentNumber,
            input.receiptNumber ?? null,
            input.parentId,
            input.studentId ?? null,
            input.amount,
            input.method,
            input.category ?? "tuition",
            input.method === "cash" ? "paid" : "pending",
            input.proofUrl ?? null,
            input.collectedAt ?? now,
            collectedBy,
            input.notes ?? null,
            (input as { expectedAmount?: number }).expectedAmount ?? 0,
            (input as { excessAmount?: number }).excessAmount ?? 0,
            (input as { excessRemark?: string | null }).excessRemark ?? null,
          );
          const base = values.length - 16;
          return `(${Array.from({ length: 16 }, (_, k) => `$${base + k + 1}`).join(",")})`;
        });
        const { rows } = await this.ctx.client.query(
          `insert into payments (
             tenant_id, payment_number, receipt_number, parent_id, student_id,
             amount, method, category, status, proof_path, collected_at, collected_by,
             notes, expected_amount, excess_amount, excess_remark
           ) values ${tuples.join(",")}
           on conflict (id) do nothing
           returning id, tenant_id, payment_number, receipt_number, parent_id, student_id, amount, method, status, category, installment_id, proof_path, notes, collected_by, collected_at, created_at, updated_at`,
          values,
        );
        for (const row of rows) inserted.push(mapPaymentRow(row as never));
        onProgress?.(inserted.length);
      }
      return Ok(inserted);
    } catch (e) {
      return Err(Errors.server(`bulkCollect: ${e instanceof Error ? e.message : String(e)}`));
    }
  }

  async bulkCollect(inputs: ReadonlyArray<{ input: CollectPaymentInput; collectedBy: string }>): Promise<Result<readonly Payment[]>> {
    return this.bulkCollectWithProgress(inputs);
  }

  /** The T-421 re-import preflight — keyset-paginated, fail-closed. */
  async listImportPaymentNumbers(): Promise<Set<string>> {
    const tenantId = this.ctx.tenantId;
    const numbers = new Set<string>();
    let lastId: string | null = null;
    for (;;) {
      const { rows }: { rows: Array<{ id: string; payment_number: string }> } = await this.ctx.client.query(
        `select id, payment_number from payments
         where tenant_id = $1 and ($2::uuid is null or id > $2)
         order by id asc limit 1000`,
        [tenantId, lastId],
      );
      for (const r of rows) numbers.add(r.payment_number);
      if (rows.length < 1000) break;
      lastId = rows[rows.length - 1].id;
    }
    return numbers;
  }

  async collect(input: CollectPaymentInput, collectedBy: string): Promise<Result<Payment>> {
    try {
      const tenantId = this.ctx.tenantId;
      const { rows } = await this.ctx.client.query(
        `select * from collect_and_allocate_payment(
           p_tenant_id := $1, p_parent_id := $2, p_student_id := $3, p_amount := $4,
           p_method := $5, p_category := $6, p_installment_id := $7, p_proof_path := $8,
           p_notes := $9, p_actor_id := $10, p_actor_name := null, p_check_number := $11,
           p_check_bank_name := $12, p_transfer_reference := $13, p_transfer_source_bank := $14)`,
        [
          tenantId,
          input.parentId,
          input.studentId ?? null,
          input.amount,
          input.method,
          input.category ?? null,
          input.installmentId ?? null,
          input.proofUrl ?? null,
          input.notes ?? null,
          this.ctx.profileId,
          input.checkNumber ?? null,
          input.checkBankName ?? null,
          input.transferReference ?? null,
          input.transferSourceBank ?? null,
        ],
      );
      void collectedBy;
      const r = rows[0];
      if (!r?.payment_id) throw new Error("collect_and_allocate_payment returned no rows");
      const full = await this.ctx.client.query(`select * from payments where id = $1`, [r.payment_id]);
      return Ok(mapPaymentRow(full.rows[0] as never));
    } catch (e) {
      return Err(Errors.unknown(e instanceof Error ? e : new Error(String(e))));
    }
  }

  async refund(): Promise<Result<Payment>> { return Err(Errors.server("not implemented in the T-626 local-pg repo")); }
  async markCleared(): Promise<Result<Payment>> { return Err(Errors.server("not implemented in the T-626 local-pg repo")); }
  async markBounced(): Promise<Result<Payment>> { return Err(Errors.server("not implemented in the T-626 local-pg repo")); }
  async adjust(): Promise<Result<import("../../domain/model/payment").AccountAdjustment>> {
    return Err(Errors.server("not implemented in the T-626 local-pg repo"));
  }
  async generateReceipt(): Promise<Result<import("../../domain/model/payment").Receipt>> {
    return Err(Errors.server("not implemented in the T-626 local-pg repo"));
  }
  async appendManualCharge(): Promise<Result<LedgerEntry>> {
    return Err(Errors.server("not implemented in the T-626 local-pg repo"));
  }
  async seed(): Promise<void> { /* no-op */ }
}

export class PgInstallmentRepo implements InstallmentRepository {
  private yearWindows: Array<{ id: string; start: number; end: number }> | null = null;

  constructor(private readonly ctx: PgCtx) {}

  observe(): Observable<Installment[]> { return new SubjectBehavior<Installment[]>([]); }
  observeByParent(_parentId: string): Observable<Installment[]> { return new SubjectBehavior<Installment[]>([]); }
  observeByStudent(_studentId: string): Observable<Installment[]> { return new SubjectBehavior<Installment[]>([]); }
  observeById(_id: string): Observable<Installment | null> { return new SubjectBehavior<Installment | null>(null); }

  /** The T-436 INV-14 window rule — same resolver the write path stamps with. */
  private async resolveAcademicYearIdForDueDate(dueDate: string): Promise<string | null> {
    if (this.yearWindows === null) {
      const { rows } = await this.ctx.client.query(
        `select id, start_date, end_date from academic_years order by start_date asc`,
      );
      const windows = rows
        .map((y: { id: string; start_date: string; end_date: string }) => ({
          id: String(y.id),
          start: new Date(y.start_date).getTime(),
          end: new Date(y.end_date).getTime(),
        }))
        .filter((y) => Number.isFinite(y.start) && Number.isFinite(y.end));
      this.yearWindows = windows;
    }
    const windows = this.yearWindows!;
    const t = new Date(dueDate).getTime();
    if (!Number.isFinite(t)) return null;
    for (let i = windows.length - 1; i >= 0; i -= 1) {
      const w = windows[i];
      if (t >= w.start && t <= w.end) return w.id;
    }
    return null;
  }

  async resolveImportAcademicYearId(dueDate: string): Promise<string | null> {
    return this.resolveAcademicYearIdForDueDate(dueDate);
  }

  /**
   * The production bulkImportInstallmentsWithProgress wire form: INV-14 year
   * stamping + 500-row chunks of `INSERT … ON CONFLICT (id) DO NOTHING
   * RETURNING …` (the IMPORT-110 wire; T-421's correction — the PK-only
   * arbiter; the preflight is the re-import defense).
   */
  async bulkImportInstallmentsWithProgress(
    inputs: readonly ImportInstallmentInput[],
    onProgress?: (landedRows: number) => void,
  ): Promise<Result<readonly Installment[]>> {
    if (inputs.length === 0) return Ok([]);
    try {
      const tenantId = this.ctx.tenantId;
      const now = new Date().toISOString();
      const yearByDueDate = new Map<string, string | null>();
      for (const input of inputs) {
        if (!yearByDueDate.has(input.dueDate)) {
          yearByDueDate.set(input.dueDate, await this.resolveAcademicYearIdForDueDate(input.dueDate));
        }
      }
      const CHUNK_SIZE = 500;
      const results: Installment[] = [];
      for (let i = 0; i < inputs.length; i += CHUNK_SIZE) {
        const chunk = inputs.slice(i, i + CHUNK_SIZE);
        const values: unknown[] = [];
        const tuples = chunk.map((input) => {
          values.push(
            tenantId,
            input.parentId,
            input.studentId,
            input.category,
            input.trancheNumber,
            input.label,
            input.amountDue,
            input.amountPaid,
            0,
            input.dueDate,
            input.paidDate ?? null,
            input.status,
            input.academicCycle ?? null,
            input.paymentPlan ?? "tranches",
            false,
            null,
            input.sourceType ?? "bulk_import",
            input.sourceId ?? `${input.studentId}:${input.category}:T${input.trancheNumber}`,
            yearByDueDate.get(input.dueDate) ?? null,
            now,
          );
          const base = values.length - 20;
          return `(${Array.from({ length: 20 }, (_, k) => `$${base + k + 1}`).join(",")})`;
        });
        const { rows } = await this.ctx.client.query(
          `insert into installments (
             tenant_id, parent_id, student_id, category, tranche_number, label,
             amount_due, amount_paid, amount_pending, due_date, paid_date, status,
             academic_cycle, payment_plan, is_custom_schedule, custom_schedule_note,
             source_type, source_id, academic_year_id, updated_at
           ) values ${tuples.join(",")}
           on conflict (id) do nothing
           returning id, tenant_id, parent_id, student_id, category, tranche_number, label, amount_due, amount_paid, amount_pending, due_date, paid_date, status, academic_cycle, payment_plan, is_custom_schedule, custom_schedule_note, source_type, source_id, academic_year_id, created_at, updated_at`,
          values,
        );
        for (const row of rows) results.push(mapInstallmentRow(row as never));
        onProgress?.(results.length);
      }
      return Ok(results);
    } catch (e) {
      return Err(Errors.server(`bulkImportInstallments: ${e instanceof Error ? e.message : String(e)}`));
    }
  }

  async bulkImportInstallments(inputs: readonly ImportInstallmentInput[]): Promise<Result<readonly Installment[]>> {
    return this.bulkImportInstallmentsWithProgress(inputs);
  }

  /** The T-439 year-scoped re-import preflight — keyset-paginated, fail-closed. */
  async listImportInstallmentIdentities(): Promise<Set<string>> {
    const tenantId = this.ctx.tenantId;
    const keys = new Set<string>();
    let lastId: string | null = null;
    for (;;) {
      const { rows }: { rows: Array<{ id: string; parent_id: string | null; student_id: string | null; category: string | null; tranche_number: number | null; academic_year_id: string | null }> } = await this.ctx.client.query(
        `select id, parent_id, student_id, category, tranche_number, academic_year_id from installments
         where tenant_id = $1 and ($2::uuid is null or id > $2)
         order by id asc limit 1000`,
        [tenantId, lastId],
      );
      for (const r of rows) {
        if (
          r.parent_id != null &&
          r.student_id != null &&
          r.category != null &&
          r.tranche_number != null
        ) {
          keys.add(`${r.parent_id}|${r.student_id}|${r.category}|${r.tranche_number}|${r.academic_year_id ?? ""}`);
        }
      }
      if (rows.length < 1000) break;
      lastId = rows[rows.length - 1].id;
    }
    return keys;
  }

  async importInstallment(input: ImportInstallmentInput): Promise<Result<Installment>> {
    try {
      const tenantId = this.ctx.tenantId;
      const yearId = await this.resolveAcademicYearIdForDueDate(input.dueDate);
      const existing = await this.ctx.client.query(
        `select id from installments
         where tenant_id = $1 and parent_id = $2 and student_id = $3 and category = $4
           and tranche_number = $5 and academic_year_id is not distinct from $6
         limit 1`,
        [tenantId, input.parentId, input.studentId, input.category, input.trancheNumber, yearId],
      );
      if (existing.rows.length > 0) {
        const { rows } = await this.ctx.client.query(
          `update installments set amount_due = $3, amount_paid = $4, status = $5, updated_at = now()
           where id = $1 and tenant_id = $2
           returning id, tenant_id, parent_id, student_id, category, tranche_number, label, amount_due, amount_paid, amount_pending, due_date, paid_date, status, academic_cycle, payment_plan, is_custom_schedule, custom_schedule_note, source_type, source_id, academic_year_id, created_at, updated_at`,
          [existing.rows[0].id, tenantId, input.amountDue, input.amountPaid, input.status],
        );
        return Ok(mapInstallmentRow(rows[0] as never));
      }
      const { rows } = await this.ctx.client.query(
        `insert into installments (
           tenant_id, parent_id, student_id, category, tranche_number, label,
           amount_due, amount_paid, amount_pending, due_date, paid_date, status,
           academic_cycle, payment_plan, is_custom_schedule, custom_schedule_note,
           source_type, source_id, academic_year_id
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10,$11,$12,$13,false,null,$14,$15,$16)
         returning id, tenant_id, parent_id, student_id, category, tranche_number, label, amount_due, amount_paid, amount_pending, due_date, paid_date, status, academic_cycle, payment_plan, is_custom_schedule, custom_schedule_note, source_type, source_id, academic_year_id, created_at, updated_at`,
        [
          tenantId, input.parentId, input.studentId, input.category, input.trancheNumber, input.label,
          input.amountDue, input.amountPaid, input.dueDate, input.paidDate ?? null, input.status,
          input.academicCycle ?? null, input.paymentPlan ?? "tranches",
          input.sourceType ?? "bulk_import",
          input.sourceId ?? `${input.studentId}:${input.category}:T${input.trancheNumber}`,
          yearId,
        ],
      );
      return Ok(mapInstallmentRow(rows[0] as never));
    } catch (e) {
      return pgErr(e);
    }
  }

  async markPaid(): Promise<Result<Installment>> { return Err(Errors.server("not implemented in the T-626 local-pg repo")); }
  async allocatePayment(): Promise<Result<import("../../domain/calc/payment/waterfall-allocator").AllocationResult>> {
    return Err(Errors.server("not implemented in the T-626 local-pg repo"));
  }
  async updateDueDate(): Promise<Result<Installment>> { return Err(Errors.server("not implemented in the T-626 local-pg repo")); }
  async regenerateForCycle(): Promise<Result<readonly Installment[]>> {
    return Err(Errors.server("not implemented in the T-626 local-pg repo"));
  }
  async findOverdue(): Promise<Result<readonly Installment[]>> {
    return Err(Errors.server("not implemented in the T-626 local-pg repo"));
  }
}

