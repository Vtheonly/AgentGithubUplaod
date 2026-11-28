/**
 * T-638 / FIN-115 / ADR-038 — the auditor integration of the canonical
 * payment conflict engine (check 3b: the near-miss conflict lanes).
 *
 * Pins the owner's mandate for the FINANCIAL AUDITOR half:
 *  - near-miss pairs (same subject + amount, days apart) are flagged;
 *  - missing dates/purposes produce degraded classes with named gaps;
 *  - the split/correction obligation arithmetic surfaces as review
 *    findings — never as automatic merges or modifications;
 *  - manual payments (non-import origin) are audited exactly like
 *    imported ones (the all-origins charter);
 *  - the legacy exact-tuple / shared-receipt lanes are NOT double-reported;
 *  - BOTH payments of a conflict pair are accounted (no silent omission
 *    by the reconciled pass);
 *  - refunded/cancelled records are excluded (already corrected);
 *  - the pass is deterministic.
 */
import { describe, it, expect } from "vitest";
import {
  runWebhookDiagnostics,
  type WebhookDiagnosticFinding,
  type WebhookDiagnosticsReport,
} from "../../../domain/calc/payment/webhook-diagnostics";
import type { Payment, Installment, PaymentAllocation } from "../../../domain/model/payment";
import type { LedgerEntry } from "../../../domain/model/ledger";
import type { Parent } from "../../../domain/model/parent";
import type { Student } from "../../../domain/model/student";

const NOW = Date.parse("2026-11-15T12:00:00.000Z");

function makeParent(overrides: Partial<Parent> = {}): Parent {
  return {
    id: overrides.id ?? "p-1",
    tenantId: "t-1",
    code: overrides.code ?? "PAR-1",
    firstName: overrides.firstName ?? "Alice",
    lastName: overrides.lastName ?? "Probe",
    phone: overrides.phone ?? "0550000000",
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
    firstName: overrides.firstName ?? "Kid",
    lastName: overrides.lastName ?? "Probe",
    displayName: null,
    gender: "male",
    birthDate: "2015-01-01",
    enrollmentDate: "2025-09-01",
    level: overrides.level ?? "primaire",
    gradeYear: 1,
    gradeLevel: overrides.gradeLevel ?? "1ap",
    isActive: true,
  } as unknown as Student;
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  const base: Payment = {
    id: "pay-1",
    tenantId: "t-1",
    receiptNumber: "REC-2026-000001",
    parentId: "p-1",
    studentId: null,
    amount: 50_000,
    method: "cash",
    status: "paid",
    category: "tuition",
    installmentId: null,
    proofUrl: null,
    notes: null,
    collectedBy: "usr-1",
    collectedAt: "2026-09-01",
    createdAt: "2026-09-01",
    updatedAt: "2026-09-01",
  };
  return { ...base, ...overrides };
}

function run(params: {
  payments?: readonly Payment[];
  students?: readonly Student[];
  ledgerEntries?: readonly LedgerEntry[];
  installments?: readonly Installment[];
  allocations?: readonly PaymentAllocation[];
}): WebhookDiagnosticsReport {
  return runWebhookDiagnostics({
    payments: params.payments ?? [],
    installments: params.installments ?? [],
    ledgerEntries: params.ledgerEntries ?? [],
    allocations: params.allocations ?? [],
    debtSummaries: [],
    parents: [makeParent()],
    students: params.students ?? [makeStudent()],
    now: NOW,
  });
}

function conflictFindings(report: WebhookDiagnosticsReport): WebhookDiagnosticFinding[] {
  return report.findings.filter((f) => f.id.includes(":conflict:"));
}

