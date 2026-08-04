/**
 * Debt operations — plain-function helpers used by `MockDebtRepository`.
 *
 * Extracted from `financial-repository.ts` in task 6-b. Behavior preserved
 * verbatim — only file location + import paths changed.
 *
 * Iteration 5: debt summary + parent financial profile are both computed
 * from the ledger via replay (no hardcoded arrays).
 */
import type { Result } from "../../../../core/result";
import { Ok } from "../../../../core/result";
import { AuditActions } from "../../../../core/audit-actions";
import { SubjectBehavior } from "../../subject-behavior";
import type {
  DebtSummary,
  ParentFinancialProfile,
} from "../../../../domain/model/payment";
import {
  computeParentSummary,
  maxDaysOverdueFromLedger,
  buildOverdueDueDateMap,
} from "../../../../domain/calc/ledger";
import { agingBucketFromDays } from "../../../../domain/calc/payment";
import type { Observable } from "../../../../domain/repository/repository";
import type { FinancialOpsCtx } from "./types";

/**
 * Iteration 5: debt summary is now computed from the ledger via replay.
 * No hardcoded arrays. Every parent's `outstandingAmount` is the sum
 * of their account balances (computed from ledger entries).
 */
export function observeDebtSummary(
  ctx: FinancialOpsCtx,
): Observable<DebtSummary[]> {
  const { store } = ctx;
  const summaries: DebtSummary[] = store.parents.map((p) => {
    const parentEntries = store.ledger.filter((e) => e.parentId === p.id);
    const dueDateMap = buildOverdueDueDateMap(parentEntries);
    const summary = computeParentSummary(parentEntries, p.id, `${p.firstName} ${p.lastName}`, dueDateMap);
    const days = maxDaysOverdueFromLedger(parentEntries);
    return {
      id: `debt-${p.id}`,
      parentId: p.id,
      parentName: `${p.firstName} ${p.lastName}`,
      parentPhone: p.phone,
      studentCount: store.students.filter((s) => s.parentId === p.id).length,
      outstandingAmount: summary.totalOutstanding,
      daysOverdue: days,
      bucket: agingBucketFromDays(days),
    };
  });
  // Only include parents with a non-zero outstanding balance.
  return new SubjectBehavior(summaries.filter((s) => s.outstandingAmount > 0.001));
}

/**
 * Iteration 5: parent financial profile is computed from the ledger.
 * `totalDue` = sum of charge entries.
 * `totalPaid` = sum of cleared payment entries (status === "paid").
 * `totalOutstanding` = totalDue - totalPaid.
 * `overdueAmount` = sum of unpaid past-due charges.
 */
export function observeParentFinancialProfile(
  ctx: FinancialOpsCtx,
  parentId: string,
): Observable<ParentFinancialProfile | null> {
  const { store } = ctx;
  const parent = store.parents.find((p) => p.id === parentId);
  if (!parent) return new SubjectBehavior<ParentFinancialProfile | null>(null);
  const parentEntries = store.ledger.filter((e) => e.parentId === parentId);
  const dueDateMap = buildOverdueDueDateMap(parentEntries);
  const summary = computeParentSummary(parentEntries, parentId, `${parent.firstName} ${parent.lastName}`, dueDateMap);
  const installments = store.installments.filter((i) => i.parentId === parentId);
  const payments = store.payments
    .filter((p) => p.parentId === parentId)
    .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))
    .slice(0, 10);
  return new SubjectBehavior<ParentFinancialProfile | null>({
    parentId,
    parentName: `${parent.firstName} ${parent.lastName}`,
    totalDue: summary.totalCharged,
    totalPaid: summary.totalCleared,
    totalOutstanding: summary.totalOutstanding,
    overdueAmount: summary.totalOverdue,
    installments,
    recentPayments: payments,
    adjustments: [],
  });
}

/** Send a (mock) debt reminder to a parent + write an audit entry. */
export async function sendDebtReminder(
  ctx: FinancialOpsCtx,
  parentId: string,
): Promise<Result<void>> {
  const { appendAudit, delay } = ctx;
  await delay(150);
  appendAudit({
    action: AuditActions.DebtReminderSent,
    entityType: "parent",
    entityId: parentId,
    actorId: "usr-current",
    actorName: "Session courante",
    note: "Rappel envoyé",
  });
  return Ok(undefined);
}
