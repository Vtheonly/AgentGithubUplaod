/**
 * Cross-platform financial consistency runner — TypeScript side.
 *
 * CANONICAL-FINANCIAL-LOGIC.md §9 — both apps MUST produce the same domain
 * state for the same operation. This runner hardcodes its scenario set and
 * runs them through the canonical TypeScript calc engine (`computeParentSummary`,
 * `reconcileLedger`, `evaluateAllSystemDiscounts`, `allocatePaymentToInstallments`).
 * The original 8 YAML scenario files (`financial-tests/scenarios/*.yml`) were
 * RETIRED 2026-09-03 (T-043 pass 2, ADR-006): every scenario's semantics live
 * on in BOTH surviving places — the JSON corpus
 * (`financial-tests/equivalence/scenarios/`: 001..012 mirror these cases) and
 * this runner's hardcoded set. The .yml tree was documentation-only drift-bait
 * (DEAD-004): neither this runner nor the Kotlin runner ever READ the files.
 *
 * The Kotlin runner in
 * `app/src/test/java/com/example/core/CrossPlatformScenarioRunner.kt`
 * runs the same scenarios through the Kotlin calc engine. Both runners
 * produce the same pass/fail results when the implementations are
 * semantically equivalent.
 */
import { describe, test, expect } from "vitest";
import {
  computeAccountBalance,
  computeParentSummary,
} from "../../domain/calc/ledger/balance";
import { buildOverdueDueDateMap } from "../../domain/calc/ledger/overdue";
import {
  createChargeEntry,
  createPaymentEntry,
  createAdjustmentEntry,
  createReversalEntry,
} from "../../domain/calc/ledger/entries";
import { deriveAccountId } from "../../domain/calc/ledger/account-id";
import { allocatePaymentToInstallments } from "../../domain/calc/payment/waterfall-allocator";
import { revertPaymentAllocation } from "../../domain/calc/payment/lifo-reversal";
import {
  evaluateAllSystemDiscounts,
  sumDiscounts,
} from "../../domain/calc/pricing/discount-engine";
import type { LedgerEntry } from "../../domain/model/ledger";

const TENANT = "00000000-0000-0000-0000-000000000001";

describe("cross-platform scenario: single_payment_partial", () => {
  test("balance + installment update", () => {
    const now = new Date("2026-09-20T00:00:00Z");
    const accountId = deriveAccountId("par-001", "tuition", "stu-001");
    const charge = createChargeEntry({
      tenantId: TENANT,
      parentId: "par-001",
      studentId: "stu-001",
      category: "tuition",
      amount: 10_000_000,
      sourceType: "installment",
      sourceId: "ins-001",
      actorId: "system",
      actorName: "System",
      description: "Scolarité Tranche 1",
      at: "2026-09-15T00:00:00Z",
    });
    const entries: LedgerEntry[] = [charge];

    const paymentAmount = 2_500_000;
    const paymentEntry = createPaymentEntry({
      tenantId: TENANT,
      parentId: "par-001",
      studentId: "stu-001",
      category: "tuition",
      amount: paymentAmount,
      method: "cash",
      receiptNumber: "REC-2026-000001",
      paymentStatus: "paid",
      sourceType: "payment",
      sourceId: "pay-001",
      actorId: "usr-001",
      actorName: "Agent comptoir",
      description: "Encaissement REC-2026-000001",
      at: now.toISOString(),
    });
    entries.push(paymentEntry);

    const waterfallInstallment = {
      id: "ins-001",
      parentId: "par-001",
      studentId: "stu-001",
      category: "tuition" as const,
      label: "Tranche 1",
      amountDue: 10_000_000,
      amountPaid: 0,
      amountPending: 0,
      dueDate: "2026-09-15T00:00:00Z",
      paidDate: null,
      status: "unpaid" as const,
    };
    const allocation = allocatePaymentToInstallments(
      [waterfallInstallment],
      paymentAmount,
      "tuition",
      "paid",
    );
    expect(allocation.unallocatedAmount).toBe(0);
    expect(allocation.allocations).toHaveLength(1);
    expect(allocation.allocations[0].allocatedAmount).toBe(2_500_000);
    expect(allocation.allocations[0].newAmountPaid).toBe(2_500_000);
    expect(allocation.allocations[0].newStatus).toBe("partial");

    const balance = computeAccountBalance(entries, accountId, now);
    expect(balance.balance).toBe(7_500_000);
    expect(balance.totalCharged).toBe(10_000_000);
    expect(balance.totalPaid).toBe(2_500_000);
    expect(balance.totalCleared).toBe(2_500_000);
    expect(balance.totalPending).toBe(0);
    expect(balance.totalAdjusted).toBe(0);
    expect(balance.totalRefunded).toBe(0);
    expect(balance.unallocatedCredit).toBe(0);

    const summary = computeParentSummary(entries, "par-001", "Parent Test", new Map(), now);
    expect(summary.totalOutstanding).toBe(7_500_000);
    expect(summary.totalOverdue).toBe(0);
    expect(summary.totalCharged).toBe(10_000_000);
    expect(summary.totalPaid).toBe(2_500_000);
    expect(summary.totalCleared).toBe(2_500_000);
    expect(summary.totalPending).toBe(0);
    expect(summary.totalAdjusted).toBe(0);
    expect(summary.totalRefunded).toBe(0);
    expect(summary.totalUnallocatedCredit).toBe(0);
  });
});