/* ============================================================ */
/*  The near-miss duplicate lanes                                 */
/* ============================================================ */
describe("T-638 auditor — near-miss duplicate detection", () => {
  it("same student + amount, 3 days apart, distinct receipts → a conflict possible-duplicate finding", () => {
    const report = run({
      students: [makeStudent({ id: "s-1" })],
      payments: [
        makePayment({ id: "pay-a", studentId: "s-1", amount: 50_000, collectedAt: "2026-09-10", receiptNumber: "REC-A" }),
        makePayment({ id: "pay-b", studentId: "s-1", amount: 50_000, collectedAt: "2026-09-13", receiptNumber: "REC-B" }),
      ],
    });
    const conflicts = conflictFindings(report);
    expect(conflicts).toHaveLength(1);
    const f = conflicts[0];
    expect(f.id).toBe("duplicate_event:conflict:possible_duplicate:pay-a:pay-b");
    expect(f.severity).toBe("warning");
    expect(f.sourceRefs).toContain("payments:pay-a");
    expect(f.sourceRefs).toContain("payments:pay-b");
    expect(f.explanation).toContain("3 jour(s)");
    // The mandate: the certainty is presented as an indicator, never a proof:
    expect(f.explanation).toContain("PAS une preuve");
    expect(f.possibleCauses!.length).toBeGreaterThan(0);
    expect(f.suggestedSteps.length).toBeGreaterThan(0);
  });

  it("a missing date degrades the class and names the gap", () => {
    const report = run({
      students: [makeStudent({ id: "s-1" })],
      payments: [
        makePayment({ id: "pay-a", studentId: "s-1", amount: 50_000, collectedAt: "2026-09-10", receiptNumber: "REC-A" }),
        makePayment({ id: "pay-b", studentId: "s-1", amount: 50_000, collectedAt: "", receiptNumber: "REC-B" }),
      ],
    });
    const conflicts = conflictFindings(report);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].id.startsWith("duplicate_event:conflict:possible_duplicate:")).toBe(true);
    expect(conflicts[0].evidence.some((e) => e.value.includes("Date de paiement manquante"))).toBe(true);
  });

  it("MANUAL payments (no IMP receipt) are audited identically — the all-origins charter", () => {
    const report = run({
      students: [makeStudent({ id: "s-1" })],
      payments: [
        makePayment({ id: "pay-manual-1", studentId: "s-1", amount: 12_000, collectedAt: "2026-10-01", receiptNumber: "REC-2026-000123", collectedBy: "clerk" }),
        makePayment({ id: "pay-manual-2", studentId: "s-1", amount: 12_000, collectedAt: "2026-10-04", receiptNumber: "REC-2026-000124", collectedBy: "clerk" }),
      ],
    });
    expect(conflictFindings(report)).toHaveLength(1);
  });

  it("an identical-tuple pair stays with the LEGACY lane — never double-reported", () => {
    const report = run({
      students: [makeStudent({ id: "s-1" })],
      payments: [
        makePayment({ id: "pay-x", studentId: "s-1", amount: 50_000, collectedAt: "2026-09-10", receiptNumber: "REC-A" }),
        makePayment({ id: "pay-y", studentId: "s-1", amount: 50_000, collectedAt: "2026-09-10", receiptNumber: "REC-B" }),
      ],
    });
    // The legacy finding is present exactly once, the conflict pass silent:
    expect(report.findings.some((f) => f.id === "duplicate_event:dup-tuple:pay-x")).toBe(true);
    expect(conflictFindings(report)).toHaveLength(0);
  });

  it("a shared-receipt pair stays with the LEGACY receipt lane — never double-reported", () => {
    const report = run({
      students: [makeStudent({ id: "s-1" })],
      payments: [
        makePayment({ id: "pay-s1", studentId: "s-1", amount: 50_000, collectedAt: "2026-09-10", receiptNumber: "REC-SAME" }),
        makePayment({ id: "pay-s2", studentId: "s-1", amount: 50_000, collectedAt: "2026-09-10", receiptNumber: "REC-SAME" }),
      ],
    });
    expect(report.findings.some((f) => f.id === "duplicate_event:dup-receipt:REC-SAME")).toBe(true);
    expect(conflictFindings(report)).toHaveLength(0);
  });

  it("refunded/cancelled payments are excluded — the correction flow is not a duplicate", () => {
    const report = run({
      students: [makeStudent({ id: "s-1" })],
      payments: [
        makePayment({ id: "pay-old", studentId: "s-1", amount: 50_000, collectedAt: "2026-09-10", receiptNumber: "REC-A", status: "refunded" }),
        makePayment({ id: "pay-new", studentId: "s-1", amount: 50_000, collectedAt: "2026-09-12", receiptNumber: "REC-B", status: "paid" }),
      ],
    });
    expect(conflictFindings(report)).toHaveLength(0);
  });

  it("two legitimate identical payments two months apart are NOT flagged (distinct, not emitted)", () => {
    const report = run({
      students: [makeStudent({ id: "s-1" })],
      payments: [
        makePayment({ id: "pay-a", studentId: "s-1", amount: 50_000, collectedAt: "2026-09-10", receiptNumber: "REC-A" }),
        makePayment({ id: "pay-b", studentId: "s-1", amount: 50_000, collectedAt: "2026-11-10", receiptNumber: "REC-B" }),
      ],
    });
    expect(conflictFindings(report)).toHaveLength(0);
  });
});

