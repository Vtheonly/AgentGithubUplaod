/**
 * Unit tests for the canonical executive-statistics derivations (T-338,
 * 61st session — STATS-400). The fixtures model the LIVE production shapes
 * discovered during the session's DB exploration (2026-09-14):
 *
 *   - installments carry `tranche_number` 1/2/3 with tuition labels
 *     "INSCRIPTION (FI)" / "2EME TRANCHE (V2)" / "3ème TRANCHE (2V)";
 *   - the remise markers are STRUCTURED metadata: negative adjustments
 *     with `metadata.field === "REMISE"` and the reconciliation-0063
 *     cancels with `metadata.reason === "double_remise_cancel"`;
 *   - `students.transport_tier` holds messy town spellings
 *     ("BOUMERDES", "BOUMRDES", "OULED MOUSSA", …);
 *   - families: 167×1 / 63×2 / 23×3 / 6×4 / 1×5 children (391/261);
 *   - grades with multiple sections (CP 51 vs 1AP 3 — same academic level).
 *
 * Every test pins the EXACT expected integer values (no approximations)
 * so the Android mirror can be held to the same corpus.
 */
import { describe, it, expect } from "vitest";
import {
  daysBetweenFloor,
  installmentRemaining,
  sharePct,
  deriveTrancheWaves,
  deriveDiscountErosion,
  deriveDebtTriage,
  deriveFamilyConcentration,
  deriveTransportYield,
  deriveServiceYield,
  deriveEnrollmentDynamics,
  deriveTripleRiskSummary,
} from "../../../features/dashboard/components/analytics/executive-statistics";
import { normalizeTransportTier } from "../../../domain/calc/pricing/transport";
import type { Installment, Payment } from "../../../domain/model/payment";
import type { LedgerEntry } from "../../../domain/model/ledger";
import type { Student } from "../../../domain/model/student";
import type { Parent } from "../../../domain/model/parent";
import type { AcademicClass } from "../../../domain/model/academic";
import type { StudentRiskProfile } from "../../../features/dashboard/components/analytics/operational-query-engine";

/* ============================================================ */
/*  Fixtures (live-shaped)                                       */
/* ============================================================ */

const NOW = Date.parse("2026-09-14T12:00:00Z");

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

function makeClass(overrides: Partial<AcademicClass> = {}): AcademicClass {
  return {
    id: "cls-1",
    tenantId: "tenant-1",
    academicYearId: "ay-1",
    academicLevelId: "lvl-1ap",
    code: "CLS-1AP",
    name: "1ère Année Primaire",
    gradeCode: "1ap",
    level: "primaire",
    gradeYear: 1,
    section: "A",
    room: null,
    capacity: null,
    enrolledCount: 3,
    homeroomTeacherId: null,
    homeroomTeacherName: null,
    notes: null,
    academicYear: "2026-2027",
    isActive: true,
    ...overrides,
  };
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
    category: "therapy_psychology",
    installmentId: null,
    proofUrl: null,
    notes: null,
    collectedBy: "usr-cashier",
    collectedAt: "2026-09-01T10:00:00.000Z",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    ...overrides,
  };
}

/* ============================================================ */
/*  Helpers                                                      */
/* ============================================================ */

describe("T-338 — shared helpers", () => {
  it("daysBetweenFloor: a tranche due today is 0 days overdue, never 1", () => {
    expect(daysBetweenFloor("2026-09-14", NOW)).toBe(0);
  });
  it("daysBetweenFloor: floors partial days (due yesterday 13:00 vs now 12:00 → 0)", () => {
    expect(daysBetweenFloor("2026-09-13T13:00:00Z", NOW)).toBe(0);
  });
  it("daysBetweenFloor: 45 days late boundary is exact", () => {
    expect(daysBetweenFloor("2026-07-31", NOW)).toBe(45);
    expect(daysBetweenFloor("2026-07-30", NOW)).toBe(46);
  });
  it("installmentRemaining: INV-4 — uncleared pending funds count as covered-but-uncleared", () => {
    expect(installmentRemaining({ amountDue: 100_000, amountPaid: 40_000, amountPending: 30_000, status: "partial" })).toBe(30_000);
  });
  it("installmentRemaining: paid installments are 0 even with rounding dust", () => {
    expect(installmentRemaining({ amountDue: 100_000, amountPaid: 99_999, amountPending: 5, status: "paid" })).toBe(0);
  });
  it("installmentRemaining: clamps overpayment to 0", () => {
    expect(installmentRemaining({ amountDue: 100_000, amountPaid: 120_000, amountPending: 0, status: "unpaid" })).toBe(0);
  });
  it("sharePct: round-half-up convention (PARITY-001 — never integer division)", () => {
    expect(sharePct(1, 3)).toBe(33);
    expect(sharePct(2, 3)).toBe(67);
    expect(sharePct(90_000, 700_000)).toBe(13); // the pinned corpus vector
    expect(sharePct(5, 0)).toBe(0);
  });
});