describe("cross-platform scenario: overpayment_creates_parent_credit", () => {
  test("INV-7 — credit lands on parent_credit account", () => {
    const now = new Date("2026-09-20T00:00:00Z");
    const tuitionAccount = deriveAccountId("par-001", "tuition", "stu-001");
    const creditAccount = deriveAccountId("par-001", "parent_credit", null);

    const charge = createChargeEntry({
      tenantId: TENANT,
      parentId: "par-001",
      studentId: "stu-001",
      category: "tuition",
      amount: 10_000_000,
      sourceType: "installment",
      sourceId: "ins-001",
      actorId: "system",
      actorName: "System",
      description: "Scolarité Tranche 1",
      at: "2026-09-15T00:00:00Z",
    });
    const entries: LedgerEntry[] = [charge];

    const paymentAmount = 15_000_000;
    const paymentEntry = createPaymentEntry({
      tenantId: TENANT,
      parentId: "par-001",
      studentId: "stu-001",
      category: "tuition",
      amount: paymentAmount,
      method: "cash",
      receiptNumber: "REC-2026-000002",
      paymentStatus: "paid",
      sourceType: "payment",
      sourceId: "pay-002",
      actorId: "usr-001",
      actorName: "Agent comptoir",
      description: "Encaissement REC-2026-000002",
      at: now.toISOString(),
    });
    entries.push(paymentEntry);

    const waterfallInstallment = {
      id: "ins-001",
      parentId: "par-001",
      studentId: "stu-001",
      category: "tuition" as const,
      label: "Tranche 1",
      amountDue: 10_000_000,
      amountPaid: 0,
      amountPending: 0,
      dueDate: "2026-09-15T00:00:00Z",
      paidDate: null,
      status: "unpaid" as const,
    };
    const allocation = allocatePaymentToInstallments(
      [waterfallInstallment],
      paymentAmount,
      "tuition",
      "paid",
    );
    expect(allocation.unallocatedAmount).toBe(5_000_000);

    const creditEntry = createAdjustmentEntry({
      tenantId: TENANT,
      parentId: "par-001",
      studentId: null,
      category: "parent_credit",
      amount: -allocation.unallocatedAmount,
      sourceType: "adjustment",
      sourceId: "pay-002",
      actorId: "usr-001",
      actorName: "Agent comptoir",
      reason: "Crédit parent (trop-perçu) REC-2026-000002",
      at: now.toISOString(),
    });
    entries.push(creditEntry);

    expect(creditEntry.accountId).toBe(creditAccount);

    const tuitionBalance = computeAccountBalance(entries, tuitionAccount, now);
    // Tuition account: +10M (charge) - 15M (full payment) = -5M (overpayment
    // stuck on this account). The canonical workflow does NOT move the
    // overpayment off the tuition account — it only writes a SEPARATE
    // -5M adjustment on the parent_credit account. This is a known
    // limitation documented in unification-logic-docs/NEXT-ITERATION.md.
    expect(tuitionBalance.balance).toBe(-5_000_000);
    expect(tuitionBalance.totalPaid).toBe(15_000_000);
    expect(tuitionBalance.unallocatedCredit).toBe(0);  // parent_credit is NOT on this account

    const creditBalance = computeAccountBalance(entries, creditAccount, now);
    expect(creditBalance.balance).toBe(-5_000_000);
    expect(creditBalance.unallocatedCredit).toBe(-5_000_000);
    expect(creditBalance.totalAdjusted).toBe(-5_000_000);

    const summary = computeParentSummary(entries, "par-001", "Parent Test", new Map(), now);
    // Total = -5M (tuition overpayment) + -5M (parent_credit) = -10M.
    // The unallocatedCredit rollup only counts parent_credit accounts: -5M.
    expect(summary.totalUnallocatedCredit).toBe(-5_000_000);
  });
});