/* ============================================================ */
/*  The obligation arithmetic lanes                               */
/* ============================================================ */
describe("T-638 auditor — partial/correction obligation patterns", () => {
  it("60,000 + 40,000 toward one 100,000 obligation → an outlier_review partial finding", () => {
    const report = run({
      students: [makeStudent({ id: "s-1" })],
      payments: [
        makePayment({ id: "pay-p1", studentId: "s-1", amount: 60_000, collectedAt: "2026-09-15", receiptNumber: "REC-P1", expectedAmount: 100_000 }),
        makePayment({ id: "pay-p2", studentId: "s-1", amount: 40_000, collectedAt: "2026-10-02", receiptNumber: "REC-P2", expectedAmount: 100_000 }),
      ],
    });
    const conflicts = conflictFindings(report);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].id.startsWith("outlier_review:conflict:possible_partial_split:")).toBe(true);
    // The canonical DZD formatter groups with a narrow no-break space.
    expect(conflicts[0].explanation.replace(/\u202f/g, " ")).toContain("100 000");
  });

  it("the 5,000 + 5,000 = 10,000 correction shape → an outlier_review correction finding, NOT a duplicate", () => {
    const report = run({
      students: [makeStudent({ id: "s-1" })],
      payments: [
        makePayment({ id: "pay-c1", studentId: "s-1", amount: 5_000, collectedAt: "2026-09-15", receiptNumber: "REC-C1", expectedAmount: 10_000 }),
        makePayment({ id: "pay-c2", studentId: "s-1", amount: 5_000, collectedAt: "2026-09-16", receiptNumber: "REC-C2", expectedAmount: 10_000 }),
      ],
    });
    const conflicts = conflictFindings(report);
    expect(conflicts).toHaveLength(1);
    const f = conflicts[0];
    expect(f.id.startsWith("outlier_review:conflict:possible_correction:")).toBe(true);
    // Both readings must be presented (the mandate's core example):
    expect(f.explanation).toContain("erreur");
    expect(f.possibleCauses!.some((c) => c.includes("versements prévus"))).toBe(true);
    // It is NEVER presented as an established duplicate:
    expect(f.category).not.toBe("duplicate_event");
  });
});

/* ============================================================ */
/*  The unverifiable-subject lane                                 */
/* ============================================================ */
describe("T-638 auditor — unverifiable subjects", () => {
  it("two family-level payments (student NULL), same amount, dates apart → possible_duplicate with the student gap named", () => {
    const report = run({
      payments: [
        makePayment({ id: "pay-f1", studentId: null, amount: 30_000, collectedAt: "2026-09-15", receiptNumber: "REC-F1" }),
        makePayment({ id: "pay-f2", studentId: null, amount: 30_000, collectedAt: "2026-09-17", receiptNumber: "REC-F2" }),
      ],
    });
    const conflicts = conflictFindings(report);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].id.startsWith("duplicate_event:conflict:possible_duplicate:")).toBe(true);
    expect(conflicts[0].evidence.some((e) => e.value.includes("Élève non renseigné"))).toBe(true);
  });

  it("only family + amount comparable (no student, date, category, year) → the unverified insufficient finding", () => {
    const report = run({
      payments: [
        // Registered payments always carry receipts; the methods differ so
        // the legacy exact-tuple lane does NOT own this pair (it would
        // swallow it as dup-tuple) — the near-miss pass sees it.
        makePayment({ id: "pay-i1", studentId: null, amount: 30_000, collectedAt: "", receiptNumber: "REC-I1", category: null, method: "cash" }),
        makePayment({ id: "pay-i2", studentId: null, amount: 30_000, collectedAt: "", receiptNumber: "REC-I2", category: null, method: "check" }),
      ],
    });
    const conflicts = conflictFindings(report);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].id.startsWith("unverified:conflict:insufficient_information:")).toBe(true);
    expect(conflicts[0].explanation).toContain("insuffisantes");
  });
});

