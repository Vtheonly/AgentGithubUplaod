/**
 * T-412 — the Personnel / Finance / Statistics PARITY suite (96th session).
 *
 * The owner's requirement: ONE canonical payroll/payment forecasting
 * calculation across the three pages — "do not create separate calculation
 * engines". This suite pins exactly that:
 *
 *   1. ENGINE-INTERNAL consistency: the wave figures the PERSONNEL page
 *      renders (per-wave remaining = expected − secured; the breakdown Σ)
 *      equal the totals every consumer aggregates from.
 *   2. FINANCE pass-through: computeTreasuryHealth's payroll block is a
 *      VERBATIM projection of the canonical forecast's totals — never a
 *      second derivation. The coverage ratio is the only derived value and
 *      its formula is pinned.
 *   3. PRE-T-412 SHAPE PRESERVATION: without the payroll input, the treasury
 *      snapshot is byte-identical to the T-411 contract (payroll undefined).
 *   4. THE OWNER'S EXAMPLE: 30 employees × 1M DZD → every view derives the
 *      same 30M DZD required-cash figure.
 *   5. RESTATEMENT parity: recording a disbursement moves all three views'
 *      figures consistently (same engine, same inputs).
 *
 * (The Statistics leg — derivePayrollCostTrend over the same forecast — is
 * pinned in the same file by the Phase 4 commit.)
 *
 * Run:
 *   npx vitest run src/tests/domain/calc/t-412-cross-page-parity.test.ts
 */
import { describe, it, expect } from "vitest";
import {
  computePayrollForecast,
  type PayrollForecastPersonnelInput,
  type SalaryPaymentForecastInput,
} from "../../../domain/calc/payroll/payroll-forecast";
import {
  computeTreasuryHealth,
} from "../../../domain/calc/payment/financial-query-engine";
import type { Payment, Installment, DebtSummary } from "../../../domain/model/payment";
import type { Expense } from "../../../domain/model/expense";

// ---------------------------------------------------------------------------
// Fixories
// ---------------------------------------------------------------------------

function makePerson(
  overrides: Partial<PayrollForecastPersonnelInput> = {},
): PayrollForecastPersonnelInput {
  return {
    id: overrides.id ?? "per-1",
    firstName: overrides.firstName ?? "Amina",
    lastName: overrides.lastName ?? "Meziane",
    staffCategory: overrides.staffCategory ?? "teacher",
    position: overrides.position ?? "Professeur",
    salary: overrides.salary !== undefined ? overrides.salary : 1_000_000,
    paymentMethod: overrides.paymentMethod ?? "bank_transfer",
    hireDate: overrides.hireDate ?? "2020-09-01",
    terminationDate: overrides.terminationDate ?? null,
    status: overrides.status ?? "active",
  };
}

function makePayment(
  overrides: Partial<SalaryPaymentForecastInput> = {},
): SalaryPaymentForecastInput {
  return {
    personnelId: overrides.personnelId ?? "per-1",
    period: overrides.period ?? "2026-09",
    netPaid: overrides.netPaid ?? 1_000_000,
    status: overrides.status ?? "paid",
    paymentDate: overrides.paymentDate ?? "2026-09-28",
  };
}

const NOW = new Date("2026-09-15T12:00:00Z"); // 2026-09 in Africa/Algiers

function thirtyEmployees(): PayrollForecastPersonnelInput[] {
  return Array.from({ length: 30 }, (_, i) =>
    makePerson({ id: `per-${i + 1}`, firstName: `Emp${i + 1}` }),
  );
}

// Minimal finance-side fixtures (empty streams — only the treasury block's
// pass-through is under test here; the T-411 suite pins the rest).
function financeFixtures() {
  const payments: Payment[] = [];
  const installments: Installment[] = [];
  const expenses: Expense[] = [];
  const debtSummaries: DebtSummary[] = [];
  return { payments, installments, expenses, debtSummaries };
}

// ---------------------------------------------------------------------------
// 1. Engine-internal consistency (the Personnel page's per-wave figures)
// ---------------------------------------------------------------------------

