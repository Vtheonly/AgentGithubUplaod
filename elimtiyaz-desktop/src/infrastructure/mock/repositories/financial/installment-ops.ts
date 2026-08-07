/**
 * Installment operations — plain-function helpers used by
 * `MockInstallmentRepository` (iteration 9 flexible schedule support).
 *
 * Extracted from `financial-repository.ts` in task 6-b. Behavior preserved
 * verbatim — only file location + import paths changed.
 */
import type { Result } from "../../../../core/result";
import { Ok, Err } from "../../../../core/result";
import { Errors } from "../../../../core/app-error";
import { AuditActions } from "../../../../core/audit-actions";
import type {
  Installment,
  AcademicCycle,
  UpdateInstallmentDueDateInput,
  PaymentCategory,
} from "../../../../domain/model/payment";
import {
  ACADEMIC_CYCLE_LABELS_FR,
  DEFAULT_CYCLE_TRANCHE_MONTHS,
} from "../../../../domain/model/payment";
import {
  allocatePaymentToInstallments,
  type AllocationResult,
  type InstallmentAllocation,
} from "../../../../domain/calc/payment/installments";
import type { FinancialOpsCtx } from "./types";

/** Iteration 9 — mark an installment as fully paid. */
export async function markInstallmentPaid(
  ctx: FinancialOpsCtx,
  id: string,
  paymentId: string,
): Promise<Result<Installment>> {
  const { store, appendAudit, nowIso, delay } = ctx;
  await delay(180);
  const idx = store.installments.findIndex((i) => i.id === id);
  if (idx < 0) return Err(Errors.notFound("Installment", id));
  const after: Installment = {
    ...store.installments[idx],
    amountPaid: store.installments[idx].amountDue,
    paidDate: nowIso(),
    status: "paid",
  };
  store.installments[idx] = after;
  store.notifyInstallments();
  appendAudit({
    action: AuditActions.InstallmentMarkPaid,
    entityType: "installment",
    entityId: id,
    actorId: "usr-current",
    actorName: "Session courante",
    note: `Payment ${paymentId}`,
  });
  return Ok(after);
}

/**
 * Iteration 9 — flexible installment schedules.
 *
 * Overrides an installment's due date per parent. Marks the installment
 * `customSchedule: true` so the UI can badge it. Writes an audit entry
 * so the change is traceable.
 */
export async function updateInstallmentDueDate(
  ctx: FinancialOpsCtx,
  input: UpdateInstallmentDueDateInput,
): Promise<Result<Installment>> {
  const { store, appendAudit, delay } = ctx;
  await delay(180);
  const idx = store.installments.findIndex((i) => i.id === input.installmentId);
  if (idx < 0) return Err(Errors.notFound("Installment", input.installmentId));
  const before = store.installments[idx];
  const after: Installment = {
    ...before,
    dueDate: input.dueDate,
    customSchedule: true,
    customScheduleNote: input.note ?? before.customScheduleNote ?? null,
  };
  store.installments[idx] = after;
  store.notifyInstallments();
  appendAudit({
    action: "installment.update_due_date",
    entityType: "installment",
    entityId: input.installmentId,
    actorId: input.actorId,
    actorName: input.actorName,
    diff: { before: { dueDate: before.dueDate }, after: { dueDate: input.dueDate, customSchedule: true } },
    note: input.note ?? null,
  });
  return Ok(after);
}

/**
 * Iteration 9 — cycle-based installment regeneration.
 *
 * For each pending/partial installment of the parent, re-derive the due
 * date from the cycle's default tranche template (Primaire=9/12/3,
 * CEM=9/12/4, Lycée=9/1/5). Paid installments are preserved as-is.
 * Clears the `customSchedule` flag (back to template).
 */
export async function regenerateInstallmentsForCycle(
  ctx: FinancialOpsCtx,
  parentId: string,
  cycle: AcademicCycle,
  actorId: string,
  actorName: string,
): Promise<Result<readonly Installment[]>> {
  const { store, appendAudit, delay } = ctx;
  await delay(220);
  const months = DEFAULT_CYCLE_TRANCHE_MONTHS[cycle];
  const currentYear = new Date().getFullYear();
  let changed = 0;
  for (let i = 0; i < store.installments.length; i++) {
    const ins = store.installments[i];
    if (ins.parentId !== parentId) continue;
    if (ins.status === "paid") continue;
    // Tranche 1/2/3 → months[0]/[1]/[2]
    const trancheNum = ins.label.startsWith("Tranche ") ? parseInt(ins.label.slice(8), 10) : 1;
    const month = months[Math.min(Math.max(trancheNum - 1, 0), 2)];
    // Academic year starts in September — tranche 1 is in current year, tranche 2+ might roll to next year.
    const year = month >= 9 ? currentYear : currentYear + 1;
    const day = 15;
    const newDue = new Date(year, month - 1, day).toISOString();
    store.installments[i] = {
      ...ins,
      dueDate: newDue,
      academicCycle: cycle,
      customSchedule: false,
      customScheduleNote: null,
    };
    changed++;
  }
  if (changed > 0) {
    store.notifyInstallments();
    appendAudit({
      action: "installment.regenerate_for_cycle",
      entityType: "parent",
      entityId: parentId,
      actorId: actorId,
      actorName: actorName,
      diff: { before: { cycle: "previous" }, after: { cycle, installmentsChanged: changed } },
      note: `Régénération selon le cycle ${ACADEMIC_CYCLE_LABELS_FR[cycle]}`,
    });
  }
  return Ok(store.installments.filter((i) => i.parentId === parentId));
}

