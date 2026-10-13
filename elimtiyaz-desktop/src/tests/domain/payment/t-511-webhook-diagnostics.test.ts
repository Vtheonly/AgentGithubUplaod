/**
 * T-511 (AUDIT-506) — the Webhook & Ledger Traceability Diagnostics suite.
 *
 * Pins the issue-#30 mandate's 20 scenarios (the engine half; the UI wiring
 * half lives in src/tests/features/financials/t-511-webhook-diagnostics-ui.test.tsx):
 *
 *  1. A fully paid account where future-dated payment records cause the
 *     as-of balance to report false debt (Example A).
 *  2. A legitimately scheduled future payment is NOT treated as collected.
 *  3. A payment marked paid/collected with an impossible/suspicious future
 *     collection date.
 *  4. Ledger balance, payment totals, installment statuses, allocations —
 *     all agreeing (the reconciled shape).
 *  5. Ledger / payment / installment / account-summary values disagreeing,
 *     with the discrepancy calculated correctly.
 *  6. An imported annual quote that matches the price matrix.
 *  7. An imported quote with a very large delta silently absorbed by the
 *     final tranche (Example B).
 *  8. A legitimate documented negotiated price — NOT flagged as invalid.
 *  9. A ledger charge with no service/source record or price basis.
 * 10. A generic description without supporting evidence.
 * 11. Missing source data → UNVERIFIED, never "fraudulent".
 * 12. Webhook payload vs ledger entry mismatches (customer, amount, status).
 * 13. Duplicate webhook delivery + duplicate ledger-entry detection.
 * 14. Partial processing: missing ledger entries, orphan entries,
 *     inconsistent allocations.
 * 15. Incorrect identity/account mapping across merged accounts.
 * 16. Correctly traceable payments, charges, refunds, credits, adjustments.
 * 17. Currency precision, rounding, tranche-boundary cases.
 * 18. READ-ONLY guarantees: the audit mutates nothing.
 * 19. (UI file) frontend display of findings/evidence/severity/links.
 * 20. Large datasets: no silent omission due to row limits.
 */
import { describe, it, expect } from "vitest";
import {
  runWebhookDiagnostics,
  isGenericFinancialDescription,
  DEFAULT_WEBHOOK_DIAGNOSTICS_THRESHOLDS,
  type WebhookDiagnosticFinding,
  type WebhookDiagnosticsReport,
} from "../../../domain/calc/payment/webhook-diagnostics";
import { REAL_TUITION_BY_GRADE, realFiForGrade } from "../../../domain/calc/pricing/school-price-matrix";
import type {
  Installment,
  Payment,
  PaymentAllocation,
  DebtSummary,
} from "../../../domain/model/payment";
import type { LedgerEntry } from "../../../domain/model/ledger";
import type { Parent } from "../../../domain/model/parent";
import type { Student } from "../../../domain/model/student";

/* ============================================================ */
/*  Fixtures                                                     */
/* ============================================================ */

const NOW = Date.parse("2026-10-13T12:00:00.000Z");

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
    firstName: "Kid",
    lastName: "Probe",
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

function makeInstallment(overrides: Partial<Installment> = {}): Installment {
  return {
    id: overrides.id ?? "ins-1",
    parentId: overrides.parentId ?? "p-1",
    studentId: overrides.studentId ?? null,
    category: overrides.category ?? "tuition",
    label: overrides.label ?? "Tranche 1",
    amountDue: overrides.amountDue ?? 100_000,
    amountPaid: overrides.amountPaid ?? 0,
    amountPending: overrides.amountPending ?? 0,
    dueDate: overrides.dueDate ?? "2025-09-15",
    paidDate: overrides.paidDate ?? null,
    status: overrides.status ?? "pending",
    trancheNumber: overrides.trancheNumber,
    isCustomSchedule: overrides.isCustomSchedule,
    customScheduleNote: overrides.customScheduleNote,
  };
}

function makeLedgerEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: overrides.id ?? "led-1",
    tenantId: "t-1",
    accountId: overrides.accountId ?? "parent:p-1:category:tuition",
    parentId: overrides.parentId ?? "p-1",
    studentId: overrides.studentId ?? null,
    category: overrides.category ?? "tuition",
    amount: overrides.amount ?? 100_000,
    type: overrides.type ?? "charge",
    sourceType: overrides.sourceType ?? "installment",
    sourceId: overrides.sourceId ?? "ins-1",
    method: overrides.method ?? null,
    receiptNumber: overrides.receiptNumber ?? null,
    paymentStatus: overrides.paymentStatus ?? null,
    reversesId: overrides.reversesId ?? null,
    description: overrides.description ?? "Scolarité 2026-2027 — Tranche 1",
    actorId: "usr-1",
    actorName: "probe",
    at: overrides.at ?? "2025-09-01",
    metadata: overrides.metadata ?? {},
  };
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: overrides.id ?? "pay-1",
    tenantId: "t-1",
    receiptNumber: overrides.receiptNumber ?? "REC-2026-000001",
    parentId: overrides.parentId ?? "p-1",
    studentId: overrides.studentId ?? null,
    amount: overrides.amount ?? 50_000,
    method: overrides.method ?? "cash",
    status: overrides.status ?? "paid",
    category: overrides.category ?? "tuition",
    installmentId: overrides.installmentId ?? null,
    proofUrl: null,
    notes: null,
    collectedBy: "usr-1",
    collectedAt: overrides.collectedAt ?? "2026-09-01",
    createdAt: "2026-09-01",
    updatedAt: "2026-09-01",
  };
}

function makeAllocation(overrides: Partial<PaymentAllocation> = {}): PaymentAllocation {
  return {
    id: overrides.id ?? "alloc-1",
    paymentId: overrides.paymentId ?? "pay-1",
    chargeId: null,
    installmentId: overrides.installmentId ?? null,
    category: overrides.category ?? "tuition",
    allocatedAmount: overrides.allocatedAmount ?? 50_000,
    label: null,
    createdAt: "2026-09-01",
  };
}

function makeDebtSummary(overrides: Partial<DebtSummary> = {}): DebtSummary {
  return {
    parentId: overrides.parentId ?? "p-1",
    parentName: overrides.parentName ?? "Alice Probe",
    parentPhone: "0550000000",
    studentCount: 1,
    outstandingAmount: overrides.outstandingAmount ?? 0,
    daysOverdue: 0,
    bucket: "0_30",
  };
}

/** Run the audit with the fixed clock and no thresholds override. */
function run(params: Partial<Parameters<typeof runWebhookDiagnostics>[0]>): WebhookDiagnosticsReport {
  return runWebhookDiagnostics({
    payments: params.payments ?? [],
    installments: params.installments ?? [],
    ledgerEntries: params.ledgerEntries ?? [],
    allocations: params.allocations ?? [],
    debtSummaries: params.debtSummaries ?? [],
    parents: params.parents ?? [],
    students: params.students ?? [],
    now: NOW,
    thresholds: params.thresholds,
  });
}

/** Normalize fr-FR locale formatting (U+202F narrow nbsp / U+00A0) for contains-assertions. */
function norm(s: string | null): string {
  return (s ?? "").replace(/[\u202f\u00a0]/g, " ");
}

function findingsOf(
  report: WebhookDiagnosticsReport,
  category?: WebhookDiagnosticFinding["category"],
): WebhookDiagnosticFinding[] {
  return category ? report.findings.filter((f) => f.category === category) : [...report.findings];
}

