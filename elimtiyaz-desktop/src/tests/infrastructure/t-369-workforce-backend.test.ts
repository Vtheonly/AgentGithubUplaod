/**
 * T-369 (WORKFORCE-500) — the Personnel & Workforce backend-integration
 * regression suite (the 74d3ebb commit's missing logic).
 *
 * Covers the three layers this task repaired:
 *
 *   A. The MOCK payroll semantics (MockPersonnelRepository mirrors the
 *      canonical 0095 RPCs): raise/cut/floor/one-off adjustment math, the
 *      mandatory-reason guard, the immutable adjustment history, the
 *      idempotent per-period disbursement with the period's one-offs netted
 *      into the payout, and the reactive payments stream.
 *   B. The MOCK workforce loops: the task review lifecycle (needs_review
 *      stamps the completion trail; reviewTask approves/reopens), the
 *      absence justification loop, the leave clarification loop.
 *   C. The SUPABASE repositories (fake PostgREST client — the t-178/t-099
 *      convention): reviewTask / updateTaskStatus(completionNote) / the
 *      leave clarification writes / the staff_absences loop writes / the
 *      personnel payroll RPC surface (adjust_personnel_salary +
 *      record_salary_disbursement called with the canonical parameters) /
 *      the salary embeds on personnel reads.
 *   D. Source guards: the dead parallel mock is GONE; workflow-side-effects
 *      is pinned to the directory index (the 74d3ebb split-brain); the UI
 *      no longer carries the client-side paid-state simulation; migration
 *      0095 exists with both RPCs.
 *
 * Run:
 *   npx vitest run src/tests/infrastructure/t-369-workforce-backend.test.ts
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";

import { MockPersonnelRepository } from "../../infrastructure/mock/repositories/personnel-audit-repository";
import { mockTaskRepository, mockWorkforceAttendanceRepository, mockLeaveRequestRepository } from "../../infrastructure/mock/workforce/index";
import { store } from "../../infrastructure/mock/repositories/mock-store";
import { SupabaseTaskRepository } from "../../infrastructure/supabase/repositories/supabase-task-repository";
import { SupabaseLeaveRequestRepository } from "../../infrastructure/supabase/repositories/supabase-leave-request-repository";
import { SupabaseWorkforceAttendanceRepository } from "../../infrastructure/supabase/repositories/supabase-workforce-attendance-repository";
import { SupabasePersonnelRepository } from "../../infrastructure/supabase/repositories/supabase-personnel-repository";

// ============================================================================
// Fake Supabase client — minimal PostgREST builder + rpc recorder
// (the t-178/t-099 convention, extended with rpc())
// ============================================================================

type Row = Record<string, any>;

class FakeQuery {
  private filters: ((row: Row) => boolean)[] = [];
  private mode: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row | null = null;
  private wantSingle = false;
  private wantMaybeSingle = false;
  private orderCol = "";
  private orderAsc = true;
  private limitN: number | null = null;
  private deletedCol: string | null = null;

  constructor(private readonly table: Row[]) {}

  eq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  is(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    this.deletedCol = col;
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderCol = col;
    this.orderAsc = opts?.ascending !== false;
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  select(_cols?: string): this {
    return this;
  }
  insert(row: Row): this {
    this.mode = "insert";
    this.payload = row;
    return this;
  }
  update(patch: Row): this {
    this.mode = "update";
    this.payload = patch;
    return this;
  }
  delete(): this {
    this.mode = "delete";
    return this;
  }
  single(): this {
    this.wantSingle = true;
    return this;
  }
  maybeSingle(): this {
    this.wantMaybeSingle = true;
    return this;
  }

  private run(): { data: Row | Row[] | null; error: { code?: string; message: string } | null } {
    if (this.mode === "insert") {
      const row = {
        id: `${this.table.length + 1}-uuid-new`,
        created_at: "2026-09-14T10:00:00Z",
        updated_at: "2026-09-14T10:00:00Z",
        ...this.payload,
      };
      this.table.push(row);
      return { data: row, error: null };
    }
    if (this.mode === "update") {
      const patched: Row[] = [];
      for (const row of this.table) {
        if (this.filters.every((f) => f(row))) {
          Object.assign(row, this.payload ?? {});
          patched.push(row);
        }
      }
      if (this.wantSingle || this.wantMaybeSingle) {
        if (patched.length === 0) {
          return { data: null, error: this.wantSingle ? { message: "no rows (PGRST116)" } : null };
        }
        return { data: patched[0], error: null };
      }
      return { data: patched, error: null };
    }
    if (this.mode === "delete") {
      const kept = this.table.filter((r) => !this.filters.every((f) => f(r)));
      this.table.length = 0;
      this.table.push(...kept);
      return { data: null, error: null };
    }
    let rows = this.table.filter((r) => this.filters.every((f) => f(r)));
    if (this.orderCol) {
      rows = [...rows].sort((a, b) => {
        const cmp = String(a[this.orderCol] ?? "").localeCompare(String(b[this.orderCol] ?? ""));
        return this.orderAsc ? cmp : -cmp;
      });
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    if (this.wantSingle || this.wantMaybeSingle) {
      if (rows.length === 0) {
        return { data: null, error: this.wantSingle ? { message: "no rows (PGRST116)" } : null };
      }
      return { data: rows[0], error: null };
    }
    return { data: rows, error: null };
  }

  then<TResult1>(
    onFulfilled:
      | ((value: { data: Row | Row[] | null; error: { code?: string; message: string } | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
  ): Promise<TResult1> {
    return Promise.resolve(onFulfilled!(this.run() as never));
  }
}

class FakeClient {
  tables: Record<string, Row[]> = {};
  rpcCalls: { fn: string; args: Row }[] = [];
  private rpcResponses: Record<string, Row> = {};
  /** T-400 (0104): server-side side effects a SECURITY DEFINER RPC applies
   *  to the fake tables when invoked — models e.g. respond_leave_clarification's
   *  ownership-checked pending transition. */
  rpcSideEffects: Record<string, (args: Row) => void> = {};

  from(tableName: string): FakeQuery {
    if (!this.tables[tableName]) this.tables[tableName] = [];
    return new FakeQuery(this.tables[tableName]);
  }

  rpc(fn: string, args: Row): { then<TResult1>(onFulfilled: ((value: { data: Row | null; error: null }) => TResult1) | null): Promise<TResult1> } {
    this.rpcCalls.push({ fn, args });
    this.rpcSideEffects[fn]?.(args);
    const response = this.rpcResponses[fn] ?? {};
    return {
      then<TResult1>(onFulfilled: ((value: { data: Row | null; error: null }) => TResult1) | null): Promise<TResult1> {
        return Promise.resolve(onFulfilled!({ data: response, error: null }));
      },
    };
  }

  /** Test helper: the row the next rpc(fn) call resolves with. */
  willReturn(fn: string, row: Row): void {
    this.rpcResponses[fn] = row;
  }
}

