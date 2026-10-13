/**
 * T-528 (AUDIT-507 + AUDIT-508) — the false-positive regression suite for
 * the Webhook & Ledger Traceability Diagnostics engine.
 *
 * The owner's two reported false-positive classes, pinned against
 * regression, WITH the genuine-detection classes the owner's contract
 * demands preserved:
 *
 *  A. NEW ACCOUNTS (AUDIT-507): a registration-path charge carrying the
 *     `reg-<code>[-transport]-t<n>` business identity resolves to its real
 *     installment (student + category + tranche, parent-guarded) — NO
 *     false « échéance introuvable »; the resolution is documented in a
 *     reconciled finding naming the identity form.
 *  B. MISSING INSTALLMENT REFERENCES: a charge resolvable through NEITHER
 *     identity form (a deleted installment's PK, an unknown reg token, a
 *     reg token whose student/wave matches nothing) STILL raises the
 *     CRITICAL dangling finding.
 *  C. SIBLING SUBSCRIPTIONS (AUDIT-508): two payments of one family with
 *     identical amount/method/date/status on DISTINCT students with
 *     distinct receipts are NOT duplicates — the reconciled sibling
 *     finding explains the identical per-grade pricing.
 *  D. GENUINE DUPLICATES: the same-student tuple, the null-subject tuple,
 *     the mixed group's same-student subset, and the shared-receipt
 *     replay are ALL still flagged.
 *  E. The resolution-safety edges: cross-family reg-identity refused, the
 *     amount-mismatch through the reg form still critical, the token's
 *     student-code fallback, the transport wave matching, the
 *     single-category (full-annual) fallback.
 */
import { describe, it, expect } from "vitest";
import {
  runWebhookDiagnostics,
  type WebhookDiagnosticFinding,
  type WebhookDiagnosticsReport,
} from "../../../domain/calc/payment/webhook-diagnostics";
import type {
  Installment,
  Payment,
} from "../../../domain/model/payment";
import type { LedgerEntry } from "../../../domain/model/ledger";
import type { Parent } from "../../../domain/model/parent";
import type { Student } from "../../../domain/model/student";

const NOW = Date.parse("2026-10-13T12:00:00.000Z");

/* ============================================================ */
/*  Fixtures (the T-511 conventions, extended with code/student) */
/* ============================================================ */

function makeParent(overrides: Partial<Parent> = {}): Parent {
  return {
    id: overrides.id ?? "p-1",
    tenantId: "t-1",
    code: overrides.code ?? "PAR-1",
    firstName: overrides.firstName ?? "Alice",
    lastName: overrides.lastName ?? " " + "Probe".trim(),
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
    code: overrides.code ?? "ELV-2026-000001",
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
    description: overrides.description ?? "Scolarité 2026 — Tranche 1",
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
  } as unknown as Payment;
}

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
/*  A. AUDIT-507 — the registration identity resolves            */
/* ============================================================ */

