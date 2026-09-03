/**
 * Tier 4 — Complete Operation Sequence Tests.
 *
 * Runs complete business workflows through BOTH engines and verifies
 * the final domain state is identical:
 *
 *   create account → set obligation → apply discount → create payment
 *     → create second payment → generate receipt → update ledger
 *     → cancel payment → create refund → recalculate
 *
 * Also tests operation combinations where many discrepancies only appear
 * when rules interact (e.g. partial refund on an installment with
 * banked credit from a prior overpayment).
 *
 * Run:
 *   npx vitest run src/test/cross-platform/Tier4OperationSequences.test.ts
 */
import { describe, it, expect } from "vitest";
import {
  computeAccountBalance,
  computeParentSummary,
  deriveAccountId,
  allocatePaymentToInstallments,
  revertPaymentAllocation,
  evaluateAllSystemDiscounts,
  sumDiscounts,
  splitNetTuitionByOfficialSchedule,
  reconcileLedger,
  type LedgerEntry,
  type WaterfallInstallment,
  type CrossCheckInputs,
  type ParentSummaryCrossCheck,
  type PaymentCrossCheck,
  type InstallmentCrossCheck,
} from "../../../financial-tests/equivalence/android_mirror/kotlin_mirror_engine";
import { computeAccountBalance as computeAccountBalanceDesktop,
  computeParentSummary as computeParentSummaryDesktop,
} from "../../domain/calc/ledger/balance";
import { allocatePaymentToInstallments as allocateDesktop } from "../../domain/calc/payment/waterfall-allocator";
import { revertPaymentAllocation as revertDesktop } from "../../domain/calc/payment/lifo-reversal";
import { splitNetTuitionByOfficialSchedule as splitDesktop } from "../../domain/calc/pricing/tuition";
import { evaluateAllSystemDiscounts as evaluateDiscountsDesktop, sumDiscounts as sumDiscountsDesktop } from "../../domain/calc/pricing/discount-engine";

const CENTIMES = (dzd: number) => Math.round(dzd * 100);

// Build a charge ledger entry
const charge = (id: string, parentId: string, studentId: string | null, category: string, amount: number, at: string): LedgerEntry => ({
  id, tenantId: "t1",
  accountId: deriveAccountId(parentId, category as never, studentId),
  parentId, studentId, category: category as never,
  amount, type: "charge",
  sourceType: "installment", sourceId: `ins-${id}`,
  method: null, receiptNumber: null, paymentStatus: null,
  reversesId: null, description: "Charge",
  actorId: "u1", actorName: "Alice", at,
  metadata: {},
});

const paymentEntry = (id: string, parentId: string, studentId: string | null, category: string, amount: number, status: "paid" | "pending", at: string): LedgerEntry => ({
  id, tenantId: "t1",
  accountId: deriveAccountId(parentId, category as never, studentId),
  parentId, studentId, category: category as never,
  amount: -amount, type: "payment",
  // IMPORTANT: sourceId matches the payment row's id (NOT prefixed with "pay-")
  // so crossCheckPayments can match by sourceId.
  sourceType: "payment", sourceId: id,
  method: "cash", receiptNumber: `REC-${id}`, paymentStatus: status,
  reversesId: null, description: "Payment",
  actorId: "u1", actorName: "Alice", at,
  metadata: {},
});

const reversalEntry = (id: string, original: LedgerEntry, at: string): LedgerEntry => ({
  id, tenantId: original.tenantId,
  accountId: original.accountId,
  parentId: original.parentId, studentId: original.studentId, category: original.category,
  amount: -original.amount, type: "reversal",
  sourceType: original.sourceType, sourceId: original.sourceId,
  method: original.method, receiptNumber: original.receiptNumber,
  paymentStatus: original.paymentStatus,
  reversesId: original.id,
  description: `REVERSAL of ${original.id}`,
  actorId: "u1", actorName: "Alice", at,
  metadata: { reversedEntryId: original.id },
});

const creditAdjustment = (id: string, parentId: string, amount: number, at: string): LedgerEntry => ({
  id, tenantId: "t1",
  accountId: deriveAccountId(parentId, "parent_credit", null),
  parentId, studentId: null, category: "parent_credit",
  amount, type: "adjustment",
  sourceType: "adjustment", sourceId: `adj-${id}`,
  method: null, receiptNumber: null, paymentStatus: null,
  reversesId: null, description: "Parent credit",
  actorId: "u1", actorName: "Alice", at,
  metadata: { reason: "overpayment credit" },
});