/* ============================================================ */
/*  1. Tranche-wave collection velocity                          */
/* ============================================================ */

describe("T-338 — deriveTrancheWaves", () => {
  // Live-shaped: FI (T1) 390 rows 243 paid; T2/T3 partially collected;
  // transport waves fully collected. Scaled to a small corpus.
  const installments: Installment[] = [
    // T1 tuition: 3 billed, 2 paid
    makeInstallment({ id: "t1-a", parentId: "p-1", trancheNumber: 1, label: "INSCRIPTION (FI)", amountDue: 100_000, amountPaid: 100_000, status: "paid", dueDate: "2025-09-15" }),
    makeInstallment({ id: "t1-b", parentId: "p-2", trancheNumber: 1, label: "INSCRIPTION (FI)", amountDue: 110_000, amountPaid: 110_000, status: "paid", dueDate: "2025-09-15" }),
    makeInstallment({ id: "t1-c", parentId: "p-3", trancheNumber: 1, label: "INSCRIPTION (FI)", amountDue: 120_000, amountPaid: 60_000, status: "partial", dueDate: "2025-09-15" }),
    // T2 tuition: 3 billed, 1 paid
    makeInstallment({ id: "t2-a", parentId: "p-1", trancheNumber: 2, label: "2EME TRANCHE (V2)", amountDue: 80_000, amountPaid: 80_000, status: "paid", dueDate: "2025-12-15" }),
    makeInstallment({ id: "t2-b", parentId: "p-2", trancheNumber: 2, label: "2EME TRANCHE (V2)", amountDue: 80_000, amountPaid: 0, status: "unpaid", dueDate: "2025-12-15" }),
    makeInstallment({ id: "t2-c", parentId: "p-3", trancheNumber: 2, label: "2EME TRANCHE (V2)", amountDue: 80_000, amountPaid: 0, status: "unpaid", dueDate: "2025-12-15" }),
    // T3 tuition: 3 billed, 0 paid
    makeInstallment({ id: "t3-a", parentId: "p-1", trancheNumber: 3, label: "3ème TRANCHE (2V)", amountDue: 80_000, amountPaid: 0, status: "unpaid", dueDate: "2026-03-15" }),
    makeInstallment({ id: "t3-b", parentId: "p-2", trancheNumber: 3, label: "3ème TRANCHE (2V)", amountDue: 80_000, amountPaid: 0, status: "unpaid", dueDate: "2026-03-15" }),
    makeInstallment({ id: "t3-c", parentId: "p-3", trancheNumber: 3, label: "3ème TRANCHE (2V)", amountDue: 80_000, amountPaid: 0, status: "unpaid", dueDate: "2026-03-15" }),
    // Transport waves: 2 billed, both paid
    makeInstallment({ id: "tr-1", parentId: "p-1", category: "transport", trancheNumber: 1, label: "Tranche 1 — Transport", amountDue: 20_000, amountPaid: 20_000, status: "paid", dueDate: "2025-09-15" }),
    makeInstallment({ id: "tr-2", parentId: "p-2", category: "transport", trancheNumber: 2, label: "Tranche 2 — Transport", amountDue: 10_000, amountPaid: 10_000, status: "paid", dueDate: "2025-12-15" }),
  ];

  const waves = deriveTrancheWaves(installments, NOW);

  it("groups by (category, tranche_number) — never by label parsing", () => {
    expect(waves.map((w) => `${w.category}#${w.wave}`)).toEqual([
      "tuition#1", "tuition#2", "tuition#3", "transport#1", "transport#2",
    ]);
  });

  it("T1 tuition: exact billed/collected/remaining + value-based rate", () => {
    const t1 = waves[0];
    expect(t1.installmentCount).toBe(3);
    expect(t1.paidCount).toBe(2);
    expect(t1.familyCount).toBe(3);
    expect(t1.debtorFamilyCount).toBe(1); // p-3 partial
    expect(t1.dueTotal).toBe(330_000);
    expect(t1.paidTotal).toBe(270_000);
    expect(t1.remainingTotal).toBe(60_000);
    expect(t1.collectedPct).toBe(82); // round(270000/330000*100)
    expect(t1.clearedPct).toBe(67); // round(2/3*100)
    expect(t1.dueDate).toBe("2025-09-15T00:00:00.000Z");
    expect(t1.phase).toBe("overdue"); // unpaid remainder past due
  });

  it("T2/T3 tuition: exact staircase decay (the payroll-warning view)", () => {
    const t2 = waves[1];
    expect(t2.collectedPct).toBe(33); // 80000/240000
    expect(t2.remainingTotal).toBe(160_000);
    const t3 = waves[2];
    expect(t3.collectedPct).toBe(0);
    expect(t3.remainingTotal).toBe(240_000);
  });

  it("fully-collected waves report 100% and phase in_window (complete)", () => {
    const tr1 = waves[3];
    expect(tr1.collectedPct).toBe(100);
    expect(tr1.remainingTotal).toBe(0);
    expect(tr1.phase).toBe("in_window");
  });

  it("a wave whose unpaid remainders are all in the future is not_due", () => {
    const future = deriveTrancheWaves([
      makeInstallment({ id: "f-1", parentId: "p-9", trancheNumber: 1, amountDue: 50_000, amountPaid: 0, status: "unpaid", dueDate: "2026-12-15" }),
    ], NOW);
    expect(future[0].phase).toBe("not_due");
    expect(future[0].remainingTotal).toBe(50_000);
  });

  it("defaults missing trancheNumber to wave 1 (legacy rows)", () => {
    const legacy = deriveTrancheWaves([
      makeInstallment({ id: "l-1", trancheNumber: undefined, amountDue: 10_000, amountPaid: 10_000, status: "paid" }),
    ], NOW);
    expect(legacy[0].wave).toBe(1);
  });

  it("empty input → empty output (honest empty state)", () => {
    expect(deriveTrancheWaves([], NOW)).toEqual([]);
  });
});

