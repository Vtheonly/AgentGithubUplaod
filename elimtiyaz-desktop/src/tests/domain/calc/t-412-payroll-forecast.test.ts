/**
 * T-412 — the canonical payroll forecast engine's unit suite (96th session).
 *
 * Pins the ADR-024 semantics:
 *   1. The owner's stated example — 30 employees → 30M DZD required before
 *      each payroll date (30 × 1,000,000).
 *   2. Multiple waves (current + horizon), chronological, with the canonical
 *      last-day-of-month payment date.
 *   3. The four distinguished figures: expected payroll / required cash /
 *      secured-reserved / remaining funding requirement.
 *   4. Readiness derivation: upcoming → partial → settled; unfunded when the
 *      canonical date has passed with nothing disbursed.
 *   5. Automatic reflection of personnel changes: salary raises, status
 *      changes, terminations, future hires — the engine is pure, the numbers
 *      follow the inputs.
 *   6. Historical waves carry ACTUALS only (no anachronistic projection);
 *      pending transfers are secured but not actual outflow.
 *   7. Honest empty state (§15.49a): no staff → no waves, zero totals.
 */
import { describe, it, expect } from "vitest";
import {
  computePayrollForecast,
  currentPayrollPeriod,
  addPeriodMonths,
  canonicalPayrollPaymentDate,
  periodQuarter,
  type PayrollForecastPersonnelInput,
  type SalaryPaymentForecastInput,
} from "../../../domain/calc/payroll/payroll-forecast";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makePerson(
  overrides: Partial<PayrollForecastPersonnelInput> = {},
): PayrollForecastPersonnelInput {
  return {
    id: overrides.id ?? "per-1",
    firstName: overrides.firstName ?? "Amina",
    lastName: overrides.lastName ?? "Probe",
    staffCategory: overrides.staffCategory ?? "teacher",
    position: overrides.position ?? "Professeur",
    // NOTE: `salary` must pass null/0 through — `?? default` would coerce
    // null to 1M (the classic nullish-default trap caught while writing this).
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

/** 30 employees × 1,000,000 DZD — the owner's stated example. */
function thirtyEmployees(): PayrollForecastPersonnelInput[] {
  return Array.from({ length: 30 }, (_, i) =>
    makePerson({ id: `per-${i + 1}`, firstName: `Emp${i + 1}` }),
  );
}

// Reference time: 2026-09-15 12:00 UTC → 2026-09 in Africa/Algiers (UTC+1).
const NOW = new Date("2026-09-15T12:00:00Z");

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------

describe("T-412 — payroll period helpers (pure)", () => {
  it("derives the current period in Africa/Algiers (the Payroll tab convention)", () => {
    // 2026-09-15T23:30Z is already 2026-09-16 00:30 in Algiers (UTC+1) — same month.
    expect(currentPayrollPeriod(new Date("2026-09-15T23:30:00Z"))).toBe("2026-09");
    // 2026-09-30T22:30Z is 2026-09-30 23:30 in Algiers — still September.
    expect(currentPayrollPeriod(new Date("2026-09-30T22:30:00Z"))).toBe("2026-09");
    // 2026-09-30T23:30Z is already 2026-10-01 00:30 in Algiers — October.
    expect(currentPayrollPeriod(new Date("2026-09-30T23:30:00Z"))).toBe("2026-10");
  });

  it("shifts periods across year boundaries without drift", () => {
    expect(addPeriodMonths("2026-09", 1)).toBe("2026-10");
    expect(addPeriodMonths("2026-12", 1)).toBe("2027-01");
    expect(addPeriodMonths("2027-01", -1)).toBe("2026-12");
    expect(addPeriodMonths("2026-09", -12)).toBe("2025-09");
  });

  it("computes the canonical payment date as the LAST calendar day (incl. leap years)", () => {
    expect(canonicalPayrollPaymentDate("2026-09")).toBe("2026-09-30");
    expect(canonicalPayrollPaymentDate("2026-10")).toBe("2026-10-31");
    expect(canonicalPayrollPaymentDate("2026-02")).toBe("2026-02-28");
    expect(canonicalPayrollPaymentDate("2028-02")).toBe("2028-02-29");
    expect(canonicalPayrollPaymentDate("2026-12")).toBe("2026-12-31");
  });

  it("derives the Statistics quarterly aggregation", () => {
    expect(periodQuarter("2026-01")).toBe(1);
    expect(periodQuarter("2026-04")).toBe(2);
    expect(periodQuarter("2026-09")).toBe(3);
    expect(periodQuarter("2026-12")).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// The owner's example + the core semantics
// ---------------------------------------------------------------------------

describe("T-412 — computePayrollForecast: the 30-employee example", () => {
  it("30 employees × 1M DZD → 30M DZD expected, required and remaining before each payroll date", () => {
    const forecast = computePayrollForecast({
      personnel: thirtyEmployees(),
      salaryPayments: [],
      now: NOW,
    });

    const current = forecast.waves.find((w) => w.phase === "current");
    expect(current).toBeDefined();
    expect(current!.personnelCount).toBe(30);
    expect(current!.expectedPayroll).toBe(30_000_000);
    expect(current!.requiredCash).toBe(30_000_000);
    expect(current!.securedAmount).toBe(0);
    expect(current!.remainingFundingRequirement).toBe(30_000_000);
    expect(current!.readiness).toBe("upcoming");
    expect(current!.paymentDate).toBe("2026-09-30"); // canonical last day

    expect(forecast.totals.projectedMonthlyPayroll).toBe(30_000_000);
    expect(forecast.totals.totalRemainingFunding).toBe(4 * 30_000_000); // current + 3 upcoming
    expect(forecast.totals.nextFundingWave?.period).toBe("2026-09");
  });

  it("produces multiple waves — current + 3 upcoming by default, chronological", () => {
    const forecast = computePayrollForecast({
      personnel: thirtyEmployees(),
      salaryPayments: [],
      now: NOW,
    });

    const projected = forecast.waves.filter(
      (w) => w.phase === "current" || w.phase === "upcoming",
    );
    expect(projected.map((w) => w.period)).toEqual([
      "2026-09",
      "2026-10",
      "2026-11",
      "2026-12",
    ]);
    // Chronological overall ordering is invariant.
    const periods = forecast.waves.map((w) => w.period);
    expect([...periods].sort()).toEqual(periods);
  });

  it("honours a custom horizon (5 upcoming waves)", () => {
    const forecast = computePayrollForecast({
      personnel: thirtyEmployees(),
      salaryPayments: [],
      now: NOW,
      horizonMonths: 5,
    });
    const projected = forecast.waves.filter((w) => w.phase !== "historical");
    expect(projected).toHaveLength(6); // current + 5
    expect(projected.at(-1)!.period).toBe("2027-02");
  });
});

describe("T-412 — the four distinguished figures (ADR-024 vocabulary)", () => {
  it("partial disbursement: 10M paid of 30M → secured 10M, remaining 20M, readiness partial", () => {
    const forecast = computePayrollForecast({
      personnel: thirtyEmployees(),
      salaryPayments: [
        makePayment({ personnelId: "per-1", netPaid: 4_000_000 }),
        makePayment({ personnelId: "per-2", netPaid: 3_000_000 }),
        makePayment({ personnelId: "per-3", netPaid: 3_000_000 }),
      ],
      now: NOW,
    });

    const current = forecast.waves.find((w) => w.phase === "current")!;
    expect(current.securedAmount).toBe(10_000_000);
    expect(current.remainingFundingRequirement).toBe(20_000_000);
    expect(current.readiness).toBe("partial");
    expect(current.actualPaid).toBe(10_000_000); // all three rows are paid
    expect(forecast.totals.securedCurrentPeriod).toBe(10_000_000);
  });

  it("pending transfers are SECURED (reserved) but NOT actual outflow", () => {
    const forecast = computePayrollForecast({
      personnel: thirtyEmployees(),
      salaryPayments: [
        makePayment({ personnelId: "per-1", netPaid: 5_000_000, status: "pending", paymentDate: null }),
        makePayment({ personnelId: "per-2", netPaid: 5_000_000, status: "paid" }),
      ],
      now: NOW,
    });

    const current = forecast.waves.find((w) => w.phase === "current")!;
    expect(current.securedAmount).toBe(10_000_000); // paid + pending = committed
    expect(current.actualPaid).toBe(5_000_000); // only the cleared row
    expect(current.remainingFundingRequirement).toBe(20_000_000);
  });

  it("full settlement: remaining 0, readiness settled, next funding wave = the next month", () => {
    const payments = Array.from({ length: 30 }, (_, i) =>
      makePayment({ personnelId: `per-${i + 1}`, netPaid: 1_000_000 }),
    );
    const forecast = computePayrollForecast({
      personnel: thirtyEmployees(),
      salaryPayments: payments,
      now: NOW,
    });

    const current = forecast.waves.find((w) => w.phase === "current")!;
    expect(current.remainingFundingRequirement).toBe(0);
    expect(current.readiness).toBe("settled");
    expect(forecast.totals.nextFundingWave?.period).toBe("2026-10");
  });

  it("unfunded: a MISSED payroll period surfaces as an overdue carry-over wave", () => {
    // August was disbursed through the system; September has NO rows; now =
    // October 3rd. The engine surfaces September as an "overdue" wave
    // (readiness "unfunded" — the canonical date passed with nothing paid)
    // so the missed obligation is not silently lost.
    const late = new Date("2026-10-03T12:00:00Z");
    const forecast = computePayrollForecast({
      personnel: thirtyEmployees(),
      salaryPayments: [
        makePayment({ period: "2026-08", personnelId: "per-1", netPaid: 1_000_000, paymentDate: "2026-08-28" }),
      ],
      now: late,
    });

    const sept = forecast.waves.find((w) => w.period === "2026-09");
    expect(sept).toBeDefined();
    expect(sept!.phase).toBe("overdue");
    expect(sept!.readiness).toBe("unfunded");
    expect(sept!.remainingFundingRequirement).toBe(30_000_000);
    // The overdue wave leads the funding queue (most urgent).
    expect(forecast.totals.nextFundingWave?.period).toBe("2026-09");
    // ...and counts in the 30-day requirement (its date already passed).
    expect(forecast.totals.requiredCash30d).toBeGreaterThanOrEqual(30_000_000);
  });

  it("zero disbursement history fabricates NO overdue wave (fresh-install guard)", () => {
    const late = new Date("2026-10-03T12:00:00Z");
    const forecast = computePayrollForecast({
      personnel: thirtyEmployees(),
      salaryPayments: [],
      now: late,
    });

    // September cannot be claimed as "missed" — the system has no evidence
    // payroll ever started (nothing is fabricated, §15.49a).
    expect(forecast.waves.find((w) => w.period === "2026-09")).toBeUndefined();
    expect(forecast.totals.nextFundingWave?.period).toBe("2026-10");
  });

  it("requiredCash30d counts only waves due within the 30-day window", () => {
    const forecast = computePayrollForecast({
      personnel: thirtyEmployees(),
      salaryPayments: [],
      now: NOW, // 2026-09-15 → Sept 30 due in 15 days; Oct 31 due in 46 days
    });

    expect(forecast.totals.requiredCash30d).toBe(30_000_000); // Sept only
  });
});

// ---------------------------------------------------------------------------
// Automatic reflection of personnel changes (pure function over the streams)
// ---------------------------------------------------------------------------

describe("T-412 — changing personnel / payroll totals", () => {
  it("a salary raise raises every projected wave by exactly the delta", () => {
    const before = computePayrollForecast({
      personnel: thirtyEmployees(),
      salaryPayments: [],
      now: NOW,
    });
    const after = computePayrollForecast({
      personnel: thirtyEmployees().map((p, i) =>
        i === 0 ? { ...p, salary: 1_200_000 } : p,
      ),
      salaryPayments: [],
      now: NOW,
    });

    for (const wave of after.waves.filter((w) => w.phase !== "historical")) {
      const beforeWave = before.waves.find((w) => w.period === wave.period)!;
      expect(wave.expectedPayroll).toBe(beforeWave.expectedPayroll + 200_000);
    }
  });

  it("a mid-horizon hire joins only the waves from their hire month onward", () => {
    const personnel = [
      ...thirtyEmployees(),
      makePerson({ id: "per-new", hireDate: "2026-11-05", salary: 900_000 }),
    ];
    const forecast = computePayrollForecast({
      personnel,
      salaryPayments: [],
      now: NOW,
    });

    const sept = forecast.waves.find((w) => w.period === "2026-09")!;
    const oct = forecast.waves.find((w) => w.period === "2026-10")!;
    const nov = forecast.waves.find((w) => w.period === "2026-11")!;
    expect(sept.personnelCount).toBe(30);
    expect(oct.personnelCount).toBe(30);
    expect(nov.personnelCount).toBe(31);
    expect(nov.expectedPayroll).toBe(30_900_000);
    // The new hire appears in Nov's breakdown only.
    expect(nov.breakdown.some((b) => b.personnelId === "per-new")).toBe(true);
    expect(oct.breakdown.some((b) => b.personnelId === "per-new")).toBe(false);
  });

  it("a termination date excludes the person from waves starting after it", () => {
    const personnel = thirtyEmployees().map((p, i) =>
      i === 0 ? { ...p, terminationDate: "2026-10-15" } : p,
    );
    const forecast = computePayrollForecast({
      personnel,
      salaryPayments: [],
      now: NOW,
    });

    const sept = forecast.waves.find((w) => w.period === "2026-09")!;
    const oct = forecast.waves.find((w) => w.period === "2026-10")!;
    const nov = forecast.waves.find((w) => w.period === "2026-11")!;
    // Still on payroll in September AND October (termination 2026-10-15 is
    // after October's period start → the October wave still owes them).
    expect(sept.personnelCount).toBe(30);
    expect(oct.personnelCount).toBe(30);
    // Gone from November onward.
    expect(nov.personnelCount).toBe(29);
    expect(nov.expectedPayroll).toBe(29_000_000);
  });

  it("non-active statuses are excluded (the PayrollManagement canonical basis)", () => {
    const personnel = [
      ...thirtyEmployees().slice(0, 28),
      makePerson({ id: "per-leave", status: "on_leave" }),
      makePerson({ id: "per-susp", status: "suspended" }),
      makePerson({ id: "per-arch", status: "archived" }),
      makePerson({ id: "per-nosal", salary: null }),
      makePerson({ id: "per-zero", salary: 0 }),
    ];
    const forecast = computePayrollForecast({
      personnel,
      salaryPayments: [],
      now: NOW,
    });

    const current = forecast.waves.find((w) => w.phase === "current")!;
    expect(current.personnelCount).toBe(28);
    expect(current.expectedPayroll).toBe(28_000_000);
  });

  it("recording more disbursements shrinks the remaining requirement (idempotent stream changes)", () => {
    const run = (payments: SalaryPaymentForecastInput[]) =>
      computePayrollForecast({
        personnel: thirtyEmployees(),
        salaryPayments: payments,
        now: NOW,
      }).totals.totalRemainingFunding;

    expect(run([])).toBe(120_000_000);
    expect(
      run([makePayment({ personnelId: "per-1", netPaid: 1_000_000 })]),
    ).toBe(119_000_000);
    expect(
      run(
        Array.from({ length: 15 }, (_, i) =>
          makePayment({ personnelId: `per-${i + 1}`, netPaid: 1_000_000 }),
        ),
      ),
    ).toBe(105_000_000);
  });
});

// ---------------------------------------------------------------------------
// Historical vs projected + honesty rules
// ---------------------------------------------------------------------------

describe("T-412 — historical waves carry ACTUALS (no anachronistic projection)", () => {
  it("past periods derive from the real salary_payments rows only", () => {
    const forecast = computePayrollForecast({
      personnel: thirtyEmployees(),
      salaryPayments: [
        makePayment({ period: "2026-07", personnelId: "per-1", netPaid: 900_000, paymentDate: "2026-07-29" }),
        makePayment({ period: "2026-07", personnelId: "per-2", netPaid: 850_000, paymentDate: "2026-07-30" }),
        makePayment({ period: "2026-08", personnelId: "per-1", netPaid: 950_000, paymentDate: "2026-08-28" }),
      ],
      now: NOW,
    });

    const july = forecast.waves.find((w) => w.period === "2026-07")!;
    expect(july.phase).toBe("historical");
    expect(july.actualPaid).toBe(1_750_000);
    expect(july.personnelCount).toBe(2); // distinct paid personnel
    expect(july.paymentDate).toBe("2026-07-30"); // the LATEST actual date
    expect(july.remainingFundingRequirement).toBe(0);
    expect(july.readiness).toBe("settled");
    expect(july.breakdown).toEqual([]); // no fabricated per-personnel projection

    const august = forecast.waves.find((w) => w.period === "2026-08")!;
    expect(august.actualPaid).toBe(950_000);

    // The Statistics trend input (oldest first, real data only).
    expect(forecast.historicalMonthly.map((m) => m.period)).toEqual([
      "2026-07",
      "2026-08",
    ]);
    expect(forecast.historicalMonthly[0].actualPaid).toBe(1_750_000);
  });

  it("caps the history window (historyMonths) and ignores out-of-window periods", () => {
    const old = Array.from({ length: 3 }, (_, i) =>
      makePayment({ period: `2025-0${i + 1}`, personnelId: "per-1", netPaid: 500_000 }),
    );
    const forecast = computePayrollForecast({
      personnel: thirtyEmployees(),
      salaryPayments: [
        ...old,
        makePayment({ period: "2026-06", personnelId: "per-1", netPaid: 700_000 }),
      ],
      now: NOW,
      historyMonths: 12, // floor = 2025-09 → the 2025-0x rows are out of window
    });

    expect(forecast.historicalMonthly.map((m) => m.period)).toEqual(["2026-06"]);
  });
});

describe("T-412 — honest empty states (§15.49a)", () => {
  it("no personnel → no waves, zeroed totals, no fabricated periods", () => {
    const forecast = computePayrollForecast({
      personnel: [],
      salaryPayments: [],
      now: NOW,
    });

    expect(forecast.waves).toEqual([]);
    expect(forecast.historicalMonthly).toEqual([]);
    expect(forecast.totals.nextFundingWave).toBeNull();
    expect(forecast.totals.totalRemainingFunding).toBe(0);
    expect(forecast.totals.requiredCash30d).toBe(0);
    expect(forecast.totals.projectedMonthlyPayroll).toBe(0);
  });

  it("historical actuals still surface when nobody is currently eligible", () => {
    // All former staff terminated — the real past disbursements remain visible.
    const personnel = thirtyEmployees().map((p) => ({
      ...p,
      status: "terminated" as const,
      terminationDate: "2026-08-31",
    }));
    const forecast = computePayrollForecast({
      personnel,
      salaryPayments: [
        makePayment({ period: "2026-08", personnelId: "per-1", netPaid: 1_000_000 }),
      ],
      now: NOW,
    });

    expect(forecast.waves.filter((w) => w.phase !== "historical")).toEqual([]);
    expect(forecast.historicalMonthly).toHaveLength(1);
    expect(forecast.historicalMonthly[0].actualPaid).toBe(1_000_000);
  });
});
