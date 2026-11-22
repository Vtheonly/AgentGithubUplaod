/**
 * E2.6 / BUG-020 — the service pricing profile's derived deadline, the
 * reversesId-aware adjustment netting, and the structured tranche number.
 *
 * WHAT THIS SUITE PINS (the Session-45 fix):
 *
 *   1. THE DEADLINE DERIVES FROM THE ACADEMIC YEAR: the profile hardcoded
 *      EARLY_PAYMENT_DEADLINE = "2026-06-30" — silently wrong for every
 *      later year. It is now June 30 of the START year via
 *      earlyPaymentCutoff (the ONE rule, school-price-matrix.ts):
 *      context "2027-2028" → "2027-06-30".
 *   2. REVERSED REMISES ARE NOT APPLIED DISCOUNTS: the profile listed a
 *      cancelled remise under "remises appliquées" while the debit
 *      cancellation netted it out in adjustmentsDebit — double-reporting
 *      the same event to the drawer. The cross-checks idiom applies:
 *      credits excluded when reversed (reversedIds) or themselves
 *      reversals (reversesId); debits excluded when they are pure
 *      reversals. The NET is unchanged either way (the arithmetic is
 *      invariant); the PRESENTATION becomes honest.
 *   3. THE STRUCTURED TRANCHE NUMBER WINS: the wave number came from
 *      label parsing ("Tranche 2" → 2) — T-338's own rule says never
 *      (labels are free-text and drift). The DB's tranche_number
 *      (migration 0124) is read first (0 = the FI, a non-wave row); the
 *      label parse survives only as the legacy fallback.
 *
 * Run:
 *   npx vitest run src/tests/domain/payment/t-e26-bug020-reversals-deadline.test.ts
 */
import { describe, it, expect } from "vitest";
import { servicePricingProfiles } from "../../../domain/calc/payment/service-pricing-profile";
import type { Installment, PaymentCategory } from "../../../domain/model/payment";
import type { LedgerEntry } from "../../../domain/model/ledger";
import type { Student } from "../../../domain/model/student";
import type { PricingConfig } from "../../../domain/model/pricing";

/* ------------------------------------------------------------------ */
/* Fixtures (the service-pricing-profile.test.ts pattern, trimmed).     */
/* ------------------------------------------------------------------ */

function makeStudent(): Student {
  return {
    id: "stu-1",
    tenantId: "tenant-1",
    code: "ELV-000001",
    parentId: "p-1",
    firstName: "LINDA",
    lastName: "ALIOUAT",
    displayName: null,
    gender: "female",
    birthDate: "2012-05-14",
    enrollmentDate: "2025-09-01",
    level: "cem",
    gradeYear: 4,
    gradeLevel: "4am",
    classId: "cls-4am-a",
    photoUrl: null,
    medicalNotes: null,
    transportTier: null,
    status: "active",
    paymentPlan: "tranches",
    createdAt: "2025-08-11T20:11:57Z",
    updatedAt: "2025-08-11T20:11:57Z",
  } as unknown as Student;
}

function makeCharge(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: overrides.id ?? "led-charge-1",
    tenantId: "tenant-1",
    accountId: "parent:p-1:category:tuition",
    parentId: "p-1",
    studentId: "stu-1",
    category: "tuition",
    amount: 340_000,
    type: "charge",
    sourceType: "bulk_import",
    sourceId: "run_x",
    method: null,
    receiptNumber: null,
    paymentStatus: null,
    reversesId: null,
    description: "Devis annuel 2027-2028",
    actorId: "system",
    actorName: "Import",
    at: "2027-08-11T20:11:57Z",
    metadata: null,
    ...overrides,
  } as LedgerEntry;
}

function makeAdjustment(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    ...makeCharge({ amount: -5_000, type: "adjustment", id: "led-adj" }),
    description: "Remise",
    ...overrides,
  } as LedgerEntry;
}

function makeInstallment(overrides: Partial<Installment> = {}): Installment {
  return {
    id: overrides.id ?? "ins-1",
    parentId: "p-1",
    studentId: "stu-1",
    category: "tuition",
    label: "Tranche 1",
    amountDue: 100_000,
    amountPaid: 0,
    amountPending: 0,
    dueDate: "2027-09-15",
    paidDate: null,
    status: "unpaid",
    academicCycle: "cem",
    paymentPlan: "tranches",
    isCustomSchedule: false,
    customScheduleNote: null,
    ...overrides,
  } as unknown as Installment;
}

const PRICING = {
  tuitionByGradeLevel: {
    "4am": {
      annualAmount: 340_000,
      installments: [136_000, 102_000, 102_000] as const,
      installmentMonths: [9, 12, 3] as const,
      registrationFee: 24_000,
    },
  },
  transportByDestination: {},
  registrationFee: 5_000,
  registrationFeeByGrade: { "4am": 24_000 },
  monthlyByLevel: {},
  discounts: [],
  additionalServices: [],
  complementaryServices: [],
  secondApronFee: 2_000,
} as unknown as PricingConfig;

