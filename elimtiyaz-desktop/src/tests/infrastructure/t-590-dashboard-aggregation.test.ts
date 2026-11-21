/**
 * T-590 (E7A-1 / ROADMAP 6.3) — the dashboard server-side aggregation.
 *
 * The suite pins:
 *   A. The migration 0002 surface (the parameterized windows, the INV-4
 *      basis, the dynamic-overdue family, the unique index, the widened
 *      whitelist, the SECURITY DEFINER + search_path discipline, the
 *      aging-convention documentation, the append-only layout).
 *   B. The repository's RPC-path PARITY (the S8-oracle discipline at the
 *      TS seam): given fixture rows, the RPC-path mapping and the legacy
 *      client-side engine path MUST agree — the same fixtures feed both,
 *      the RPC JSON is hand-derived from the fixture arithmetic (the
 *      documented per-row math, never re-implemented through the code
 *      under test).
 *   C. The bounded reads' query SHAPES (paymentsForRange /
 *      installmentsForYear: the server-side windows, the tenant scope,
 *      the keyset walk, the column projections, the mapper reuse).
 *   D. The feature flag + the version-skew fallback (the §15.62c wire).
 *   E. The page/tab source guards (the ARCH-040 third path is gone).
 *   F. The mock repository's bounded reads (cross-backend parity).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildWindowAnchoredBuckets,
  MONTH_LABELS_FR,
} from "../../domain/calc/shared/dates";
import {
  isInstallmentOverdue,
  agingBucketFromDays,
} from "../../domain/calc/payment/queries";
import { daysBetweenFloor, isStrictlyPast } from "../../domain/calc/shared/dates";
import { GRADE_LEVEL_LABELS_FR, IMPORTED_BIRTH_DATE_PLACEHOLDER, type GradeLevel } from "../../domain/model/student";
import {
  __setSeedRetryBackoffForTests,
  mapPaymentRow,
  mapInstallmentRow,
} from "../../infrastructure/supabase/repositories/supabase-shared-repositories";
import { SupabaseDashboardRepository } from "../../infrastructure/supabase/repositories/supabase-dashboard-repository";
import { MockDashboardRepository } from "../../infrastructure/mock/repositories/dashboard-repository";

const SRC = join(__dirname, "../../");
const MIGRATION_0002 = readFileSync(
  join(SRC, "../supabase/migrations/0002_stage_a_dashboard_aggregation.sql"),
  "utf8",
);
const DASHBOARD_REPO_SRC = readFileSync(
  join(SRC, "infrastructure/supabase/repositories/supabase-dashboard-repository.ts"),
  "utf8",
);
const PAGE_SRC = readFileSync(
  join(SRC, "features/dashboard/dashboard-page.tsx"),
  "utf8",
);
const ANALYTICS_TAB_SRC = readFileSync(
  join(SRC, "features/dashboard/tabs/analytics-tab.tsx"),
  "utf8",
);

const TENANT = "00000000-0000-0000-0000-000000000001";
const AS_OF = "2026-04-01";
const YEAR = "2025-2026";
const RANGE = { from: "2025-09-01", to: "2026-09-01" };

// ============================================================
// The fixtures (ONE world; both paths read the same world)
// ============================================================

const PAYMENT_ROWS = [
  { id: "p1", tenant_id: TENANT, amount: 1000, status: "paid", collected_at: "2026-01-15T10:00:00Z", method: "cash", category: "tuition" },
  { id: "p2", tenant_id: TENANT, amount: 500, status: "paid", collected_at: "2026-02-10T10:00:00Z", method: "cash", category: "transport" },
  { id: "p3", tenant_id: TENANT, amount: 300, status: "pending", collected_at: "2026-03-05T10:00:00Z", method: "check", category: "tuition" },
  { id: "p4", tenant_id: TENANT, amount: 200, status: "paid", collected_at: "2025-08-20T10:00:00Z", method: "cash", category: "tuition" },
] as unknown as Array<Record<string, unknown>>;

// The year window [2025-09-01, 2026-09-01); as-of 2026-04-01.
const INSTALLMENT_ROWS = [
  // remaining 3500; due 2025-10-15 → 168 days overdue → 91_180.
  { id: "i1", tenant_id: TENANT, parent_id: "par-1", student_id: "s1", category: "tuition", label: "Tranche 1", tranche_number: 1, amount_due: 5000, amount_paid: 1000, amount_pending: 500, due_date: "2025-10-15", paid_date: null, status: "unpaid", academic_cycle: "primaire", payment_plan: "tranches", is_custom_schedule: false, custom_schedule_note: null },
  // remaining 3000; due 2026-03-15 → 17 days → 0_30.
  { id: "i2", tenant_id: TENANT, parent_id: "par-2", student_id: "s2", category: "tuition", label: "Tranche 1", tranche_number: 1, amount_due: 3000, amount_paid: 0, amount_pending: 0, due_date: "2026-03-15", paid_date: null, status: "unpaid", academic_cycle: "primaire", payment_plan: "tranches", is_custom_schedule: false, custom_schedule_note: null },
  // remaining 1200; due 2026-03-25 → 7 days → 0_30 (the SAME parent as i2 — the DISTINCT-debtor pin).
  { id: "i4", tenant_id: TENANT, parent_id: "par-2", student_id: "s3", category: "transport", label: "Transport", tranche_number: 1, amount_due: 2000, amount_paid: 500, amount_pending: 300, due_date: "2026-03-25", paid_date: null, status: "partial", academic_cycle: null, payment_plan: "tranches", is_custom_schedule: false, custom_schedule_note: null },
  // remaining 4000; due 2026-08-15 — IN window but FUTURE at the as-of → "à échoir": outstanding YES, aging NO.
  { id: "i5", tenant_id: TENANT, parent_id: "par-3", student_id: "s1", category: "tuition", label: "Tranche 2", tranche_number: 2, amount_due: 4000, amount_paid: 0, amount_pending: 0, due_date: "2026-08-15", paid_date: null, status: "unpaid", academic_cycle: "primaire", payment_plan: "tranches", is_custom_schedule: false, custom_schedule_note: null },
  // paid → excluded everywhere.
  { id: "i6", tenant_id: TENANT, parent_id: "par-1", student_id: "s1", category: "tuition", label: "Tranche 3", tranche_number: 3, amount_due: 2000, amount_paid: 2000, amount_pending: 0, due_date: "2026-02-01", paid_date: "2026-02-01", status: "paid", academic_cycle: "primaire", payment_plan: "tranches", is_custom_schedule: false, custom_schedule_note: null },
  // OUTSIDE the year window (due 2026-10-01) → excluded from EVERYTHING.
  { id: "i7", tenant_id: TENANT, parent_id: "par-4", student_id: "s4", category: "tuition", label: "Tranche 1", tranche_number: 1, amount_due: 6000, amount_paid: 0, amount_pending: 0, due_date: "2026-10-01", paid_date: null, status: "unpaid", academic_cycle: "cem", payment_plan: "tranches", is_custom_schedule: false, custom_schedule_note: null },
] as unknown as Array<Record<string, unknown>>;

const STUDENT_ROWS = [
  { id: "s1", tenant_id: TENANT, class_id: "c1", grade_level_code: null, gender: "male", date_of_birth: "2015-05-10", deleted_at: null },
  { id: "s2", tenant_id: TENANT, class_id: "c2", grade_level_code: null, gender: "female", date_of_birth: "2000-01-01", deleted_at: null },
  { id: "s3", tenant_id: TENANT, class_id: null, grade_level_code: "2ap", gender: "female", date_of_birth: "2012-03-01", deleted_at: null },
  { id: "s4", tenant_id: TENANT, class_id: null, grade_level_code: null, gender: null, date_of_birth: null, deleted_at: null },
  { id: "s5", tenant_id: TENANT, class_id: "c1", grade_level_code: null, gender: "female", date_of_birth: "2018-01-01", deleted_at: null },
  // dead row — the canonical liveness marker excludes it.
  { id: "s6", tenant_id: TENANT, class_id: "c1", grade_level_code: null, gender: "male", date_of_birth: "2014-01-01", deleted_at: "2026-01-01T00:00:00Z" },
] as unknown as Array<Record<string, unknown>>;

const CLASS_ROWS = [
  { id: "c1", tenant_id: TENANT, name: "Classe 1AP A", grade_code: "1ap" },
  { id: "c2", tenant_id: TENANT, name: "C2NAME", grade_code: "XYZ" },
] as unknown as Array<Record<string, unknown>>;

const ATTENDANCE_ROWS = [
  { tenant_id: TENANT, date: "2026-04-01", status: "present" },
  { tenant_id: TENANT, date: "2026-04-01", status: "present" },
  { tenant_id: TENANT, date: "2026-04-01", status: "late" },
  { tenant_id: TENANT, date: "2026-04-01", status: "absent" },
] as unknown as Array<Record<string, unknown>>;

// ============================================================
// The hand-derived RPC JSON (the documented fixture arithmetic — the
// numbers a correct 0002 SQL returns for THIS world)
// ============================================================

// KPI: revenue window = the range → P1 + P2 = 1500 (P3 pending, P4 outside).
// outstanding (unpaid, in-window, INV-4 remaining): i1 3500 + i2 3000 + i4 1200 + i5 4000 = 11700.
// overdue at 2026-04-01 (past-due remaining): i1 + i2 + i4 → 3 rows / 7700 DZD.
// attendance: 3 of 4 → 0.75. Expenses: 1 of 2. Counts: 5 students / 4 parents / 2 staff.
const KPI_JSON = {
  totalStudents: 5,
  totalParents: 4,
  totalStaff: 2,
  monthlyRevenue: 1500,
  outstandingDebt: 11700,
  overdueAlerts: 3,
  overdueAmount: 7700,
  pendingExpenses: 1,
  attendancePresent: 3,
  attendanceTotal: 4,
};

// Revenue months (the series Sep'25..Aug'26; month is the 0-based index):
// Jan'26 (0) = 1000, Feb'26 (1) = 500, the rest 0.
const REVENUE_JSON = [
  { year: 2025, month: 8, amount: 0 },
  { year: 2025, month: 9, amount: 0 },
  { year: 2025, month: 10, amount: 0 },
  { year: 2025, month: 11, amount: 0 },
  { year: 2026, month: 0, amount: 1000 },
  { year: 2026, month: 1, amount: 500 },
  { year: 2026, month: 2, amount: 0 },
  { year: 2026, month: 3, amount: 0 },
  { year: 2026, month: 4, amount: 0 },
  { year: 2026, month: 5, amount: 0 },
  { year: 2026, month: 6, amount: 0 },
  { year: 2026, month: 7, amount: 0 },
];

// Aging: 0_30 = i2 + i4 = 4200 over ONE DISTINCT debtor (both rows are
// par-2 — the DISTINCT-debtor pin: two rows, one parent, never 2);
// 91_180 = i1 = 3500 over 1 debtor; i5 is future ("à échoir" — never ages).
const AGING_JSON = [
  { bucket: "0_30", amount: 4200, debtorCount: 1 },
  { bucket: "91_180", amount: 3500, debtorCount: 1 },
];

// Demographics: classes c1 (2 alive: s1, s5), c2 (1: s2); unassigned by
// level: s3 (2ap); unassigned unknown: s4; gender 1 male / 3 female / 1
// unspecified; ages: s1 →
// 2026−2015 = 11 → 9–11; s3 → 2026−2012 = 14 → 12–14; s5 → 2026−2018 = 8 →
// 6–8; s2 placeholder + s4 NULL → unknown (2).
const DEMOGRAPHICS_JSON = {
  classes: [
    { class_id: "c1", class_name: "Classe 1AP A", grade_code: "1ap", student_count: 2 },
    { class_id: "c2", class_name: "C2NAME", grade_code: "XYZ", student_count: 1 },
  ],
  unassignedByLevel: [{ grade_level_code: "2ap", count: 1 }],
  unassignedUnknown: 1,
  gender: { male: 1, female: 3, unspecified: 1 },
  ageBuckets: [
    { min: 6, max: 8, count: 1 },
    { min: 9, max: 11, count: 1 },
    { min: 12, max: 14, count: 1 },
  ],
  unknownBirthDate: 2,
};

// ============================================================
// The mock client (the rpc surface + the from() surface the legacy path
// consumes; the SAME fixture world serves both paths)
// ============================================================

type QueryLog = { table: string; op: string; filters: Array<{ col: string; op?: string; value: unknown }> };

interface MockClientOptions {
  rpcOverrides?: Record<string, { data: unknown; error: null } | { data: null; error: { code?: string; message: string } }>;
  capture?: QueryLog[];
}

/**
 * Apply the captured PostgREST-style filters to a fixture row set — the
 * server would apply them; the mock replays them so the query-shape
 * assertions read real behavior (gte/lt windows, gt keyset cursors, eq
 * scopes, is-null markers, neq statuses).
 */