/* ============================================================ */
/*  Accounting, determinism and the never-modify contract         */
/* ============================================================ */
describe("T-638 auditor — accounting and integrity", () => {
  it("BOTH payments of a conflict pair are accounted — no reconciled pay-ok swallows the conflict", () => {
    const report = run({
      students: [makeStudent({ id: "s-1" })],
      payments: [
        makePayment({ id: "pay-a", studentId: "s-1", amount: 50_000, collectedAt: "2026-09-10", receiptNumber: "REC-A" }),
        makePayment({ id: "pay-b", studentId: "s-1", amount: 50_000, collectedAt: "2026-09-13", receiptNumber: "REC-B" }),
        makePayment({ id: "pay-clean", studentId: "s-1", amount: 10_000, collectedAt: "2026-10-01", receiptNumber: "REC-CLEAN" }),
      ],
    });
    // The conflict pair carries its finding and is NEVER re-classified
    // as reconciled by the closing pass:
    expect(report.findings.some((f) => f.id === "reconciled:pay-ok:pay-a")).toBe(false);
    expect(report.findings.some((f) => f.id === "reconciled:pay-ok:pay-b")).toBe(false);
    // The unconflicting payment is never dragged into the pair's finding:
    const conflict = report.findings.find((f) => f.id.includes(":conflict:"));
    expect(conflict).toBeDefined();
    expect(conflict!.sourceRefs).not.toContain("payments:pay-clean");
  });

  it("the conflict pass is deterministic — identical inputs, identical conflict findings (input order aside)", () => {
    const params = {
      students: [makeStudent({ id: "s-1" })],
      payments: [
        makePayment({ id: "pay-a", studentId: "s-1", amount: 50_000, collectedAt: "2026-09-10", receiptNumber: "REC-A" }),
        makePayment({ id: "pay-b", studentId: "s-1", amount: 50_000, collectedAt: "2026-09-13", receiptNumber: "REC-B" }),
        makePayment({ id: "pay-c", studentId: null, amount: 30_000, collectedAt: "2026-09-15", receiptNumber: "REC-D" }),
        makePayment({ id: "pay-d", studentId: null, amount: 30_000, collectedAt: "2026-09-16", receiptNumber: "REC-E" }),
      ],
    };
    const r1 = run(params);
    const r2 = run({ ...params, payments: [...params.payments].reverse() });
    expect(conflictFindings(r2).map((f) => f.id)).toEqual(conflictFindings(r1).map((f) => f.id));
    expect(r2.counts).toEqual(r1.counts);
  });

  it("the READ-ONLY charter holds — no payment object is mutated by the audit", () => {
    const payments = [
      makePayment({ id: "pay-a", studentId: "s-1", amount: 50_000, collectedAt: "2026-09-10", receiptNumber: "REC-A" }),
      makePayment({ id: "pay-b", studentId: "s-1", amount: 50_000, collectedAt: "2026-09-13", receiptNumber: "REC-B" }),
    ].map((p) => JSON.parse(JSON.stringify(p)) as Payment);
    run({ students: [makeStudent({ id: "s-1" })], payments });
    expect(payments[0].status).toBe("paid");
    expect(payments[0].amount).toBe(50_000);
    expect(payments[1].amount).toBe(50_000);
  });
});