/**
 * Iteration 9 — find overdue installments.
 *
 * Returns installments whose dueDate < now AND status !== "paid".
 * Used by the automated overdue alert generator.
 */
export async function findOverdueInstallments(
  ctx: FinancialOpsCtx,
  now: Date = new Date(),
): Promise<Result<readonly Installment[]>> {
  const { store } = ctx;
  const nowMs = now.getTime();
  const overdue = store.installments.filter(
    (i) => i.status !== "paid" && new Date(i.dueDate).getTime() < nowMs,
  );
  return Ok(overdue);
}

/**
 * Waterfall Allocation — distribute a single payment across all eligible
 * unpaid/partial installments for a parent, oldest first.
 *
 * This is the canonical "satisfy tranches chronologically" operation
 * mandated by the architectural blueprint. It guarantees that:
 *   - Every dinar of `paymentAmount` is either applied to an installment
 *     or returned as `unallocatedAmount` (parent credit / overpayment).
 *   - The Ledger (which receives a single payment credit of `paymentAmount`)
 *     and the Installment table (which receives N partial updates) stay
 *     mathematically consistent: their sum of `amountPaid` deltas equals
 *     the ledger payment amount minus the unallocated credit.
 *
 * Behavior:
 *   1. Loads all installments for `parentId` (optionally filtered by category).
 *   2. Runs the pure `allocatePaymentToInstallments()` to compute allocations.
 *   3. Persists each allocation: updates `amountPaid`, `status`, `paidDate`
 *      (set when fully satisfied), and writes one audit entry per
 *      installment touched (for full traceability).
 *   4. Does NOT touch the Ledger — the caller is expected to have already
 *      appended the canonical payment ledger entry via `collectPayment()`.
 *
 * @returns AllocationResult with per-installment breakdown + unallocated
 *          amount (overpayment credit).
 */
export async function allocatePaymentAcrossInstallments(
  ctx: FinancialOpsCtx,
  parentId: string,
  paymentAmount: number,
  paymentId: string,
  categoryFilter?: PaymentCategory,
  actorId: string = "usr-current",
  actorName: string = "Session courante",
): Promise<Result<AllocationResult>> {
  const { store, appendAudit, nowIso, delay } = ctx;
  await delay(220);

  if (paymentAmount <= 0) {
    return Ok({
      allocations: [],
      unallocatedAmount: 0,
      totalAllocated: 0,
      paymentAmount,
    });
  }

  // Snapshot current installments for this parent.
  const parentInstallments = store.installments.filter((i) => i.parentId === parentId);

  // Compute the allocation plan (pure function).
  const plan = allocatePaymentToInstallments(parentInstallments, paymentAmount, categoryFilter);

  // Persist each allocation.
  const now = nowIso();
  for (const alloc of plan.allocations) {
    const idx = store.installments.findIndex((i) => i.id === alloc.installmentId);
    if (idx < 0) continue;
    const before = store.installments[idx];
    const after: Installment = {
      ...before,
      amountPaid: alloc.newAmountPaid,
      status: alloc.newStatus,
      paidDate: alloc.fullySatisfied ? now : before.paidDate,
    };
    store.installments[idx] = after;
    appendAudit({
      action: AuditActions.InstallmentMarkPaid,
      entityType: "installment",
      entityId: alloc.installmentId,
      actorId,
      actorName,
      diff: {
        before: { amountPaid: before.amountPaid, status: before.status },
        after: { amountPaid: alloc.newAmountPaid, status: alloc.newStatus, allocated: alloc.allocatedAmount },
      },
      note: `Waterfall — Paiement ${paymentId} → ${formatDzdBrief(alloc.allocatedAmount)}`,
    });
  }
  if (plan.allocations.length > 0) {
    store.notifyInstallments();
  }

  // If there's an unallocated amount (overpayment), audit-log it as parent credit.
  if (plan.unallocatedAmount > 0) {
    appendAudit({
      action: "payment.adjust", // reuse adjustment action for the credit note
      entityType: "parent",
      entityId: parentId,
      actorId,
      actorName,
      diff: {
        before: null,
        after: { unallocatedCredit: plan.unallocatedAmount, paymentId },
      },
      note: `Excédent de paiement non alloué (crédit parent) — ${formatDzdBrief(plan.unallocatedAmount)}`,
    });
  }

  return Ok(plan);
}

/** Format a DZD amount compactly for audit log notes. */
function formatDzdBrief(amount: number): string {
  return `${amount.toLocaleString("fr-FR")} DZD`;
}
