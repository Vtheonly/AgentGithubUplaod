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
import { derived } from "../../subject-behavior";
import type {
  AccountAdjustment,
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
  // FIX (reactivity): derive from ALL underlying streams (parents, students,
  // ledger) so the debt dashboard refreshes after any mutation instead of
  // freezing at first mount.
  return derived([store.parents$, store.students$, store.ledger$], () => {
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
    return summaries.filter((s) => s.outstandingAmount > 0.001);
  });
}

/**
 * Iteration 5: parent financial profile is computed from the ledger.
 * `totalDue` = net obligation (charges + adjustments — remises are negative
 *   adjustments). T-103: was `totalCharged`-only, which overstated "Total dû"
 *   for discounted parents and diverged from the Supabase path.
 * `totalPaid` = sum of ALL payment entries (money actually received — the
 *   same definition the Supabase profile uses; `totalCleared` excluded
 *   uncleared funds and diverged cross-mode).
 * `totalOutstanding` = ledger balance (negative = parent credit).
 * `overdueAmount` = INV-4 overdue subset.
 */
export function observeParentFinancialProfile(
  ctx: FinancialOpsCtx,
  parentId: string,
): Observable<ParentFinancialProfile | null> {
  const { store } = ctx;
  // FIX (reactivity): derive from parents + ledger + installments + payments
  // streams so the parent drawer's Finances tab updates immediately after
  // "Encaisser / Régler", adjustments, refunds, or Excel imports.
  return derived(
    [store.parents$, store.ledger$, store.installments$, store.payments$],
    (): ParentFinancialProfile | null => {
      const parent = store.parents.find((p) => p.id === parentId);
      if (!parent) return null;
      const parentEntries = store.ledger.filter((e) => e.parentId === parentId);
      const dueDateMap = buildOverdueDueDateMap(parentEntries);
      const summary = computeParentSummary(parentEntries, parentId, `${parent.firstName} ${parent.lastName}`, dueDateMap);
      const installments = store.installments.filter((i) => i.parentId === parentId);
      const payments = store.payments
        .filter((p) => p.parentId === parentId)
        .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))
        .slice(0, 10);
      // VAULT §07.06 — adjustment history derived from the ledger's
      // adjustment entries (every discretionary adjustment writes one).
      // Previously this was always `[]`, so the parent drawer's Finances tab
      // could never show the audited adjustment trail.
      const adjustments: AccountAdjustment[] = parentEntries
        .filter((e) => e.type === "adjustment" && e.sourceType === "adjustment")
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 20)
        .map((e) => ({
          id: e.sourceId ?? e.id,
          parentId,
          amount: e.amount,
          reason: e.description ?? "Ajustement",
          approvedBy: e.actorId,
          approvedAt: e.at,
          receiptRef: e.receiptNumber,
        }));
      return {
        parentId,
        parentName: `${parent.firstName} ${parent.lastName}`,
        // T-103 (DATA-008) — same definitions as the Supabase-backed profile:
        // net totalDue, all-payments totalPaid, ledger-balance outstanding.
        totalDue: summary.totalCharged + summary.totalAdjusted,
        totalPaid: summary.totalPaid,
        totalOutstanding: summary.totalOutstanding,
        overdueAmount: summary.totalOverdue,
        installments,
        recentPayments: payments,
        adjustments,
      };
    },
  );
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

/**
 * VAULT §07.06 + §10.07 — "Broadcast Overdue Payment Reminders".
 *
 * Sends a reminder notification to EVERY debtor above `minDaysOverdue`
 * (default: all overdue debtors). Each reminder writes an audit entry;
 * one summary audit entry records the bulk trigger.
 */