/* ============================================================ */
/*  2. Discount erosion                                          */
/* ============================================================ */

describe("T-338 — deriveDiscountErosion", () => {
  it("identifies remises via the STRUCTURED metadata marker (field: REMISE)", () => {
    const ledger: LedgerEntry[] = [
      makeLedger({ id: "c-1", type: "charge", amount: 100_000, description: "Devis annuel" }),
      makeLedger({ id: "r-1", type: "adjustment", amount: -20_000, description: "Remise sur devis (import Excel run run_msp3foah_c254f9)", metadata: { field: "REMISE", importRunId: "run_msp3foah_c254f9" } }),
    ];
    const e = deriveDiscountErosion(ledger);
    expect(e.remiseCount).toBe(1);
    expect(e.remiseTotal).toBe(20_000);
    expect(e.cancelCount).toBe(0);
    expect(e.grossCharges).toBe(100_000);
    expect(e.stickerTotal).toBe(120_000);
    expect(e.erosionPct).toBe(17); // round(20000/120000*100)
    expect(e.averageRemise).toBe(20_000);
    expect(e.remiseFamilyCount).toBe(1);
  });

  it("description fallback catches legacy remise rows without metadata", () => {
    const e = deriveDiscountErosion([
      makeLedger({ id: "r-legacy", type: "adjustment", amount: -5_000, description: "Remise sur devis (legacy import)", metadata: {} }),
    ]);
    expect(e.remiseCount).toBe(1);
    expect(e.remiseTotal).toBe(5_000);
  });

  it("double-remise-cancel debits are counted separately and net to zero with the remise", () => {
    const ledger: LedgerEntry[] = [
      makeLedger({ id: "r-1", type: "adjustment", amount: -25_500, description: "Remise sur devis (import Excel run run_msp3foah_c254f9)", metadata: { field: "REMISE" } }),
      makeLedger({ id: "x-1", type: "adjustment", amount: 25_500, description: "Annulation double-remise (réconciliation 0063) — le devis importé est déjà net de remise (formule Excel L = composantes − J)", metadata: { reason: "double_remise_cancel", original_entry: "r-1", reconciliation: "0063", original_amount: -25500 } }),
    ];
    const e = deriveDiscountErosion(ledger);
    expect(e.remiseCount).toBe(1);
    expect(e.remiseTotal).toBe(25_500);
    expect(e.cancelCount).toBe(1);
    expect(e.cancelTotal).toBe(25_500);
    expect(e.netRemiseTotal).toBe(0); // ledger-honest: the imported devis is already net
  });

  it("payments/refunds/other adjustments never pollute the erosion math", () => {
    const ledger: LedgerEntry[] = [
      makeLedger({ id: "pay-1", type: "payment", amount: -50_000, description: "Encaissement", metadata: { field: "REMISE" } }),
      makeLedger({ id: "ref-1", type: "refund", amount: -5_000, description: "Remise sur devis (looks like one)", metadata: { field: "REMISE" } }),
      makeLedger({ id: "adj-1", type: "adjustment", amount: -15_000, description: "Crédit parent (excédent)" }),
      makeLedger({ id: "neg-charge", type: "charge", amount: -3_000, description: "Correction" }),
    ];
    const e = deriveDiscountErosion(ledger);
    expect(e.remiseCount).toBe(0);
    expect(e.remiseTotal).toBe(0);
    expect(e.grossCharges).toBe(0);
    expect(e.erosionPct).toBe(0);
  });

  it("the live-shaped corpus: remises 95k/85k/84k/80k against a 113 723 800 net base", () => {
    const ledger: LedgerEntry[] = [
      makeLedger({ id: "c-1", type: "charge", amount: 113_723_800, description: "Devis (net)" }),
      ...[95_000, 85_000, 84_000, 80_000].map((amt, i) =>
        makeLedger({ id: `r-${i}`, type: "adjustment", amount: -amt, description: "Remise sur devis (import Excel run run_msp3foah_c254f9)", metadata: { field: "REMISE", importRunId: "run_msp3foah_c254f9" } }),
      ),
    ];
    const e = deriveDiscountErosion(ledger);
    expect(e.remiseTotal).toBe(344_000);
    expect(e.stickerTotal).toBe(114_067_800);
    expect(e.erosionPct).toBe(0); // round(344000/114067800*100) = 0.30 → 0
    expect(e.maxRemise).toBe(95_000);
    expect(e.minRemise).toBe(80_000);
    expect(e.averageRemise).toBe(86_000);
  });
});

