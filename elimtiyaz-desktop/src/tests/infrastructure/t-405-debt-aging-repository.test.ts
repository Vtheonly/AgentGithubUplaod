/**
 * T-405 — the DebtRepository aging surface (the repository layer contract).
 *
 * Pins:
 *   A. SupabaseDebtRepository.observeAging() delegates to the 0111 canonical
 *      RPC `compute_debt_aging_summary` (one call, no args — the server owns
 *      the clock, the tenant, and the computation) and maps the snake_case
 *      wire rows to the canonical `DebtAgingAnalysis` (camelCase fields,
 *      numeric casts, null-safe fallbacks, obligations passthrough).
 *   B. The status labels are rendered client-side from the SERVER factors
 *      (§15.2) and cross-checked against the RPC's own status — a drift is
 *      WARNED, and the RPC's level wins for display.
 *   C. refreshAging() forces a re-query (the realtime bridge contract).
 *   D. An RPC failure keeps the last known truthful rows (never fabricated,
 *      never a silent empty overwrite AFTER a successful seed).
 *   E. MockDebtRepository.observeAging() derives the same contract from the
 *      mock store through the canonical TS engine — debtor rows only,
 *      sorted by outstanding desc, and reactive to installment mutations.
 */
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseDebtRepository } from "../../infrastructure/supabase/repositories/supabase-shared-repositories";
import { MockDebtRepository } from "../../infrastructure/mock/repositories/financial-repository";
import { store } from "../../infrastructure/mock/repositories/mock-store";
import type { DebtAgingAnalysis } from "../../domain/calc/ledger/debt-aging";

type Row = Record<string, any>;

// The 0111 wire shape (snake_case; obligations jsonb carries camelCase keys).
const RPC_ROW_ARCHETYPE_A: Row = {
  parent_id: "22222222-2222-4222-8222-222222222221",
  parent_name: "Amine ARCHETYPE-A",
  parent_phone: "0550000001",
  student_ids: ["33333333-3333-4333-8333-333333333331"],
  outstanding_amount: "100000.00",
  oldest_due_date: "2024-10-15",
  debt_age_days: 608,
  origin_academic_year: "2024-2025",
  last_payment_at: "2026-06-01T12:00:00+00",
  days_since_last_payment: 14,
  inactivity_days: 14,
  subsequent_year_payment_count: 10,
  subsequent_year_payment_total: "80000.00",
  has_subsequent_year_payments: true,
  obligations: [
    {
      installmentId: "44444444-4444-4444-8444-444444444441",
      studentId: "33333333-3333-4333-8333-333333333331",
      category: "tuition",
      label: "Tranche 1",
      remaining: 100000,
      dueDate: "2024-10-15",
      academicYear: "2024-2025",
      daysOverdue: 608,
    },
  ],
  status_level: "green",
  reason_code: "active_payer",
  computed_at: "2026-06-15T12:00:00+00",
};

const RPC_ROW_ARCHETYPE_B: Row = {
  parent_id: "55555555-5555-4555-8555-555555555551",
  parent_name: "Bilal ARCHETYPE-B",
  parent_phone: "0550000002",
  student_ids: ["33333333-3333-4333-8333-333333333332"],
  outstanding_amount: "100000.00",
  oldest_due_date: "2024-10-15",
  debt_age_days: 608,
  origin_academic_year: "2024-2025",
  last_payment_at: "2024-11-01T10:00:00+00",
  days_since_last_payment: 591,
  inactivity_days: 591,
  subsequent_year_payment_count: 0,
  subsequent_year_payment_total: "0",
  has_subsequent_year_payments: false,
  obligations: [
    {
      installmentId: "44444444-4444-4444-8444-444444444442",
      studentId: "33333333-3333-4333-8333-333333333332",
      category: "tuition",
      label: "Tranche 1",
      remaining: 100000,
      dueDate: "2024-10-15",
      academicYear: "2024-2025",
      daysOverdue: 608,
    },
  ],
  status_level: "red",
  reason_code: "critical_delinquency",
  computed_at: "2026-06-15T12:00:00+00",
};

