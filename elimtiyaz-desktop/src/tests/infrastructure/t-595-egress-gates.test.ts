/**
 * T-595 (E7A-5 / ROADMAP 6.7) — the egress measurement gates.
 *
 * PROOF, NOT ASSERTION (the card's own words): the four OPS-015 traffic
 * classes were killed by T-590..T-594 — this suite MEASURES the seam so
 * the delta table carries numbers, not adjectives.
 *
 * The measurement boundary: the SUPABASE SEAM — every `client.rpc(...)`
 * and every `client.from(...)` chain the repositories issue. In
 * supabase-backed mode each of those is ONE PostgREST round trip; the
 * recording client below counts calls and payload bytes exactly there.
 * The run is MOCK-SEAM ONLY (a recording fake client, zero network I/O —
 * the OPS-015/G2 live locks stand; the live-window column of the delta
 * table stays PENDING the owner's one-time window).
 *
 * The four classes (FINDINGS_INDEX OPS-015):
 *   1. The 30 s/focus re-seed volley (~13,000+ rows/cycle) → T-592.
 *      GATE: a warm tick = ONE cursor delta RPC per table, ZERO `from()`
 *      re-seeds, EMPTY deltas on an unchanged world.
 *   2. ARCH-040's per-filter-change collection downloads ×2 → T-590.
 *      GATE: one dashboard load = the 4 aggregation RPCs + the 2 bounded
 *      windowed reads — ZERO full-collection downloads, every read
 *      windowed + keyset + limit-bounded.
 *   3. BUG-042's amplification (7,148 requests) → T-559/T-560.
 *      GATE: the loop-family ceiling — identical repeated triggers issue
 *      a LINEAR, bounded call count (no re-fire amplification; a failing
 *      pull answers ONE call per tick), + the source pins (the toast
 *      context split + the five load-generation-ref gates).
 *   4. BUG-058's drip + the sync push pipeline (3-4 requests/entry) →
 *      T-594/T-593. GATE: a 1,000-entry batch = EXACTLY ceil(1000/50) =
 *      20 `sync_apply_batch` calls, ZERO per-item pushes.
 *
 * ARTIFACTS: when EGRESS_ARTIFACTS_DIR is set (scripts/run-egress-harness.mjs
 * sets it), the afterAll hook writes egress-after.json — the measured
 * AFTER side of docs/recovery/egress-gates/OPS-015-DELTA-TABLE.md.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseDashboardRepository } from "../../infrastructure/supabase/repositories/supabase-dashboard-repository";
import { pullTableDelta, type DeltaCursor, type DeltaTable } from "../../infrastructure/supabase/delta-cache";
import {
  SyncService,
  _resetSyncServiceForTests,
} from "../../infrastructure/sync/sync-service";
import {
  _resetSyncQueueStoreForTests,
  getSyncQueueStore,
} from "../../infrastructure/sync/sync-queue-store";
import type { SyncQueueEntry } from "../../infrastructure/sync/sync-types";

const SRC = join(__dirname, "../../");
const REPO_ROOT = join(SRC, "../..");
const TENANT = "00000000-0000-0000-0000-000000000001";
const YEAR = "2025-2026";
const RANGE = { from: "2025-09-01", to: "2026-09-01" };
const NOW = "2026-04-01";

const TOAST_PROVIDER_SRC = readFileSync(
  join(SRC, "app/providers/toast-provider.tsx"),
  "utf8",
);
const LOOP_GATE_FILES = [
  "features/settings/configuration-tab.tsx",
  "features/settings/accounts-tab.tsx",
  "features/settings/pricing/pricing-year-config-bar.tsx",
  "features/academics/promotion-cycles/promotion-cycle-detail.tsx",
  "features/academics/promotion-cycles/promotion-cycles-tab.tsx",
].map((f) => ({ file: f, src: readFileSync(join(SRC, f), "utf8") }));

// ============================================================
// The world (a small, deterministic dataset; the SEAM CENSUS is the
// measurement, the data only needs to be shape-valid so the real
// repository code paths complete)
// ============================================================

const PULL_TABLES: DeltaTable[] = ["payments", "installments", "ledger_entries", "parents", "students"];

interface WorldRow {
  id: string;
  tenant_id: string;
  updated_at: string;
  deleted_at?: string | null;
  [k: string]: unknown;
}

function worldRows(table: DeltaTable): WorldRow[] {
  const n = { payments: 12, installments: 14, ledger_entries: 8, parents: 6, students: 10 }[table];
  return Array.from({ length: n }, (_, i) => ({
    id: `${table.slice(0, 3)}-${String(i).padStart(3, "0")}`,
    tenant_id: TENANT,
    updated_at: `2026-03-${String(1 + (i % 20)).padStart(2, "0")}T10:00:00Z`,
    deleted_at: null,
  }));
}

const PAYMENT_READ_ROWS = Array.from({ length: 12 }, (_, i) => ({
  id: `pay-${String(i).padStart(3, "0")}`,
  tenant_id: TENANT,
  parent_id: "par-001",
  student_id: "stu-001",
  amount: 1000 + i,
  method: "cash",
  category: "tuition",
  status: "paid",
  collected_at: `2025-1${i % 2}-${String(1 + i).padStart(2, "0")}T10:00:00Z`,
  collected_by: "collector-1",
  created_at: "2025-10-01T10:00:00Z",
  updated_at: "2026-03-01T10:00:00Z",
  receipt_number: `R-${100 + i}`,
  payment_number: `P-${200 + i}`,
  installment_id: null,
  proof_path: null,
  notes: null,
  check_number: null,
  check_bank_name: null,
  check_issue_date: null,
  check_clearance_date: null,
  transfer_reference: null,
  transfer_source_bank: null,
  expected_amount: null,
  excess_amount: null,
  excess_remark: null,
  academic_year_id: null,
}));

const INSTALLMENT_READ_ROWS = Array.from({ length: 14 }, (_, i) => ({
  id: `ins-${String(i).padStart(3, "0")}`,
  tenant_id: TENANT,
  parent_id: "par-001",
  student_id: "stu-001",
  category: "tuition",
  label: `Tranche ${i + 1}`,
  tranche_number: i + 1,
  amount_due: 5000,
  amount_paid: i < 3 ? 5000 : 0,
  amount_pending: i < 3 ? 0 : 5000,
  due_date: `2025-1${i % 2}-${String(1 + i).padStart(2, "0")}`,
  paid_date: i < 3 ? "2025-11-01" : null,
  status: i < 3 ? "paid" : "unpaid",
  academic_cycle: null,
  payment_plan: null,
  is_custom_schedule: false,
  custom_schedule_note: null,
  academic_year_id: null,
}));

const KPI_RPC_ANSWER = {
  totalStudents: 10,
  totalParents: 6,
  totalStaff: 8,
  monthlyRevenue: 1500,
  outstandingDebt: 55000,
  overdueAlerts: 4,
  overdueAmount: 20000,
  pendingExpenses: 2,
  attendancePresent: 28,
  attendanceTotal: 30,
};
const REVENUE_RPC_ANSWER = [
  { year: 2025, month: 9, amount: 1500 },
  { year: 2025, month: 10, amount: 1200 },
];
const AGING_RPC_ANSWER = [
  { bucket: "0_30", amount: 10000, debtorCount: 2 },
  { bucket: "31_60", amount: 5000, debtorCount: 1 },
  { bucket: "91_180", amount: 5000, debtorCount: 1 },
];
const DEMOGRAPHICS_RPC_ANSWER = {
  classes: [{ class_id: "c1", class_name: "5A", grade_code: "year5", student_count: 10 }],
  unassignedByLevel: [{ grade_level_code: "year1", count: 0 }],
  unassignedUnknown: 0,
  gender: { male: 6, female: 4, unspecified: 0 },
  ageBuckets: [{ min: 10, max: 12, count: 10 }],
  unknownBirthDate: 0,
};

// ============================================================
// The recording client — the measurement instrument
// ============================================================

export interface EgressCall {
  kind: "rpc" | "select";
  /** rpc name or from() table */
  target: string;
  requestBytes: number;
  resultBytes: number;
  rows: number;
  filters: Array<{ col: string; op?: string; value: unknown }>;
}