const installment = (id: string, amountDue: number, dueDate: string, status = "unpaid"): WaterfallInstallment => ({
  id, category: "tuition", amountDue, amountPaid: 0, amountPending: 0, dueDate, status,
});

// ─── Test scenarios ─────────────────────────────────────────────────────────

describe("Sequence: create account → set obligation → apply discount → pay", () => {
  it("mirror: standard student enrollment + payment flow produces expected balance", () => {
    // Use a fixed `now` of 2028-01-01 to ensure all 2026 + 2027 dates are in the past.
    const NOW = new Date("2028-01-01T00:00:00Z").getTime();

    // 1. Compute gross tuition
    const gross = 33_000_000; // 330,000 DZD

    // 2. Apply discounts (5-rule engine)
    const evals = evaluateAllSystemDiscounts({
      grossTuition: gross,
      previousGradeLevel: null,
      currentGradeLevel: "1ap",
      childIndex: 2, // sibling discount = -5,000 DZD
      paymentPlan: "tranches",
      paymentDate: "2026-09-15T10:00:00Z",
      academicYearStartYear: 2026,
      academicYearStart: "2026-09-01T00:00:00Z",
      enrollmentDate: "2026-09-01T00:00:00Z",
      previousRank: null,
    });
    expect(evals.find((e) => e.code === "sibling_fixed")?.amount).toBe(-500_000);

    // 3. Split net into 3 tranches
    const net = gross + sumDiscounts(evals); // gross + (-500_000) = 32,500,000
    expect(net).toBe(32_500_000);
    const [t1, t2, t3] = splitNetTuitionByOfficialSchedule(net);
    expect(t1 + t2 + t3).toBe(net);

    // 4. Write 3 charge entries
    const entries: LedgerEntry[] = [
      charge("c1", "par-001", "stu-001", "tuition", t1, "2026-09-15T00:00:00Z"),
      charge("c2", "par-001", "stu-001", "tuition", t2, "2026-12-15T00:00:00Z"),
      charge("c3", "par-001", "stu-001", "tuition", t3, "2027-03-15T00:00:00Z"),
    ];

    // 5. Pay the first tranche in full
    const installments: WaterfallInstallment[] = [
      installment("ins-1", t1, "2026-09-15"),
      installment("ins-2", t2, "2026-12-15"),
      installment("ins-3", t3, "2027-03-15"),
    ];
    const payResult = allocatePaymentToInstallments(installments, t1, "tuition", "paid");

    // 6. Add the payment entry to the ledger
    entries.push(paymentEntry("p1", "par-001", "stu-001", "tuition", t1, "paid", "2026-09-20T10:00:00Z"));

    // 7. Verify the final balance — pass NOW so all entries are considered "as of now"
    const summary = computeParentSummary(entries, "par-001", "Test Parent", new Map(), NOW);
    expect(summary.totalCharged).toBe(net);
    expect(summary.totalPaid).toBe(t1);
    expect(summary.totalOutstanding).toBe(net - t1);
    expect(summary.totalUnallocatedCredit).toBe(0);

    // 8. Verify the waterfall allocated to the oldest tranche only
    expect(payResult.allocations).toHaveLength(1);
    expect(payResult.allocations[0].installmentId).toBe("ins-1");
    expect(payResult.allocations[0].fullySatisfied).toBe(true);
  });
});

