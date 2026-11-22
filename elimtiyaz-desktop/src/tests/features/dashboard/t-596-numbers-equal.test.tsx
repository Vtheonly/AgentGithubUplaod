/**
 * T-596 — the NUMBERS-EQUAL acceptance gate (the plan's §5: "Dashboard and
 * Payments/Finance render identical totals for the same query" — the D-U2
 * ONE-engine mandate's UI-level proof).
 *
 * The two surfaces' data paths, over ONE fixture corpus:
 *   DASHBOARD (Overview): the REAL SupabaseDashboardRepository.kpisForRange
 *     over the t-426-convention fake client (RPC-less — PGRST202 version
 *     skew — so the client-side fallback computes through the SAME domain
 *     predicates the compact RPC applies server-side);
 *   FINANCE (the hub's KPI row): the domain functions financials-page.tsx
 *     itself calls — monthlyRevenue(payments) [domain/calc/payment/revenue],
 *     overdueAmount(installments) [domain/calc/payment/queries] — and the
 *     §15 installment basis (max(0, due − paid − pending)) that
 *     read_debt_summary_collection applies per parent for the Creances
 *     totals (the finance hub's « Encours total créances » sums exactly
 *     those summaries).
 *
 * The gate: every headline total the dashboard's KPI bundle reports MUST
 * equal the finance side's derivation over the same rows. Any drift — a
 * different window convention, a different remaining formula, a different
 * paid filter — breaks this suite. This is the structural guarantee
 * E4.5/T-590 built (the one engine); this suite pins it end-to-end.
 *
 * Plus the two CONSUMPTION source pins (the t-230 pattern): the Overview
 * tab renders kpis.* verbatim (it never derives its own totals), and the
 * finance hub derives through the domain functions (never a private
 * reduce on a different basis).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseDashboardRepository } from "../../../infrastructure/supabase/repositories/supabase-dashboard-repository";
import { monthlyRevenue } from "../../../domain/calc/payment/revenue";
import { sumPaidPayments } from "../../../domain/calc/payment/sums";
import { overdueAmount } from "../../../domain/calc/payment/queries";
import type { Installment, Payment } from "../../../domain/model/payment";

/* ── The per-table fake client (the t-426 convention, table-aware) ─────── */

type Row = Record<string, unknown>;

function makeClient(tables: Record<string, Row[]>) {
  const client = {
    from(table: string) {
      const data = tables[table] ?? [];
      const q: Record<string, unknown> = {};
      const chain = () => q;
      q.select = (_cols?: unknown) => q;
      q.eq = chain;
      q.neq = chain;
      q.gte = chain;
      q.lt = chain;
      q.lte = chain;
      q.in = chain;
      q.order = chain;
      q.gt = chain;
      q.limit = chain;
      q.range = chain;
      q.is = chain;
      q.then = (resolve: unknown) =>
        Promise.resolve({ data, error: null, count: data.length }).then(resolve as never);
      return q;
    },
    rpc: () =>
      Promise.resolve({
        data: null,
        // PGRST202 — version skew: the fake is intentionally RPC-less so
        // the CLIENT-SIDE fallback leg runs (the §15.64e contract; the
        // same convention as the t-353/t-426 fakes).
        error: { code: "PGRST202", message: "Could not find the function" },
      }),
  };
  return { client: client as unknown as SupabaseClient };
}

/* ── The fixture corpus (ONE academic year, mixed states) ─────────────── */

const YEAR = "2026-2027";

// Unpaid installments, in the year's billing window:
//   A: 30-days-late partial (65_000 remaining, overdue)
//   B: future T2 tranche (80_000 remaining, NOT overdue)
//   D: 3-weeks-late untouched (200_000 remaining, overdue)
// Excluded rows proving the scoping:
//   C: fully-paid (status "paid" — never in the outstanding basis)
//   E: last year's due date (outside the 2026-2027 window)
const INS_A = { id: "ins-a", parent_id: "p1", due_date: "2026-09-15", amount_due: 100_000, amount_paid: 30_000, amount_pending: 5_000, status: "unpaid" };
const INS_B = { id: "ins-b", parent_id: "p1", due_date: "2026-12-15", amount_due: 80_000, amount_paid: 0, amount_pending: 0, status: "unpaid" };
const INS_C = { id: "ins-c", parent_id: "p2", due_date: "2026-10-01", amount_due: 50_000, amount_paid: 50_000, amount_pending: 0, status: "paid" };
const INS_D = { id: "ins-d", parent_id: "p3", due_date: "2026-11-01", amount_due: 200_000, amount_paid: 0, amount_pending: 0, status: "unpaid" };
const INS_E = { id: "ins-e", parent_id: "p4", due_date: "2025-12-15", amount_due: 70_000, amount_paid: 0, amount_pending: 0, status: "unpaid" };

// Paid payments (the repo's collection read filters status="paid"):
//   1+2: this month (November 2026) → the monthly revenue
//   3:   August 2026 → the cumulative total only
const PAY_1 = { id: "pay-1", amount: 30_000, collected_at: "2026-11-05T10:00:00Z", status: "paid" };
const PAY_2 = { id: "pay-2", amount: 25_000, collected_at: "2026-11-20T14:30:00Z", status: "paid" };
const PAY_3 = { id: "pay-3", amount: 40_000, collected_at: "2026-08-10T09:00:00Z", status: "paid" };