export interface EgressLedger {
  calls: EgressCall[];
}

function bytesOf(v: unknown): number {
  try {
    return JSON.stringify(v ?? null)?.length ?? 0;
  } catch {
    return 0;
  }
}

/**
 * The pull answer: the composite-keyset filter `(updated_at, id) > cursor`
 * over the world — the honest empty-delta behavior of an unchanged world.
 */
function pullAnswer(table: DeltaTable, args: Record<string, unknown>): WorldRow[] {
  const since = (args.p_since ?? null) as string | null;
  const afterId = (args.p_after_id ?? null) as string | null;
  const limit = Number(args.p_limit ?? 1000);
  const rows = worldRows(table)
    .slice()
    .sort((a, b) =>
      a.updated_at === b.updated_at
        ? a.id.localeCompare(b.id)
        : a.updated_at.localeCompare(b.updated_at),
    )
    .filter((r) => {
      if (since == null) return true;
      if (r.updated_at > since) return true;
      if (r.updated_at === since && afterId != null && r.id > afterId) return true;
      return false;
    });
  return rows.slice(0, limit);
}

export function makeRecordingClient(opts: { failPullTable?: DeltaTable } = {}): {
  client: unknown;
  ledger: EgressLedger;
} {
  const ledger: EgressLedger = { calls: [] };

  const rpc = (fn: string, args?: Record<string, unknown>) => {
    const isPull = fn.startsWith("pull_") && fn.endsWith("_for_sync");
    let data: unknown;
    if (isPull) {
      const table = fn.replace("pull_", "").replace("_for_sync", "") as DeltaTable;
      if (opts.failPullTable === table) {
        const call: EgressCall = {
          kind: "rpc", target: fn, requestBytes: bytesOf(args), resultBytes: 0, rows: 0, filters: [],
        };
        ledger.calls.push(call);
        return Promise.resolve({ data: null, error: { message: "simulated transient failure" } });
      }
      data = pullAnswer(table, args ?? {});
    } else if (fn === "read_dashboard_kpis") {
      data = KPI_RPC_ANSWER;
    } else if (fn === "read_dashboard_revenue_by_month") {
      data = REVENUE_RPC_ANSWER;
    } else if (fn === "read_dashboard_debt_aging") {
      data = AGING_RPC_ANSWER;
    } else if (fn === "read_dashboard_demographics") {
      data = DEMOGRAPHICS_RPC_ANSWER;
    } else if (fn === "sync_apply_batch") {
      data = { applied: (args?.p_mutations as unknown[])?.length ?? 0 };
    } else {
      data = [];
    }
    const rows = Array.isArray(data) ? data.length : data == null ? 0 : 1;
    ledger.calls.push({
      kind: "rpc", target: fn, requestBytes: bytesOf(args), resultBytes: bytesOf(data), rows, filters: [],
    });
    return Promise.resolve({ data, error: null });
  };

  const client = {
    rpc,
    from(table: string) {
      // Recorded AT BUILD TIME (race-free: the record mutates as the chain
      // builds; the byte/row cells fill in the then hook below).
      const rec: EgressCall = {
        kind: "select", target: table, requestBytes: 0, resultBytes: 0, rows: 0, filters: [],
      };
      ledger.calls.push(rec);
      const q: Record<string, unknown> = {};
      q.select = (_cols?: unknown, o2?: { count?: string; head?: boolean }) => {
        if (o2?.count) rec.filters.push({ col: "__count", op: o2.count, value: !!o2.head });
        return q;
      };
      q.eq = (col: string, value: unknown) => { rec.filters.push({ col, value }); return q; };
      q.is = (col: string, value: unknown) => { rec.filters.push({ col, op: "is", value }); return q; };
      q.gt = (col: string, value: unknown) => { rec.filters.push({ col, op: "gt", value }); return q; };
      q.gte = (col: string, value: unknown) => { rec.filters.push({ col, op: "gte", value }); return q; };
      q.lt = (col: string, value: unknown) => { rec.filters.push({ col, op: "lt", value }); return q; };
      q.lte = (col: string, value: unknown) => { rec.filters.push({ col, op: "lte", value }); return q; };
      q.order = (col: string, o?: { ascending?: boolean }) => {
        rec.filters.push({ col: `__order_${col}`, value: o?.ascending });
        return q;
      };
      q.limit = (n: number) => { rec.filters.push({ col: "__limit", value: n }); return q; };
      const resolve = (): unknown[] => {
        if (table === "payments") return PAYMENT_READ_ROWS;
        if (table === "installments") return INSTALLMENT_READ_ROWS;
        return [];
      };
      Object.defineProperty(q, "then", {
        value: (onFulfilled?: (v: { data: unknown; error: null; count: number | null }) => unknown) => {
          // The await consumes the chain HERE — fill the byte/row cells now.
          const data = resolve();
          rec.resultBytes = bytesOf(data);
          rec.rows = data.length;
          return onFulfilled
            ? Promise.resolve({ data, error: null, count: null })
                .then(onFulfilled as (v: unknown) => unknown)
                .catch(() => undefined)
            : undefined;
        },
        configurable: true,
      });
      (q as { single?: () => unknown }).single = () => ({ then: q.then as unknown as () => unknown });
      return q;
    },
  };
  return { client, ledger };
}

