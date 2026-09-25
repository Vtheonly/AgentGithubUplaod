// ============================================================================
// FILE: src/domain/calc/payroll/payroll-forecast.ts
// ============================================================================
/**
 * Canonical Personnel Payroll Cash-Flow Forecast — T-412 (96th session,
 * 2026-09-25). ADR-024.
 *
 * This is the ONE canonical payroll/payment forecasting calculation for the
 * whole platform (AGENTS.md §15.53a — every analytical surface is a CONSUMER
 * of this engine, never a second implementation):
 *
 *   - Personnel  → the "Paiements du Personnel à Venir" section (operational)
 *   - Finance    → the pre-payroll funding requirements / treasury impact
 *                  (cash-management, the Diagnostic tab)
 *   - Statistics → the monthly/quarterly personnel-cost & funding-requirement
 *                  trends (planning, the dashboard Analytics tab)
 *
 * SEMANTIC VOCABULARY (ADR-024, binding — see also docs/domain/financial-rules.md §16):
 *   - Vague de paie (payroll wave)      — one monthly payroll period `YYYY-MM`.
 *   - Masse salariale attendue (expected payroll) — Σ current base salaries of
 *     the staff eligible for the period. Eligibility = the PayrollManagement
 *     canonical basis REUSED (§6 Existing-Implementation-First):
 *     `status === "active"` AND `salary > 0` AND hired on/before the period's
 *     last day AND not terminated before the period's first day.
 *   - Date de paiement canonique (canonical payment date) — the LAST CALENDAR
 *     DAY of the period month (deterministic forecast convention). Actual
 *     disbursement dates (`salary_payments.payment_date`) override it for
 *     historical waves — real data first.
 *   - Fonds requis (required cash)       — the expected payroll that must be
 *     available before the payment date.
 *   - Fonds sécurisés (secured/reserved) — Σ `net_paid` of the period's
 *     `paid` + `pending` disbursement rows (committed funds).
 *   - Besoin de financement restant (remaining funding requirement) —
 *     `max(0, expected − secured)`; this is THE "required funds before each
 *     payroll date" figure.
 *
 * HONESTY RULES (§15.49a / §15.16):
 *   - Zero fabricated numbers: the projection uses CURRENT base salaries only
 *     (future one-off bonuses/deductions are unknowable before they are
 *     recorded — rendered as a documented limitation by the consumers).
 *   - Empty inputs → empty outputs → honest empty states.
 *   - Months without any recorded disbursement read as 0 in the historical
 *     trend (no data is not silently invented).
 *
 * All functions are PURE and TOTAL (no IO, no React, no clock reads — the
 * reference time is always an explicit `now: Date` parameter).
 */
import type {
  PayrollMethod,
  PersonnelStatus,
  StaffCategory,
} from "../../model/personnel";

// ---------------------------------------------------------------------------
// Input contracts (structural subsets — the domain models are assignable)
// ---------------------------------------------------------------------------

/** The personnel fields the forecast needs (Personnel is structurally assignable). */
export interface PayrollForecastPersonnelInput {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly staffCategory: StaffCategory;
  readonly position: string;
  readonly salary: number | null;
  readonly paymentMethod: PayrollMethod | null;
  readonly hireDate: string;
  readonly terminationDate: string | null;
  readonly status: PersonnelStatus;
}

/** The salary-payment fields the forecast needs (SalaryPaymentRecord is assignable). */
export interface SalaryPaymentForecastInput {
  readonly personnelId: string;
  readonly period: string; // YYYY-MM
  readonly netPaid: number;
  readonly status: "paid" | "unpaid" | "pending";
  readonly paymentDate: string | null;
}

// ---------------------------------------------------------------------------
// Period helpers (pure, Africa/Algiers — the payroll tab's convention)
// ---------------------------------------------------------------------------

/** The payroll timezone (matches PAYROLL_PERIOD_OPTIONS in payroll-management.tsx). */
export const PAYROLL_TIMEZONE = "Africa/Algiers";