describe("T-528 / AUDIT-507 — registration-path charges resolve through the reg-identity (new accounts)", () => {
  it("the owner's reported shape: a reg-…-t1 tuition charge on a newly registered account is NOT dangling — it resolves to the real installment and is reconciled", () => {
    // The live shape of e8afa61f…/reg-ELV-2026-0CF277-t1: the charge stamps
    // the studentId, the installment lives under a UUID PK the charge never
    // references, and the amounts agree exactly.
    const report = run({
      parents: [makeParent()],
      students: [makeStudent({ id: "stu-omar", code: "ELV-2026-0CF277", firstName: "Omar", lastName: "Khelifi" })],
      installments: [
        makeInstallment({
          id: "98ed91e2-eaf4-4cae-baec-79f5b737cf8c",
          studentId: "stu-omar",
          category: "tuition",
          label: "Année complète",
          trancheNumber: 1,
          amountDue: 365_000,
          amountPaid: 5_000,
          status: "partial",
        }),
      ],
      ledgerEntries: [
        makeLedgerEntry({
          id: "e8afa61f-3f75-4a18-bde1-40900f219057",
          studentId: "stu-omar",
          category: "tuition",
          amount: 365_000,
          sourceType: "installment",
          sourceId: "reg-ELV-2026-0CF277-t1",
          description: "Scolarité 2026 — Tranche 1 (3eme_annee)",
          at: "2026-10-13T12:40:43.792Z",
        }),
      ],
    });

    // THE false positive is gone:
    expect(findingsOf(report).some((f) => f.id === "confirmed_mismatch:charge-dangling:e8afa61f-3f75-4a18-bde1-40900f219057")).toBe(false);
    // …and the charge is POSITIVELY accounted with the resolution stated:
    const f = findingById(report, "reconciled:charge-reg-resolved:e8afa61f-3f75-4a18-bde1-40900f219057");
    expect(f.severity).toBe("ok");
    expect(f.recordIds.installment).toBe("98ed91e2-eaf4-4cae-baec-79f5b737cf8c");
    expect(norm(f.explanation)).toContain("reg-ELV-2026-0CF277-t1");
    expect(norm(f.explanation)).toContain("Omar Khelifi");
    expect(norm(f.calculation ?? "")).toContain("365");
  });

  it("the transport waves resolve through the -transport-t<n> token", () => {
    const report = run({
      parents: [makeParent()],
      students: [makeStudent({ id: "stu-1", code: "ELV-2026-0CF277" })],
      installments: [
        makeInstallment({ id: "tr-t1", studentId: "stu-1", category: "transport", label: "Transport T1", trancheNumber: 1, amountDue: 20_000 }),
        makeInstallment({ id: "tr-t2", studentId: "stu-1", category: "transport", label: "Transport T2", trancheNumber: 2, amountDue: 10_000 }),
        makeInstallment({ id: "tr-t3", studentId: "stu-1", category: "transport", label: "Transport T3", trancheNumber: 3, amountDue: 10_000 }),
      ],
      ledgerEntries: [
        makeLedgerEntry({ id: "led-tr2", studentId: "stu-1", category: "transport", amount: 10_000, sourceType: "installment", sourceId: "reg-ELV-2026-0CF277-transport-t2" }),
      ],
    });
    const f = findingById(report, "reconciled:charge-reg-resolved:led-tr2");
    expect(f.recordIds.installment).toBe("tr-t2"); // the WAVE 2 row — not t1, not t3
    expect(findingsOf(report).some((x) => x.id.startsWith("confirmed_mismatch:charge-dangling:"))).toBe(false);
  });

  it("a charge without studentId resolves the student by CODE from the token (the students stream)", () => {
    const report = run({
      parents: [makeParent()],
      students: [makeStudent({ id: "stu-bycode", code: "ELV-2026-0CF277", firstName: "Omar", lastName: "Khelifi" })],
      installments: [
        makeInstallment({ id: "ins-code", studentId: "stu-bycode", category: "tuition", trancheNumber: 1, amountDue: 100_000 }),
      ],
      ledgerEntries: [
        makeLedgerEntry({ id: "led-nocode", studentId: null, category: "tuition", amount: 100_000, sourceType: "installment", sourceId: "reg-ELV-2026-0CF277-t1" }),
      ],
    });
    const f = findingById(report, "reconciled:charge-reg-resolved:led-nocode");
    expect(f.recordIds.installment).toBe("ins-code");
  });

  it("a full-annual installment with NO wave number resolves through the single-category fallback", () => {
    const report = run({
      parents: [makeParent()],
      students: [makeStudent({ id: "stu-fa" })],
      installments: [
        makeInstallment({ id: "ins-annual", studentId: "stu-fa", category: "tuition", label: "Année complète", amountDue: 300_000 }), // no trancheNumber
      ],
      ledgerEntries: [
        makeLedgerEntry({ id: "led-fa", studentId: "stu-fa", category: "tuition", amount: 300_000, sourceType: "installment", sourceId: "reg-ELV-2026-000001-t1" }),
      ],
    });
    expect(findingsOf(report).some((f) => f.id === "reconciled:charge-reg-resolved:led-fa")).toBe(true);
    expect(findingsOf(report).some((f) => f.id.startsWith("confirmed_mismatch:charge-dangling:"))).toBe(false);
  });

  it("the PK form still resolves silently (the import class's counts stay byte-stable)", () => {
    const report = run({
      parents: [makeParent()],
      installments: [makeInstallment({ id: "ins-pk", amountDue: 100_000, studentId: null })],
      ledgerEntries: [
        makeLedgerEntry({ id: "led-pk", amount: 100_000, sourceType: "installment", sourceId: "ins-pk" }),
      ],
    });
    // No dangling, no charge-reg-resolved (form A stays silent as before):
    expect(findingsOf(report).some((f) => f.id === "confirmed_mismatch:charge-dangling:led-pk")).toBe(false);
    expect(findingsOf(report).some((f) => f.id === "reconciled:charge-reg-resolved:led-pk")).toBe(false);
  });
});

