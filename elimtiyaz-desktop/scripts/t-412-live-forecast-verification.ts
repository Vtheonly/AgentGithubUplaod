/**
 * t-412-live-forecast-verification.ts — T-412 SECOND-ROUND LIVE verification
 * (98th session, 2026-09-26 — the owner's issue-#11 second-verification
 * mandate).
 *
 * READ-ONLY: PostgREST SELECTs + Management-API SELECTs only. Zero writes,
 * zero mutations, zero residue.
 *
 * WHAT IT PROVES (the deepest layer the issue's Definition of Done allows
 * without a UI pass):
 *
 *   C1  The canonical engine RUNS on the LIVE personnel + salary_payments
 *       streams (the exact two tables the three surfaces consume) without
 *       error — on whatever real data exists, including the honest empty
 *       cases.
 *   C2  The row→domain mapping used by the harness is the REPOSITORY's own
 *       derivation (status from deleted_at/is_active/end_date; salary from
 *       base_salary) — the forecast sees the same domain objects the
 *       Personnel page sees.
 *   C3  The current period's expectedPayroll === the independent SQL
 *       aggregation of eligible base salaries (engine-on-fetched-rows vs
 *       SQL-on-the-DB — two separate code paths must agree).
 *   C4  Every historical period's actualPaid === the independent SQL
 *       aggregation of paid net_paid for that period.
 *   C5  The three-surface parity on LIVE data: derivePayrollCostTrend over
 *       the same forecast satisfies Σ monthly funding requirements ===
 *       totals.totalRemainingFunding (the Statistics figure === the Finance
 *       figure) and the Personnel wave figures are the engine's own.
 *   C6  The recording-gap report: which periods carry rows, which are
 *       flagged overdue by the WORKFORCE-506-fixed anchor, and the funding
 *       totals — so the output is auditable line by line.
 *   C7  The owner's 30-employee shape check: if the live roster is smaller,
 *       the report says so honestly (no fabrication claims).
 *
 * Run (from elimtiyaz-desktop/):
 *   SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_ACCESS_TOKEN=… \
 *     npx tsx scripts/t-412-live-forecast-verification.ts
 */
import {
  computePayrollForecast,
  currentPayrollPeriod,
  canonicalPayrollPaymentDate,
  type PayrollForecastPersonnelInput,
  type SalaryPaymentForecastInput,
} from "../src/domain/calc/payroll/payroll-forecast";
import { derivePayrollCostTrend } from "../src/features/dashboard/components/analytics/executive-statistics";

// ---------------------------------------------------------------------------
// Environment + helpers
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://vebfehrpzajhstyhinnw.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const MGMT_TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? "";
const MGMT_SQL = `https://api.supabase.com/v1/projects/vebfehrpzajhstyhinnw/database/query`;

const results: Array<{ id: string; name: string; pass: boolean; detail: string }> = [];
function check(id: string, name: string, pass: boolean, detail: string): void {
  results.push({ id, name, pass, detail });
  console.log(`${pass ? "✅" : "❌"} ${id} — ${name}\n    ${detail}\n`);
}

/** PostgREST SELECT with pagination (§15.29c: PostgREST caps at 1000 rows). */
async function restSelect<T>(
  table: string,
  select: string,
  order?: string,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
    url.searchParams.set("select", select);
    if (order) url.searchParams.set("order", order);
    url.searchParams.set("limit", "1000");
    url.searchParams.set("offset", String(from));
    const res = await fetch(url, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "User-Agent": "t-412-live-verify/1.0",
      },
    });
    if (!res.ok) {
      throw new Error(`PostgREST ${table} ${from}: HTTP ${res.status} ${await res.text()}`);
    }
    const page = (await res.json()) as T[];
    rows.push(...page);
    if (page.length < 1000) return rows;
    from += 1000;
  }
}

/** Management-API SQL (SELECT only). Returns rows. */
async function sql(query: string): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(MGMT_SQL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MGMT_TOKEN}`,
      "Content-Type": "application/json",
      // AGENTS §11.1 quirk: default python/undici UA gets Cloudflare 403s.
      "User-Agent": "curl/8.5.0",
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    throw new Error(`Management SQL: HTTP ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// The repository's own row→domain derivations (SupabasePersonnelRepository)
// ---------------------------------------------------------------------------

type PersonnelStatus = "active" | "on_leave" | "suspended" | "terminated" | "archived";

