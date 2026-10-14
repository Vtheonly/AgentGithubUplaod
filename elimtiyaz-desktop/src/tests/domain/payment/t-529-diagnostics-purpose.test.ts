/**
 * T-529 (AUDIT-509 + AUDIT-510) — the diagnostics-purpose regression suite
 * for the Webhook & Ledger Traceability Diagnostics engine.
 *
 * The owner's 173rd-session mandate, pinned against regression:
 *
 *  A. THE CONFIGURED-PRICE COMPLIANCE (AUDIT-510): the owner's exact live
 *     example — an FI encaissement of 25,000 DZD vs the configured flat
 *     registration fee of 5,000 DZD — flags as outlier_review carrying BOTH
 *     configured references (flat + per-grade), the 20,000 delta, the
 *     provenance, the possible causes, and the resolution steps.
 *  B. THE CONFIG TENSION: the configuration's own flat-vs-per-grade
 *     divergence surfaces ONCE as the root-cause finding; an agreeing
 *     config produces none.
 *  C. THE VERDICT CLASSES: matches-both → reconciled; matches-neither →
 *     confirmed_mismatch; unknown student → unverified; the family-level
 *     registration charge vs the flat fee (the MERSEL « nouvelle famille »
 *     shape) → reconciled when conforming, outlier when divergent.
 *  D. THE HONEST DEGRADATION: no config → exactly ONE unverified coverage
 *     finding, never silent, never spam; the other classes unaffected.
 *  E. THE ALL-ORIGINS COVERAGE (AUDIT-509): the report's coverage carries
 *     the charge identity-form census; the T-528 resolution classes are
 *     UNCHANGED when a config is supplied.
 *  F. THE 7-POINT STRUCTURE: the possibleCauses dimension present on the
 *     new findings and the owner-reported classes (dangling, duplicates).
 *  G. READ-ONLY + deterministic (the charter): frozen inputs, identical
 *     re-runs.
 */
import { describe, it, expect } from "vitest";
import {
  runWebhookDiagnostics,
  type WebhookDiagnosticFinding,
  type WebhookDiagnosticsReport,
  type WebhookDiagnosticsPricingConfig,
} from "../../../domain/calc/payment/webhook-diagnostics";
import type {
  Installment,
  Payment,
} from "../../../domain/model/payment";
import type { LedgerEntry } from "../../../domain/model/ledger";
import type { Parent } from "../../../domain/model/parent";
import type { Student } from "../../../domain/model/student";

const NOW = Date.parse("2026-10-14T12:00:00.000Z");

/* ============================================================ */
/*  Fixtures (the T-528 conventions)                             */
/* ============================================================ */

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
    notes: overrides.notes ?? null,
    collectedBy: "usr-1",
    collectedAt: overrides.collectedAt ?? "2026-09-01",
    createdAt: "2026-09-01",
    updatedAt: "2026-09-01",
  } as unknown as Payment;
}

/** The LIVE config shape (the 2026-10-14 forensics): flat 5,000 + the per-grade grid. */
const LIVE_CONFIG: WebhookDiagnosticsPricingConfig = {
  registrationFee: 5_000,
  registrationFeeByGrade: {
    prescolaire_1: 18_000,
    prescolaire_2: 18_000,
    "1ap": 25_000,
    "2ap": 25_000,
    "3ap": 25_000,
    "4ap": 25_000,
    "5ap": 30_000,
    "1am": 25_000,
    "2am": 25_000,
    "3am": 25_000,
    "4am": 30_000,
    "1ere_annee": 25_000,
    "2eme_annee": 25_000,
    "3eme_annee": 30_000,
  },
  tuitionByGradeLevel: {
    "1ap": { annualAmount: 220_000, installments: [89_000, 65_500, 65_500] },
  },
};

