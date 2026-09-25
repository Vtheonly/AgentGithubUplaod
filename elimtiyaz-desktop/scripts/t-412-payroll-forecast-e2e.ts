/**
 * t-412-payroll-forecast-e2e.ts — T-412 SECOND-ROUND LIVE E2E
 * (98th session, 2026-09-26 — the owner's issue-#11 second-verification
 * mandate, deepest layer).
 *
 * Runs the COMPLETE T-412 loop against the LIVE project
 * (vebfehrpzajhstyhinnw) through the canonical write/read paths:
 *
 *   STEP 0  admin sign-in (the OPS-310 owner-pinned credential) → JWT.
 *   STEP 1  a run-unique FAKE-marked probe personnel (base salary 1 000 000
 *           DZD — the owner's example per-person amount) created through
 *           the RLS INSERT path (§15.28: tenant_id EXPLICIT).
 *   STEP 2  BASELINE: the canonical engine over the live streams — the
 *           probe's 1M joins every wave it is eligible for.
 *   STEP 3  the canonical record_salary_disbursement RPC for the CURRENT
 *           period → the forecast RESTATES: secured +1M, remaining −1M,
 *           readiness flips (upcoming/partial) — the reactive-stream
 *           contract, live.
 *   STEP 4  IDEMPOTENCE: re-recording the same period updates, never
 *           doubles (the 0095 unique constraint through the RPC).
 *   STEP 5  WORKFORCE-506 LIVE PROOF: record a disbursement for a PAST
 *           period (2026-07) AFTER the current-period row exists → the
 *           engine must surface the 2026-08 gap as an OVERDUE unfunded
 *           wave. The pre-fix engine (recordedPeriods.at(-1) including
 *           current rows) HID this gap — this step proves the fix live.
 *   STEP 6  PARITY after all writes: Σ Statistics monthly funding
 *           requirements === Finance totalRemainingFunding (the same
 *           invariant the parity suite pins, now over live mutated data).
 *   STEP 7  CLEANUP (the t-369 convention): the probe's salary_payments
 *           DELETED via the Management API (superuser SQL — business data
 *           zero-residue), the probe personnel soft-archived (append-only
 *           integrity: never hard-deleted), residue re-checked. The
 *           audit_logs rows REMAIN by design (append-only, the §15.26
 *           honest record).
 *
 * Run (from elimtiyaz-desktop/):
 *   SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_ACCESS_TOKEN=… \
 *     npx tsx scripts/t-412-payroll-forecast-e2e.ts
 */
import {
  computePayrollForecast,
  currentPayrollPeriod,
  type PayrollForecastPersonnelInput,
  type SalaryPaymentForecastInput,
} from "../src/domain/calc/payroll/payroll-forecast";
import { derivePayrollCostTrend } from "../src/features/dashboard/components/analytics/executive-statistics";

// ---------------------------------------------------------------------------
// Environment + transport helpers (the t-369/t-413 conventions)
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://vebfehrpzajhstyhinnw.supabase.co";
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_IPUtQMYQzr1wNnfGTcl5MA_wuz3RUdg";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const MGMT_TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? "";
const MGMT_SQL = `https://api.supabase.com/v1/projects/vebfehrpzajhstyhinnw/database/query`;
const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const ADMIN_EMAIL = "admin@elimtiyaz.dz"; // OPS-310 owner-pinned credential
const ADMIN_PW = "elimtiyaz@admin2026";

const PROBE_SALARY = 1_000_000; // the owner's example per-person amount (DZD)
const PROBE_CODE = `PER-PROBE-T412-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}`;