/* ============================================================ */
/*  B. The genuine dangling class is PRESERVED                   */
/* ============================================================ */

describe("T-528 / AUDIT-507 — charges resolvable through NEITHER form still raise the CRITICAL dangling finding", () => {
  it("a deleted installment's PK reference is still dangling", () => {
    const report = run({
      parents: [makeParent()],
      installments: [makeInstallment({ id: "ins-alive", amountDue: 100_000 })],
      ledgerEntries: [
        makeLedgerEntry({ id: "led-gone", amount: 100_000, sourceType: "installment", sourceId: "ins-deleted-long-ago" }),
      ],
    });
    const f = findingById(report, "confirmed_mismatch:charge-dangling:led-gone");
    expect(f.severity).toBe("critical");
    expect(norm(f.explanation)).toContain("introuvable");
  });

  it("a reg token whose student matches nothing (no stamp, unknown code) is still dangling", () => {
    const report = run({
      parents: [makeParent()],
      students: [makeStudent({ id: "stu-1", code: "ELV-2026-KNOWN" })],
      installments: [
        makeInstallment({ id: "ins-1", studentId: "stu-1", category: "tuition", trancheNumber: 1, amountDue: 100_000 }),
      ],
      ledgerEntries: [
        makeLedgerEntry({ id: "led-unk", studentId: null, category: "tuition", amount: 100_000, sourceType: "installment", sourceId: "reg-ELV-2026-UNKNOWN-t1" }),
      ],
    });
    expect(findingsOf(report).some((f) => f.id === "confirmed_mismatch:charge-dangling:led-unk")).toBe(true);
  });

  it("a charge whose student stamp matches nothing and whose token is unknown is still dangling (both paths fail)", () => {
    const report = run({
      parents: [makeParent()],
      students: [makeStudent({ id: "stu-1", code: "ELV-2026-KNOWN" })],
      installments: [
        makeInstallment({ id: "ins-1", studentId: "stu-1", category: "tuition", trancheNumber: 1, amountDue: 100_000 }),
      ],
      ledgerEntries: [
        makeLedgerEntry({ id: "led-ghost", studentId: "stu-ghost-not-in-stream", category: "tuition", amount: 100_000, sourceType: "installment", sourceId: "reg-ELV-2026-UNKNOWN-t1" }),
      ],
    });
    expect(findingsOf(report).some((f) => f.id === "confirmed_mismatch:charge-dangling:led-ghost")).toBe(true);
  });

  it("the authoritative stamp wins: a charge whose studentId resolves keeps the resolution even when the token string is stale (the 0103 convention — the stamp is the resolved UUID)", () => {
    const report = run({
      parents: [makeParent()],
      students: [makeStudent({ id: "stu-1", code: "ELV-2026-KNOWN" })],
      installments: [
        makeInstallment({ id: "ins-1", studentId: "stu-1", category: "tuition", trancheNumber: 1, amountDue: 100_000 }),
      ],
      ledgerEntries: [
        makeLedgerEntry({ id: "led-stampwins", studentId: "stu-1", category: "tuition", amount: 100_000, sourceType: "installment", sourceId: "reg-ELV-2026-STALESTRING-t1" }),
      ],
    });
    // The stamp resolves; the stale token string never overrides it:
    expect(findingsOf(report).some((f) => f.id === "reconciled:charge-reg-resolved:led-stampwins")).toBe(true);
    expect(findingsOf(report).some((f) => f.id === "confirmed_mismatch:charge-dangling:led-stampwins")).toBe(false);
  });

  it("a reg token whose wave matches nothing (t9) is still dangling", () => {
    const report = run({
      parents: [makeParent()],
      students: [makeStudent({ id: "stu-1", code: "ELV-2026-0CF277" })],
      installments: [
        makeInstallment({ id: "ins-1", studentId: "stu-1", category: "tuition", trancheNumber: 1, amountDue: 100_000 }),
        makeInstallment({ id: "ins-2", studentId: "stu-1", category: "tuition", trancheNumber: 2, amountDue: 100_000 }),
        makeInstallment({ id: "ins-3", studentId: "stu-1", category: "tuition", trancheNumber: 3, amountDue: 100_000 }),
      ],
      ledgerEntries: [
        makeLedgerEntry({ id: "led-t9", studentId: "stu-1", category: "tuition", amount: 100_000, sourceType: "installment", sourceId: "reg-ELV-2026-0CF277-t9" }),
      ],
    });
    expect(findingsOf(report).some((f) => f.id === "confirmed_mismatch:charge-dangling:led-t9")).toBe(true);
  });

  it("a reg token pointing into ANOTHER family is refused by the parent guard (identity safety)", () => {
    const report = run({
      parents: [makeParent({ id: "p-1" }), makeParent({ id: "p-2" })],
      students: [makeStudent({ id: "stu-2", code: "ELV-2026-OTHER", parentId: "p-2" })],
      installments: [
        makeInstallment({ id: "ins-other", parentId: "p-2", studentId: "stu-2", category: "tuition", trancheNumber: 1, amountDue: 100_000 }),
      ],
      ledgerEntries: [
        // The charge belongs to p-1 but the token names p-2's student:
        makeLedgerEntry({ id: "led-xfam", parentId: "p-1", studentId: null, category: "tuition", amount: 100_000, sourceType: "installment", sourceId: "reg-ELV-2026-OTHER-t1" }),
      ],
    });
    expect(findingsOf(report).some((f) => f.id === "confirmed_mismatch:charge-dangling:led-xfam")).toBe(true);
    expect(findingsOf(report).some((f) => f.id === "reconciled:charge-reg-resolved:led-xfam")).toBe(false);
  });

  it("an amount mismatch found THROUGH the reg form is still a critical mismatch", () => {
    const report = run({
      parents: [makeParent()],
      students: [makeStudent({ id: "stu-1", code: "ELV-2026-0CF277" })],
      installments: [
        makeInstallment({ id: "ins-1", studentId: "stu-1", category: "tuition", trancheNumber: 1, amountDue: 365_000 }),
      ],
      ledgerEntries: [
        makeLedgerEntry({ id: "led-amt", studentId: "stu-1", category: "tuition", amount: 635_000, sourceType: "installment", sourceId: "reg-ELV-2026-0CF277-t1" }),
      ],
    });
    const f = findingById(report, "confirmed_mismatch:charge-amt:led-amt");
    expect(f.severity).toBe("critical");
    expect(norm(f.explanation)).toContain("reg-ELV-2026-0CF277-t1"); // the resolution form is stated
  });

  it("the empty-stream unverified posture is unchanged", () => {
    const report = run({
      parents: [makeParent()],
      installments: [], // nothing loaded
      ledgerEntries: [
        makeLedgerEntry({ id: "led-nosrc", amount: 100_000, sourceType: "installment", sourceId: "reg-ELV-2026-0CF277-t1" }),
      ],
    });
    const f = findingById(report, "unverified:charge-nosrc:led-nosrc");
    expect(f.severity).toBe("info");
  });
});

