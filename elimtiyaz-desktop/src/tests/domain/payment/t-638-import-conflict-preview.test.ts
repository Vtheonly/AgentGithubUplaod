/**
 * T-638 / FIN-115 / ADR-038 — the workbook-import conflict preview.
 *
 * Pins the owner's mandate for the IMPORT half: the dry-run analysis
 * separates new payments, idempotent existing matches, potential
 * duplicates, conflicts, partial/correction patterns, overpayments,
 * tranche-total changes and unattributable rows — reusing the SAME
 * shared derivations the commit path uses (etat-identity.ts), so the
 * preview never lies about what the commit will write.
 *
 * NOTE: the fixture amounts are aligned with the REAL price matrix for
 * 1AP (FI = 25,000; V2/tranche3/tranche4 = 89,000/65,500/65,500) so the
 * unrelated overpayment lane stays silent in the tests that target the
 * other classes.
 */
import { describe, it, expect } from "vitest";
import {
  analyzeImportPaymentConflicts,
  importCommitGate,
} from "../../../infrastructure/excel/import-engine/payment-conflict-preview";
import type { ImportRecord } from "../../../infrastructure/excel/import-engine/types";
import type { Parent } from "../../../domain/model/parent";
import type { Student } from "../../../domain/model/student";
import type { Payment, Installment } from "../../../domain/model/payment";

/* ============================================================ */
/*  Fixtures                                                     */
/* ============================================================ */

const NOW = new Date("2026-11-15T12:00:00.000Z");

function makeParent(overrides: Partial<Parent> = {}): Parent {
  return {
    id: overrides.id ?? "p-1",
    tenantId: "t-1",
    code: overrides.code ?? "PAR-1",
    firstName: overrides.firstName ?? "Alice",
    lastName: overrides.lastName ?? "Probe",
    displayName: overrides.displayName ?? "Famille Probe",
    phone: overrides.phone ?? "0550000000",
    email: overrides.email ?? null,
    isActive: true,
    createdAt: "2025-01-01",
    updatedAt: "2025-01-01",
  } as unknown as Parent;
}

function makeStudent(overrides: Partial<Student> = {}): Student {
  return {
    id: overrides.id ?? "s-1",
    tenantId: "t-1",
    parentId: overrides.parentId ?? "p-1",
    firstName: overrides.firstName ?? "Amine",
    lastName: overrides.lastName ?? "Benali",
    displayName: overrides.displayName ?? "BENALI AMINE",
    gender: "male",
    birthDate: "2015-01-01",
    enrollmentDate: "2025-09-01",
    level: "primaire",
    gradeYear: 1,
    gradeLevel: "1ap",
    isActive: true,
  } as unknown as Student;
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  const base: Payment = {
    id: "pay-1",
    tenantId: "t-1",
    receiptNumber: "REC-2026-000001",
    parentId: "p-1",
    studentId: "s-1",
    amount: 50_000,
    method: "cash",
    status: "paid",
    category: "tuition",
    installmentId: null,
    proofUrl: null,
    notes: null,
    collectedBy: "usr-1",
    collectedAt: "2026-09-15T00:00:00.000Z",
    createdAt: "2026-09-15",
    updatedAt: "2026-09-15",
  };
  return { ...base, ...overrides };
}

function makeInstallment(overrides: Partial<Installment> = {}): Installment {
  return {
    id: overrides.id ?? "ins-1",
    parentId: overrides.parentId ?? "p-1",
    studentId: overrides.studentId ?? "s-1",
    category: overrides.category ?? "tuition",
    label: overrides.label ?? "Tranche 1",
    amountDue: overrides.amountDue ?? 122_000,
    amountPaid: overrides.amountPaid ?? 0,
    amountPending: 0,
    dueDate: "2026-09-15",
    paidDate: null,
    status: "pending",
    trancheNumber: 1,
    isCustomSchedule: false,
    customScheduleNote: null,
  } as Installment;
}