function applyFilters(rows: Array<Record<string, unknown>>, filters: Array<{ col: string; op?: string; value: unknown }>): Array<Record<string, unknown>> {
  let out = rows;
  for (const f of filters) {
    if (f.col.startsWith("__")) continue;
    const op = f.op ?? "eq";
    out = out.filter((r) => {
      const cell = r[f.col];
      switch (op) {
        case "eq": return String(cell) === String(f.value);
        case "neq": return String(cell) !== String(f.value);
        case "is": return f.value === null ? cell == null : cell === f.value;
        case "gt": return String(cell) > String(f.value);
        case "gte": return String(cell) >= String(f.value);
        case "lt": return String(cell) < String(f.value);
        case "lte": return String(cell) <= String(f.value);
        case "in": return Array.isArray(f.value) && f.value.map(String).includes(String(cell));
        default: return true;
      }
    });
  }
  return out;
}

function makeClient(opts: MockClientOptions = {}): { client: unknown; calls: QueryLog[] } {
  const calls: QueryLog[] = opts.capture ?? [];

  async function rpc(fn: string, args?: Record<string, unknown>) {
    void args;
    if (opts.rpcOverrides && fn in opts.rpcOverrides) {
      const r = opts.rpcOverrides[fn];
      return r.error ? { data: null, error: r.error } : { data: r.data, error: null };
    }
    switch (fn) {
      case "read_payments_collection":
        return { data: PAYMENT_ROWS, error: null };
      case "read_installments_collection":
        return { data: INSTALLMENT_ROWS, error: null };
      case "read_dashboard_kpis":
        return { data: KPI_JSON, error: null };
      case "read_dashboard_revenue_by_month":
        return { data: REVENUE_JSON, error: null };
      case "read_dashboard_debt_aging":
        return { data: AGING_JSON, error: null };
      case "read_dashboard_demographics":
        return { data: DEMOGRAPHICS_JSON, error: null };
      default:
        return { data: null, error: { code: "PGRST202", message: `function ${fn} not found` } };
    }
  }

  const rpcCalls: Array<{ fn: string; args?: Record<string, unknown> }> = [];
  const client = {
    rpc: (fn: string, args?: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return rpc(fn, args);
    },
    __rpcCalls: rpcCalls,
    from(table: string) {
      const rec: QueryLog = { table, op: "", filters: [] };
      calls.push(rec);
      const q: Record<string, unknown> = {};
      const chain = () => q;
      q.select = (cols?: unknown, opts2?: { count?: string; head?: boolean }) => {
        rec.op = "select";
        if (opts2?.count) rec.filters.push({ col: "__count", op: opts2.count, value: !!opts2.head });
        void cols;
        return q;
      };
      q.eq = (col: string, value: unknown) => { rec.filters.push({ col, value }); return q; };
      q.neq = (col: string, value: unknown) => { rec.filters.push({ col, op: "neq", value }); return q; };
      q.is = (col: string, value: unknown) => { rec.filters.push({ col, op: "is", value }); return q; };
      q.in = (col: string, value: unknown) => { rec.filters.push({ col, op: "in", value }); return q; };
      q.gt = (col: string, value: unknown) => { rec.filters.push({ col, op: "gt", value }); return q; };
      q.gte = (col: string, value: unknown) => { rec.filters.push({ col, op: "gte", value }); return q; };
      q.lt = (col: string, value: unknown) => { rec.filters.push({ col, op: "lt", value }); return q; };
      q.lte = (col: string, value: unknown) => { rec.filters.push({ col, op: "lte", value }); return q; };
      q.order = (col: string, o?: { ascending?: boolean }) => { rec.filters.push({ col: `__order_${col}`, value: o?.ascending }); return q; };
      q.limit = (n: number) => { rec.filters.push({ col: "__limit", value: n }); return q; };
      const resolve = (): { data: unknown; error: null } => {
        switch (table) {
          case "students":
            return { data: rec.op === "select" ? STUDENT_ROWS.filter((s) => !s["deleted_at"]) : STUDENT_ROWS, error: null };
          case "parents":
            return { data: [], error: null };
          case "personnel":
            return { data: [], error: null };
          case "classes":
            return { data: CLASS_ROWS, error: null };
          case "attendance_records":
            return { data: ATTENDANCE_ROWS, error: null };
          case "expense_tickets":
            return { data: [], error: null };
          case "payments":
            return { data: applyFilters(PAYMENT_ROWS, rec.filters), error: null };
          case "installments":
            return { data: applyFilters(INSTALLMENT_ROWS, rec.filters), error: null };
          default:
            return { data: [], error: null };
        }
      };
      q.then = undefined;
      // The count-head queries resolve via count(); data reads via then().
      Object.defineProperty(q, "then", {
        value: (onFulfilled?: (v: { data: unknown; error: null; count: number | null }) => unknown) =>
          onFulfilled
            ? Promise.resolve({ data: resolve().data, error: null, count: tableCount(table) })
                .then(onFulfilled as (v: unknown) => unknown)
                .catch(() => undefined)
            : undefined,
        configurable: true,
      });
      (q as { single?: () => unknown }).single = () => ({ then: q.then as unknown as () => unknown });
      return q;
    },
  };
  return { client, calls };
}