function findingById(report: WebhookDiagnosticsReport, id: string): WebhookDiagnosticFinding {
  const f = report.findings.find((x) => x.id === id);
  expect(f, `finding ${id} must exist (ids: ${report.findings.map((x) => x.id).join(", ")})`).toBeDefined();
  return f!;
}

/* ============================================================ */
/*  Scenario 1 — Example A: false debt from future-dated payments */
/* ============================================================ */

describe("T-511 scenario 1 — fully paid account, future-dated payments → false as-of debt", () => {
  it("detects the date-semantic conflict and shows the exact arithmetic (635 000 / 438 000 shape, generalized)", () => {
    const parent = makeParent();
    // Charges: 3 tranches totalling 635 000 — all backed by installments.
    const installments = [
      makeInstallment({ id: "ins-1", amountDue: 315_000, amountPaid: 315_000, status: "paid", paidDate: "2026-09-10", trancheNumber: 1 }),
      makeInstallment({ id: "ins-2", amountDue: 160_000, amountPaid: 160_000, status: "paid", paidDate: "2026-09-10", trancheNumber: 2 }),
      makeInstallment({ id: "ins-3", amountDue: 160_000, amountPaid: 160_000, status: "paid", paidDate: "2026-09-10", trancheNumber: 3 }),
    ];
    const charges = installments.map((i, idx) =>
      makeLedgerEntry({ id: `led-c${idx + 1}`, amount: i.amountDue, sourceId: i.id, at: "2026-09-01" }),
    );
    // Payments: 197 000 collected in the past + 438 000 marked PAID but
    // dated months in the FUTURE (the imported tranche-date convention).
    const payments = [
      makePayment({ id: "pay-past", amount: 197_000, receiptNumber: "REC-1", collectedAt: "2026-09-10", installmentId: "ins-1" }),
      makePayment({ id: "pay-future", amount: 438_000, receiptNumber: "REC-2", collectedAt: "2027-03-15", installmentId: "ins-2" }),
    ];
    const ledgerPayments = [
      makeLedgerEntry({ id: "led-p1", type: "payment", sourceType: "payment", sourceId: "pay-past", amount: -197_000, receiptNumber: "REC-1", paymentStatus: "paid", at: "2026-09-10" }),
      makeLedgerEntry({ id: "led-p2", type: "payment", sourceType: "payment", sourceId: "pay-future", amount: -438_000, receiptNumber: "REC-2", paymentStatus: "paid", at: "2027-03-15" }),
    ];
    // The server's as-of-today balance: replay excluding future entries.
    const debt = makeDebtSummary({ outstandingAmount: 438_000 });

    const report = run({
      parents: [parent],
      installments,
      ledgerEntries: [...charges, ...ledgerPayments],
      payments,
      debtSummaries: [debt],
    });

    // (a) The Example-A reconciliation finding: the as-of replay excludes
    //     the future-dated collected payments — exactly the false debt.
    const recon = findingById(report, "date_semantic_conflict:recon-future:p-1");
    expect(recon.severity).toBe("critical");
    expect(recon.amount).toBe(438_000);
    expect(norm(recon.calculation)).toContain("438 000");
    expect(recon.explanation).toContain("futur");
    // The server carries the SAME apparent debt — the account looks like it
    // owes at fault while the imported statement says fully paid.
    expect(recon.explanation).toContain("à tort");
    expect(recon.suggestedSteps.some((s) => /import/i.test(s))).toBe(true);

    // (b) The per-payment date conflict for the future-dated payment.
    const perPay = findingById(report, "date_semantic_conflict:pay-future:pay-future");
    expect(perPay.severity).toBe("critical"); // cash
    expect(perPay.recordIds.payment).toBe("pay-future");

    // (c) The past payment is reconciled.
    expect(findingsOf(report).some((f) => f.id === "reconciled:pay-ok:pay-past")).toBe(true);
    expect(findingsOf(report).some((f) => f.id === "reconciled:pay-ok:pay-future")).toBe(false);

    // (d) NO false "unexplained gap" finding.
    expect(findingsOf(report).some((f) => f.id === "confirmed_mismatch:recon-gap:p-1")).toBe(false);
  });
});

/* ============================================================ */
/*  Scenario 2 — legitimate scheduled future payment              */
/* ============================================================ */

describe("T-511 scenario 2 — a legitimately scheduled future payment is NOT treated as collected", () => {
  it("an unpaid installment due in the future produces NO payment-side finding", () => {
    const parent = makeParent();
    const installments = [
      makeInstallment({ id: "ins-1", amountDue: 100_000, amountPaid: 100_000, status: "paid", paidDate: "2026-09-10", trancheNumber: 1 }),
      makeInstallment({ id: "ins-2", amountDue: 100_000, amountPaid: 0, status: "unpaid", dueDate: "2027-01-15", trancheNumber: 2 }),
    ];
    const charges = installments.map((i, idx) =>
      makeLedgerEntry({ id: `led-c${idx + 1}`, amount: i.amountDue, sourceId: i.id }),
    );
    const payments = [makePayment({ id: "pay-1", amount: 100_000, collectedAt: "2026-09-10", installmentId: "ins-1" })];
    const ledgerPayments = [
      makeLedgerEntry({ id: "led-p1", type: "payment", sourceType: "payment", sourceId: "pay-1", amount: -100_000, paymentStatus: "paid", at: "2026-09-10" }),
    ];

    const report = run({
      parents: [parent],
      installments,
      ledgerEntries: [...charges, ...ledgerPayments],
      payments,
      debtSummaries: [makeDebtSummary({ outstandingAmount: 100_000 })],
    });

    // The scheduled tranche is future-dated by DESIGN — no date conflict.
    const dateFindings = findingsOf(report, "date_semantic_conflict");
    expect(dateFindings).toHaveLength(0);
    // And the collected payment is fully reconciled.
    expect(findingsOf(report).some((f) => f.id === "reconciled:pay-ok:pay-1")).toBe(true);
  });

  it("an uncleared (pending) payment dated at a future clearance date is NOT a collected-payment conflict", () => {
    const parent = makeParent();
    const payments = [
      makePayment({ id: "pay-pend", amount: 80_000, method: "check", status: "pending", collectedAt: "2027-01-10" }),
    ];
    const ledgerPayments = [
      makeLedgerEntry({ id: "led-p1", type: "payment", sourceType: "payment", sourceId: "pay-pend", amount: -80_000, paymentStatus: "pending", at: "2027-01-10" }),
    ];
    const report = run({
      parents: [parent],
      payments,
      ledgerEntries: [
        makeLedgerEntry({ id: "led-c1", amount: 100_000, sourceId: "ins-1" }),
        ...ledgerPayments,
      ],
      installments: [makeInstallment({ id: "ins-1", amountDue: 100_000, amountPending: 80_000, status: "pending" })],
    });
    expect(findingsOf(report, "date_semantic_conflict")).toHaveLength(0);
  });
});

/* ============================================================ */
/*  Scenario 3 — paid with impossible/suspicious future date      */
/* ============================================================ */