/** A minimal coerced ETAT row (the dry-run's output shape). */
function makeRecord(overrides: Partial<ImportRecord> = {}): ImportRecord {
  return {
    infos: null,
    email: null,
    nem: "0550000000",
    tuteur: null,
    nom: "BENALI AMINE",
    niveau: "PRIM",
    classe: "1AP",
    option: null,
    remise: 0,
    justification: null,
    devisAnnuel: 0,
    remboursement: 0,
    dettes: 0,
    reglementsDettes: 0,
    totalVersements: 0,
    totalCreance: 0,
    fi: 0,
    v2: 0,
    v2Alt: 0,
    v3: 0,
    distination: null,
    t1: 0,
    t2: 0,
    t3: 0,
    psy1: 0,
    psy2: 0,
    orth1: 0,
    orth2: 0,
    eplant: 0,
    ratrapage: 0,
    septembre: 0,
    creanceSeptembre: 0,
    decembre: 0,
    creanceDecembre: 0,
    mars: 0,
    creanceMars: 0,
    ...overrides,
  };
}

function analyze(params: {
  records?: Array<{ record: ImportRecord; rowIndex: number }>;
  parents?: readonly Parent[];
  students?: readonly Student[];
  existingPayments?: readonly Payment[];
  installments?: readonly Installment[];
}) {
  return analyzeImportPaymentConflicts({
    records: params.records ?? [],
    parents: params.parents ?? [makeParent()],
    students: params.students ?? [makeStudent()],
    existingPayments: params.existingPayments ?? [],
    installments: params.installments ?? [],
    sourceFile: "Suivis clients 2026_2027.xlsx",
    now: NOW,
  });
}

/* ============================================================ */
/*  A. New families and new payments                              */
/* ============================================================ */
describe("T-638 import preview — new payments", () => {
  it("a brand-new family projects all payments as NEW with zero findings", () => {
    const report = analyze({
      parents: [],
      students: [],
      records: [{ record: makeRecord({ fi: 25_000, v2: 89_000 }), rowIndex: 2 }],
    });
    expect(report.summary.projectedPayments).toBe(2);
    expect(report.summary.newPayments).toBe(2);
    expect(report.summary.existingMatches).toBe(0);
    expect(report.findings).toHaveLength(0);
    expect(report.summary.requiresReview).toBe(0);
    expect(report.pureReimport).toBe(false);
  });

  it("a new CHILD of a known family is NOT a duplicate of the sibling's payments (the name dimension)", () => {
    // The family exists with student Amine; the workbook row is for Karim
    // (a new child) with the SAME tranche amount — the classic sibling
    // false-positive shape the name dimension must defeat.
    const report = analyze({
      records: [{ record: makeRecord({ nom: "BENALI KARIM", v2: 89_000 }), rowIndex: 2 }],
      existingPayments: [
        makePayment({
          id: "pay-amine-v2",
          receiptNumber: "IMP-s-1-V2",
          studentId: "s-1",
          amount: 89_000,
          collectedAt: "2026-09-15T00:00:00.000Z",
        }),
      ],
    });
    expect(report.findings.filter((f) => f.class !== "insufficient_information")).toHaveLength(0);
    expect(report.summary.potentialDuplicates).toBe(0);
    // But the row IS flagged as unattributed (a new child in a known family):
    const unattributed = report.findings.find((f) => f.class === "insufficient_information");
    expect(unattributed).toBeDefined();
    expect(unattributed!.reason).toContain("aucun de ses");
  });
});

/* ============================================================ */
/*  B. The idempotent re-import                                   */
/* ============================================================ */
describe("T-638 import preview — the idempotent re-import", () => {
  it("the SAME student + SAME field + SAME amount → an existing match, NOT a finding (pure re-import)", () => {
    const report = analyze({
      records: [{ record: makeRecord({ v2: 89_000 }), rowIndex: 2 }],
      existingPayments: [
        makePayment({
          id: "imp-pay-s-1-V2",
          receiptNumber: "IMP-s-1-V2",
          studentId: "s-1",
          amount: 89_000,
          collectedAt: "2026-09-15T00:00:00.000Z",
          notes: "Tranche 1 — Scolarité (V1) — import Excel run OLD",
        }),
      ],
    });
    expect(report.summary.existingMatches).toBe(1);
    expect(report.summary.potentialDuplicates).toBe(0);
    expect(report.findings).toHaveLength(0);
    expect(report.pureReimport).toBe(true);
  });

  it("the SAME source cell with a CHANGED amount → conflicting_information (overlapping workbooks)", () => {
    const report = analyze({
      records: [{ record: makeRecord({ v2: 80_000 }), rowIndex: 2 }],
      existingPayments: [
        makePayment({
          id: "imp-pay-s-1-V2",
          receiptNumber: "IMP-s-1-V2",
          studentId: "s-1",
          amount: 89_000,
          collectedAt: "2026-09-15T00:00:00.000Z",
        }),
      ],
    });
    expect(report.summary.conflicts).toBe(1);
    const f = report.findings[0];
    expect(f.class).toBe("conflicting_information");
    expect(f.incomingAmount).toBe(80_000);
    expect(f.existingAmount).toBe(89_000);
    expect(f.rowIndex).toBe(2);
  });
});