/* ============================================================ */
/*  3. Debt triage                                               */
/* ============================================================ */

describe("T-338 — deriveDebtTriage", () => {
  const installments: Installment[] = [
    // p-1: T1 late 61 days (chronic), 40_000 remaining
    makeInstallment({ id: "d-1", parentId: "p-1", trancheNumber: 1, amountDue: 40_000, amountPaid: 0, status: "unpaid", dueDate: "2026-07-15" }),
    // p-2: 20 days late (reminder), 30_000 remaining
    makeInstallment({ id: "d-2", parentId: "p-2", trancheNumber: 2, amountDue: 30_000, amountPaid: 0, status: "unpaid", dueDate: "2026-08-25" }),
    // p-3: 5 days late (current), 10_000 remaining
    makeInstallment({ id: "d-3", parentId: "p-3", trancheNumber: 1, amountDue: 10_000, amountPaid: 0, status: "unpaid", dueDate: "2026-09-09" }),
    // p-4: not due yet (the December wave), 50_000 remaining
    makeInstallment({ id: "d-4", parentId: "p-4", trancheNumber: 3, amountDue: 50_000, amountPaid: 0, status: "unpaid", dueDate: "2026-12-15" }),
    // p-1 ALSO owes a second late tranche (44 days — still reminder bucket)
    makeInstallment({ id: "d-5", parentId: "p-1", trancheNumber: 2, amountDue: 20_000, amountPaid: 0, status: "unpaid", dueDate: "2026-08-01" }),
  ];
  const triage = deriveDebtTriage(installments, NOW);

  it("splits into the four action tiers with exact amounts and family counts", () => {
    const byBucket = Object.fromEntries(triage.buckets.map((b) => [b.bucket, b]));
    expect(byBucket.not_due.amount).toBe(50_000);
    expect(byBucket.not_due.familyCount).toBe(1);
    expect(byBucket.current.amount).toBe(10_000);
    expect(byBucket.reminder.amount).toBe(50_000); // p-2 (20j, 30k) + p-1's 2nd tranche (44j, 20k)
    expect(byBucket.chronic.amount).toBe(40_000); // p-1's 61-day tranche
    expect(byBucket.chronic.familyCount).toBe(1);
    expect(byBucket.chronic.installmentCount).toBe(1);
    expect(byBucket.reminder.installmentCount).toBe(2);
  });

  it("total outstanding = Σ buckets; shares exact", () => {
    expect(triage.totalOutstanding).toBe(150_000);
    expect(triage.buckets[0].share).toBe(33); // 50000/150000
    expect(triage.buckets[3].share).toBe(27); // 40000/150000
  });

  it("the call list = families with ANY installment > 45 days late, full exposure, ranked", () => {
    expect(triage.callList).toHaveLength(1);
    expect(triage.callList[0].parentId).toBe("p-1");
    expect(triage.callList[0].outstanding).toBe(60_000); // full exposure incl. the 44d tranche
    expect(triage.callList[0].worstDaysOverdue).toBe(61); // 2026-07-15 → 2026-09-14
  });

  it("a family whose worst overdue is exactly 45 days is reminder, NOT chronic (> 45 strict)", () => {
    const t = deriveDebtTriage([
      makeInstallment({ id: "b-1", parentId: "p-9", amountDue: 10_000, amountPaid: 0, status: "unpaid", dueDate: "2026-07-31" }), // exactly 45 days
    ], NOW);
    expect(t.buckets.find((b) => b.bucket === "reminder")!.amount).toBe(10_000);
    expect(t.buckets.find((b) => b.bucket === "chronic")!.amount).toBe(0);
    expect(t.callList).toHaveLength(0);
  });

  it("satisfied installments never enter any bucket", () => {
    const t = deriveDebtTriage([
      makeInstallment({ id: "paid-1", amountDue: 10_000, amountPaid: 10_000, status: "paid", dueDate: "2025-09-15" }),
    ], NOW);
    expect(t.totalOutstanding).toBe(0);
    expect(t.buckets.every((b) => b.amount === 0)).toBe(true);
  });
});