describe("T-511 scenario 3 — a paid/collected payment with an impossible future collection date", () => {
  it("cash paid + future date → critical date-semantic conflict with the day arithmetic", () => {
    const report = run({
      parents: [makeParent()],
      payments: [makePayment({ id: "pay-x", amount: 60_000, method: "cash", status: "paid", collectedAt: "2026-12-01" })],
      ledgerEntries: [
        makeLedgerEntry({ id: "led-c1", amount: 60_000, sourceId: "ins-1" }),
        makeLedgerEntry({ id: "led-p1", type: "payment", sourceType: "payment", sourceId: "pay-x", amount: -60_000, paymentStatus: "paid", at: "2026-12-01" }),
      ],
      installments: [makeInstallment({ id: "ins-1", amountDue: 60_000, amountPaid: 60_000, status: "paid", paidDate: "2026-12-01" })],
    });
    const f = findingById(report, "date_semantic_conflict:pay-future:pay-x");
    expect(f.severity).toBe("critical");
    expect(f.explanation).toContain("espèces");
    expect(f.evidence.some((e) => e.value.includes("dans le futur") || /jour\(s\)/.test(e.value))).toBe(true);
  });

  it("a paid tranche whose paidDate is in the future is flagged", () => {
    const report = run({
      parents: [makeParent()],
      installments: [makeInstallment({ id: "ins-x", amountDue: 50_000, amountPaid: 50_000, status: "paid", paidDate: "2027-06-01" })],
      ledgerEntries: [makeLedgerEntry({ id: "led-c1", amount: 50_000, sourceId: "ins-x" })],
    });
    expect(findingsOf(report).some((f) => f.id === "date_semantic_conflict:inst-future:ins-x")).toBe(true);
  });
});

/* ============================================================ */
/*  Scenario 4 — everything agrees                                */
/* ============================================================ */

describe("T-511 scenario 4 — ledger, payments, installments and allocations all agree", () => {
  it("produces the reconciled shape: payment traced, charges backed, balance closing", () => {
    const parent = makeParent();
    const student = makeStudent({ id: "s-1", gradeLevel: "1ap" });
    const schedule = REAL_TUITION_BY_GRADE["1ap"];
    const installments = [
      makeInstallment({ id: "ins-1", amountDue: schedule.v2, amountPaid: schedule.v2, status: "paid", paidDate: "2026-09-20", trancheNumber: 1, studentId: "s-1" }),
      makeInstallment({ id: "ins-2", amountDue: schedule.tranche3, amountPaid: schedule.tranche3, status: "paid", paidDate: "2026-09-20", trancheNumber: 2, studentId: "s-1" }),
      makeInstallment({ id: "ins-3", amountDue: schedule.tranche4, amountPaid: 0, status: "unpaid", dueDate: "2027-03-15", trancheNumber: 3, studentId: "s-1" }),
    ];
    const charges = installments.map((i, idx) =>
      makeLedgerEntry({ id: `led-c${idx + 1}`, amount: i.amountDue, sourceId: i.id, studentId: "s-1" }),
    );
    const payment = makePayment({
      id: "pay-1", amount: schedule.v2 + schedule.tranche3, collectedAt: "2026-09-20", category: null,
    });
    const ledgerPayments = [
      makeLedgerEntry({ id: "led-p1", type: "payment", sourceType: "payment", sourceId: "pay-1", amount: -(schedule.v2 + schedule.tranche3), category: null, paymentStatus: "paid", at: "2026-09-20" }),
    ];
    const allocations = [
      makeAllocation({ id: "alloc-1", paymentId: "pay-1", installmentId: "ins-1", allocatedAmount: schedule.v2 }),
      makeAllocation({ id: "alloc-2", paymentId: "pay-1", installmentId: "ins-2", allocatedAmount: schedule.tranche3 }),
    ];
    const outstanding = schedule.tranche4;
    const report = run({
      parents: [parent],
      students: [student],
      installments,
      ledgerEntries: [...charges, ...ledgerPayments],
      payments: [payment],
      allocations,
      debtSummaries: [makeDebtSummary({ outstandingAmount: outstanding })],
    });

    // No actionable finding of any kind — T-529 amendment: the ONE honest
    // no-catalog coverage finding (unverified:price-noconfig:catalog) is the
    // designed degradation when no pricingConfig is supplied, not a defect;
    // every OTHER non-reconciled finding remains absent.
    const actionable = findingsOf(report).filter(
      (f) => f.category !== "reconciled" && f.id !== "unverified:price-noconfig:catalog",
    );
    expect(actionable).toEqual([]);
    expect(findingsOf(report).some((f) => f.id === "unverified:price-noconfig:catalog")).toBe(true);
    // The reconciled inventory: payment + price basis + family reconciliation.
    expect(findingsOf(report).some((f) => f.id === "reconciled:pay-ok:pay-1")).toBe(true);
    expect(findingsOf(report).some((f) => f.id === "reconciled:price-ok:s-1")).toBe(true);
    expect(findingsOf(report).some((f) => f.id === "reconciled:recon-ok:p-1")).toBe(true);
    expect(report.counts.reconciled).toBeGreaterThanOrEqual(3);
  });
});

/* ============================================================ */
/*  Scenario 5 — disagreeing values, discrepancy calculated       */
/* ============================================================ */

describe("T-511 scenario 5 — disagreeing ledger/payment/summary values with the discrepancy calculated", () => {
  it("an unexplained server-vs-replay gap is quantified exactly", () => {
    const parent = makeParent();
    // Charges 300 000, ledger payments −200 000 → replay outstanding 100 000.
    // The SERVER summary claims 60 000 — an unexplained 40 000 gap.
    const report = run({
      parents: [parent],
      installments: [makeInstallment({ id: "ins-1", amountDue: 300_000, amountPaid: 200_000, status: "partial" })],
      ledgerEntries: [
        makeLedgerEntry({ id: "led-c1", amount: 300_000, sourceId: "ins-1" }),
        makeLedgerEntry({ id: "led-p1", type: "payment", sourceType: "payment", sourceId: "pay-1", amount: -200_000, paymentStatus: "paid", at: "2026-09-10" }),
      ],
      payments: [makePayment({ id: "pay-1", amount: 200_000, collectedAt: "2026-09-10" })],
      debtSummaries: [makeDebtSummary({ outstandingAmount: 60_000 })],
    });
    const gap = findingById(report, "confirmed_mismatch:recon-gap:p-1");
    expect(gap.amount).toBe(40_000);
    expect(norm(gap.calculation)).toContain("40 000");
    expect(gap.evidence.map((e) => e.label)).toContain("Solde serveur");
    expect(gap.evidence.map((e) => e.label)).toContain("Replay « à ce jour »");
  });
});

/* ============================================================ */
/*  Scenario 6 — imported quote matches the price matrix          */
/* ============================================================ */

describe("T-511 scenario 6 — imported annual quote matching the price matrix", () => {
  it("the official 3-tranche schedule derives a reconciled price-basis finding", () => {
    const student = makeStudent({ id: "s-1", gradeLevel: "2ap" });
    const schedule = REAL_TUITION_BY_GRADE["2ap"];
    const installments = [
      makeInstallment({ id: "ins-1", amountDue: schedule.v2, trancheNumber: 1, studentId: "s-1" }),
      makeInstallment({ id: "ins-2", amountDue: schedule.tranche3, trancheNumber: 2, studentId: "s-1" }),
      makeInstallment({ id: "ins-3", amountDue: schedule.tranche4, trancheNumber: 3, studentId: "s-1" }),
    ];
    const report = run({
      parents: [makeParent()],
      students: [student],
      installments,
      ledgerEntries: installments.map((i, idx) => makeLedgerEntry({ id: `led-c${idx}`, amount: i.amountDue, sourceId: i.id, studentId: "s-1" })),
    });
    const ok = findingById(report, "reconciled:price-ok:s-1");
    expect(ok.amount).toBe(schedule.scolarite);
    expect(findingsOf(report, "outlier_review")).toHaveLength(0);
  });
});