/* ============================================================ */
/*  C. Near-miss duplicates against the books                     */
/* ============================================================ */
describe("T-638 import preview — near-miss duplicates", () => {
  it("a manually-registered payment with the same amount a few days from the anchor → possible duplicate", () => {
    // The clerk registered the tranche manually on Sept 18; the workbook
    // projects the same tranche at the Sept 15 anchor — 3 days apart.
    const report = analyze({
      records: [{ record: makeRecord({ v2: 89_000 }), rowIndex: 2 }],
      existingPayments: [
        makePayment({
          id: "pay-manual",
          receiptNumber: "REC-2026-000777",
          studentId: "s-1",
          amount: 89_000,
          collectedAt: "2026-09-18T00:00:00.000Z",
          collectedBy: "clerk",
        }),
      ],
    });
    expect(report.summary.potentialDuplicates).toBe(1);
    const f = report.findings.find((x) => x.class === "possible_duplicate");
    expect(f).toBeDefined();
    expect(f!.reason).toContain("NON établi");
    expect(f!.parentLabel).toContain("Probe");
  });

  it("the same workbook listing the same student twice with the same tranche → an in-workbook duplicate finding", () => {
    const report = analyze({
      records: [
        { record: makeRecord({ v2: 89_000 }), rowIndex: 2 },
        { record: makeRecord({ v2: 89_000 }), rowIndex: 3 },
      ],
    });
    // Both rows resolve to the SAME student → the same source cell twice.
    const dup = report.findings.find((x) => x.class === "confirmed_duplicate");
    expect(dup).toBeDefined();
    expect(dup!.reason).toContain("cellule source");
  });

  it("the same student carrying V2 AND SEPTEMBRE (the same tranche 1 twice) → a high-confidence duplicate", () => {
    const report = analyze({
      records: [{ record: makeRecord({ v2: 89_000, septembre: 89_000 }), rowIndex: 2 }],
    });
    const dup = report.findings.find((x) => x.class === "high_confidence_duplicate");
    expect(dup).toBeDefined();
  });
});

/* ============================================================ */
/*  D. The obligation arithmetic                                  */
/* ============================================================ */
describe("T-638 import preview — partial/correction arithmetic", () => {
  it("existing 60,000 + incoming 29,000 toward the 89,000 obligation → possible partial", () => {
    const report = analyze({
      records: [{ record: makeRecord({ v2: 29_000 }), rowIndex: 2 }],
      installments: [makeInstallment({ amountDue: 89_000, trancheNumber: 1 })],
      existingPayments: [
        makePayment({
          id: "pay-part1",
          receiptNumber: "REC-2026-000101",
          studentId: "s-1",
          amount: 60_000,
          collectedAt: "2026-09-20T00:00:00.000Z",
          expectedAmount: 89_000,
        }),
      ],
    });
    const f = report.findings.find((x) => x.class === "possible_partial_split");
    expect(f).toBeDefined();
    expect(f!.reason).toContain("partiels");
  });

  it("the 44,500 + 44,500 = 89,000 correction shape across the import boundary → possible correction, never a duplicate", () => {
    const report = analyze({
      records: [{ record: makeRecord({ v2: 44_500 }), rowIndex: 2 }],
      installments: [makeInstallment({ amountDue: 89_000, trancheNumber: 1 })],
      existingPayments: [
        makePayment({
          id: "pay-miskeyed",
          receiptNumber: "REC-2026-000102",
          studentId: "s-1",
          amount: 44_500,
          collectedAt: "2026-09-14T00:00:00.000Z",
          expectedAmount: 89_000,
        }),
      ],
    });
    const f = report.findings.find((x) => x.class === "possible_correction");
    expect(f).toBeDefined();
    expect(report.summary.potentialDuplicates).toBe(0);
  });
});