/* ============================================================ */
/*  4. Family concentration                                      */
/* ============================================================ */

describe("T-338 — deriveFamilyConcentration", () => {
  const installments: Installment[] = [
    makeInstallment({ id: "f-1", parentId: "p-big", trancheNumber: 1, amountDue: 150_000, amountPaid: 0, status: "unpaid", dueDate: "2025-09-15" }),
    makeInstallment({ id: "f-2", parentId: "p-big2", trancheNumber: 1, amountDue: 120_000, amountPaid: 0, status: "unpaid", dueDate: "2025-09-15" }),
    makeInstallment({ id: "f-3", parentId: "p-mid", trancheNumber: 1, amountDue: 60_000, amountPaid: 0, status: "unpaid", dueDate: "2025-09-15" }),
    makeInstallment({ id: "f-4", parentId: "p-small", trancheNumber: 1, amountDue: 10_000, amountPaid: 0, status: "unpaid", dueDate: "2026-12-15" }),
  ];
  const students: Student[] = [
    makeStudent({ id: "s-1", parentId: "p-big" }),
    makeStudent({ id: "s-2", parentId: "p-big" }),
    makeStudent({ id: "s-3", parentId: "p-big" }),
    makeStudent({ id: "s-4", parentId: "p-big2" }),
    makeStudent({ id: "s-5", parentId: "p-big2" }),
    makeStudent({ id: "s-6", parentId: "p-mid" }),
    makeStudent({ id: "s-7", parentId: "p-mid" }),
    makeStudent({ id: "s-8", parentId: "p-small" }),
    makeStudent({ id: "s-9", parentId: "p-zero-debt" }), // family with NO debt
    makeStudent({ id: "s-10", parentId: "p-zero-debt", status: "withdrawn" }), // inactive child not counted
  ];
  const parents = [makeParent("p-big", "BENZAOUI"), makeParent("p-big2", "KOUBAA"), makeParent("p-mid", "ALIOUAT"), makeParent("p-small", "ATTOUCHE"), makeParent("p-zero-debt", "CHARIF")];

  const conc = deriveFamilyConcentration({ installments, parents, students, topN: 2, nowEpochMs: NOW });

  it("per-family outstanding ranked desc with child counts (the 80/20 view)", () => {
    expect(conc.totalOutstanding).toBe(340_000);
    expect(conc.debtorFamilyCount).toBe(4);
    expect(conc.topFamilies.map((f) => f.parentId)).toEqual(["p-big", "p-big2"]);
    expect(conc.topFamilies[0].childCount).toBe(3);
    expect(conc.topFamilies[0].parentName).toBe("BENZAOUI");
    expect(conc.topFamilies[0].shareOfTotalDebt).toBe(44); // round(150000/340000*100)
  });

  it("top-N concentration = round(topTotal/total*100)", () => {
    expect(conc.topTotal).toBe(270_000);
    expect(conc.topConcentrationPct).toBe(79); // round(270000/340000*100)
  });

  it("families with no debt never appear in the ranking", () => {
    expect(conc.topFamilies.find((f) => f.parentId === "p-zero-debt")).toBeUndefined();
  });

  it("worstDaysOverdue reflects the family's oldest unpaid tranche (deterministic now)", () => {
    expect(conc.topFamilies[0].worstDaysOverdue).toBe(364); // 2025-09-15 → 2026-09-14T12:00Z = 364.5 floored
  });
});

/* ============================================================ */
/*  5. Transport yield                                           */
/* ============================================================ */

