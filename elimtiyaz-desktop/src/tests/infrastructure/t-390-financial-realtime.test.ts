import { describe, expect, it } from "vitest";
import type { LedgerEntry } from "../../domain/model/ledger";
import {
  buildCanonicalDebtSummary,
  FINANCE_REALTIME_TABLES,
  isFinanceAuditEvent,
} from "../../infrastructure/supabase/financial-realtime";

function ledgerEntry(overrides: Partial<LedgerEntry>): LedgerEntry {
  return {
    id: overrides.id ?? "led-1",
    tenantId: "tenant-1",
    accountId: "parent:p1:category:tuition",
    parentId: "p1",
    studentId: "s1",
    category: "tuition",
    amount: 0,
    type: "charge",
    sourceType: "manual_entry",
    sourceId: "source-1",
    method: null,
    receiptNumber: null,
    paymentStatus: null,
    reversesId: null,
    description: "test",
    actorId: "actor-1",
    actorName: "Test",
    at: "2026-09-10T10:00:00.000Z",
    metadata: {},
    ...overrides,
  };
}

describe("T-390 financial realtime bridge", () => {
  it("derives créances from the canonical ledger instead of installment snapshots", () => {
    const parents = [
      {
        id: "p1",
        firstName: "Ada",
        lastName: "Lovelace",
        displayName: null,
        phone: "0555000000",
      },
    ];
    const students = [{ parentId: "p1" }, { parentId: "p1" }];
    const ledger = [
      ledgerEntry({ id: "charge-1", amount: 1_000, type: "charge" }),
      ledgerEntry({ id: "payment-1", amount: -250, type: "payment", sourceType: "payment" }),
    ];

    const [debt] = buildCanonicalDebtSummary(parents, students, ledger);

    expect(debt.outstandingAmount).toBeCloseTo(750, 6);
    expect(debt.studentCount).toBe(2);
    expect(debt.parentName).toBe("Ada Lovelace");
  });

  it("does not surface parents whose canonical ledger balance is settled", () => {
    const parents = [
      {
        id: "p1",
        firstName: "Ada",
        lastName: "Lovelace",
        displayName: null,
        phone: "0555000000",
      },
    ];
    const ledger = [
      ledgerEntry({ id: "charge-1", amount: 1_000, type: "charge" }),
      ledgerEntry({ id: "payment-1", amount: -1_000, type: "payment", sourceType: "payment" }),
    ];

    expect(buildCanonicalDebtSummary(parents, [], ledger)).toEqual([]);
  });

  it("refreshes Finance for financial table events and finance audit events only", () => {
    expect(FINANCE_REALTIME_TABLES).toEqual([
      "payments",
      "installments",
      "ledger_entries",
      "expense_tickets",
      "parents",
      "students",
    ]);
    expect(isFinanceAuditEvent({ action: "payment.collect", entityType: "payment" })).toBe(true);
    expect(isFinanceAuditEvent({ action: "grade.enter", entityType: "assessment" })).toBe(false);
  });
});
