/**
 * T-423 — the finance-seed honest-degradation regression suite (CACHE-103,
 * GitHub issue #23 Phase A1+A2).
 *
 * Pins the semantics the owner's finance-zeros report exposed:
 *   A. A FAILED seed never overwrites a populated cache (keep-last-known —
 *      the seedAging convention). The old `catch { this.cache.set([]) }`
 *      rendered a 57014 statement timeout as confident 0 DZD KPIs and
 *      "Aucune tranche T1/T2/T3".
 *   B. A failed FIRST load keeps the (empty) cache but surfaces the
 *      degradation on the reactive health stream — "no data + Échec du
 *      chargement", never a silent zero indistinguishable from an empty
 *      database (§15.63a).
 *   C. The retry ladder actually retries (fail, fail, succeed → healthy).
 *   D. A recovery (successful re-seed after a failure) clears the
 *      degraded state.
 *   E. refresh()/refreshSummary() force a re-read past the TTL (the
 *      page's "Réessayer" hook).
 *   F. The same contract on every financial seed site: payments,
 *      installments, ledger, debtSummary, allocations.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SupabasePaymentRepository,
  SupabaseLedgerRepository,
  SupabaseInstallmentRepository,
  SupabaseDebtRepository,
  observeSeedHealth,
  getSeedHealth,
  __resetSeedHealthForTests,
  __resetSeedDiagnosticsForTests,
  __setSeedRetryBackoffForTests,
} from "../../infrastructure/supabase/repositories/supabase-shared-repositories";

type Row = Record<string, unknown>;
const TENANT = "00000000-0000-0000-0000-000000000001";

/**
 * The failure-injecting fake (the supabase-repositories.test.ts FakeQuery
 * pattern + a per-table read-failure hook — the piece that file never
 * needed). Each `.from(table)` chain resolves {data, error}; setting
 * `failReads[table] = n` makes the next n reads of that table return the
 * 57014 statement-timeout error shape the live probes captured.
 */
function createFlakyClient(tables: Record<string, Row[]>) {
  const state: Record<string, Row[]> = Object.fromEntries(
    Object.entries(tables).map(([k, v]) => [k, [...v]]),
  );
  const failReads: Record<string, number> = {};

  class Q {
    private filters: ((r: Row) => boolean)[] = [];
    private orders: { col: string; asc: boolean }[] = [];
    private rangeClause: [number, number] | null = null;
    private limitClause: number | null = null;
    constructor(private readonly table: string) {}
    select() {
      return this;
    }
    eq(col: string, v: unknown) {
      this.filters.push((r) => r[col] === v);
      return this;
    }
    neq(col: string, v: unknown) {
      this.filters.push((r) => r[col] !== v);
      return this;
    }
    is(col: string, v: null) {
      this.filters.push((r) => (v === null ? r[col] == null : r[col] === v));
      return this;
    }
    in(col: string, vals: unknown[]) {
      this.filters.push((r) => vals.includes(r[col]));
      return this;
    }
    order(col: string, opts?: { ascending?: boolean }) {
      this.orders.push({ col, asc: opts?.ascending !== false });
      return this;
    }
    range(from: number, to: number) {
      this.rangeClause = [from, to];
      return this;
    }
    limit(n: number) {
      this.limitClause = n;
      return this;
    }
    then(resolve: (v: { data: Row[] | null; error: { message: string; code?: string } | null }) => void, reject?: (e: unknown) => void) {
      return this.exec().then(resolve, reject);
    }
    private async exec() {
      if (failReads[this.table] > 0) {
        failReads[this.table] -= 1;
        return {
          data: null,
          error: {
            code: "57014",
            message: "canceling statement due to statement timeout",
          },
        };
      }
      let rows = (state[this.table] ?? []).filter((r) => this.filters.every((f) => f(r)));
      for (const o of this.orders) {
        rows = [...rows].sort((a, b) => {
          const av = String(a[o.col] ?? "");
          const bv = String(b[o.col] ?? "");
          return o.asc ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }
      if (this.rangeClause) rows = rows.slice(this.rangeClause[0], this.rangeClause[1] + 1);
      if (this.limitClause != null) rows = rows.slice(0, this.limitClause);
      return { data: rows, error: null };
    }
  }

  return {
    client: {
      from: (t: string) => new Q(t),
      rpc: async () => ({ data: null, error: null }),
    } as unknown as SupabaseClient,
    failReads,
    state,
  };
}

function setSessionTenant() {
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: TENANT, userId: "staff-1" }),
  );
}

