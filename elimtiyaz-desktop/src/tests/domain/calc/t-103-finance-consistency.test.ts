/**
 * T-103 — financial read-side consistency regression suite.
 *
 * Problems covered:
 *  - DATA-008 (Finance tab vs parent dossier divergence): the desktop's
 *    `installmentRemaining` / `totalOutstanding` used the cleared-only
 *    formula `due − paid`, violating the canonical INV-4-family rule
 *    `clampNonNegative(amount_due − amount_paid − amount_pending)`
 *    (docs/domain/financial-rules.md §4) that the backend waterfall
 *    (migrations 0034/0040), the website port (`installmentRemainingAmount`)
 *    and the Android mirror (`Installment.remaining`) all implement. These
 *    tests pin the desktop to the canonical formula.
 *  - DATA-004 hint fields: `mapPaymentRow` must surface
 *    expected_amount/excess_amount/excess_remark so the payment breakdown
 *    card works on the 0062-reconciled live corpus.
 *  - Profile consistency (DATA-008): the parent financial profile's
 *    `totalDue` must be the NET obligation (charges + adjustments) so the
 *    dossier's "Total dû" equals the Finance tab's "Total dû"
 *    (Σ installments.amount_due) after the 0062 reconciliation;
 *    `totalPaid` counts all payment entries.
 */
import { describe, expect, it } from "vitest";
import {
  installmentRemaining,
  totalOutstanding,
} from "../../../domain/calc/payment/queries";
import {
  sumInstallmentsDue,
  sumInstallmentsPaid,
  sumInstallmentsPending,
} from "../../../domain/calc/payment/sums";
import type { Installment, Payment } from "../../../domain/model/payment";
import { mapPaymentRow } from "../../../infrastructure/supabase/repositories/supabase-shared-repositories";
import type { PaymentRow } from "../../../infrastructure/supabase/types";
import { observeParentFinancialProfile } from "../../../infrastructure/mock/repositories/financial/debt-ops";
import { store } from "../../../infrastructure/mock/repositories/mock-store";
import type { FinancialOpsCtx } from "../../../infrastructure/mock/repositories/financial/types";
import type { LedgerEntry } from "../../../domain/model/ledger";
import type { Parent } from "../../../domain/model/parent";

function installment(overrides: Partial<Installment> = {}): Installment {
  return {
    id: `ins-${Math.random().toString(36).slice(2, 8)}`,
    parentId: "par-001",
    studentId: "stu-001",
    category: "tuition",
    label: "Tranche 1",
    amountDue: 100000,
    amountPaid: 0,
    amountPending: 0,
    dueDate: "2026-09-15T00:00:00Z",
    paidDate: null,
    status: "unpaid",
    ...overrides,
  };
}

describe("installmentRemaining — canonical INV-4 family (due − paid − pending)", () => {
  it("returns due − paid when nothing is pending", () => {
    expect(installmentRemaining(installment({ amountDue: 100000, amountPaid: 30000 }))).toBe(70000);
  });

  it("subtracts uncleared pending funds — the DATA-008 defect", () => {
    // A 40k uncleared check sits on a 100k tranche with 20k cleared:
    // the parent only owes 40k more, not 80k.
    expect(
      installmentRemaining(installment({ amountDue: 100000, amountPaid: 20000, amountPending: 40000 })),
    ).toBe(40000);
  });

  it("clamps to zero when pending + paid covers the tranche (never negative)", () => {
    expect(
      installmentRemaining(installment({ amountDue: 100000, amountPaid: 60000, amountPending: 60000 })),
    ).toBe(0);
  });
});

describe("totalOutstanding — pending funds reduce the outstanding total", () => {
  it("sums due − paid − pending across installments", () => {
    const rows = [
      installment({ amountDue: 100000, amountPaid: 30000, amountPending: 0 }),
      installment({ amountDue: 50000, amountPaid: 0, amountPending: 20000, label: "Tranche 2" }),
    ];
    expect(totalOutstanding(rows)).toBe(100000);
  });

  it("agrees with the sum helpers: due − paid − pending", () => {
    const rows = [
      installment({ amountDue: 80000, amountPaid: 10000, amountPending: 5000 }),
      installment({ amountDue: 60000, amountPaid: 25000, amountPending: 5000, label: "T2" }),
    ];
    expect(totalOutstanding(rows)).toBe(
      sumInstallmentsDue(rows) - sumInstallmentsPaid(rows) - sumInstallmentsPending(rows),
    );
  });

  it("clamps to zero when the schedule is fully covered", () => {
    const rows = [installment({ amountDue: 100000, amountPaid: 100000 })];
    expect(totalOutstanding(rows)).toBe(0);
  });
});

describe("sumInstallmentsPending — new helper (T-103)", () => {
  it("sums amountPending across installments", () => {
    const rows = [
      installment({ amountPending: 12500 }),
      installment({ amountPending: 7500, label: "T2" }),
      installment({ amountPending: 0, label: "T3" }),
    ];
    expect(sumInstallmentsPending(rows)).toBe(20000);
  });
});