function derive(
  ledger: LedgerEntry[],
  installments: Installment[],
  academicYearContext: string,
) {
  const out = servicePricingProfiles({
    ledgerEntries: ledger,
    installments,
    students: [makeStudent()],
    pricingConfig: PRICING,
    academicYearContext,
    fallbackAcademicYear: "2025-2026",
  });
  return out.find((p) => p.category === "tuition") ?? out[0];
}

/* ================================================================== */
/* 1. The derived deadline.                                            */
/* ================================================================== */

describe("E2.6 / BUG-020 — the early-payment deadline derives from the academic year", () => {
  it("context 2027-2028 → deadline 2027-06-30 (the hardcoded 2026-06-30 was silently wrong)", () => {
    const p = derive([makeCharge()], [], "2027-2028");
    const bonus = p?.conditions.find((c) => c.kind === "early_payment_bonus");
    expect(bonus?.deadline).toBe("2027-06-30");
  });

  it("context 2026-2027 → deadline 2026-06-30 (the era-A year, unregressed)", () => {
    const p = derive([makeCharge()], [], "2026-2027");
    const bonus = p?.conditions.find((c) => c.kind === "early_payment_bonus");
    expect(bonus?.deadline).toBe("2026-06-30");
  });
});

/* ================================================================== */
/* 2. The reversesId-aware netting.                                    */
/* ================================================================== */

describe("E2.6 / BUG-020 — reversed remises are not applied discounts", () => {
  it("a CANCELLED remise (credit reversed by a debit with reversesId) is excluded from BOTH sides — the net is unchanged", () => {
    // Charges 340 000; a remise −5 000 that was cancelled (+5 000 debit,
    // reversesId → the remise). Old: appliedDiscounts listed the 5 000
    // AND adjustmentsDebit counted 5 000 (net right, presentation a lie).
    const p = derive(
      [
        makeCharge(),
        makeAdjustment({ id: "rem-1", amount: -5_000 }),
        makeAdjustment({ id: "cancel-1", amount: 5_000, reversesId: "rem-1" }),
      ],
      [],
      "2027-2028",
    );
    expect(p?.appliedDiscounts).toHaveLength(0);
    expect(p?.construction.discountsTotal).toBe(0);
    expect(p?.construction.adjustmentsDebit).toBe(0);
    expect(p?.construction.billedNet).toBe(340_000);
  });

  it("an UNREVERSED remise still lists as applied, and a genuine majoration still counts", () => {
    const p = derive(
      [
        makeCharge(),
        makeAdjustment({ id: "rem-2", amount: -8_000 }),
        makeAdjustment({ id: "major-1", amount: 3_000 }), // no reversesId → a real majoration
      ],
      [],
      "2027-2028",
    );
    expect(p?.appliedDiscounts).toHaveLength(1);
    expect(p?.appliedDiscounts[0]?.amount).toBe(8_000);
    expect(p?.construction.discountsTotal).toBe(8_000);
    expect(p?.construction.adjustmentsDebit).toBe(3_000);
    expect(p?.construction.billedNet).toBe(340_000 + 3_000 - 8_000);
  });

  it("a credit that IS itself a reversal (cancelling a prior majoration) is not a remise either", () => {
    const p = derive(
      [
        makeCharge(),
        makeAdjustment({ id: "major-1", amount: 3_000 }),
        makeAdjustment({ id: "unmajor-1", amount: -3_000, reversesId: "major-1" }),
      ],
      [],
      "2027-2028",
    );
    expect(p?.appliedDiscounts).toHaveLength(0);
    expect(p?.construction.adjustmentsDebit).toBe(0);
    expect(p?.construction.billedNet).toBe(340_000);
  });
});

/* ================================================================== */
/* 3. The structured tranche number.                                   */
/* ================================================================== */

describe("E2.6 / BUG-020 — the structured wave number wins over label parsing", () => {
  it("trancheNumber 3 with a DRIFTED label still reports 3 (labels are free-text)", () => {
    const p = derive(
      [makeCharge()],
      [
        makeInstallment({ id: "ins-a", label: "Versement final (ancien libellé)", trancheNumber: 3 }),
      ],
      "2027-2028",
    );
    expect(p?.installmentPlan[0]?.trancheNumber).toBe(3);
  });

  it("trancheNumber 0 (the FI — a fee, a non-wave row) does NOT parse as wave 0", () => {
    const p = derive(
      [makeCharge()],
      [makeInstallment({ id: "ins-fi", label: "Frais d'inscription (FI)", trancheNumber: 0 })],
      "2027-2028",
    );
    expect(p?.installmentPlan[0]?.trancheNumber).toBeNull();
  });

  it("a LEGACY row without the column still falls back to the label parse", () => {
    const p = derive(
      [makeCharge()],
      [makeInstallment({ id: "ins-legacy", label: "Tranche 2", trancheNumber: undefined })],
      "2027-2028",
    );
    expect(p?.installmentPlan[0]?.trancheNumber).toBe(2);
  });
});