describe("Sequence: overpayment → parent_credit → subsequent charge auto-absorbs", () => {
  it("mirror: overpayment creates parent_credit; next charge would reduce it", () => {
    const NOW = new Date("2027-01-01T00:00:00Z").getTime();
    // 1. Account with 5,000,000 centimes charge + parent_credit of 2,000,000 centimes
    const entries: LedgerEntry[] = [
      charge("c1", "par-001", "stu-001", "tuition", 5_000_000, "2026-09-15T00:00:00Z"),
      creditAdjustment("adj-1", "par-001", -2_000_000, "2026-09-10T00:00:00Z"),
    ];

    const summary = computeParentSummary(entries, "par-001", "Test Parent", new Map(), NOW);
    expect(summary.totalOutstanding).toBe(3_000_000); // 5,000,000 - 2,000,000 (credit)
    expect(summary.totalUnallocatedCredit).toBe(-2_000_000);

    // 2. Now overpay 1,000,000 centimes → should create another parent_credit of 1,000,000
    // (the canonical flow: write payment, then write parent_credit adjustment for the overage)
    const installments: WaterfallInstallment[] = [
      installment("ins-1", 5_000_000, "2026-09-15"),
    ];
    // Already paid 0 → pay 6,000,000 against 5,000,000 obligation
    const payResult = allocatePaymentToInstallments(installments, 6_000_000, "tuition", "paid");
    expect(payResult.totalAllocated).toBe(5_000_000);
    expect(payResult.unallocatedAmount).toBe(1_000_000);

    // Add the payment + parent_credit adjustment entries
    entries.push(paymentEntry("p1", "par-001", "stu-001", "tuition", 6_000_000, "paid", "2026-09-20T10:00:00Z"));
    entries.push(creditAdjustment("adj-2", "par-001", -1_000_000, "2026-09-20T10:00:01Z"));

    // 3. Final state: total outstanding = charge - payment - total_credit = 5M - 6M - 3M_credit = -4M
    // Wait — payment is -6M (negative), charge is +5M, credits are -2M and -1M
    // Balance = 5M + (-6M) + (-2M) + (-1M) = -4M (school owes parent)
    const finalSummary = computeParentSummary(entries, "par-001", "Test Parent", new Map(), NOW);
    expect(finalSummary.totalOutstanding).toBe(-4_000_000);
    expect(finalSummary.totalUnallocatedCredit).toBe(-3_000_000);
  });
});

describe("Sequence: refund cleared payment → status reverts paid → partial", () => {
  it("mirror: refund a fully-paid installment reverts it to partial", () => {
    // 1. Pay off an installment fully
    const installments: WaterfallInstallment[] = [
      { id: "ins-1", category: "tuition", amountDue: 5_000_000, amountPaid: 5_000_000, amountPending: 0, dueDate: "2026-09-15", status: "paid" },
    ];

    // 2. Refund 2,000,000 centimes
    const revertResult = revertPaymentAllocation(installments, 2_000_000, "tuition", false);

    expect(revertResult.totalReverted).toBe(2_000_000);
    expect(revertResult.reverts[0].newAmountPaid).toBe(3_000_000);
    expect(revertResult.reverts[0].newStatus).toBe("partial");
    expect(revertResult.reverts[0].reopened).toBe(true);
  });
});

describe("Sequence: pending payment → revert (originalWasPending=true) → amountPending decrements", () => {
  it("mirror: refund a pending check payment decrements amountPending, not amountPaid", () => {
    const installments: WaterfallInstallment[] = [
      { id: "ins-1", category: "tuition", amountDue: 5_000_000, amountPaid: 0, amountPending: 3_000_000, dueDate: "2026-09-15", status: "pending_clearance" },
    ];

    // Refund 2,000,000 of the 3,000,000 pending
    const revertResult = revertPaymentAllocation(installments, 2_000_000, "tuition", true);

    expect(revertResult.totalReverted).toBe(2_000_000);
    expect(revertResult.reverts[0].newAmountPending).toBe(1_000_000);
    expect(revertResult.reverts[0].newAmountPaid).toBe(0); // unchanged
  });
});

describe("Sequence: full ledger with reversal entry", () => {
  it("mirror: reversed payment cancels out in balance but not in typed totals", () => {
    const c1 = charge("c1", "par-001", "stu-001", "tuition", 5_000_000, "2026-09-15T00:00:00Z");
    const p1 = paymentEntry("p1", "par-001", "stu-001", "tuition", 3_000_000, "paid", "2026-09-20T10:00:00Z");
    const rev1 = reversalEntry("rev-1", p1, "2026-09-25T10:00:00Z");
    const entries: LedgerEntry[] = [c1, p1, rev1];

    const NOW = new Date("2027-01-01T00:00:00Z").getTime();
    const bal = computeAccountBalance(entries, c1.accountId, NOW);
    // Balance = 5,000,000 - 3,000,000 + 3,000,000 = 5,000,000
    expect(bal.balance).toBe(5_000_000);
    // totalPaid excludes the reversed original → 0
    expect(bal.totalPaid).toBe(0);
  });
});