describe("cross-platform scenario: pending_check_payment", () => {
  test("INV-5 + INV-6 — balance reduced immediately, status=pending_clearance", () => {
    const now = new Date("2026-09-20T00:00:00Z");
    const accountId = deriveAccountId("par-001", "tuition", "stu-001");
    const charge = createChargeEntry({
      tenantId: TENANT,
      parentId: "par-001",
      studentId: "stu-001",
      category: "tuition",
      amount: 10_000_000,
      sourceType: "installment",
      sourceId: "ins-001",
      actorId: "system",
      actorName: "System",
      description: "Scolarité Tranche 1",
      at: "2026-09-15T00:00:00Z",
    });
    const entries: LedgerEntry[] = [charge];

    const paymentEntry = createPaymentEntry({
      tenantId: TENANT,
      parentId: "par-001",
      studentId: "stu-001",
      category: "tuition",
      amount: 10_000_000,
      method: "check",
      receiptNumber: "REC-2026-000003",
      paymentStatus: "pending",
      sourceType: "payment",
      sourceId: "pay-003",
      actorId: "usr-001",
      actorName: "Agent comptoir",
      description: "Chèque REC-2026-000003",
      at: now.toISOString(),
    });
    entries.push(paymentEntry);

    const balance = computeAccountBalance(entries, accountId, now);
    expect(balance.balance).toBe(0);
    expect(balance.totalPaid).toBe(10_000_000);
    expect(balance.totalCleared).toBe(0);
    expect(balance.totalPending).toBe(10_000_000);

    const waterfallInstallment = {
      id: "ins-001",
      parentId: "par-001",
      studentId: "stu-001",
      category: "tuition" as const,
      label: "Tranche 1",
      amountDue: 10_000_000,
      amountPaid: 0,
      amountPending: 0,
      dueDate: "2026-09-15T00:00:00Z",
      paidDate: null,
      status: "unpaid" as const,
    };
    const allocation = allocatePaymentToInstallments(
      [waterfallInstallment],
      10_000_000,
      "tuition",
      "pending",
    );
    expect(allocation.allocations).toHaveLength(1);
    expect(allocation.allocations[0].newAmountPaid).toBe(0);
    expect(allocation.allocations[0].newAmountPending).toBe(10_000_000);
    expect(allocation.allocations[0].newStatus).toBe("pending_clearance");
    expect(allocation.allocations[0].fullySatisfied).toBe(false);
  });
});

