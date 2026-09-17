/**
 * T-389 (INSPECT-500) — the data-lineage inspection regression suite.
 *
 * Pins the DEFINITIONAL CONTRACT the repair established: every metric's
 * displayed sourceValue and the inspector's resolution share ONE
 * derivation, so `difference` can only be real data drift. Each test
 * reproduces one of the twelve registered defects and asserts the fixed
 * semantics:
 *
 *   1.  revenue boundary — [from, to) exclusive (the KPI convention)
 *   2.  revenue reconciliation — KPI-shaped sourceValue == resolvedValue
 *   3.  debt scoping — academic-year vs all-years; paid excluded; INV-4
 *   4.  aging-bucket filter — per-bucket resolution mirrors the aging card
 *   5.  attendance modes — records vs absences (no phantom "absent" status)
 *   6.  academic-risk — the injected canonical profiles (no second GPA)
 *   7.  discount — ledger remise entries (isRemiseAdjustment contract)
 *   8.  transport — transport installments with amounts + route attribution
 *   9.  top-10 colors — 10 distinct palette entries, rank-mapped, tail neutral
 *   10. multi-select filters — methods[] / categories[] applied
 *   11. structured lineage — category/categoryLabel/sourceTable/amountKind
 *   12. formula steps + intermediates present on every resolution
 */
import { describe, it, expect } from "vitest";
import {
  buildResolution,
  contributorColor,
  contributorColorByKey,
  INSPECTOR_CONTRIBUTOR_PALETTE,
  INSPECTOR_NEUTRAL_COLOR,
  type InspectRequest,
  type LineageInput,
} from "../../../features/dashboard/components/analytics/data-inspector-lineage";
import {
  deriveOutstandingDebt,
  inRange,
} from "../../../features/dashboard/components/analytics/analytics-derivations";
import { deriveDiscountErosion } from "../../../features/dashboard/components/analytics/executive-statistics";
import { agingBucketFromDays } from "../../../domain/calc/payment/queries";
import type { Installment, Payment } from "../../../domain/model/payment";
import type { LedgerEntry } from "../../../domain/model/ledger";
import type { Student } from "../../../domain/model/student";
import type { Parent } from "../../../domain/model/parent";
import type {
  AcademicClass,
  Assessment,
  AttendanceRecord,
} from "../../../domain/model/academic";
import type { StudentRiskProfile } from "../../../features/dashboard/components/analytics/operational-query-engine";

/* ============================================================ */
/*  Fixtures (live-shaped, the executive-statistics patterns)    */
/* ============================================================ */

const ACADEMIC_YEAR = "2025-2026";
const RANGE = { from: "2025-09-01", to: "2026-09-01" };

function makeInstallment(overrides: Partial<Installment> = {}): Installment {
  return {
    id: "ins-1",
    parentId: "p-1",
    studentId: "stu-1",
    category: "tuition",
    label: "Tranche 1",
    trancheNumber: 1,
    amountDue: 100_000,
    amountPaid: 0,
    amountPending: 0,
    dueDate: "2025-09-15",
    paidDate: null,
    status: "unpaid",
    academicCycle: "primaire",
    paymentPlan: "tranches",
    isCustomSchedule: false,
    customSchedule: false,
    customScheduleNote: null,
    ...overrides,
  };
}

function makeLedger(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: "led-1",
    tenantId: "tenant-1",
    accountId: "parent:p-1:category:tuition",
    parentId: "p-1",
    studentId: "stu-1",
    category: "tuition",
    amount: 0,
    type: "adjustment",
    sourceType: "bulk_import",
    sourceId: "run-1",
    method: null,
    receiptNumber: null,
    paymentStatus: null,
    reversesId: null,
    description: "",
    actorId: "system",
    actorName: "System",
    at: "2026-08-11T20:18:00.714Z",
    metadata: {},
    ...overrides,
  };
}