function tableCount(table: string): number | null {
  switch (table) {
    case "students": return STUDENT_ROWS.filter((s) => !s["deleted_at"]).length;
    case "parents": return 4;
    case "personnel": return 2;
    case "expense_tickets": return 1;
    default: return null;
  }
}

// The from() mock above returns counts via the then() path; the KPI legacy
// path reads `.count` off the resolved object. We also need `count`
// present on the awaited result — handled by tableCount above.

beforeAll(() => {
  __setSeedRetryBackoffForTests([0, 0]);
  localStorage.setItem("el-imtiyaz.session", JSON.stringify({ tenantId: TENANT, userId: "staff-1" }));
});

beforeEach(() => {
  localStorage.removeItem("el-imtiyaz.flags.dashboardRpc");
});

function makeRepo(opts: MockClientOptions = {}): { repo: SupabaseDashboardRepository; calls: QueryLog[]; client: Record<string, unknown> } {
  const { client, calls } = makeClient(opts);
  return {
    repo: new SupabaseDashboardRepository(client as unknown as SupabaseClient),
    calls,
    client: client as Record<string, unknown>,
  };
}

// ============================================================
// A. The migration surface
// ============================================================

describe("T-590 — A. The migration 0002 surface", () => {
  it("the four aggregation RPCs exist with the parameterized signatures (never NOW()-anchored windows)", () => {
    expect(MIGRATION_0002).toContain("create or replace function public.read_dashboard_kpis(");
    expect(MIGRATION_0002).toContain("p_academic_year text");
    expect(MIGRATION_0002).toContain("p_from date default null");
    expect(MIGRATION_0002).toContain("p_to date default null");
    expect(MIGRATION_0002).toContain("p_as_of date default null");
    expect(MIGRATION_0002).toContain("create or replace function public.read_dashboard_revenue_by_month(");
    expect(MIGRATION_0002).toContain("create or replace function public.read_dashboard_debt_aging(");
    expect(MIGRATION_0002).toContain("create or replace function public.read_dashboard_demographics(");
    // Every window predicate gates on the parameters: the year window via
    // academic_year_start (v_debt_from/v_debt_to), the revenue window via
    // v_rev_from/v_rev_to, the as-of via v_as_of.
    expect(MIGRATION_0002).toContain("v_debt_from is null or (i.due_date >= v_debt_from and i.due_date < v_debt_to)");
    expect(MIGRATION_0002).toContain("i.due_date < v_as_of");
  });

  it("the INV-4 remaining basis + the stale-positive-only exclusion (never charges-only sums)", () => {
    expect(MIGRATION_0002).toContain("greatest(0, i.amount_due - i.amount_paid - i.amount_pending)");
    // DATA-046: only rows with a REAL remaining balance age.
    expect(MIGRATION_0002).toContain("greatest(0, i.amount_due - i.amount_paid - i.amount_pending) > 0");
  });

  it("the mv_grade_summary UNIQUE INDEX lands (the REFRESH CONCURRENTLY precondition)", () => {
    expect(MIGRATION_0002).toContain("create unique index uq_mv_grade_summary");
    expect(MIGRATION_0002).toContain("on public.mv_grade_summary (tenant_id, student_id, class_subject_id)");
    // 0001 does NOT carry it (the S26 audit: chain-faithful absence).
    const migration0001 = readFileSync(join(SRC, "../supabase/migrations/0001_initial_consolidated_schema.sql"), "utf8");
    expect(migration0001).not.toContain("uq_mv_grade_summary");
  });

  it("the refresh whitelist is WIDENED to the five matviews (mv_grade_summary joins)", () => {
    expect(MIGRATION_0002).toContain("'mv_revenue_by_month', 'mv_grade_summary')");
    expect(MIGRATION_0002).toMatch(/IF p_name NOT IN \('mv_dashboard_kpis', 'mv_debt_aging', 'mv_top_debtors',\s*'mv_revenue_by_month', 'mv_grade_summary'\)/);
  });

  it("the SECURITY DEFINER + search_path discipline holds on every new function", () => {
    const bodies = MIGRATION_0002.split("create or replace function public.read_dashboard_").slice(1);
    expect(bodies).toHaveLength(4);
    for (const body of bodies) {
      expect(body).toContain("security definer");
      expect(body).toContain("set search_path to 'public'");
    }
  });

  it("the staff role gate + the tenant context gate (the read_* family convention)", () => {
    expect(MIGRATION_0002.match(/has_any_role\(array\['super_admin', 'financial_officer', 'support_staff'\]\) then/g)).toHaveLength(4);
    expect(MIGRATION_0002.match(/v_tenant := public\.current_tenant_id\(\);/g)).toHaveLength(4);
  });

  it("the aging-convention reconciliation is DOCUMENTED (0111 max vs 0123 min → the min anchor)", () => {
    expect(MIGRATION_0002).toContain("OLDEST past-due remaining");
    expect(MIGRATION_0002).toContain("installment: min(due_date)");
    expect(MIGRATION_0002).toContain("min(due_date)");
    // The superseded 0111 anchor is named — never followed by new code.
    expect(MIGRATION_0002).toContain("max(due_date)");
  });

  it("the append-only layout holds (0002 sorts after 0001; the file is an ADDITION)", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const dir = join(SRC, "../supabase/migrations");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    expect(files[0]).toBe("0001_initial_consolidated_schema.sql");
    expect(files).toContain("0002_stage_a_dashboard_aggregation.sql");
    expect(files.filter((f) => f.startsWith("0002_"))).toHaveLength(1);
  });
});