export async function broadcastDebtReminders(
  ctx: FinancialOpsCtx,
  minDaysOverdue = 0,
  actorId = "usr-current",
): Promise<Result<number>> {
  const { store, appendAudit, nowIso, delay } = ctx;
  await delay(300);

  // Compute each parent's overdue state from the ledger (same replay as the
  // debt dashboard so the broadcast targets exactly what the admin sees).
  let dispatched = 0;
  for (const parent of store.parents) {
    const entries = store.ledger.filter((e) => e.parentId === parent.id);
    const dueDateMap = buildOverdueDueDateMap(entries);
    const summary = computeParentSummary(entries, parent.id, `${parent.firstName} ${parent.lastName}`, dueDateMap);
    const days = maxDaysOverdueFromLedger(entries);
    if (summary.totalOutstanding <= 0.001 || days < minDaysOverdue) continue;

    // Parent-facing notification (web portal inbox).
    store.notifications = [
      {
        id: `ntf-rappel-${parent.id}-${Date.now()}`,
        title: "Rappel — paiement en retard",
        body: `Votre solde en retard s'élève à ${summary.totalOutstanding.toLocaleString("fr-FR")} DZD (${days} jour(s) de retard). Merci de régulariser votre situation auprès de l'administration.`,
        type: "payment_overdue",
        priority: days > 90 ? "urgent" : "high",
        source: "system",
        sourceLabel: "Module Finances",
        entityType: "parent",
        entityId: parent.id,
        targetUserId: null,
        targetRole: null,
        triggeredAt: null,
        readAt: null,
        createdAt: nowIso(),
        createdBy: actorId,
      },
      ...store.notifications,
    ];
    appendAudit({
      action: AuditActions.DebtReminderSent,
      entityType: "parent",
      entityId: parent.id,
      actorId,
      actorName: "Session courante",
      diff: {
        before: null,
        after: { outstanding: summary.totalOutstanding, daysOverdue: days, channel: "web_portal" },
      },
      note: `Rappel diffusé (diffusion groupée) — ${summary.totalOutstanding.toLocaleString("fr-FR")} DZD en retard depuis ${days} j`,
    });
    dispatched++;
  }
  store.notifyNotifications();

  appendAudit({
    action: "debt.broadcast_reminders",
    entityType: "parent",
    entityId: "bulk",
    actorId,
    actorName: "Session courante",
    diff: { before: null, after: { dispatched, minDaysOverdue } },
    note: `Diffusion groupée de rappels de paiement — ${dispatched} destinataire(s)`,
  });
  return Ok(dispatched);
}

/**
 * VAULT §07.06 + §10.07 — "Lock Delinquent Accounts".
 *
 * Applies `FINANCIALLY_RESTRICTED` to every debtor overdue by more than
 * `minDaysOverdue` days (vault default: > 90 days — "may trigger account
 * restrictions" for the 61–90+ severely-overdue tier). Each restriction is
 * audit-logged with before/after deltas; already-restricted parents skip.
 */
export async function lockDelinquentAccounts(
  ctx: FinancialOpsCtx,
  minDaysOverdue = 90,
  actorId = "usr-current",
): Promise<Result<number>> {
  const { store, appendAudit, nowIso, delay } = ctx;
  await delay(300);

  let restricted = 0;
  for (let i = 0; i < store.parents.length; i++) {
    const parent = store.parents[i];
    const entries = store.ledger.filter((e) => e.parentId === parent.id);
    const days = maxDaysOverdueFromLedger(entries);
    if (days <= minDaysOverdue) continue;
    if (parent.financiallyRestricted) continue;

    store.parents[i] = { ...parent, financiallyRestricted: true, updatedAt: nowIso() };
    appendAudit({
      action: "parent.restrict_account",
      entityType: "parent",
      entityId: parent.id,
      actorId,
      actorName: "Session courante",
      diff: {
        before: { financiallyRestricted: false, daysOverdue: days },
        after: { financiallyRestricted: true, daysOverdue: days, reason: "FINANCIALLY_RESTRICTED — créance > " + minDaysOverdue + " jours" },
      },
      note: `Compte restreint (FINANCIALLY_RESTRICTED) — ${days} jours de retard`,
    });
    restricted++;
  }
  if (restricted > 0) {
    store.notifyParents();
  }
  appendAudit({
    action: "debt.lock_delinquent_accounts",
    entityType: "parent",
    entityId: "bulk",
    actorId,
    actorName: "Session courante",
    diff: { before: null, after: { restricted, minDaysOverdue } },
    note: `Verrouillage des comptes délinquants (> ${minDaysOverdue} j) — ${restricted} compte(s) restreint(s)`,
  });
  return Ok(restricted);
}