const TENANT = "00000000-0000-0000-0000-000000000001";
const ADMIN = "cccccccc-0000-0000-0000-0000000000c1";
const WORKER_UUID = "bbbbbbbb-0000-0000-0000-0000000000b1";

const fakeClient = new FakeClient();

beforeEach(() => {
  fakeClient.tables = {};
  fakeClient.rpcCalls = [];
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: TENANT, userId: ADMIN }),
  );
  return () => localStorage.removeItem("el-imtiyaz.session");
});

// ============================================================================
// A. The mock payroll semantics (mirrors the 0095 RPCs)
// ============================================================================

describe("T-369 A. MockPersonnelRepository payroll surface", () => {
  function seedWorker(salary: number, id = "per-900") {
    store.personnel = [
      {
        id,
        userId: null,
        firstName: "Test",
        lastName: "Ouvrier",
        staffCategory: "worker",
        roleId: "worker",
        departmentId: "dept-workers",
        supervisorId: null,
        position: "Ouvrier d'entretien",
        phone: "+213 000",
        email: null,
        address: null,
        hireDate: "2024-09-01",
        terminationDate: null,
        salary,
        paymentMethod: "cash",
        bankAccount: null,
        weeklyHoursTarget: 40,
        weeklyHoursLogged: 0,
        avatarUrl: null,
        status: "active",
        documents: [],
        notes: [],
        emergencyContact: null,
        dateOfBirth: null,
        nationalId: null,
        tenantId: "tenant-default",
      } as never,
    ];
    store.notifyPersonnel();
    return store.personnel[0];
  }

  it("A1. adjustSalary(raise) moves the base, appends the immutable adjustment, and rejects short reasons", async () => {
    const worker = seedWorker(50000);
    const repo = new MockPersonnelRepository();

    const res = await repo.adjustSalary({
      personnelId: worker.id,
      type: "raise",
      amount: 5000,
      reason: "Revalorisation grille 2026",
      actorId: "usr-admin",
      actorName: "Super Admin",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.amountBefore).toBe(50000);
    expect(res.value.amountAfter).toBe(55000);
    expect(res.value.delta).toBe(5000);
    expect(store.personnel[0].salary).toBe(55000);
    expect(store.personnel[0].salaryAdjustments?.[0].reason).toBe("Revalorisation grille 2026");

    // The mandatory-reason guard mirrors the 0095 DB CHECK.
    const bad = await repo.adjustSalary({
      personnelId: worker.id,
      type: "raise",
      amount: 100,
      reason: "no",
      actorId: "usr-admin",
      actorName: "Super Admin",
    });
    expect(bad.ok).toBe(false);

    // Non-positive amounts are refused.
    const zero = await repo.adjustSalary({
      personnelId: worker.id,
      type: "raise",
      amount: 0,
      reason: "Montant invalide test",
      actorId: "usr-admin",
      actorName: "Super Admin",
    });
    expect(zero.ok).toBe(false);
  });

  it("A2. adjustSalary(cut) floors at 0 and records the ACTUAL delta (the 0095 row invariant)", async () => {
    const worker = seedWorker(20000, "per-901");
    const repo = new MockPersonnelRepository();

    const res = await repo.adjustSalary({
      personnelId: worker.id,
      type: "cut",
      amount: 99999,
      reason: "Pénalité disciplinaire grave",
      actorId: "usr-admin",
      actorName: "Super Admin",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.amountAfter).toBe(0);
    expect(res.value.delta).toBe(-20000); // the ACTUAL reduction, not -99999
    expect(res.value.amountAfter).toBe(res.value.amountBefore + res.value.delta);
    expect(store.personnel[0].salary).toBe(0);
  });

  it("A3. adjustSalary(bonus/deduction) leaves the base unchanged", async () => {
    const worker = seedWorker(40000, "per-902");
    const repo = new MockPersonnelRepository();

    const bonus = await repo.adjustSalary({
      personnelId: worker.id,
      type: "bonus",
      amount: 2500,
      reason: "Prime de rendement exceptionnelle",
      actorId: "usr-admin",
      actorName: "Super Admin",
    });
    expect(bonus.ok && bonus.value.amountAfter).toBe(40000);
    expect(bonus.ok && bonus.value.delta).toBe(2500);

    const deduction = await repo.adjustSalary({
      personnelId: worker.id,
      type: "deduction",
      amount: 1000,
      reason: "Retenue pour absence injustifiée",
      actorId: "usr-admin",
      actorName: "Super Admin",
    });
    expect(deduction.ok && deduction.value.amountAfter).toBe(40000);
    expect(deduction.ok && deduction.value.delta).toBe(-1000);
    expect(store.personnel[0].salary).toBe(40000);
    expect(store.personnel[0].salaryAdjustments?.length).toBe(2);
  });

  it("A4. recordSalaryPayment nets the period's one-offs, is idempotent per (personnel, period), and drives the reactive stream", async () => {
    const worker = seedWorker(40000, "per-903");
    const repo = new MockPersonnelRepository();

    await repo.adjustSalary({
      personnelId: worker.id, type: "bonus", amount: 2500,
      reason: "Prime de rendement exceptionnelle", actorId: "usr-admin", actorName: "Super Admin",
    });
    await repo.adjustSalary({
      personnelId: worker.id, type: "deduction", amount: 1000,
      reason: "Retenue pour retard répété", actorId: "usr-admin", actorName: "Super Admin",
    });

    const pay = await repo.recordSalaryPayment({
      personnelId: worker.id,
      period: "2026-09",
      method: "bank_transfer",
      referenceNumber: "VIR-2026-09-001",
      actorId: "usr-admin",
      actorName: "Super Admin",
    });
    expect(pay.ok).toBe(true);
    if (!pay.ok) return;
    expect(pay.value.baseSalary).toBe(40000);
    expect(pay.value.bonusesTotal).toBe(2500);
    expect(pay.value.deductionsTotal).toBe(1000);
    expect(pay.value.netPaid).toBe(41500);
    expect(pay.value.status).toBe("paid");

    // Idempotent re-record: same period, updated method — ONE row.
    const again = await repo.recordSalaryPayment({
      personnelId: worker.id,
      period: "2026-09",
      method: "cash",
      actorId: "usr-admin",
      actorName: "Super Admin",
    });
    expect(again.ok).toBe(true);

    const stream = repo.observeSalaryPayments();
    const payments = stream.get();
    expect(payments.filter((p) => p.period === "2026-09")).toHaveLength(1);
    expect(payments.find((p) => p.period === "2026-09")?.method).toBe("cash");
  });

  it("A5. recordSalaryPayment rejects a malformed period", async () => {
    const worker = seedWorker(40000);
    const repo = new MockPersonnelRepository();
    const res = await repo.recordSalaryPayment({
      personnelId: worker.id,
      period: "2026-9",
      method: "cash",
      actorId: "usr-admin",
      actorName: "Super Admin",
    });
    expect(res.ok).toBe(false);
  });
});

// ============================================================================
// B. The mock workforce loops
// ============================================================================

describe("T-369 B. Mock workforce loops", () => {
  it("B1. updateTaskStatus(needs_review) stamps the completion trail (completedBy + completionNote)", async () => {
    const created = await mockTaskRepository.createTask({
      title: "Nettoyage bloc B",
      description: "Nettoyage approfondi",
      priority: "medium",
      departmentId: "dept-workers",
      assigneeIds: ["per-015"],
      dueDate: null,
      createdBy: "usr-admin",
      createdByName: "Super Admin",
    });
    if (!created.ok) throw new Error("create failed");

    const res = await mockTaskRepository.updateTaskStatus(
      created.value.id,
      "needs_review",
      "usr-worker-1",
      "Trois couloirs nettoyés, produits rechargés.",
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.status).toBe("needs_review");
    expect(res.value.completedBy).toBe("usr-worker-1");
    expect(res.value.completionNote).toBe("Trois couloirs nettoyés, produits rechargés.");
    expect(res.value.completedAt).toBeTruthy();
  });

  it("B2. reviewTask approves (completed + reviewer trail) and reopens (in_progress)", async () => {
    const created = await mockTaskRepository.createTask({
      title: "Inventaire projecteurs",
      description: "Recenser le matériel",
      priority: "low",
      departmentId: "dept-maintenance",
      assigneeIds: ["per-010"],
      dueDate: null,
      createdBy: "usr-admin",
      createdByName: "Super Admin",
    });
    if (!created.ok) throw new Error("create failed");
    await mockTaskRepository.updateTaskStatus(created.value.id, "needs_review", "usr-worker-1", "Inventaire terminé.");

    const approved = await mockTaskRepository.reviewTask(
      created.value.id, true, "usr-admin", "Super Admin", "Travail conforme.",
    );
    expect(approved.ok && approved.value.status).toBe("completed");
    expect(approved.ok && approved.value.reviewedBy).toBe("usr-admin");
    expect(approved.ok && approved.value.reviewNote).toBe("Travail conforme.");
    expect(approved.ok && approved.value.progress).toBe(100);

    const rejected = await mockTaskRepository.reviewTask(
      created.value.id, false, "usr-admin", "Super Admin", "À refaire — zone ouest oubliée.",
    );
    expect(rejected.ok && rejected.value.status).toBe("in_progress");
    expect(rejected.ok && rejected.value.progress).toBeGreaterThanOrEqual(50);
  });

  it("B3. The absence justification loop walks none → requested → submitted → accepted (isExcused)", async () => {
    // abs-001 is seeded with justificationStatus 'requested'.
    const submitted = await mockWorkforceAttendanceRepository.submitAbsenceJustification({
      absenceId: "abs-001",
      workerExplanation: "Certificat médical fourni.",
      documentRef: "tenant-demo/absences/certificat.pdf",
    });
    expect(submitted.ok && submitted.value.justificationStatus).toBe("submitted");

    const accepted = await mockWorkforceAttendanceRepository.reviewAbsenceJustification({
      absenceId: "abs-001",
      decision: "accepted",
      decisionNote: "Justificatif accepté.",
      decidedBy: "usr-admin",
    });
    expect(accepted.ok && accepted.value.justificationStatus).toBe("accepted");
    expect(accepted.ok && accepted.value.isExcused).toBe(true);
  });

  it("B4. The leave clarification loop: request → clarification_requested; respond → pending", async () => {
    const submitted = await mockLeaveRequestRepository.submit({
      personnelId: "per-002",
      personnelName: "Sofiane Larbi",
      type: "overtime",
      fromDate: "2026-09-24",
      toDate: "2026-09-24",
      amountRequested: null,
      reason: "Heures supplémentaires préparation rentrée.",
    });
    if (!submitted.ok) throw new Error("submit failed");

    const asked = await mockLeaveRequestRepository.requestClarification(
      submitted.value.id, "Merci de préciser les heures exactes.", "usr-admin",
    );
    expect(asked.ok && asked.value.status).toBe("clarification_requested");
    expect(asked.ok && asked.value.clarificationRequest).toContain("heures exactes");

    const answered = await mockLeaveRequestRepository.respondClarification(
      submitted.value.id, "De 16h à 19h, soit trois heures.",
    );
    expect(answered.ok && answered.value.status).toBe("pending");
    expect(answered.ok && answered.value.clarificationResponse).toContain("trois heures");
  });
});

// ============================================================================
// C. The Supabase repositories (fake PostgREST client)
// ============================================================================

describe("T-369 C1. SupabaseTaskRepository — the review lifecycle", () => {
  function taskRow(overrides: Partial<Row> = {}): Row {
    return {
      id: "task-uuid-1",
      tenant_id: TENANT,
      title: "Tâche de test",
      description: "desc",
      status: "in_progress",
      priority: "medium",
      department_id: null,
      assignee_ids: [WORKER_UUID],
      due_date: null,
      completed_at: null,
      completed_by: null,
      completion_note: null,
      reviewed_by: null,
      review_note: null,
      progress: 30,
      tags: [],
      created_by: ADMIN,
      created_by_name: "Super Admin",
      created_at: "2026-09-14T10:00:00Z",
      updated_at: "2026-09-14T10:00:00Z",
      ...overrides,
    };
  }

  it("C1a. updateTaskStatus(needs_review) stamps completed_by + completion_note (the 0095 columns)", async () => {
    fakeClient.tables["tasks"] = [taskRow()];
    const repo = new SupabaseTaskRepository(fakeClient as unknown as SupabaseClient);

    const res = await repo.updateTaskStatus("task-uuid-1", "needs_review", WORKER_UUID, "Rapport de fin.");
    expect(res.ok).toBe(true);
    const row = fakeClient.tables["tasks"][0];
    expect(row.status).toBe("needs_review");
    expect(row.completed_by).toBe(WORKER_UUID);
    expect(row.completion_note).toBe("Rapport de fin.");
  });

  it("C1b. reviewTask(approved) closes with the reviewer trail; (rejected) reopens at progress ≥ 50", async () => {
    fakeClient.tables["tasks"] = [taskRow({ status: "needs_review", progress: 100 })];
    const repo = new SupabaseTaskRepository(fakeClient as unknown as SupabaseClient);

    const approved = await repo.reviewTask("task-uuid-1", true, ADMIN, "Super Admin", "Validé.");
    expect(approved.ok && approved.value.status).toBe("completed");
    expect(approved.ok && approved.value.reviewedBy).toBe(ADMIN);
    expect(approved.ok && approved.value.reviewNote).toBe("Validé.");
    expect(approved.ok && approved.value.progress).toBe(100);

    const rejected = await repo.reviewTask("task-uuid-1", false, ADMIN, "Super Admin", "À refaire.");
    expect(rejected.ok && rejected.value.status).toBe("in_progress");
    expect(rejected.ok && rejected.value.progress).toBeGreaterThanOrEqual(50);
  });

  it("C1c. the read mapping carries the review-lifecycle fields", async () => {
    fakeClient.tables["tasks"] = [
      taskRow({
        status: "needs_review",
        completed_by: WORKER_UUID,
        completion_note: "Terminé selon le cahier des charges.",
        reviewed_by: ADMIN,
        review_note: "En attente de relecture finale.",
      }),
    ];
    const repo = new SupabaseTaskRepository(fakeClient as unknown as SupabaseClient);
    const res = await repo.updateTask("task-uuid-1", { priority: "high" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.completedBy).toBe(WORKER_UUID);
    expect(res.value.completionNote).toBe("Terminé selon le cahier des charges.");
    expect(res.value.reviewedBy).toBe(ADMIN);
    expect(res.value.reviewNote).toBe("En attente de relecture finale.");
  });
});

describe("T-369 C2. SupabaseLeaveRequestRepository — the clarification loop + amount", () => {
  it("C2a. requestClarification writes clarification_requested + the question; respondClarification routes through the secured 0104 RPC", async () => {
    fakeClient.tables["leave_requests"] = [
      {
        id: "lr-uuid-1",
        tenant_id: TENANT,
        personnel_id: WORKER_UUID,
        leave_type: "overtime",
        start_date: "2026-09-24",
        end_date: "2026-09-24",
        reason: "Heures supplémentaires",
        status: "pending",
        amount_requested: null,
        clarification_request: null,
        clarification_response: null,
        reviewed_by: null,
        reviewed_by_name: null,
        reviewed_at: null,
        decision_note: null,
        created_at: "2026-09-14T10:00:00Z",
        updated_at: "2026-09-14T10:00:00Z",
        personnel: { first_name: "Omar", last_name: "Boudjelal" },
      },
    ];
    // The 0104 contract: the worker's response goes through the
    // respond_leave_clarification SECURITY DEFINER RPC (ownership-checked
    // server-side — workers hold NO direct UPDATE right on leave_requests),
    // then the repository re-reads the row. The side effect below models
    // the transition the real RPC performs on the server.
    fakeClient.rpcSideEffects["respond_leave_clarification"] = (args) => {
      const row = fakeClient.tables["leave_requests"][0];
      row.status = "pending";
      row.clarification_response = (args as { p_response: string }).p_response;
    };
    const repo = new SupabaseLeaveRequestRepository(fakeClient as unknown as SupabaseClient);

    const asked = await repo.requestClarification("lr-uuid-1", "Quelles heures exactes ?", ADMIN);
    expect(asked.ok).toBe(true);
    let row = fakeClient.tables["leave_requests"][0];
    expect(row.status).toBe("clarification_requested");
    expect(row.clarification_request).toBe("Quelles heures exactes ?");
    expect(asked.ok && asked.value.clarificationRequest).toBe("Quelles heures exactes ?");

    const answered = await repo.respondClarification("lr-uuid-1", "16h à 19h.");
    expect(answered.ok).toBe(true);
    // The ONLY write path for the worker's response is the secured RPC…
    expect(fakeClient.rpcCalls).toEqual([
      { fn: "respond_leave_clarification", args: { p_request_id: "lr-uuid-1", p_response: "16h à 19h." } },
    ]);
    // …whose server-side transition (simulated) lands the row back at
    // pending, and the re-read maps it into the domain object.
    row = fakeClient.tables["leave_requests"][0];
    expect(row.status).toBe("pending");
    expect(row.clarification_response).toBe("16h à 19h.");
    expect(answered.ok && answered.value.status).toBe("pending");
    expect(answered.ok && answered.value.clarificationResponse).toBe("16h à 19h.");
  });

  it("C2b. submit() persists amount_requested (the spending_reimbursement kind)", async () => {
    const repo = new SupabaseLeaveRequestRepository(fakeClient as unknown as SupabaseClient);
    const res = await repo.submit({
      personnelId: WORKER_UUID,
      personnelName: "Ignored (embed is the truth)",
      type: "spending_reimbursement",
      fromDate: "2026-09-18",
      toDate: "2026-09-18",
      amountRequested: 4500,
      reason: "Câbles HDMI salle polyvalente.",
    });
    expect(res.ok).toBe(true);
    const row = fakeClient.tables["leave_requests"][0];
    expect(row.amount_requested).toBe(4500);
    expect(row.leave_type).toBe("spending_reimbursement");
  });
});

describe("T-369 C3. SupabaseWorkforceAttendanceRepository — the staff_absences loop", () => {
  function absenceRow(overrides: Partial<Row> = {}): Row {
    return {
      id: "abs-uuid-1",
      tenant_id: TENANT,
      personnel_id: WORKER_UUID,
      date: "2026-09-14",
      duration_hours: 4,
      is_excused: false,
      justification_status: "none",
      admin_request_note: null,
      requested_at: null,
      requested_by: null,
      worker_explanation: null,
      worker_submitted_at: null,
      document_ref: null,
      decision_note: null,
      decided_at: null,
      decided_by: null,
      personnel: { first_name: "Omar", last_name: "Boudjelal" },
      ...overrides,
    };
  }

  it("C3a. request → submit → review: each write carries exactly one legal transition's columns", async () => {
    fakeClient.tables["staff_absences"] = [absenceRow()];
    const repo = new SupabaseWorkforceAttendanceRepository(fakeClient as unknown as SupabaseClient);

    const asked = await repo.requestAbsenceJustification({
      absenceId: "abs-uuid-1",
      adminNote: "Merci de fournir un justificatif médical.",
      requestedBy: ADMIN,
    });
    expect(asked.ok).toBe(true);
    let row = fakeClient.tables["staff_absences"][0];
    expect(row.justification_status).toBe("requested");
    expect(row.admin_request_note).toContain("justificatif");
    expect(row.requested_by).toBe(ADMIN);

    const submitted = await repo.submitAbsenceJustification({
      absenceId: "abs-uuid-1",
      workerExplanation: "Certificat médical fourni.",
      documentRef: "tenant/abs/certificat.pdf",
    });
    expect(submitted.ok).toBe(true);
    row = fakeClient.tables["staff_absences"][0];
    expect(row.justification_status).toBe("submitted");
    expect(row.worker_explanation).toContain("Certificat");
    expect(row.document_ref).toBe("tenant/abs/certificat.pdf");

    const accepted = await repo.reviewAbsenceJustification({
      absenceId: "abs-uuid-1",
      decision: "accepted",
      decisionNote: "Justificatif accepté.",
      decidedBy: ADMIN,
    });
    expect(accepted.ok).toBe(true);
    row = fakeClient.tables["staff_absences"][0];
    expect(row.justification_status).toBe("accepted");
    expect(row.is_excused).toBe(true);
    expect(accepted.ok && accepted.value.isExcused).toBe(true);
    expect(accepted.ok && accepted.value.personnelName).toBe("Omar Boudjelal");
  });

  it("C3b. empty admin notes / explanations are refused client-side", async () => {
    fakeClient.tables["staff_absences"] = [absenceRow()];
    const repo = new SupabaseWorkforceAttendanceRepository(fakeClient as unknown as SupabaseClient);

    const bad = await repo.requestAbsenceJustification({
      absenceId: "abs-uuid-1", adminNote: "   ", requestedBy: ADMIN,
    });
    expect(bad.ok).toBe(false);

    const bad2 = await repo.submitAbsenceJustification({
      absenceId: "abs-uuid-1", workerExplanation: "",
    });
    expect(bad2.ok).toBe(false);
  });
});

describe("T-369 C4. SupabasePersonnelRepository — the payroll RPC surface", () => {
  it("C4a. adjustSalary calls the canonical RPC with the right parameters (never a client-side UPDATE)", async () => {
    fakeClient.tables["personnel"] = [];
    fakeClient.willReturn("adjust_personnel_salary", {
      adjustment: {
        id: "adj-uuid-1",
        personnel_id: WORKER_UUID,
        type: "raise",
        amount_before: 50000,
        amount_after: 55000,
        delta: 5000,
        reason: "Revalorisation grille 2026",
        effective_date: "2026-09-14",
        approved_by: ADMIN,
        approved_by_name: "Super Admin",
        created_at: "2026-09-14T10:00:00Z",
      },
      base_salary_after: 55000,
    });
    const repo = new SupabasePersonnelRepository(fakeClient as unknown as SupabaseClient);

    const res = await repo.adjustSalary({
      personnelId: WORKER_UUID,
      type: "raise",
      amount: 5000,
      reason: "Revalorisation grille 2026",
      actorId: ADMIN,
      actorName: "Super Admin",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.amountAfter).toBe(55000);
    expect(res.value.delta).toBe(5000);

    expect(fakeClient.rpcCalls).toHaveLength(1);
    const call = fakeClient.rpcCalls[0];
    expect(call.fn).toBe("adjust_personnel_salary");
    expect(call.args.p_personnel_id).toBe(WORKER_UUID);
    expect(call.args.p_type).toBe("raise");
    expect(call.args.p_delta).toBe(5000);
    expect(call.args.p_reason).toBe("Revalorisation grille 2026");
    // NO direct table write happened for the salary.
    expect(fakeClient.tables["personnel"].filter((p) => (p as Row)["base_salary"] === 55000)).toHaveLength(0);
  });

  it("C4b. adjustSalary refuses short reasons and non-UUID personnel BEFORE the RPC", async () => {
    const repo = new SupabasePersonnelRepository(fakeClient as unknown as SupabaseClient);

    const badReason = await repo.adjustSalary({
      personnelId: WORKER_UUID, type: "raise", amount: 100, reason: "no",
      actorId: ADMIN, actorName: "Super Admin",
    });
    expect(badReason.ok).toBe(false);

    const badId = await repo.adjustSalary({
      personnelId: "per-001", type: "raise", amount: 100, reason: "Réponse valide ici",
      actorId: ADMIN, actorName: "Super Admin",
    });
    expect(badId.ok).toBe(false);
    expect(fakeClient.rpcCalls).toHaveLength(0);
  });

  it("C4c. recordSalaryPayment calls the canonical RPC and rejects malformed periods", async () => {
    fakeClient.willReturn("record_salary_disbursement", {
      id: "pay-uuid-1",
      personnel_id: WORKER_UUID,
      period: "2026-09",
      base_salary: 40000,
      bonuses_total: 2500,
      deductions_total: 1000,
      net_paid: 41500,
      status: "paid",
      payment_date: "2026-09-14",
      method: "bank_transfer",
      reference_number: "VIR-001",
      notes: null,
      paid_by: ADMIN,
      paid_by_name: "Super Admin",
    });
    const repo = new SupabasePersonnelRepository(fakeClient as unknown as SupabaseClient);

    const res = await repo.recordSalaryPayment({
      personnelId: WORKER_UUID,
      period: "2026-09",
      method: "bank_transfer",
      referenceNumber: "VIR-001",
      actorId: ADMIN,
      actorName: "Super Admin",
    });
    expect(res.ok && res.value.netPaid).toBe(41500);
    expect(fakeClient.rpcCalls[0].fn).toBe("record_salary_disbursement");
    expect(fakeClient.rpcCalls[0].args.p_period).toBe("2026-09");

    const bad = await repo.recordSalaryPayment({
      personnelId: WORKER_UUID, period: "2026-9", method: "cash",
      actorId: ADMIN, actorName: "Super Admin",
    });
    expect(bad.ok).toBe(false);
  });
});

// ============================================================================
// D. Source guards
// ============================================================================

const ROOT = path.resolve(__dirname, "../../");

describe("T-369 D. Source guards", () => {
  it("D1. the dead parallel mock is GONE (no mock/workforce.ts shadowing the directory index)", () => {
    expect(fs.existsSync(path.join(ROOT, "infrastructure/mock/workforce.ts"))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, "infrastructure/mock/workforce/index.ts"))).toBe(true);
  });

  it("D2. workflow-side-effects is pinned to the directory index (the 74d3ebb split-brain guard)", () => {
    const src = fs.readFileSync(path.join(ROOT, "infrastructure/mock/repositories/workflow-side-effects.ts"), "utf8");
    expect(src).toContain('from "../workforce/index"');
  });

  it("D3. the Payroll UI no longer carries the client-side paid-state simulation or client-side salary math", () => {
    const src = fs.readFileSync(path.join(ROOT, "features/personnel/management/payroll-management.tsx"), "utf8");
    expect(src).not.toContain("setPaidWorkerIds");
    expect(src).not.toContain("adj-${Date.now()}");
    expect(src).toContain("adjustSalary(");
    expect(src).toContain("recordSalaryPayment(");
    expect(src).toContain("observeSalaryPayments(");
  });

  it("D4. migration 0095 exists with both RPCs + the append-only trigger + the registration row", () => {
    const p = path.join(ROOT, "../supabase/migrations/0095_personnel_workforce_system.sql");
    expect(fs.existsSync(p)).toBe(true);
    const sql = fs.readFileSync(p, "utf8");
    expect(sql).toContain("create table if not exists public.staff_absences");
    expect(sql).toContain("create table if not exists public.salary_adjustments");
    expect(sql).toContain("create table if not exists public.salary_payments");
    expect(sql).toContain("create or replace function public.adjust_personnel_salary(");
    expect(sql).toContain("create or replace function public.record_salary_disbursement(");
    expect(sql).toContain("enforce_salary_adjustment_append_only");
    expect(sql).toMatch(/'0095', '\{0095_personnel_workforce_system\.sql\}', 'personnel_workforce_system'/);
  });
});