// ============================================================
// B. The repository RPC-path parity (the S8-oracle discipline)
// ============================================================

describe("T-590 — B. The RPC-path parity vs the client-side engines", () => {
  // The wall clock is pinned to the fixture as-of day (2026-04-01) — the
  // legacy engines read `new Date()` for the dynamic-overdue/aging
  // predicates and the RPC path passes p_as_of = today; WITHOUT the pin the
  // two paths evaluate different as-of days and the parity contract is
  // untestable. Only Date is faked — the retry ladder's timers stay real.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${AS_OF}T12:00:00Z`));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("kpisForRange: the RPC path === the legacy client-side engine over the same world", async () => {
    const rpcRepo = makeRepo();
    const legacyRepo = makeRepo({
      rpcOverrides: {
        read_dashboard_kpis: { data: null, error: { code: "PGRST202", message: "version skew" } },
      },
    });
    const rpc = await rpcRepo.repo.kpisForRange(YEAR, RANGE);
    const legacy = await legacyRepo.repo.kpisForRange(YEAR, RANGE);
    expect(rpc.ok).toBe(true);
    expect(legacy.ok).toBe(true);

    // The client-side oracle over the fixture rows (the SAME engine the
    // legacy path uses internally — recomputed HERE from the raw world).
    const paidInWindow = PAYMENT_ROWS.filter(
      (p) => p["status"] === "paid" && String(p["collected_at"]) >= `${RANGE.from}T00:00:00Z` && String(p["collected_at"]) < `${RANGE.to}T00:00:00Z`,
    );
    const oracleMonthlyRevenue = paidInWindow.reduce((s, p) => s + Number(p["amount"]), 0);
    const now = new Date(`${AS_OF}T12:00:00Z`);
    const unpaidInWindow = INSTALLMENT_ROWS.filter(
      (i) => i["status"] !== "paid" && String(i["due_date"]) >= "2025-09-01" && String(i["due_date"]) < "2026-09-01",
    );
    const oracleOutstanding = unpaidInWindow.reduce(
      (s, i) => s + Math.max(0, Number(i["amount_due"]) - Number(i["amount_paid"]) - Number(i["amount_pending"])), 0,
    );
    const oracleOverdue = unpaidInWindow.filter((i) =>
      isInstallmentOverdue(
        {
          status: i["status"] as string,
          amountDue: Number(i["amount_due"]),
          amountPaid: Number(i["amount_paid"]),
          amountPending: Number(i["amount_pending"]),
          dueDate: i["due_date"] as string,
        },
        now,
      ),
    );
    const oracleOverdueAmount = oracleOverdue.reduce(
      (s, i) => s + Math.max(0, Number(i["amount_due"]) - Number(i["amount_paid"]) - Number(i["amount_pending"])), 0,
    );

    expect(oracleMonthlyRevenue).toBe(1500);
    expect(oracleOutstanding).toBe(11700);
    expect(oracleOverdue).toHaveLength(3);
    expect(oracleOverdueAmount).toBe(7700);

    for (const res of [rpc, legacy]) {
      expect(res.ok && res.value.monthlyRevenue).toBe(oracleMonthlyRevenue);
      expect(res.ok && res.value.outstandingDebt).toBe(oracleOutstanding);
      expect(res.ok && res.value.overdueAlerts).toBe(oracleOverdue.length);
      expect(res.ok && res.value.overdueAmount).toBe(oracleOverdueAmount);
      expect(res.ok && res.value.totalStudents).toBe(5);
      expect(res.ok && res.value.attendanceRateToday).toBe(0.75);
    }
    // The two paths AGREE element-for-element (the parity contract).
    expect(rpc).toEqual(legacy);
  });

  it("revenueForRange: the RPC path === buildWindowAnchoredBuckets over the same world", async () => {
    const rpcRepo = makeRepo();
    const legacyRepo = makeRepo({
      rpcOverrides: {
        read_dashboard_revenue_by_month: { data: null, error: { code: "PGRST202", message: "version skew" } },
      },
    });
    const rpc = await rpcRepo.repo.revenueForRange(YEAR, RANGE);
    const legacy = await legacyRepo.repo.revenueForRange(YEAR, RANGE);
    expect(rpc.ok).toBe(true);
    expect(legacy.ok).toBe(true);

    // The client-side oracle: buildWindowAnchoredBuckets over the paid,
    // window-filtered payments.
    const rows = PAYMENT_ROWS.filter((p) => p["status"] === "paid").map((p) => ({
      amount: Number(p["amount"]),
      collectedAt: p["collected_at"] as string,
    }));
    const oracle = buildWindowAnchoredBuckets(RANGE, rows).map((b) => ({
      label: MONTH_LABELS_FR[b.month],
      amount: b.amount,
    }));
    expect(oracle.map((b) => b.label)).toEqual(["Sep", "Oct", "Nov", "Déc", "Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août"]);
    expect(oracle.find((b) => b.label === "Jan")?.amount).toBe(1000);
    expect(oracle.find((b) => b.label === "Fév")?.amount).toBe(500);

    expect(rpc).toEqual(legacy);
    expect(rpc.ok && rpc.value).toEqual(oracle);
  });

  it("debtByAgingForRange: the RPC path === the client aging engine (buckets, amounts, DISTINCT debtors, à-échoir exclusion)", async () => {
    const rpcRepo = makeRepo();
    const legacyRepo = makeRepo({
      rpcOverrides: {
        read_dashboard_debt_aging: { data: null, error: { code: "PGRST202", message: "version skew" } },
      },
    });
    const rpc = await rpcRepo.repo.debtByAgingForRange(YEAR);
    const legacy = await legacyRepo.repo.debtByAgingForRange(YEAR);
    expect(rpc.ok).toBe(true);
    expect(legacy.ok).toBe(true);

    // The client-side oracle: per-installment bucketing with the dynamic
    // predicates (isStrictlyPast + the INV-4 remaining + daysBetweenFloor
    // + agingBucketFromDays — the exact engine the legacy path runs).
    const now = new Date(`${AS_OF}T12:00:00Z`);
    const bucketKeys = ["0_30", "31_60", "61_90", "91_180", "180_plus"] as const;
    const totals = new Map<string, { amount: number; parents: Set<string> }>();
    for (const k of bucketKeys) totals.set(k, { amount: 0, parents: new Set() });
    for (const i of INSTALLMENT_ROWS) {
      const due = i["due_date"] as string;
      if (!(due >= "2025-09-01" && due < "2026-09-01")) continue;
      if (i["status"] === "paid") continue;
      const remaining = Math.max(0, Number(i["amount_due"]) - Number(i["amount_paid"]) - Number(i["amount_pending"]));
      if (remaining <= 0) continue;
      if (!isStrictlyPast(due, now)) continue; // i5: "à échoir", never ages
      const bucket = agingBucketFromDays(daysBetweenFloor(due, now));
      const entry = totals.get(bucket)!;
      entry.amount += remaining;
      if (i["parent_id"]) entry.parents.add(i["parent_id"] as string);
    }
    const oracle = bucketKeys.map((k) => ({
      bucket: k,
      amount: totals.get(k)!.amount,
      debtorCount: totals.get(k)!.parents.size,
    }));
    expect(oracle.find((b) => b.bucket === "0_30")).toEqual({ bucket: "0_30", amount: 4200, debtorCount: 1 });
    expect(oracle.find((b) => b.bucket === "91_180")).toEqual({ bucket: "91_180", amount: 3500, debtorCount: 1 });
    expect(oracle.find((b) => b.bucket === "31_60")?.amount).toBe(0);

    expect(rpc).toEqual(legacy);
    expect(rpc.ok && rpc.value).toEqual(oracle);
  });

  it("demographics: the RPC path === the legacy student-loop mapping over the same world", async () => {
    const rpcRepo = makeRepo();
    const legacyRepo = makeRepo({
      rpcOverrides: {
        read_dashboard_demographics: { data: null, error: { code: "PGRST202", message: "version skew" } },
      },
    });
    const rpc = await rpcRepo.repo.demographics();
    const legacy = await legacyRepo.repo.demographics();
    expect(rpc.ok).toBe(true);
    expect(legacy.ok).toBe(true);

    // The client-side oracle: the legacy mapping loop over the student rows.
    const classMap = new Map(CLASS_ROWS.map((c) => [c["id"] as string, { name: c["name"] as string, grade_code: c["grade_code"] as string | null }]));
    const students = STUDENT_ROWS.filter((s) => !s["deleted_at"]);
    const gradeCounts = new Map<string, number>();
    for (const s of students) {
      const cls = s["class_id"] ? classMap.get(s["class_id"] as string) : null;
      let gradeKey = "Non assigné";
      if (cls) {
        if (cls.grade_code && cls.grade_code in GRADE_LEVEL_LABELS_FR) {
          gradeKey = GRADE_LEVEL_LABELS_FR[cls.grade_code as GradeLevel];
        } else {
          gradeKey = cls.name;
        }
      } else if (s["grade_level_code"] && String(s["grade_level_code"]) in GRADE_LEVEL_LABELS_FR) {
        gradeKey = GRADE_LEVEL_LABELS_FR[s["grade_level_code"] as GradeLevel];
      }
      gradeCounts.set(gradeKey, (gradeCounts.get(gradeKey) ?? 0) + 1);
    }
    const total = students.length || 1;
    const oracleGrade = Array.from(gradeCounts.entries()).map(([label, count]) => ({
      label, count, percent: Math.round((count / total) * 100),
    }));
    expect(oracleGrade.find((g) => g.label === GRADE_LEVEL_LABELS_FR["1ap" as GradeLevel])?.count).toBe(2);
    expect(oracleGrade.find((g) => g.label === "C2NAME")?.count).toBe(1);
    expect(oracleGrade.find((g) => g.label === GRADE_LEVEL_LABELS_FR["2ap" as GradeLevel])?.count).toBe(1);
    expect(oracleGrade.find((g) => g.label === "Non assigné")?.count).toBe(1);

    expect(rpc).toEqual(legacy);
    expect(rpc.ok && rpc.value.grade).toEqual(oracleGrade);
    expect(rpc.ok && rpc.value.gender.find((g) => g.label === "Garçons")?.count).toBe(1);
    expect(rpc.ok && rpc.value.gender.find((g) => g.label === "Filles")?.count).toBe(3);
    expect(rpc.ok && rpc.value.gender.find((g) => g.label === "Non spécifié")?.count).toBe(1);
    expect(rpc.ok && rpc.value.age.find((g) => g.label === "6–8 ans")?.count).toBe(1);
    expect(rpc.ok && rpc.value.age.find((g) => g.label === "9–11 ans")?.count).toBe(1);
    expect(rpc.ok && rpc.value.age.find((g) => g.label === "12–14 ans")?.count).toBe(1);
    expect(rpc.ok && rpc.value.age.find((g) => g.label === "Non renseigné")?.count).toBe(2);
    expect(rpc.ok && rpc.value.age.find((g) => g.label === "18+ ans")?.count).toBe(0);
  });
});

