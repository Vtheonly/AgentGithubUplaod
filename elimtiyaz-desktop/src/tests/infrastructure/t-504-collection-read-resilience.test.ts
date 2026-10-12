/**
 * T-504 suite (PERF-510, the 2026-10-12 boot-storm RECURRENCE) — the
 * collection-class read resilience:
 *
 *   1. THE SHARED CONCURRENCY GATE (the registered PERF-510 lever —
 *      docs/recovery/t-432-live-verification.md: "a shared concurrency
 *      gate in the repository factory"): strict cap, FIFO, the baton pass,
 *      concurrency allowed up to the limit.
 *   2. THE GATE WIRING: callCollectionRpc's RPC rides the gate (the dedupe
 *      still shares ONE gated request) + the aging RPC rides it too.
 *   3. THE RETRY LADDER ADOPTION — the three un-retried paths from the
 *      owner's console log:
 *        (a) seedAging — the `compute_debt_aging_summary` 57014 killed the
 *            aging seed with ONE catch; now a transient failure retries and
 *            a final failure keeps the last known rows (T-443 semantics).
 *        (b) performRefresh (RealtimeFinancialDebtRepository) — ONE 500 on
 *            `read_ledger_entries_collection` lost the WHOLE canonical debt
 *            refresh; now the whole unit retries.
 *        (c) the dashboard collection readers — ONE 500 failed the WHOLE
 *            kpisForRange/debtByAgingForRange honest-Err; now the read
 *            retries, a final failure still throws (the honest-Err
 *            contract upstream).
 *   4. THE READABLE LOG — the "[object Object]" class of console evidence
 *      (the owner's log hid the actual 500 cause) fixed by errorMessage().
 *   5. THE MIGRATION 0151 PINS — the six ALTER FUNCTION … SET
 *      statement_timeout = '30s' statements, ZERO body redefinitions, the
 *      registration row, and the live-apply script.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SupabaseDebtRepository,
  callCollectionRpc,
  errorMessage,
  runGatedCollectionRead,
  __clearInflightCollectionRpcsForTests,
  __collectionReadGateInFlightForTests,
  __setCollectionReadGateLimitForTests,
  __setSeedRetryBackoffForTests,
} from "../../infrastructure/supabase/repositories/supabase-shared-repositories";
import { RealtimeFinancialDebtRepository } from "../../infrastructure/supabase/financial-realtime";
import { SupabaseDashboardRepository } from "../../infrastructure/supabase/repositories/supabase-dashboard-repository";
import type { DebtRepository } from "../../domain/repository/repository";
import type { DebtAgingAnalysis } from "../../domain/calc/ledger/debt-aging";

type Row = Record<string, unknown>;

const TENANT = "00000000-0000-0000-0000-00000000aaaa";

function setSessionTenant() {
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: TENANT, userId: "staff-1" }),
  );
}

/** The 0111 wire shape (the t-405 archetype, minimized). */
const AGING_ROW: Row = {
  parent_id: "22222222-2222-4222-8222-222222222221",
  parent_name: "Amine ARCHETYPE-A",
  parent_phone: "0550000001",
  student_ids: [],
  outstanding_amount: "100000.00",
  oldest_due_date: "2024-10-15",
  debt_age_days: 608,
  origin_academic_year: "2024-2025",
  last_payment_at: null,
  days_since_last_payment: null,
  inactivity_days: 608,
  subsequent_year_payment_count: 0,
  subsequent_year_payment_total: "0",
  has_subsequent_year_payments: false,
  obligations: [],
  status_level: "red",
  reason_code: "critical_delinquency",
  computed_at: "2026-06-15T12:00:00+00",
};

/**
 * The t-426 chainable table fake — the from() walker the keyset fallback
 * (and performRefresh's parents/students walks) consume.
 */
function makeChainableTable(data: Row[]) {
  const q: Record<string, unknown> = {};
  const chain = () => q;
  q.select = () => q;
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
}

beforeEach(() => {
  localStorage.clear();
  setSessionTenant();
  __setSeedRetryBackoffForTests([0, 0]); // the retry ladder with no real delays
  __setCollectionReadGateLimitForTests(2); // the production default
  __clearInflightCollectionRpcsForTests();
});