const PAYMENT_ROWS: Row[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    tenant_id: TENANT,
    parent_id: "22222222-2222-4222-8222-222222222221",
    student_id: null,
    amount: "50000",
    method: "cash",
    status: "paid",
    category: "tuition",
    collected_at: "2026-09-20T10:00:00Z",
    payment_number: "IMP-001",
    receipt_number: "R-001",
  },
  {
    id: "11111111-1111-4111-8111-111111111112",
    tenant_id: TENANT,
    parent_id: "22222222-2222-4222-8222-222222222221",
    student_id: null,
    amount: "30000",
    method: "cash",
    status: "paid",
    category: "transport",
    collected_at: "2026-09-21T10:00:00Z",
    payment_number: "IMP-002",
    receipt_number: "R-002",
  },
];

const INSTALLMENT_ROWS: Row[] = [
  {
    id: "44444444-4444-4444-8444-444444444441",
    tenant_id: TENANT,
    parent_id: "22222222-2222-4222-8222-222222222221",
    student_id: "33333333-3333-4333-8333-333333333331",
    category: "tuition",
    label: "Tranche 1",
    tranche_number: 1,
    amount_due: "100000",
    amount_paid: "50000",
    amount_pending: "0",
    due_date: "2026-09-15",
    status: "partial",
  },
  {
    id: "44444444-4444-4444-8444-444444444442",
    tenant_id: TENANT,
    parent_id: "22222222-2222-4222-8222-222222222221",
    student_id: "33333333-3333-4333-8333-333333333331",
    category: "tuition",
    label: "Tranche 2",
    tranche_number: 2,
    amount_due: "100000",
    amount_paid: "0",
    amount_pending: "0",
    due_date: "2026-12-15",
    status: "unpaid",
  },
];

const LEDGER_ROWS: Row[] = [
  {
    id: "55555555-5555-4555-8555-555555555551",
    tenant_id: TENANT,
    parent_id: "22222222-2222-4222-8222-222222222221",
    entry_type: "charge",
    entry_date: "2026-09-10",
    amount: "300000",
    category: "tuition",
    source_type: "import",
    at: "2026-09-10T00:00:00Z",
  },
  {
    id: "55555555-5555-4555-8555-555555555552",
    tenant_id: TENANT,
    parent_id: "22222222-2222-4222-8222-222222222221",
    entry_type: "payment",
    entry_date: "2026-09-20",
    amount: "-50000",
    category: "tuition",
    source_type: "payment",
    at: "2026-09-20T00:00:00Z",
  },
];

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

beforeEach(() => {
  localStorage.clear();
  setSessionTenant();
  __resetSeedHealthForTests();
  __resetSeedDiagnosticsForTests();
  __setSeedRetryBackoffForTests([0, 0]); // the retry ladder with no real delays
});

afterEach(() => {
  __setSeedRetryBackoffForTests([1000, 3000]); // restore the production ladder
});