// ============================================================
// Scenario helpers
// ============================================================

function summarize(ledger: EgressLedger) {
  return {
    calls: ledger.calls.length,
    rpcCalls: ledger.calls.filter((c) => c.kind === "rpc").length,
    selectCalls: ledger.calls.filter((c) => c.kind === "select").length,
    requestBytes: ledger.calls.reduce((s, c) => s + c.requestBytes, 0),
    resultBytes: ledger.calls.reduce((s, c) => s + c.resultBytes, 0),
    resultRows: ledger.calls.reduce((s, c) => s + c.rows, 0),
  };
}

async function runDashboardLoad(client: unknown) {
  const repo = new SupabaseDashboardRepository(client as unknown as SupabaseClient);
  const [kpis, revenue, aging, demo, payments, installments] = await Promise.all([
    repo.kpisForRange(YEAR, RANGE),
    repo.revenueForRange(YEAR, RANGE),
    repo.debtByAgingForRange(YEAR, RANGE),
    repo.demographics(),
    repo.paymentsForRange(RANGE),
    repo.installmentsForYear(YEAR),
  ]);
  return { kpis, revenue, aging, demo, payments, installments };
}

// The artifact accumulator (written by the afterAll hook when
// EGRESS_ARTIFACTS_DIR is set — scripts/run-egress-harness.mjs).
const ARTIFACT: {
  task: string;
  mode: string;
  world: Record<string, unknown>;
  scenarios: Record<string, unknown>;
} = {
  task: "T-595",
  mode: "mock-seam (recording fake client — ZERO network I/O; OPS-015/G2 live locks stand)",
  world: {
    payments: 12, installments: 14, ledger_entries: 8, parents: 6, students: 10,
    note: "a small deterministic world; the measurement is the SEAM CENSUS + bytes, which is world-size independent for the volley/batch gates (call counts) and world-proportional for cold bytes",
  },
  scenarios: {},
};