function run(params: Partial<Parameters<typeof runWebhookDiagnostics>[0]>): WebhookDiagnosticsReport {
  return runWebhookDiagnostics({
    payments: params.payments ?? [],
    installments: params.installments ?? [],
    ledgerEntries: params.ledgerEntries ?? [],
    allocations: params.allocations ?? [],
    debtSummaries: params.debtSummaries ?? [],
    parents: params.parents ?? [],
    students: params.students ?? [],
    pricingConfig: params.pricingConfig,
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

/** The owner's exact live example: the HAMIDI FI encaissement shape. */
function hamidiFiPayment(overrides: Partial<Payment> = {}): Payment {
  return makePayment({
    id: "pay-fi-25000",
    receiptNumber: "IMP-2a3c16a6-db7a-4fee-8232-260c23e1eaf5-FI",
    parentId: "p-hamidi",
    studentId: "stu-2a3c",
    amount: 25_000,
    category: "tuition",
    notes: "Frais d'inscription (FI) — import Excel run run_mukfqlcy_775",
    collectedAt: "2026-09-15",
    ...overrides,
  });
}

/* ============================================================ */
/*  A. THE OWNER'S EXAMPLE — 25,000 FI vs 5,000 configured      */
/* ============================================================ */

describe("T-529 / AUDIT-510 A — the owner's example: the FI encaissement vs the configured prices", () => {
  const fixtures = {
    parents: [
      makeParent({ id: "p-hamidi", code: "PAR-2026-000HAM", firstName: "HAMIDI", lastName: "Famille" }),
      makeParent({ id: "p-1" }),
    ],
    students: [
      makeStudent({ id: "stu-2a3c", code: "ELV-2026-000001", parentId: "p-hamidi", gradeLevel: "1ap" }),
    ],
    payments: [hamidiFiPayment()],
  };

  it("flags the 25,000 FI encaissement as outlier_review (not silence, not a generic warning)", () => {
    const report = run({ ...fixtures, pricingConfig: LIVE_CONFIG });
    const f = findingById(report, "outlier_review:price-fi-pay:pay-fi-25000");
    expect(f.severity).toBe("warning");
    expect(f.parentId).toBe("p-hamidi");
  });

  it("carries BOTH configured references and the exact 20,000 delta (the impact, quantified)", () => {
    const report = run({ ...fixtures, pricingConfig: LIVE_CONFIG });
    const f = findingById(report, "outlier_review:price-fi-pay:pay-fi-25000");
    expect(f.amount).toBe(20_000); // 25,000 − 5,000 (the violated flat reference)
    const flat = f.evidence.find((e) => e.label.includes("Tarif plat configuré"));
    const grade = f.evidence.find((e) => norm(e.label).includes("Tarif par niveau configuré (1ap)"));
    expect(norm(flat?.value ?? "")).toBe("5 000 DZD");
    expect(norm(grade?.value ?? "")).toBe("25 000 DZD");
    expect(norm(f.calculation ?? "")).toContain("25 000 DZD");
    expect(norm(f.calculation ?? "")).toContain("20 000 DZD");
  });

  it("explains WHAT/WHY: follows the per-grade convention, violates the flat configured fee — and names the config tension as the likely root cause", () => {
    const report = run({ ...fixtures, pricingConfig: LIVE_CONFIG });
    const f = findingById(report, "outlier_review:price-fi-pay:pay-fi-25000");
    expect(norm(f.explanation)).toContain("suit le tarif par niveau configuré");
    expect(norm(f.explanation)).toContain("VIOLE le tarif plat configuré");
    expect(norm(f.explanation)).toContain("deux conventions divergentes");
  });

  it("carries the PROVENANCE (the Excel import run — where the amount originated)", () => {
    const report = run({ ...fixtures, pricingConfig: LIVE_CONFIG });
    const f = findingById(report, "outlier_review:price-fi-pay:pay-fi-25000");
    const prov = f.evidence.find((e) => e.label === "Provenance");
    expect(norm(prov?.value ?? "")).toContain("import Excel");
    expect(norm(prov?.value ?? "")).toContain("run_mukfqlcy_775");
  });

  it("carries the POSSIBLE CAUSES dimension (the owner's point 6 — hypotheses, both sides of the ruling)", () => {
    const report = run({ ...fixtures, pricingConfig: LIVE_CONFIG });
    const f = findingById(report, "outlier_review:price-fi-pay:pay-fi-25000");
    expect((f.possibleCauses?.length ?? 0)).toBeGreaterThanOrEqual(3);
    const causes = norm(f.possibleCauses!.join(" | "));
    expect(causes).toContain("deux conventions divergentes");
    expect(causes).toContain("désynchronisation de configuration");
    expect(causes).toContain("sous-facture");
  });

  it("recommends the RESOLUTION without ever rewriting a record (both ruling branches)", () => {
    const report = run({ ...fixtures, pricingConfig: LIVE_CONFIG });
    const f = findingById(report, "outlier_review:price-fi-pay:pay-fi-25000");
    const steps = norm(f.suggestedSteps.join(" | "));
    expect(steps).toContain("Trancher la convention autoritaire");
    expect(steps).toContain("régulariser l'excédent de 20 000 DZD");
    expect(steps).toContain("jamais une écriture manuelle directe");
  });
});

/* ============================================================ */
/*  B. THE CONFIG TENSION — the root cause, surfaced ONCE       */
/* ============================================================ */

describe("T-529 / AUDIT-510 B — the configuration's own two-convention divergence", () => {
  it("surfaces the flat-vs-per-grade tension as ONE root-cause finding with its own causes", () => {
    const report = run({ pricingConfig: LIVE_CONFIG });
    const f = findingById(report, "outlier_review:price-config-tension:registration-fee");
    expect(f.severity).toBe("info");
    expect((f.possibleCauses?.length ?? 0)).toBeGreaterThanOrEqual(2);
    const causes = norm(f.possibleCauses!.join(" | "));
    expect(causes).toContain("CALC-001");
    expect(norm(f.explanation)).toContain("deux prix configurés divergents");
    expect(norm(f.explanation)).toContain("flux d'inscription");
    expect(norm(f.explanation)).toContain("import Excel");
  });

  it("stays silent when the config agrees with itself (flat === every per-grade value)", () => {
    const report = run({
      pricingConfig: {
        registrationFee: 5_000,
        registrationFeeByGrade: { "1ap": 5_000, "2ap": 5_000 },
      },
    });
    expect(report.findings.find((f) => f.id === "outlier_review:price-config-tension:registration-fee")).toBeUndefined();
  });
});

/* ============================================================ */
/*  C. THE VERDICT CLASSES                                       */
/* ============================================================ */

describe("T-529 / AUDIT-510 C — the verdict classes (both/neither/unknown/student-scoped)", () => {
  it("matches BOTH references (an agreeing config) → the reconciled green row with the stated basis", () => {
    const report = run({
      parents: [makeParent({ id: "p-hamidi" })],
      students: [makeStudent({ id: "stu-2a3c", parentId: "p-hamidi", gradeLevel: "1ap" })],
      payments: [hamidiFiPayment({ id: "pay-ok", amount: 5_000 })],
      pricingConfig: { registrationFee: 5_000, registrationFeeByGrade: { "1ap": 5_000 } },
    });
    const f = findingById(report, "reconciled:price-fi-pay-ok:pay-ok");
    expect(norm(f.explanation)).toContain("correspond au tarif d'inscription configuré");
    expect(norm(f.explanation)).toContain("5 000 DZD");
  });

  it("matches NEITHER reference → the confirmed_mismatch configured-price violation", () => {
    const report = run({
      parents: [makeParent({ id: "p-hamidi" })],
      students: [makeStudent({ id: "stu-2a3c", parentId: "p-hamidi", gradeLevel: "1ap" })],
      payments: [hamidiFiPayment({ id: "pay-bad", amount: 77_777 })],
      pricingConfig: LIVE_CONFIG,
    });
    const f = findingById(report, "confirmed_mismatch:price-fi-pay-violation:pay-bad");
    expect(f.severity).toBe("warning");
    expect(norm(f.explanation)).toContain("AUCUN tarif configuré");
    expect((f.possibleCauses?.length ?? 0)).toBeGreaterThanOrEqual(2);
  });

  it("unknown student (no grade reference possible) → the unverified posture, never a violation claim", () => {
    const report = run({
      parents: [makeParent({ id: "p-hamidi" })],
      payments: [hamidiFiPayment({ id: "pay-noref", studentId: null })],
      pricingConfig: LIVE_CONFIG,
    });
    const f = findingById(report, "unverified:price-fi-pay-noref:pay-noref");
    expect(norm(f.explanation)).toContain("non vérifiable");
  });

  it("the family-level « nouvelle famille » registration charge conforming to the flat fee → reconciled (the MERSEL shape)", () => {
    const report = run({
      parents: [makeParent({ id: "p-mersel", code: "PAR-2026-FC78AF", firstName: "MERSEL", lastName: "MERSELFARes" })],
      ledgerEntries: [
        makeLedgerEntry({
          id: "led-fee",
          parentId: "p-mersel",
          studentId: null,
          category: "other",
          amount: 5_000,
          sourceType: "manual_entry",
          sourceId: "reg-PAR-2026-FC78AF-fee",
          description: "Frais d'inscription 2026 (nouvelle famille)",
          metadata: { type: "registration_fee" },
        }),
      ],
      pricingConfig: LIVE_CONFIG,
    });
    const f = findingById(report, "reconciled:price-fi-charge-ok:led-fee");
    expect(norm(f.explanation)).toContain("plat familial");
    expect(norm(f.explanation)).toContain("5 000 DZD");
  });

  it("a registration charge diverging from the flat fee → the outlier finding with the delta", () => {
    const report = run({
      parents: [makeParent({ id: "p-mersel" })],
      ledgerEntries: [
        makeLedgerEntry({
          id: "led-fee2",
          parentId: "p-mersel",
          studentId: null,
          category: "other",
          amount: 7_000,
          sourceType: "manual_entry",
          sourceId: "reg-PAR-1-fee",
          description: "Frais d'inscription 2026 (nouvelle famille)",
          metadata: { type: "registration_fee" },
        }),
      ],
      pricingConfig: LIVE_CONFIG,
    });
    const f = findingById(report, "outlier_review:price-fi-charge:led-fee2");
    expect(f.amount).toBe(2_000);
  });
});

/* ============================================================ */
/*  D. THE HONEST DEGRADATION — no catalog supplied             */
/* ============================================================ */

describe("T-529 / AUDIT-510 D — the honest degradation when no price catalog is supplied", () => {
  it("emits exactly ONE unverified coverage finding — never silent, never spam", () => {
    const report = run({
      parents: [makeParent({ id: "p-hamidi" })],
      students: [makeStudent({ id: "stu-1", parentId: "p-hamidi", gradeLevel: "1ap" })],
      payments: [hamidiFiPayment(), makePayment({ id: "pay-2", amount: 10_000 })],
      // NO pricingConfig
    });
    expect(report.coverage.pricingConfig).toBe(false);
    const coverageFindings = report.findings.filter((f) => f.id === "unverified:price-noconfig:catalog");
    expect(coverageFindings).toHaveLength(1);
    // and NOT one finding per payment:
    expect(report.findings.filter((f) => f.id.startsWith("outlier_review:price-fi-pay:"))).toHaveLength(0);
    expect(report.findings.filter((f) => f.id.startsWith("unverified:price-fi-pay-noref:"))).toHaveLength(0);
    expect(report.findings.find((f) => f.id === "outlier_review:price-config-tension:registration-fee")).toBeUndefined();
  });

  it("the other classes still run without a catalog (the pay-no-ledger class untouched)", () => {
    const report = run({
      parents: [makeParent({ id: "p-hamidi" })],
      payments: [makePayment({ id: "pay-nol", parentId: "p-hamidi", amount: 10_000 })],
    });
    expect(report.findings.find((f) => f.id === "confirmed_mismatch:pay-no-ledger:pay-nol")).toBeDefined();
  });

  it("with a catalog supplied, the coverage flag flips and no degradation finding appears", () => {
    const report = run({ pricingConfig: LIVE_CONFIG });
    expect(report.coverage.pricingConfig).toBe(true);
    expect(report.findings.find((f) => f.id === "unverified:price-noconfig:catalog")).toBeUndefined();
  });
});

/* ============================================================ */
/*  E. THE ALL-ORIGINS COVERAGE (AUDIT-509)                      */
/* ============================================================ */

describe("T-529 / AUDIT-509 E — the all-origins coverage: the identity-form census + the unchanged T-528 classes", () => {
  it("the coverage censuses every charge identity form present on the books", () => {
    const report = run({
      ledgerEntries: [
        makeLedgerEntry({ id: "led-a", sourceType: "installment", sourceId: "51925330-98e3-4890-9c71-235052d4477d", amount: 1_000 }),
        makeLedgerEntry({ id: "led-b", sourceType: "installment", sourceId: "reg-ELV-2026-XXX-t1", amount: 2_000 }),
        makeLedgerEntry({ id: "led-c", sourceType: "bulk_import", sourceId: "stu-1:DEVIS_ANNUEL", amount: 3_000 }),
        makeLedgerEntry({ id: "led-d", sourceType: "manual_entry", sourceId: "reg-PAR-1-fee", amount: 4_000 }),
        makeLedgerEntry({ id: "led-e", sourceType: "adjustment", sourceId: "whatever", amount: 5_000 }),
      ],
    });
    expect(report.coverage.chargeForms).toEqual({
      "installment-pk": 1,
      "installment-reg-identity": 1,
      "bulk-import-stem": 1,
      "manual-entry": 1,
      other: 1,
    });
  });

  it("the T-528 reg-identity resolution is UNCHANGED when a config is supplied (the manually-created family keeps its green row)", () => {
    const report = run({
      parents: [makeParent({ id: "p-mersel", code: "PAR-2026-FC78AF" })],
      students: [
        makeStudent({ id: "stu-omar", code: "ELV-2026-0CF277", parentId: "p-mersel", firstName: "Omar", lastName: "Khelifi", gradeLevel: "3eme_annee" }),
      ],
      installments: [
        makeInstallment({
          id: "98ed91e2-eaf4-4cae-baec-79f5b737cf8c",
          parentId: "p-mersel",
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
          parentId: "p-mersel",
          studentId: "stu-omar",
          category: "tuition",
          amount: 365_000,
          sourceType: "installment",
          sourceId: "reg-ELV-2026-0CF277-t1",
          description: "Scolarité 2026 — Tranche 1 (3eme_annee)",
          at: "2026-10-13T12:40:43.792Z",
        }),
      ],
      pricingConfig: LIVE_CONFIG,
    });
    // NOT dangling…
    expect(report.findings.find((f) => f.id === "confirmed_mismatch:charge-dangling:e8afa61f-3f75-4a18-bde1-40900f219057")).toBeUndefined();
    // …positively reconciled through the reg-identity (the green row the owner must see after the rebuild):
    const ok = findingById(report, "reconciled:charge-reg-resolved:e8afa61f-3f75-4a18-bde1-40900f219057");
    expect(ok.amount).toBe(365_000);
  });
});

/* ============================================================ */
/*  F. THE 7-POINT STRUCTURE — the possibleCauses dimension      */
/* ============================================================ */

describe("T-529 F — the owner's 7-point structure: the possibleCauses dimension", () => {
  it("the genuine dangling-charge finding (the owner's reported class) carries the causes dimension", () => {
    const report = run({
      ledgerEntries: [
        makeLedgerEntry({ id: "led-dangling", sourceType: "installment", sourceId: "reg-ELV-2026-UNKNOWN-t9", amount: 50_000 }),
      ],
      installments: [makeInstallment({ id: "ins-real", studentId: null })],
    });
    const f = findingById(report, "confirmed_mismatch:charge-dangling:led-dangling");
    expect((f.possibleCauses?.length ?? 0)).toBeGreaterThanOrEqual(2);
  });

  it("the same-student duplicate finding carries the causes dimension", () => {
    const report = run({
      parents: [makeParent({ id: "p-1" })],
      students: [makeStudent({ id: "s-1", parentId: "p-1" })],
      payments: [
        makePayment({ id: "pay-d1", parentId: "p-1", studentId: "s-1", amount: 25_000, receiptNumber: "REC-1", collectedAt: "2026-09-15" }),
        makePayment({ id: "pay-d2", parentId: "p-1", studentId: "s-1", amount: 25_000, receiptNumber: "REC-2", collectedAt: "2026-09-15" }),
      ],
    });
    const f = findingById(report, "duplicate_event:dup-tuple:pay-d1");
    expect((f.possibleCauses?.length ?? 0)).toBeGreaterThanOrEqual(2);
  });

  it("the FI encaissement divergence carries all seven dimensions (what/where/why/impact/evidence/causes/resolution)", () => {
    const report = run({
      parents: [makeParent({ id: "p-hamidi" })],
      students: [makeStudent({ id: "stu-2a3c", parentId: "p-hamidi", gradeLevel: "1ap" })],
      payments: [hamidiFiPayment()],
      pricingConfig: LIVE_CONFIG,
    });
    const f = findingById(report, "outlier_review:price-fi-pay:pay-fi-25000");
    // 1 what / 2 where / 3 why / 4 impact / 5 evidence / 6 causes / 7 resolution:
    expect(f.title.length).toBeGreaterThan(0); // 1
    expect(f.parentId).toBe("p-hamidi"); // 2
    expect(f.recordIds.payment).toBe("pay-fi-25000"); // 2
    expect(norm(f.explanation)).toContain("VIOLE"); // 3
    expect(f.amount).toBe(20_000); // 4
    expect(f.calculation).toBeTruthy(); // 4
    expect(f.evidence.length).toBeGreaterThanOrEqual(4); // 5
    expect((f.possibleCauses ?? []).length).toBeGreaterThanOrEqual(3); // 6
    expect(f.suggestedSteps.length).toBeGreaterThanOrEqual(2); // 7
  });
});

/* ============================================================ */
/*  G. THE CHARTER — read-only + deterministic                   */
/* ============================================================ */

describe("T-529 G — the read-only charter + determinism", () => {
  it("never mutates any input record (the frozen-copy pin, extended to the config)", () => {
    const payments = [hamidiFiPayment()];
    const entries = [
      makeLedgerEntry({ id: "led-fee", sourceType: "manual_entry", sourceId: "reg-PAR-1-fee", amount: 5_000, description: "Frais d'inscription 2026 (nouvelle famille)", metadata: { type: "registration_fee" } }),
    ];
    const config = { ...LIVE_CONFIG, registrationFeeByGrade: { ...LIVE_CONFIG.registrationFeeByGrade } };
    const snapshot = JSON.stringify({ payments, entries, config });
    run({ payments, ledgerEntries: entries, pricingConfig: config });
    expect(JSON.stringify({ payments, entries, config })).toBe(snapshot);
  });

  it("the audit is deterministic (the same inputs → the same report)", () => {
    const params = {
      parents: [makeParent({ id: "p-hamidi" })],
      students: [makeStudent({ id: "stu-1", parentId: "p-hamidi", gradeLevel: "1ap" })],
      payments: [hamidiFiPayment()],
      pricingConfig: LIVE_CONFIG,
    } as const;
    const r1 = run({ ...params });
    const r2 = run({ ...params });
    expect(r2.counts).toEqual(r1.counts);
    expect(r2.findings.length).toBe(r1.findings.length);
    expect(JSON.stringify(r2.findings.map((f) => f.id))).toBe(JSON.stringify(r1.findings.map((f) => f.id)));
  });

  it("the config-first price basis: a config whose tuition grid diverges from the matrix drives the expected annual", () => {
    const report = run({
      parents: [makeParent({ id: "p-1" })],
      students: [makeStudent({ id: "s-1", parentId: "p-1", gradeLevel: "1ap" })],
      installments: [
        makeInstallment({ id: "ins-t1", studentId: "s-1", category: "tuition", label: "Tranche 1", trancheNumber: 1, amountDue: 89_000 }),
        makeInstallment({ id: "ins-t2", studentId: "s-1", category: "tuition", label: "Tranche 2", trancheNumber: 2, amountDue: 65_500 }),
        makeInstallment({ id: "ins-t3", studentId: "s-1", category: "tuition", label: "Tranche 3", trancheNumber: 3, amountDue: 65_500 }),
      ],
      pricingConfig: {
        registrationFee: 5_000,
        registrationFeeByGrade: { "1ap": 25_000 },
        tuitionByGradeLevel: { "1ap": { annualAmount: 400_000, installments: [160_000, 120_000, 120_000] } },
      },
    });
    // The CONFIG's 400,000 drives the outlier math (not the matrix's 220,000 —
    // the multiplier-2 threshold means 220,000 vs 400,000 stays inside the
    // band; the reconciled price-ok row states the CONFIG's expected total).
    const ok = report.findings.find((f) => f.id === "reconciled:price-ok:s-1");
    expect(ok).toBeDefined();
    expect(norm(ok!.explanation)).toContain("400 000 DZD");
  });
});