describe("T-423 — the financial seeds' honest degradation (CACHE-103)", () => {
  it("A: a FAILED refresh keeps the previously-loaded payments — never wipes a populated cache", async () => {
    const { client, failReads } = createFlakyClient({ payments: PAYMENT_ROWS });
    const repo = new SupabasePaymentRepository(client);
    const obs = track(repo.observe());
    await vi.waitFor(() => {
      expect(obs.value()).toHaveLength(2);
    });
    expect(getSeedHealth("payments")?.state).toBe("ok");

    // Every read of the next seed attempt dies with the live 57014 shape.
    failReads.payments = 99;
    await repo.refresh();
    // The last known truthful rows survive the transient failure.
    expect(obs.value()).toHaveLength(2);
    expect(obs.value()!.reduce((s, p) => s + p.amount, 0)).toBe(80000);
    expect(getSeedHealth("payments")?.state).toBe("degraded");
    expect(getSeedHealth("payments")?.code).toBe("57014");
    obs.unsub();
  });

  it("B: a failed FIRST load keeps the empty cache but surfaces the degradation — never a silent zero", async () => {
    const { client, failReads } = createFlakyClient({ installments: INSTALLMENT_ROWS });
    failReads.installments = 99;
    const repo = new SupabaseInstallmentRepository(client);
    const obs = track(repo.observe());
    // Wait for the seed attempts to settle (retry ladder at 0ms → immediate).
    await vi.waitFor(() => {
      expect(getSeedHealth("installments")?.state).toBe("degraded");
    });
    // The cache stays empty (nothing was ever loaded) — but the UI can tell
    // "load failed" from "no data" through the health stream, which is the
    // entire point of CACHE-103's fix (§15.63a: a silent empty cache is a
    // lie about the database).
    expect(obs.value()).toHaveLength(0);
    const health = observeSeedHealth().get().find((h) => h.source === "installments");
    expect(health?.state).toBe("degraded");
    expect(health?.message).toContain("statement timeout");
    obs.unsub();
  });

  it("C: the retry ladder retries the whole read — fail, fail, then succeed lands healthy", async () => {
    const { client, failReads } = createFlakyClient({ payments: PAYMENT_ROWS });
    // The default ladder is 3 attempts (1 + 2 retries at 0ms in tests):
    // two failures then a success must recover.
    failReads.payments = 2;
    const repo = new SupabasePaymentRepository(client);
    const obs = track(repo.observe());
    await vi.waitFor(() => {
      expect(obs.value()).toHaveLength(2);
    });
    expect(getSeedHealth("payments")?.state).toBe("ok");
    obs.unsub();
  });

  it("D: a successful re-seed after a failure clears the degraded state", async () => {
    const { client, failReads } = createFlakyClient({ ledger_entries: LEDGER_ROWS });
    failReads.ledger_entries = 99;
    const repo = new SupabaseLedgerRepository(client);
    const obs = track(repo.observe());
    await vi.waitFor(() => {
      expect(getSeedHealth("ledger")?.state).toBe("degraded");
    });
    // The database recovers; the next forced refresh lands.
    delete failReads.ledger_entries;
    await repo.refresh();
    await vi.waitFor(() => {
      expect(obs.value()).toHaveLength(2);
    });
    expect(getSeedHealth("ledger")?.state).toBe("ok");
    obs.unsub();
  });

  it("E: the debt seedSummary keeps the last known summaries on a failed multi-read refresh", async () => {
    const { client, failReads } = createFlakyClient({
      installments: INSTALLMENT_ROWS,
      parents: [
        {
          id: "22222222-2222-4222-8222-222222222221",
          first_name: "Amine",
          last_name: "TEST",
          display_name: null,
          primary_phone: "0550000001",
        },
      ],
      students: [
        {
          parent_id: "22222222-2222-4222-8222-222222222221",
          tenant_id: TENANT,
        },
      ],
    });
    const repo = new SupabaseDebtRepository(client);
    const obs = track(repo.observeSummary());
    await vi.waitFor(() => {
      expect(obs.value()).toHaveLength(1);
    });
    expect(obs.value()![0].outstandingAmount).toBe(150000); // 50k + 100k remaining
    expect(obs.value()![0].studentCount).toBe(1);
    expect(getSeedHealth("debtSummary")?.state).toBe("ok");

    // The unpaid-installments read dies on the next refresh — the summaries
    // survive (the old catch set [] and blanked the Top-débiteurs list).
    failReads.installments = 99;
    await repo.refreshSummary!();
    expect(obs.value()).toHaveLength(1);
    expect(obs.value()![0].outstandingAmount).toBe(150000);
    expect(getSeedHealth("debtSummary")?.state).toBe("degraded");
    obs.unsub();
  });

  it("F: refresh() forces a re-read past the TTL (the Réessayer hook)", async () => {
    const { client, state } = createFlakyClient({ payments: PAYMENT_ROWS });
    const repo = new SupabasePaymentRepository(client);
    const obs = track(repo.observe());
    await vi.waitFor(() => {
      expect(obs.value()).toHaveLength(2);
    });
    // Mutate the underlying table WITHOUT touching the TTL — a plain
    // observe() must NOT re-read (the freshness policy), refresh() must.
    state.payments.push({
      ...PAYMENT_ROWS[0],
      id: "11111111-1111-4111-8111-111111111113",
      payment_number: "IMP-003",
    });
    const before = obs.value()!.length;
    void repo.observe(); // TTL not expired — no re-read
    await new Promise((r) => setTimeout(r, 10));
    expect(obs.value()!.length).toBe(before);
    await repo.refresh(); // forced past the TTL
    await vi.waitFor(() => {
      expect(obs.value()).toHaveLength(3);
    });
    obs.unsub();
  });
});

describe("T-423 — the OPS-317 diagnostics record the financial seeds' failures", () => {
  it("G: a failed financial seed is recorded in the seed diagnostics (the settings screen's evidence)", async () => {
    const { client, failReads } = createFlakyClient({ installments: INSTALLMENT_ROWS });
    failReads.installments = 99;
    const repo = new SupabaseInstallmentRepository(client);
    const obs = track(repo.observe());
    await vi.waitFor(() => {
      expect(getSeedHealth("installments")?.state).toBe("degraded");
    });
    // diagnostics import is lazy to keep this suite's import surface small
    const { getSeedDiagnostics } = await import(
      "../../infrastructure/supabase/repositories/supabase-shared-repositories"
    );
    const entry = getSeedDiagnostics().find((d) => d.source === "installments");
    expect(entry).toBeDefined();
    expect(entry?.message).toContain("statement timeout");
    obs.unsub();
  });
});