afterEach(() => {
  __setSeedRetryBackoffForTests([1000, 3000]); // restore the production ladder
  __setCollectionReadGateLimitForTests(2);
  vi.restoreAllMocks();
});

// ============================================================
// 1. THE SHARED CONCURRENCY GATE (the PERF-510 lever)
// ============================================================
describe("T-504 (PERF-510) — the shared concurrency gate", () => {
  it("A: STRICT CAP + FIFO — with limit 1 a second read's body starts only after the first completes (the boot volley drains serially)", async () => {
    __setCollectionReadGateLimitForTests(1);
    const events: string[] = [];
    const hold = createHold();

    const first = runGatedCollectionRead(async () => {
      events.push("first:start");
      await hold.promise;
      events.push("first:end");
      return "first";
    });
    const second = runGatedCollectionRead(async () => {
      events.push("second:start");
      events.push("second:end");
      return "second";
    });

    await Promise.resolve(); // a microtask tick — the second read must NOT have started
    expect(events).toEqual(["first:start"]);
    expect(__collectionReadGateInFlightForTests()).toBe(1); // the strict cap

    hold.release();
    expect(await first).toBe("first");
    expect(await second).toBe("second");
    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
    expect(__collectionReadGateInFlightForTests()).toBe(0); // fully drained
  });

  it("B: the cap allows real concurrency UP TO the limit (limit 2 runs two reads in parallel)", async () => {
    const events: string[] = [];
    const holdA = createHold();
    const holdB = createHold();

    const a = runGatedCollectionRead(async () => {
      events.push("a:start");
      await holdA.promise;
      return "a";
    });
    const b = runGatedCollectionRead(async () => {
      events.push("b:start");
      await holdB.promise;
      return "b";
    });
    await Promise.resolve();
    // Both bodies are running — the gate bounds, it does not serialize.
    expect(events).toEqual(["a:start", "b:start"]);
    expect(__collectionReadGateInFlightForTests()).toBe(2);

    holdA.release();
    holdB.release();
    expect(await a).toBe("a");
    expect(await b).toBe("b");
    expect(__collectionReadGateInFlightForTests()).toBe(0);
  });

  it("C: the BATON PASS — a queued read inherits the finishing holder's slot; the cap is never overshot by same-tick racers", async () => {
    __setCollectionReadGateLimitForTests(1);
    const events: string[] = [];
    const hold = createHold();

    const first = runGatedCollectionRead(async () => {
      await hold.promise;
      return 1;
    });
    const second = runGatedCollectionRead(async () => {
      events.push("second:body");
      return 2;
    });
    // A same-tick racer enters AFTER first finished but BEFORE second's
    // microtask resumption — it must QUEUE (the slot was handed to second).
    await Promise.resolve();
    hold.release();
    const third = runGatedCollectionRead(async () => {
      events.push("third:body");
      return 3;
    });

    expect(await first).toBe(1);
    expect(await second).toBe(2);
    expect(await third).toBe(3);
    // FIFO: second's body ran before third's.
    expect(events).toEqual(["second:body", "third:body"]);
    expect(__collectionReadGateInFlightForTests()).toBe(0);
  });
});

function createHold() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

