/**
 * T-412 — SECOND-ROUND DEEP VERIFICATION SUITE (98th session, 2026-09-26).
 *
 * The owner's second-round mandate: "perform another additional layer of
 * testing, especially for the personnel payroll / cash-flow functionality…
 * a deeper second round of testing to make sure there are no remaining
 * issues."
 *
 * This suite is INDEPENDENT of the 96th session's 47 tests: it targets the
 * boundary conditions, data-hygiene edges and cross-surface restatement
 * cases the first round did NOT pin. Every case was derived by re-reading
 * `src/domain/calc/payroll/payroll-forecast.ts` line-by-line (the
 * white-box complement to the first round's black-box cases):
 *
 *   R2-1  Africa/Algiers timezone boundary: 23:30Z on a month-end day is
 *         ALREADY the next month in Algiers (UTC+1) — currentPayrollPeriod
 *         must roll over at the ALGIERS midnight, not UTC's.
 *   R2-2  Eligibility inclusive/exclusive boundaries: hireDate ON the
 *         period's last day (eligible — the no-proration convention),
 *         terminationDate ON the period's first day (still eligible —
 *         "terminated BEFORE the period started"), one day earlier
 *         (excluded).
 *   R2-3  Salary hygiene: 0, negative and null salaries are all excluded
 *         from the expected payroll (never summed, never fabricated).
 *   R2-4  Disbursement-row hygiene: malformed periods ignored; duplicate
 *         rows for the same person+period summed; UNPAID rows never count
 *         as secured; a pending row's paymentDate never becomes the wave's
 *         actual payment date.
 *   R2-5  The 30-day funding window's exact boundary (due in exactly 30
 *         days → INCLUDED; 30 days + 1 hour → excluded).
 *   R2-6  Overdue carry-over capping: a disbursement gap longer than
 *         historyMonths emits only the in-window overdue waves.
 *   R2-7  The owner's 30-employee example, MIXED-salary variant: 30 staff
 *         with 30 different salaries → expected = Σ salaries (not 30×mean).
 *   R2-8  Multiple partial disbursements across MULTIPLE waves (current +
 *         upcoming): each wave's remaining is independent and correct.
 *   R2-9  A roster whose staff are ALL hired next month: no current wave,
 *         upcoming waves exist, securedCurrentPeriod = 0 and
 *         projectedMonthlyPayroll falls back to the first upcoming wave.
 *   R2-10 A historical period carrying ONLY pending rows: honest zero
 *         actualPaid (no fabrication), the wave still surfaces.
 *   R2-11 Payment rows dated BEYOND the forecast horizon: no crash, no
 *         fabricated wave, no effect on the in-window totals.
 *   R2-12 personnelCount tracks the per-wave eligible roster exactly
 *         (mid-horizon hire + mid-horizon termination).
 *   R2-13 nextFundingWave prefers the EARLIEST underfunded wave INCLUDING
 *         the overdue carry-over (owed money is not deferred).
 *   R2-14 Cross-surface restatement parity on a ROSTER change (the first
 *         round pinned restatement on a disbursement only): a salary raise
 *         restates Personnel's wave, Finance's totals and Statistics'
 *         trend to the SAME values.
 *
 * Run:
 *   npx vitest run src/tests/domain/calc/t-412-second-round-verification.test.ts
 */
import { describe, it, expect } from "vitest";
import {
  computePayrollForecast,
  currentPayrollPeriod,
  canonicalPayrollPaymentDate,
  addPeriodMonths,
  type PayrollForecastPersonnelInput,
  type SalaryPaymentForecastInput,
} from "../../../domain/calc/payroll/payroll-forecast";
import { derivePayrollCostTrend } from "../../../features/dashboard/components/analytics/executive-statistics";

// ---------------------------------------------------------------------------
// Fixtures (minimal structural inputs — the engine's own contracts)
// ---------------------------------------------------------------------------

