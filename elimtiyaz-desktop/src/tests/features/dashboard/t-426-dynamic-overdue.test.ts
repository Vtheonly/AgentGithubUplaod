/**
 * T-426 — the issues-#24/#25 data-accuracy family: the dynamic-overdue
 * predicate + the aging future-row guard.
 *
 * DATA-046 (Phase A): `debtByAgingForRange` must exclude not-yet-due rows
 * from EVERY aging bucket. `daysBetweenFloor` clamps a future due date to
 * 0 (not negative), so a future T2/T3 tranche silently landed in the
 * "0_30" bucket — inflating the "current" band (and the Overview tab's
 * overdue-family count, which sums the buckets' debtorCount) with
 * balances that are not late at all.
 *
 * DATA-045 (Phase B): the KPI's overdue metrics must be DYNAMIC (temporal),
 * never the static `status === "overdue"` string filter. Live evidence
 * (2026-09-28, read-only census): `installments.status` carries ONLY
 * paid/unpaid/partial on live data — ZERO rows carry "overdue" — while 874
 * rows ARE dynamically overdue (not paid + due_date < now + remaining > 0).
 * Every surface that filtered the status string rendered "0 f. en retard"
 * / "0 DZD échues" with perfect confidence.
 *
 * The fake client follows the t-353 convention (the RPC-less keyset
 * fallback leg is part of the tested contract, §15.64e).
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseDashboardRepository } from "../../../infrastructure/supabase/repositories/supabase-dashboard-repository";
import { isInstallmentOverdue, overdueAmount } from "../../../domain/calc/payment/queries";
import type { Installment } from "../../../domain/model/payment";

type Row = Record<string, unknown>;

function isoDaysFromNow(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString();
}

function makeClient(data: Row[] = []) {
  const client = {
    from(_table: string) {
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
        // The unavailable-class shape (PGRST202 — version skew): the fake
        // is intentionally RPC-less so the KEYSET fallback leg runs (the
        // §15.64e contract, same as the t-353 fake).
        error: { code: "PGRST202", message: "Could not find the function" },
      }),
  };
  return { client: client as unknown as SupabaseClient };
}

const PAST_DUE = {
  id: "ins-past",
  parent_id: "p-past",
  due_date: isoDaysFromNow(-30), // 30 days late
  amount_due: 100_000,
  amount_paid: 0,
  amount_pending: 0,
  status: "unpaid",
};
const FUTURE = {
  id: "ins-future",
  parent_id: "p-future",
  due_date: isoDaysFromNow(90), // a T2-style not-yet-due tranche
  amount_due: 50_000,
  amount_paid: 0,
  amount_pending: 0,
  status: "unpaid",
};
const STALE_STATUS_OVERDUE = {
  id: "ins-stale",
  parent_id: "p-stale",
  due_date: isoDaysFromNow(-60),
  amount_due: 80_000,
  amount_paid: 80_000, // fully paid — the status string alone must not count it
  amount_pending: 0,
  status: "overdue",
};

describe("T-426 Phase A (DATA-046) — the aging buckets exclude not-yet-due rows", () => {
  it("a future tranche never lands in any bucket (daysBetweenFloor clamps to 0, not negative — the 0_30 band is the trap)", async () => {
    const { client } = makeClient([PAST_DUE, FUTURE]);
    const repo = new SupabaseDashboardRepository(client);
    const res = await repo.debtByAgingForRange("garbage"); // unscoped: the guard is the only filter
    expect(res.ok).toBe(true);
    if (res.ok) {
      const sum = res.value.reduce((s, b) => s + b.amount, 0);
      expect(sum).toBe(100_000); // the future row's 50_000 never reaches a bucket
      const b030 = res.value.find((b) => b.bucket === "0_30");
      expect(b030?.amount).toBe(100_000); // ONLY the 30-days-late row
      expect(b030?.debtorCount).toBe(1); // the future row's parent is not a "0-30 days" debtor
    }
  });
});

describe("T-426 Phase B (DATA-045) — the canonical dynamic-overdue predicate", () => {
  const mk = (over: Partial<Installment>): Installment =>
    ({
      id: "i",
      tenantId: "t",
      parentId: "p",
      studentId: null,
      category: "tuition",
      label: "Tranche",
      trancheNumber: 1,
      amountDue: 100,
      amountPaid: 0,
      amountPending: 0,
      dueDate: isoDaysFromNow(-1),
      status: "unpaid",
      academicCycle: null,
      createdAt: "",
      updatedAt: "",
      ...over,
    }) as Installment;

  it("a not-paid, past-due, owing row IS overdue (the live 874-row class)", () => {
    expect(isInstallmentOverdue(mk({}))).toBe(true);
  });

  it("a future-due row is NOT overdue even when it owes (a T2/T3 tranche)", () => {
    expect(isInstallmentOverdue(mk({ dueDate: isoDaysFromNow(90) }))).toBe(false);
  });

  it("a paid row is never overdue — even one carrying a stale status string", () => {
    expect(isInstallmentOverdue(mk({ status: "paid" }))).toBe(false);
    // The live-data trap: a fully-paid row whose status still says "overdue"
    // must NOT be counted by the temporal predicate.
    expect(
      isInstallmentOverdue(mk({ status: "overdue", amountPaid: 100 })),
    ).toBe(false);
  });

  it("a past-due row fully covered by pending (uncleared) funds is NOT overdue", () => {
    expect(isInstallmentOverdue(mk({ amountPending: 100 }))).toBe(false);
  });

  it("overdueAmount sums ONLY the dynamically-overdue rows", () => {
    const rows = [
      mk({ amountDue: 100 }), // overdue
      mk({ amountDue: 200, dueDate: isoDaysFromNow(30) }), // future — excluded
      mk({ amountDue: 300, amountPaid: 300 }), // settled — excluded
    ];
    expect(overdueAmount(rows)).toBe(100);
  });
});

describe("T-426 Phase B (DATA-045) — the KPI's overdue metrics are dynamic (never the status string)", () => {
  it("overdueAlerts counts dynamically-overdue rows; a fully-paid row with status='overdue' is excluded; a future row is excluded", async () => {
    const { client } = makeClient([PAST_DUE, FUTURE, STALE_STATUS_OVERDUE]);
    const repo = new SupabaseDashboardRepository(client);
    const res = await repo.kpisForRange("garbage");
    expect(res.ok).toBe(true);
    if (res.ok) {
      // ONLY the past-due owing row (the future tranche and the stale-status
      // paid row are both excluded — the pre-fix code returned 1 here by
      // counting the stale status string, or 1-by-luck; the pinned
      // semantic is the temporal one).
      expect(res.value.overdueAlerts).toBe(1);
      expect(res.value.overdueAmount).toBe(100_000);
    }
  });
});

describe("T-426 Phase C (TIME-001) — the KPI month window is UTC-midnight-anchored", () => {
  // The window's boundaries must match revenueForRange's T00:00:00Z
  // convention: inclusive start, EXCLUSIVE end, both at UTC midnight. The
  // old local-time constructors shifted each boundary by the machine's
  // timezone offset (UTC+1: the start landed 23:00 of the previous day),
  // placing the boundary hour's payments in a different month than the
  // chart on the same screen.
  it("monthlyRevenue counts exactly [monthStart, monthEnd) at UTC midnight (inclusive start, exclusive end)", async () => {
    const now = new Date();
    const startIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const endIso = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    ).toISOString();
    const payments = [
      { id: "pay-at-start", amount: 1_000, collected_at: startIso, status: "paid" }, // inclusive start
      { id: "pay-just-before-end", amount: 2_000, collected_at: new Date(Date.parse(endIso) - 1).toISOString(), status: "paid" }, // last ms of the month
      { id: "pay-at-end", amount: 4_000, collected_at: endIso, status: "paid" }, // EXCLUSIVE end — next month
      { id: "pay-before-start", amount: 8_000, collected_at: new Date(Date.parse(startIso) - 1).toISOString(), status: "paid" }, // previous month
    ];
    const { client } = makeClient(payments as Row[]);
    const repo = new SupabaseDashboardRepository(client);
    const res = await repo.kpisForRange("garbage"); // unscoped year: only the month window applies
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.monthlyRevenue).toBe(3_000); // 1,000 + 2,000 — the boundary pins
    }
  });
});

describe("T-426 Phase D (DATA-047) — the demographics grade fallback + the honest degradation", () => {
  it("an unassigned student (class_id NULL) groups under their ENROLLED grade level, not 'Non assigné'", async () => {
    // The fake returns the same rows for every table; the demographics
    // path reads students (with grade_level_code) + classes (empty here —
    // classMap misses the class_id).
    const { client } = makeClient([
      {
        id: "s-unassigned",
        gender: "male",
        date_of_birth: null,
        class_id: null,
        grade_level_code: "1ap",
      },
    ]);
    const repo = new SupabaseDashboardRepository(client);
    const res = await repo.demographics();
    expect(res.ok).toBe(true);
    if (res.ok) {
      const gradeLabels = res.value.grade.map((g) => g.label);
      expect(gradeLabels).toContain("1AP"); // GRADE_LEVEL_LABELS_FR["1ap"]
      expect(gradeLabels).not.toContain("Non assigné");
    }
  });

  it("a failed KPI read returns Err (the consumer renders '—') — never fabricated zeroes", async () => {
    const boom = {
      from: () => {
        const q: Record<string, unknown> = {};
        const chain = () => {
          throw new Error("simulated 57014 statement timeout");
        };
        q.select = chain;
        q.eq = chain;
        q.then = chain;
        return q;
      },
      rpc: () => Promise.reject(new Error("simulated RPC failure")),
    };
    const repo = new SupabaseDashboardRepository(boom as unknown as SupabaseClient);
    const res = await repo.kpisForRange("2026-2027");
    expect(res.ok).toBe(false); // the silent-zero Ok fallback is gone (DATA-047)
  });
});