/* ============================================================ */
/*  Scenario 7 — Example B: large delta absorbed by final tranche */
/* ============================================================ */

describe("T-511 scenario 7 — imported quote with a very large delta silently absorbed by the final tranche", () => {
  it("flags the outlier, the delta, and the concentration — without auto-correcting", () => {
    const student = makeStudent({ id: "s-1", gradeLevel: "4ap" });
    const schedule = REAL_TUITION_BY_GRADE["4ap"]; // scolarite 265 000
    const absorbed = 2_385_000; // the silent delta
    const installments = [
      makeInstallment({ id: "ins-1", amountDue: schedule.v2, trancheNumber: 1, studentId: "s-1" }),
      makeInstallment({ id: "ins-2", amountDue: schedule.tranche3, trancheNumber: 2, studentId: "s-1" }),
      makeInstallment({ id: "ins-3", amountDue: schedule.tranche4 + absorbed, trancheNumber: 3, studentId: "s-1", label: "Tranche 3" }),
    ];
    const imported = schedule.scolarite + absorbed;
    const report = run({
      parents: [makeParent()],
      students: [student],
      installments,
      ledgerEntries: installments.map((i, idx) => makeLedgerEntry({ id: `led-c${idx}`, amount: i.amountDue, sourceId: i.id, studentId: "s-1" })),
    });

    const outlier = findingById(report, "outlier_review:price-outlier:s-1");
    expect(outlier.severity).toBe("warning");
    expect(outlier.amount).toBe(absorbed);
    // The concentration is surfaced explicitly.
    expect(outlier.explanation).toContain("absorbé par la dernière tranche");
    expect(outlier.explanation).toContain("Tranche 3");
    // The evidence inventory carries expected / imported / delta / tranche.
    const labels = outlier.evidence.map((e) => e.label);
    expect(labels).toContain("Total importé (tranches 1-3)");
    expect(labels).toContain("Total attendu (matrice officielle)");
    expect(labels).toContain("Écart (delta)");
    // Never claims fraud; recommends the import-source review.
    expect(outlier.explanation).not.toContain("fraud");
    expect(outlier.suggestedSteps.some((s) => /classeur|import/i.test(s))).toBe(true);
    expect(imported).toBe(2_650_000);
  });

  it("respects the configurable multiplier (a 1.5× deviation is NOT flagged at the default 2×)", () => {
    const student = makeStudent({ id: "s-1", gradeLevel: "4ap" });
    const schedule = REAL_TUITION_BY_GRADE["4ap"];
    const installments = [
      makeInstallment({ id: "ins-1", amountDue: Math.round(schedule.v2 * 1.5), trancheNumber: 1, studentId: "s-1" }),
      makeInstallment({ id: "ins-2", amountDue: schedule.tranche3, trancheNumber: 2, studentId: "s-1" }),
      makeInstallment({ id: "ins-3", amountDue: schedule.tranche4, trancheNumber: 3, studentId: "s-1" }),
    ];
    const report = run({
      parents: [makeParent()],
      students: [student],
      installments,
      ledgerEntries: installments.map((i, idx) => makeLedgerEntry({ id: `led-c${idx}`, amount: i.amountDue, sourceId: i.id, studentId: "s-1" })),
      thresholds: { quoteOutlierMultiplier: 2 },
    });
    expect(findingsOf(report, "outlier_review")).toHaveLength(0);
  });
});

/* ============================================================ */
/*  Scenario 8 — documented negotiated price is a valid exception */
/* ============================================================ */

describe("T-511 scenario 8 — a legitimate documented negotiated price is NOT classified as invalid", () => {
  it("a custom-schedule note turns the outlier shape into a documented reconciled exception", () => {
    const student = makeStudent({ id: "s-1", gradeLevel: "4ap" });
    const schedule = REAL_TUITION_BY_GRADE["4ap"];
    const negotiated = 800_000; // > 2× the matrix total, but DOCUMENTED
    const installments = [
      makeInstallment({ id: "ins-1", amountDue: 300_000, trancheNumber: 1, studentId: "s-1", isCustomSchedule: true, customScheduleNote: "Prix négocié avec la direction — convention 2026" }),
      makeInstallment({ id: "ins-2", amountDue: 250_000, trancheNumber: 2, studentId: "s-1" }),
      makeInstallment({ id: "ins-3", amountDue: negotiated - 550_000, trancheNumber: 3, studentId: "s-1" }),
    ];
    const report = run({
      parents: [makeParent()],
      students: [student],
      installments,
      ledgerEntries: installments.map((i, idx) => makeLedgerEntry({ id: `led-c${idx}`, amount: i.amountDue, sourceId: i.id, studentId: "s-1" })),
    });
    expect(findingsOf(report, "outlier_review")).toHaveLength(0);
    const doc = findingById(report, "reconciled:price-documented:s-1");
    expect(doc.explanation).toContain("Prix négocié avec la direction");
    expect(schedule.scolarite).toBe(265_000);
  });
});

/* ============================================================ */
/*  Scenario 9 — unjustified amount (no service/source/price)     */
/* ============================================================ */

describe("T-511 scenario 9 — a ledger charge with no service/source record or price basis", () => {
  it("a manual charge with an empty description and no metadata is unjustified", () => {
    const report = run({
      parents: [makeParent()],
      ledgerEntries: [
        makeLedgerEntry({ id: "led-x", type: "charge", sourceType: "manual_entry", sourceId: "manual-42", description: "", amount: 75_000, metadata: {} }),
      ],
    });
    const f = findingById(report, "unjustified_amount:charge-unjustified:led-x");
    expect(f.severity).toBe("warning");
    expect(f.title).toContain("sans service ni base de prix");
    // Never labelled fraudulent — the explicit negation is part of the text.
    expect(f.explanation).toContain("SANS être qualifié de frauduleux");
    const labels = f.evidence.map((e) => e.label);
    expect(labels).toContain("Échéance liée");
    expect(labels).toContain("Métadonnées de traçabilité");
  });

  it("a charge whose installment source is gone (data loaded) is a confirmed dangling reference", () => {
    const report = run({
      parents: [makeParent()],
      installments: [makeInstallment({ id: "ins-other" })],
      ledgerEntries: [
        makeLedgerEntry({ id: "led-y", type: "charge", sourceType: "installment", sourceId: "ins-gone", amount: 40_000 }),
      ],
    });
    expect(findingsOf(report).some((f) => f.id === "confirmed_mismatch:charge-dangling:led-y")).toBe(true);
  });
});

/* ============================================================ */
/*  Scenario 10 — generic description without evidence           */
/* ============================================================ */