const PERIOD_RE = /^\d{4}-\d{2}$/;

/**
 * The payroll period (YYYY-MM) containing `now`, derived in Africa/Algiers
 * (the same Intl convention the Payroll tab's period selector uses — keeps
 * the forecast's "current period" identical to the operator's selected one).
 */
export function currentPayrollPeriod(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PAYROLL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  return `${year}-${month}`;
}

/**
 * Shifts a YYYY-MM period by `delta` months (negative = past).
 * Pure string→Date→string round-trip in UTC.
 */
export function addPeriodMonths(period: string, delta: number): string {
  if (!PERIOD_RE.test(period)) return period;
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * The canonical forecast payment date for a period — the LAST CALENDAR DAY
 * of the period month (ADR-024 clause 4; deterministic, documented).
 */
export function canonicalPayrollPaymentDate(period: string): string {
  if (!PERIOD_RE.test(period)) return `${period}-01`;
  const [y, m] = period.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month
  return `${period}-${String(lastDay).padStart(2, "0")}`;
}

/** First day (inclusive) of a period, ISO. */
function periodStartIso(period: string): string {
  return `${period}-01`;
}

/** The last calendar day of a period as an inclusive ISO bound. */
function periodLastDayIso(period: string): string {
  return canonicalPayrollPaymentDate(period);
}

/** French month label for a period ("sept. 2026") — the FR convention of the calc family. */
export function periodLabelFr(period: string): string {
  if (!PERIOD_RE.test(period)) return period;
  const [y, m] = period.split("-").map(Number);
  const labels = [
    "janv.", "févr.", "mars", "avr.", "mai", "juin",
    "juil.", "août", "sept.", "oct.", "nov.", "déc.",
  ];
  return `${labels[m - 1]} ${y}`;
}

/** Quarter (1-4) of a period — the Statistics quarterly aggregation basis. */
export function periodQuarter(period: string): number {
  if (!PERIOD_RE.test(period)) return 1;
  const m = Number(period.slice(5, 7));
  return Math.floor((m - 1) / 3) + 1;
}

// ---------------------------------------------------------------------------
// Output contracts
// ---------------------------------------------------------------------------

/** One personnel obligation behind a payroll wave (the detailed breakdown). */
export interface PayrollObligationEntry {
  readonly personnelId: string;
  readonly displayName: string;
  readonly position: string;
  readonly staffCategory: StaffCategory;
  /** Current base monthly salary (DZD) — the projected obligation. */
  readonly baseSalary: number;
  readonly paymentMethod: PayrollMethod | null;
  /** What has actually been disbursed to this person FOR THIS PERIOD (0 = nothing). */
  readonly disbursedForPeriod: number;
}

/** Wave phase relative to `now`. */
export type PayrollWavePhase = "historical" | "overdue" | "current" | "upcoming";

/** Payment readiness derivation (§ ADR-024 vocabulary). */
export type PayrollReadiness =
  | "settled" // secured ≥ expected — fully funded
  | "partial" // 0 < secured < expected
  | "unfunded" // secured = 0 AND the payment date has arrived/passed — a funding alert
  | "upcoming"; // secured = 0 AND the payment date is still in the future

export const PAYROLL_READINESS_LABELS_FR: Record<PayrollReadiness, string> = {
  settled: "Couvert",
  partial: "Partiellement couvert",
  unfunded: "Non financé",
  upcoming: "À venir",
};

/** One payroll wave (a monthly period with its obligations). */
export interface PayrollWave {
  readonly period: string; // YYYY-MM
  readonly phase: PayrollWavePhase;
  /** Canonical (future) or actual (historical) payment date, ISO. */
  readonly paymentDate: string;
  /** Eligible staff count behind the projection (0 for pure-history waves). */
  readonly personnelCount: number;
  /** Σ current base salaries of the eligible staff (expected payroll, DZD). */
  readonly expectedPayroll: number;
  /** The full obligation that must be funded before the payment date (DZD). */
  readonly requiredCash: number;
  /** Committed funds: Σ net_paid of paid + pending rows for the period (DZD). */
  readonly securedAmount: number;
  /** max(0, expectedPayroll − securedAmount) — THE pre-payroll funding requirement. */
  readonly remainingFundingRequirement: number;
  /** Σ net_paid of PAID rows for the period — the actual outflow evidence. */
  readonly actualPaid: number;
  readonly readiness: PayrollReadiness;
  /** The per-personnel breakdown behind the wave (empty for pure-history waves). */
  readonly breakdown: readonly PayrollObligationEntry[];
}

/** Monthly actual-payroll point for the Statistics trend (real data only). */
export interface PayrollActualMonthlyPoint {
  readonly period: string;
  readonly label: string;
  readonly actualPaid: number;
}

/** Aggregate totals derived from the waves (single source for all consumers). */
export interface PayrollForecastTotals {
  /** The nearest wave that still needs funding (current or later); null when all secured. */
  readonly nextFundingWave: PayrollWave | null;
  /** Σ remaining funding requirements of the current + upcoming waves (DZD). */
  readonly totalRemainingFunding: number;
  /** Remaining funding requirement of waves whose payment date is within 30 days (DZD). */
  readonly requiredCash30d: number;
  /** Secured funds for the current period (DZD) — the reserved-amount figure. */
  readonly securedCurrentPeriod: number;
  /** Steady-state planning number: the expected payroll of the next full month (DZD). */
  readonly projectedMonthlyPayroll: number;
}

export interface PayrollForecast {
  /** Chronological: [historical…][current][upcoming…]. */
  readonly waves: readonly PayrollWave[];
  /** Historical actuals, oldest first (the Statistics trend input). */
  readonly historicalMonthly: readonly PayrollActualMonthlyPoint[];
  readonly totals: PayrollForecastTotals;
}

// ---------------------------------------------------------------------------
// The canonical engine
// ---------------------------------------------------------------------------

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Computes the personnel payroll forecast — the ONE canonical calculation
 * (ADR-024). Pure and total over the two canonical streams.
 *
 * @param personnel       the personnel stream (repos.personnel.observe())
 * @param salaryPayments  the disbursement ledger (repos.personnel.observeSalaryPayments())
 * @param now             the reference time (explicit — no hidden clock)
 * @param horizonMonths   projected waves AFTER the current period (default 3)
 * @param historyMonths   past months of actuals to include (default 12)
 */
export function computePayrollForecast(params: {
  personnel: readonly PayrollForecastPersonnelInput[];
  salaryPayments: readonly SalaryPaymentForecastInput[];
  now: Date;
  horizonMonths?: number;
  historyMonths?: number;
}): PayrollForecast {
  const {
    personnel,
    salaryPayments,
    now,
    horizonMonths = 3,
    historyMonths = 12,
  } = params;

  const currentPeriod = currentPayrollPeriod(now);
  const nowMs = now.getTime();

  // ── Eligibility (the PayrollManagement canonical basis, REUSED) ─────────
  const isEligibleFor = (p: PayrollForecastPersonnelInput, period: string): boolean => {
    if (p.status !== "active") return false;
    if (p.salary == null || !(p.salary > 0)) return false;
    // Hired on/before the period's last day (a mid-month hire still earns that
    // month's payroll in the school's convention — the tab's budget does not
    // prorate, so neither does the forecast; documented in financial-rules §16).
    if (p.hireDate && p.hireDate > periodLastDayIso(period)) return false;
    // Terminated before the period started → no obligation.
    if (p.terminationDate && p.terminationDate < periodStartIso(period)) return false;
    return true;
  };

  // ── Disbursement index per period ───────────────────────────────────────
  const paymentsByPeriod = new Map<string, SalaryPaymentForecastInput[]>();
  for (const sp of salaryPayments) {
    if (!PERIOD_RE.test(sp.period)) continue;
    const list = paymentsByPeriod.get(sp.period) ?? [];
    list.push(sp);
    paymentsByPeriod.set(sp.period, list);
  }
  const securedOf = (rows: readonly SalaryPaymentForecastInput[]): number =>
    rows
      .filter((r) => r.status === "paid" || r.status === "pending")
      .reduce((s, r) => s + (r.netPaid || 0), 0);
  const actualPaidOf = (rows: readonly SalaryPaymentForecastInput[]): number =>
    rows.filter((r) => r.status === "paid").reduce((s, r) => s + (r.netPaid || 0), 0);
  const actualPaymentDateOf = (
    rows: readonly SalaryPaymentForecastInput[],
  ): string | null => {
    let latest: string | null = null;
    for (const r of rows) {
      if (r.status === "paid" && r.paymentDate) {
        if (latest === null || r.paymentDate > latest) latest = r.paymentDate;
      }
    }
    return latest;
  };

  // ── Projected waves (overdue carry-over + current + horizon) ────────────
  const projectedPeriods: string[] = [];

  // OVERDUE CARRY-OVER (the honest missed-payroll signal): the periods
  // between the LAST RECORDED disbursement and the current period carry no
  // salary_payments rows — data-driven evidence that those payrolls were
  // never disbursed through the system. They surface as phase "overdue"
  // (readiness "unfunded", canonical date passed) so the funding requirement
  // they represent is NOT silently lost. Guards: emitted ONLY when some
  // disbursement history exists at all (a fresh install with zero history
  // cannot know when payroll started — nothing is fabricated, §15.49a);
  // capped by the history window; skipped when no staff is eligible for the
  // period (nothing reconstructable → nothing claimed). The amount is the
  // today's-roster projection — same convention as every projected wave
  // (documented limitation, ADR-024 / financial-rules §16).
  const recordedPeriods = [...paymentsByPeriod.keys()].sort();
  const lastRecordedPeriod = recordedPeriods.at(-1) ?? null;
  const historyFloor = addPeriodMonths(currentPeriod, -historyMonths);
  if (lastRecordedPeriod && lastRecordedPeriod < currentPeriod) {
    let cursor = addPeriodMonths(lastRecordedPeriod, 1);
    while (cursor < currentPeriod) {
      if (cursor >= historyFloor) projectedPeriods.push(cursor);
      cursor = addPeriodMonths(cursor, 1);
    }
  }

  for (let offset = 0; offset <= horizonMonths; offset++) {
    projectedPeriods.push(addPeriodMonths(currentPeriod, offset));
  }

  const hasAnyEligibleStaff = personnel.some((p) =>
    isEligibleFor(p, currentPeriod),
  );

  const waves: PayrollWave[] = [];

  if (hasAnyEligibleStaff) {
    for (const period of projectedPeriods) {
      const eligible = personnel.filter((p) => isEligibleFor(p, period));
      if (eligible.length === 0) continue; // nothing reconstructable → skip
      const rows = paymentsByPeriod.get(period) ?? [];
      const secured = securedOf(rows);
      const expectedPayroll = eligible.reduce((s, p) => s + (p.salary ?? 0), 0);
      const remaining = Math.max(0, expectedPayroll - secured);
      const phase: PayrollWavePhase =
        period === currentPeriod
          ? "current"
          : period < currentPeriod
            ? "overdue"
            : "upcoming";
      // Actual date when known (the current period may already carry real
      // disbursements); otherwise the canonical convention.
      const paymentDate =
        actualPaymentDateOf(rows) ?? canonicalPayrollPaymentDate(period);
      const paymentDateMs = Date.parse(`${paymentDate}T23:59:59Z`);

      let readiness: PayrollReadiness;
      if (expectedPayroll > 0 && secured >= expectedPayroll) {
        readiness = "settled";
      } else if (secured > 0) {
        readiness = "partial";
      } else if (paymentDateMs < nowMs) {
        readiness = "unfunded";
      } else {
        readiness = "upcoming";
      }

      // Per-personnel breakdown behind this wave's total.
      const disbursedByPersonnel = new Map<string, number>();
      for (const r of rows) {
        if (r.status === "paid" || r.status === "pending") {
          disbursedByPersonnel.set(
            r.personnelId,
            (disbursedByPersonnel.get(r.personnelId) ?? 0) + (r.netPaid || 0),
          );
        }
      }
      const breakdown: PayrollObligationEntry[] = eligible.map((p) => ({
        personnelId: p.id,
        displayName: `${p.firstName} ${p.lastName}`.trim() || p.id,
        position: p.position,
        staffCategory: p.staffCategory,
        baseSalary: p.salary ?? 0,
        paymentMethod: p.paymentMethod,
        disbursedForPeriod: disbursedByPersonnel.get(p.id) ?? 0,
      }));

      waves.push({
        period,
        phase,
        paymentDate,
        personnelCount: eligible.length,
        expectedPayroll,
        requiredCash: expectedPayroll,
        securedAmount: secured,
        remainingFundingRequirement: remaining,
        actualPaid: actualPaidOf(rows),
        readiness,
        breakdown,
      });
    }
  }

  // ── Historical waves (real disbursements only — no fabrication) ─────────
  const historicalPeriods = new Set<string>();
  for (const period of paymentsByPeriod.keys()) {
    if (period < currentPeriod) historicalPeriods.add(period);
  }
  // Keep only the recent window (historyMonths back from the current period).
  const sortedHistorical = [...historicalPeriods]
    .filter((p) => p >= historyFloor)
    .sort();

  const historicalMonthly: PayrollActualMonthlyPoint[] = [];
  for (const period of sortedHistorical) {
    const rows = paymentsByPeriod.get(period) ?? [];
    const actualPaid = actualPaidOf(rows);
    historicalMonthly.push({ period, label: periodLabelFr(period), actualPaid });
    waves.push({
      period,
      phase: "historical",
      paymentDate: actualPaymentDateOf(rows) ?? canonicalPayrollPaymentDate(period),
      personnelCount: new Set(rows.map((r) => r.personnelId)).size,
      // For pure-history waves the honest figures are the ACTUALS (the
      // projected-from-today's-staff number would be an anachronism).
      expectedPayroll: actualPaid,
      requiredCash: actualPaid,
      securedAmount: actualPaid,
      remainingFundingRequirement: 0,
      actualPaid,
      readiness: "settled",
      breakdown: [],
    });
  }

  // Chronological order (historical → current → upcoming).
  waves.sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));

  // ── Totals (the single source every consumer aggregates from) ───────────
  // Projected = overdue + current + upcoming (the overdue carry-over is
  // genuinely owed money — it belongs in every funding total).
  const projected = waves.filter((w) => w.phase !== "historical");
  const nextFundingWave =
    projected.find((w) => w.remainingFundingRequirement > 0) ?? null;
  const totalRemainingFunding = projected.reduce(
    (s, w) => s + w.remainingFundingRequirement,
    0,
  );
  const requiredCash30d = projected
    .filter((w) => {
      const dueMs = Date.parse(`${w.paymentDate}T23:59:59Z`);
      return dueMs - nowMs <= THIRTY_DAYS_MS; // due now-ish or within 30 days
    })
    .reduce((s, w) => s + w.remainingFundingRequirement, 0);
  const currentWave = projected.find((w) => w.phase === "current") ?? null;
  const firstUpcoming = projected.find((w) => w.phase === "upcoming") ?? null;
  return {
    waves,
    historicalMonthly,
    totals: {
      nextFundingWave,
      totalRemainingFunding,
      requiredCash30d,
      securedCurrentPeriod: currentWave ? currentWave.securedAmount : 0,
      projectedMonthlyPayroll: firstUpcoming
        ? firstUpcoming.expectedPayroll
        : currentWave
          ? currentWave.expectedPayroll
          : 0,
    },
  };
}