/* ============================================================ */
/*  C. AUDIT-508 — the sibling class is reconciled               */
/* ============================================================ */

describe("T-528 / AUDIT-508 — sibling payments of identical amounts are NOT duplicates", () => {
  it("two siblings' identical payments (distinct students, distinct receipts) produce the reconciled sibling finding — never a duplicate_event", () => {
    const report = run({
      parents: [makeParent()],
      students: [
        makeStudent({ id: "stu-ahlem", code: "ELV-2026-A", firstName: "Ahlem", lastName: "Hamouda" }),
        makeStudent({ id: "stu-abderhman", code: "ELV-2026-B", firstName: "Abderhman", lastName: "Hamouda" }),
      ],
      payments: [
        makePayment({ id: "pay-ahlem", studentId: "stu-ahlem", amount: 135_000, collectedAt: "2026-09-15", receiptNumber: "IMP-aaa-V2", parentId: "p-1" }),
        makePayment({ id: "pay-abderhman", studentId: "stu-abderhman", amount: 135_000, collectedAt: "2026-09-15", receiptNumber: "IMP-bbb-V2", parentId: "p-1" }),
      ],
    });

    expect(report.counts.duplicate_event).toBe(0);
    const f = findingById(report, "reconciled:dup-siblings:pay-ahlem");
    expect(f.severity).toBe("ok");
    expect(f.sourceRefs).toContain("payments:pay-ahlem");
    expect(f.sourceRefs).toContain("payments:pay-abderhman");
    expect(norm(f.explanation)).toContain("Ahlem Hamouda");
    expect(norm(f.explanation)).toContain("Abderhman Hamouda");
    expect(norm(f.explanation)).toContain("frères et sœurs");
    // It must never carry the duplicate CLAIM phrase (a bare word-match would
    // trip on the explicit negation « ce ne sont pas des événements rejoués »):
    expect(norm(f.explanation)).not.toContain("la signature d'un événement rejoué");
  });

  it("three siblings, one collection day — still reconciled (the sibling set scales)", () => {
    const report = run({
      parents: [makeParent()],
      students: [
        makeStudent({ id: "stu-1", firstName: "A", lastName: "Fam" }),
        makeStudent({ id: "stu-2", firstName: "B", lastName: "Fam" }),
        makeStudent({ id: "stu-3", firstName: "C", lastName: "Fam" }),
      ],
      payments: [
        makePayment({ id: "pay-1", studentId: "stu-1", amount: 106_500, collectedAt: "2026-12-15", receiptNumber: "R1" }),
        makePayment({ id: "pay-2", studentId: "stu-2", amount: 106_500, collectedAt: "2026-12-15", receiptNumber: "R2" }),
        makePayment({ id: "pay-3", studentId: "stu-3", amount: 106_500, collectedAt: "2026-12-15", receiptNumber: "R3" }),
      ],
    });
    expect(report.counts.duplicate_event).toBe(0);
    const f = findingsOf(report, "reconciled").find((x) => x.id.startsWith("reconciled:dup-siblings:"));
    expect(f).toBeDefined();
    expect(f!.sourceRefs.length).toBe(3);
  });

  it("the sibling finding does not swallow the payments' own reconciled coverage (no silent omission)", () => {
    // With ledger twins present, every sibling payment remains positively
    // accounted: the sample via the sibling finding, the others via pay-ok.
    const report = run({
      parents: [makeParent()],
      students: [
        makeStudent({ id: "stu-1", firstName: "A", lastName: "Fam" }),
        makeStudent({ id: "stu-2", firstName: "B", lastName: "Fam" }),
      ],
      payments: [
        makePayment({ id: "pay-1", studentId: "stu-1", amount: 50_000, collectedAt: "2026-09-10", receiptNumber: "RA" }),
        makePayment({ id: "pay-2", studentId: "stu-2", amount: 50_000, collectedAt: "2026-09-10", receiptNumber: "RB" }),
      ],
      ledgerEntries: [
        makeLedgerEntry({ id: "led-p1", type: "payment", sourceType: "payment", sourceId: "pay-1", amount: -50_000, paymentStatus: "paid", at: "2026-09-10" }),
        makeLedgerEntry({ id: "led-p2", type: "payment", sourceType: "payment", sourceId: "pay-2", amount: -50_000, paymentStatus: "paid", at: "2026-09-10" }),
      ],
    });
    const accounted = new Set<string>();
    for (const f of findingsOf(report)) {
      if (f.recordIds.payment) accounted.add(f.recordIds.payment);
      if (f.category === "reconciled" || f.category === "duplicate_event") {
        for (const ref of f.sourceRefs) {
          const m = /^payments:(.+)$/.exec(ref);
          if (m && (f.category === "reconciled" || f.id.startsWith("reconciled:dup-siblings"))) accounted.add(m[1]);
        }
      }
    }
    expect(accounted.has("pay-1")).toBe(true);
    expect(accounted.has("pay-2")).toBe(true);
  });
});