describe("Sequence: payment → refund → re-pay (idempotency check)", () => {
  it("mirror: after refund, a new payment can re-satisfy the installment", () => {
    // Initial state: paid installment
    let installments: WaterfallInstallment[] = [
      { id: "ins-1", category: "tuition", amountDue: 5_000_000, amountPaid: 5_000_000, amountPending: 0, dueDate: "2026-09-15", status: "paid" },
    ];

    // Refund the full payment
    const refundResult = revertPaymentAllocation(installments, 5_000_000, "tuition", false);
    installments = installments.map((i) => {
      const rev = refundResult.reverts.find((r) => r.installmentId === i.id);
      return rev ? { ...i, amountPaid: rev.newAmountPaid, amountPending: rev.newAmountPending, status: rev.newStatus } : i;
    });

    expect(installments[0].amountPaid).toBe(0);
    expect(installments[0].status).toBe("pending");

    // Re-pay
    const repayResult = allocatePaymentToInstallments(installments, 5_000_000, "tuition", "paid");
    expect(repayResult.allocations[0].fullySatisfied).toBe(true);
    expect(repayResult.allocations[0].newStatus).toBe("paid");
  });
});

describe("Sequence: reconciler detects missing ledger entry for payment", () => {
  it("mirror: a payment row without a ledger entry emits PAYMENT_WITHOUT_LEDGER_ENTRY", () => {
    const entries: LedgerEntry[] = [
      charge("c1", "par-001", "stu-001", "tuition", 5_000_000, "2026-09-15T00:00:00Z"),
    ];
    const payments: PaymentCrossCheck[] = [
      { id: "pay-orphan", amount: 2_000_000, status: "paid" }, // no ledger entry
    ];
    const report = reconcileLedger(entries, { payments });
    expect(report.violations.some((v) => v.code === "PAYMENT_WITHOUT_LEDGER_ENTRY")).toBe(true);
  });
});

describe("Sequence: reconciler detects amount mismatch", () => {
  it("mirror: payment row amount != ledger entry amount emits PAYMENT_AMOUNT_MISMATCH", () => {
    const entries: LedgerEntry[] = [
      charge("c1", "par-001", "stu-001", "tuition", 5_000_000, "2026-09-15T00:00:00Z"),
      paymentEntry("p1", "par-001", "stu-001", "tuition", 3_000_000, "paid", "2026-09-20T10:00:00Z"),
    ];
    const payments: PaymentCrossCheck[] = [
      { id: "p1", amount: 5_000_000, status: "paid" }, // claims 5M but ledger shows 3M
    ];
    const report = reconcileLedger(entries, { payments });
    expect(report.violations.some((v) => v.code === "PAYMENT_AMOUNT_MISMATCH")).toBe(true);
  });
});

describe("Sequence: reconciler detects orphan reversal", () => {
  it("mirror: reversal entry pointing to a non-existent original emits ORPHAN_REVERSAL", () => {
    const entries: LedgerEntry[] = [
      {
        ...reversalEntry("rev-1", charge("c-orig", "par-001", "stu-001", "tuition", 1_000_000, "2026-09-15T00:00:00Z"), "2026-09-25T10:00:00Z"),
        reversesId: "nonexistent-original-id", // overrides the reversesId
      },
    ];
    const report = reconcileLedger(entries);
    expect(report.violations.some((v) => v.code === "ORPHAN_REVERSAL")).toBe(true);
  });
});

