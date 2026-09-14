/**
 * Mock personnel, relevé, and audit repositories.
 *
 * Extracted from `mock-repositories.ts` in iteration 2 of the platform-wide
 * refactor. Behavior preserved verbatim.
 */
import type {
  PersonnelRepository,
  ReleveRepository,
  AuditRepository,
  Observable,
} from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { AuditActions } from "../../../core/audit-actions";
import { SubjectBehavior } from "../subject-behavior";
import type {
  Personnel,
  ReleveEntry,
  ReleveActivity,
  SalaryAdjustment,
  SalaryAdjustmentType,
  SalaryPaymentRecord,
  PayrollMethod,
} from "../../../domain/model/personnel";
import type { AuditEntry, AuditLogFilter, AuditLogQueryResult, AttributedActivityEvent, AttributedActivityStream } from "../../../domain/model/audit";
import { store, TENANT_ID, appendAudit, nowIso, delay } from "./mock-store";

// ============================================================================
// Personnel
// ============================================================================

/**
 * The in-memory payroll ledger (T-369) — mirrors the canonical Supabase
 * semantics: adjustments are immutable appended rows; payments are unique
 * per (personnel, period) and idempotently re-recorded.
 */
const salaryAdjustmentsStore: SalaryAdjustment[] = [];
const salaryPaymentsStore: SalaryPaymentRecord[] = [];
const salaryPaymentsSubject = new SubjectBehavior<SalaryPaymentRecord[]>([]);