/* ============================================================ */
/*  D. The genuine duplicate classes are PRESERVED               */
/* ============================================================ */

describe("T-528 / AUDIT-508 — genuine duplicates are still flagged", () => {
  it("the SAME student's identical tuple with distinct receipts is still a duplicate warning", () => {
    const report = run({
      parents: [makeParent()],
      students: [makeStudent({ id: "stu-1", firstName: "Solo", lastName: "Kid" })],
      payments: [
        makePayment({ id: "pay-x", studentId: "stu-1", amount: 50_000, collectedAt: "2026-09-10", receiptNumber: "REC-A" }),
        makePayment({ id: "pay-y", studentId: "stu-1", amount: 50_000, collectedAt: "2026-09-10", receiptNumber: "REC-B" }),
      ],
    });
    const f = findingById(report, "duplicate_event:dup-tuple:pay-x");
    expect(f.severity).toBe("warning");
    expect(norm(f.explanation)).toContain("même sujet");
    expect(f.sourceRefs).toContain("payments:pay-x");
    expect(f.sourceRefs).toContain("payments:pay-y");
  });

  it("two NULL-subject identical payments are still flagged (unverifiable stays conservative)", () => {
    const report = run({
      parents: [makeParent()],
      payments: [
        makePayment({ id: "pay-n1", studentId: null, amount: 50_000, collectedAt: "2026-09-10", receiptNumber: "REC-A" }),
        makePayment({ id: "pay-n2", studentId: null, amount: 50_000, collectedAt: "2026-09-10", receiptNumber: "REC-B" }),
      ],
    });
    expect(findingsOf(report).some((f) => f.id === "duplicate_event:dup-tuple:pay-n1")).toBe(true);
  });

  it("a mixed group (same student twice + one sibling) flags ONLY the same-student subset", () => {
    const report = run({
      parents: [makeParent()],
      students: [
        makeStudent({ id: "stu-1", firstName: "A", lastName: "Fam" }),
        makeStudent({ id: "stu-2", firstName: "B", lastName: "Fam" }),
      ],
      payments: [
        makePayment({ id: "pay-a1", studentId: "stu-1", amount: 50_000, collectedAt: "2026-09-10", receiptNumber: "R1" }),
        makePayment({ id: "pay-a2", studentId: "stu-1", amount: 50_000, collectedAt: "2026-09-10", receiptNumber: "R2" }), // the replay
        makePayment({ id: "pay-b1", studentId: "stu-2", amount: 50_000, collectedAt: "2026-09-10", receiptNumber: "R3" }), // the innocent sibling
      ],
    });
    const dup = findingById(report, "duplicate_event:dup-tuple:pay-a1");
    expect(dup.sourceRefs).toContain("payments:pay-a1");
    expect(dup.sourceRefs).toContain("payments:pay-a2");
    expect(dup.sourceRefs).not.toContain("payments:pay-b1");
    // the innocent sibling member is NOT dragged into the duplicate:
    const dupFindings = findingsOf(report, "duplicate_event");
    for (const f of dupFindings) expect(f.sourceRefs).not.toContain("payments:pay-b1");
  });

  it("a shared receipt number is STILL a critical duplicate regardless of students (check (a) untouched)", () => {
    const report = run({
      parents: [makeParent()],
      students: [
        makeStudent({ id: "stu-1", firstName: "A", lastName: "Fam" }),
        makeStudent({ id: "stu-2", firstName: "B", lastName: "Fam" }),
      ],
      payments: [
        makePayment({ id: "pay-s1", studentId: "stu-1", amount: 50_000, collectedAt: "2026-09-10", receiptNumber: "REC-SAME" }),
        makePayment({ id: "pay-s2", studentId: "stu-2", amount: 50_000, collectedAt: "2026-09-10", receiptNumber: "REC-SAME" }),
      ],
    });
    const f = findingById(report, "duplicate_event:dup-receipt:REC-SAME");
    expect(f.severity).toBe("critical");
  });
});

