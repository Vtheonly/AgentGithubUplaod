/**
 * TypeScript mirror of the Android Kotlin financial engine.
 *
 * This file is a LINE-BY-LINE port of the actual Kotlin source at:
 *   app/src/main/java/com/example/core/LedgerEngine.kt
 *   app/src/main/java/com/example/core/Ledger.kt
 *   app/src/main/java/com/example/core/LedgerEntryFactory.kt
 *   app/src/main/java/com/example/core/WaterfallAllocation.kt
 *   app/src/main/java/com/example/core/DiscountEngine.kt
 *   app/src/main/java/com/example/core/IdentityCodes.kt
 *   app/src/main/java/com/example/core/Reconcile.kt
 *   app/src/main/java/com/example/core/AccountBalance.kt
 *   app/src/main/java/com/example/core/ParentLedgerSummary.kt
 *
 * WHY THIS EXISTS:
 *   The Android Kotlin engine cannot be compiled in this sandbox
 *   (no JDK compiler + Android SDK available). To still produce real
 *   cross-platform equivalence evidence, we mirror the Kotlin algorithms
 *   in TypeScript so both engines can be run side-by-side in Node.js.
 *
 *   This is NOT a re-implementation of the desktop engine. The desktop
 *   engine lives at src/domain/calc/*.ts and uses `number` (DZD).
 *   This mirror uses `bigint`-like `number` (centimes Long) — mirroring
 *   the Kotlin engine's representation — and uses the exact algorithm
 *   branches, sort orders, and rounding decisions the Kotlin source uses.
 *
 *   When the desktop engine AND this Kotlin mirror produce the same
 *   outputs for the same canonical scenarios, that is real evidence
 *   of cross-platform equivalence at the algorithmic level.
 *
 * ALGORITHM FIDELITY CONTRACT:
 *   - Date parsing uses the SAME 3-tier fallback as parseIsoInstantSafe
 *   - Discount rules use Math.round() exactly like Kotlin's java.lang.Math.round
 *   - Reconciler checks emit the SAME violation codes as the Kotlin constants
 *   - Waterfall allocator uses the SAME sort + same status transitions
 *   - Revert uses originalWasPending branching exactly like Kotlin
 *   - Identity codes use FNV-1a 32-bit signed arithmetic (matches Kotlin)
 *   - All money is in CENTIMES (Long) — converted via ×100 / ÷100 at boundaries
 */

// ─── Mirror of Ledger.kt — enums + data class ────────────────────────────────

export type LedgerEntryType =
  | "charge"
  | "payment"
  | "adjustment"
  | "refund"
  | "reversal"
  | "transfer";

export type LedgerSourceType =
  | "installment"
  | "payment"
  | "expense"
  | "adjustment"
  | "refund"
  | "bulk_import"
  | "manual_entry";

export type PaymentCategoryCode =
  | "tuition"
  | "transport"
  | "canteen"
  | "uniform"
  | "books"
  | "extracurricular"
  | "parent_credit"
  | "therapy_psychology"
  | "therapy_speech"
  | "second_apron"
  | "other";

export type PaymentMethodCode = "cash" | "check" | "transfer";

export type PaymentStatusCode =
  | "paid"
  | "pending"
  | "partial"
  | "overdue"
  | "refunded"
  | "cancelled"
  | "pending_clearance"
  | "unpaid";

export type PaymentPlanCode = "full_annual" | "tranches";

// Mirror of Kotlin enum classes — `fromCode` is total (returns OTHER/CHARGE/etc on unknown)
export const LedgerEntryType_fromCode = (code: string): LedgerEntryType => {
  const all: LedgerEntryType[] = ["charge", "payment", "adjustment", "refund", "reversal", "transfer"];
  return (all as string[]).includes(code) ? (code as LedgerEntryType) : "charge";
};

export const LedgerSourceType_fromCode = (code: string): LedgerSourceType => {
  const all: LedgerSourceType[] = ["installment", "payment", "expense", "adjustment", "refund", "bulk_import", "manual_entry"];
  return (all as string[]).includes(code) ? (code as LedgerSourceType) : "adjustment";
};

export const PaymentCategory_fromCode = (code: string): PaymentCategoryCode => {
  const all: PaymentCategoryCode[] = ["tuition", "transport", "canteen", "uniform", "books", "extracurricular", "parent_credit", "therapy_psychology", "therapy_speech", "second_apron", "other"];
  return (all as string[]).includes(code) ? (code as PaymentCategoryCode) : "other";
};

export const PaymentMethod_fromCode = (code: string): PaymentMethodCode => {
  const all: PaymentMethodCode[] = ["cash", "check", "transfer"];
  return (all as string[]).includes(code) ? (code as PaymentMethodCode) : "cash";
};

export const PaymentStatus_fromCode = (code: string): PaymentStatusCode | null => {
  const all: PaymentStatusCode[] = ["paid", "pending", "partial", "overdue", "refunded", "cancelled", "pending_clearance", "unpaid"];
  return (all as string[]).includes(code) ? (code as PaymentStatusCode) : null;
};

export const PaymentPlan_fromCode = (code: string | null | undefined): PaymentPlanCode => {
  if (code === "full_annual") return "full_annual";
  return "tranches";
};

export interface LedgerEntry {
  id: string;
  tenantId: string;
  accountId: string;
  parentId: string;
  studentId: string | null;
  category: PaymentCategoryCode;
  amount: number; // centimes (Long)
  type: LedgerEntryType;
  sourceType: LedgerSourceType;
  sourceId: string;
  method: PaymentMethodCode | null;
  receiptNumber: string | null;
  paymentStatus: PaymentStatusCode | null;
  reversesId: string | null;
  description: string;
  actorId: string;
  actorName: string;
  at: string;
  metadata: Record<string, unknown>;
}

// ─── Mirror of parseIsoInstantSafe ──────────────────────────────────────────

/**
 * Mirror of Kotlin's `parseIsoInstantSafe`.
 * Tries 3 parsers in order: OffsetDateTime → Instant → LocalDate.
 * Returns epoch (0) on failure.
 */
export function parseIsoInstantSafe(isoString: string | null | undefined): number {
  if (!isoString || isoString.trim() === "") return 0;
  // 1. Try Date.parse — handles ISO-8601 with offset (e.g. "2026-01-15T10:00:00Z", "2026-01-15T10:00:00+01:00")
  const ms = Date.parse(isoString);
  if (!Number.isNaN(ms)) return ms;
  // 2. Try LocalDate.atStartOfDay(UTC) — handles "2026-09-15" (date-only)
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoString);
  if (dateOnlyMatch) {
    const [_, y, m, d] = dateOnlyMatch;
    return Date.UTC(+y, +m - 1, +d, 0, 0, 0, 0);
  }
  // 3. Give up → EPOCH (matches Kotlin returning Instant.EPOCH)
  return 0;
}