// ============================================================
// C. The bounded reads' query shapes
// ============================================================

describe("T-590 — C. paymentsForRange / installmentsForYear query shapes", () => {
  it("paymentsForRange walks the keyset with the server-side window + tenant scope + projection + 1000-row pages", async () => {
    const { repo, calls } = makeRepo();
    const res = await repo.paymentsForRange(RANGE);
    expect(res.ok).toBe(true);
    const paymentsRead = calls.filter((c) => c.table === "payments" && c.op === "select");
    expect(paymentsRead.length).toBeGreaterThanOrEqual(1);
    const read = paymentsRead[0];
    expect(read.filters).toContainEqual({ col: "tenant_id", value: TENANT });
    expect(read.filters).toContainEqual({ col: "collected_at", op: "gte", value: "2025-09-01T00:00:00Z" });
    expect(read.filters).toContainEqual({ col: "collected_at", op: "lt", value: "2026-09-01T00:00:00Z" });
    expect(read.filters).toContainEqual({ col: "__order_id", value: true });
    expect(read.filters).toContainEqual({ col: "__limit", value: 1000 });
    // In-window rows only (P4 outside; P3 pending is INCLUDED — the
    // observable carried every status; the tabs filter status themselves).
    expect(res.ok && res.value.map((p) => p.id).sort()).toEqual(["p1", "p2", "p3"]);
    // The mapper reuse: the mapped objects are mapPaymentRow outputs.
    expect(res.ok && res.value[0]).toEqual(mapPaymentRow(PAYMENT_ROWS[0] as never));
  });

  it("paymentsForRange refuses an unbounded range (honest Err, never a full-tenant read)", async () => {
    const { repo, calls } = makeRepo();
    const res = await repo.paymentsForRange({} as { from: string; to: string });
    expect(res.ok).toBe(false);
    expect(calls.filter((c) => c.table === "payments")).toHaveLength(0);
  });

  it("installmentsForYear walks the keyset with the year window server-side + due_date order restored", async () => {
    const { repo, calls } = makeRepo();
    const res = await repo.installmentsForYear(YEAR);
    expect(res.ok).toBe(true);
    const read = calls.filter((c) => c.table === "installments" && c.op === "select")[0];
    expect(read.filters).toContainEqual({ col: "tenant_id", value: TENANT });
    expect(read.filters).toContainEqual({ col: "due_date", op: "gte", value: "2025-09-01" });
    expect(read.filters).toContainEqual({ col: "due_date", op: "lt", value: "2026-09-01" });
    expect(read.filters).toContainEqual({ col: "__order_id", value: true });
    // In-year rows only; paid included (the observable's contract — the
    // derivations filter status themselves); i7 outside the year excluded.
    expect(res.ok && res.value.map((i) => i.id).sort()).toEqual(["i1", "i2", "i4", "i5", "i6"]);
    // due_date ascending — the shared cache's observable order contract.
    const dues = (res.ok ? res.value : []).map((i) => i.dueDate);
    expect(dues).toEqual([...dues].sort((a, b) => a.localeCompare(b)));
    expect(res.ok && res.value[0]).toEqual(mapInstallmentRow(INSTALLMENT_ROWS[0] as never));
  });

  it("installmentsForYear with an unparseable year keeps the honest no-window full walk", async () => {
    const { repo, calls } = makeRepo();
    const res = await repo.installmentsForYear("nope");
    expect(res.ok).toBe(true);
    const read = calls.filter((c) => c.table === "installments" && c.op === "select")[0];
    expect(read.filters).not.toContainEqual({ col: "due_date", op: "gte", value: expect.any(String) });
    expect(res.ok && res.value.map((i) => i.id).sort()).toEqual(["i1", "i2", "i4", "i5", "i6", "i7"]);
  });

  it("a >1000-row world walks MULTIPLE keyset pages (the walk never truncates)", async () => {
    // A dedicated client whose payments table carries 1501 in-window rows.
    const bigRows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 1501; i++) {
      bigRows.push({
        id: `big-${String(i).padStart(5, "0")}`, tenant_id: TENANT, amount: 1, status: "paid",
        collected_at: "2026-01-15T00:00:00Z", method: "cash", category: "tuition",
      });
    }
    const { client, calls } = makeClient();
    const origFrom = (client as Record<string, unknown>).from as (t: string) => Record<string, unknown>;
    (client as Record<string, unknown>).from = (table: string) => {
      if (table !== "payments") return origFrom(table);
      const rec: QueryLog = { table, op: "select", filters: [] };
      calls.push(rec);
      const q: Record<string, unknown> = {};
      q.select = () => { rec.op = "select"; return q; };
      q.eq = (col: string, value: unknown) => { rec.filters.push({ col, value }); return q; };
      q.gte = (col: string, value: unknown) => { rec.filters.push({ col, op: "gte", value }); return q; };
      q.lt = (col: string, value: unknown) => { rec.filters.push({ col, op: "lt", value }); return q; };
      q.gt = (col: string, value: unknown) => { rec.filters.push({ col, op: "gt", value }); return q; };
      q.order = (col: string, o?: { ascending?: boolean }) => { rec.filters.push({ col: `__order_${col}`, value: o?.ascending }); return q; };
      q.limit = (n: number) => { rec.filters.push({ col: "__limit", value: n }); return q; };
      Object.defineProperty(q, "then", {
        value: (onFulfilled?: (v: { data: unknown; error: null }) => unknown) => {
          const gt = rec.filters.find((f) => f.col === "id" && f.op === "gt")?.value as string | undefined;
          const filtered = gt ? bigRows.filter((r) => String(r["id"]) > (gt as string)) : bigRows;
          const page = filtered.slice(0, 1000);
          return onFulfilled
            ? Promise.resolve({ data: page, error: null }).then(onFulfilled as (v: unknown) => unknown)
            : undefined;
        },
        configurable: true,
      });
      return q;
    };
    const repo = new SupabaseDashboardRepository(client as unknown as SupabaseClient);
    const res = await repo.paymentsForRange(RANGE);
    expect(res.ok).toBe(true);
    expect(res.ok && res.value).toHaveLength(1501);
    // TWO pages fired (1000 + 501) — the walk exhausts, never truncates.
    const pages = calls.filter((c) => c.table === "payments" && c.op === "select");
    expect(pages).toHaveLength(2);
  });
});

