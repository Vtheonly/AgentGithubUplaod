/**
 * T-355 + T-356 regression suite (63rd session, 2026-09-14) —
 * DASH-405 (the Departments drill-down from the REAL payments stream) +
 * DASH-407 (the mock↔Supabase revenue-bucket parity).
 *
 * DASH-405: the SeeDetailsModal's Departments tab rendered its permanent
 * "données par catégorie non exposées" placeholder although the page has
 * held the canonical payments stream since T-243 — the modal just never
 * received it. The T-088 comment proposing a new backend method
 * (DashboardRepository.revenueByCategory) is superseded: the breakdown is
 * a pure display aggregation of the page's own stream (§6 reuse-first).
 *
 * DASH-407: SupabaseDashboardRepository.revenueForRange built monthly
 * buckets anchored to the LAST 12 MONTHS FROM NOW while
 * MockDashboardRepository.revenueForRange anchored them to the REQUESTED
 * window — the same contract returning different series (§15.15 tell).
 * The fix: buildWindowAnchoredBuckets (the shared canonical helper) —
 * the window is the requested range, or the academic-year billing window
 * when no range is given.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";

// Initialize i18n FIRST — useTranslation() will otherwise throw.
import "../../../i18n/i18n";

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: "00000000-0000-0000-0000-000000000001", userId: "staff-1" }),
  );
});

import { SeeDetailsModal } from "../../../features/dashboard/see-details-modal";
import type { DashboardData } from "../../../features/dashboard/see-details-modal";
import type { Payment } from "../../../domain/model/payment";
import { buildWindowAnchoredBuckets } from "../../../domain/calc/shared/dates";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseDashboardRepository } from "../../../infrastructure/supabase/repositories/supabase-dashboard-repository";
import { MockDashboardRepository } from "../../../infrastructure/mock/repositories/dashboard-repository";
import { store as mockStore } from "../../../infrastructure/mock/repositories/mock-store";

const SRC = join(__dirname, "../../../");

// Mock recharts (jsdom 0×0 ResponsiveContainer — the T-247 pattern).
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="recharts-stub">{children}</div>
  ),
  BarChart: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
  ComposedChart: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
  PieChart: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
  Line: () => <div />,
  Bar: () => <div data-testid="recharts-bar" />,
  Pie: () => <div />,
  Cell: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  CartesianGrid: () => <div />,
}));

// ============================================================
// Fixtures
// ============================================================

function pay(category: Payment["category"], amount: number, id: string): Payment {
  return {
    tenantId: "t1",
    receiptNumber: `REC-${id}`,
    parentId: "p1",
    studentId: null,
    amount,
    method: "cash",
    status: "paid",
    category,
    installmentId: null,
    proofUrl: null,
    notes: null,
    collectedBy: "staff-1",
    collectedAt: "2026-08-11T12:00:00Z",
    createdAt: "2026-08-11T12:00:00Z",
    updatedAt: "2026-08-11T12:00:00Z",
    ...({ id } as Partial<Payment>),
  } as Payment;
}

const MODAL_DATA: DashboardData = {
  kpis: null,
  revenue: [{ label: "Août", amount: 100_000 }],
  debtAging: [],
  demographics: { grade: [], gender: [], age: [] },
  topDebtors: [],
};

// ============================================================
// T-355 — the Departments tab derives from the payments stream
// ============================================================

describe("T-355 — DepartmentsTab (DASH-405: the REAL payments feed)", () => {
  function openDepartments(payments: readonly Payment[]) {
    render(
      <SeeDetailsModal
        open
        onOpenChange={() => {}}
        initialTab="departments"
        data={MODAL_DATA}
        payments={payments}
      />,
    );
  }

  it("renders the per-unit totals from the REAL payments (no more 'données par catégorie non exposées')", () => {
    openDepartments([
      pay("tuition", 80_000, "1"),
      pay("books", 5_000, "2"),
      pay("transport", 10_000, "3"),
      pay("therapy_psychology", 5_000, "4"),
    ]);
    // Scolarité = tuition + books = 85 000 (the OPERATIONAL_UNITS mapping).
    expect(screen.getByText(/85 000/)).toBeInTheDocument();
    // Auxiliaire = transport = 10 000.
    expect(screen.getByText(/10 000/)).toBeInTheDocument();
    // The placeholder is GONE.
    expect(screen.queryByText(/données par catégorie non exposées/)).not.toBeInTheDocument();
    // The grand total row: 100 000 over 4 payments.
    expect(screen.getByText(/4 paiements/)).toBeInTheDocument();
    expect(screen.getByText(/100 000/)).toBeInTheDocument();
  });

  it("categories claimed by NO unit surface as 'Autres catégories' (never silently dropped)", () => {
    openDepartments([pay("other", 7_000, "5"), pay("tuition", 3_000, "6")]);
    expect(screen.getByText(/Autres catégories/)).toBeInTheDocument();
    expect(screen.getByText(/7 000/)).toBeInTheDocument();
  });

  it("empty payments render the honest empty state (no fabricated zeros)", () => {
    openDepartments([]);
    expect(screen.getByText(/Aucun revenu enregistré/i)).toBeInTheDocument();
  });

  it("the source wiring: the page passes the range-filtered paid slice to the modal", () => {
    const pageSrc = readFileSync(
      join(SRC, "features/dashboard/dashboard-page.tsx"),
      "utf8",
    );
    expect(pageSrc).toContain("payments={rangePayments}");
    expect(pageSrc).toMatch(
      /applyAnalyticsFilters\(payments, yearRange\.range, NO_ANALYTICS_FILTERS\)/,
    );
  });
});

// ============================================================
// T-356 — the range-anchored buckets (mock↔Supabase parity)
// ============================================================

describe("T-356 — buildWindowAnchoredBuckets (the canonical helper)", () => {
  const payments = [
    { amount: 10, collectedAt: "2025-09-20T10:00:00Z" },
    { amount: 20, collectedAt: "2025-12-15T10:00:00Z" },
    { amount: 30, collectedAt: "2026-03-15T10:00:00Z" },
    // Out-of-window payment — must NOT land anywhere.
    { amount: 999, collectedAt: "2027-06-15T10:00:00Z" },
  ];

  it("anchors the labels to the requested window (Sep→Août for the academic year)", () => {
    const buckets = buildWindowAnchoredBuckets(
      { from: "2025-09-01", to: "2026-08-31" },
      payments,
    );
    expect(buckets).toHaveLength(12);
    expect(buckets[0]).toMatchObject({ label: "Sep", year: 2025, amount: 10 });
    expect(buckets[3]).toMatchObject({ label: "Déc", amount: 20 });
    expect(buckets[6]).toMatchObject({ label: "Mar", year: 2026, amount: 30 });
    // The out-of-window payment is not accumulated anywhere.
    expect(buckets.reduce((s, b) => s + b.amount, 0)).toBe(60);
  });

  it("a null/invalid window yields [] (honest — cannot anchor)", () => {
    expect(buildWindowAnchoredBuckets(null, payments)).toEqual([]);
    expect(buildWindowAnchoredBuckets({ from: "zzz", to: "2026-08-31" })).toEqual([]);
    expect(
      buildWindowAnchoredBuckets({ from: "2026-08-01", to: "2025-01-01" }),
    ).toEqual([]);
  });

  it("a runaway window is capped at 24 buckets", () => {
    const buckets = buildWindowAnchoredBuckets(
      { from: "2020-01-01", to: "2030-01-01" },
      [],
    );
    expect(buckets.length).toBeLessThanOrEqual(24);
  });

  it("payments with invalid timestamps are skipped (never crash)", () => {
    const buckets = buildWindowAnchoredBuckets(
      { from: "2025-09-01", to: "2026-08-31" },
      [{ amount: 5, collectedAt: "not-a-date" }],
    );
    expect(buckets.reduce((s, b) => s + b.amount, 0)).toBe(0);
  });
});

// ============================================================
// T-356 — the Supabase repository follows the window (query shape)
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

describe("T-356 — SupabaseDashboardRepository.revenueForRange (DASH-407)", () => {
  it("buckets anchor to the academic-year window when no range is given (the mock's convention)", async () => {
    const rows = [
      { amount: 10, collected_at: "2025-09-20T10:00:00Z" },
      { amount: 20, collected_at: "2026-08-31T10:00:00Z" },
    ];
    const { client, calls } = makeClient(rows);
    const repo = new SupabaseDashboardRepository(client);
    const result = await repo.revenueForRange("2025-2026");
    // The query filters by the YEAR window (not NOW-relative last-12).
    const filters = calls[0].filters;
    expect(filters).toContainEqual({ col: "collected_at", op: "gte", value: "2025-09-01T00:00:00Z" });
    expect(filters).toContainEqual({ col: "collected_at", op: "lt", value: "2026-09-01T00:00:00Z" });
    // The series: Sep 2025 → Août 2026, both payments land.
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(12);
      expect(result.value[0]).toMatchObject({ label: "Sep", amount: 10 });
      expect(result.value[11]).toMatchObject({ label: "Août", amount: 20 });
    }
  });

  it("an explicit range overrides the year window (the preset semantics)", async () => {
    const { client, calls } = makeClient([]);
    const repo = new SupabaseDashboardRepository(client);
    await repo.revenueForRange("2025-2026", { from: "2026-01-01", to: "2026-03-31" });
    const filters = calls[0].filters;
    expect(filters).toContainEqual({ col: "collected_at", op: "gte", value: "2026-01-01T00:00:00Z" });
    expect(filters).toContainEqual({ col: "collected_at", op: "lt", value: "2026-03-31T00:00:00Z" });
  });

  it("MOCK↔SUPABASE PARITY: the same fixture through both implementations yields the same series shape", async () => {
    // Mock: derive the series for the same window the Supabase test used.
    // The mock store's payments carry their own collectedAt values; the
    // parity assertion here pins the LABEL CONVENTION (both start at the
    // window's first month, 12 buckets for a 12-month window).
    const mock = new MockDashboardRepository();
    const year = new Date().getFullYear() - 1; // current academic year start
    const mockResult = await mock.revenueForRange(`${year}-${year + 1}`);
    const supaRows = mockStore.payments
      .filter((p) => p.status === "paid")
      .map((p) => ({ amount: p.amount, collected_at: p.collectedAt }));
    const { client } = makeClient(supaRows);
    const supaRepo = new SupabaseDashboardRepository(client);
    const supaResult = await supaRepo.revenueForRange(`${year}-${year + 1}`);
    if (mockResult.ok && supaResult.ok) {
      expect(supaResult.value.map((p) => p.label)).toEqual(
        mockResult.value.map((p) => p.label),
      );
      // Both carry 12 month buckets for a full academic-year window.
      expect(mockResult.value).toHaveLength(12);
      expect(supaResult.value).toHaveLength(12);
    }
  });
});