function makeStudent(overrides: Partial<Student> = {}): Student {
  return {
    id: "stu-1",
    tenantId: "tenant-1",
    code: "ELV-2025-000001",
    parentId: "p-1",
    firstName: "Sara",
    lastName: "BENALI",
    displayName: "BENALI Sara",
    gender: "female",
    birthDate: "2015-04-02",
    enrollmentDate: "2025-09-01",
    level: "primaire",
    gradeYear: 3,
    gradeLevel: "3ap",
    classId: null,
    photoUrl: null,
    medicalNotes: null,
    transportTier: null,
    status: "active",
    paymentPlan: "tranches",
    createdAt: "2025-09-01T00:00:00.000Z",
    updatedAt: "2025-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeParent(id: string, name: string): Parent {
  return {
    id,
    tenantId: "tenant-1",
    code: `PAR-2025-${id}`,
    firstName: "",
    lastName: name,
    displayName: name,
    phone: "0550000000",
    email: null,
    address: null,
    cityTier: null,
    authUserId: null,
    activationCode: null,
    status: "active",
    notes: null,
    createdAt: "2025-09-01T00:00:00.000Z",
    updatedAt: "2025-09-01T00:00:00.000Z",
  } as unknown as Parent;
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "pay-1",
    tenantId: "tenant-1",
    receiptNumber: "REC-2026-000001",
    parentId: "p-1",
    studentId: "stu-1",
    amount: 10_000,
    method: "cash",
    status: "paid",
    category: "tuition",
    installmentId: null,
    proofUrl: null,
    notes: null,
    collectedBy: "usr-cashier",
    collectedAt: "2025-10-01T10:00:00.000Z",
    createdAt: "2025-10-01T10:00:00.000Z",
    updatedAt: "2025-10-01T10:00:00.000Z",
    ...overrides,
  };
}