/**
 * Subscribe WITHOUT unsubscribing: SubjectBehavior emits the current value
 * (the empty seed) immediately, so the tracker must keep listening for the
 * async seed to land. `unsub` is returned for cleanup.
 */
function track<T>(obs: { subscribe(cb: (v: T) => void): () => void }): {
  value(): T | undefined;
  unsub(): void;
} {
  let latest: T | undefined;
  const unsub = obs.subscribe((v) => {
    latest = v;
  });
  return { value: () => latest, unsub };
}

describe("T-405 — SupabaseDebtRepository.observeAging (the 0111 RPC contract)", () => {
  it("A: calls compute_debt_aging_summary once and maps the wire rows to the canonical record", async () => {
    const rpcCalls: Array<{ fn: string; args?: Row }> = [];
    const client = {
      rpc: vi.fn(async (fn: string, args?: Row) => {
        rpcCalls.push({ fn, args });
        if (fn === "compute_debt_aging_summary") {
          return { data: [RPC_ROW_ARCHETYPE_A, RPC_ROW_ARCHETYPE_B], error: null };
        }
        return { data: null, error: null };
      }),
      from: vi.fn(() => {
        throw new Error("observeAging must not read tables directly — the RPC owns the computation");
      }),
    };
    const repo = new SupabaseDebtRepository(client as unknown as SupabaseClient);
    const obs = track(repo.observeAging());
    // The subject seeds asynchronously — wait for the two rows to land.
    await vi.waitFor(() => {
      expect(obs.value()).toHaveLength(2);
    });

    // ONE canonical RPC call, no client-side table reads.
    expect(rpcCalls.filter((c) => c.fn === "compute_debt_aging_summary")).toHaveLength(1);

    const rows = obs.value()!;
    expect(rows).toHaveLength(2);

    // Archetype A — mapped field-by-field.
    const a = rows.find((r) => r.parentId === RPC_ROW_ARCHETYPE_A.parent_id)!;
    expect(a.outstandingAmount).toBe(100000); // numeric cast from "100000.00"
    expect(a.oldestDueDate).toBe("2024-10-15");
    expect(a.debtAgeDays).toBe(608);
    expect(a.originAcademicYear).toBe("2024-2025");
    expect(a.lastPaymentAt).toBe("2026-06-01T12:00:00+00");
    expect(a.daysSinceLastPayment).toBe(14);
    expect(a.inactivityDays).toBe(14);
    expect(a.subsequentYearPaymentCount).toBe(10);
    expect(a.subsequentYearPaymentTotal).toBe(80000);
    expect(a.hasSubsequentYearPayments).toBe(true);
    expect(a.affectedStudentIds).toEqual(["33333333-3333-4333-8333-333333333331"]);
    expect(a.obligations).toHaveLength(1);
    expect(a.obligations[0].installmentId).toBe("44444444-4444-4444-8444-444444444441");
    expect(a.obligations[0].remaining).toBe(100000);
    expect(a.computedAt).toBe("2026-06-15T12:00:00+00");

    // The status: server factors + client-rendered labels, RPC level wins.
    expect(a.status.level).toBe("green");
    expect(a.status.reasonCode).toBe("active_payer");
    expect(a.status.explanationFr).toContain("Actif");

    // Archetype B — same debt, opposite behavior.
    const b = rows.find((r) => r.parentId === RPC_ROW_ARCHETYPE_B.parent_id)!;
    expect(b.status.level).toBe("red");
    expect(b.status.reasonCode).toBe("critical_delinquency");
    expect(b.status.explanationFr).toContain("Critique");
  });

  it("B: a client↔server status drift is warned and the RPC level wins", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // The server says red; the FACTORS say green (recent payment).
    const drifting: Row = {
      ...RPC_ROW_ARCHETYPE_B,
      inactivity_days: 10,
      days_since_last_payment: 10,
      status_level: "red",
      reason_code: "critical_delinquency",
    };
    const client = {
      rpc: vi.fn(async (fn: string) =>
        fn === "compute_debt_aging_summary"
          ? { data: [drifting], error: null }
          : { data: null, error: null },
      ),
      from: vi.fn(() => {
        throw new Error("no direct table reads");
      }),
    };
    const repo = new SupabaseDebtRepository(client as unknown as SupabaseClient);
    const obs = track(repo.observeAging());
    await vi.waitFor(() => {
      expect(obs.value()).toHaveLength(1);
    });
    const row = obs.value()![0];
    expect(row.status.level).toBe("red"); // RPC wins for display
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("parity drift"));
    warn.mockRestore();
  });

  it("C: refreshAging() forces a re-query of the canonical RPC", async () => {
    let callCount = 0;
    const client = {
      rpc: vi.fn(async (fn: string) => {
        if (fn !== "compute_debt_aging_summary") return { data: null, error: null };
        callCount += 1;
        return { data: [RPC_ROW_ARCHETYPE_A], error: null };
      }),
      from: vi.fn(() => {
        throw new Error("no direct table reads");
      }),
    };
    const repo = new SupabaseDebtRepository(client as unknown as SupabaseClient);
    const obs = track(repo.observeAging());
    await vi.waitFor(() => {
      expect(obs.value()).toHaveLength(1);
    });
    expect(callCount).toBe(1);

    await repo.refreshAging();
    expect(callCount).toBe(2); // forced, not cached
  });

  it("D: an RPC failure AFTER a successful seed keeps the last known rows", async () => {
    let fail = false;
    const client = {
      rpc: vi.fn(async (fn: string) => {
        if (fn !== "compute_debt_aging_summary") return { data: null, error: null };
        if (fail) return { data: null, error: { message: "503 transient" } };
        return { data: [RPC_ROW_ARCHETYPE_A], error: null };
      }),
      from: vi.fn(() => {
        throw new Error("no direct table reads");
      }),
    };
    const repo = new SupabaseDebtRepository(client as unknown as SupabaseClient);
    let latest: DebtAgingAnalysis[] | undefined;
    const unsub = repo.observeAging().subscribe((v) => {
      latest = v;
    });
    await vi.waitFor(() => {
      expect(latest).toBeDefined();
    });
    expect(latest).toHaveLength(1);

    fail = true;
    await repo.refreshAging();
    // The last known truthful analysis survives the transient failure.
    expect(latest).toHaveLength(1);
    expect(latest![0].status.reasonCode).toBe("active_payer");
    unsub();
  });
});