describe("T-511 scenario 10 — a generic description alone is not evidence", () => {
  it("the generic-description heuristic classifies the vague vocabulary", () => {
    expect(isGenericFinancialDescription("Divers")).toBe(true);
    expect(isGenericFinancialDescription("Ajustement")).toBe(true);
    expect(isGenericFinancialDescription("Solde")).toBe(true);
    expect(isGenericFinancialDescription("Régularisation")).toBe(true);
    expect(isGenericFinancialDescription("")).toBe(true);
    expect(isGenericFinancialDescription(null)).toBe(true);
    expect(isGenericFinancialDescription("Scolarité 2026-2027 — Tranche 2")).toBe(false);
    expect(isGenericFinancialDescription("Transport Bourdjen — 3 tranches")).toBe(false);
    expect(isGenericFinancialDescription("Remise fratrie (2ème enfant)")).toBe(false);
  });

  it("a bulk_import charge labelled « Divers » with no trace metadata is unjustified", () => {
    const report = run({
      parents: [makeParent()],
      ledgerEntries: [
        makeLedgerEntry({ id: "led-g", type: "charge", sourceType: "bulk_import", sourceId: "s-1:divers", description: "Divers", amount: 25_000, metadata: {} }),
      ],
    });
    expect(findingsOf(report).some((f) => f.id === "unjustified_amount:charge-unjustified:led-g")).toBe(true);
  });

  it("the SAME bulk_import charge WITH trace metadata (student + field) is traced", () => {
    const report = run({
      parents: [makeParent()],
      ledgerEntries: [
        makeLedgerEntry({
          id: "led-t", type: "charge", sourceType: "bulk_import", sourceId: "s-1:tranche_2",
          description: "Divers", amount: 25_000,
          metadata: { studentId: "s-1", importField: "tranche_2" },
        }),
      ],
    });
    expect(findingsOf(report).some((f) => f.id === "reconciled:charge-justified:led-t")).toBe(true);
    expect(findingsOf(report, "unjustified_amount")).toHaveLength(0);
  });
});

/* ============================================================ */
/*  Scenario 11 — missing source data → UNVERIFIED               */
/* ============================================================ */

describe("T-511 scenario 11 — missing source data yields unverified, never fraudulent", () => {
  it("an installment-backed charge with NO installment data loaded is unverified (not mismatch)", () => {
    const report = run({
      parents: [makeParent()],
      installments: [], // the stream is empty — evidence unavailable
      ledgerEntries: [
        makeLedgerEntry({ id: "led-u", type: "charge", sourceType: "installment", sourceId: "ins-9", amount: 90_000 }),
      ],
    });
    expect(findingsOf(report).some((f) => f.id === "unverified:charge-nosrc:led-u")).toBe(true);
    expect(findingsOf(report, "confirmed_mismatch")).toHaveLength(0);
    expect(findingsOf(report, "unjustified_amount")).toHaveLength(0);
  });

  it("a tuition schedule whose student is unknown is unverified on price basis", () => {
    const report = run({
      parents: [makeParent()],
      students: [],
      installments: [
        makeInstallment({ id: "ins-1", amountDue: 100_000, trancheNumber: 1, studentId: "s-ghost" }),
      ],
      ledgerEntries: [makeLedgerEntry({ id: "led-c1", amount: 100_000, sourceId: "ins-1", studentId: "s-ghost" })],
    });
    expect(findingsOf(report).some((f) => f.id === "unverified:price-nostudent:s-ghost")).toBe(true);
  });

  it("a family with ledger entries but NO server summary is reconciliation-unverified", () => {
    const report = run({
      parents: [makeParent()],
      debtSummaries: [],
      ledgerEntries: [makeLedgerEntry({ id: "led-c1", amount: 50_000, sourceId: "ins-1" })],
      installments: [makeInstallment({ id: "ins-1", amountDue: 50_000 })],
    });
    expect(findingsOf(report).some((f) => f.id === "unverified:recon-nosrv:p-1")).toBe(true);
  });
});

/* ============================================================ */
/*  Scenario 12 — webhook payload vs ledger mismatches           */
/* ============================================================ */

describe("T-511 scenario 12 — webhook (payment record) and ledger entry disagreeing", () => {
  const baseLedger = [
    makeLedgerEntry({ id: "led-c1", amount: 200_000, sourceId: "ins-1" }),
  ];
  const baseInstallments = [makeInstallment({ id: "ins-1", amountDue: 200_000 })];

  it("amount mismatch: payment 200 000 vs ledger 150 000", () => {
    const report = run({
      parents: [makeParent()],
      installments: baseInstallments,
      ledgerEntries: [
        ...baseLedger,
        makeLedgerEntry({ id: "led-p1", type: "payment", sourceType: "payment", sourceId: "pay-1", amount: -150_000, paymentStatus: "paid", at: "2026-09-10" }),
      ],
      payments: [makePayment({ id: "pay-1", amount: 200_000, collectedAt: "2026-09-10" })],
    });
    const f = findingById(report, "confirmed_mismatch:pay-amt:pay-1");
    expect(f.severity).toBe("critical");
    expect(f.amount).toBe(50_000);
    expect(norm(f.calculation)).toContain("50 000");
  });

  it("status mismatch: payment paid vs ledger pending", () => {
    const report = run({
      parents: [makeParent()],
      installments: baseInstallments,
      ledgerEntries: [
        ...baseLedger,
        makeLedgerEntry({ id: "led-p1", type: "payment", sourceType: "payment", sourceId: "pay-1", amount: -200_000, paymentStatus: "pending", at: "2026-09-10" }),
      ],
      payments: [makePayment({ id: "pay-1", amount: 200_000, status: "paid", collectedAt: "2026-09-10" })],
    });
    expect(findingsOf(report).some((f) => f.id === "confirmed_mismatch:pay-status:pay-1")).toBe(true);
  });

  it("customer mismatch: the ledger entry books ANOTHER parent's account", () => {
    const report = run({
      parents: [makeParent({ id: "p-1" }), makeParent({ id: "p-2" })],
      installments: baseInstallments,
      ledgerEntries: [
        ...baseLedger,
        makeLedgerEntry({ id: "led-p1", type: "payment", sourceType: "payment", sourceId: "pay-1", amount: -200_000, parentId: "p-2", accountId: "parent:p-2:category:tuition", paymentStatus: "paid", at: "2026-09-10" }),
      ],
      payments: [makePayment({ id: "pay-1", parentId: "p-1", amount: 200_000, collectedAt: "2026-09-10" })],
    });
    const f = findingById(report, "confirmed_mismatch:pay-parent:pay-1");
    expect(f.severity).toBe("critical");
    expect(f.explanation).toContain("mauvais compte");
  });

  it("direction (sign) mismatch: a payment entry booked as a POSITIVE amount", () => {
    const report = run({
      parents: [makeParent()],
      installments: baseInstallments,
      ledgerEntries: [
        ...baseLedger,
        makeLedgerEntry({ id: "led-p1", type: "payment", sourceType: "payment", sourceId: "pay-1", amount: 200_000, paymentStatus: "paid", at: "2026-09-10" }),
      ],
      payments: [makePayment({ id: "pay-1", amount: 200_000, collectedAt: "2026-09-10" })],
    });
    expect(findingsOf(report).some((f) => f.id === "confirmed_mismatch:pay-sign:pay-1")).toBe(true);
  });
});

/* ============================================================ */
/*  Scenario 13 — duplicate deliveries & duplicate entries        */
/* ============================================================ */