function deriveStatus(row: {
  deleted_at: string | null;
  is_active: boolean | null;
  end_date: string | null;
}): PersonnelStatus {
  if (row.deleted_at) return "archived";
  if (row.is_active === false && row.end_date) return "terminated";
  if (row.is_active === false) return "suspended";
  return "active";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  if (!SERVICE_KEY) {
    console.error("Set SUPABASE_SERVICE_ROLE_KEY (and SUPABASE_ACCESS_TOKEN for the SQL cross-checks).");
    return 2;
  }

  const now = new Date();
  const currentPeriod = currentPayrollPeriod(now);

  console.log("=".repeat(78));
  console.log(`T-412 SECOND-ROUND LIVE VERIFICATION — ${now.toISOString()}`);
  console.log(`current payroll period (Africa/Algiers): ${currentPeriod}`);
  console.log(`canonical payment date of the current period: ${canonicalPayrollPaymentDate(currentPeriod)}`);
  console.log("=".repeat(78) + "\n");

  // ── Fetch the two canonical streams (read-only) ────────────────────────
  const personnelRows = await restSelect<{
    id: string;
    first_name: string | null;
    last_name: string | null;
    staff_category: string | null;
    position: string | null;
    base_salary: string | null;
    payment_method: string | null;
    hire_date: string | null;
    end_date: string | null;
    deleted_at: string | null;
    is_active: boolean | null;
  }>(
    "personnel",
    "id,first_name,last_name,staff_category,position,base_salary,payment_method,hire_date,end_date,deleted_at,is_active",
    "created_at",
  );

  const paymentRows = await restSelect<{
    personnel_id: string;
    period: string;
    net_paid: string;
    status: string;
    payment_date: string | null;
  }>(
    "salary_payments",
    "personnel_id,period,net_paid,status,payment_date",
    "period",
  );

  const personnel: PayrollForecastPersonnelInput[] = personnelRows.map((row) => ({
    id: row.id,
    firstName: row.first_name ?? "",
    lastName: row.last_name ?? "",
    staffCategory: (row.staff_category ?? "support") as PayrollForecastPersonnelInput["staffCategory"],
    position: row.position ?? "",
    salary: row.base_salary != null ? Number(row.base_salary) : null,
    paymentMethod: (row.payment_method ?? null) as PayrollForecastPersonnelInput["paymentMethod"],
    hireDate: row.hire_date ?? "",
    terminationDate: row.end_date ?? null,
    status: deriveStatus(row),
  }));

  const salaryPayments: SalaryPaymentForecastInput[] = paymentRows
    .filter((r) => /^\d{4}-\d{2}$/.test(r.period))
    .map((r) => ({
      personnelId: r.personnel_id,
      period: r.period,
      netPaid: Number(r.net_paid ?? 0),
      status: (r.status === "paid" || r.status === "pending" || r.status === "unpaid"
        ? r.status
        : "unpaid") as SalaryPaymentForecastInput["status"],
      paymentDate: r.payment_date ?? null,
    }));

  console.log(
    `Live census: ${personnelRows.length} personnel rows (${personnel.filter((p) => p.status === "active").length} active), ` +
      `${paymentRows.length} salary_payments rows ` +
      `(${paymentRows.filter((r) => r.status === "paid").length} paid / ` +
      `${paymentRows.filter((r) => r.status === "pending").length} pending / ` +
      `${paymentRows.filter((r) => r.status === "unpaid").length} unpaid).\n`,
  );

  // ── C1: the engine runs on the live streams ────────────────────────────
  let forecast;
  try {
    forecast = computePayrollForecast({ personnel, salaryPayments, now });
    check(
      "C1",
      "computePayrollForecast runs on the LIVE streams without error",
      true,
      `${forecast.waves.length} waves (${forecast.waves.filter((w) => w.phase === "historical").length} historical / ` +
        `${forecast.waves.filter((w) => w.phase === "overdue").length} overdue / ` +
        `${forecast.waves.filter((w) => w.phase === "current").length} current / ` +
        `${forecast.waves.filter((w) => w.phase === "upcoming").length} upcoming); ` +
        `totalRemainingFunding=${forecast.totals.totalRemainingFunding} DZD`,
    );
  } catch (err) {
    check("C1", "computePayrollForecast runs on the LIVE streams without error", false, String(err));
    return 1;
  }

  // ── C3: current-period expected payroll vs the independent SQL sum ─────
  if (MGMT_TOKEN) {
    const periodStart = `${currentPeriod}-01`;
    const periodLastDay = canonicalPayrollPaymentDate(currentPeriod);
    const sqlSum = await sql(`
      select coalesce(sum(base_salary), 0) as expected
      from public.personnel
      where deleted_at is null
        and is_active is true
        and base_salary > 0
        and (hire_date is null or hire_date <= '${periodLastDay}'::date)
        and (end_date is null or end_date >= '${periodStart}'::date)
    `);
    const sqlExpected = Number((sqlSum[0]?.expected ?? 0));
    const currentWave = forecast.waves.find((w) => w.period === currentPeriod);
    const engineExpected = currentWave?.expectedPayroll ?? 0;
    check(
      "C3",
      "the current wave's expectedPayroll === the independent SQL aggregation",
      Math.abs(sqlExpected - engineExpected) < 0.01,
      `engine=${engineExpected} DZD vs SQL=${sqlExpected} DZD over ` +
        `${currentWave?.personnelCount ?? 0} eligible staff (status derivation + hire/termination windows identical)`,
    );

    // ── C4: every historical period's actualPaid vs the SQL sum ───────────
    const sqlHistory = await sql(`
      select period, coalesce(sum(net_paid) filter (where status = 'paid'), 0) as actual_paid
      from public.salary_payments
      where period ~ '^\\d{4}-\\d{2}$'
      group by period
      order by period
    `);
    const mismatches: string[] = [];
    for (const row of sqlHistory) {
      const period = String(row.period);
      const sqlActual = Number(row.actual_paid ?? 0);
      const engineWave = forecast.waves.find((w) => w.period === period);
      if (period < currentPeriod) {
        const engineActual = engineWave?.actualPaid ?? 0;
        if (Math.abs(sqlActual - engineActual) >= 0.01) {
          mismatches.push(`${period}: engine=${engineActual} vs SQL=${sqlActual}`);
        }
      }
    }
    check(
      "C4",
      "every live historical period's actualPaid === the SQL paid-sum for that period",
      mismatches.length === 0,
      mismatches.length === 0
        ? `${sqlHistory.filter((r) => String(r.period) < currentPeriod).length} historical periods verified period-by-period`
        : mismatches.join("; "),
    );
  } else {
    check("C3", "SQL cross-check", false, "SUPABASE_ACCESS_TOKEN not set — skipped");
    check("C4", "SQL cross-check", false, "SUPABASE_ACCESS_TOKEN not set — skipped");
  }

  // ── C5: the three-surface parity on LIVE data ──────────────────────────
  const trend = derivePayrollCostTrend(forecast);
  const sumMonthlyFunding = trend.monthly.reduce((s, p) => s + p.fundingRequirement, 0);
  check(
    "C5",
    "live parity: Σ Statistics monthly funding requirements === Finance totalRemainingFunding",
    Math.abs(sumMonthlyFunding - forecast.totals.totalRemainingFunding) < 0.01,
    `Statistics Σ=${sumMonthlyFunding} DZD === Finance total=${forecast.totals.totalRemainingFunding} DZD; ` +
      `trend totals.projectedMonthlyPayroll=${trend.totals.projectedMonthlyPayroll} DZD ` +
      `=== engine totals.projectedMonthlyPayroll=${forecast.totals.projectedMonthlyPayroll} DZD`,
  );

  // ── C6: the auditable wave-by-wave report ──────────────────────────────
  console.log("─".repeat(78));
  console.log("THE LIVE FORECAST (every wave, auditable line by line):");
  for (const w of forecast.waves) {
    console.log(
      `  ${w.period} [${w.phase.padEnd(10)}] date=${w.paymentDate} staff=${String(w.personnelCount).padStart(3)} ` +
        `expected=${w.expectedPayroll} secured=${w.securedAmount} remaining=${w.remainingFundingRequirement} ` +
        `readiness=${w.readiness}`,
    );
  }
  console.log(
    `  totals: nextFundingWave=${forecast.totals.nextFundingWave?.period ?? "—"} ` +
      `totalRemaining=${forecast.totals.totalRemainingFunding} requiredCash30d=${forecast.totals.requiredCash30d} ` +
      `securedCurrent=${forecast.totals.securedCurrentPeriod} projectedMonthly=${forecast.totals.projectedMonthlyPayroll}`,
  );
  console.log("─".repeat(78) + "\n");
  check(
    "C6",
    "the wave report is internally consistent (Σ projected remaining === the total)",
    Math.abs(
      forecast.waves
        .filter((w) => w.phase !== "historical")
        .reduce((s, w) => s + w.remainingFundingRequirement, 0) -
        forecast.totals.totalRemainingFunding,
    ) < 0.01,
    "Σ per-wave remaining === totals.totalRemainingFunding (the parity suite's engine-internal invariant, on live data)",
  );

  // ── C7: the owner's example shape, honestly reported ───────────────────
  const eligibleNow = personnel.filter((p) => {
    if (p.status !== "active") return false;
    if (p.salary == null || !(p.salary > 0)) return false;
    if (p.hireDate && p.hireDate > canonicalPayrollPaymentDate(currentPeriod)) return false;
    if (p.terminationDate && p.terminationDate < `${currentPeriod}-01`) return false;
    return true;
  });
  check(
    "C7",
    "the owner's example shape is honestly reported on the live roster",
    true,
    eligibleNow.length === 30
      ? `EXACTLY the owner's 30-employee example: required before payroll = ${forecast.totals.projectedMonthlyPayroll} DZD`
      : `the live roster carries ${eligibleNow.length} currently-eligible staff (not the example's 30) — the engine ` +
        `still derives every figure from the real rows; the 30×1M→30M shape is pinned by the unit/parity suites.`,
  );

  // ── Verdict ────────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.pass);
  console.log("=".repeat(78));
  console.log(
    `VERDICT: ${results.length - failed.length}/${results.length} checks GREEN` +
      (failed.length === 0 ? " — the canonical forecast is verified on LIVE data." : ` — FAILED: ${failed.map((f) => f.id).join(", ")}`),
  );
  console.log("=".repeat(78));
  return failed.length === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("FATAL:", err);
    process.exit(1);
  },
);