describe("T-412 parity — engine-internal consistency (the Personnel figures)", () => {
  it("Σ per-wave remaining (what the Personnel table shows) === totals.totalRemainingFunding", () => {
    const forecast = computePayrollForecast({
      personnel: thirtyEmployees(),
      salaryPayments: [
        makePayment({ personnelId: "per-1", netPaid: 1_000_000 }),
        makePayment({ personnelId: "per-2", netPaid: 500_000, status: "pending" }),
      ],
      now: NOW,
    });

    const wavesTotal = forecast.waves
      .filter((w) => w.phase !== "historical")
      .reduce((s, w) => s + w.remainingFundingRequirement, 0);
    expect(wavesTotal).toBe(forecast.totals.totalRemainingFunding);
  });

  it("per-wave breakdown Σ === the wave's expected payroll (the detailed view adds up)", () => {
    const forecast = computePayrollForecast({
      personnel: thirtyEmployees(),
      salaryPayments: [],
      now: NOW,
    });
    for (const wave of forecast.waves) {
      if (wave.phase === "historical") continue;
      expect(
        wave.breakdown.reduce((s, e) => s + e.baseSalary, 0),
      ).toBe(wave.expectedPayroll);
      expect(wave.breakdown).toHaveLength(wave.personnelCount);
    }
  });

  it("per-wave remaining = max(0, expected − secured) for EVERY projected wave", () => {
    const forecast = computePayrollForecast({
      personnel: thirtyEmployees(),
      salaryPayments: [
        makePayment({ personnelId: "per-1", netPaid: 2_000_000 }), // over-paid vs 1M salary
      ],
      now: NOW,
    });
    for (const wave of forecast.waves) {
      if (wave.phase === "historical") continue;
      expect(wave.remainingFundingRequirement).toBe(
        Math.max(0, wave.expectedPayroll - wave.securedAmount),
      );
    }
  });

  it("historicalMonthly Σ === Σ historical waves' actualPaid (the Statistics trend input)", () => {
    const forecast = computePayrollForecast({
      personnel: thirtyEmployees(),
      salaryPayments: [
        makePayment({ period: "2026-07", personnelId: "per-1", netPaid: 900_000 }),
        makePayment({ period: "2026-07", personnelId: "per-2", netPaid: 850_000 }),
        makePayment({ period: "2026-08", personnelId: "per-1", netPaid: 950_000 }),
      ],
      now: NOW,
    });
    const histWaves = forecast.waves.filter((w) => w.phase === "historical");
    expect(forecast.historicalMonthly.reduce((s, m) => s + m.actualPaid, 0)).toBe(
      histWaves.reduce((s, w) => s + w.actualPaid, 0),
    );
  });
});

// ---------------------------------------------------------------------------
// 2. The Finance pass-through (computeTreasuryHealth's payroll block)
// ---------------------------------------------------------------------------