function makeAssessment(overrides: Partial<Assessment> = {}): Assessment {
  return {
    id: "asm-1",
    studentId: "stu-1",
    classId: "cls-1",
    subjectId: "sub-math",
    term: "T1",
    academicYear: ACADEMIC_YEAR,
    devoir1: 10,
    devoir2: 10,
    examen: 10,
    cc: null,
    subjectAverage: 10,
    coefficient: 2,
    coefficientDevoir1: 1,
    coefficientDevoir2: 1,
    coefficientExamen: 2,
    coefficientCc: 0,
    enteredBy: "usr-teacher",
    enteredAt: "2025-11-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeAttendance(overrides: Partial<AttendanceRecord> = {}): AttendanceRecord {
  return {
    id: "att-1",
    studentId: "stu-1",
    classId: "cls-1",
    date: "2025-11-10",
    session: "morning",
    status: "present",
    justificationId: null,
    recordedBy: "usr-teacher",
    recordedAt: "2025-11-10T08:00:00.000Z",
    ...overrides,
  } as unknown as AttendanceRecord;
}

function makeRiskProfile(overrides: Partial<StudentRiskProfile> = {}): StudentRiskProfile {
  return {
    studentId: "stu-1",
    studentName: "BENALI Sara",
    studentCode: "ELV-2025-000001",
    classId: "cls-1",
    className: "1ère Année Primaire",
    level: "primaire",
    gradeLevel: "3ap",
    parentId: "p-1",
    parentName: "BENALI Famille",
    parentPhone: "0550000000",
    gpa: 8.5,
    isPassing: false,
    attendanceRate: 1,
    unexcusedAbsences: 0,
    debtAmount: 0,
    daysOverdue: 0,
    riskScore: 40,
    riskCategory: "academic_alert",
    primaryRiskReason: "Moyenne 8.50/20 (< 10)",
    ...overrides,
  };
}

function makeInput(overrides: Partial<LineageInput> = {}): LineageInput {
  return {
    students: [],
    parents: [],
    classes: [],
    assessments: [],
    attendance: [],
    payments: [],
    installments: [],
    debts: [],
    ledger: [],
    academicYear: ACADEMIC_YEAR,
    range: RANGE,
    ...overrides,
  };
}

/* ============================================================ */
/*  1 — the revenue boundary (defect #1)                        */
/* ============================================================ */

describe("T-389 — revenue boundary [from, to) (INSPECT-500 defect 1)", () => {
  it("a payment collected ON the to-date is EXCLUDED (the KPI/.lt convention)", () => {
    const boundary = makePayment({ id: "pay-boundary", collectedAt: "2026-09-01T08:00:00.000Z" });
    expect(inRange(boundary, RANGE)).toBe(false);
    const resolved = buildResolution(
      { domain: "revenue", title: "Revenus", sourceValue: 0 },
      makeInput({ payments: [boundary] }),
    );
    expect(resolved.resolvedValue).toBe(0);
    expect(resolved.records).toHaveLength(0);
  });

  it("a payment collected the day BEFORE the to-date is included", () => {
    const inside = makePayment({ id: "pay-inside", collectedAt: "2026-08-31T23:00:00.000Z" });
    expect(inRange(inside, RANGE)).toBe(true);
  });

  it("pending (uncleared) payments are excluded from revenue", () => {
    const pending = makePayment({ id: "pay-pending", status: "pending", method: "check" });
    const resolved = buildResolution(
      { domain: "revenue", title: "Revenus", sourceValue: 0 },
      makeInput({ payments: [pending] }),
    );
    expect(resolved.resolvedValue).toBe(0);
  });
});

/* ============================================================ */
/*  2 — revenue reconciliation (defects 1+10)                    */
/* ============================================================ */

describe("T-389 — revenue reconciliation + multi-select filters (INSPECT-500 defects 1, 10)", () => {
  const payments = [
    makePayment({ id: "pay-a", amount: 20_000, category: "tuition", method: "cash", collectedAt: "2025-10-01T10:00:00.000Z" }),
    makePayment({ id: "pay-b", amount: 15_000, category: "transport", method: "transfer", collectedAt: "2025-11-01T10:00:00.000Z" }),
    makePayment({ id: "pay-c", amount: 5_000, category: "canteen", method: "cash", collectedAt: "2025-12-01T10:00:00.000Z" }),
    makePayment({ id: "pay-out", amount: 99_000, collectedAt: "2026-09-15T10:00:00.000Z" }),
  ];

  it("the KPI-shaped sourceValue (Σ paid in window) reconciles EXACTLY with the resolution", () => {
    const sourceValue = payments
      .filter((p) => p.status === "paid" && inRange(p, RANGE))
      .reduce((s, p) => s + p.amount, 0);
    const resolved = buildResolution(
      { domain: "revenue", title: "Revenus", sourceValue },
      makeInput({ payments }),
    );
    expect(resolved.resolvedValue).toBe(sourceValue);
    expect(resolved.difference).toBe(0);
  });

  it("multi-select methods[] filter is applied (TWO methods selected — the old single-method filter dropped them)", () => {
    const resolved = buildResolution(
      {
        domain: "revenue",
        title: "Encaissements filtrés",
        sourceValue: 40_000,
        filters: { from: RANGE.from, to: RANGE.to, methods: ["cash", "transfer"] },
      },
      makeInput({ payments }),
    );
    // cash: pay-a (20 000) + pay-c (5 000); transfer: pay-b (15 000) → 40 000.
    expect(resolved.resolvedValue).toBe(40_000);
    expect(resolved.records.every((r) => r.method !== "Chèque")).toBe(true);
  });

  it("multi-select categories[] filter is applied", () => {
    const resolved = buildResolution(
      {
        domain: "service",
        title: "Services",
        sourceValue: 5_000,
        filters: { from: RANGE.from, to: RANGE.to, categories: ["canteen"] },
      },
      makeInput({ payments }),
    );
    expect(resolved.resolvedValue).toBe(5_000);
    expect(resolved.records).toHaveLength(1);
    expect(resolved.records[0].category).toBe("canteen");
  });
});

/* ============================================================ */
/*  3 — debt scoping + INV-4 (defects 2)                         */
/* ============================================================ */

describe("T-389 — debt scoping (INSPECT-500 defect 2)", () => {
  const installments = [
    makeInstallment({ id: "ins-year", amountDue: 100_000, dueDate: "2025-11-15" }),
    makeInstallment({ id: "ins-prev-year", amountDue: 50_000, dueDate: "2024-11-15" }),
    makeInstallment({ id: "ins-paid", amountDue: 80_000, amountPaid: 80_000, status: "paid", paidDate: "2025-12-01" }),
    makeInstallment({ id: "ins-pending", amountDue: 60_000, amountPaid: 10_000, amountPending: 20_000, dueDate: "2025-12-15" }),
  ];

  it("academic-year scope: previous-year arrears are EXCLUDED, paid EXCLUDED, INV-4 remaining honoured", () => {
    const resolved = buildResolution(
      { domain: "debt", title: "Créances 2025-2026", sourceValue: 130_000, filters: { scope: "academic-year" } },
      makeInput({ installments }),
    );
    // ins-year: 100 000 + ins-pending: max(0, 60 000 − 10 000 − 20 000) = 30 000
    expect(resolved.resolvedValue).toBe(130_000);
    expect(resolved.records.map((r) => r.id).sort()).toEqual(["ins-pending", "ins-year"]);
    expect(resolved.difference).toBe(0);
  });

  it("all-years scope: previous-year arrears are INCLUDED (the Pareto/debt-summaries semantics)", () => {
    const resolved = buildResolution(
      { domain: "debt", title: "Pareto", sourceValue: 180_000, filters: { scope: "all" } },
      makeInput({ installments }),
    );
    expect(resolved.resolvedValue).toBe(180_000);
  });

  it("deriveOutstandingDebt (the shared derivation) equals the resolution in BOTH scopes", () => {
    expect(deriveOutstandingDebt(installments, ACADEMIC_YEAR)).toBe(130_000);
    expect(deriveOutstandingDebt(installments, null)).toBe(180_000);
  });

  it("the debt intermediates expose Σ amountDue / Σ amountPaid / Σ amountPending", () => {
    const resolved = buildResolution(
      { domain: "debt", title: "Créances", sourceValue: 130_000, filters: { scope: "academic-year" } },
      makeInput({ installments }),
    );
    const labels = resolved.intermediates.map((i) => i.label);
    expect(labels).toContain("Σ amountDue");
    expect(labels).toContain("Σ amountPaid");
    expect(labels).toContain("Σ amountPending");
  });
});

/* ============================================================ */
/*  4 — the aging-bucket filter (defect 3)                       */
/* ============================================================ */

describe("T-389 — aging-bucket filter (INSPECT-500 defect 3)", () => {
  it("per-bucket resolutions partition the total using the aging-card computation", () => {
    const now = Date.now();
    const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString().slice(0, 10);
    const installments = [
      makeInstallment({ id: "ins-fresh", amountDue: 10_000, dueDate: daysAgo(5) }),
      makeInstallment({ id: "ins-mid", amountDue: 20_000, dueDate: daysAgo(45) }),
      makeInstallment({ id: "ins-old", amountDue: 40_000, dueDate: daysAgo(200) }),
    ];
    // scope "all" isolates the BUCKET math from the year window (the
    // bucket boundaries are Date.now()-relative either way).
    const total = deriveOutstandingDebt(installments, null);
    const buckets = (["0_30", "31_60", "91_180", "180_plus"] as const).map((bucket) =>
      buildResolution(
        { domain: "debt", title: bucket, sourceValue: 0, filters: { agingBucket: bucket, scope: "all" } },
        makeInput({ installments }),
      ).resolvedValue,
    );
    // The bucket computation mirrors debtByAgingForRange (agingBucketFromDays).
    expect(buckets[0]).toBe(10_000); // 5 days → 0_30
    expect(buckets[1]).toBe(20_000); // 45 days → 31_60
    expect(buckets[2]).toBe(0); // nothing in 91_180
    expect(buckets[3]).toBe(40_000); // 200 days → 180_plus
    expect(buckets.reduce((s, b) => s + b, 0)).toBe(total);
    expect(agingBucketFromDays(-3)).toBe("0_30"); // not-yet-due lands in 0_30 (mirrored semantics)
  });
});

/* ============================================================ */
/*  5 — attendance modes (defect 5)                              */
/* ============================================================ */

describe("T-389 — attendance modes (INSPECT-500 defect 5)", () => {
  const attendance = [
    makeAttendance({ id: "att-1", status: "present" }),
    makeAttendance({ id: "att-2", status: "late" }),
    makeAttendance({ id: "att-3", status: "absent_excused" }),
    makeAttendance({ id: "att-4", status: "absent_unexcused" }),
  ];
  const students = [makeStudent()];
  const input = makeInput({ attendance, students });

  it("records mode counts EVERY record (reconciles with sourceValue = stream length)", () => {
    const resolved = buildResolution(
      { domain: "attendance", title: "Présences", sourceValue: 4, filters: { attendanceMode: "records" } },
      input,
    );
    expect(resolved.resolvedValue).toBe(4);
    expect(resolved.difference).toBe(0);
  });

  it("absences mode counts ONLY absent_excused + absent_unexcused (no phantom \"absent\" status)", () => {
    const resolved = buildResolution(
      { domain: "attendance", title: "Absences", sourceValue: 2, filters: { attendanceMode: "absences" } },
      input,
    );
    expect(resolved.resolvedValue).toBe(2);
    expect(resolved.records.map((r) => r.status).sort()).toEqual(["absent_excused", "absent_unexcused"]);
  });
});

/* ============================================================ */
/*  6 — academic-risk uses the injected canonical profiles (defect 4) */
/* ============================================================ */

describe("T-389 — academic-risk consumes the canonical profiles (INSPECT-500 defect 4)", () => {
  it("the resolution counts EXACTLY the injected profiles with gpa < 10 — no re-derived average", () => {
    const profiles = [
      makeRiskProfile({ studentId: "stu-1", gpa: 8.5 }),
      makeRiskProfile({ studentId: "stu-2", gpa: 9.99 }),
      makeRiskProfile({ studentId: "stu-3", gpa: 10 }),
      makeRiskProfile({ studentId: "stu-4", gpa: 15 }),
      makeRiskProfile({ studentId: "stu-5", gpa: null }),
    ];
    const resolved = buildResolution(
      { domain: "academic-risk", title: "Risque", sourceValue: 2 },
      makeInput({ riskProfiles: profiles }),
    );
    expect(resolved.resolvedValue).toBe(2);
    expect(resolved.records.map((r) => r.id).sort()).toEqual(["stu-1", "stu-2"]);
    expect(resolved.records.every((r) => r.sourceTable === "assessments")).toBe(true);
  });

  it("a coefficient-weighted GPA below 10 is caught even when the naive mean is above (the parallel-implementation trap)", () => {
    // stu-x: subjects 8 (coef 4) and 14 (coef 1) → canonical GPA = (8*4+14)/5 = 9.2 < 10
    // but the naive unweighted mean = 11 ≥ 10 (the OLD resolution missed it).
    const profiles = [makeRiskProfile({ studentId: "stu-x", gpa: 9.2 })];
    const resolved = buildResolution(
      { domain: "academic-risk", title: "Risque", sourceValue: 1 },
      makeInput({ riskProfiles: profiles }),
    );
    expect(resolved.resolvedValue).toBe(1);
  });
});

/* ============================================================ */
/*  7 — discount from the ledger (defect 6)                      */
/* ============================================================ */

describe("T-389 — discount lineage from ledger adjustments (INSPECT-500 defect 6)", () => {
  const ledger = [
    makeLedger({ id: "led-remise-1", amount: -5_000, metadata: { field: "REMISE" }, description: "Remise sur devis" }),
    makeLedger({ id: "led-remise-2", amount: -3_000, parentId: "p-2", studentId: null, metadata: { field: "REMISE" }, description: "Remise sur devis" }),
    makeLedger({ id: "led-cancel", amount: 2_000, metadata: { reason: "double_remise_cancel" }, description: "Annulation double remise" }),
    makeLedger({ id: "led-charge", amount: 50_000, type: "charge", description: "Tranche 1" }),
    makeLedger({ id: "led-other-adj", amount: -1_000, description: "Autre ajustement" }),
  ];
  const parents = [makeParent("p-1", "BENALI"), makeParent("p-2", "HEBBAZ")];

  it("the resolution counts ONLY remise credits (the isRemiseAdjustment contract) and reconciles with deriveDiscountErosion", () => {
    const sourceValue = deriveDiscountErosion(ledger).remiseTotal;
    const resolved = buildResolution(
      { domain: "discount", title: "Remises", sourceValue },
      makeInput({ ledger, parents }),
    );
    expect(sourceValue).toBe(8_000);
    expect(resolved.resolvedValue).toBe(8_000);
    expect(resolved.difference).toBe(0);
    expect(resolved.records.map((r) => r.id).sort()).toEqual(["led-remise-1", "led-remise-2"]);
    expect(resolved.records.every((r) => r.sourceTable === "ledger_entries")).toBe(true);
    expect(resolved.records.every((r) => r.amountKind === "adjustment-credit")).toBe(true);
  });
});

/* ============================================================ */
/*  8 — transport amounts (defect 8)                             */
/* ============================================================ */

describe("T-389 — transport lineage with amounts + routes (INSPECT-500 defect 8)", () => {
  const students = [
    makeStudent({ id: "stu-1", transportTier: "BOUMERDES" }),
    makeStudent({ id: "stu-2", parentId: "p-2", transportTier: "OULED MOUSSA" }),
  ];
  const installments = [
    makeInstallment({ id: "ins-t1", category: "transport", amountDue: 30_000, amountPaid: 10_000, dueDate: "2025-10-15", label: "Tranche 1 Transport" }),
    makeInstallment({ id: "ins-t2", parentId: "p-2", studentId: "stu-2", category: "transport", amountDue: 24_000, dueDate: "2025-10-15" }),
    makeInstallment({ id: "ins-tuition", category: "tuition", amountDue: 100_000, dueDate: "2025-10-15" }),
  ];
  const parents = [makeParent("p-1", "BENALI"), makeParent("p-2", "HEBBAZ")];

  it("remaining mode: transport installments ONLY, INV-4 amounts, category transport, route attributed", () => {
    const sourceValue = deriveOutstandingDebt(installments.filter((i) => i.category === "transport"), ACADEMIC_YEAR);
    const resolved = buildResolution(
      { domain: "transport", title: "Transport", sourceValue, filters: { transportMode: "remaining" } },
      makeInput({ installments, students, parents }),
    );
    expect(sourceValue).toBe(44_000); // 20 000 + 24 000
    expect(resolved.resolvedValue).toBe(44_000);
    expect(resolved.difference).toBe(0);
    expect(resolved.records.every((r) => r.category === "transport")).toBe(true);
    expect(resolved.records.every((r) => r.categoryLabel === "Transport")).toBe(true);
    const rowP1 = resolved.records.find((r) => r.contributorKey === "p-1");
    expect(rowP1?.method).toBe("boumerdes"); // the normalized route key
    expect(rowP1?.detail).toContain("Transport");
  });

  it("due mode counts invoiced amounts; collected mode counts cleared funds", () => {
    const due = buildResolution(
      { domain: "transport", title: "T", sourceValue: 54_000, filters: { transportMode: "due" } },
      makeInput({ installments, students, parents }),
    );
    expect(due.resolvedValue).toBe(54_000);
    const collected = buildResolution(
      { domain: "transport", title: "T", sourceValue: 10_000, filters: { transportMode: "collected" } },
      makeInput({ installments, students, parents }),
    );
    expect(collected.resolvedValue).toBe(10_000);
  });

  it("the destination filter narrows to one route", () => {
    const resolved = buildResolution(
      { domain: "transport", title: "T", sourceValue: 20_000, filters: { transportMode: "remaining", transportDestination: "boumerdes" } },
      makeInput({ installments, students, parents }),
    );
    expect(resolved.resolvedValue).toBe(20_000);
    expect(resolved.records).toHaveLength(1);
  });
});

/* ============================================================ */
/*  9 — the top-10 contributor color system (defect 11)          */
/* ============================================================ */

describe("T-389 — top-10 contributor colors (INSPECT-500 defect 11)", () => {
  it("the palette carries TEN pairwise-DISTINCT colors", () => {
    expect(INSPECTOR_CONTRIBUTOR_PALETTE).toHaveLength(10);
    expect(new Set(INSPECTOR_CONTRIBUTOR_PALETTE).size).toBe(10);
    for (const color of INSPECTOR_CONTRIBUTOR_PALETTE) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("contributorColor maps ranks 0..9 to the palette and the tail to neutral", () => {
    for (let rank = 0; rank < 10; rank++) {
      expect(contributorColor(rank)).toBe(INSPECTOR_CONTRIBUTOR_PALETTE[rank]);
    }
    expect(contributorColor(10)).toBe(INSPECTOR_NEUTRAL_COLOR);
    expect(contributorColor(999)).toBe(INSPECTOR_NEUTRAL_COLOR);
  });

  it("contributors are rank-ordered by amount desc and colors follow the rank", () => {
    const payments = Array.from({ length: 12 }, (_, i) =>
      makePayment({ id: `pay-${i}`, parentId: `p-${i}`, amount: (i + 1) * 1_000 }),
    );
    const parents = Array.from({ length: 12 }, (_, i) => makeParent(`p-${i}`, `Famille ${i}`));
    const resolved = buildResolution(
      { domain: "revenue", title: "R", sourceValue: 78_000 },
      makeInput({ payments, parents }),
    );
    expect(resolved.contributors).toHaveLength(12);
    expect(resolved.contributors[0].key).toBe("p-11"); // the largest amount first
    expect(contributorColorByKey(resolved.contributors, resolved.contributors[0].key)).toBe(INSPECTOR_CONTRIBUTOR_PALETTE[0]);
    expect(contributorColorByKey(resolved.contributors, resolved.contributors[9].key)).toBe(INSPECTOR_CONTRIBUTOR_PALETTE[9]);
    expect(contributorColorByKey(resolved.contributors, resolved.contributors[10].key)).toBe(INSPECTOR_NEUTRAL_COLOR);
    expect(resolved.remainderCount).toBe(2);
    expect(resolved.remainderAmount).toBe(1_000 + 2_000);
  });
});

/* ============================================================ */
/*  10 — structured lineage on every record (defect 7)           */
/* ============================================================ */

describe("T-389 — structured lineage semantics (INSPECT-500 defect 7)", () => {
  it("payment rows carry their financial CATEGORY — tuition vs transport are distinguishable", () => {
    const payments = [
      makePayment({ id: "pay-tui", category: "tuition", amount: 20_000 }),
      makePayment({ id: "pay-tra", category: "transport", amount: 5_000 }),
    ];
    const resolved = buildResolution(
      { domain: "revenue", title: "R", sourceValue: 25_000 },
      makeInput({ payments }),
    );
    const tuition = resolved.records.find((r) => r.id === "pay-tui");
    const transport = resolved.records.find((r) => r.id === "pay-tra");
    expect(tuition?.categoryLabel).toBe("Scolarité");
    expect(transport?.categoryLabel).toBe("Transport");
    expect(tuition?.sourceTable).toBe("payments");
    expect(transport?.sourceTable).toBe("payments");
    expect(tuition?.amountKind).toBe("payment-received");
    expect(tuition?.detail).toContain("Scolarité");
  });

  it("installment rows trace to the installments table with their category", () => {
    const installments = [makeInstallment({ id: "ins-x", category: "transport", label: "Tranche 2 Transport" })];
    const resolved = buildResolution(
      { domain: "debt", title: "D", sourceValue: 100_000, filters: { scope: "academic-year" } },
      makeInput({ installments }),
    );
    expect(resolved.records[0].sourceTable).toBe("installments");
    expect(resolved.records[0].categoryLabel).toBe("Transport");
    expect(resolved.records[0].amountKind).toBe("installment-remaining");
    expect(resolved.records[0].detail).toContain("Tranche 2 Transport");
  });

  it("enrollment rows trace to the students table", () => {
    const resolved = buildResolution(
      { domain: "enrollment", title: "E", sourceValue: 1 },
      makeInput({ students: [makeStudent()], parents: [makeParent("p-1", "BENALI")] }),
    );
    expect(resolved.records[0].sourceTable).toBe("students");
    expect(resolved.records[0].amountKind).toBe("unit-count");
  });
});

/* ============================================================ */
/*  11 — formula steps + intermediates everywhere (defect 12)    */
/* ============================================================ */

describe("T-389 — formula steps and intermediates (INSPECT-500 defect 12)", () => {
  const cases: Array<{ request: InspectRequest; input: LineageInput }> = [
    {
      request: { domain: "revenue", title: "R", sourceValue: 10_000 },
      input: makeInput({ payments: [makePayment()] }),
    },
    {
      request: { domain: "debt", title: "D", sourceValue: 100_000, filters: { scope: "academic-year" } },
      input: makeInput({ installments: [makeInstallment()] }),
    },
    {
      request: { domain: "tranche", title: "T1", sourceValue: 100_000, filters: { trancheNumber: 1 } },
      input: makeInput({ installments: [makeInstallment()] }),
    },
    {
      request: { domain: "enrollment", title: "E", sourceValue: 1 },
      input: makeInput({ students: [makeStudent()], parents: [makeParent("p-1", "B")] }),
    },
    {
      request: { domain: "attendance", title: "A", sourceValue: 1, filters: { attendanceMode: "records" } },
      input: makeInput({ students: [makeStudent()], attendance: [makeAttendance()] }),
    },
    {
      request: { domain: "academic-risk", title: "AR", sourceValue: 1 },
      input: makeInput({ riskProfiles: [makeRiskProfile()] }),
    },
    {
      request: { domain: "transport", title: "T", sourceValue: 0, filters: { transportMode: "remaining" } },
      input: makeInput({ installments: [], students: [makeStudent({ transportTier: "BOUMERDES" })] }),
    },
    {
      request: { domain: "discount", title: "Rem", sourceValue: 0 },
      input: makeInput({ ledger: [] }),
    },
  ];

  it.each(cases)("«%s» exposes a definition, steps, intermediates, scope and window", ({ request, input }) => {
    const resolved = buildResolution(request, input);
    expect(resolved.definition.length).toBeGreaterThan(20);
    expect(resolved.formulaSteps.length).toBeGreaterThanOrEqual(2);
    expect(resolved.intermediates.length).toBeGreaterThanOrEqual(1);
    expect(resolved.scopeLabel.length).toBeGreaterThan(0);
    expect(resolved.windowLabel).toBe("[2025-09-01 → 2026-09-01)");
    expect(resolved.sourceCounts.ledgerEntries).toBe(0);
  });
});

/* ============================================================ */
/*  12 — tranche domain (previously dead — now reachable)        */
/* ============================================================ */

describe("T-389 — tranche domain (INSPECT-500 defect 9)", () => {
  it("filters by trancheNumber and honours the collected mode", () => {
    const installments = [
      makeInstallment({ id: "ins-t1", trancheNumber: 1, amountDue: 40_000, amountPaid: 25_000 }),
      makeInstallment({ id: "ins-t2", trancheNumber: 2, amountDue: 40_000, dueDate: "2025-12-15" }),
      makeInstallment({ id: "ins-t3", trancheNumber: 3, amountDue: 40_000, dueDate: "2026-03-15" }),
    ];
    const remaining = buildResolution(
      { domain: "tranche", title: "Vague 1", sourceValue: 15_000, filters: { trancheNumber: 1, mode: "remaining" } },
      makeInput({ installments }),
    );
    expect(remaining.resolvedValue).toBe(15_000);
    expect(remaining.records).toHaveLength(1);

    const collected = buildResolution(
      { domain: "tranche", title: "Vague 1", sourceValue: 25_000, filters: { trancheNumber: 1, mode: "collected" } },
      makeInput({ installments }),
    );
    expect(collected.resolvedValue).toBe(25_000);
    expect(collected.records[0].amountKind).toBe("installment-collected");
  });
});