// ============================================================
// D. The feature flag + the version-skew fallback
// ============================================================

describe("T-590 — D. The feature flag + the version-skew wire", () => {
  it('the flag OFF ("0") forces the legacy path — NO aggregation RPC call', async () => {
    localStorage.setItem("el-imtiyaz.flags.dashboardRpc", "0");
    const { repo, client } = makeRepo();
    const res = await repo.kpisForRange(YEAR, RANGE);
    expect(res.ok).toBe(true);
    const rpcCalls = (client as { __rpcCalls: Array<{ fn: string }> }).__rpcCalls;
    expect(rpcCalls.map((c) => c.fn)).not.toContain("read_dashboard_kpis");
    // The legacy collections still answered (the RPC collection surface).
    expect(rpcCalls.map((c) => c.fn)).toContain("read_payments_collection");
    localStorage.removeItem("el-imtiyaz.flags.dashboardRpc");
  });

  it("the version-skew (PGRST202) falls back to the legacy path — the flag never traps the dashboard", async () => {
    const { repo, client } = makeRepo({
      rpcOverrides: {
        read_dashboard_kpis: { data: null, error: { code: "PGRST202", message: "version skew" } },
      },
    });
    const res = await repo.kpisForRange(YEAR, RANGE);
    expect(res.ok).toBe(true);
    expect(res.ok && res.value.monthlyRevenue).toBe(1500);
    const rpcCalls = (client as { __rpcCalls: Array<{ fn: string }> }).__rpcCalls;
    expect(rpcCalls.map((c) => c.fn)).toContain("read_payments_collection");
  });

  it("the default path calls the aggregation RPC (the compact surface is PRIMARY)", async () => {
    const { repo, client } = makeRepo();
    const res = await repo.kpisForRange(YEAR, RANGE);
    expect(res.ok).toBe(true);
    const rpcCalls = (client as { __rpcCalls: Array<{ fn: string; args?: Record<string, unknown> }> }).__rpcCalls;
    const kpi = rpcCalls.find((c) => c.fn === "read_dashboard_kpis");
    expect(kpi).toBeDefined();
    expect(kpi?.args?.p_academic_year).toBe(YEAR);
    expect(kpi?.args?.p_from).toBe("2025-09-01");
    expect(kpi?.args?.p_to).toBe("2026-09-01");
    // The compact path reads NO collections.
    expect(rpcCalls.map((c) => c.fn)).not.toContain("read_payments_collection");
    expect(rpcCalls.map((c) => c.fn)).not.toContain("read_installments_collection");
  });
});