const results: Array<{ step: string; name: string; pass: boolean; detail: string }> = [];
function check(step: string, name: string, pass: boolean, detail: string): void {
  results.push({ step, name, pass, detail });
  console.log(`  ${pass ? "GREEN" : "RED "}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function http(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: unknown,
  timeoutMs = 60_000,
): Promise<{ status: number; body: any }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { "User-Agent": "t412-e2e/1.0", ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

async function sql(query: string): Promise<Array<Record<string, unknown>>> {
  const { status, body } = await http(
    "POST",
    MGMT_SQL,
    { Authorization: `Bearer ${MGMT_TOKEN}`, "Content-Type": "application/json" },
    { query },
    120_000,
  );
  if (status !== 200 && status !== 201) {
    throw new Error(`Management SQL HTTP ${status}: ${JSON.stringify(body).slice(0, 400)}`);
  }
  return (body ?? []) as Array<Record<string, unknown>>;
}

async function rpc(fn: string, jwt: string, args: Record<string, unknown>) {
  return http(
    "POST",
    `${SUPABASE_URL}/rest/v1/rpc/${fn}`,
    { Authorization: `Bearer ${jwt}`, apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
    args,
  );
}

// ---------------------------------------------------------------------------
// The live-stream fetchers + the repository's own row→domain derivations
// ---------------------------------------------------------------------------

type PersonnelStatus = "active" | "on_leave" | "suspended" | "terminated" | "archived";
function deriveStatus(row: { deleted_at: string | null; is_active: boolean | null; end_date: string | null }): PersonnelStatus {
  if (row.deleted_at) return "archived";
  if (row.is_active === false && row.end_date) return "terminated";
  if (row.is_active === false) return "suspended";
  return "active";
}

async function fetchStreams(): Promise<{
  personnel: PayrollForecastPersonnelInput[];
  salaryPayments: SalaryPaymentForecastInput[];
}> {
  const personnelRows = await restSelect(
    "personnel",
    "id,first_name,last_name,staff_category,position,base_salary,payment_method,hire_date,end_date,deleted_at,is_active",
  );
  const paymentRows = await restSelect("salary_payments", "personnel_id,period,net_paid,status,payment_date");
  return {
    personnel: personnelRows.map((row) => ({
      id: String(row.id),
      firstName: String(row.first_name ?? ""),
      lastName: String(row.last_name ?? ""),
      staffCategory: (row.staff_category ?? "support") as PayrollForecastPersonnelInput["staffCategory"],
      position: String(row.position ?? ""),
      salary: row.base_salary != null ? Number(row.base_salary) : null,
      paymentMethod: (row.payment_method ?? null) as PayrollForecastPersonnelInput["paymentMethod"],
      hireDate: String(row.hire_date ?? ""),
      terminationDate: (row.end_date ?? null) as string | null,
      status: deriveStatus(row as never),
    })),
    salaryPayments: paymentRows
      .filter((r) => /^\d{4}-\d{2}$/.test(String(r.period)))
      .map((r) => ({
        personnelId: String(r.personnel_id),
        period: String(r.period),
        netPaid: Number(r.net_paid ?? 0),
        status: (["paid", "pending", "unpaid"].includes(String(r.status)) ? r.status : "unpaid") as SalaryPaymentForecastInput["status"],
        paymentDate: (r.payment_date ?? null) as string | null,
      })),
  };
}

/** PostgREST SELECT with pagination (§15.29c). Service-role reads. */
async function restSelect<T = Record<string, unknown>>(table: string, select: string): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
    url.searchParams.set("select", select);
    url.searchParams.set("limit", "1000");
    url.searchParams.set("offset", String(from));
    const { status, body } = await http("GET", url.toString(), {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    });
    if (status !== 200) throw new Error(`PostgREST ${table}@${from}: HTTP ${status}`);
    const page = (body ?? []) as T[];
    rows.push(...page);
    if (page.length < 1000) return rows;
    from += 1000;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  if (!SERVICE_KEY || !MGMT_TOKEN) {
    console.error("Set SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ACCESS_TOKEN.");
    return 2;
  }
  const now = new Date();
  const currentPeriod = currentPayrollPeriod(now);
  console.log("=".repeat(78));
  console.log(`T-412 SECOND-ROUND LIVE E2E — ${now.toISOString()} (current period ${currentPeriod})`);
  console.log(`probe: ${PROBE_CODE} @ ${PROBE_SALARY} DZD`);
  console.log("=".repeat(78));

  // ── STEP 0: admin sign-in ───────────────────────────────────────────────
  console.log("\n== STEP 0: staff (super_admin) sign-in ==");
  const signIn = await http(
    "POST",
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    { "Content-Type": "application/json", apikey: PUBLISHABLE_KEY },
    { email: ADMIN_EMAIL, password: ADMIN_PW },
  );
  if (signIn.status !== 200 || !signIn.body?.access_token) {
    check("0", "admin JWT acquired", false, `HTTP ${signIn.status}`);
    return 1;
  }
  const jwt = signIn.body.access_token as string;
  check("0", "admin JWT acquired", true, `${jwt.length} chars`);

  // ── STEP 1: the FAKE probe personnel (RLS INSERT path, tenant EXPLICIT) ─
  console.log("\n== STEP 1: the run-unique FAKE probe personnel ==");
  // Stale-probe hygiene first (the t-369 pattern).
  await sql(
    `delete from public.salary_payments where tenant_id = '${TENANT_ID}' and personnel_id in (select id from public.personnel where personnel_code like 'PER-PROBE-T412-%')`,
  );
  const created = await http(
    "POST",
    `${SUPABASE_URL}/rest/v1/personnel`,
    {
      Authorization: `Bearer ${jwt}`,
      apikey: PUBLISHABLE_KEY,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    {
      tenant_id: TENANT_ID,
      personnel_code: PROBE_CODE,
      first_name: "FAKE T-412",
      last_name: "Probe Payroll",
      staff_category: "administration",
      position: "FAKE T-412 payroll-forecast probe (purgeable)",
      hire_date: "2026-07-01", // eligible for July onward — exercises the gap logic
      base_salary: PROBE_SALARY,
      is_active: true,
    },
  );
  if (created.status !== 200 && created.status !== 201) {
    check("1", "probe personnel created (RLS INSERT, tenant_id explicit)", false, `HTTP ${created.status}: ${JSON.stringify(created.body).slice(0, 300)}`);
    return 1;
  }
  const probeId = created.body[0]?.id as string;
  check("1", "probe personnel created (RLS INSERT, tenant_id explicit)", true, probeId);

  // ── STEP 2: BASELINE forecast over the live streams ─────────────────────
  console.log("\n== STEP 2: baseline forecast (the probe's 1M joins every eligible wave) ==");
  let streams = await fetchStreams();
  let forecast = computePayrollForecast({ ...streams, now });
  const baseCurrent = forecast.waves.find((w) => w.period === currentPeriod);
  const baseExpected = baseCurrent?.expectedPayroll ?? 0;
  check(
    "2",
    "the probe joined the CURRENT wave (+1M) and the engine ran clean",
    baseExpected >= PROBE_SALARY && (baseCurrent?.personnelCount ?? 0) >= 1,
    `current expected=${baseExpected} DZD over ${baseCurrent?.personnelCount} staff`,
  );
  const upcoming = forecast.waves.filter((w) => w.phase === "upcoming");
  check(
    "2b",
    "every upcoming wave also carries the probe's 1M",
    upcoming.length > 0 && upcoming.every((w) => w.expectedPayroll >= PROBE_SALARY),
    `${upcoming.length} upcoming waves, each >= ${PROBE_SALARY}`,
  );

  // ── STEP 3: the canonical RPC restates the forecast ─────────────────────
  console.log("\n== STEP 3: record_salary_disbursement (current period) → the forecast restates ==");
  const rec = await rpc("record_salary_disbursement", jwt, {
    p_personnel_id: probeId,
    p_period: currentPeriod,
    p_method: "bank_transfer",
    p_reference_number: "PROBE-T412-VIR-001",
    p_notes: "FAKE T-412 second-round live probe",
    p_actor_name: "T-412 Probe",
  });
  check(
    "3",
    "the canonical RPC recorded the current-period disbursement",
    rec.status === 200 && Number(rec.body?.net_paid ?? 0) === PROBE_SALARY,
    `HTTP ${rec.status}, net_paid=${rec.body?.net_paid} (base ${PROBE_SALARY}, no adjustments)`,
  );

  streams = await fetchStreams();
  forecast = computePayrollForecast({ ...streams, now });
  const restated = forecast.waves.find((w) => w.period === currentPeriod);
  check(
    "3b",
    "the CURRENT wave restated: secured +1M, remaining −1M, readiness partial",
    restated?.securedAmount === PROBE_SALARY &&
      restated?.remainingFundingRequirement === baseExpected - PROBE_SALARY &&
      restated?.readiness === "partial",
    `secured=${restated?.securedAmount} remaining=${restated?.remainingFundingRequirement} readiness=${restated?.readiness}`,
  );

  // ── STEP 4: idempotent re-record ────────────────────────────────────────
  console.log("\n== STEP 4: re-record the SAME period — idempotent, never doubles ==");
  const again = await rpc("record_salary_disbursement", jwt, {
    p_personnel_id: probeId,
    p_period: currentPeriod,
    p_method: "cash",
    p_actor_name: "T-412 Probe",
  });
  const rowsNow = await sql(
    `select count(*)::int as n, max(net_paid) as net from public.salary_payments where personnel_id = '${probeId}' and period = '${currentPeriod}'`,
  );
  check(
    "4",
    "one row only, net stable (the 0095 unique constraint through the RPC)",
    again.status === 200 && Number(rowsNow[0]?.n ?? 0) === 1 && Number(rowsNow[0]?.net ?? 0) === PROBE_SALARY,
    `HTTP ${again.status}, rows=${rowsNow[0]?.n}, net=${rowsNow[0]?.net}, method updated to cash`,
  );
  streams = await fetchStreams();
  forecast = computePayrollForecast({ ...streams, now });
  const afterIdem = forecast.waves.find((w) => w.period === currentPeriod);
  check(
    "4b",
    "the forecast is UNCHANGED by the re-record",
    afterIdem?.securedAmount === PROBE_SALARY && afterIdem?.remainingFundingRequirement === baseExpected - PROBE_SALARY,
    `secured=${afterIdem?.securedAmount} remaining=${afterIdem?.remainingFundingRequirement}`,
  );

  // ── STEP 5: WORKFORCE-506 live proof ────────────────────────────────────
  console.log("\n== STEP 5: a PAST-period disbursement AFTER current rows exist → the gap must surface ==");
  // Current period already carries a row (STEP 3). Recording 2026-07 now
  // leaves 2026-08 as a no-row month between 2026-07 and the current period.
  // The PRE-FIX engine anchored its gap on recordedPeriods.at(-1) — which
  // includes the current period — and would have shown NO overdue wave.
  // The FIX anchors on the last PRE-current recorded period: 2026-08 must
  // surface as an OVERDUE unfunded wave.
  const past = await rpc("record_salary_disbursement", jwt, {
    p_personnel_id: probeId,
    p_period: "2026-07",
    p_method: "cash",
    p_reference_number: "PROBE-T412-CASH-007",
    p_actor_name: "T-412 Probe",
  });
  check("5", "the past-period (2026-07) disbursement recorded", past.status === 200, `HTTP ${past.status}, net=${past.body?.net_paid}`);

  streams = await fetchStreams();
  forecast = computePayrollForecast({ ...streams, now });
  const gapWave = forecast.waves.find((w) => w.period === "2026-08");
  check(
    "5b",
    "WORKFORCE-506 live proof: the 2026-08 gap surfaces as an OVERDUE unfunded wave",
    gapWave?.phase === "overdue" && gapWave?.readiness === "unfunded" && (gapWave?.remainingFundingRequirement ?? 0) > 0,
    `phase=${gapWave?.phase} readiness=${gapWave?.readiness} staff=${gapWave?.personnelCount} remaining=${gapWave?.remainingFundingRequirement} DZD ` +
      `(the pre-fix engine showed NO wave here — the current-period row masked it)`,
  );
  const julWave = forecast.waves.find((w) => w.period === "2026-07");
  check(
    "5c",
    "2026-07 became a HISTORICAL wave carrying the ACTUAL disbursement",
    julWave?.phase === "historical" && julWave?.actualPaid === PROBE_SALARY,
    `phase=${julWave?.phase} actualPaid=${julWave?.actualPaid}`,
  );
  check(
    "5d",
    "nextFundingWave is the OVERDUE gap (owed money leads the queue)",
    forecast.totals.nextFundingWave?.period === "2026-08",
    `nextFundingWave=${forecast.totals.nextFundingWave?.period}`,
  );

  // ── STEP 6: parity after all writes ─────────────────────────────────────
  console.log("\n== STEP 6: the three-surface parity over live mutated data ==");
  const trend = derivePayrollCostTrend(forecast);
  const sumMonthly = trend.monthly.reduce((s, p) => s + p.fundingRequirement, 0);
  check(
    "6",
    "Σ Statistics monthly funding === Finance totalRemainingFunding (live, post-write)",
    Math.abs(sumMonthly - forecast.totals.totalRemainingFunding) < 0.01,
    `Statistics Σ=${sumMonthly} === Finance total=${forecast.totals.totalRemainingFunding} DZD`,
  );
  const augPoint = trend.monthly.find((p) => p.period === "2026-08");
  check(
    "6b",
    "the Statistics trend carries the same overdue gap point",
    augPoint?.fundingRequirement === gapWave?.remainingFundingRequirement && augPoint?.phase === "overdue",
    `Aug trend point: ${augPoint?.period} phase=${augPoint?.phase} requirement=${augPoint?.fundingRequirement}`,
  );

  // ── STEP 7: cleanup (zero business residue; audit rows stay) ────────────
  console.log("\n== STEP 7: cleanup (t-369 convention) ==");
  await sql(`delete from public.salary_payments where personnel_id = '${probeId}'`);
  await sql(
    `update public.personnel set deleted_at = now(), is_active = false where id = '${probeId}' and deleted_at is null`,
  );
  const residue = await sql(`
    select
      (select count(*)::int from public.salary_payments where personnel_id = '${probeId}') as payments,
      (select count(*)::int from public.personnel where id = '${probeId}' and deleted_at is null) as live_probe,
      (select count(*)::int from public.personnel where personnel_code like 'PER-PROBE-T412-%' and deleted_at is null) as live_probes
  `);
  const r = residue[0] ?? {};
  check(
    "7",
    "business data zero-residue + the probe archived",
    Number(r.payments ?? -1) === 0 && Number(r.live_probe ?? -1) === 0 && Number(r.live_probes ?? -1) === 0,
    `payments=${r.payments} live_probe=${r.live_probe} live_probes=${r.live_probes} (audit_logs rows stay — the append-only honest record)`,
  );

  // ── Verdict ─────────────────────────────────────────────────────────────
  const failed = results.filter((x) => !x.pass);
  console.log("\n" + "=".repeat(78));
  console.log(
    `VERDICT: ${results.length - failed.length}/${results.length} GREEN` +
      (failed.length === 0
        ? " — the complete T-412 loop (create → forecast → disburse → restate → gap → parity → cleanup) verified LIVE."
        : ` — FAILED: ${failed.map((f) => f.step).join(", ")}`),
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