describe("T-338 — deriveTransportYield", () => {
  it("normalizes messy live spellings through TOWN_ALIASES and reconciles route money", () => {
    const students: Student[] = [
      makeStudent({ id: "r-1", parentId: "p-1", transportTier: "BOUMERDES" }),
      makeStudent({ id: "r-2", parentId: "p-2", transportTier: "BOUMRDES" }),   // typo → same town
      makeStudent({ id: "r-3", parentId: "p-3", transportTier: "OULED MOUSSA" }), // spaced → ouled_moussa
      makeStudent({ id: "r-4", parentId: "p-4", transportTier: "KHEMISELKHCHNA" }),
      makeStudent({ id: "r-5", parentId: "p-5", transportTier: "ERBATACHE" }),  // unknown → autres
      makeStudent({ id: "r-6", parentId: "p-6", transportTier: null }),         // no transport
      makeStudent({ id: "r-7", parentId: "p-1", transportTier: "BOUMREDES" }),  // same parent, 2nd child, same town
    ];
    const installments: Installment[] = [
      // p-1 (boumerdes): 2 transport installments, one paid
      makeInstallment({ id: "tr-1", parentId: "p-1", category: "transport", trancheNumber: 1, amountDue: 20_000, amountPaid: 20_000, status: "paid", dueDate: "2025-09-15" }),
      makeInstallment({ id: "tr-2", parentId: "p-1", category: "transport", trancheNumber: 2, amountDue: 10_000, amountPaid: 0, status: "unpaid", dueDate: "2025-12-15" }),
      // p-3 (ouled_moussa): unpaid
      makeInstallment({ id: "tr-3", parentId: "p-3", category: "transport", trancheNumber: 1, amountDue: 30_000, amountPaid: 0, status: "unpaid", dueDate: "2025-09-15" }),
      // p-5 (autres): partially paid
      makeInstallment({ id: "tr-4", parentId: "p-5", category: "transport", trancheNumber: 1, amountDue: 30_000, amountPaid: 15_000, status: "partial", dueDate: "2025-09-15" }),
      // A transport installment with NO rider student → bucketed under autres
      makeInstallment({ id: "tr-5", parentId: "p-9", category: "transport", trancheNumber: 3, amountDue: 10_000, amountPaid: 0, status: "unpaid", dueDate: "2026-03-15" }),
    ];

    const t = deriveTransportYield({ students, installments });

    expect(t.riders).toBe(6);
    expect(t.nonRiders).toBe(1);
    expect(t.unresolvedRawValues).toEqual(["ERBATACHE"]);

    const boumerdes = t.routes.find((r) => r.destination === "boumerdes")!;
    expect(boumerdes.riders).toBe(2); // two PARENTS (p-1, p-2)
    expect(boumerdes.dueTotal).toBe(30_000);
    expect(boumerdes.paidTotal).toBe(20_000);
    expect(boumerdes.remainingTotal).toBe(10_000);
    expect(boumerdes.collectedPct).toBe(67);

    const ouledMoussa = t.routes.find((r) => r.destination === "ouled_moussa")!;
    expect(ouledMoussa.riders).toBe(1);
    expect(ouledMoussa.remainingTotal).toBe(30_000);

    // Σ across routes reconciles the whole transport installment stream:
    // due 100_000, paid 35_000, remaining 65_000 → 35%.
    expect(t.dueTotal).toBe(100_000);
    expect(t.paidTotal).toBe(35_000);
    expect(t.remainingTotal).toBe(65_000);
    expect(t.collectedPct).toBe(35);
  });

  it("routes sort by riders desc, then remaining desc", () => {
    const t = deriveTransportYield({
      students: [
        makeStudent({ id: "r-1", parentId: "p-1", transportTier: "CORSO" }),
        makeStudent({ id: "r-2", parentId: "p-2", transportTier: "SAHEL" }),
        makeStudent({ id: "r-3", parentId: "p-3", transportTier: "SAHEL" }),
      ],
      installments: [],
    });
    expect(t.routes.map((r) => r.destination)).toEqual(["sahel", "corso"]);
    expect(t.collectedPct).toBe(0);
    expect(t.dueTotal).toBe(0);
  });
});

describe("T-338 — normalizeTransportTier (the domain canonical normalizer)", () => {
  it("null/blank → null (no transport — NOT counted as a rider)", () => {
    expect(normalizeTransportTier(null)).toBeNull();
    expect(normalizeTransportTier(undefined)).toBeNull();
    expect(normalizeTransportTier("   ")).toBeNull();
  });
  it("live spelling variants collapse to their real town", () => {
    expect(normalizeTransportTier("BOUMERDES")).toBe("boumerdes");
    expect(normalizeTransportTier("BOUMRDES")).toBe("boumerdes");
    expect(normalizeTransportTier("BOUMREDES")).toBe("boumerdes");
    expect(normalizeTransportTier("BOUMERDES20000")).toBe("boumerdes");
    expect(normalizeTransportTier("OULED MOUSSA")).toBe("ouled_moussa");
    expect(normalizeTransportTier("KHEMISELKHCHNA")).toBe("khemis_el_khechna");
    expect(normalizeTransportTier("ZEMOURI")).toBe("zemmouri");
    expect(normalizeTransportTier("tidjelabine_sahel_figuier_corso")).toBe("tidjelabine_sahel_figuier_corso");
  });
  it("unknown non-empty → autres (a rider from an unrecognized locality)", () => {
    expect(normalizeTransportTier("ERBATACHE")).toBe("autres");
  });
});