describe("cross-platform scenario: refund_cleared_payment", () => {
  test("INV-8 — cleared branch reverts amountPaid", () => {
    const now = new Date("2026-09-25T00:00:00Z");
    const accountId = deriveAccountId("par-001", "tuition", "stu-001");

    const charge = createChargeEntry({
      tenantId: TENANT,
      parentId: "par-001",
      studentId: "stu-001",
      category: "tuition",
      amount: 10_000_000,
      sourceType: "installment",
      sourceId: "ins-001",
      actorId: "system",
      actorName: "System",
      description: "Scolarité Tranche 1",
      at: "2026-09-15T00:00:00Z",
    });
    const payment = createPaymentEntry({
      tenantId: TENANT,
      parentId: "par-001",
      studentId: "stu-001",
      category: "tuition",
      amount: 10_000_000,
      method: "cash",
      receiptNumber: "REC-2026-000001",
      paymentStatus: "paid",
      sourceType: "payment",
      sourceId: "pay-001",
      actorId: "usr-001",
      actorName: "Agent comptoir",
      description: "Encaissement REC-2026-000001",
      at: "2026-09-20T00:00:00Z",
    });
    const entries: LedgerEntry[] = [charge, payment];

    const reversal = createReversalEntry(payment, {
      reason: "Annulation — erreur de saisie",
      actorId: "usr-001",
      actorName: "Agent comptoir",
      at: now.toISOString(),
    });
    entries.push(reversal);

    const waterfallInstallment = {
      id: "ins-001",
      parentId: "par-001",
      studentId: "stu-001",
      category: "tuition" as const,
      label: "Tranche 1",
      amountDue: 10_000_000,
      amountPaid: 10_000_000,
      amountPending: 0,
      dueDate: "2026-09-15T00:00:00Z",
      paidDate: "2026-09-20T00:00:00Z",
      status: "paid" as const,
    };
    const revert = revertPaymentAllocation(
      [waterfallInstallment],
      10_000_000,
      "tuition",
      false,  // originalWasPending — payment was PAID
    );
    expect(revert.reverts).toHaveLength(1);
    expect(revert.reverts[0].newAmountPaid).toBe(0);
    // CANONICAL-FINANCIAL-LOGIC.md §7.3 — `reevaluateInstallmentStatus` uses
    // "pending" (not "unpaid") for the post-revert state when amountPaid=0
    // and the due date is in the future. The "unpaid" status is reserved
    // for initial installment creation, not post-revert state.
    expect(revert.reverts[0].newStatus).toBe("pending");

    const balance = computeAccountBalance(entries, accountId, now);
    expect(balance.balance).toBe(10_000_000);
    expect(balance.totalPaid).toBe(0);
    expect(balance.totalCleared).toBe(0);
  });
});

describe("cross-platform scenario: refund_pending_payment (R5 fix)", () => {
  test("INV-8 — pending branch reverts amountPending", () => {
    const now = new Date("2026-09-25T00:00:00Z");
    const accountId = deriveAccountId("par-001", "tuition", "stu-001");

    const charge = createChargeEntry({
      tenantId: TENANT,
      parentId: "par-001",
      studentId: "stu-001",
      category: "tuition",
      amount: 10_000_000,
      sourceType: "installment",
      sourceId: "ins-001",
      actorId: "system",
      actorName: "System",
      description: "Scolarité Tranche 1",
      at: "2026-09-15T00:00:00Z",
    });
    const payment = createPaymentEntry({
      tenantId: TENANT,
      parentId: "par-001",
      studentId: "stu-001",
      category: "tuition",
      amount: 10_000_000,
      method: "check",
      receiptNumber: "REC-2026-000001",
      paymentStatus: "pending",  // UNCLEARED
      sourceType: "payment",
      sourceId: "pay-001",
      actorId: "usr-001",
      actorName: "Agent comptoir",
      description: "Chèque REC-2026-000001",
      at: "2026-09-20T00:00:00Z",
    });
    const entries: LedgerEntry[] = [charge, payment];

    const reversal = createReversalEntry(payment, {
      reason: "Chèque sans provision",
      actorId: "usr-001",
      actorName: "Agent comptoir",
      at: now.toISOString(),
    });
    entries.push(reversal);

    const waterfallInstallment = {
      id: "ins-001",
      parentId: "par-001",
      studentId: "stu-001",
      category: "tuition" as const,
      label: "Tranche 1",
      amountDue: 10_000_000,
      amountPaid: 0,
      amountPending: 10_000_000,
      dueDate: "2026-09-15T00:00:00Z",
      paidDate: null,
      status: "pending_clearance" as const,
    };
    // CRITICAL: originalWasPending = true because payment was PENDING.
    const revert = revertPaymentAllocation(
      [waterfallInstallment],
      10_000_000,
      "tuition",
      true,   // R5 FIX — was PENDING, revert from amountPending
    );
    expect(revert.reverts).toHaveLength(1);
    expect(revert.reverts[0].newAmountPending).toBe(0);
    expect(revert.reverts[0].newAmountPaid).toBe(0);

    const balance = computeAccountBalance(entries, accountId, now);
    expect(balance.balance).toBe(10_000_000);
    expect(balance.totalPending).toBe(0);  // CRITICAL: amountPending reverted
    expect(balance.totalCleared).toBe(0);
  });
});

