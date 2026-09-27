/**
 * Installment query helpers — outstanding, overdue, aging, current tranche.
 *
 * These functions are PURE: they take an array of installments and return
 * derived values. They do NOT mutate state.
 *
 * Extracted from the deleted `installments.ts` shim so all installment
 * queries live in one place alongside the allocator + reversal engines.
 *
 * INV-4 family (T-103): `installmentRemaining` and `totalOutstanding` now
 * subtract `amountPending` — uncleared (pending check/transfer) funds reduce
 * what the parent still owes without marking the tranche paid. This aligns
 * the desktop with the canonical rule (docs/domain/financial-rules.md §4:
 * `clampNonNegative(amount_due − amount_paid − amount_pending)`), the
 * backend waterfall (migration 0034/0040), the website port
 * (`installmentRemainingAmount`) and the Android mirror
 * (`Installment.remaining`). The previous cleared-only variant diverged from
 * all three siblings — the exact defect class the owner reported as
 * Finance-tab vs parent-dossier inconsistency (DATA-008).
 */
import type { Installment, AgingBucket } from "@/domain/model/payment";
import { clampNonNegative, sumOf } from "../shared/money";
import { daysBetweenFloor, isStrictlyPast } from "../shared/dates";
import { sumInstallmentsDue, sumInstallmentsPaid, sumInstallmentsPending } from "./sums";

/** Remaining amount on a single installment (>= 0), INV-4 family. */
export function installmentRemaining(installment: Installment): number {
  return clampNonNegative(
    installment.amountDue - installment.amountPaid - installment.amountPending,
  );
}

/**
 * T-424 (DATA-042) — THE canonical tranche-settled predicate, INV-4 family.
 *
 * A tranche is settled when its status says paid OR nothing remains to
 * collect (`due − paid − pending` clamped at 0 — uncleared pending funds
 * count as coverage, exactly like `installmentRemaining`). One predicate
 * for EVERY surface (Statistics waves/inspector, the Finance wave strip,
 * the CRM échéancier, the Diagnostic Hub) — the per-surface copies this
 * replaces (status-only in Statistics, the inline union in the drawer)
 * rendered DIFFERENT verdicts for the same row (an uncleared cheque
 * covering a tranche: "settled" in the CRM, "not paid" in Statistics).
 *
 * Structurally typed so projections carrying the four fields
 * (`InstallmentScheduleNode`) can use it directly.
 */
export function isInstallmentSettled(installment: {
  readonly status: string | null;
  readonly amountDue: number;
  readonly amountPaid: number;
  readonly amountPending?: number | null;
}): boolean {
  if (installment.status === "paid") return true;
  return (
    clampNonNegative(
      installment.amountDue -
        installment.amountPaid -
        (installment.amountPending ?? 0),
    ) === 0
  );
}

/**
 * T-426 (DATA-045, GitHub issues #24/#25) — THE canonical dynamic-overdue
 * predicate.
 *
 * An installment is overdue when it is NOT settled, its due date is
 * strictly past, and it still owes money:
 * `status !== "paid" && dueDate < now && remaining > 0` (the INV-4
 * remaining family — pending uncleared funds count as coverage, exactly
 * like `isInstallmentSettled`).
 *
 * Why DYNAMIC: the `status` STRING is a write-time snapshot that nothing
 * on live data maintains as "overdue" (live census 2026-09-28: statuses
 * are paid/unpaid/partial — ZERO "overdue" rows — while 874 rows ARE
 * dynamically overdue). Every surface that filtered `status ===
 * "overdue"` rendered "0 f. en retard" / "0 DZD échues" with perfect
 * confidence. Overdue-ness is a property of (due date, now, remaining) —
 * it changes with the clock without any write, so it must be DERIVED,
 * never read from the status string.
 *
 * Structurally typed (like `isInstallmentSettled`) so the repository
 * projections can use it directly.
 */
export function isInstallmentOverdue(
  installment: {
    readonly status: string | null;
    readonly amountDue: number;
    readonly amountPaid: number;
    readonly amountPending?: number | null;
    readonly dueDate: string;
  },
  now: Date = new Date(),
): boolean {
  if (installment.status === "paid") return false;
  if (!isStrictlyPast(installment.dueDate, now)) return false;
  return (
    clampNonNegative(
      installment.amountDue -
        installment.amountPaid -
        (installment.amountPending ?? 0),
    ) > 0
  );
}

/**
 * T-426 (DATA-045): the total DZD currently overdue — the canonical
 * dynamic predicate summed (the KPI's dedicated overdue metric). The
 * pre-existing helper, now documented as the canonical sum of the
 * predicate above: only not-paid, past-due, still-owing rows contribute
 * (a future T2/T3 tranche is "à échoir", never "en retard"; a settled
 * row adds 0 by construction).
 */
export function overdueAmount(installments: readonly Installment[], now: Date = new Date()): number {
  const overdue = installments.filter((i) => isInstallmentOverdue(i, now));
  return sumOf(overdue, (i) => installmentRemaining(i));
}

/**
 * Total outstanding across all given installments (>= 0), INV-4 family.
 * Uncleared pending funds reduce the outstanding amount.
 */
export function totalOutstanding(installments: readonly Installment[]): number {
  return clampNonNegative(
    sumInstallmentsDue(installments) -
      sumInstallmentsPaid(installments) -
      sumInstallmentsPending(installments),
  );
}

/** Maximum days overdue across all overdue installments (0 when none are overdue). */
export function maxDaysOverdue(installments: readonly Installment[], now: Date = new Date()): number {
  const days = installments
    .filter((i) => i.status !== "paid" && isStrictlyPast(i.dueDate, now))
    .map((i) => daysBetweenFloor(i.dueDate, now));
  return days.length === 0 ? 0 : Math.max(...days);
}

/** Classify a days-overdue count into one of 5 canonical aging buckets. */
export function agingBucketFromDays(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 30) return "0_30";
  if (daysOverdue <= 60) return "31_60";
  if (daysOverdue <= 90) return "61_90";
  if (daysOverdue <= 180) return "91_180";
  return "180_plus";
}

/**
 * Label of the next unpaid installment (chronologically first by `dueDate`),
 * optionally narrowed by `category`. Returns `null` when there are no
 * outstanding installments matching the filter.
 */
export function currentTrancheLabel(
  installments: readonly Installment[],
  categoryFilter?: Installment["category"] | null,
): string | null {
  const matching = installments
    .filter((i) => i.status !== "paid")
    .filter((i) => (categoryFilter ? i.category === categoryFilter : true))
    .slice()
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  return matching.length > 0 ? matching[0].label : null;
}
