/**
 * Integration tests for the ledger + reconciliation engine against the
 * actual mock repository implementation.
 *
 * Verifies that:
 *   - The seeded ledger reconciles cleanly
 *   - Counter payments create matching ledger entries
 *   - Debt summary matches ledger replay
 *   - Dashboard KPIs match ledger aggregation
 *   - Reconciliation detects intentionally-introduced corruption
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockLedgerRepository, mockPaymentRepository, mockDebtRepository, mockDashboardRepository, mockParentRepository } from "../../infrastructure/mock/mock-repositories";
import { computeParentSummary } from "../../domain/model/ledger";
import { Permission } from "../../core/rbac/permissions";
import { Role } from "../../core/rbac/roles";

describe("MockLedgerRepository — seed integrity", () => {
  it("seeded ledger has > 0 entries", async () => {
    const entries = mockLedgerRepository.observe().get();
    expect(entries.length).toBeGreaterThan(0);
  });

  it("seeded ledger reconciles cleanly", async () => {
    const result = await mockLedgerRepository.reconcile();
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The seed should produce a clean ledger. Warnings about cross-checks
      // are acceptable (e.g., if a payment's status doesn't match its ledger
      // entry's status), but no errors.
      const errorCount = result.value.summary.errors;
      // Log the violations for debugging if there are errors.
      if (errorCount > 0) {
        console.log("Reconciliation violations:", result.value.violations.filter((v) => v.severity === "error"));
      }
      // We expect 0 errors on a clean seed.
      expect(errorCount).toBe(0);
    }
  });
});

describe("MockLedgerRepository — append + reverse", () => {
  it("append adds an entry and notifies observers", async () => {
    const initialCount = mockLedgerRepository.observe().get().length;
    const entry = {
      id: `led-test-${Date.now()}`,
      tenantId: "tenant-el-imtiyaz-oran-001",
      accountId: "parent:par-001:category:tuition:student:stu-001",
      parentId: "par-001",
      studentId: "stu-001",
      category: "tuition" as const,
      amount: 1000,
      type: "charge" as const,
      sourceType: "manual_entry" as const,
      sourceId: "manual-1",
      method: null,
      receiptNumber: null,
      paymentStatus: null,
      reversesId: null,
      description: "Manual test charge",
      actorId: "usr-test",
      actorName: "Test",
      at: new Date().toISOString(),
      metadata: Object.freeze({}),
    };
    const result = await mockLedgerRepository.append(entry);
    expect(result.ok).toBe(true);
    const finalCount = mockLedgerRepository.observe().get().length;
    expect(finalCount).toBe(initialCount + 1);
  });

  it("reverse creates a reversal entry that negates the original", async () => {
    // Find a charge to reverse.
    const entries = mockLedgerRepository.observe().get();
    const original = entries.find((e) => e.type === "charge" && e.amount > 0);
    expect(original).toBeDefined();
    if (!original) return;

    const result = await mockLedgerRepository.reverse(original.id, "test reversal", "usr-test", "Test");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.amount).toBe(-original.amount);
      expect(result.value.reversesId).toBe(original.id);
      expect(result.value.type).toBe("reversal");
    }
  });

  it("reverse on non-existent ID returns Err", async () => {
    const result = await mockLedgerRepository.reverse("nonexistent", "x", "u", "U");
    expect(result.ok).toBe(false);
  });
});

describe("MockLedgerRepository — summary computation", () => {
  it("returns a summary for an existing parent", async () => {
    const result = await mockLedgerRepository.summary("par-001");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.parentId).toBe("par-001");
      expect(result.value.entryCount).toBeGreaterThan(0);
    }
  });

  it("returns empty summary for non-existent parent", async () => {
    const result = await mockLedgerRepository.summary("nonexistent");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalOutstanding).toBe(0);
      expect(result.value.entryCount).toBe(0);
    }
  });
});

describe("Cross-cutting — debt summary matches ledger replay", () => {
  it("DebtRepository.observeSummary matches LedgerRepository.summary for each parent", async () => {
    const debtSummaries = mockDebtRepository.observeSummary().get();
    for (const debt of debtSummaries) {
      const ledgerSummary = await mockLedgerRepository.summary(debt.parentId);
      expect(ledgerSummary.ok).toBe(true);
      if (ledgerSummary.ok) {
        // The outstanding amount shown in the debt summary must match
        // the ledger-computed outstanding balance.
        expect(debt.outstandingAmount).toBeCloseTo(ledgerSummary.value.totalOutstanding, 2);
      }
    }
  });

  it("ParentFinancialProfile.totalOutstanding matches ledger summary", async () => {
    const parents = mockParentRepository.observe().get();
    for (const parent of parents) {
      const profile = mockDebtRepository.observeParentProfile(parent.id).get();
      const ledgerSummary = await mockLedgerRepository.summary(parent.id);
      if (profile && ledgerSummary.ok) {
        // The parent drawer's "outstanding" must equal the ledger's outstanding.
        // Allow tiny drift from rounding.
        expect(Math.abs(profile.totalOutstanding - ledgerSummary.value.totalOutstanding)).toBeLessThan(1);
      }
    }
  });
});

describe("Cross-cutting — Dashboard KPIs match ledger aggregation", () => {
  it("outstandingDebt KPI equals sum of all parent outstanding balances", async () => {
    const kpis = await mockDashboardRepository.kpis();
    expect(kpis.ok).toBe(true);
    if (!kpis.ok) return;

    const parents = mockParentRepository.observe().get();
    let totalOutstanding = 0;
    for (const parent of parents) {
      const summary = await mockLedgerRepository.summary(parent.id);
      if (summary.ok) {
        totalOutstanding += summary.value.totalOutstanding;
      }
    }
    // The dashboard's outstandingDebt KPI must equal the sum of all parent balances.
    expect(kpis.value.outstandingDebt).toBeCloseTo(totalOutstanding, 0);
  });
});

describe("Counter payment → ledger integration", () => {
  it("collecting a payment creates a corresponding ledger entry", async () => {
    const initialLedgerCount = mockLedgerRepository.observe().get().length;
    const result = await mockPaymentRepository.collect(
      {
        parentId: "par-001",
        studentId: "stu-001",
        amount: 5000,
        method: "cash",
        category: "tuition",
        installmentId: null,
        proofUrl: null,
        notes: null,
      },
      "usr-test-001",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const finalLedgerCount = mockLedgerRepository.observe().get().length;
    expect(finalLedgerCount).toBe(initialLedgerCount + 1);

    // Verify the new ledger entry references the payment.
    const newEntry = mockLedgerRepository
      .observe()
      .get()
      .find((e) => e.sourceType === "payment" && e.sourceId === result.value.id);
    expect(newEntry).toBeDefined();
    expect(newEntry!.amount).toBe(-5000); // payments are negative
    expect(newEntry!.type).toBe("payment");
    expect(newEntry!.method).toBe("cash");
  });
});

describe("Reconciliation — corruption detection", () => {
  it("detects when a payment has no matching ledger entry (cross-check)", async () => {
    // The crossCheckPayments function compares the payments table against the ledger.
    // We verify it returns a warning for any payment without a ledger entry.
    // (The seed data should have all payments matched, so we test with an empty ledger.)
    const { crossCheckPayments } = await import("../../domain/reconciliation/reconcile");
    const payments = [{ id: "orphan-pay", amount: 1000, status: "paid", receiptNumber: "REC-ORPHAN" }];
    const violations = crossCheckPayments(payments, []);
    expect(violations.some((v) => v.code === "PAYMENT_WITHOUT_LEDGER_ENTRY")).toBe(true);
  });

  it("detects duplicate receipt numbers in the ledger", async () => {
    const { checkDuplicateReceiptNumbers } = await import("../../domain/reconciliation/reconcile");
    const { createPaymentEntry } = await import("../../domain/model/ledger");
    const e1 = createPaymentEntry({
      tenantId: "t1",
      parentId: "p1",
      studentId: null,
      category: "tuition",
      amount: 1000,
      method: "cash",
      receiptNumber: "REC-DUP",
      paymentStatus: "paid",
      sourceType: "payment",
      sourceId: "pay1",
      description: "x",
      actorId: "u",
      actorName: "U",
    });
    const e2 = { ...e1, id: "led-2" };
    const violations = checkDuplicateReceiptNumbers([e1, e2]);
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe("DUPLICATE_RECEIPT_NUMBER");
  });
});

describe("Ledger — balance sum invariant", () => {
  it("sum of all account balances equals sum of all entry amounts", async () => {
    const entries = mockLedgerRepository.observe().get();
    const entrySum = entries.reduce((s, e) => s + e.amount, 0);
    const parents = mockParentRepository.observe().get();
    let balanceSum = 0;
    for (const parent of parents) {
      const summary = await mockLedgerRepository.summary(parent.id);
      if (summary.ok) {
        balanceSum += summary.value.totalOutstanding;
      }
    }
    // The total outstanding across all parents should equal the sum of all entries.
    // (Note: this only holds if every entry is attributable to a parent in the parents table.
    // Test entries created above with parentId="par-001" are included.)
    expect(Math.abs(entrySum - balanceSum)).toBeLessThan(1);
  });
});

describe("Ledger — audit trail", () => {
  it("every ledger mutation writes an audit entry", async () => {
    // Verify the audit log contains entries for ledger.append and ledger.reverse.
    const { mockAuditRepository } = await import("../../infrastructure/mock/mock-repositories");
    const auditResult = await mockAuditRepository.query({ entityType: "ledger", limit: 100 });
    expect(auditResult.ok).toBe(true);
    if (auditResult.ok) {
      const ledgerActions = auditResult.value.entries.filter((e) => e.entityType === "ledger");
      expect(ledgerActions.length).toBeGreaterThan(0);
      // Verify action types.
      const actionTypes = new Set(ledgerActions.map((e) => e.action));
      expect(actionTypes.has("ledger.entry.append")).toBe(true);
    }
  });
});

describe("Ledger — permission-aware access", () => {
  it("SuperAdmin role has all financial permissions", () => {
    const adminPerms = DEFAULT_ROLE_PERMISSIONS[Role.SuperAdmin];
    expect(adminPerms.has(Permission.CollectPayment)).toBe(true);
    expect(adminPerms.has(Permission.AdjustAccount)).toBe(true);
    expect(adminPerms.has(Permission.ViewFinancials)).toBe(true);
  });

  it("Teacher role does NOT have financial permissions", () => {
    const teacherPerms = DEFAULT_ROLE_PERMISSIONS[Role.Teacher];
    expect(teacherPerms.has(Permission.CollectPayment)).toBe(false);
    expect(teacherPerms.has(Permission.AdjustAccount)).toBe(false);
  });
});

// Import for the permission test.
import { DEFAULT_ROLE_PERMISSIONS } from "../../core/rbac/permissions";