function nextAdjustmentId(): string {
  return `adj-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

export class MockPersonnelRepository implements PersonnelRepository {
  observe(): Observable<Personnel[]> {
    return store.personnel$;
  }
  observeByCategory(category: string): Observable<Personnel[]> {
    return new SubjectBehavior(store.personnel.filter((p) => p.staffCategory === category));
  }
  observeById(id: string): Observable<Personnel | null> {
    return new SubjectBehavior(store.personnel.find((p) => p.id === id) ?? null);
  }
  observeByUserId(userId: string): Observable<Personnel | null> {
    // Iteration 9: returns a SubjectBehavior that re-emits whenever the personnel
    // store changes, so callers stay reactive across mutations.
    const find = () => store.personnel.find((p) => p.userId === userId) ?? null;
    const subject = new SubjectBehavior<Personnel | null>(find());
    // Subscribe to the underlying personnel$ stream to keep this subject fresh.
    store.personnel$.subscribe(() => subject.set(find()));
    return subject;
  }
  async createPersonnel(input: Omit<Personnel, "id" | "tenantId" | "weeklyHoursLogged">): Promise<Result<Personnel>> {
    await delay(200);
    const p: Personnel = {
      ...input,
      id: `per-${String(store.personnel.length + 1).padStart(3, "0")}`,
      tenantId: TENANT_ID,
      weeklyHoursLogged: 0,
    };
    store.personnel.push(p);
    store.notifyPersonnel();
    appendAudit({
      action: AuditActions.PersonnelCreate,
      entityType: "personnel",
      entityId: p.id,
      actorId: "usr-current",
      actorName: "Session courante",
    });
    return Ok(p);
  }
  async updatePersonnel(id: string, updates: Partial<Personnel>): Promise<Result<Personnel>> {
    await delay(180);
    const idx = store.personnel.findIndex((p) => p.id === id);
    if (idx < 0) return Err(Errors.notFound("Personnel", id));
    const after = { ...store.personnel[idx], ...updates };
    store.personnel[idx] = after;
    store.notifyPersonnel();
    return Ok(after);
  }
  async deletePersonnel(id: string): Promise<Result<void>> {
    await delay(180);
    store.personnel = store.personnel.filter((p) => p.id !== id);
    store.notifyPersonnel();
    return Ok(undefined);
  }

  /**
   * T-369 — mirrors the canonical `adjust_personnel_salary` RPC semantics
   * (migration 0095): raise/cut move the base salary (cut floors at 0);
   * bonus/deduction are one-offs that leave it unchanged; the reason is
   * mandatory (min 5 chars, the DB CHECK); the adjustment row is immutable
   * history; the master audit log records personnel.salary_adjusted.
   */
  async adjustSalary(input: {
    personnelId: string;
    type: SalaryAdjustmentType;
    amount: number;
    reason: string;
    effectiveDate?: string;
    actorId: string;
    actorName: string;
  }): Promise<Result<SalaryAdjustment>> {
    const idx = store.personnel.findIndex((p) => p.id === input.personnelId);
    if (idx < 0) return Err(Errors.notFound("Personnel", input.personnelId));
    if (!(input.amount > 0)) {
      return Err(Errors.validation("Le montant de l'ajustement doit être positif."));
    }
    if (!input.reason || input.reason.trim().length < 5) {
      return Err(
        Errors.validation(
          "A formal justification of at least 5 characters is mandatory",
          "Un motif formel (5 caractères minimum) est obligatoire.",
        ),
      );
    }

    const before = store.personnel[idx];
    const amountBefore = before.salary ?? 0;
    let amountAfter = amountBefore;
    let signedDelta = 0;
    switch (input.type) {
      case "raise":
        amountAfter = amountBefore + input.amount;
        signedDelta = input.amount;
        break;
      case "cut":
        amountAfter = Math.max(0, amountBefore - input.amount);
        signedDelta = amountAfter - amountBefore; // the ACTUAL change (floored cuts record the real reduction — the 0095 row invariant)
        break;
      case "bonus":
        signedDelta = input.amount;
        break;
      case "deduction":
        signedDelta = -input.amount;
        break;
    }

    const adjustment: SalaryAdjustment = {
      id: nextAdjustmentId(),
      personnelId: input.personnelId,
      type: input.type,
      amountBefore,
      amountAfter,
      delta: signedDelta,
      reason: input.reason.trim(),
      effectiveDate: input.effectiveDate ?? nowIso().slice(0, 10),
      approvedBy: input.actorId,
      approvedByName: input.actorName,
      createdAt: nowIso(),
    };
    salaryAdjustmentsStore.unshift(adjustment);

    if (input.type === "raise" || input.type === "cut") {
      const after = { ...before, salary: amountAfter, salaryAdjustments: [adjustment, ...(before.salaryAdjustments ?? [])] };
      store.personnel[idx] = after;
      store.notifyPersonnel();
    } else {
      // One-offs keep the base but still surface in the employee's history.
      const after = { ...before, salaryAdjustments: [adjustment, ...(before.salaryAdjustments ?? [])] };
      store.personnel[idx] = after;
      store.notifyPersonnel();
    }

    appendAudit({
      action: "personnel.salary_adjusted",
      entityType: "personnel",
      entityId: input.personnelId,
      actorId: input.actorId,
      actorName: input.actorName,
      diff: { before: { salary: amountBefore }, after: { salary: amountAfter, type: input.type, reason: input.reason.trim() } },
      note: `Ajustement (${input.type}: ${signedDelta} DZD)`,
    });

    return Ok(adjustment);
  }

  /**
   * T-369 — mirrors the canonical `record_salary_disbursement` RPC: unique
   * per (personnel, period), idempotent re-record, the period's one-off
   * bonuses/deductions netted into the payout.
   */
  async recordSalaryPayment(input: {
    personnelId: string;
    period: string;
    method: PayrollMethod;
    referenceNumber?: string | null;
    notes?: string | null;
    actorId: string;
    actorName: string;
  }): Promise<Result<SalaryPaymentRecord>> {
    const person = store.personnel.find((p) => p.id === input.personnelId);
    if (!person) return Err(Errors.notFound("Personnel", input.personnelId));
    if (!/^\d{4}-\d{2}$/.test(input.period)) {
      return Err(Errors.validation("La période doit être au format AAAA-MM."));
    }

    // The period's one-offs (effective within the month — the RPC's window).
    const monthStart = `${input.period}-01`;
    const nextMonth = (() => {
      const [y, m] = input.period.split("-").map(Number);
      const d = new Date(Date.UTC(y, m, 1));
      return d.toISOString().slice(0, 10);
    })();
    const periodAdjustments = salaryAdjustmentsStore.filter(
      (a) => a.personnelId === input.personnelId && a.effectiveDate >= monthStart && a.effectiveDate < nextMonth,
    );
    const bonusesTotal = periodAdjustments
      .filter((a) => a.type === "bonus")
      .reduce((sum, a) => sum + a.delta, 0);
    const deductionsTotal = -periodAdjustments
      .filter((a) => a.type === "deduction")
      .reduce((sum, a) => sum + a.delta, 0);
    const baseSalary = person.salary ?? 0;
    const netPaid = Math.max(0, baseSalary + bonusesTotal - deductionsTotal);

    const payment: SalaryPaymentRecord = {
      id: `pay-${input.period}-${input.personnelId}`,
      personnelId: input.personnelId,
      period: input.period,
      baseSalary,
      bonusesTotal,
      deductionsTotal,
      netPaid,
      status: "paid",
      paymentDate: nowIso().slice(0, 10),
      method: input.method,
      referenceNumber: input.referenceNumber?.trim() || null,
      notes: input.notes?.trim() || null,
      paidBy: input.actorId,
      paidByName: input.actorName,
    };

    const existingIdx = salaryPaymentsStore.findIndex(
      (p) => p.personnelId === input.personnelId && p.period === input.period,
    );
    if (existingIdx >= 0) {
      salaryPaymentsStore[existingIdx] = payment; // idempotent re-record
    } else {
      salaryPaymentsStore.unshift(payment);
    }
    salaryPaymentsSubject.set([...salaryPaymentsStore]);

    appendAudit({
      action: "personnel.salary_disbursed",
      entityType: "personnel",
      entityId: input.personnelId,
      actorId: input.actorId,
      actorName: input.actorName,
      diff: { after: { period: input.period, net_paid: netPaid, method: input.method } },
      note: `Versement de paie ${input.period} (${netPaid} DZD)`,
    });

    return Ok(payment);
  }

  observeSalaryPayments(): Observable<SalaryPaymentRecord[]> {
    return salaryPaymentsSubject;
  }
}

// ============================================================================
// Relevé (personnel timesheet)
// ============================================================================

export class MockReleveRepository implements ReleveRepository {
  /**
   * Iteration 6: Returns real seeded relevé entries (previously returned empty).
   */
  observeByPersonnel(personnelId: string, from: string, to: string): Observable<ReleveEntry[]> {
    return new SubjectBehavior(
      store.releve.filter(
        (r) => r.personnelId === personnelId && r.date >= from && r.date <= to,
      ),
    );
  }
  async logEntry(input: {
    personnelId: string;
    personnelName: string;
    date: string;
    hoursIn: number;
    hoursOut: number | null;
    activity: ReleveActivity;
    classId: string | null;
    subjectId: string | null;
  }): Promise<Result<ReleveEntry>> {
    await delay(180);
    const entry: ReleveEntry = { ...input, id: `rel-${Date.now()}`, recordedAt: nowIso() };
    // Iteration 6: persist the entry so the relevé tab shows it.
    store.releve = [entry, ...store.releve];
    store.notifyReleve();
    appendAudit({
      action: AuditActions.ReleveCreate,
      entityType: "releve",
      entityId: entry.id,
      actorId: "usr-current",
      actorName: "Session courante",
    });
    return Ok(entry);
  }
}

// ============================================================================
// Audit (queryable log of all state changes)
// ============================================================================

export class MockAuditRepository implements AuditRepository {
  /**
   * T-299 (OFFLINE-400): the attributed-activity stream — mock mode emits
   * on `log()` (the same contract the Supabase realtime subscription
   * provides in production; the toaster renders identically in both).
   */
  private readonly activity = new SubjectBehavior<AttributedActivityEvent | null>(null);

  observeActivity(): AttributedActivityStream {
    return {
      subscribe: (fn: (value: AttributedActivityEvent) => void) => {
        return this.activity.subscribe((v) => {
          if (v !== null) fn(v);
        });
      },
    };
  }

  async query(filter: AuditLogFilter): Promise<Result<AuditLogQueryResult>> {
    await delay(120);
    let rows = [...store.audit];
    if (filter.action) rows = rows.filter((r) => r.action === filter.action);
    if (filter.entityType) rows = rows.filter((r) => r.entityType === filter.entityType);
    if (filter.entityId) rows = rows.filter((r) => r.entityId === filter.entityId);
    if (filter.actorId) rows = rows.filter((r) => r.actorId === filter.actorId);
    if (filter.actorNameContains) {
      const q = filter.actorNameContains.toLowerCase();
      rows = rows.filter((r) => r.actorName.toLowerCase().includes(q));
    }
    if (filter.from) rows = rows.filter((r) => r.at >= filter.from!);
    if (filter.to) rows = rows.filter((r) => r.at <= filter.to!);
    const total = rows.length;
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 50;
    const entries = rows.slice(offset, offset + limit);
    return Ok({ entries, total, hasMore: offset + limit < total });
  }

  async byEntity(entityType: string, entityId: string): Promise<Result<AuditEntry[]>> {
    await delay(80);
    return Ok(store.audit.filter((r) => r.entityType === entityType && r.entityId === entityId));
  }

  async recent(limit = 50): Promise<Result<AuditEntry[]>> {
    await delay(80);
    return Ok(store.audit.slice(0, limit));
  }

  async log(input: {
    action: string;
    entityType: string;
    entityId: string;
    actorId: string;
    actorName: string;
    actorRole?: string | null;
    tenantId: string;
    diff?: { before?: unknown; after?: unknown } | null;
    note?: string | null;
  }): Promise<Result<AuditEntry>> {
    const entry: AuditEntry = {
      id: `aud-${Date.now()}`,
      tenantId: TENANT_ID,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      actorId: input.actorId,
      actorName: input.actorName,
      actorRole: input.actorRole ?? null,
      diff: input.diff ? JSON.stringify(input.diff) : null,
      note: input.note ?? null,
      ipAddress: "10.0.1.42",
      userAgent: "El-Imtiyaz-Desktop/0.1.0",
      at: nowIso(),
    };
    store.audit.unshift(entry);
    store.notifyAudit();
    // T-299: the attributed broadcast (mock-mode realtime).
    this.activity.set({
      actorName: entry.actorName,
      actorRole: entry.actorRole ?? null,
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      occurredAt: entry.at,
    });
    return Ok(entry);
  }
}

// ============================================================================
// Singletons — exported for the barrel re-export in `mock-repositories.ts`.
// ============================================================================

export const mockPersonnelRepository: PersonnelRepository = new MockPersonnelRepository();
export const mockReleveRepository: ReleveRepository = new MockReleveRepository();
export const mockAuditRepository: AuditRepository = new MockAuditRepository();

// Re-export Observable so consumers of this file don't need a second import.
export type { Observable };