describe("T-511 scenario 13 — duplicate webhook delivery and duplicate ledger-entry detection", () => {
  it("two payments sharing one receipt number are a critical duplicate event", () => {
    const report = run({
      parents: [makeParent()],
      ledgerEntries: [
        makeLedgerEntry({ id: "led-p1", type: "payment", sourceType: "payment", sourceId: "pay-1", amount: -50_000, receiptNumber: "REC-DUP", paymentStatus: "paid", at: "2026-09-10" }),
        makeLedgerEntry({ id: "led-p2", type: "payment", sourceType: "payment", sourceId: "pay-2", amount: -50_000, receiptNumber: "REC-DUP", paymentStatus: "paid", at: "2026-09-10" }),
      ],
      payments: [
        makePayment({ id: "pay-1", amount: 50_000, receiptNumber: "REC-DUP", collectedAt: "2026-09-10" }),
        makePayment({ id: "pay-2", amount: 50_000, receiptNumber: "REC-DUP", collectedAt: "2026-09-10" }),
      ],
    });
    const f = findingById(report, "duplicate_event:dup-receipt:REC-DUP");
    expect(f.severity).toBe("critical");
    expect(f.explanation).toContain("plus d'une fois");
  });

  it("one payment source producing TWO ledger entries is a critical duplicate", () => {
    const report = run({
      parents: [makeParent()],
      ledgerEntries: [
        makeLedgerEntry({ id: "led-p1", type: "payment", sourceType: "payment", sourceId: "pay-1", amount: -50_000, paymentStatus: "paid", at: "2026-09-10" }),
        makeLedgerEntry({ id: "led-p1b", type: "payment", sourceType: "payment", sourceId: "pay-1", amount: -50_000, paymentStatus: "paid", at: "2026-09-10" }),
      ],
      payments: [makePayment({ id: "pay-1", amount: 50_000, collectedAt: "2026-09-10" })],
    });
    expect(findingsOf(report).some((f) => f.id === "duplicate_event:pay-multi-ledger:pay-1")).toBe(true);
  });

  it("an exact business-tuple replay with DIFFERENT receipts is a warning duplicate", () => {
    const report = run({
      parents: [makeParent()],
      ledgerEntries: [
        makeLedgerEntry({ id: "led-p1", type: "payment", sourceType: "payment", sourceId: "pay-1", amount: -50_000, paymentStatus: "paid", at: "2026-09-10" }),
        makeLedgerEntry({ id: "led-p2", type: "payment", sourceType: "payment", sourceId: "pay-2", amount: -50_000, paymentStatus: "paid", at: "2026-09-10" }),
      ],
      payments: [
        makePayment({ id: "pay-1", amount: 50_000, receiptNumber: "REC-A", collectedAt: "2026-09-10" }),
        makePayment({ id: "pay-2", amount: 50_000, receiptNumber: "REC-B", collectedAt: "2026-09-10" }),
      ],
    });
    expect(findingsOf(report).some((f) => f.id === "duplicate_event:dup-tuple:pay-1")).toBe(true);
  });
});

/* ============================================================ */
/*  Scenario 14 — partial processing                             */
/* ============================================================ */

describe("T-511 scenario 14 — partial processing, missing ledger entries, inconsistent allocations", () => {
  it("a payment with NO ledger entry is a partial-processing mismatch", () => {
    const report = run({
      parents: [makeParent()],
      payments: [makePayment({ id: "pay-solo", amount: 30_000, collectedAt: "2026-09-10" })],
      ledgerEntries: [makeLedgerEntry({ id: "led-c1", amount: 30_000, sourceId: "ins-1" })],
      installments: [makeInstallment({ id: "ins-1", amountDue: 30_000, amountPaid: 30_000, status: "paid" })],
    });
    expect(findingsOf(report).some((f) => f.id === "confirmed_mismatch:pay-no-ledger:pay-solo")).toBe(true);
  });

  it("a ledger payment entry whose payment row is gone is an orphan mismatch", () => {
    const report = run({
      parents: [makeParent()],
      ledgerEntries: [
        makeLedgerEntry({ id: "led-orphan", type: "payment", sourceType: "payment", sourceId: "pay-gone", amount: -30_000, paymentStatus: "paid", at: "2026-09-10" }),
      ],
    });
    expect(findingsOf(report).some((f) => f.id === "confirmed_mismatch:orphan-ledger:led-orphan")).toBe(true);
  });

  it("allocations totalling less than the payment amount are inconsistent", () => {
    const report = run({
      parents: [makeParent()],
      payments: [makePayment({ id: "pay-alloc", amount: 100_000, collectedAt: "2026-09-10" })],
      ledgerEntries: [
        makeLedgerEntry({ id: "led-c1", amount: 150_000, sourceId: "ins-1" }),
        makeLedgerEntry({ id: "led-p1", type: "payment", sourceType: "payment", sourceId: "pay-alloc", amount: -100_000, paymentStatus: "paid", at: "2026-09-10" }),
      ],
      installments: [makeInstallment({ id: "ins-1", amountDue: 150_000, amountPaid: 60_000, status: "partial" })],
      allocations: [
        makeAllocation({ id: "alloc-1", paymentId: "pay-alloc", installmentId: "ins-1", allocatedAmount: 60_000 }),
      ],
    });
    const f = findingById(report, "confirmed_mismatch:alloc-sum:pay-alloc");
    expect(f.amount).toBe(40_000);
    expect(f.explanation).toContain("ne couvre pas");
  });

  it("an allocation targeting a missing installment and one without a payment are both flagged", () => {
    const report = run({
      parents: [makeParent()],
      payments: [makePayment({ id: "pay-1", amount: 50_000, collectedAt: "2026-09-10" })],
      ledgerEntries: [
        makeLedgerEntry({ id: "led-p1", type: "payment", sourceType: "payment", sourceId: "pay-1", amount: -50_000, paymentStatus: "paid", at: "2026-09-10" }),
      ],
      installments: [makeInstallment({ id: "ins-1", amountDue: 50_000, amountPaid: 50_000, status: "paid" })],
      allocations: [
        makeAllocation({ id: "alloc-bad", paymentId: "pay-1", installmentId: "ins-gone", allocatedAmount: 50_000 }),
        makeAllocation({ id: "alloc-nopay", paymentId: "pay-ghost", installmentId: "ins-1", allocatedAmount: 10_000 }),
      ],
    });
    expect(findingsOf(report).some((f) => f.id === "confirmed_mismatch:alloc-noinst:alloc-bad")).toBe(true);
    expect(findingsOf(report).some((f) => f.id === "confirmed_mismatch:alloc-nopay:alloc-nopay")).toBe(true);
  });
});

/* ============================================================ */
/*  Scenario 15 — identity mapping across merged accounts         */
/* ============================================================ */

describe("T-511 scenario 15 — incorrect identity/account mapping across merged or linked accounts", () => {
  it("a payment of family A settling family B's tranche is a critical cross-account allocation", () => {
    const report = run({
      parents: [makeParent({ id: "p-a" }), makeParent({ id: "p-b" })],
      payments: [makePayment({ id: "pay-1", parentId: "p-a", amount: 50_000, collectedAt: "2026-09-10" })],
      ledgerEntries: [
        makeLedgerEntry({ id: "led-p1", type: "payment", sourceType: "payment", sourceId: "pay-1", parentId: "p-a", amount: -50_000, paymentStatus: "paid", at: "2026-09-10" }),
      ],
      installments: [makeInstallment({ id: "ins-b", parentId: "p-b", amountDue: 50_000, amountPaid: 50_000, status: "paid" })],
      allocations: [makeAllocation({ id: "alloc-x", paymentId: "pay-1", installmentId: "ins-b", allocatedAmount: 50_000 })],
    });
    const f = findingById(report, "confirmed_mismatch:alloc-xparent:alloc-x");
    expect(f.severity).toBe("critical");
    expect(f.explanation).toContain("une autre");
  });
});