/* ============================================================ */
/*  6. Service yield                                             */
/* ============================================================ */

describe("T-338 — deriveServiceYield", () => {
  const labels: Record<string, string> = {
    therapy_psychology: "Psychologie",
    therapy_speech: "Orthophonie",
    other: "Autre",
    canteen: "Cantine",
  };
  const payments: Payment[] = [
    makePayment({ id: "sp-1", category: "therapy_psychology", amount: 10_000, studentId: "stu-1" }),
    makePayment({ id: "sp-2", category: "therapy_psychology", amount: 10_000, studentId: "stu-2" }),
    makePayment({ id: "sp-3", category: "therapy_psychology", amount: 10_000, studentId: "stu-1" }),
    makePayment({ id: "sp-4", category: "therapy_speech", amount: 5_000, studentId: "stu-3" }),
    makePayment({ id: "sp-5", category: "other", amount: 1_659_500, studentId: null }),
    // Non-service categories are excluded:
    makePayment({ id: "sp-6", category: "tuition", amount: 100_000 }),
    // Refunded therapy does not count as yield:
    makePayment({ id: "sp-7", category: "therapy_speech", amount: 5_000, status: "refunded" }),
  ];

  it("per-service revenue/volume/students from the PAID stream, sorted desc", () => {
    const s = deriveServiceYield(payments, labels);
    expect(s.map((x) => x.category)).toEqual(["other", "therapy_psychology", "therapy_speech"]);
    const psy = s.find((x) => x.category === "therapy_psychology")!;
    expect(psy.revenue).toBe(30_000);
    expect(psy.paymentCount).toBe(3);
    expect(psy.studentCount).toBe(2); // stu-1 paid twice, counted once
    expect(psy.label).toBe("Psychologie");
  });

  it("empty service activity → empty output (honest empty state)", () => {
    expect(deriveServiceYield([], labels)).toEqual([]);
    expect(deriveServiceYield([makePayment({ category: "tuition" })], labels)).toEqual([]);
  });
});

/* ============================================================ */
/*  7. Enrollment dynamics + section imbalance                   */
/* ============================================================ */