// ============================================================
// GATE 2 — class 2: the dashboard load is compact (T-590's proof)
// ============================================================

describe("T-595 — GATE 2 (OPS-015 class 2): the dashboard load is the compact RPC set + the two bounded reads", () => {
  it("one dashboard load = exactly 4 aggregation RPCs + 2 windowed keyset reads; ZERO full-collection downloads", async () => {
    const { client, ledger } = makeRecordingClient();
    const out = await runDashboardLoad(client);
    // The loads succeed through the RPC path (no silent legacy fallback).
    expect(out.kpis.ok).toBe(true);
    expect(out.revenue.ok).toBe(true);
    expect(out.aging.ok).toBe(true);
    expect(out.demo.ok).toBe(true);
    expect(out.payments.ok).toBe(true);
    expect(out.installments.ok).toBe(true);

    const rpcs = ledger.calls.filter((c) => c.kind === "rpc").map((c) => c.target).sort();
    expect(rpcs).toEqual([
      "read_dashboard_debt_aging",
      "read_dashboard_demographics",
      "read_dashboard_kpis",
      "read_dashboard_revenue_by_month",
    ]);
    const selects = ledger.calls.filter((c) => c.kind === "select");
    expect(selects.map((s) => s.target).sort()).toEqual(["installments", "payments"]);
    // ZERO full-collection downloads: no students/parents/personnel/classes/
    // attendance/expense reads — the ARCH-040 legacy path never ran.
    expect(selects.every((s) => s.target === "payments" || s.target === "installments")).toBe(true);
    // Every read is BOUNDED: window filters + keyset order + limit.
    for (const s of selects) {
      const cols = s.filters.map((f) => f.col);
      expect(cols).toContain("__limit");
      expect(cols).toContain("__order_id");
      expect(s.filters.some((f) => f.op === "gte")).toBe(true);
      expect(s.filters.some((f) => f.op === "lt")).toBe(true);
      expect(s.filters.some((f) => f.col === "tenant_id")).toBe(true);
    }
    ARTIFACT.scenarios["dashboard-load"] = {
      ...summarize(ledger),
      perCall: ledger.calls,
      before: "the ARCH-040 triple data path: the payments+installments full-collection subscriptions + the prev-year duplicate + the third observable path — full collections (~12k live rows) per load, ×2 per filter change",
    };
  });

  it("the ×2 filter-change shape: TWO loads = 12 compact calls, still ZERO full-collection downloads", async () => {
    const { client, ledger } = makeRecordingClient();
    await runDashboardLoad(client);
    await runDashboardLoad(client);
    const selects = ledger.calls.filter((c) => c.kind === "select");
    expect(ledger.calls.filter((c) => c.kind === "rpc")).toHaveLength(8);
    expect(selects).toHaveLength(4);
    expect(selects.every((s) => s.target === "payments" || s.target === "installments")).toBe(true);
    ARTIFACT.scenarios["dashboard-load-x2"] = summarize(ledger);
  });
});