describe("T-412 parity — the Finance treasury pass-through", () => {
  it("the payroll block projects the canonical totals VERBATIM (no second derivation)", () => {
    const forecast = computePayrollForecast({
      personnel: thirtyEmployees(),
      salaryPayments: [
        makePayment({ personnelId: "per-1", netPaid: 1_000_000 }),
      ],
      now: NOW,
    });
    const fx = financeFixtures();
    const snapshot = computeTreasuryHealth({ ...fx, payroll: forecast });

    expect(snapshot.payroll).toBeDefined();
    expect(snapshot.payroll!.nextFundingPeriod).toBe(
      forecast.totals.nextFundingWave?.period ?? null,
    );
    expect(snapshot.payroll!.expectedPayrollNextWave).toBe(
      forecast.totals.nextFundingWave?.expectedPayroll ?? 0,
    );
    expect(snapshot.payroll!.nextPaymentDate).toBe(
      forecast.totals.nextFundingWave?.paymentDate ?? null,
    );
    expect(snapshot.payroll!.personnelCount).toBe(
      forecast.totals.nextFundingWave?.personnelCount ?? 0,
    );
    expect(snapshot.payroll!.securedCurrentPeriod).toBe(
      forecast.totals.securedCurrentPeriod,
    );
    expect(snapshot.payroll!.remainingNextWave).toBe(
      forecast.totals.nextFundingWave?.remainingFundingRequirement ?? 0,
    );
    expect(snapshot.payroll!.requiredCash30d).toBe(forecast.totals.requiredCash30d);
    expect(snapshot.payroll!.totalRemainingFunding).toBe(
      forecast.totals.totalRemainingFunding,
    );
    expect(snapshot.payroll!.projectedMonthlyPayroll).toBe(
      forecast.totals.projectedMonthlyPayroll,
    );
  });

  it("coverage30d = round(expectedInflow30d / requiredCash30d × 100) — the ONLY derived value, formula pinned", () => {
    // Build a fixture with a KNOWN expectedInflow30d: one overdue ≤30d debt of
    // 15M + one tranche due within 30 days with INV-4 remaining 15M. NOTE:
    // computeTreasuryHealth's inflow legs read the REAL clock (Date.now(),
    // the pre-T-411 design) — the due date must be clock-relative, not fixed.
    const dueIn10d = new Date(Date.now() + 10 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const payment = (overrides: Partial<Payment>): Payment => ({
      id: "pay-x",
      tenantId: "t1",
      parentId: "p-1",
      studentId: null,
      receiptNumber: "REC-1",
      amount: 0,
      method: "cash",
      category: null,
      status: "paid",
      collectedAt: "2026-09-01",
      collectedByName: "probe",
      notes: null,
      ...overrides,
    } as Payment);
    const installment = (overrides: Partial<Installment>): Installment => ({
      id: "ins-x",
      parentId: "p-1",
      studentId: null,
      category: "tuition",
      label: "Tranche",
      amountDue: 15_000_000,
      amountPaid: 0,
      amountPending: 0,
      dueDate: dueIn10d,
      paidDate: null,
      status: "pending",
      trancheNumber: 1,
      ...overrides,
    } as Installment);
    const debt: DebtSummary = {
      parentId: "p-1",
      parentName: "Probe",
      outstandingAmount: 15_000_000,
      daysOverdue: 10,
      studentCount: 1,
      lastPaymentDate: null,
    } as unknown as DebtSummary;

    const forecast = computePayrollForecast({
      personnel: thirtyEmployees(),
      salaryPayments: [],
      now: NOW,
    });

    const snapshot = computeTreasuryHealth({
      payments: [payment({})],
      installments: [installment({})],
      expenses: [],
      debtSummaries: [debt],
      payroll: forecast,
    });

    expect(snapshot.expectedInflow30d).toBe(30_000_000);
    // 30M inflow vs the 30M Sept payroll requirement → exactly 100%.
    expect(snapshot.payroll!.requiredCash30d).toBe(30_000_000);
    expect(snapshot.payroll!.coverage30d).toBe(100);
  });

  it("coverage30d is null when there is NO 30-day payroll requirement (honest absence)", () => {
    const forecast = computePayrollForecast({
      personnel: thirtyEmployees(),
      salaryPayments: Array.from({ length: 30 }, (_, i) =>
        makePayment({ personnelId: `per-${i + 1}`, netPaid: 1_000_000 }),
      ),
      now: NOW,
    });
    // Everything through the horizon is settled → no 30-day requirement.
    const snapshot = computeTreasuryHealth({ ...financeFixtures(), payroll: forecast });
    expect(snapshot.payroll!.requiredCash30d).toBe(0);
    expect(snapshot.payroll!.coverage30d).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Pre-T-412 shape preservation (the T-411 contract is untouched)
// ---------------------------------------------------------------------------

describe("T-412 parity — pre-T-412 call sites keep the exact T-411 snapshot", () => {
  it("without the payroll input, payroll is undefined and every legacy field is unchanged", () => {
    const a = computeTreasuryHealth({ ...financeFixtures() });
    expect(a.payroll).toBeUndefined();
    expect(a).toEqual({
      totalClearedInflow: 0,
      totalDisbursedOutflow: 0,
      netOperatingCashFlow: 0,
      bankFloatPending: 0,
      expectedInflow30d: 0,
      t1CollectionRate: 0,
      t2CollectionRate: 0,
      t3CollectionRate: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// 4. The owner's example across the views
// ---------------------------------------------------------------------------

describe("T-412 parity — the 30-employee example (30 × 1M → 30M DZD)", () => {
  it("Personnel's wave figure === Finance's remainingNextWave === the engine total", () => {
    const forecast = computePayrollForecast({
      personnel: thirtyEmployees(),
      salaryPayments: [],
      now: NOW,
    });

    // The PERSONNEL page's current-wave row:
    const currentWave = forecast.waves.find((w) => w.phase === "current")!;
    expect(currentWave.remainingFundingRequirement).toBe(30_000_000);

    // The FINANCE page's funding card (via the treasury snapshot):
    const snapshot = computeTreasuryHealth({
      ...financeFixtures(),
      payroll: forecast,
    });
    expect(snapshot.payroll!.remainingNextWave).toBe(30_000_000);
    expect(snapshot.payroll!.expectedPayrollNextWave).toBe(30_000_000);
    expect(snapshot.payroll!.requiredCash30d).toBe(30_000_000);

    // The shared engine total:
    expect(forecast.totals.nextFundingWave?.remainingFundingRequirement).toBe(30_000_000);
    expect(forecast.totals.projectedMonthlyPayroll).toBe(30_000_000);
  });
});

// ---------------------------------------------------------------------------
// 5. Restatement parity (one disbursement moves every view consistently)
// ---------------------------------------------------------------------------

describe("T-412 parity — restatement on a recorded disbursement", () => {
  it("10M disbursed → Personnel wave, Finance card and engine totals all drop by 10M", () => {
    const before = computePayrollForecast({
      personnel: thirtyEmployees(),
      salaryPayments: [],
      now: NOW,
    });
    const after = computePayrollForecast({
      personnel: thirtyEmployees(),
      salaryPayments: [
        makePayment({ personnelId: "per-1", netPaid: 4_000_000 }),
        makePayment({ personnelId: "per-2", netPaid: 3_000_000 }),
        makePayment({ personnelId: "per-3", netPaid: 3_000_000 }),
      ],
      now: NOW,
    });

    const waveBefore = before.waves.find((w) => w.phase === "current")!;
    const waveAfter = after.waves.find((w) => w.phase === "current")!;
    expect(waveBefore.remainingFundingRequirement - waveAfter.remainingFundingRequirement).toBe(10_000_000);

    const snapBefore = computeTreasuryHealth({ ...financeFixtures(), payroll: before });
    const snapAfter = computeTreasuryHealth({ ...financeFixtures(), payroll: after });
    expect(
      snapBefore.payroll!.remainingNextWave - snapAfter.payroll!.remainingNextWave,
    ).toBe(10_000_000);
    expect(
      snapBefore.payroll!.requiredCash30d - snapAfter.payroll!.requiredCash30d,
    ).toBe(10_000_000);
  });
});