/* ============================================================ */
/*  E. The read-only guarantee over the new resolution path      */
/* ============================================================ */

describe("T-528 — the read-only guarantee holds over the extended resolution", () => {
  it("the reg-identity resolution mutates nothing (frozen inputs, byte-identical on re-run)", () => {
    const students = [
      makeStudent({ id: "stu-1", code: "ELV-2026-0CF277", firstName: "Omar", lastName: "Khelifi" }),
      makeStudent({ id: "stu-2", code: "ELV-2026-0CF278", firstName: "Imane", lastName: "Khelifi" }),
    ];
    const installments = [
      makeInstallment({ id: "ins-t1", studentId: "stu-1", category: "tuition", trancheNumber: 1, amountDue: 365_000 }),
      makeInstallment({ id: "ins-t2", studentId: "stu-2", category: "tuition", trancheNumber: 1, amountDue: 365_000 }),
    ];
    const payments = [
      makePayment({ id: "pay-1", studentId: "stu-1", amount: 135_000, collectedAt: "2026-09-15", receiptNumber: "RA" }),
      makePayment({ id: "pay-2", studentId: "stu-2", amount: 135_000, collectedAt: "2026-09-15", receiptNumber: "RB" }),
    ];
    const ledgerEntries = [
      makeLedgerEntry({ id: "led-c1", studentId: "stu-1", amount: 365_000, sourceType: "installment", sourceId: "reg-ELV-2026-0CF277-t1" }),
      makeLedgerEntry({ id: "led-c2", studentId: "stu-2", amount: 365_000, sourceType: "installment", sourceId: "reg-ELV-2026-0CF278-t1" }),
      // The payments' ledger twins — the fixture isolates the TWO fixed
      // classes (no pay-no-ledger noise from the separate BUSINESS-002 class).
      makeLedgerEntry({ id: "led-p1", type: "payment", sourceType: "payment", sourceId: "pay-1", amount: -135_000, paymentStatus: "paid", at: "2026-09-15" }),
      makeLedgerEntry({ id: "led-p2", type: "payment", sourceType: "payment", sourceId: "pay-2", amount: -135_000, paymentStatus: "paid", at: "2026-09-15" }),
    ];
    const before = JSON.stringify({ students, installments, payments, ledgerEntries });
    const r1 = run({ parents: [makeParent()], students, installments, payments, ledgerEntries });
    const r2 = run({ parents: [makeParent()], students, installments, payments, ledgerEntries });
    const after = JSON.stringify({ students, installments, payments, ledgerEntries });
    expect(after).toBe(before); // no mutation
    expect(JSON.stringify(r1.findings)).toBe(JSON.stringify(r2.findings)); // deterministic
    expect(r1.counts.duplicate_event).toBe(0); // siblings reconciled
    expect(r1.counts.confirmed_mismatch).toBe(0); // both reg charges resolved
  });
});