/* ============================================================ */
/*  E. Overpayments and tranche-total changes                     */
/* ============================================================ */
describe("T-638 import preview — overpayments and tranche totals", () => {
  it("an incoming payment above its expected amount → the overpayment finding", () => {
    const report = analyze({
      records: [{ record: makeRecord({ v2: 150_000 }), rowIndex: 2 }],
      installments: [makeInstallment({ amountDue: 122_000, trancheNumber: 1 })],
    });
    const f = report.findings.find((x) => x.class === "tranche_balance_discrepancy");
    expect(f).toBeDefined();
    expect(f!.incomingAmount).toBe(150_000);
    expect(f!.reason).toContain("excédent");
  });

  it("the family projection shows current → incoming → projected against the expected total", () => {
    const report = analyze({
      records: [{ record: makeRecord({ v2: 29_000 }), rowIndex: 2 }],
      installments: [makeInstallment({ amountDue: 89_000, trancheNumber: 1 })],
      existingPayments: [
        makePayment({
          id: "pay-existing",
          receiptNumber: "REC-2026-000103",
          studentId: "s-1",
          amount: 60_000,
          collectedAt: "2026-09-20T00:00:00.000Z",
        }),
      ],
    });
    const row = report.families.find((r) => r.category === "tuition");
    expect(row).toBeDefined();
    expect(row!.currentPaid).toBe(60_000);
    expect(row!.incoming).toBe(29_000);
    expect(row!.projectedPaid).toBe(89_000);
    expect(row!.expectedTotal).toBe(89_000);
    expect(row!.overpaid).toBe(false);
    expect(report.summary.trancheChanges).toBe(1);
  });
});

/* ============================================================ */
/*  F. Purity and determinism                                     */
/* ============================================================ */
describe("T-638 import preview — integrity", () => {
  it("the analysis is pure — inputs are never mutated", () => {
    const records = [{ record: makeRecord({ v2: 89_000 }), rowIndex: 2 }];
    const payments = [makePayment({ id: "pay-x", amount: 89_000, collectedAt: "2026-09-18T00:00:00.000Z" })];
    const frozenRecords = records.map((r) => ({ record: Object.freeze({ ...r.record }), rowIndex: r.rowIndex }));
    const frozenPayments = payments.map((p) => Object.freeze({ ...p }));
    expect(() =>
      analyze({ records: frozenRecords, existingPayments: frozenPayments }),
    ).not.toThrow();
  });

  it("the analysis is deterministic", () => {
    const params = {
      records: [{ record: makeRecord({ v2: 89_000 }), rowIndex: 2 }],
      existingPayments: [
        makePayment({ id: "pay-x", amount: 89_000, collectedAt: "2026-09-18T00:00:00.000Z" }),
      ],
    };
    const r1 = analyze(params);
    const r2 = analyze(params);
    expect(r2.findings.map((f) => f.id)).toEqual(r1.findings.map((f) => f.id));
    expect(r2.summary).toEqual(r1.summary);
  });
});

/* ============================================================ */
/*  G. The commit gate                                            */
/* ============================================================ */
describe("T-638 import preview — the commit gate", () => {
  it("no findings → the gate is OPEN (the button behaves exactly as before)", () => {
    const report = analyze({
      records: [{ record: makeRecord({ fi: 25_000 }), rowIndex: 2 }],
    });
    expect(report.summary.requiresReview).toBe(0);
    expect(importCommitGate(report, 5, false)).toEqual({ canCommit: true, reason: null });
  });

  it("no analysis (the honest-degradation path) → the gate is OPEN", () => {
    expect(importCommitGate(null, 5, false).canCommit).toBe(true);
  });

  it("findings requiring review + no acknowledgment → the gate is CLOSED with the FR reason", () => {
    const report = analyze({
      records: [{ record: makeRecord({ v2: 80_000 }), rowIndex: 2 }],
      existingPayments: [
        makePayment({
          id: "imp-pay-s-1-V2",
          receiptNumber: "IMP-s-1-V2",
          studentId: "s-1",
          amount: 89_000,
          collectedAt: "2026-09-15T00:00:00.000Z",
        }),
      ],
    });
    expect(report.summary.requiresReview).toBeGreaterThan(0);
    const closed = importCommitGate(report, 5, false);
    expect(closed.canCommit).toBe(false);
    expect(closed.reason).toContain("avertissement(s) financier(s)");
    // Acknowledged → open:
    expect(importCommitGate(report, 5, true).canCommit).toBe(true);
  });

  it("zero rows always closes the gate regardless of the acknowledgment", () => {
    expect(importCommitGate(null, 0, true).canCommit).toBe(false);
  });
});