function person(
  id: string,
  salary: number | null,
  overrides: Partial<PayrollForecastPersonnelInput> = {},
): PayrollForecastPersonnelInput {
  return {
    id,
    firstName: `First${id}`,
    lastName: `Last${id}`,
    staffCategory: "teacher",
    position: "Professeur",
    salary,
    paymentMethod: "bank_transfer",
    hireDate: "2020-09-01",
    terminationDate: null,
    status: "active",
    ...overrides,
  };
}

function payment(
  personnelId: string,
  period: string,
  netPaid: number,
  status: "paid" | "unpaid" | "pending" = "paid",
  paymentDate: string | null = null,
): SalaryPaymentForecastInput {
  return { personnelId, period, netPaid, status, paymentDate };
}

/** A `now` fixed INSIDE a given period (the 14th, noon UTC — unambiguous). */
function nowIn(period: string): Date {
  return new Date(`${period}-14T12:00:00Z`);
}

// ---------------------------------------------------------------------------
// R2-1 — the Africa/Algiers timezone boundary
// ---------------------------------------------------------------------------

describe("T-412 R2 — currentPayrollPeriod rolls at the ALGIERS midnight", () => {
  it("23:30Z on a month-end day is already the NEXT month in Algiers (UTC+1)", () => {
    // 2026-09-30 23:30 UTC === 2026-10-01 00:30 in Africa/Algiers.
    const lateUtc = new Date("2026-09-30T23:30:00Z");
    expect(currentPayrollPeriod(lateUtc)).toBe("2026-10");
    // And 22:30Z is still September in Algiers (23:30 local).
    const stillSept = new Date("2026-09-30T22:30:00Z");
    expect(currentPayrollPeriod(stillSept)).toBe("2026-09");
  });

  it("the canonical payment date of a period lands on the month's LAST day (December and February, non-leap and leap)", () => {
    expect(canonicalPayrollPaymentDate("2026-12")).toBe("2026-12-31");
    expect(canonicalPayrollPaymentDate("2027-02")).toBe("2027-02-28");
    expect(canonicalPayrollPaymentDate("2028-02")).toBe("2028-02-29");
    expect(canonicalPayrollPaymentDate("2026-04")).toBe("2026-04-30");
  });

  it("addPeriodMonths wraps year boundaries in BOTH directions without drift", () => {
    expect(addPeriodMonths("2026-01", -1)).toBe("2025-12");
    expect(addPeriodMonths("2026-12", 1)).toBe("2027-01");
    expect(addPeriodMonths("2026-10", 3)).toBe("2027-01");
    // A malformed period passes through untouched (total function).
    expect(addPeriodMonths("not-a-period", 2)).toBe("not-a-period");
  });
});

// ---------------------------------------------------------------------------
// R2-2 / R2-3 — eligibility boundaries and salary hygiene
// ---------------------------------------------------------------------------