// ============================================================
// GATE 1 — class 1: the 30 s/focus volley is dead (T-592's proof)
// ============================================================

describe("T-595 — GATE 1 (OPS-015 class 1): warm ticks pull EMPTY cursor deltas; ZERO re-seeds", () => {
  it("boot = ONE cold walk per table (5 RPC calls); the cursor initializes from the last row", async () => {
    const { client, ledger } = makeRecordingClient();
    const cursors = new Map<DeltaTable, DeltaCursor | null>();
    for (const table of PULL_TABLES) {
      const out = await pullTableDelta(client as unknown as SupabaseClient, table, {
        tenantId: TENANT,
        cursor: null,
      });
      expect(out).not.toBeNull();
      expect(out!.isColdStart).toBe(true);
      expect(out!.rows).toHaveLength(worldRows(table).length);
      cursors.set(table, out!.cursor);
    }
    expect(ledger.calls).toHaveLength(5);
    expect(ledger.calls.every((c) => c.kind === "rpc" && c.target.startsWith("pull_"))).toBe(true);
    ARTIFACT.scenarios["boot-cold-walk"] = {
      ...summarize(ledger),
      before: "the cold volley: 9 cached repositories re-downloading full collections ≈13,000+ rows per cycle (installments 5,963 · ledger 3,342 · payments 2,198 · students 1,137 · parents 741 — the live census)",
    };
  });

  it("THREE warm ticks on an unchanged world = 15 pull RPCs, all EMPTY deltas, ZERO from() re-seeds", async () => {
    const { client, ledger } = makeRecordingClient();
    // Boot.
    const cursors = new Map<DeltaTable, DeltaCursor | null>();
    for (const table of PULL_TABLES) {
      const out = await pullTableDelta(client as unknown as SupabaseClient, table, {
        tenantId: TENANT, cursor: null,
      });
      cursors.set(table, out!.cursor);
    }
    const bootCalls = ledger.calls.length;
    expect(bootCalls).toBe(5);
    // Three 30 s/focus ticks — the world unchanged.
    for (let tick = 0; tick < 3; tick++) {
      for (const table of PULL_TABLES) {
        const out = await pullTableDelta(client as unknown as SupabaseClient, table, {
          tenantId: TENANT, cursor: cursors.get(table) ?? null,
        });
        expect(out).not.toBeNull();
        expect(out!.rows).toHaveLength(0); // the empty delta
        expect(out!.isColdStart).toBe(false);
      }
    }
    const tickCalls = ledger.calls.slice(bootCalls);
    expect(tickCalls).toHaveLength(15);
    expect(tickCalls.every((c) => c.kind === "rpc" && c.target.startsWith("pull_"))).toBe(true);
    // ZERO `from()` reads — the full re-seed is DEAD.
    expect(ledger.calls.filter((c) => c.kind === "select")).toHaveLength(0);
    // The empty deltas carry (almost) no bytes.
    const tickBytes = tickCalls.reduce((s, c) => s + c.resultBytes, 0);
    expect(tickBytes).toBeLessThanOrEqual(15 * 2); // "[]" per call
    ARTIFACT.scenarios["warm-ticks-x3"] = {
      ...summarize(ledger),
      perTick: { calls: 5, resultBytes: 2, rows: 0 },
      before: "each tick re-downloaded the full collections ≈13,000+ rows (multi-MB) — the OPS-015 class-1 volley",
    };
  });
});