describe("mapPaymentRow — DATA-004 hint fields surface in the domain model", () => {
  const baseRow: PaymentRow = {
    id: "pay-1",
    tenant_id: "t-1",
    payment_number: "REC-2026-000001",
    receipt_number: "REC-2026-000001",
    parent_id: "par-1",
    student_id: null,
    invoice_id: null,
    installment_id: null,
    amount: 150000,
    method: "cash",
    category: "tuition",
    check_number: null,
    check_bank_name: null,
    check_issue_date: null,
    check_clearance_date: null,
    transfer_reference: null,
    transfer_source_bank: null,
    proof_path: null,
    status: "paid",
    collected_at: "2026-08-11T20:16:00Z",
    collected_by: null,
    notes: null,
    reversal_of_payment_id: null,
    expected_amount: 100000,
    excess_amount: 50000,
    excess_remark: "Réconciliation 0062 — excédent (crédit parent)",
    created_at: "2026-08-11T20:16:00Z",
    updated_at: "2026-08-11T20:16:00Z",
  };

  it("maps expected/excess amounts and the remark", () => {
    const payment: Payment = mapPaymentRow(baseRow);
    expect(payment.expectedAmount).toBe(100000);
    expect(payment.excessAmount).toBe(50000);
    expect(payment.excessRemark).toBe("Réconciliation 0062 — excédent (crédit parent)");
  });

  it("leaves the fields undefined on legacy NULL columns (pre-0033 rows)", () => {
    const payment: Payment = mapPaymentRow({
      ...baseRow,
      expected_amount: null,
      excess_amount: null,
      excess_remark: null,
    });
    expect(payment.expectedAmount).toBeUndefined();
    expect(payment.excessAmount).toBeUndefined();
    expect(payment.excessRemark).toBeNull();
  });
});

describe("observeParentFinancialProfile — dossier totals match the ledger (T-103)", () => {
  const PAR_ID = "par-t103-fin";
  const STU_ID = "stu-t103-fin";

  function ledgerEntry(overrides: Partial<LedgerEntry>): LedgerEntry {
    return {
      id: `led-${Math.random().toString(36).slice(2, 10)}`,
      tenantId: "tenant-t103",
      accountId: `parent:${PAR_ID}:category:tuition:student:${STU_ID}`,
      parentId: PAR_ID,
      studentId: STU_ID,
      category: "tuition",
      amount: 0,
      type: "charge",
      sourceType: "installment",
      sourceId: "ins-t103",
      method: null,
      receiptNumber: null,
      paymentStatus: null,
      reversesId: null,
      description: null,
      actorId: "system",
      actorName: "System",
      at: "2026-08-11T20:16:00Z",
      metadata: {},
      ...overrides,
    };
  }

  it("totalDue is the NET obligation (charges + adjustments) and totalPaid counts all payments", () => {
    // Seed a scratch parent on the (per-worker) mock store.
    const parent: Parent = {
      id: PAR_ID,
      tenantId: "tenant-t103",
      code: "PAR-2026-T103",
      firstName: "T103",
      lastName: "Parent",
      displayName: "T103 Parent",
      gender: "male",
      phone: "0550000000",
      whatsapp: null,
      email: null,
      occupation: null,
      address: null,
      cityTier: null,
      transportDestination: null,
      preferredLanguage: "fr",
      avatarUrl: null,
      isFinanciallyRestricted: false,
      notes: null,
      createdAt: "2026-08-01T00:00:00Z",
      updatedAt: "2026-08-01T00:00:00Z",
    } as unknown as Parent;
    store.parents = [...store.parents.filter((p) => p.id !== PAR_ID), parent];
    store.notifyParents();

    const before = store.ledger.length;
    store.ledger = [
      ...store.ledger,
      // 236,750 charge (devis) − 63,250 remise (adjustment) = 173,500 net,
      // then payments 66,750 + 100,000 = 166,750 received.
      ledgerEntry({ amount: 236750, type: "charge", description: "Devis annuel" }),
      ledgerEntry({ amount: -63250, type: "adjustment", sourceType: "adjustment", sourceId: "adj-t103", description: "Remise sur devis" }),
      ledgerEntry({ amount: -66750, type: "payment", sourceType: "payment", sourceId: "pay-t103-a", method: "cash", receiptNumber: "REC-2026-000991", paymentStatus: "paid", description: "Encaissement V2" }),
      ledgerEntry({ amount: -100000, type: "payment", sourceType: "payment", sourceId: "pay-t103-b", method: "cash", receiptNumber: "REC-2026-000992", paymentStatus: "paid", description: "Encaissement V2_ALT" }),
    ];
    store.notifyLedger();

    const ctx: FinancialOpsCtx = {
      store,
      appendAudit: () => undefined,
      nowIso: () => "2026-09-01T00:00:00Z",
      delay: () => Promise.resolve(),
      tenantId: "tenant-t103",
    };
    const profile = observeParentFinancialProfile(ctx, PAR_ID).get();
    expect(profile).not.toBeNull();
    // Net obligation: charges + (negative) adjustments — matches the
    // installment-schedule view after the 0062 reconciliation.
    expect(profile!.totalDue).toBe(173500);
    // All money received — the number the Finance "Paiements" tab adds up.
    expect(profile!.totalPaid).toBe(166750);
    // Ledger balance: 173,500 − 166,750 = 6,750 remaining.
    expect(profile!.totalOutstanding).toBe(6750);

    // Clean up the scratch rows so other suites in this worker see
    // the store untouched.
    store.ledger = store.ledger.slice(0, before);
    store.parents = store.parents.filter((p) => p.id !== PAR_ID);
    store.notifyLedger();
    store.notifyParents();
  });
});