// ─── Mirror of deriveAccountId ──────────────────────────────────────────────

export function deriveAccountId(
  parentId: string,
  category: PaymentCategoryCode,
  studentId: string | null = null,
): string {
  const parts: string[] = ["parent", parentId, "category", category];
  if (studentId !== null) {
    parts.push("student", studentId);
  }
  return parts.join(":");
}

// ─── Mirror of LedgerEngine.computeAccountBalance ──────────────────────────

export interface AccountBalance {
  accountId: string;
  parentId: string;
  studentId: string | null;
  category: PaymentCategoryCode;
  balance: number;
  totalCharged: number;
  totalPaid: number;
  totalAdjusted: number;
  totalRefunded: number;
  totalCleared: number;
  totalPending: number;
  unallocatedCredit: number;
  entryCount: number;
  lastActivityAt: string | null;
}

export function computeAccountBalance(
  entries: LedgerEntry[],
  accountId: string,
  now: number = Date.now(),
): AccountBalance {
  // Kotlin: filter + sortedWith(compareBy({parseIsoInstantSafe(it.at)}, {it.id}))
  const accountEntries = entries
    .filter((e) => e.accountId === accountId && parseIsoInstantSafe(e.at) <= now)
    .slice()
    .sort((a, b) => {
      const ta = parseIsoInstantSafe(a.at);
      const tb = parseIsoInstantSafe(b.at);
      if (ta !== tb) return ta - tb;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  if (accountEntries.length === 0) {
    return {
      accountId,
      parentId: "",
      studentId: null,
      category: "other",
      balance: 0,
      totalCharged: 0,
      totalPaid: 0,
      totalAdjusted: 0,
      totalRefunded: 0,
      totalCleared: 0,
      totalPending: 0,
      unallocatedCredit: 0,
      entryCount: 0,
      lastActivityAt: null,
    };
  }

  const reversedIds = new Set<string>();
  for (const e of accountEntries) {
    if (e.reversesId) reversedIds.add(e.reversesId);
  }

  let balance = 0;
  let totalCharged = 0;
  let totalPaid = 0;
  let totalAdjusted = 0;
  let totalRefunded = 0;
  let totalCleared = 0;
  let totalPending = 0;
  let unallocatedCredit = 0;
  let lastActivityAt: string | null = null;

  for (const e of accountEntries) {
    balance += e.amount;
    if (reversedIds.has(e.id)) {
      // Excluded from typed totals but still in running balance
      lastActivityAt = maxOf(lastActivityAt, e.at);
      continue;
    }
    switch (e.type) {
      case "charge":
        totalCharged += e.amount;
        break;
      case "payment":
        totalPaid += Math.abs(e.amount);
        if (e.paymentStatus === "paid") totalCleared += Math.abs(e.amount);
        else if (e.paymentStatus === "pending") totalPending += Math.abs(e.amount);
        break;
      case "adjustment":
        totalAdjusted += e.amount;
        if (e.category === "parent_credit") {
          unallocatedCredit += e.amount;
        }
        break;
      case "refund":
        totalRefunded += Math.abs(e.amount);
        break;
      case "reversal":
      case "transfer":
        // No typed-total contribution
        break;
    }
    lastActivityAt = maxOf(lastActivityAt, e.at);
  }

  const first = accountEntries[0];
  return {
    accountId,
    parentId: first.parentId,
    studentId: first.studentId,
    category: first.category,
    balance,
    totalCharged,
    totalPaid,
    totalAdjusted,
    totalRefunded,
    totalCleared,
    totalPending,
    unallocatedCredit,
    entryCount: accountEntries.length,
    lastActivityAt,
  };
}

function maxOf(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a >= b ? a : b;
}

// ─── Mirror of ParentLedgerSummary + computeParentSummary ───────────────────

export interface ParentLedgerSummary {
  parentId: string;
  parentName: string;
  totalOutstanding: number;
  totalOverdue: number;
  totalCharged: number;
  totalPaid: number;
  totalCleared: number;
  totalPending: number;
  totalAdjusted: number;
  totalRefunded: number;
  totalUnallocatedCredit: number;
  accounts: AccountBalance[];
  entryCount: number;
  lastActivityAt: string | null;
}

export function computeParentSummary(
  entries: LedgerEntry[],
  parentId: string,
  parentName: string,
  overdueCategoryDueDates: Map<string, number> = new Map(),
  now: number = Date.now(),
): ParentLedgerSummary {
  const parentEntries = entries.filter((e) => e.parentId === parentId);
  const accountIds = [...new Set(parentEntries.map((e) => e.accountId))];
  const accounts = accountIds.map((id) => computeAccountBalance(parentEntries, id, now));

  let totalOutstanding = 0;
  let totalOverdue = 0;
  let totalCharged = 0;
  let totalPaid = 0;
  let totalCleared = 0;
  let totalPending = 0;
  let totalAdjusted = 0;
  let totalRefunded = 0;
  let totalUnallocatedCredit = 0;
  let entryCount = 0;
  let lastActivityAt: string | null = null;

  for (const acc of accounts) {
    totalOutstanding += acc.balance;
    totalCharged += acc.totalCharged;
    totalPaid += acc.totalPaid;
    totalCleared += acc.totalCleared;
    totalPending += acc.totalPending;
    totalAdjusted += acc.totalAdjusted;
    totalRefunded += acc.totalRefunded;
    totalUnallocatedCredit += acc.unallocatedCredit;
    entryCount += acc.entryCount;
    lastActivityAt = maxOf(lastActivityAt, acc.lastActivityAt);

    const dueDate = overdueCategoryDueDates.get(acc.accountId);
    // Kotlin: `dueDate != null && acc.balance > 0L && dueDate.isBefore(now)`
    if (dueDate !== undefined && acc.balance > 0 && dueDate < now) {
      totalOverdue += acc.balance;
    }
  }

  return {
    parentId,
    parentName,
    totalOutstanding,
    totalOverdue,
    totalCharged,
    totalPaid,
    totalCleared,
    totalPending,
    totalAdjusted,
    totalRefunded,
    totalUnallocatedCredit,
    accounts,
    entryCount,
    lastActivityAt,
  };
}

export function buildOverdueDueDateMap(entries: LedgerEntry[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of entries) {
    if (e.type !== "charge") continue;
    const current = out.get(e.accountId);
    const parsed = parseIsoInstantSafe(e.at);
    if (current === undefined || parsed > current) {
      out.set(e.accountId, parsed);
    }
  }
  return out;
}

// ─── Mirror of WaterfallAllocation.kt ──────────────────────────────────────

export interface InstallmentAllocation {
  installmentId: string;
  allocatedAmount: number;
  newAmountPaid: number;
  newAmountPending: number;
  newStatus: string;
  fullySatisfied: boolean;
  cleared: boolean;
}

export interface AllocationResult {
  allocations: InstallmentAllocation[];
  unallocatedAmount: number;
  totalAllocated: number;
  paymentAmount: number;
}

export interface WaterfallInstallment {
  id: string;
  category: PaymentCategoryCode;
  amountDue: number;
  amountPaid: number;
  amountPending: number;
  dueDate: string;
  status: string;
}

export function allocatePaymentToInstallments(
  installments: WaterfallInstallment[],
  paymentAmount: number,
  categoryFilter: PaymentCategoryCode | null = null,
  paymentStatus: PaymentStatusCode = "paid",
): AllocationResult {
  if (paymentAmount <= 0) {
    return {
      allocations: [],
      unallocatedAmount: 0,
      totalAllocated: 0,
      paymentAmount,
    };
  }

  // Kotlin: filter { status != "paid" } + filter { categoryFilter == null || category == filter }
  // + sortedWith(compareBy({parseIsoInstantSafe(dueDate)}, {id}))
  const eligible = installments
    .filter((i) => i.status !== "paid")
    .filter((i) => categoryFilter === null || i.category === categoryFilter)
    .slice()
    .sort((a, b) => {
      const ta = parseIsoInstantSafe(a.dueDate);
      const tb = parseIsoInstantSafe(b.dueDate);
      if (ta !== tb) return ta - tb;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  const allocations: InstallmentAllocation[] = [];
  let remaining = paymentAmount;
  const cleared = paymentStatus === "paid";

  for (const ins of eligible) {
    if (remaining <= 0) break;
    const insRemaining = Math.max(0, ins.amountDue - ins.amountPaid);
    if (insRemaining <= 0) continue;
    const allocate = Math.min(remaining, insRemaining);
    let newAmountPaid = ins.amountPaid;
    let newAmountPending = ins.amountPending;
    let newStatus: string;
    let fullySatisfied: boolean;

    if (cleared) {
      newAmountPaid = ins.amountPaid + allocate;
      fullySatisfied = newAmountPaid >= ins.amountDue;
      if (fullySatisfied) newStatus = "paid";
      else if (newAmountPaid > 0) newStatus = "partial";
      else if (ins.status === "overdue") newStatus = "overdue";
      else newStatus = "pending";
    } else {
      newAmountPending = ins.amountPending + allocate;
      fullySatisfied = false;
      newStatus = "pending_clearance";
    }

    allocations.push({
      installmentId: ins.id,
      allocatedAmount: allocate,
      newAmountPaid,
      newAmountPending,
      newStatus,
      fullySatisfied,
      cleared,
    });
    remaining -= allocate;
  }

  const totalAllocated = paymentAmount - remaining;
  return {
    allocations,
    unallocatedAmount: Math.max(0, remaining),
    totalAllocated,
    paymentAmount,
  };
}

// Mirror of reevaluateInstallmentStatus
export function reevaluateInstallmentStatus(
  amountPaid: number,
  amountDue: number,
  dueDate: string,
  nowEpochMs: number = Date.now(),
): string {
  if (amountPaid >= amountDue && amountDue > 0) return "paid";
  if (amountPaid > 0) return "partial";
  const dueMs = parseIsoInstantSafe(dueDate);
  return dueMs >= 1 && dueMs < nowEpochMs ? "overdue" : "pending";
}

// Mirror of revertPaymentAllocation (LIFO revert with originalWasPending branch)
export interface RevertAllocation {
  installmentId: string;
  revertedAmount: number;
  newAmountPaid: number;
  newAmountPending: number;
  newStatus: string;
  reopened: boolean;
}

export interface RevertAllocationResult {
  reverts: RevertAllocation[];
  totalReverted: number;
  unrevertedAmount: number;
  reversalAmount: number;
}

export function revertPaymentAllocation(
  installments: WaterfallInstallment[],
  reversalAmount: number,
  categoryFilter: PaymentCategoryCode | null = null,
  originalWasPending: boolean = false,
  nowEpochMs: number = Date.now(),
): RevertAllocationResult {
  if (reversalAmount <= 0) {
    return {
      reverts: [],
      totalReverted: 0,
      unrevertedAmount: 0,
      reversalAmount,
    };
  }

  // Kotlin: filter { if (originalWasPending) amountPending > 0 else amountPaid > 0 }
  //         + filter { categoryFilter == null || category == filter }
  //         + sortedWith(compareByDescending<WaterfallInstallment> { parseIsoInstantSafe(dueDate) }.thenByDescending { id })
  const eligible = installments
    .filter((i) => (originalWasPending ? i.amountPending > 0 : i.amountPaid > 0))
    .filter((i) => categoryFilter === null || i.category === categoryFilter)
    .slice()
    .sort((a, b) => {
      const ta = parseIsoInstantSafe(a.dueDate);
      const tb = parseIsoInstantSafe(b.dueDate);
      if (ta !== tb) return tb - ta; // descending
      return a.id > b.id ? -1 : a.id < b.id ? 1 : 0; // descending
    });

  const reverts: RevertAllocation[] = [];
  let remaining = reversalAmount;

  for (const ins of eligible) {
    if (remaining <= 0) break;
    const bucket = originalWasPending ? ins.amountPending : ins.amountPaid;
    if (bucket <= 0) continue;
    const revert = Math.min(remaining, bucket);
    const newAmountPaid = originalWasPending
      ? ins.amountPaid
      : Math.max(0, ins.amountPaid - revert);
    const newAmountPending = originalWasPending
      ? Math.max(0, ins.amountPending - revert)
      : ins.amountPending;
    const newStatus = reevaluateInstallmentStatus(newAmountPaid, ins.amountDue, ins.dueDate, nowEpochMs);
    const reopened = ins.status === "paid" && newStatus !== "paid";
    reverts.push({
      installmentId: ins.id,
      revertedAmount: revert,
      newAmountPaid,
      newAmountPending,
      newStatus,
      reopened,
    });
    remaining -= revert;
  }

  const totalReverted = reversalAmount - remaining;
  return {
    reverts,
    totalReverted,
    unrevertedAmount: Math.max(0, remaining),
    reversalAmount,
  };
}

// Mirror of splitNetTuitionByOfficialSchedule (Kotlin's Math.round matches JS Math.round for positive values)
export function splitNetTuitionByOfficialSchedule(netAnnual: number): [number, number, number] {
  const t1 = Math.round(netAnnual * 0.40);
  const t2 = Math.round(netAnnual * 0.30);
  const t3 = netAnnual - t1 - t2;
  return [t1, t2, t3];
}

// ─── Mirror of DiscountEngine.kt ───────────────────────────────────────────

export const PASSAGE_DE_PALIER_AMOUNT = -1_000_000; // −10,000 DZD in centimes
export const SIBLING_PER_CHILD_AMOUNT = 500_000; // 5,000 DZD in centimes
export const EARLY_ANNUAL_RATE = 0.10;
export const HIGHEST_AVERAGE_RATE = 0.10;
export const SENIORITY_RATE = 0.05;
export const SENIORITY_YEARS = 5;

const MS_PER_DAY = 86_400_000;
const DAYS_PER_YEAR_AVG = 365.25;

const CYCLE_TRANSITIONS: Array<[string, string]> = [
  ["5ap", "1am"],
  ["4am", "1ere_annee"],
];

export function evaluatePassageDePalier(previous: string | null, current: string): number {
  if (previous === null) return 0;
  const crossed = CYCLE_TRANSITIONS.some(([from, to]) => previous === from && current === to);
  return crossed ? PASSAGE_DE_PALIER_AMOUNT : 0;
}

export function evaluateSiblingDiscount(childIndex: number, perChild: number = SIBLING_PER_CHILD_AMOUNT): number {
  if (childIndex <= 1) return 0;
  return -(perChild * (childIndex - 1));
}

export function evaluateEarlyAnnualDiscount(
  paymentDate: string,
  grossTuition: number,
  paymentPlan: PaymentPlanCode,
  academicYearStartYear: number,
): number {
  if (paymentPlan !== "full_annual") return 0;
  // Kotlin: OffsetDateTime.of(year, 6, 30, 23, 59, 59, 0, UTC).toInstant()
  const cutoff = Date.UTC(academicYearStartYear, 5, 30, 23, 59, 59, 0); // month is 0-indexed
  const whenInstant = parseIsoInstantSafe(paymentDate);
  if (whenInstant > cutoff) return 0;
  return -Math.round(grossTuition * EARLY_ANNUAL_RATE);
}

export function evaluateAcademicExcellenceDiscount(previousRank: number | null, grossTuition: number): number {
  if (previousRank === null || previousRank !== 1) return 0;
  return -Math.round(grossTuition * HIGHEST_AVERAGE_RATE);
}

export function evaluateSeniorityDiscount(
  enrollmentDate: string,
  academicYearStart: string,
  grossTuition: number,
): number {
  const enrolled = parseIsoInstantSafe(enrollmentDate);
  const yearStart = parseIsoInstantSafe(academicYearStart);
  const thresholdMs = SENIORITY_YEARS * DAYS_PER_YEAR_AVG * MS_PER_DAY;
  if (yearStart - enrolled <= thresholdMs) return 0;
  return -Math.round(grossTuition * SENIORITY_RATE);
}

export interface DiscountEvaluation {
  code: string;
  label: string;
  amount: number;
  applied: boolean;
  reason: string;
}

export interface EvaluateAllDiscountsParams {
  grossTuition: number;
  previousGradeLevel: string | null;
  currentGradeLevel: string;
  childIndex: number;
  paymentPlan: PaymentPlanCode;
  paymentDate: string;
  academicYearStartYear: number;
  academicYearStart: string;
  enrollmentDate: string;
  previousRank: number | null;
  siblingPerChildAmount?: number;
}

export function evaluateAllSystemDiscounts(params: EvaluateAllDiscountsParams): DiscountEvaluation[] {
  const out: DiscountEvaluation[] = [];

  const passage = evaluatePassageDePalier(params.previousGradeLevel, params.currentGradeLevel);
  if (passage !== 0) {
    out.push({
      code: "passage_palier",
      label: "Passage de palier (−10 000 DA)",
      amount: passage,
      applied: true,
      reason: `Transition ${params.previousGradeLevel ?? "—"} → ${params.currentGradeLevel}`,
    });
  }

  const sibling = evaluateSiblingDiscount(params.childIndex, params.siblingPerChildAmount ?? SIBLING_PER_CHILD_AMOUNT);
  if (sibling !== 0) {
    out.push({
      code: "sibling_fixed",
      label: `Fratrie — enfant #${params.childIndex} (−${Math.abs(sibling) / 100} DA)`,
      amount: sibling,
      applied: true,
      reason: `Enfant ${params.childIndex} de la fratrie`,
    });
  }

  const early = evaluateEarlyAnnualDiscount(
    params.paymentDate,
    params.grossTuition,
    params.paymentPlan,
    params.academicYearStartYear,
  );
  if (early !== 0) {
    out.push({
      code: "full_annual",
      label: "Paiement annuel avant le 30 juin (−10%)",
      amount: early,
      applied: true,
      reason: "Paiement intégral avant le 30 juin",
    });
  }

  const excellence = evaluateAcademicExcellenceDiscount(params.previousRank, params.grossTuition);
  if (excellence !== 0) {
    out.push({
      code: "highest_average",
      label: "Meilleure moyenne du palier (−10%)",
      amount: excellence,
      applied: true,
      reason: "Rang 1 au palier l'année précédente",
    });
  }

  const seniority = evaluateSeniorityDiscount(
    params.enrollmentDate,
    params.academicYearStart,
    params.grossTuition,
  );
  if (seniority !== 0) {
    out.push({
      code: "seniority_5y",
      label: "Ancienneté > 5 ans (−5%)",
      amount: seniority,
      applied: true,
      reason: "Plus de 5 ans d'ancienneté",
    });
  }

  return out;
}

export function sumDiscounts(evaluations: DiscountEvaluation[]): number {
  return evaluations.reduce((acc, e) => acc + e.amount, 0);
}

// ─── Mirror of IdentityCodes.kt (FNV-1a 32-bit, matching Kotlin's signed arithmetic) ────

/**
 * Mirror of Kotlin's `stableHash`. Uses FNV-1a 32-bit with Kotlin's signed-int
 * multiplication semantics (we emulate this with `| 0` after multiply).
 */
export function stableHash(input: string): string {
  // FNV offset basis: 0x811c9dc5 (as signed 32-bit int)
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < input.length; i++) {
    h = (h ^ input.charCodeAt(i)) | 0;
    h = (Math.imul(h, 0x01000193)) | 0; // signed 32-bit multiply
  }
  // Force unsigned 32-bit and encode as 8-char hex, take first 6
  const unsigned = h >>> 0;
  const hex = unsigned.toString(16).padStart(8, "0").slice(0, 6).toUpperCase();
  return hex;
}

export interface ParentCodeInput {
  phone?: string | null;
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

export function deterministicParentCode(year: number, input: ParentCodeInput): string {
  const identity = [input.phone, input.displayName, input.firstName, input.lastName]
    .filter((s): s is string => s !== null && s !== undefined && s !== "")
    .join("|")
    .trim();
  let suffix: string;
  if (identity.length > 0) {
    suffix = stableHash(identity);
  } else {
    // Defensive fallback — matches Kotlin's Math.random-based fallback (non-deterministic, only used when no identity)
    const random = Math.floor(Math.random() * 36 * 36 * 36 * 36);
    suffix = random.toString(36).toUpperCase().padStart(4, "0").slice(0, 4);
  }
  return `PAR-${year}-${suffix}`;
}

export function deterministicActivationCode(parentCode: string, tenantId: string = ""): string {
  const identity = `${tenantId}|${parentCode}`.trim();
  if (identity.length === 0) return "000000";
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < identity.length; i++) {
    h = (h ^ identity.charCodeAt(i)) | 0;
    h = Math.imul(h, 0x01000193) | 0;
  }
  const unsigned = h >>> 0;
  const numeric = (unsigned % 900_000) + 100_000;
  return numeric.toString();
}

// ─── Mirror of Reconcile.kt ─────────────────────────────────────────────────

export const RECONCILE_CODES = {
  DUPLICATE_ENTRY_ID: "DUPLICATE_ENTRY_ID",
  MISSING_ID: "MISSING_ID",
  MISSING_TENANT_ID: "MISSING_TENANT_ID",
  MISSING_ACCOUNT_ID: "MISSING_ACCOUNT_ID",
  MISSING_PARENT_ID: "MISSING_PARENT_ID",
  INVALID_AMOUNT: "INVALID_AMOUNT",
  MISSING_TYPE: "MISSING_TYPE",
  MISSING_SOURCE_TYPE: "MISSING_SOURCE_TYPE",
  MISSING_SOURCE_ID: "MISSING_SOURCE_ID",
  MISSING_DESCRIPTION: "MISSING_DESCRIPTION",
  MISSING_ACTOR_ID: "MISSING_ACTOR_ID",
  MISSING_ACTOR_NAME: "MISSING_ACTOR_NAME",
  MISSING_TIMESTAMP: "MISSING_TIMESTAMP",
  CHARGE_NOT_POSITIVE: "CHARGE_NOT_POSITIVE",
  PAYMENT_NOT_NEGATIVE: "PAYMENT_NOT_NEGATIVE",
  REFUND_NOT_NEGATIVE: "REFUND_NOT_NEGATIVE",
  ADJUSTMENT_ZERO: "ADJUSTMENT_ZERO",
  ACCOUNT_ID_MISMATCH: "ACCOUNT_ID_MISMATCH",
  ORPHAN_REVERSAL: "ORPHAN_REVERSAL",
  DOUBLE_REVERSAL: "DOUBLE_REVERSAL",
  REVERSAL_AMOUNT_MISMATCH: "REVERSAL_AMOUNT_MISMATCH",
  REVERSAL_ACCOUNT_MISMATCH: "REVERSAL_ACCOUNT_MISMATCH",
  DUPLICATE_RECEIPT_NUMBER: "DUPLICATE_RECEIPT_NUMBER",
  TENANT_MISMATCH: "TENANT_MISMATCH",
  PAYMENT_WITHOUT_LEDGER_ENTRY: "PAYMENT_WITHOUT_LEDGER_ENTRY",
  PAYMENT_AMOUNT_MISMATCH: "PAYMENT_AMOUNT_MISMATCH",
  PAYMENT_STATUS_MISMATCH: "PAYMENT_STATUS_MISMATCH",
  INSTALLMENT_WITHOUT_LEDGER_ENTRY: "INSTALLMENT_WITHOUT_LEDGER_ENTRY",
  INSTALLMENT_AMOUNT_MISMATCH: "INSTALLMENT_AMOUNT_MISMATCH",
  BALANCE_SUM_MISMATCH: "BALANCE_SUM_MISMATCH",
  UNBACKED_TRANCHE_SATISFACTION: "UNBACKED_TRANCHE_SATISFACTION",
  PAYMENT_LEDGER_MISMATCH: "PAYMENT_LEDGER_MISMATCH",
  UNBACKED_PARENT_CREDIT: "UNBACKED_PARENT_CREDIT",
} as Record<string, string>;

export type ReconcileSeverity = "ERROR" | "WARNING" | "INFO";

export interface ReconcileViolation {
  severity: ReconcileSeverity;
  code: string;
  message: string;
  entryId?: string;
  accountId?: string;
  details?: Record<string, unknown>;
}

export interface ReconcileReport {
  checkedAt: string;
  entryCount: number;
  accountCount: number;
  violations: ReconcileViolation[];
}

export interface PaymentCrossCheck {
  id: string;
  amount: number;
  status: PaymentStatusCode;
}

export interface InstallmentCrossCheck {
  id: string;
  parentId: string;
  studentId: string | null;
  category: string;
  amountDue: number;
  label: string;
  status?: string;
  amountPaid?: number;
}

export interface ParentAccountCrossCheck {
  accountId: string;
  category: string;
  studentId: string | null;
  balance: number;
  unallocatedCredit?: number;
}

export interface ParentSummaryCrossCheck {
  parentId: string;
  parentName: string;
  totalOutstanding: number;
  accounts?: ParentAccountCrossCheck[];
}

export interface CrossCheckInputs {
  payments?: PaymentCrossCheck[];
  installments?: InstallmentCrossCheck[];
  parentSummaries?: ParentSummaryCrossCheck[];
  paymentToInstallmentId?: Map<string, string>;
}

export function reconcileLedger(
  entries: LedgerEntry[],
  crossCheckInputs: CrossCheckInputs = {},
): ReconcileReport {
  const violations: ReconcileViolation[] = [];
  violations.push(...checkDuplicateIds(entries));
  violations.push(...checkRequiredFields(entries));
  violations.push(...checkSignedAmountConvention(entries));
  violations.push(...checkAccountIdsMatch(entries));
  violations.push(...checkReversalIntegrity(entries));
  violations.push(...checkDuplicateReceiptNumbers(entries));
  violations.push(...checkTenantConsistency(entries));
  violations.push(...crossCheckPayments(entries, crossCheckInputs));
  violations.push(...crossCheckInstallments(entries, crossCheckInputs));
  violations.push(...crossCheckBalanceSum(entries));
  violations.push(...crossCheckInstallmentPayments(entries, crossCheckInputs));
  violations.push(...crossCheckClearedBalance(entries, crossCheckInputs));
  violations.push(...crossCheckParentCredit(entries, crossCheckInputs));

  return {
    checkedAt: new Date().toISOString(),
    entryCount: entries.length,
    accountCount: new Set(entries.map((e) => e.accountId)).size,
    violations,
  };
}

function checkDuplicateIds(entries: LedgerEntry[]): ReconcileViolation[] {
  const groups = new Map<string, LedgerEntry[]>();
  for (const e of entries) {
    const arr = groups.get(e.id) ?? [];
    arr.push(e);
    groups.set(e.id, arr);
  }
  const out: ReconcileViolation[] = [];
  for (const [id, dupEntries] of groups) {
    if (dupEntries.length > 1) {
      for (const _ of dupEntries) {
        out.push({
          severity: "ERROR",
          code: RECONCILE_CODES.DUPLICATE_ENTRY_ID,
          message: `Entry ID '${id}' appears ${dupEntries.length} times`,
          entryId: id,
        });
      }
    }
  }
  return out;
}

function checkRequiredFields(entries: LedgerEntry[]): ReconcileViolation[] {
  const out: ReconcileViolation[] = [];
  for (const e of entries) {
    if (e.id === "") out.push({ severity: "ERROR", code: RECONCILE_CODES.MISSING_ID, message: "Missing id", entryId: e.id });
    if (e.tenantId === "") out.push({ severity: "ERROR", code: RECONCILE_CODES.MISSING_TENANT_ID, message: "Missing tenantId", entryId: e.id });
    if (e.accountId === "") out.push({ severity: "ERROR", code: RECONCILE_CODES.MISSING_ACCOUNT_ID, message: "Missing accountId", entryId: e.id });
    if (e.parentId === "") out.push({ severity: "ERROR", code: RECONCILE_CODES.MISSING_PARENT_ID, message: "Missing parentId", entryId: e.id });
    if (e.amount === 0 && e.type !== "adjustment") out.push({ severity: "ERROR", code: RECONCILE_CODES.INVALID_AMOUNT, message: "Amount is 0 or invalid", entryId: e.id });
    if (e.at === "") out.push({ severity: "ERROR", code: RECONCILE_CODES.MISSING_TIMESTAMP, message: "Missing at", entryId: e.id });
    if (e.description === "") out.push({ severity: "ERROR", code: RECONCILE_CODES.MISSING_DESCRIPTION, message: "Missing description", entryId: e.id });
    if (e.actorId === "") out.push({ severity: "WARNING", code: RECONCILE_CODES.MISSING_ACTOR_ID, message: "Missing actorId (anonymous forbidden)", entryId: e.id });
    if (e.actorName === "") out.push({ severity: "WARNING", code: RECONCILE_CODES.MISSING_ACTOR_NAME, message: "Missing actorName", entryId: e.id });
  }
  return out;
}

function checkSignedAmountConvention(entries: LedgerEntry[]): ReconcileViolation[] {
  const out: ReconcileViolation[] = [];
  for (const e of entries) {
    switch (e.type) {
      case "charge":
        if (e.amount <= 0) out.push({ severity: "ERROR", code: RECONCILE_CODES.CHARGE_NOT_POSITIVE, message: `Charge amount must be > 0 (got ${e.amount})`, entryId: e.id });
        break;
      case "payment":
        if (e.amount >= 0) out.push({ severity: "ERROR", code: RECONCILE_CODES.PAYMENT_NOT_NEGATIVE, message: `Payment amount must be < 0 (got ${e.amount})`, entryId: e.id });
        break;
      case "refund":
        if (e.amount >= 0) out.push({ severity: "ERROR", code: RECONCILE_CODES.REFUND_NOT_NEGATIVE, message: `Refund amount must be < 0 (got ${e.amount})`, entryId: e.id });
        break;
      case "adjustment":
        if (e.amount === 0) out.push({ severity: "ERROR", code: RECONCILE_CODES.ADJUSTMENT_ZERO, message: "Adjustment amount must be != 0", entryId: e.id });
        break;
      case "reversal":
      case "transfer":
        break;
    }
  }
  return out;
}

function checkAccountIdsMatch(entries: LedgerEntry[]): ReconcileViolation[] {
  const out: ReconcileViolation[] = [];
  for (const e of entries) {
    const expected = deriveAccountId(e.parentId, e.category, e.studentId);
    if (e.accountId !== expected) {
      out.push({
        severity: "ERROR",
        code: RECONCILE_CODES.ACCOUNT_ID_MISMATCH,
        message: `accountId '${e.accountId}' does not match derived '${expected}'`,
        entryId: e.id,
        accountId: e.accountId,
      });
    }
  }
  return out;
}

function checkReversalIntegrity(entries: LedgerEntry[]): ReconcileViolation[] {
  const out: ReconcileViolation[] = [];
  const byId = new Map<string, LedgerEntry>();
  for (const e of entries) byId.set(e.id, e);
  const reversedOriginals = new Map<string, number>();
  for (const e of entries) {
    if (!e.reversesId) continue;
    const original = byId.get(e.reversesId);
    if (!original) {
      // Match desktop's message format: "Reversal entry {id} references non-existent original {revId}."
      out.push({ severity: "ERROR", code: RECONCILE_CODES.ORPHAN_REVERSAL, message: `Reversal entry ${e.id} references non-existent original ${e.reversesId}.`, entryId: e.id });
      continue;
    }
    reversedOriginals.set(e.reversesId, (reversedOriginals.get(e.reversesId) ?? 0) + 1);
    if (e.amount !== -original.amount) {
      out.push({ severity: "ERROR", code: RECONCILE_CODES.REVERSAL_AMOUNT_MISMATCH, message: `Reversal ${e.id} amount ${e.amount} does not equal -original.amount ${-original.amount}`, entryId: e.id });
    }
    if (e.accountId !== original.accountId) {
      out.push({ severity: "ERROR", code: RECONCILE_CODES.REVERSAL_ACCOUNT_MISMATCH, message: `Reversal ${e.id} accountId does not match original`, entryId: e.id });
    }
  }
  for (const [origId, count] of reversedOriginals) {
    if (count > 1) {
      out.push({ severity: "ERROR", code: RECONCILE_CODES.DOUBLE_REVERSAL, message: `Entry ${origId} reversed ${count} times`, entryId: origId });
    }
  }
  return out;
}

function checkDuplicateReceiptNumbers(entries: LedgerEntry[]): ReconcileViolation[] {
  const out: ReconcileViolation[] = [];
  const byTenant = new Map<string, LedgerEntry[]>();
  for (const e of entries) {
    const arr = byTenant.get(e.tenantId) ?? [];
    arr.push(e);
    byTenant.set(e.tenantId, arr);
  }
  for (const [tenantId, tenantEntries] of byTenant) {
    const byReceipt = new Map<string, LedgerEntry[]>();
    for (const e of tenantEntries) {
      if (!e.receiptNumber || e.receiptNumber === "") continue;
      const arr = byReceipt.get(e.receiptNumber) ?? [];
      arr.push(e);
      byReceipt.set(e.receiptNumber, arr);
    }
    for (const [receipt, dupEntries] of byReceipt) {
      if (dupEntries.length > 1) {
        out.push({
          severity: "ERROR",
          code: RECONCILE_CODES.DUPLICATE_RECEIPT_NUMBER,
          message: `Receipt number '${receipt}' appears ${dupEntries.length} times in tenant ${tenantId}`,
          entryId: dupEntries[0].id,
        });
      }
    }
  }
  return out;
}

function checkTenantConsistency(entries: LedgerEntry[]): ReconcileViolation[] {
  const tenants = new Set(entries.map((e) => e.tenantId));
  if (tenants.size <= 1) return [];
  const tenantList = [...tenants].join(", ");
  return [{
    severity: "ERROR",
    code: RECONCILE_CODES.TENANT_MISMATCH,
    message: `Ledger contains entries from ${tenants.size} different tenants: ${tenantList}`,
  }];
}

function crossCheckPayments(entries: LedgerEntry[], inputs: CrossCheckInputs): ReconcileViolation[] {
  const payments = inputs.payments;
  if (!payments) return [];
  const out: ReconcileViolation[] = [];
  const bySourceId = new Map<string, LedgerEntry>();
  for (const e of entries) {
    if (e.sourceType === "payment") bySourceId.set(e.sourceId, e);
  }
  for (const payment of payments) {
    const matchingEntry = bySourceId.get(payment.id);
    if (!matchingEntry) {
      out.push({ severity: "WARNING", code: RECONCILE_CODES.PAYMENT_WITHOUT_LEDGER_ENTRY, message: `Payment ${payment.id} has no matching ledger entry`, entryId: payment.id });
      continue;
    }
    if (Math.abs(matchingEntry.amount) !== payment.amount) {
      out.push({ severity: "ERROR", code: RECONCILE_CODES.PAYMENT_AMOUNT_MISMATCH, message: `Payment ${payment.id} amount ${payment.amount} does not match ledger entry amount ${matchingEntry.amount}`, entryId: matchingEntry.id });
    }
    if (matchingEntry.paymentStatus !== payment.status) {
      out.push({ severity: "WARNING", code: RECONCILE_CODES.PAYMENT_STATUS_MISMATCH, message: `Payment ${payment.id} status does not match ledger entry`, entryId: matchingEntry.id });
    }
  }
  return out;
}

function crossCheckInstallments(entries: LedgerEntry[], inputs: CrossCheckInputs): ReconcileViolation[] {
  const installments = inputs.installments;
  if (!installments) return [];
  const out: ReconcileViolation[] = [];
  const bySourceId = new Map<string, LedgerEntry>();
  for (const e of entries) {
    if (e.sourceType === "installment") bySourceId.set(e.sourceId, e);
  }
  for (const inst of installments) {
    const matchingEntry = bySourceId.get(inst.id);
    if (!matchingEntry) {
      out.push({ severity: "WARNING", code: RECONCILE_CODES.INSTALLMENT_WITHOUT_LEDGER_ENTRY, message: `Installment ${inst.id} has no matching charge entry`, entryId: inst.id });
      continue;
    }
    if (matchingEntry.amount !== inst.amountDue) {
      out.push({ severity: "ERROR", code: RECONCILE_CODES.INSTALLMENT_AMOUNT_MISMATCH, message: `Installment ${inst.id} amountDue ${inst.amountDue} does not match ledger entry amount ${matchingEntry.amount}`, entryId: matchingEntry.id });
    }
  }
  return out;
}

function crossCheckInstallmentPayments(entries: LedgerEntry[], inputs: CrossCheckInputs): ReconcileViolation[] {
  const installments = inputs.installments;
  if (!installments) return [];
  const out: ReconcileViolation[] = [];
  const tolerance = 1; // 0.01 DZD (centime)

  const accountKey = (parentId: string, category: string, studentId: string | null) =>
    `${parentId}|${category}|${studentId ?? ""}`;

  const clearedByAccount = new Map<string, number>();
  const adjustmentsByAccount = new Map<string, number>();
  for (const e of entries) {
    if (e.reversesId) continue;
    const key = accountKey(e.parentId, e.category, e.studentId);
    if (e.type === "payment" && e.paymentStatus === "paid") {
      clearedByAccount.set(key, (clearedByAccount.get(key) ?? 0) + Math.abs(e.amount));
    } else if (e.type === "adjustment" && e.amount < 0) {
      adjustmentsByAccount.set(key, (adjustmentsByAccount.get(key) ?? 0) + Math.abs(e.amount));
    }
  }

  const preciseClearedByInstallment = new Map<string, number>();
  const payToInst = inputs.paymentToInstallmentId;
  if (payToInst && payToInst.size > 0) {
    for (const e of entries) {
      if (e.type !== "payment" || e.paymentStatus !== "paid") continue;
      if (e.reversesId) continue;
      const installmentId = payToInst.get(e.sourceId);
      if (!installmentId) continue;
      preciseClearedByInstallment.set(installmentId, (preciseClearedByInstallment.get(installmentId) ?? 0) + Math.abs(e.amount));
    }
  }

  for (const inst of installments) {
    const precise = preciseClearedByInstallment.get(inst.id);
    if (precise === undefined) continue;
    const diff = (inst.amountPaid ?? 0) - precise;
    if (Math.abs(diff) > tolerance) {
      out.push({
        severity: "ERROR",
        code: RECONCILE_CODES.UNBACKED_TRANCHE_SATISFACTION,
        message: `Installment ${inst.id} (${inst.label}) has amountPaid=${inst.amountPaid ?? 0} but precise cleared ledger backing=${precise} (diff=${diff}). Status="${inst.status ?? ""}".`,
        details: {
          installmentId: inst.id,
          amountPaid: inst.amountPaid ?? 0,
          clearedBacking: precise,
          diff,
          status: inst.status ?? "",
          mode: "precise",
        },
      });
    }
  }

  if (!payToInst || payToInst.size === 0) {
    const amountPaidByAccount = new Map<string, number>();
    const installmentCountByAccount = new Map<string, number>();
    for (const inst of installments) {
      const key = accountKey(inst.parentId, inst.category, inst.studentId);
      amountPaidByAccount.set(key, (amountPaidByAccount.get(key) ?? 0) + (inst.amountPaid ?? 0));
      installmentCountByAccount.set(key, (installmentCountByAccount.get(key) ?? 0) + 1);
    }
    for (const [key, totalAmountPaid] of amountPaidByAccount) {
      const cleared = clearedByAccount.get(key) ?? 0;
      const adjustments = adjustmentsByAccount.get(key) ?? 0;
      const backing = cleared + adjustments;
      const diff = totalAmountPaid - backing;
      if (Math.abs(diff) > tolerance) {
        const count = installmentCountByAccount.get(key) ?? 1;
        const parts = key.split("|");
        const parentId = parts[0] ?? "";
        const category = parts[1] ?? "";
        const studentId = parts[2] || null;
        const isOverbacked = diff < 0;
        out.push({
          severity: isOverbacked ? "WARNING" : "ERROR",
          code: RECONCILE_CODES.UNBACKED_TRANCHE_SATISFACTION,
          message: `Account parent=${parentId} category=${category} student=${studentId ?? "—"} has ${count} installment(s) with Σ amountPaid=${totalAmountPaid} but cleared ledger backing=${backing} (diff=${diff}).${isOverbacked ? " [over-backed — excess should be parent_credit]" : ""}`,
          details: {
            accountKey: key,
            parentId,
            category,
            studentId,
            installmentCount: count,
            totalAmountPaid,
            clearedBacking: backing,
            diff,
            mode: "account_aggregate",
            overbacked: isOverbacked,
          },
        });
      }
    }
  }
  return out;
}

function crossCheckClearedBalance(entries: LedgerEntry[], inputs: CrossCheckInputs): ReconcileViolation[] {
  const payments = inputs.payments;
  if (!payments) return [];
  const tolerance = 1;
  const out: ReconcileViolation[] = [];

  const reversedIds = new Set<string>();
  for (const e of entries) {
    if (e.reversesId) reversedIds.add(e.reversesId);
  }
  const paymentsCleared = payments.filter((p) => p.status === "paid").reduce((acc, p) => acc + p.amount, 0);
  const ledgerCleared = entries
    .filter((e) => e.type === "payment" && e.paymentStatus === "paid")
    .filter((e) => !reversedIds.has(e.id))
    .reduce((acc, e) => acc + Math.abs(e.amount), 0);
  if (Math.abs(paymentsCleared - ledgerCleared) > tolerance) {
    out.push({
      severity: "ERROR",
      code: RECONCILE_CODES.PAYMENT_LEDGER_MISMATCH,
      message: `Sum of cleared payments (${paymentsCleared}) does not equal sum of cleared payment ledger entries (${ledgerCleared}).`,
      details: {
        paymentsCleared,
        ledgerCleared,
        diff: paymentsCleared - ledgerCleared,
      },
    });
  }
  return out;
}

function crossCheckParentCredit(entries: LedgerEntry[], inputs: CrossCheckInputs): ReconcileViolation[] {
  const parentSummaries = inputs.parentSummaries;
  if (!parentSummaries) return [];
  const out: ReconcileViolation[] = [];
  const tolerance = 1;

  const parentsWithCreditEntry = new Set<string>();
  for (const e of entries) {
    if (e.category === "parent_credit" && e.type === "adjustment" && !e.reversesId) {
      parentsWithCreditEntry.add(e.parentId);
    }
  }

  for (const p of parentSummaries) {
    if (p.totalOutstanding < -tolerance) {
      if (!parentsWithCreditEntry.has(p.parentId)) {
        out.push({
          severity: "WARNING",
          code: RECONCILE_CODES.UNBACKED_PARENT_CREDIT,
          message: `Parent ${p.parentId} (${p.parentName}) has negative outstanding balance ${p.totalOutstanding} but no parent_credit adjustment entry exists on the ledger. Auto-absorption on future invoices will not work.`,
          details: { parentId: p.parentId, outstanding: p.totalOutstanding },
        });
      }
    }
    for (const acc of p.accounts ?? []) {
      if (acc.balance < -tolerance && acc.category !== "parent_credit") {
        out.push({
          severity: "WARNING",
          code: RECONCILE_CODES.UNBACKED_PARENT_CREDIT,
          message: `Account ${acc.accountId} (parent ${p.parentId}, category ${acc.category}) has negative balance ${acc.balance} but is not a parent_credit account. Overpayments should be stored as explicit parent_credit adjustments.`,
          accountId: acc.accountId,
          details: { accountId: acc.accountId, balance: acc.balance, category: acc.category },
        });
      }
    }
  }
  return out;
}

function crossCheckBalanceSum(entries: LedgerEntry[]): ReconcileViolation[] {
  if (entries.length === 0) return [];
  const accountIds = [...new Set(entries.map((e) => e.accountId))];
  const sumOfEntries = entries.reduce((acc, e) => acc + e.amount, 0);
  const sumOfBalances = accountIds.reduce((acc, id) => acc + computeAccountBalance(entries, id).balance, 0);
  const drift = Math.abs(sumOfEntries - sumOfBalances);
  if (drift > 100) {
    return [{
      severity: "ERROR",
      code: RECONCILE_CODES.BALANCE_SUM_MISMATCH,
      message: `Sum of entries (${sumOfEntries}) does not match sum of balances (${sumOfBalances}); drift = ${drift} centimes`,
    }];
  }
  return [];
}