describe("T-412 R2 — eligibility boundary conditions", () => {
  const NOW = nowIn("2026-10");

  it("a hireDate exactly ON the period's last day is ELIGIBLE for that month (the no-proration convention)", () => {
    // Hired 2026-11-30 → eligible for November 2026 (last day, inclusive).
    const hiredOnLastDay = person("p1", 100_000, { hireDate: "2026-11-30" });
    const forecast = computePayrollForecast({
      personnel: [hiredOnLastDay],
      salaryPayments: [],
      now: NOW,
      horizonMonths: 2,
    });
    const nov = forecast.waves.find((w) => w.period === "2026-11");
    expect(nov).toBeDefined();
    expect(nov?.personnelCount).toBe(1);
    expect(nov?.expectedPayroll).toBe(100_000);
  });

  it("a hireDate one day AFTER the period's last day is NOT eligible for that month", () => {
    const hiredTooLate = person("p1", 100_000, { hireDate: "2026-12-01" });
    const forecast = computePayrollForecast({
      personnel: [hiredTooLate],
      salaryPayments: [],
      now: NOW,
      horizonMonths: 2,
    });
    const nov = forecast.waves.find((w) => w.period === "2026-11");
    expect(nov).toBeUndefined(); // nothing reconstructable → no November wave
    const dec = forecast.waves.find((w) => w.period === "2026-12");
    expect(dec?.personnelCount).toBe(1);
  });

  it("a terminationDate exactly ON the period's FIRST day still counts as eligible (terminated BEFORE the period = strictly before)", () => {
    const terminatedOnFirstDay = person("p1", 100_000, {
      terminationDate: "2026-11-01",
    });
    const forecast = computePayrollForecast({
      personnel: [terminatedOnFirstDay],
      salaryPayments: [],
      now: NOW,
      horizonMonths: 2,
    });
    const nov = forecast.waves.find((w) => w.period === "2026-11");
    expect(nov?.personnelCount).toBe(1);
    const dec = forecast.waves.find((w) => w.period === "2026-12");
    expect(dec).toBeUndefined();
  });

  it("a terminationDate one day BEFORE the period's first day excludes the person from that period onward", () => {
    const terminatedBefore = person("p1", 100_000, {
      terminationDate: "2026-10-31",
    });
    const forecast = computePayrollForecast({
      personnel: [terminatedBefore],
      salaryPayments: [],
      now: NOW,
      horizonMonths: 1,
    });
    // October (current): termination 10-31 is NOT before 10-01 → still eligible.
    const oct = forecast.waves.find((w) => w.period === "2026-10");
    expect(oct?.personnelCount).toBe(1);
    // November: termination 10-31 < 11-01 → excluded, and with zero eligible
    // staff the November wave disappears entirely.
    const nov = forecast.waves.find((w) => w.period === "2026-11");
    expect(nov).toBeUndefined();
  });

  it("salaries of 0, negative and null are ALL excluded from the expected payroll", () => {
    const roster = [
      person("ok", 100_000),
      person("zero", 0),
      person("negative", -50_000),
      person("nullish", null),
    ];
    const forecast = computePayrollForecast({
      personnel: roster,
      salaryPayments: [],
      now: NOW,
    });
    const current = forecast.waves.find((w) => w.period === "2026-10");
    expect(current?.personnelCount).toBe(1);
    expect(current?.expectedPayroll).toBe(100_000);
    expect(current?.breakdown.map((b) => b.personnelId)).toEqual(["ok"]);
  });
});

// ---------------------------------------------------------------------------
// R2-4 — disbursement-row hygiene
// ---------------------------------------------------------------------------

describe("T-412 R2 — disbursement-row hygiene", () => {
  const NOW = nowIn("2026-10");

  it("rows with malformed periods are ignored (no wave, no sums)", () => {
    const roster = [person("p1", 100_000)];
    const rows = [
      payment("p1", "2026-13", 999_999, "paid", "2026-10-05"), // month 13
      payment("p1", "2026-1", 888_888, "paid", "2026-10-05"), // 1-digit month
      payment("p1", "invalid", 777_777, "paid", "2026-10-05"),
      payment("p1", "2026-10", 40_000, "paid", "2026-10-28"), // the real one
    ];
    const forecast = computePayrollForecast({
      personnel: roster,
      salaryPayments: rows,
      now: NOW,
    });
    const current = forecast.waves.find((w) => w.period === "2026-10");
    expect(current?.securedAmount).toBe(40_000);
    expect(current?.remainingFundingRequirement).toBe(60_000);
    // No fabricated waves for the malformed periods.
    expect(forecast.waves.some((w) => !/^\d{4}-\d{2}$/.test(w.period))).toBe(
      false,
    );
  });

  it("duplicate rows for the same person+period are SUMMED (both count as committed funds)", () => {
    const roster = [person("p1", 100_000)];
    const rows = [
      payment("p1", "2026-10", 30_000, "paid", "2026-10-27"),
      payment("p1", "2026-10", 20_000, "paid", "2026-10-28"), // second tranche
    ];
    const forecast = computePayrollForecast({
      personnel: roster,
      salaryPayments: rows,
      now: NOW,
    });
    const current = forecast.waves.find((w) => w.period === "2026-10");
    expect(current?.securedAmount).toBe(50_000);
    expect(current?.actualPaid).toBe(50_000);
    expect(current?.readiness).toBe("partial");
    // The per-personnel breakdown carries the summed figure too.
    expect(current?.breakdown[0]?.disbursedForPeriod).toBe(50_000);
  });

  it("UNPAID rows never count as secured or actual (only paid + pending are committed)", () => {
    const roster = [person("p1", 100_000)];
    const rows = [
      payment("p1", "2026-10", 60_000, "unpaid"),
      payment("p1", "2026-10", 10_000, "pending"),
    ];
    const forecast = computePayrollForecast({
      personnel: roster,
      salaryPayments: rows,
      now: NOW,
    });
    const current = forecast.waves.find((w) => w.period === "2026-10");
    expect(current?.securedAmount).toBe(10_000);
    expect(current?.actualPaid).toBe(0);
    expect(current?.readiness).toBe("partial");
    expect(current?.remainingFundingRequirement).toBe(90_000);
  });

  it("a PENDING row's paymentDate never becomes the wave's actual payment date (only PAID rows do)", () => {
    const roster = [person("p1", 100_000)];
    const rows = [
      payment("p1", "2026-10", 10_000, "pending", "2026-10-15"),
    ];
    const forecast = computePayrollForecast({
      personnel: roster,
      salaryPayments: rows,
      now: NOW,
    });
    const current = forecast.waves.find((w) => w.period === "2026-10");
    // No paid row → the canonical convention (last calendar day) applies.
    expect(current?.paymentDate).toBe("2026-10-31");
  });
});