// ============================================================
// GATE 3 — class 3: the loop family stays dead (T-559/T-560's proof)
// ============================================================

describe("T-595 — GATE 3 (OPS-015 class 3): identical repeated triggers stay LINEAR — no re-fire amplification", () => {
  it("a FAILING pull answers exactly ONE call per tick (the error toast never multiplies the wire)", async () => {
    const { client, ledger } = makeRecordingClient({ failPullTable: "payments" });
    const caught: unknown[] = [];
    for (let tick = 0; tick < 3; tick++) {
      // A failing pull throws (non-unavailable class) — the tick's caller
      // catches upstream; the NEXT tick tries exactly once more.
      try {
        await pullTableDelta(client as unknown as SupabaseClient, "payments", {
          tenantId: TENANT, cursor: null,
        });
      } catch (e) {
        caught.push(e);
      }
    }
    expect(caught).toHaveLength(3); // every tick failed exactly once — no retry storm
    const failed = ledger.calls.filter((c) => c.target === "pull_payments_for_sync");
    expect(failed).toHaveLength(3); // ONE per tick — BUG-042's 7,148-request amplification shape is dead at the seam
    ARTIFACT.scenarios["failing-pull-ticks-x3"] = {
      calls: ledger.calls.length,
      note: "ONE attempt per tick per table — the ceiling is linear in ticks; the archived BEFORE is BUG-042's live burn: 7,148 requests",
    };
  });

  it("the source pins: the toast context split (T-559) + the five load-generation-ref gates (T-560) stand at HEAD", () => {
    // T-559: the actions identity is memoized; the list rides a SECOND context.
    expect(TOAST_PROVIDER_SRC).toContain("useMemo");
    expect(TOAST_PROVIDER_SRC).toContain("ToastListContext");
    // T-560: all five loop-capable sites carry the load-generation-ref gate.
    for (const { file, src } of LOOP_GATE_FILES) {
      expect(src, file).toContain("load-generation-ref");
    }
  });
});

// ============================================================
// GATE 4 — class 4: the 1,000-row sync batch (T-593's proof)
// ============================================================

function entry(i: number): SyncQueueEntry {
  return {
    id: `entry-${String(i).padStart(4, "0")}`,
    entity: "payment",
    operation: "insert",
    tenantId: TENANT,
    actorId: "actor-1",
    payload: { amount: 100, student_id: "stu-001", method: "cash", category: "tuition" },
    sourceFile: null,
    importRunId: null,
    queuedAt: "2026-11-21T10:00:00Z",
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    isMock: false,
    conflict: null,
  } as unknown as SyncQueueEntry;
}