describe("T-338 — deriveEnrollmentDynamics", () => {
  // Live-shaped family mix: 5×1 + 2×2 + 1×3 + 1×5 = 17 students / 9 families.
  const parents = Array.from({ length: 9 }, (_, i) => makeParent(`p-${i}`, `FAM${i}`));
  const students: Student[] = [
    ...Array.from({ length: 5 }, (_, i) => makeStudent({ id: `s1-${i}`, parentId: `p-${i}` })),
    ...Array.from({ length: 2 }, (_, i) => makeStudent({ id: `s2-${i}`, parentId: `p-5` })),
    ...Array.from({ length: 2 }, (_, i) => makeStudent({ id: `s2b-${i}`, parentId: `p-6` })),
    ...Array.from({ length: 3 }, (_, i) => makeStudent({ id: `s3-${i}`, parentId: `p-7` })),
    ...Array.from({ length: 5 }, (_, i) => makeStudent({ id: `s5-${i}`, parentId: `p-8` })),
    makeStudent({ id: `s-inactive`, parentId: `p-8`, status: "withdrawn" }), // not counted
  ];
  // Live-shaped multi-section grade: CP 51 vs 1AP 3 (same gradeCode 1ap) + a balanced grade.
  const classes: AcademicClass[] = [
    makeClass({ id: "cp", name: "CP — Cours Préparatoire", gradeCode: "1ap", enrolledCount: 51, code: "CLS-CP" }),
    makeClass({ id: "1ap", name: "1ère Année Primaire", gradeCode: "1ap", enrolledCount: 3, code: "CLS-1AP" }),
    makeClass({ id: "ce1", name: "CE1 — 2ème Année Primaire", gradeCode: "2ap", enrolledCount: 35, code: "CLS-CE1" }),
    makeClass({ id: "2ap", name: "2ème Année Primaire", gradeCode: "2ap", enrolledCount: 35, code: "CLS-2AP" }),
    makeClass({ id: "5ap", name: "5ème Année Primaire", gradeCode: "5ap", enrolledCount: 41, code: "CLS-5AP" }), // single section
    makeClass({ id: "gs-old", name: "Grande Section", gradeCode: "prescolaire_2", enrolledCount: 22, isActive: false, code: "CLS-GS" }), // inactive
  ];

  const dyn = deriveEnrollmentDynamics({ students, parents, classes });

  it("sibling index = totalStudents / totalFamilies, 2 decimals, inactive excluded", () => {
    expect(dyn.totalStudents).toBe(17);
    expect(dyn.totalFamilies).toBe(9);
    expect(dyn.siblingIndex).toBe(1.89);
  });

  it("family-size distribution merges 5+ and reports both counts", () => {
    expect(dyn.familySizes.map((f) => f.label)).toEqual(["1 enfant", "2 enfants", "3 enfants", "5+ enfants"]);
    expect(dyn.familySizes.find((f) => f.label === "1 enfant")!.familyCount).toBe(5);
    expect(dyn.familySizes.find((f) => f.label === "5+ enfants")!.familyCount).toBe(1);
    expect(dyn.familySizes.find((f) => f.label === "5+ enfants")!.studentCount).toBe(5);
  });

  it("multi-child families count + share", () => {
    expect(dyn.multiChildFamilyCount).toBe(4);
    expect(dyn.multiChildFamilyPct).toBe(44); // round(4/9*100)
  });

  it("section imbalance: spread + the (spread ≥ 10 OR max ≥ 1.5×min) rule", () => {
    expect(dyn.imbalances.map((i) => i.gradeLabel)).toEqual(["CP — Cours Préparatoire (1AP)", "CE1 — 2ème Année Primaire (2AP)"]);
    const cp = dyn.imbalances[0];
    expect(cp.sectionCount).toBe(2);
    expect(cp.maxEnrolled).toBe(51);
    expect(cp.minEnrolled).toBe(3);
    expect(cp.spread).toBe(48);
    expect(cp.averageEnrolled).toBe(27);
    expect(cp.imbalanced).toBe(true);
    const ce1 = dyn.imbalances[1];
    expect(ce1.spread).toBe(0);
    expect(ce1.imbalanced).toBe(false);
  });

  it("single-section grades and inactive classes never appear as imbalances", () => {
    expect(dyn.imbalances.find((i) => i.sections.some((s) => s.classId === "5ap"))).toBeUndefined();
    expect(dyn.imbalances.find((i) => i.sections.some((s) => s.classId === "gs-old"))).toBeUndefined();
  });

  it("max ≥ 1.5 × min flags even with a spread < 10 (the ratio rule)", () => {
    const d = deriveEnrollmentDynamics({
      students: [makeStudent({ id: "x", parentId: "p-1" })],
      parents: [makeParent("p-1", "F")],
      classes: [
        makeClass({ id: "a", gradeCode: "1am", enrolledCount: 15, name: "1AM A" }),
        makeClass({ id: "b", gradeCode: "1am", enrolledCount: 9, name: "1AM B" }),
      ],
    });
    expect(d.imbalances[0].spread).toBe(6);
    expect(d.imbalances[0].imbalanced).toBe(true); // 15 ≥ 1.5 × 9 = 13.5
  });

  it("empty school → null sibling index and empty structures", () => {
    const d = deriveEnrollmentDynamics({ students: [], parents: [], classes: [] });
    expect(d.siblingIndex).toBeNull();
    expect(d.familySizes).toEqual([]);
    expect(d.imbalances).toEqual([]);
  });
});

/* ============================================================ */
/*  8. Triple-risk summary                                       */
/* ============================================================ */

describe("T-338 — deriveTripleRiskSummary", () => {
  const profile = (riskCategory: StudentRiskProfile["riskCategory"]): StudentRiskProfile => ({
    studentId: "s",
    studentName: "X",
    studentCode: "ELV-1",
    classId: null,
    className: "—",
    level: "primaire",
    gradeLevel: "1ap",
    parentId: "p",
    parentName: "F",
    parentPhone: "—",
    gpa: riskCategory === "triple_critical" || riskCategory === "academic_alert" ? 8 : 14,
    isPassing: null,
    attendanceRate: 1,
    unexcusedAbsences: 0,
    debtAmount: riskCategory === "triple_critical" || riskCategory === "financial_tension" ? 50_000 : 0,
    daysOverdue: 0,
    riskScore: 0,
    riskCategory,
    primaryRiskReason: "",
  });

  it("counts each category + the triple-critical share", () => {
    const s = deriveTripleRiskSummary([
      profile("triple_critical"),
      profile("triple_critical"),
      profile("academic_alert"),
      profile("attendance_alert"),
      profile("financial_tension"),
      profile("healthy"),
    ]);
    expect(s.tripleCriticalCount).toBe(2);
    expect(s.academicAlertCount).toBe(1);
    expect(s.attendanceAlertCount).toBe(1);
    expect(s.financialTensionCount).toBe(1);
    expect(s.healthyCount).toBe(1);
    expect(s.tripleCriticalPct).toBe(33); // round(2/6*100)
  });

  it("zero profiles → all zeros (honest empty state)", () => {
    const s = deriveTripleRiskSummary([]);
    expect(s.tripleCriticalCount).toBe(0);
    expect(s.tripleCriticalPct).toBe(0);
  });
});