// ---------------------------------------------------------------------------
// R2-5 — the 30-day funding window's exact boundary
// ---------------------------------------------------------------------------

describe("T-412 R2 — the 30-day funding window boundary", () => {
  it("a wave due in EXACTLY 30 days is inside the window; 30 days + 1 hour is outside", () => {
    const roster = [person("p1", 100_000)];
    // The October wave's due instant is 2026-10-31T23:59:59Z (the canonical
    // last-day convention). `now` exactly 30 days earlier → dueMs − nowMs
    // === THIRTY_DAYS_MS to the millisecond → INCLUDED (<=).
    // (In Algiers both instants fall inside October — current period 2026-10.)
    const nowExact = new Date("2026-10-01T23:59:59Z");
    const a = computePayrollForecast({
      personnel: roster,
      salaryPayments: [],
      now: nowExact,
      horizonMonths: 1,
    });
    expect(a.totals.requiredCash30d).toBe(100_000); // October in, November out

    // One hour EARLIER → the October wave is 30d1h away → EXCLUDED; the
    // November wave (59d away) is out too → an honest zero.
    const nowEarlier = new Date("2026-10-01T22:59:59Z");
    const b = computePayrollForecast({
      personnel: roster,
      salaryPayments: [],
      now: nowEarlier,
      horizonMonths: 1,
    });
    expect(b.totals.requiredCash30d).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// R2-6 — overdue carry-over capping
// ---------------------------------------------------------------------------

describe("T-412 R2 — the overdue carry-over respects the history window", () => {
  it("a disbursement gap longer than historyMonths emits ONLY the in-window overdue waves", () => {
    const roster = [person("p1", 100_000)];
    // Last recorded disbursement: 2026-04. Current period: 2026-10.
    // historyMonths = 12 → historyFloor = 2025-10 → May..Sep are all in-window.
    const rows = [payment("p1", "2026-04", 100_000, "paid", "2026-04-30")];
    const forecast = computePayrollForecast({
      personnel: roster,
      salaryPayments: rows,
      now: nowIn("2026-10"),
      horizonMonths: 0,
      historyMonths: 12,
    });
    const overdue = forecast.waves.filter((w) => w.phase === "overdue");
    expect(overdue.map((w) => w.period)).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
    // Every overdue wave is unfunded (readiness, not just phase).
    expect(overdue.every((w) => w.readiness === "unfunded")).toBe(true);
    // The earliest underfunded wave (May) is the next funding wave.
    expect(forecast.totals.nextFundingWave?.period).toBe("2026-05");

    // With historyMonths = 2 → historyFloor = 2026-08 → only Aug + Sep.
    const capped = computePayrollForecast({
      personnel: roster,
      salaryPayments: rows,
      now: nowIn("2026-10"),
      horizonMonths: 0,
      historyMonths: 2,
    });
    expect(
      capped.waves.filter((w) => w.phase === "overdue").map((w) => w.period),
    ).toEqual(["2026-08", "2026-09"]);
  });

  it("a last recorded period EQUAL to the current period emits NO overdue wave", () => {
    const roster = [person("p1", 100_000)];
    const rows = [payment("p1", "2026-10", 100_000, "paid", "2026-10-30")];
    const forecast = computePayrollForecast({
      personnel: roster,
      salaryPayments: rows,
      now: nowIn("2026-10"),
      horizonMonths: 1,
    });
    expect(forecast.waves.some((w) => w.phase === "overdue")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// R2-7 — the owner's example, mixed-salary variant
// ---------------------------------------------------------------------------

describe("T-412 R2 — the 30-employee example, MIXED salaries", () => {
  it("30 staff with 30 distinct salaries → expected = Σ salaries exactly (never 30×mean)", () => {
    const salaries = Array.from(
      { length: 30 },
      (_, i) => 800_000 + i * 5_000,
    );
    const roster = salaries.map((s, i) => person(`p${i}`, s));
    const forecast = computePayrollForecast({
      personnel: roster,
      salaryPayments: [],
      now: nowIn("2026-10"),
      horizonMonths: 0,
    });
    const current = forecast.waves.find((w) => w.period === "2026-10");
    const sum = salaries.reduce((a, b) => a + b, 0);
    expect(current?.personnelCount).toBe(30);
    expect(current?.expectedPayroll).toBe(sum);
    expect(current?.requiredCash).toBe(sum);
    expect(current?.remainingFundingRequirement).toBe(sum);
    // The per-personnel breakdown is complete and exact.
    expect(current?.breakdown.length).toBe(30);
    expect(current?.breakdown.reduce((s, b) => s + b.baseSalary, 0)).toBe(sum);
  });
});

// ---------------------------------------------------------------------------
// R2-8 — multiple partial disbursements across multiple waves
// ---------------------------------------------------------------------------

describe("T-412 R2 — partial disbursements across MULTIPLE waves", () => {
  it("each wave's remaining is independent: 10M/30M in October and 5M/30M in November", () => {
    const roster = [
      person("a", 15_000_000),
      person("b", 15_000_000),
    ];
    const rows = [
      payment("a", "2026-10", 10_000_000, "paid", "2026-10-29"),
      payment("a", "2026-11", 5_000_000, "paid", "2026-11-28"),
    ];
    const forecast = computePayrollForecast({
      personnel: roster,
      salaryPayments: rows,
      now: nowIn("2026-10"),
      horizonMonths: 1,
    });
    const oct = forecast.waves.find((w) => w.period === "2026-10");
    const nov = forecast.waves.find((w) => w.period === "2026-11");
    expect(oct?.securedAmount).toBe(10_000_000);
    expect(oct?.remainingFundingRequirement).toBe(20_000_000);
    expect(oct?.readiness).toBe("partial");
    expect(nov?.securedAmount).toBe(5_000_000);
    expect(nov?.remainingFundingRequirement).toBe(25_000_000);
    expect(nov?.readiness).toBe("partial");
    // Totals: both waves' requirements; only the October wave is inside the
    // 30-day window from Oct 14 (November 30 is 47 days away).
    expect(forecast.totals.totalRemainingFunding).toBe(45_000_000);
    expect(forecast.totals.requiredCash30d).toBe(20_000_000);
  });
});

// ---------------------------------------------------------------------------
// R2-9 — a roster that starts NEXT month
// ---------------------------------------------------------------------------

describe("T-412 R2 — no current-eligible roster (all hired next month)", () => {
  it("no current wave; upcoming waves exist; totals fall back honestly", () => {
    const roster = [person("p1", 120_000, { hireDate: "2026-11-05" })];
    const forecast = computePayrollForecast({
      personnel: roster,
      salaryPayments: [],
      now: nowIn("2026-10"),
      horizonMonths: 2,
    });
    expect(forecast.waves.find((w) => w.period === "2026-10")).toBeUndefined();
    const nov = forecast.waves.find((w) => w.period === "2026-11");
    expect(nov?.personnelCount).toBe(1);
    expect(forecast.totals.securedCurrentPeriod).toBe(0);
    // projectedMonthlyPayroll falls back to the first UPCOMING wave.
    expect(forecast.totals.projectedMonthlyPayroll).toBe(120_000);
  });
});

// ---------------------------------------------------------------------------
// R2-10 — a historical period carrying only pending rows
// ---------------------------------------------------------------------------

describe("T-412 R2 — historical honesty with pending-only periods", () => {
  it("a past period with ONLY pending rows surfaces with actualPaid 0 (no fabrication)", () => {
    const roster = [person("p1", 100_000)];
    const rows = [
      payment("p1", "2026-08", 100_000, "pending", "2026-08-30"),
      payment("p1", "2026-09", 100_000, "paid", "2026-09-29"),
    ];
    const forecast = computePayrollForecast({
      personnel: roster,
      salaryPayments: rows,
      now: nowIn("2026-10"),
      horizonMonths: 0,
      historyMonths: 12,
    });
    const aug = forecast.waves.find((w) => w.period === "2026-08");
    expect(aug?.phase).toBe("historical");
    expect(aug?.actualPaid).toBe(0); // pending is NOT an actual outflow
    expect(aug?.expectedPayroll).toBe(0); // the honest actuals-basis figure
    const sep = forecast.waves.find((w) => w.period === "2026-09");
    expect(sep?.actualPaid).toBe(100_000);
    // The Statistics trend input mirrors the same honesty.
    const augPoint = forecast.historicalMonthly.find(
      (p) => p.period === "2026-08",
    );
    expect(augPoint?.actualPaid).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// R2-11 — rows dated beyond the forecast horizon
// ---------------------------------------------------------------------------

describe("T-412 R2 — payment rows beyond the horizon", () => {
  it("rows dated beyond current+horizon neither crash, nor fabricate a wave, nor leak into totals", () => {
    const roster = [person("p1", 100_000)];
    const rows = [
      payment("p1", "2027-06", 500_000, "paid", "2027-06-30"), // far future
    ];
    const forecast = computePayrollForecast({
      personnel: roster,
      salaryPayments: rows,
      now: nowIn("2026-10"),
      horizonMonths: 3,
    });
    expect(forecast.waves.some((w) => w.period === "2027-06")).toBe(false);
    // The in-window totals are untouched by the out-of-window row.
    expect(forecast.totals.totalRemainingFunding).toBe(400_000); // 4 waves × 100k
    // And the last projected period is exactly current+3.
    const projected = forecast.waves.filter((w) => w.phase !== "historical");
    expect(projected.at(-1)?.period).toBe("2027-01");
  });
});

// ---------------------------------------------------------------------------
// R2-12 — personnelCount per wave under roster changes
// ---------------------------------------------------------------------------

describe("T-412 R2 — personnelCount tracks the per-wave eligible roster", () => {
  it("a mid-horizon hire joins only from their hire month; a mid-horizon termination leaves after theirs", () => {
    const roster = [
      person("stay", 100_000),
      person("late", 50_000, { hireDate: "2026-12-10" }),
      person("gone", 50_000, { terminationDate: "2026-11-15" }),
    ];
    const forecast = computePayrollForecast({
      personnel: roster,
      salaryPayments: [],
      now: nowIn("2026-10"),
      horizonMonths: 3,
    });
    const counts = Object.fromEntries(
      forecast.waves
        .filter((w) => w.phase !== "historical")
        .map((w) => [w.period, w.personnelCount]),
    );
    // Oct: stay + gone (late not hired yet).
    // Nov: stay + gone (terminated 11-15, NOT before 11-01).
    // Dec: stay + late (gone terminated before 12-01).
    // Jan: stay + late.
    expect(counts).toEqual({
      "2026-10": 2,
      "2026-11": 2,
      "2026-12": 2,
      "2027-01": 2,
    });
    // And the expected payrolls follow the same roster movement.
    const oct = forecast.waves.find((w) => w.period === "2026-10");
    const dec = forecast.waves.find((w) => w.period === "2026-12");
    expect(oct?.expectedPayroll).toBe(150_000);
    expect(dec?.expectedPayroll).toBe(150_000);
  });
});

// ---------------------------------------------------------------------------
// R2-13 — nextFundingWave ordering with an overdue carry-over
// ---------------------------------------------------------------------------

describe("T-412 R2 — nextFundingWave prefers the earliest underfunded wave (overdue included)", () => {
  it("with an unfunded overdue wave and a partially-funded current wave, the OVERDUE one is next", () => {
    const roster = [person("p1", 100_000)];
    const rows = [
      payment("p1", "2026-07", 100_000, "paid", "2026-07-30"), // gap: Aug, Sep
      payment("p1", "2026-10", 40_000, "paid", "2026-10-20"), // partial current
    ];
    const forecast = computePayrollForecast({
      personnel: roster,
      salaryPayments: rows,
      now: nowIn("2026-10"),
      horizonMonths: 1,
    });
    expect(forecast.totals.nextFundingWave?.period).toBe("2026-08");
    expect(forecast.totals.nextFundingWave?.readiness).toBe("unfunded");
    // The owed carry-over is inside the funding totals (not deferred).
    expect(forecast.totals.totalRemainingFunding).toBe(360_000); // 100+100+60+100
  });
});

// ---------------------------------------------------------------------------
// R2-14 — cross-surface restatement parity on a ROSTER change
// ---------------------------------------------------------------------------

describe("T-412 R2 — cross-surface restatement parity on a salary change", () => {
  it("a raise restates the Personnel wave figure, the Finance totals and the Statistics trend to IDENTICAL values", () => {
    const runForecast = (salary: number) =>
      computePayrollForecast({
        personnel: [person("p1", salary)],
        salaryPayments: [payment("p1", "2026-10", 30_000, "paid", "2026-10-28")],
        now: nowIn("2026-10"),
        horizonMonths: 1,
      });

    const before = runForecast(100_000);
    const after = runForecast(130_000); // a +30k raise

    // Personnel's wave figure (what the table shows):
    const waveBefore = before.waves.find((w) => w.period === "2026-10");
    const waveAfter = after.waves.find((w) => w.period === "2026-10");
    expect(waveBefore?.remainingFundingRequirement).toBe(70_000);
    expect(waveAfter?.remainingFundingRequirement).toBe(100_000);

    // Finance's totals block (payroll-funding-card's inputs). NOTE: from
    // Oct 14, November 30 is 47 days away → outside the 30-day window, so
    // requiredCash30d carries only the October wave's requirement.
    expect(after.totals.totalRemainingFunding).toBe(230_000); // 100k + 130k
    expect(after.totals.requiredCash30d).toBe(100_000);
    expect(after.totals.securedCurrentPeriod).toBe(30_000);
    expect(after.totals.projectedMonthlyPayroll).toBe(130_000);

    // Statistics' trend (derivePayrollCostTrend over the SAME forecast):
    const trend = derivePayrollCostTrend(after);
    const octPoint = trend.monthly.find((p) => p.period === "2026-10");
    const novPoint = trend.monthly.find((p) => p.period === "2026-11");
    expect(octPoint?.fundingRequirement).toBe(
      waveAfter?.remainingFundingRequirement,
    );
    expect(novPoint?.fundingRequirement).toBe(130_000);
    expect(trend.totals.projectedMonthlyPayroll).toBe(
      after.totals.projectedMonthlyPayroll,
    );
    // Σ monthly funding requirements === the Finance block total.
    expect(
      trend.monthly.reduce((s, p) => s + p.fundingRequirement, 0),
    ).toBe(after.totals.totalRemainingFunding);
  });
});