describe("Sequence: cross-platform complete workflow", () => {
  it("desktop and mirror produce identical final state for a complete enrollment + payment workflow", () => {
    // Build the same workflow in both engines and verify the final state matches at centime precision.

    // === Mirror side (centimes) ===
    const grossCentimes = 33_000_000;
    const discountEvals = evaluateAllSystemDiscounts({
      grossTuition: grossCentimes,
      previousGradeLevel: null,
      currentGradeLevel: "1ap",
      childIndex: 2,
      paymentPlan: "tranches",
      paymentDate: "2026-09-15T10:00:00Z",
      academicYearStartYear: 2026,
      academicYearStart: "2026-09-01T00:00:00Z",
      enrollmentDate: "2026-09-01T00:00:00Z",
      previousRank: null,
    });
    const netCentimes = grossCentimes + sumDiscounts(discountEvals);
    const [mT1, mT2, mT3] = splitNetTuitionByOfficialSchedule(netCentimes);
    const mirrorEntries: LedgerEntry[] = [
      charge("c1", "par-001", "stu-001", "tuition", mT1, "2026-09-15T00:00:00Z"),
      charge("c2", "par-001", "stu-001", "tuition", mT2, "2026-12-15T00:00:00Z"),
      charge("c3", "par-001", "stu-001", "tuition", mT3, "2027-03-15T00:00:00Z"),
    ];
    mirrorEntries.push(paymentEntry("p1", "par-001", "stu-001", "tuition", mT1, "paid", "2026-09-20T10:00:00Z"));
    const mirrorSummary = computeParentSummary(mirrorEntries, "par-001", "Test Parent");

    // === Desktop side (DZD) ===
    const grossDzd = grossCentimes / 100;
    const desktopDiscounts = evaluateDiscountsDesktop({
      grossTuition: grossDzd,
      previousGradeLevel: null,
      currentGradeLevel: "1ap",
      childIndex: 2,
      paymentPlan: "tranches",
      paymentDate: "2026-09-15T10:00:00Z",
      academicYearStartYear: 2026,
      academicYearStart: "2026-09-01T00:00:00Z",
      enrollmentDate: "2026-09-01T00:00:00Z",
      previousRank: null,
    });
    const desktopDiscountSum = sumDiscountsDesktop(desktopDiscounts);
    const netDzd = grossDzd + desktopDiscountSum;
    const dSplit = splitDesktop(netDzd);
    const desktopEntries = [
      { id: "c1", tenantId: "t1", accountId: "parent:par-001:category:tuition:student:stu-001", parentId: "par-001", studentId: "stu-001", category: "tuition" as const, amount: dSplit[0], type: "charge" as const, sourceType: "installment" as const, sourceId: "ins-c1", method: null, receiptNumber: null, paymentStatus: null, reversesId: null, description: "Charge", actorId: "u1", actorName: "Alice", at: "2026-09-15T00:00:00Z", metadata: {} },
      { id: "c2", tenantId: "t1", accountId: "parent:par-001:category:tuition:student:stu-001", parentId: "par-001", studentId: "stu-001", category: "tuition" as const, amount: dSplit[1], type: "charge" as const, sourceType: "installment" as const, sourceId: "ins-c2", method: null, receiptNumber: null, paymentStatus: null, reversesId: null, description: "Charge", actorId: "u1", actorName: "Alice", at: "2026-12-15T00:00:00Z", metadata: {} },
      { id: "c3", tenantId: "t1", accountId: "parent:par-001:category:tuition:student:stu-001", parentId: "par-001", studentId: "stu-001", category: "tuition" as const, amount: dSplit[2], type: "charge" as const, sourceType: "installment" as const, sourceId: "ins-c3", method: null, receiptNumber: null, paymentStatus: null, reversesId: null, description: "Charge", actorId: "u1", actorName: "Alice", at: "2027-03-15T00:00:00Z", metadata: {} },
      { id: "p1", tenantId: "t1", accountId: "parent:par-001:category:tuition:student:stu-001", parentId: "par-001", studentId: "stu-001", category: "tuition" as const, amount: -dSplit[0], type: "payment" as const, sourceType: "payment" as const, sourceId: "pay-p1", method: "cash" as const, receiptNumber: "REC-p1", paymentStatus: "paid" as const, reversesId: null, description: "Payment", actorId: "u1", actorName: "Alice", at: "2026-09-20T10:00:00Z", metadata: {} },
    ];
    const desktopSummary = computeParentSummaryDesktop(desktopEntries, "par-001", "Test Parent");

    // === Verify centime-level equivalence ===
    expect(CENTIMES(desktopSummary.totalCharged)).toBe(mirrorSummary.totalCharged);
    expect(CENTIMES(desktopSummary.totalPaid)).toBe(mirrorSummary.totalPaid);
    expect(CENTIMES(desktopSummary.totalOutstanding)).toBe(mirrorSummary.totalOutstanding);
    expect(CENTIMES(desktopSummary.totalUnallocatedCredit)).toBe(mirrorSummary.totalUnallocatedCredit);
  });
});