describe("cross-platform scenario: discount_engine_all_5_rules", () => {
  test("INV §5 — all 5 discounts fire on gross", () => {
    // CANONICAL-FINANCIAL-LOGIC.md §5 — note the desktop domain layer uses
    // DZD (not centimes) for all money values. The Android Kotlin engine
    // uses centimes (Long). Both are semantically equivalent — the .yml
    // scenario files use centimes, but each runner converts to its
    // platform's convention.
    const evaluations = evaluateAllSystemDiscounts({
      grossTuition: 330_000,    // 330,000 DZD
      previousGradeLevel: "5ap",
      currentGradeLevel: "1am",
      childIndex: 3,
      paymentPlan: "full_annual",
      paymentDate: "2026-06-15T00:00:00Z",
      academicYearStartYear: 2026,
      academicYearStart: new Date(Date.UTC(2026, 8, 1)).toISOString(),
      enrollmentDate: "2020-09-01T00:00:00Z",
      previousRank: 1,
    });
    const total = sumDiscounts(evaluations);
    expect(evaluations).toHaveLength(5);
    expect(evaluations.find((e) => e.code === "passage_palier")!.amount).toBe(-10_000);
    expect(evaluations.find((e) => e.code === "sibling_fixed")!.amount).toBe(-10_000);
    expect(evaluations.find((e) => e.code === "full_annual")!.amount).toBe(-33_000);
    expect(evaluations.find((e) => e.code === "highest_average")!.amount).toBe(-33_000);
    expect(evaluations.find((e) => e.code === "seniority_5y")!.amount).toBe(-16_500);
    expect(total).toBe(-102_500);
    const net = Math.max(0, 330_000 + total);
    expect(net).toBe(227_500);
  });
});

describe("cross-platform scenario: discount_engine_sibling_only", () => {
  test("Single-rule case — only sibling_fixed fires", () => {
    const evaluations = evaluateAllSystemDiscounts({
      grossTuition: 200_000,    // 200,000 DZD
      previousGradeLevel: null,
      currentGradeLevel: "2ap",
      childIndex: 2,
      paymentPlan: "tranches",
      paymentDate: "2026-09-15T00:00:00Z",
      academicYearStartYear: 2026,
      academicYearStart: new Date(Date.UTC(2026, 8, 1)).toISOString(),
      enrollmentDate: "2026-09-01T00:00:00Z",
      previousRank: null,
    });
    const total = sumDiscounts(evaluations);
    expect(evaluations).toHaveLength(1);
    expect(evaluations[0].code).toBe("sibling_fixed");
    expect(evaluations[0].amount).toBe(-5_000);
    expect(total).toBe(-5_000);
    const net = Math.max(0, 200_000 + total);
    expect(net).toBe(195_000);
  });
});