// ============================================================
// E. The page/tab source guards (the ARCH-040 third path is gone)
// ============================================================

describe("T-590 — E. The page/tab source guards", () => {
  it("dashboard-page.tsx: the payments/installments full-collection subscriptions are GONE", () => {
    expect(PAGE_SRC).not.toContain("repos.payments.observe()");
    expect(PAGE_SRC).not.toContain("repos.installments.observe()");
  });

  it("dashboard-page.tsx: the bounded reads are wired into the ONE data effect", () => {
    expect(PAGE_SRC).toContain("repos.dashboard.paymentsForRange(");
    expect(PAGE_SRC).toContain("repos.dashboard.installmentsForYear(");
    expect(PAGE_SRC.match(/useEffect\(\(\) => \{\s*const selectedRange = yearRange\.range;/s)).toBeTruthy();
  });

  it("analytics-tab.tsx: the internal installments fallback is GATED on the prop", () => {
    expect(ANALYTICS_TAB_SRC).toContain("if (installmentsProp) return;");
    expect(ANALYTICS_TAB_SRC).not.toContain("useObservable(() => repos.installments.observe()");
  });

  it("the repository carries the feature flag + the fallback wire (documented)", () => {
    expect(DASHBOARD_REPO_SRC).toContain("el-imtiyaz.flags.dashboardRpc");
    expect(DASHBOARD_REPO_SRC).toContain("isRpcUnavailableError");
  });
});

// ============================================================
// F. The mock repository's bounded reads (cross-backend parity)
// ============================================================

describe("T-590 — F. The mock repository's bounded reads", () => {
  it("paymentsForRange windows by [from, to) on collectedAt", async () => {
    const repo = new MockDashboardRepository();
    const res = await repo.paymentsForRange({ from: "2020-01-01", to: "2100-01-01" });
    expect(res.ok).toBe(true);
    for (const p of res.ok ? res.value : []) {
      expect(p.collectedAt >= "2020-01-01" && p.collectedAt < "2100-01-01").toBe(true);
    }
    expect((res.ok ? res.value : []).length).toBeGreaterThan(0);
  });

  it("installmentsForYear: an unparseable year returns the stream unchanged; a parsed year windows by dueDate", async () => {
    const repo = new MockDashboardRepository();
    const all = await repo.installmentsForYear("nope");
    const scoped = await repo.installmentsForYear("2025-2026");
    expect(all.ok).toBe(true);
    expect(scoped.ok).toBe(true);
    const scopedRows = scoped.ok ? scoped.value : [];
    for (const i of scopedRows) {
      expect(i.dueDate >= "2025-09-01" && i.dueDate < "2026-09-01").toBe(true);
    }
    expect(all.ok && all.value.length).toBeGreaterThanOrEqual(scopedRows.length);
  });
});