/* ============================================================ */
/*  Scenario 16 — correctly traceable movements                   */
/* ============================================================ */

describe("T-511 scenario 16 — correctly traceable payments, charges, refunds, credits, adjustments", () => {
  it("each traceable movement class yields a reconciled finding with its evidence", () => {
    const report = run({
      parents: [makeParent()],
      payments: [makePayment({ id: "pay-ok", amount: 40_000, collectedAt: "2026-09-10", method: "check" })],
      ledgerEntries: [
        // backed charge
        makeLedgerEntry({ id: "led-c1", amount: 100_000, sourceId: "ins-1" }),
        // traceable payment twin
        makeLedgerEntry({ id: "led-p1", type: "payment", sourceType: "payment", sourceId: "pay-ok", amount: -40_000, paymentStatus: "paid", at: "2026-09-10" }),
        // documented refund
        makeLedgerEntry({ id: "led-r1", type: "refund", sourceType: "refund", sourceId: "ref-1", amount: -5_000, description: "Remboursement trop-perçu chèque n°123", at: "2026-09-12" }),
        // documented adjustment (remise)
        makeLedgerEntry({ id: "led-a1", type: "adjustment", sourceType: "adjustment", sourceId: "adj-1", amount: -10_000, description: "Remise fratrie (2ème enfant)", at: "2026-09-12" }),
        // canonical parent credit
        makeLedgerEntry({ id: "led-a2", type: "adjustment", sourceType: "adjustment", sourceId: "adj-2", amount: -3_000, category: "parent_credit", accountId: "parent:p-1:category:parent_credit", description: "Crédit parent", at: "2026-09-12" }),
      ],
      installments: [makeInstallment({ id: "ins-1", amountDue: 100_000, amountPaid: 40_000, status: "partial" })],
    });

    expect(findingsOf(report).some((f) => f.id === "reconciled:pay-ok:pay-ok")).toBe(true);
    expect(findingsOf(report).some((f) => f.id === "reconciled:adj-justified:led-r1")).toBe(true);
    expect(findingsOf(report).some((f) => f.id === "reconciled:adj-justified:led-a1")).toBe(true);
    expect(findingsOf(report).some((f) => f.id === "reconciled:adj-justified:led-a2")).toBe(true);
    // The documented movements carry their motive as evidence.
    const refund = findingById(report, "reconciled:adj-justified:led-r1");
    expect(refund.evidence.some((e) => e.value.includes("trop-perçu"))).toBe(true);
  });

  it("an adjustment with a GENERIC motive is unjustified (the trap the taxonomy separates)", () => {
    const report = run({
      parents: [makeParent()],
      ledgerEntries: [
        makeLedgerEntry({ id: "led-a3", type: "adjustment", sourceType: "adjustment", sourceId: "adj-3", amount: -15_000, description: "Ajustement", at: "2026-09-12" }),
      ],
    });
    expect(findingsOf(report).some((f) => f.id === "unjustified_amount:adj-unjustified:led-a3")).toBe(true);
  });
});

/* ============================================================ */
/*  Scenario 17 — currency precision, rounding, tranche borders  */
/* ============================================================ */

describe("T-511 scenario 17 — currency precision, rounding, discounts, tranche-boundary cases", () => {
  it("a sub-tolerance amount difference (0.5 DZD) is NOT a mismatch", () => {
    const report = run({
      parents: [makeParent()],
      payments: [makePayment({ id: "pay-1", amount: 100_000, collectedAt: "2026-09-10" })],
      ledgerEntries: [
        makeLedgerEntry({ id: "led-c1", amount: 100_000, sourceId: "ins-1" }),
        makeLedgerEntry({ id: "led-p1", type: "payment", sourceType: "payment", sourceId: "pay-1", amount: -100_000.5, paymentStatus: "paid", at: "2026-09-10" }),
      ],
      installments: [makeInstallment({ id: "ins-1", amountDue: 100_000, amountPaid: 100_000, status: "paid" })],
    });
    expect(findingsOf(report, "confirmed_mismatch")).toHaveLength(0);
    expect(findingsOf(report).some((f) => f.id === "reconciled:pay-ok:pay-1")).toBe(true);
  });

  it("the FI (tranche 0) row matches the matrix FI — no outlier; a non-wave row never breaks the price check", () => {
    const student = makeStudent({ id: "s-1", gradeLevel: "1ap" });
    const schedule = REAL_TUITION_BY_GRADE["1ap"];
    const fi = realFiForGrade("1ap", false);
    const installments = [
      makeInstallment({ id: "ins-fi", label: "Frais d'inscription (FI)", trancheNumber: 0, amountDue: fi, studentId: "s-1" }),
      makeInstallment({ id: "ins-1", amountDue: schedule.v2, trancheNumber: 1, studentId: "s-1" }),
      makeInstallment({ id: "ins-2", amountDue: schedule.tranche3, trancheNumber: 2, studentId: "s-1" }),
      makeInstallment({ id: "ins-3", amountDue: schedule.tranche4, trancheNumber: 3, studentId: "s-1" }),
      // A NON-WAVE custom line (no trancheNumber) — excluded from the
      // schedule math by design (T-424 DATA-042), must not corrupt totals.
      makeInstallment({ id: "ins-cx", label: "Année complète — ligne personnalisée", amountDue: 0, studentId: "s-1", category: "other" }),
    ];
    const report = run({
      parents: [makeParent()],
      students: [student],
      installments,
      ledgerEntries: installments
        .filter((i) => i.amountDue > 0)
        .map((i, idx) => makeLedgerEntry({ id: `led-c${idx}`, amount: i.amountDue, sourceId: i.id, studentId: "s-1", category: i.category })),
    });
    expect(findingsOf(report, "outlier_review")).toHaveLength(0);
    expect(findingsOf(report).some((f) => f.id === "reconciled:price-ok:s-1")).toBe(true);
  });

  it("a discounted schedule (imported BELOW the matrix via documented remises) is not an outlier", () => {
    const student = makeStudent({ id: "s-1", gradeLevel: "1ap" });
    const schedule = REAL_TUITION_BY_GRADE["1ap"];
    const remise = 5_000;
    const installments = [
      makeInstallment({ id: "ins-1", amountDue: schedule.v2 - remise, trancheNumber: 1, studentId: "s-1" }),
      makeInstallment({ id: "ins-2", amountDue: schedule.tranche3, trancheNumber: 2, studentId: "s-1" }),
      makeInstallment({ id: "ins-3", amountDue: schedule.tranche4, trancheNumber: 3, studentId: "s-1" }),
    ];
    const report = run({
      parents: [makeParent()],
      students: [student],
      installments,
      ledgerEntries: [
        ...installments.map((i, idx) => makeLedgerEntry({ id: `led-c${idx}`, amount: i.amountDue, sourceId: i.id, studentId: "s-1" })),
        // the documented remise adjustment backing the delta
        makeLedgerEntry({ id: "led-rem", type: "adjustment", amount: -remise, description: "Remise fratrie (2ème enfant)", at: "2026-09-05" }),
      ],
    });
    expect(findingsOf(report, "outlier_review")).toHaveLength(0);
    expect(findingsOf(report).some((f) => f.id === "reconciled:price-ok:s-1")).toBe(true);
  });
});

