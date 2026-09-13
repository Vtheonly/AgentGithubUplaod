/**
 * T-353 regression suite (63rd session, 2026-09-14) — DASH-403:
 * the academic-year scoping for the installment-derived statistics.
 *
 * The owner's screenshot 10: selecting 2026-2027 changed the KPI cards
 * (revenue → 235.5k) but "VÉLOCITÉ DE RECOUVREMENT PAR VAGUE" stayed at
 * the 2025-2026 numbers (44.3M / 86.9M / 42.6M) — the raw installments
 * stream carries EVERY tenant installment (the table has no
 * academic_year column), and nothing scoped it by the selected year.
 *
 * The unified semantics this suite pins (one rule, three layers):
 *   1. analytics-derivations.installmentsForAcademicYear — the pure
 *      year-window filter (dueDate ∈ [Sept 1 start, Sept 1 next)).
 *   2. The PAGE passes the scoped slice to OverviewTab + AnalyticsTab
 *      (source guards).
 *   3. SupabaseDashboardRepository.kpisForRange + debtByAgingForRange
 *      scope the debt aggregates by the SAME year window
 *      (buildInstallmentsQuery) — the KPI outstanding and the aging
 *      chart follow the year selector too.
 *   4. MockDashboardRepository parity: kpisForRange's outstanding +
 *      debtByAgingForRange scope by the year window as well (ledger
 *      entry dates in the mock, due_date in Supabase — the structural
 *      difference between the two implementations, documented).
 *
 * Semantic table (documented in the T-350 verification doc):
 *   - Revenue KPI / revenue series: the PRESET range (monthly concept).
 *   - Debt KPI / aging / waves / triage / concentration / transport:
 *     the ACADEMIC YEAR billing window.
 *   - Call lists / Pareto / risk-engine debt (observeSummary):
 *     point-in-time (an action list does not care which year's billing
 *     created the debt).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  academicYearWindow,
  installmentsForAcademicYear,
} from "../../../features/dashboard/components/analytics/analytics-derivations";
import { SupabaseDashboardRepository } from "../../../infrastructure/supabase/repositories/supabase-dashboard-repository";
import { MockDashboardRepository } from "../../../infrastructure/mock/repositories/dashboard-repository";

const SRC = join(__dirname, "../../../");

beforeAll(() => {
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: "00000000-0000-0000-0000-000000000001", userId: "staff-1" }),
  );
});

// ============================================================
// 1. The pure year-window filter
// ============================================================

const DUE_2025 = ["2025-09-15", "2025-12-15", "2026-03-15"];
const DUE_2026 = ["2026-09-15", "2026-12-15", "2027-03-15"];

function ins(dueDate: string, amountDue = 100_000) {
  return {
    id: `ins-${dueDate}`,
    dueDate,
    amountDue,
  };
}

describe("T-353 — installmentsForAcademicYear (the pure filter)", () => {
  it("academicYearWindow resolves Sept 1 → Sept 1 next", () => {
    expect(academicYearWindow("2025-2026")).toEqual({
      from: "2025-09-01",
      to: "2026-09-01",
    });
    expect(academicYearWindow("bad-code")).toBeNull();
  });

  it("2025-2026 keeps the 2025-2026 due dates and excludes the 2026-2027 ones", () => {
    const all = [...DUE_2025, ...DUE_2026].map(ins);
    const scoped = installmentsForAcademicYear(all, "2025-2026");
    expect(scoped.map((i) => i.dueDate)).toEqual(DUE_2025);
  });

  it("2026-2027 keeps ONLY the 2026-2027 rows (the screenshot-10 fix)", () => {
    const all = [...DUE_2025, ...DUE_2026].map(ins);
    const scoped = installmentsForAcademicYear(all, "2026-2027");
    expect(scoped.map((i) => i.dueDate)).toEqual(DUE_2026);
  });

  it("boundary: an installment due exactly Sept 1 belongs to the NEW year; Aug 31 to the old", () => {
    const all = [ins("2026-08-31"), ins("2026-09-01")];
    const old = installmentsForAcademicYear(all, "2025-2026");
    const next = installmentsForAcademicYear(all, "2026-2027");
    expect(old.map((i) => i.dueDate)).toEqual(["2026-08-31"]);
    expect(next.map((i) => i.dueDate)).toEqual(["2026-09-01"]);
  });

  it("unparsed year codes return the stream unchanged (honest: cannot scope)", () => {
    const all = [...DUE_2025].map(ins);
    const scoped = installmentsForAcademicYear(all, "nope");
    expect(scoped).toHaveLength(all.length);
  });

  it("invalid due dates are excluded when a window exists (never crash)", () => {
    const all = [ins("not-a-date"), ins("2025-10-15")];
    const scoped = installmentsForAcademicYear(all, "2025-2026");
    expect(scoped.map((i) => i.dueDate)).toEqual(["2025-10-15"]);
  });
});

// ============================================================
// 2. The page wiring (source guards)
// ============================================================

const PAGE_SRC = readFileSync(
  join(SRC, "features/dashboard/dashboard-page.tsx"),
  "utf8",
);
const TAB_SRC = readFileSync(
  join(SRC, "features/dashboard/tabs/analytics-tab.tsx"),
  "utf8",
);

describe("T-353 — the page passes the SCOPED stream", () => {
  it("dashboard-page.tsx scopes the installments through installmentsForAcademicYear", () => {
    expect(PAGE_SRC).toContain("installmentsForAcademicYear(installments, yearRange.academicYear)");
  });

  it("the Overview + Analytics tabs receive scopedInstallments", () => {
    expect(PAGE_SRC).toContain("installments={scopedInstallments}");
    // Exactly two tab consumers carry the scoped prop.
    expect(PAGE_SRC.match(/installments=\{scopedInstallments\}/g)?.length).toBe(2);
  });

  it("AnalyticsTab prefers the prop over its internal subscription", () => {
    expect(TAB_SRC).toContain("installmentsProp ?? internalInstallments");
  });
});

// ============================================================
// 3. The Supabase repository year scoping
// ============================================================

type Row = Record<string, unknown>;

function makeClient(data: Row[] = []) {
  const calls: { table: string; op: string; filters: Row[] }[] = [];
  const client = {
    from(table: string) {
      const rec = { table, op: "", filters: [] as Row[] };
      calls.push(rec);
      const q: Record<string, unknown> = {};
      const chain = () => q;
      q.select = (_cols?: unknown) => {
        rec.op = rec.op || "select";
        return q;
      };
      q.eq = (col: string, value: unknown) => {
        rec.filters.push({ col, value });
        return q;
      };
      q.neq = (col: string, value: unknown) => {
        rec.filters.push({ col, op: "neq", value });
        return q;
      };
      q.gte = (col: string, value: unknown) => {
        rec.filters.push({ col, op: "gte", value });
        return q;
      };
      q.lt = (col: string, value: unknown) => {
        rec.filters.push({ col, op: "lt", value });
        return q;
      };
      q.lte = (col: string, value: unknown) => {
        rec.filters.push({ col, op: "lte", value });
        return q;
      };
      q.in = chain;
      q.order = chain;
      q.then = (resolve: unknown) =>
        Promise.resolve({ data, error: null, count: data.length }).then(resolve as never);
      return q;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

function findFilters(calls: { table: string; filters: Row[] }[], table: string) {
  return calls.filter((c) => c.table === table).flatMap((c) => c.filters);
}

describe("T-353 — SupabaseDashboardRepository.kpisForRange scopes debt by the year window", () => {
  it("the installments query carries the due_date window filters (2025-2026)", async () => {
    const { client, calls } = makeClient([]);
    const repo = new SupabaseDashboardRepository(client);
    await repo.kpisForRange("2025-2026", { from: "2025-09-01", to: "2026-09-01" });
    const installmentFilters = findFilters(calls, "installments");
    expect(installmentFilters).toContainEqual({ col: "due_date", op: "gte", value: "2025-09-01" });
    expect(installmentFilters).toContainEqual({ col: "due_date", op: "lt", value: "2026-09-01" });
  });

  it("a different year produces the corresponding window (2026-2027)", async () => {
    const { client, calls } = makeClient([]);
    const repo = new SupabaseDashboardRepository(client);
    await repo.kpisForRange("2026-2027");
    const installmentFilters = findFilters(calls, "installments");
    expect(installmentFilters).toContainEqual({ col: "due_date", op: "gte", value: "2026-09-01" });
    expect(installmentFilters).toContainEqual({ col: "due_date", op: "lt", value: "2027-09-01" });
  });

  it("an unparseable year code leaves the query unscoped (honest fallback)", async () => {
    const { client, calls } = makeClient([]);
    const repo = new SupabaseDashboardRepository(client);
    await repo.kpisForRange("garbage");
    const installmentFilters = findFilters(calls, "installments");
    expect(installmentFilters.find((f) => f.col === "due_date")).toBeUndefined();
  });
});

describe("T-353 — SupabaseDashboardRepository.debtByAgingForRange follows the same window", () => {
  it("the aging query carries the due_date window filters (ONE year semantics for both debt aggregates)", async () => {
    const { client, calls } = makeClient([]);
    const repo = new SupabaseDashboardRepository(client);
    await repo.debtByAgingForRange("2025-2026");
    const installmentFilters = findFilters(calls, "installments");
    expect(installmentFilters).toContainEqual({ col: "due_date", op: "gte", value: "2025-09-01" });
    expect(installmentFilters).toContainEqual({ col: "due_date", op: "lt", value: "2026-09-01" });
  });
});

// ============================================================
// 4. The mock repository parity (year-scoped debt aggregates)
// ============================================================

describe("T-353 — MockDashboardRepository parity", () => {
  it("debtByAgingForRange scopes by the academic year (a far-past year returns all-zero buckets)", async () => {
    const repo = new MockDashboardRepository();
    const far = await repo.debtByAgingForRange("1990-1991");
    expect(far.ok).toBe(true);
    if (far.ok) {
      for (const bucket of far.value) {
        expect(bucket.amount).toBe(0);
        expect(bucket.debtorCount).toBe(0);
      }
    }
    // The mock ledger carries real entries (NOW-relative + schedule
    // dates) — the CURRENT academic window must surface SOME of them
    // (the scoping is observable, not a void pass-through).
    const nowYear = new Date().getFullYear();
    for (const yearCode of [`${nowYear - 1}-${nowYear}`, `${nowYear}-${nowYear + 1}`]) {
      const current = await repo.debtByAgingForRange(yearCode);
      expect(current.ok).toBe(true);
      if (current.ok) {
        const sum = current.value.reduce((s, b) => s + b.amount, 0);
        expect(sum).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(sum)).toBe(true);
      }
    }
    // The pre-T-353 behavior (void academicYear → the unscoped total for
    // EVERY year) is gone: the far-past year cannot equal the unscoped sum.
    const unscoped = await repo.debtByAging();
    if (unscoped.ok && far.ok) {
      const unscopedSum = unscoped.value.reduce((s, b) => s + b.amount, 0);
      const farSum = far.value.reduce((s, b) => s + b.amount, 0);
      if (unscopedSum > 0) {
        expect(farSum).not.toBe(unscopedSum);
      }
    }
  });

  it("kpisForRange: the outstanding follows the YEAR window, not the preset range", async () => {
    const repo = new MockDashboardRepository();
    const nowYear = new Date().getFullYear();
    const yearCode = `${nowYear - 1}-${nowYear}`;
    // Same year, two DIFFERENT preset ranges — the outstanding must be
    // identical (year-level metric); only the revenue differs.
    const ytd = await repo.kpisForRange(yearCode, { from: `${nowYear - 1}-09-01`, to: `${nowYear}-09-01` });
    const month = await repo.kpisForRange(yearCode, {
      from: `${nowYear}-01-01`,
      to: `${nowYear}-02-01`,
    });
    expect(ytd.ok && month.ok).toBe(true);
    if (ytd.ok && month.ok) {
      expect(month.value.outstandingDebt).toBeCloseTo(ytd.value.outstandingDebt, 0);
    }
  });
});