function domainInstallment(row: typeof INS_A): Installment {
  return {
    id: row.id,
    parentId: row.parent_id,
    studentId: null,
    category: "tuition",
    label: "Tranche",
    trancheNumber: 1,
    amountDue: row.amount_due,
    amountPaid: row.amount_paid,
    amountPending: row.amount_pending,
    dueDate: row.due_date,
    status: row.status as Installment["status"],
    paidDate: null,
    academicCycle: undefined,
  };
}

function domainPayment(row: typeof PAY_1): Payment {
  return {
    id: row.id,
    tenantId: "00000000-0000-0000-0000-000000000001",
    receiptNumber: `REC-${row.id}`,
    parentId: "p1",
    studentId: null,
    amount: row.amount,
    method: "cash",
    status: "paid",
    category: null,
    installmentId: null,
    proofUrl: null,
    notes: null,
    collectedBy: "admin",
    collectedAt: row.collected_at,
    createdAt: row.collected_at,
    updatedAt: row.collected_at,
  };
}

/** The §15 installment basis — the formula read_debt_summary_collection
 *  applies per unpaid installment (and the dashboard's KPI reduce): the
 *  remaining balance is max(0, due − paid − pending). */
function section15Basis(rows: readonly Row[]): number {
  return rows
    .filter((r) => r.status !== "paid")
    .reduce(
      (sum, r) =>
        sum +
        Math.max(
          0,
          (Number(r.amount_due) || 0) - (Number(r.amount_paid) || 0) - (Number(r.amount_pending) || 0),
        ),
      0,
    );
}

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
});

describe("T-596 — the numbers-equal acceptance gate (D-U2: ONE engine, both surfaces)", () => {
  it("the Dashboard's KPI bundle equals the Finance side's derivations over the same corpus (revenue, outstanding, overdue)", async () => {
    const unpaidInYear = [INS_A, INS_B, INS_D]; // C is paid; E is out of window
    const paidPayments = [PAY_1, PAY_2, PAY_3];
    const { client } = makeClient({
      installments: [INS_A, INS_B, INS_C, INS_D, INS_E],
      payments: paidPayments,
      students: [{ id: "s1" }, { id: "s2" }],
      parents: [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
      personnel: [{ id: "w1" }],
      expense_tickets: [{ id: "e1" }],
      attendance_records: [{ status: "present" }, { status: "late" }],
    });
    const repo = new SupabaseDashboardRepository(client);

    // ── The DASHBOARD side (the Overview tab's data path) ──
    const kpis = await repo.kpisForRange(YEAR);
    expect(kpis.ok).toBe(true);
    if (!kpis.ok) throw new Error("kpisForRange failed");

    // ── The FINANCE side (the hub's own derivations) ──
    const financeMonthlyRevenue = monthlyRevenue(paidPayments.map(domainPayment));
    const financeOverdue = overdueAmount(unpaidInYear.map(domainInstallment));
    const financeOutstanding = section15Basis(unpaidInYear); // the Creances basis

    // The numbers-equal verdicts:
    expect(kpis.value.monthlyRevenue).toBe(financeMonthlyRevenue); // 55_000
    expect(kpis.value.outstandingDebt).toBe(financeOutstanding); // 345_000
    expect(kpis.value.overdueAmount).toBe(financeOverdue); // 265_000

    // The exact expectations (the fixture is small enough to pin outright):
    expect(financeMonthlyRevenue).toBe(55_000); // pay-1 + pay-2 (November); pay-3 is August
    expect(financeOutstanding).toBe(345_000); // A 65_000 + B 80_000 + D 200_000
    expect(financeOverdue).toBe(265_000); // A + D only — the future B is "à échoir"
    expect(kpis.value.overdueAmount).toBeLessThanOrEqual(kpis.value.outstandingDebt);

    // The cumulative register total (the finance hub's « Encaissé (cumul) »):
    expect(sumPaidPayments(paidPayments.map(domainPayment))).toBe(95_000);
  });

  it("the scoping pins: a fully-paid row and an out-of-window row never reach the dashboard's outstanding", async () => {
    const { client } = makeClient({
      installments: [INS_A, INS_B, INS_C, INS_D, INS_E],
      payments: [PAY_1],
      students: [],
      parents: [],
      personnel: [],
      expense_tickets: [],
      attendance_records: [],
    });
    const repo = new SupabaseDashboardRepository(client);
    const kpis = await repo.kpisForRange(YEAR);
    expect(kpis.ok).toBe(true);
    if (!kpis.ok) throw new Error("kpisForRange failed");
    // 345_000 — NOT 465_000 (C's paid row would add 0 anyway, but its
    // presence proves the status filter) and NOT 415_000 (E's 70_000
    // out-of-window row must not leak into the year's basis).
    expect(kpis.value.outstandingDebt).toBe(345_000);
  });

  it("the CONSUMPTION pins: the Overview tab renders kpis.* verbatim; the finance hub derives through the domain functions (never a private basis)", () => {
    const overviewSrc = readFileSync(
      join(__dirname, "../../../features/dashboard/tabs/overview-tab.tsx"),
      "utf8",
    );
    const financeSrc = readFileSync(
      join(__dirname, "../../../features/financials/financials-page.tsx"),
      "utf8",
    );
    // The Overview tab's headline cards consume the KPI bundle's fields.
    expect(overviewSrc).toContain("kpis.monthlyRevenue");
    expect(overviewSrc).toContain("kpis?.outstandingDebt");
    // The finance hub's headline cards derive through the domain functions.
    expect(financeSrc).toContain("monthlyRevenue(payments)");
    expect(financeSrc).toContain("overdueAmount(installments)");
    expect(financeSrc).toContain("sumPaidPayments(payments)");
  });
});