/* ============================================================ */
/*  Scenario 18 — READ-ONLY guarantees                           */
/* ============================================================ */

describe("T-511 scenario 18 — read-only guarantee: running the audit mutates NOTHING", () => {
  it("every input array and record is byte-identical after a full audit run", () => {
    const inputs = {
      payments: [
        makePayment({ id: "pay-1", amount: 50_000, collectedAt: "2027-01-01" }), // future-dated
        makePayment({ id: "pay-2", amount: 30_000, collectedAt: "2026-09-10", receiptNumber: "REC-2" }),
        makePayment({ id: "pay-2b", amount: 30_000, collectedAt: "2026-09-10", receiptNumber: "REC-2" }), // duplicate
      ],
      installments: [
        makeInstallment({ id: "ins-1", amountDue: 120_000, amountPaid: 80_000, status: "partial" }),
        makeInstallment({ id: "ins-2", amountDue: 60_000, amountPaid: 0, status: "unpaid", dueDate: "2027-03-15", trancheNumber: 3 }),
      ],
      ledgerEntries: [
        makeLedgerEntry({ id: "led-c1", amount: 120_000, sourceId: "ins-1" }),
        makeLedgerEntry({ id: "led-c2", amount: 60_000, sourceId: "ins-2" }),
        makeLedgerEntry({ id: "led-p1", type: "payment", sourceType: "payment", sourceId: "pay-1", amount: -50_000, paymentStatus: "paid", at: "2027-01-01" }),
        makeLedgerEntry({ id: "led-p2", type: "payment", sourceType: "payment", sourceId: "pay-2", amount: -30_000, paymentStatus: "paid", at: "2026-09-10" }),
        makeLedgerEntry({ id: "led-x", type: "charge", sourceType: "manual_entry", sourceId: "m-1", amount: 15_000, description: "" }),
      ],
      allocations: [makeAllocation({ id: "alloc-1", paymentId: "pay-1", installmentId: "ins-1", allocatedAmount: 50_000 })],
      debtSummaries: [makeDebtSummary({ outstandingAmount: 70_000 })],
      parents: [makeParent()],
      students: [makeStudent({ id: "s-1" })],
    };
    const snapshot = JSON.stringify(inputs);
    const report = run(inputs);
    // The audit found actionable findings (it really ran)...
    expect(report.findings.length).toBeGreaterThan(3);
    expect(report.counts.date_semantic_conflict).toBeGreaterThan(0);
    expect(report.counts.duplicate_event).toBeGreaterThan(0);
    expect(report.counts.unjustified_amount).toBeGreaterThan(0);
    // ...and NOTHING changed in the inputs.
    expect(JSON.stringify(inputs)).toBe(snapshot);
  });
});

/* ============================================================ */
/*  Scenario 20 — large datasets, no silent omission              */
/* ============================================================ */

describe("T-511 scenario 20 — large datasets: the audit never silently omits records", () => {
  it("1 200 payments + twins: full coverage, seeded anomalies at the tail are found", () => {
    const N = 1_200;
    const payments: Payment[] = [];
    const ledgerEntries: LedgerEntry[] = [];
    for (let i = 0; i < N; i++) {
      const id = `pay-bulk-${i}`;
      payments.push(
        makePayment({
          id,
          amount: 10_000 + i, // unique per payment — no tuple-duplicate signature
          receiptNumber: `REC-BULK-${i}`,
          collectedAt: "2026-09-10",
        }),
      );
      if (i !== N - 1) {
        // The LAST payment deliberately has NO ledger twin (a seeded
        // partial-processing anomaly at the dataset's tail).
        ledgerEntries.push(
          makeLedgerEntry({
            id: `led-bulk-${i}`,
            type: "payment",
            sourceType: "payment",
            sourceId: id,
            amount: -(10_000 + i),
            receiptNumber: `REC-BULK-${i}`,
            paymentStatus: "paid",
            at: "2026-09-10",
          }),
        );
      }
    }
    const report = run({
      parents: [makeParent()],
      payments,
      ledgerEntries,
    });

    expect(report.coverage.payments).toBe(N);
    // Every consistent payment produced its reconciled finding — no row
    // limit ever dropped records.
    expect(report.counts.reconciled).toBe(N - 1);
    // The tail anomaly is found (the omission trap).
    expect(findingsOf(report).some((f) => f.id === "confirmed_mismatch:pay-no-ledger:pay-bulk-" + (N - 1))).toBe(true);
    expect(report.counts.confirmed_mismatch).toBe(1);
  });
});

/* ============================================================ */
/*  Report-shape invariants (all scenarios)                      */
/* ============================================================ */

describe("T-511 report invariants", () => {
  it("counts agree with the findings array and coverage reflects the inputs", () => {
    const report = run({
      parents: [makeParent({ id: "p-1" }), makeParent({ id: "p-2" })],
      students: [makeStudent({ id: "s-1" })],
      payments: [makePayment({ id: "pay-1", collectedAt: "2027-01-01" })],
      installments: [makeInstallment({ id: "ins-1", studentId: "s-1", trancheNumber: 1 })],
      ledgerEntries: [
        makeLedgerEntry({ id: "led-c1", sourceId: "ins-1", studentId: "s-1" }),
        makeLedgerEntry({ id: "led-p1", type: "payment", sourceType: "payment", sourceId: "pay-1", amount: -50_000, paymentStatus: "paid", at: "2027-01-01" }),
      ],
    });
    const byCategory = new Map<string, number>();
    for (const f of report.findings) byCategory.set(f.category, (byCategory.get(f.category) ?? 0) + 1);
    for (const [cat, n] of byCategory) expect(report.counts[cat as keyof typeof report.counts]).toBe(n);
    expect(report.coverage.payments).toBe(1);
    expect(report.coverage.ledgerEntries).toBe(2);
    expect(report.coverage.installments).toBe(1);
    expect(report.coverage.parents).toBe(2);
    expect(report.asOf).toBe(new Date(NOW).toISOString());
    expect(report.thresholds).toEqual(DEFAULT_WEBHOOK_DIAGNOSTICS_THRESHOLDS);
  });

  it("finding ids are unique across the whole report", () => {
    const report = run({
      parents: [makeParent()],
      students: [makeStudent({ id: "s-1", gradeLevel: "3am" })],
      payments: [
        makePayment({ id: "pay-1", collectedAt: "2027-01-01" }),
        makePayment({ id: "pay-2", collectedAt: "2026-09-10", amount: 10_000 }),
      ],
      installments: [
        makeInstallment({ id: "ins-1", studentId: "s-1", trancheNumber: 1 }),
        makeInstallment({ id: "ins-2", studentId: "s-1", trancheNumber: 2 }),
        makeInstallment({ id: "ins-3", studentId: "s-1", trancheNumber: 3 }),
      ],
      ledgerEntries: [
        makeLedgerEntry({ id: "led-c1", sourceId: "ins-1", studentId: "s-1" }),
        makeLedgerEntry({ id: "led-c2", sourceId: "ins-2", studentId: "s-1" }),
        makeLedgerEntry({ id: "led-c3", sourceId: "ins-3", studentId: "s-1" }),
        makeLedgerEntry({ id: "led-p1", type: "payment", sourceType: "payment", sourceId: "pay-1", amount: -50_000, paymentStatus: "paid", at: "2027-01-01" }),
      ],
    });
    const ids = report.findings.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