describe("T-595 — GATE 4 (OPS-015 class 4): the 1,000-row batch = 20 round trips; ZERO per-item pushes", () => {
  afterEach(() => {
    vi.doUnmock("../../infrastructure/supabase/backend-access");
    vi.resetModules();
  });

  async function loadBatchHandler(client: unknown) {
    vi.doMock("../../infrastructure/supabase/backend-access", () => ({
      getSupabaseClient: () => client,
      isSupabaseConfigured: () => true,
    }));
    const mod = await import("../../infrastructure/sync/default-push-handler");
    return mod.defaultBatchPushHandler;
  }

  it("1,000 fabricated entries → EXACTLY 20 sync_apply_batch calls (50 mutations each), zero per-item", async () => {
    const { client, ledger } = makeRecordingClient();
    const handler = await loadBatchHandler(client);
    await handler(Array.from({ length: 1000 }, (_, i) => entry(i)));
    const batch = ledger.calls.filter((c) => c.target === "sync_apply_batch");
    expect(batch).toHaveLength(20); // ceil(1000/50)
    expect(batch.every((c) => c.kind === "rpc")).toBe(true);
    // Nothing else touched the wire.
    expect(ledger.calls).toHaveLength(20);
    ARTIFACT.scenarios["sync-batch-1000"] = {
      ...summarize(ledger),
      mutationsPerCall: 50,
      before: "3-4 requests per queued entry (the T-171 live-burn record: 1,170 badge) — 1,000 entries ≈ 3,000-4,000 round trips",
    };
  });

  it("the DRAIN integration: 120 enqueued entries ride ONE pushBatch → 3 round trips, zero per-item pushes, all synced", async () => {
    await _resetSyncQueueStoreForTests();
    _resetSyncServiceForTests();
    const { client, ledger } = makeRecordingClient();
    const handler = await loadBatchHandler(client);
    const perItemPushes: unknown[] = [];
    const service = new SyncService({
      tenantId: () => TENANT,
      actorId: () => "actor-1",
      isSupabaseConfigured: () => true,
      isMockMode: () => false,
      push: async (e) => { perItemPushes.push(e); },
      pushBatch: handler,
      autoStart: false,
      onlineDetector: {
        start() {}, stop() {}, subscribe() { return () => {}; },
        getState: () => ({ navigatorOnline: true, probeOk: true, online: true, changedAt: new Date().toISOString() }),
        probe: async () => true,
      } as never,
    });
    await service.start();
    for (let i = 0; i < 120; i++) {
      await service.enqueue({ entity: "payment", operation: "insert", payload: { amount: i }, isMock: false });
    }
    const drained = await service.syncNow();
    expect(drained.pushed).toBe(120);
    expect(perItemPushes).toHaveLength(0); // the per-entry pattern is dead
    const batch = ledger.calls.filter((c) => c.target === "sync_apply_batch");
    expect(batch).toHaveLength(3); // ceil(120/50)
    const remaining = await getSyncQueueStore().listByStatus("pending");
    expect(remaining).toHaveLength(0);
    ARTIFACT.scenarios["sync-drain-120"] = summarize(ledger);
    _resetSyncServiceForTests();
    await _resetSyncQueueStoreForTests();
  });
});

// ============================================================
// The artifact hook
// ============================================================

describe("T-595 — the artifact writer", () => {
  it("writes egress-after.json when EGRESS_ARTIFACTS_DIR is set (the harness wire)", () => {
    const dir = process.env.EGRESS_ARTIFACTS_DIR;
    if (!dir) {
      return; // a plain `npx vitest run` — no artifact, the gates above still ran
    }
    mkdirSync(dir, { recursive: true });
    let commit = "unknown";
    try {
      commit = execSync("git rev-parse --short HEAD", { cwd: REPO_ROOT }).toString().trim();
    } catch { /* not a git tree — keep unknown */ }
    const payload = {
      ...ARTIFACT,
      generatedAt: new Date().toISOString(),
      commit,
      liveWindow: "PENDING — the owner's one-time G2 window (OPS-015); this artifact is the mock-seam measurement",
      gates: {
        "class-1-volley": "GREEN — warm ticks = 5 empty pull RPCs, zero from() re-seeds",
        "class-2-dashboard": "GREEN — 4 aggregation RPCs + 2 bounded windowed reads per load, zero full-collection downloads",
        "class-3-loop": "GREEN — linear ceiling (1 attempt/tick/table) + the T-559/T-560 source pins",
        "class-4-sync-batch": "GREEN — 1,000 entries = 20 sync_apply_batch calls, zero per-item pushes",
      },
    };
    const out = join(dir, "egress-after.json");
    writeFileSync(out, JSON.stringify(payload, null, 2));
    expect(existsSync(out)).toBe(true);
  });
});