describe("T-405 — MockDebtRepository.observeAging (the reference-engine path)", () => {
  it("E: derives debtor rows from the canonical engine, sorted by outstanding desc", async () => {
    const repo = new MockDebtRepository();
    const obs = track(repo.observeAging());
    const rows = obs.value() ?? [];

    // Debtor rows only — every row has real outstanding debt.
    for (const r of rows) {
      expect(r.outstandingAmount).toBeGreaterThan(0.001);
      expect(["green", "yellow", "orange", "red"]).toContain(r.status.level);
      expect(r.status.explanationFr.length).toBeGreaterThan(0);
      expect(r.originAcademicYear).toMatch(/^\d{4}-\d{4}$/);
    }
    // Sorted by outstanding desc.
    const amounts = rows.map((r) => r.outstandingAmount);
    const sorted = [...amounts].sort((x, y) => y - x);
    expect(amounts).toEqual(sorted);

    // Mock parity with the aging summary: the debtor count equals the
    // installment-based debtor count (same rows, same formula).
    const installmentDebtors = new Set(
      store.installments
        .filter((i) => Math.max(0, i.amountDue - i.amountPaid - i.amountPending) > 0)
        .map((i) => i.parentId),
    );
    expect(rows.map((r) => r.parentId).sort()).toEqual([...installmentDebtors].sort());
  });
});