// ============================================================
// 2. THE GATE WIRING (callCollectionRpc + the aging RPC)
// ============================================================
describe("T-504 (PERF-510) — the gate wiring", () => {
  it("A: callCollectionRpc's RPC rides the gate — a held gated read blocks the collection RPC (and the dedupe still shares ONE request)", async () => {
    __setCollectionReadGateLimitForTests(1);
    const rpcCalls: string[] = [];
    const hold = createHold();
    // An unrelated collection-class read holds the one slot.
    const holder = runGatedCollectionRead(async () => {
      await hold.promise;
      return "held";
    });

    const client = {
      rpc: vi.fn(async (fn: string) => {
        rpcCalls.push(fn);
        return { data: [{ id: "r1" }], error: null };
      }),
    };
    const p1 = callCollectionRpc(client as unknown as SupabaseClient, "read_installments_collection");
    const p2 = callCollectionRpc(client as unknown as SupabaseClient, "read_installments_collection");
    await Promise.resolve();
    await Promise.resolve();
    // The RPC has NOT started — the gate slot is held by the other read.
    expect(rpcCalls).toEqual([]);

    hold.release();
    await holder;
    const [r1, r2] = await Promise.all([p1, p2]);
    // The dedupe: ONE shared request serves both callers.
    expect(rpcCalls).toEqual(["read_installments_collection"]);
    expect(r1).toEqual([{ id: "r1" }]);
    expect(r2).toEqual([{ id: "r1" }]);
  });

  it("B: the aging RPC (compute_debt_aging_summary) rides the gate too", async () => {
    __setCollectionReadGateLimitForTests(1);
    const rpcCalls: string[] = [];
    const hold = createHold();
    const holder = runGatedCollectionRead(async () => {
      await hold.promise;
      return "held";
    });

    const client = {
      rpc: vi.fn(async (fn: string) => {
        rpcCalls.push(fn);
        return { data: [AGING_ROW], error: null };
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
    await Promise.resolve();
    await Promise.resolve();
    expect(rpcCalls).toEqual([]); // gated — not started

    hold.release();
    await holder;
    await vi.waitFor(() => {
      expect(latest).toHaveLength(1);
    });
    expect(rpcCalls).toEqual(["compute_debt_aging_summary"]);
    unsub();
  });
});

// ============================================================
// 3a. THE RETRY LADDER — seedAging (the owner's exact failure)
// ============================================================
describe("T-504 (PERF-510) — seedAging climbs the retry ladder", () => {
  it("A: a TRANSIENT 57014-shaped failure retries and lands the rows (the owner's `seedAging failed: canceling statement due to statement timeout` shape)", async () => {
    let attempts = 0;
    const client = {
      rpc: vi.fn(async (fn: string) => {
        if (fn !== "compute_debt_aging_summary") return { data: null, error: null };
        attempts += 1;
        if (attempts === 1) {
          // The exact live shape: a PostgREST 500 carrying the 57014 message.
          return {
            data: null,
            error: { code: "500", message: "canceling statement due to statement timeout" },
          };
        }
        return { data: [AGING_ROW], error: null };
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
      expect(latest).toHaveLength(1);
    });
    // The transient failure was retried — attempt 2 succeeded.
    expect(attempts).toBe(2);
    expect(latest![0].parentId).toBe(AGING_ROW.parent_id);
    unsub();
  });

  it("B: a FINAL failure keeps the last known rows AND logs the READABLE cause (never \"[object Object]\")", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let attempts = 0;
    let seededOnce = false;
    const client = {
      rpc: vi.fn(async (fn: string) => {
        if (fn !== "compute_debt_aging_summary") return { data: null, error: null };
        attempts += 1;
        if (seededOnce) {
          return {
            data: null,
            error: { code: "500", message: "canceling statement due to statement timeout" },
          };
        }
        seededOnce = true;
        return { data: [AGING_ROW], error: null };
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
      expect(latest).toHaveLength(1);
    });

    await repo.refreshAging(); // every attempt fails now
    // The full ladder ran (1 + 2 retries)…
    expect(attempts).toBe(4);
    // …the last known truthful analysis survived…
    expect(latest).toHaveLength(1);
    // …and the console evidence is READABLE (the owner's log printed
    // "[object Object]" for this exact class of thrown error object).
    expect(warn).toHaveBeenCalledWith(
      "[SupabaseDebt] seedAging failed:",
      "canceling statement due to statement timeout",
    );
    unsub();
  });
});

// ============================================================
// 3b. THE RETRY LADDER — performRefresh (the canonical debt refresh)
// ============================================================
describe("T-504 (PERF-510) — the canonical debt refresh climbs the retry ladder", () => {
  const LEDGER_ROW: Row = {
    id: "44444444-4444-4444-8444-444444444441",
    tenant_id: TENANT,
    account_id: null,
    parent_id: "22222222-2222-4222-8222-222222222221",
    student_id: null,
    category: "tuition",
    amount: "50000",
    entry_type: "charge",
    source_type: "manual_entry",
    entry_date: "2026-09-01T10:00:00Z",
  };
  const PARENT_ROW: Row = {
    id: "22222222-2222-4222-8222-222222222221",
    first_name: "Amine",
    last_name: "ARCHETYPE-A",
    display_name: null,
    primary_phone: "0550000001",
  };
  const STUDENT_ROW: Row = {
    id: "33333333-3333-4333-8333-333333333331",
    parent_id: "22222222-2222-4222-8222-222222222221",
  };

  function makeBridgeClient() {
    let ledgerAttempts = 0;
    const client = {
      rpc: vi.fn(async (fn: string) => {
        if (fn === "read_ledger_entries_collection") {
          ledgerAttempts += 1;
          if (ledgerAttempts === 1) {
            // The owner's exact first failure: a 500 on the ledger RPC.
            return { data: null, error: { code: "500", message: "Unexpected 500" } };
          }
          return { data: [LEDGER_ROW], error: null };
        }
        return { data: null, error: null };
      }),
      from: vi.fn((table: string) => {
        if (table === "parents") return makeChainableTable([PARENT_ROW]);
        if (table === "students") return makeChainableTable([STUDENT_ROW]);
        return makeChainableTable([]);
      }),
    };
    return { client, ledgerAttempts: () => ledgerAttempts };
  }

  it("A: ONE transient 500 on read_ledger_entries_collection no longer loses the whole refresh — the unit retries and the summary lands", async () => {
    const { client, ledgerAttempts } = makeBridgeClient();
    const facade = new RealtimeFinancialDebtRepository(
      {} as DebtRepository,
      client as unknown as SupabaseClient,
    );
    let latest: unknown;
    const unsub = facade.observeSummary().subscribe((v) => {
      latest = v;
    });
    await facade.refreshSummary();
    await vi.waitFor(() => {
      expect(Array.isArray(latest) && latest.length === 1).toBe(true);
    });
    // The retry re-ran the whole unit — the ledger RPC's SECOND attempt
    // succeeded (attempt 1 was the transient 500).
    expect(ledgerAttempts()).toBe(2);
    unsub();
  });

  it("B: a FINAL failure keeps the last known summary and logs the READABLE cause", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let ledgerAttempts = 0;
    const client = {
      rpc: vi.fn(async (fn: string) => {
        if (fn === "read_ledger_entries_collection") {
          ledgerAttempts += 1;
          return { data: null, error: { code: "500", message: "Unexpected 500" } };
        }
        return { data: null, error: null };
      }),
      from: vi.fn(() => makeChainableTable([])),
    };
    const facade = new RealtimeFinancialDebtRepository(
      {} as DebtRepository,
      client as unknown as SupabaseClient,
    );
    await facade.refreshSummary();
    // The full ladder (1 + 2 retries) — then the readable keep-last-known log.
    expect(ledgerAttempts).toBe(3);
    expect(warn).toHaveBeenCalledWith(
      "[FinancialRealtime] canonical debt refresh failed:",
      "Unexpected 500",
    );
  });
});

// ============================================================
// 3c. THE RETRY LADDER — the dashboard collection readers
// ============================================================
describe("T-504 (PERF-510) — the dashboard collection readers climb the retry ladder", () => {
  const INSTALLMENT_ROW: Row = {
    id: "55555555-5555-4555-8555-555555555551",
    parent_id: "22222222-2222-4222-8222-222222222221",
    amount_due: 100_000,
    amount_paid: 0,
    amount_pending: 0,
    due_date: isoDaysFromNow(-30),
    status: "unpaid",
  };

  function makeDashboardClient() {
    let rpcAttempts = 0;
    const client = {
      rpc: vi.fn(async (fn: string) => {
        if (fn === "read_installments_collection") {
          rpcAttempts += 1;
          if (rpcAttempts === 1) {
            return { data: null, error: { code: "500", message: "Unexpected 500" } };
          }
          return { data: [INSTALLMENT_ROW], error: null };
        }
        return { data: null, error: null };
      }),
      from: vi.fn(() => makeChainableTable([])),
    };
    return { client, rpcAttempts: () => rpcAttempts };
  }

  it("A: a TRANSIENT 500 on read_installments_collection retries — debtByAgingForRange lands its buckets instead of honest-Err", async () => {
    const { client, rpcAttempts } = makeDashboardClient();
    const repo = new SupabaseDashboardRepository(client as unknown as SupabaseClient);
    const res = await repo.debtByAgingForRange("garbage"); // unscoped year guard
    // The transient 500 was retried and the read landed.
    expect(res.ok).toBe(true);
    expect(rpcAttempts()).toBe(2);
    if (res.ok) {
      const b030 = res.value.find((b) => b.bucket === "0_30");
      expect(b030?.amount).toBe(100_000);
    }
  });

  it("B: a FINAL failure still THROWS to the honest-Err path (no fabricated buckets, no fabricated zeroes)", async () => {
    let rpcAttempts = 0;
    const client = {
      rpc: vi.fn(async (fn: string) => {
        if (fn === "read_installments_collection") {
          rpcAttempts += 1;
          return { data: null, error: { code: "500", message: "Unexpected 500" } };
        }
        return { data: null, error: null };
      }),
      from: vi.fn(() => makeChainableTable([])),
    };
    const repo = new SupabaseDashboardRepository(client as unknown as SupabaseClient);
    const res = await repo.debtByAgingForRange("garbage");
    // The ladder exhausted (1 + 2 retries)…
    expect(rpcAttempts).toBe(3);
    // …and the caller sees the honest Err — the DATA-047 contract intact.
    expect(res.ok).toBe(false);
  });
});

// ============================================================
// 4. THE READABLE LOG PRIMITIVE
// ============================================================
describe("T-504 (PERF-510) — errorMessage (the [object Object] class)", () => {
  it("extracts the message from a PostgREST-shaped error OBJECT (not an Error instance)", () => {
    expect(errorMessage({ code: "500", message: "Unexpected 500" })).toBe("Unexpected 500");
    expect(
      errorMessage({ code: "57014", message: "canceling statement due to statement timeout" }),
    ).toBe("canceling statement due to statement timeout");
  });

  it("handles Error instances, nested error objects, and unstringifiable shapes", () => {
    expect(errorMessage(new Error("plain"))).toBe("plain");
    expect(errorMessage({ error: { message: "nested" } })).toBe("nested");
    expect(errorMessage({ weird: 1 })).toContain("weird");
    expect(errorMessage(null)).toBeTruthy();
  });
});

// ============================================================
// 5. THE MIGRATION 0151 PINS (the statement-timeout headroom)
// ============================================================
describe("T-504 (PERF-510) — migration 0151 (the read-RPC statement-timeout headroom)", () => {
  const migrationPath = join(
    __dirname,
    "../../infrastructure/../../supabase/migrations/0151_read_rpc_statement_timeout_headroom.sql",
  );

  it("A: the six ALTER FUNCTION … SET statement_timeout = '30s' statements are present — and NO function body is redefined", () => {
    const sql = readFileSync(migrationPath, "utf8");
    const expected: Array<[string, string]> = [
      ["read_payments_collection", "()"],
      ["read_installments_collection", "()"],
      ["read_ledger_entries_collection", "()"],
      ["read_debt_summary_collection", "()"],
      ["compute_debt_aging_summary", "(p_as_of timestamptz)"],
      ["compute_debt_aging_rows", "(p_tenant_id uuid, p_as_of timestamptz)"],
    ];
    for (const [fn, args] of expected) {
      expect(sql).toContain(`alter function public.${fn}${args} set statement_timeout = '30s'`);
    }
    // Pure metadata: ZERO body redefinitions in this migration (no drift
    // risk by construction — the bodies stay whatever the chain head has).
    expect(sql).not.toMatch(/create (or replace )?function/i);
  });

  it("B: the registration row + the live-apply script exist (the MIG-TOKENS convention)", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain("insert into supabase_migrations.schema_migrations");
    expect(sql).toContain("'0151'");
    expect(sql).toContain("on conflict (version) do nothing");
    const applyScript = readFileSync(
      join(__dirname, "../../infrastructure/../../scripts/t504-apply-0151.py"),
      "utf8",
    );
    expect(applyScript).toContain("0151_read_rpc_statement_timeout_headroom.sql");
    expect(applyScript).toContain("SUPABASE_ACCESS_TOKEN");
  });
});

// ============================================================
// Helper
// ============================================================
function isoDaysFromNow(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString();
}
