/**
 * T-592 (E7A-3 / ROADMAP 6.5) — the incremental delta cache.
 *
 * The suite pins:
 *   A. The migration 0004 surface (pull_installments_for_sync — the 0143
 *      composite cursor contract, the NULL p_since full-walk branch, the
 *      tenant scope, the SECURITY DEFINER + search_path discipline).
 *   B. The delta-cache module: the cold start (per-table coldSince), the
 *      warm continuation (the composite cursor args), the multi-page
 *      walk, the cursor advance, the empty warm pull, version skew →
 *      null, the transient throw; splitSoftDeletes + applyRowsById (the
 *      insert/update/soft-delete-removal propagation, the order
 *      preservation).
 *   C. The repository wiring: the volley death — the FIRST observe cold
 *      walks through the pull primitive, the TTL-expired re-seed pulls
 *      ONLY the delta and patches the cache (insert / update /
 *      soft-delete), the manual refresh resets to cold, version skew
 *      falls back to the legacy collection path.
 *   D. The phantom-dependency pins (the one-coherent-caching decision).
 *   E. The documented students deviation.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

const {
  __setSeedRetryBackoffForTests,
  SupabasePaymentRepository,
} = await import("../../infrastructure/supabase/repositories/supabase-shared-repositories");
const {
  pullTableDelta,
  splitSoftDeletes,
  applyRowsById,
  TableDeltaCursor,
} = await import("../../infrastructure/supabase/delta-cache");

const SRC = join(__dirname, "../../");
const MIGRATION_0004 = readFileSync(
  join(SRC, "../supabase/migrations/0004_pull_installments_for_sync.sql"),
  "utf8",
);
const SHARED_SRC = readFileSync(
  join(SRC, "infrastructure/supabase/repositories/supabase-shared-repositories.ts"),
  "utf8",
);
const MAIN_SRC = readFileSync(join(SRC, "main.tsx"), "utf8");
const PACKAGE_JSON = JSON.parse(readFileSync(join(SRC, "../package.json"), "utf8"));
const REPO_ROOT = join(SRC, "../..");

const TENANT = "00000000-0000-0000-0000-000000000001";

// ============================================================
// The pull-server mock — implements the 0143 cursor semantics over an
// in-memory world sorted by (updated_at, id).
// ============================================================

type WorldRow = Record<string, unknown> & { id: string; updated_at: string };

function cursorFilter(rows: WorldRow[], pSince: string | null, pAfterId: string | null): WorldRow[] {
  if (pSince === null) return [...rows]; // the NULL branch = the full walk
  return rows.filter((r) => {
    if (String(r.updated_at) > pSince) return true;
    if (pAfterId !== null && String(r.updated_at) === pSince && String(r.id) > pAfterId) return true;
    return false;
  });
}

function makePullClient(world: Partial<Record<string, WorldRow[]>>, opts: { rpcSurface?: boolean } = {}) {
  const rpcCalls: Array<{ fn: string; args?: Record<string, unknown> }> = [];
  const client = {
    rpc: (fn: string, args?: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      const table = fn.replace("pull_", "").replace("_for_sync", "");
      const rows = world[table as keyof typeof world];
      if (!rows) {
        return Promise.resolve({ data: null, error: { code: "PGRST202", message: `function ${fn} not found` } });
      }
      const pSince = (args?.p_since ?? null) as string | null;
      const pAfterId = (args?.p_after_id ?? null) as string | null;
      const pLimit = (args?.p_limit ?? 1000) as number;
      const sorted = [...rows].sort(
        (a, b) => String(a.updated_at).localeCompare(String(b.updated_at)) || String(a.id).localeCompare(String(b.id)),
      );
      const page = cursorFilter(sorted, pSince, pAfterId).slice(0, pLimit);
      return Promise.resolve({ data: page, error: null });
    },
    from: () => {
      throw new Error("the delta path must not touch .from()");
    },
  };
  return { client: opts.rpcSurface === false ? { from: client.from } : client, rpcCalls };
}

beforeAll(() => {
  __setSeedRetryBackoffForTests([0, 0]);
});

beforeEach(() => {
  localStorage.setItem("el-imtiyaz.session", JSON.stringify({ tenantId: TENANT, userId: "staff-1" }));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-21T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

// ============================================================
// A. The migration 0004 surface
// ============================================================

describe("T-592 — A. The migration 0004 surface (pull_installments_for_sync)", () => {
  it("the RPC exists with the 0143 composite cursor contract", () => {
    expect(MIGRATION_0004).toContain("create or replace function public.pull_installments_for_sync(");
    expect(MIGRATION_0004).toContain("p_tenant_id uuid");
    expect(MIGRATION_0004).toContain("p_since timestamp with time zone default null");
    expect(MIGRATION_0004).toContain("p_after_id uuid default null");
    expect(MIGRATION_0004).toContain("p_limit integer default 1000");
    // The composite cursor predicate (NULL = the full cold walk).
    expect(MIGRATION_0004).toContain("p_since IS NULL");
    expect(MIGRATION_0004).toContain("OR i.updated_at > p_since");
    expect(MIGRATION_0004).toContain("OR (p_after_id IS NOT NULL AND i.updated_at = p_since AND i.id > p_after_id)");
    // The walk order + page bound.
    expect(MIGRATION_0004).toContain("ORDER BY i.updated_at ASC, i.id ASC");
    expect(MIGRATION_0004).toContain("LIMIT p_limit");
    // The tenant scope + the discipline.
    expect(MIGRATION_0004).toContain("WHERE i.tenant_id = p_tenant_id");
    expect(MIGRATION_0004).toContain("stable security definer");
    expect(MIGRATION_0004).toContain("set search_path to 'public'");
  });

  it("the column projection mirrors the family (the full row for the mapper)", () => {
    expect(MIGRATION_0004).toContain("i.custom_schedule_note, i.source_type, i.source_id, i.academic_year_id,");
    expect(MIGRATION_0004).toContain("i.created_at, i.updated_at");
    expect(MIGRATION_0004).toContain("i.amount_pending");
  });

  it("the append-only layout holds (0001..0004 sort)", () => {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const files = readdirSync(join(REPO_ROOT, "elimtiyaz-desktop/supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(files.slice(0, 4)).toEqual([
      "0001_initial_consolidated_schema.sql",
      "0002_stage_a_dashboard_aggregation.sql",
      "0003_read_reconcile_inputs.sql",
      "0004_pull_installments_for_sync.sql",
    ]);
  });
});

// ============================================================
// B. The delta-cache module
// ============================================================

describe("T-592 — B. pullTableDelta / splitSoftDeletes / applyRowsById", () => {
  const WORLD: WorldRow[] = [
    { id: "r-001", updated_at: "2026-11-01T00:00:00Z", amount: 100 },
    { id: "r-002", updated_at: "2026-11-05T00:00:00Z", amount: 200 },
    { id: "r-003", updated_at: "2026-11-05T00:00:00Z", amount: 300 },
    { id: "r-004", updated_at: "2026-11-10T00:00:00Z", amount: 400 },
  ];

  it("the cold start walks the full set (p_since = the table's coldSince; null for parents)", async () => {
    const { client, rpcCalls } = makePullClient({ payments: WORLD });
    const out = await pullTableDelta(client as unknown as SupabaseClient, "payments", { tenantId: TENANT, cursor: null });
    expect(out).not.toBeNull();
    expect(out!.isColdStart).toBe(true);
    expect(out!.rows).toHaveLength(4);
    // The payments leg's coldSince is the EPOCH (a NULL p_since answers an
    // empty set there — the predicate compares updated_at > NULL).
    expect(rpcCalls[0].args?.p_since).toBe("1970-01-01T00:00:00Z");
    expect(rpcCalls[0].args?.p_after_id).toBeNull();
    expect(rpcCalls[0].args?.p_tenant_id).toBe(TENANT);
    expect(out!.cursor).toEqual({ since: "2026-11-10T00:00:00Z", lastId: "r-004" });
  });

  it("the parents/students legs' cold start passes p_since = NULL (their full-walk branch)", async () => {
    const { client, rpcCalls } = makePullClient({ parents: WORLD });
    const out = await pullTableDelta(client as unknown as SupabaseClient, "parents", { tenantId: TENANT, cursor: null });
    expect(out!.rows).toHaveLength(4);
    expect(rpcCalls[0].args?.p_since).toBeNull();
  });

  it("the warm continuation passes the composite cursor and returns ONLY the changed rows", async () => {
    const { client, rpcCalls } = makePullClient({ payments: WORLD });
    const cursor = { since: "2026-11-05T00:00:00Z", lastId: "r-003" };
    const out = await pullTableDelta(client as unknown as SupabaseClient, "payments", { tenantId: TENANT, cursor });
    expect(out!.isColdStart).toBe(false);
    // r-004 (updated_at after the cursor) + nothing else — r-002 (older)
    // and the cursor row itself are NOT re-read (no duplicate, no skip).
    expect(out!.rows.map((r) => r.id)).toEqual(["r-004"]);
    expect(rpcCalls[0].args?.p_since).toBe("2026-11-05T00:00:00Z");
    expect(rpcCalls[0].args?.p_after_id).toBe("r-003");
    expect(out!.cursor).toEqual({ since: "2026-11-10T00:00:00Z", lastId: "r-004" });
  });

  it("the multi-page cold walk loops until the short page (2 pages for 1,501 rows)", async () => {
    const big: WorldRow[] = Array.from({ length: 1501 }, (_, i) => ({
      id: `big-${String(i).padStart(6, "0")}`,
      updated_at: `2026-11-${String((i % 20) + 1).padStart(2, "0")}T00:00:00Z`,
    }));
    const { client, rpcCalls } = makePullClient({ payments: big });
    const out = await pullTableDelta(client as unknown as SupabaseClient, "payments", { tenantId: TENANT, cursor: null });
    expect(out!.rows).toHaveLength(1501);
    expect(rpcCalls.length).toBe(2); // 1,000 + 501
  });

  it("an empty warm pull keeps the caller's cursor (the head position is proof)", async () => {
    const { client } = makePullClient({ payments: [] });
    const cursor = { since: "2026-11-10T00:00:00Z", lastId: "r-004" };
    const out = await pullTableDelta(client as unknown as SupabaseClient, "payments", { tenantId: TENANT, cursor });
    expect(out!.rows).toHaveLength(0);
    expect(out!.cursor).toEqual(cursor);
    expect(out!.isColdStart).toBe(false);
  });

  it("version skew answers null (PGRST202) — the caller falls back; transient errors THROW", async () => {
    const calls: Array<{ fn: string; args?: Record<string, unknown> }> = [];
    const skewClient = {
      rpc: (fn: string, args?: Record<string, unknown>) => {
        calls.push({ fn, args });
        return Promise.resolve({ data: null, error: { code: "PGRST202", message: "not found" } });
      },
    };
    const out = await pullTableDelta(skewClient as unknown as SupabaseClient, "payments", { tenantId: TENANT, cursor: null });
    expect(out).toBeNull();

    const transientClient = {
      rpc: () => Promise.resolve({ data: null, error: { code: "500", message: "boom" } }),
    };
    await expect(
      pullTableDelta(transientClient as unknown as SupabaseClient, "payments", { tenantId: TENANT, cursor: null }),
    ).rejects.toThrow("boom");

    // A client with NO .rpc surface at all — the T-423 classification.
    const noRpcClient = { from: () => ({}) };
    const out2 = await pullTableDelta(noRpcClient as unknown as SupabaseClient, "payments", { tenantId: TENANT, cursor: null });
    expect(out2).toBeNull();
  });

  it("splitSoftDeletes routes the 0011 soft-delete marker (deleted_at + updated_at bump)", () => {
    const rows = [
      { id: "a", updated_at: "t1", deleted_at: null },
      { id: "b", updated_at: "t2", deleted_at: "2026-11-21T00:00:00Z" },
      { id: "c", updated_at: "t3" },
    ];
    const { alive, deadIds } = splitSoftDeletes(rows);
    expect(alive.map((r) => r.id)).toEqual(["a", "c"]);
    expect(deadIds).toEqual(new Set(["b"]));
  });

  it("applyRowsById: the insert/update/removal propagation with order preservation", () => {
    const current = [
      { id: "p1", v: 1 },
      { id: "p2", v: 2 },
      { id: "p3", v: 3 },
    ];
    // An update replaces in place; an insert appends; a removal drops.
    const patched = applyRowsById(current, [
      { id: "p2", v: 22 },
      { id: "p4", v: 4 },
    ], { removeIds: new Set(["p1"]) });
    expect(patched).toEqual([
      { id: "p2", v: 22 },
      { id: "p3", v: 3 },
      { id: "p4", v: 4 },
    ]);
  });

  it("the TableDeltaCursor holds the position across pulls and resets on the manual path", () => {
    const cursor = new TableDeltaCursor("payments");
    expect(cursor.get()).toBeNull();
    cursor.set({ since: "t", lastId: "x" });
    expect(cursor.get()).toEqual({ since: "t", lastId: "x" });
    cursor.reset();
    expect(cursor.get()).toBeNull();
  });
});

// ============================================================
// C. The repository wiring — the volley death
// ============================================================

describe("T-592 — C. The payments cache's delta lane (the volley death)", () => {
  const PAYMENT_WORLD: WorldRow[] = [
    {
      id: "pay-001", tenant_id: TENANT, parent_id: "par-1", student_id: null,
      amount: 1000, method: "cash", category: "tuition", status: "paid",
      receipt_number: "REC-1", payment_number: null, installment_id: null,
      collected_at: "2026-10-01T00:00:00Z", collected_by: "system",
      created_at: "2026-10-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z",
    },
    {
      id: "pay-002", tenant_id: TENANT, parent_id: "par-2", student_id: null,
      amount: 500, method: "cash", category: "transport", status: "paid",
      receipt_number: "REC-2", payment_number: null, installment_id: null,
      collected_at: "2026-10-02T00:00:00Z", collected_by: "system",
      created_at: "2026-10-02T00:00:00Z", updated_at: "2026-11-02T00:00:00Z",
    },
  ];

  function freshWorld(): WorldRow[] {
    return PAYMENT_WORLD.map((r) => ({ ...r }));
  }

  it("the FIRST observe cold-walks through the pull primitive (NOT the collection RPC; NOT .from)", async () => {
    const world = freshWorld();
    const { client, rpcCalls } = makePullClient({ payments: world });
    const repo = new SupabasePaymentRepository(client as unknown as SupabaseClient);
    const obs = repo.observe();
    await new Promise((r) => setTimeout(r, 20));
    expect(obs.get()).toHaveLength(2);
    expect(rpcCalls.map((c) => c.fn)).toEqual(["pull_payments_for_sync"]);
    expect(rpcCalls[0].args?.p_since).toBe("1970-01-01T00:00:00Z");
  });

  it("the TTL-expired re-seed pulls ONLY the delta and patches the cache (insert / update / soft-delete)", async () => {
    const world = freshWorld();
    const { client, rpcCalls } = makePullClient({ payments: world });
    const repo = new SupabasePaymentRepository(client as unknown as SupabaseClient);
    repo.observe();
    await new Promise((r) => setTimeout(r, 20));

    // Advance past the 30 s TTL: the re-seed trigger fires.
    vi.setSystemTime(new Date("2026-11-21T12:00:31Z"));
    // The world changed since the cold pull: pay-001 SOFT-DELETED (0011),
    // pay-002's amount UPDATED, pay-003 INSERTED.
    for (const row of world) {
      if (row.id === "pay-001") {
        row["deleted_at"] = "2026-11-21T11:00:00Z";
        row["updated_at"] = "2026-11-21T11:00:00Z";
      }
      if (row.id === "pay-002") {
        row["amount"] = 999;
        row["updated_at"] = "2026-11-21T11:30:00Z";
      }
    }
    world.push({
      id: "pay-003", tenant_id: TENANT, parent_id: "par-3", student_id: null,
      amount: 700, method: "check", category: "tuition", status: "paid",
      receipt_number: "REC-3", payment_number: null, installment_id: null,
      collected_at: "2026-11-21T11:00:00Z", collected_by: "system",
      created_at: "2026-11-21T11:00:00Z", updated_at: "2026-11-21T11:00:00Z",
    });

    repo.observe();
    await new Promise((r) => setTimeout(r, 20));
    const payments = repo.observe().get();

    // The VOLLEY DEATH: the second seed issued ONE delta pull (p_since =
    // the cold cursor), never a collection re-read.
    const pulls = rpcCalls.filter((c) => c.fn === "pull_payments_for_sync");
    expect(pulls).toHaveLength(2);
    expect(pulls[1].args?.p_since).toBe("2026-11-02T00:00:00Z");
    expect(pulls[1].args?.p_after_id).toBe("pay-002");

    // The patch: the soft-deleted row REMOVED, the update REPLACED, the
    // insert APPENDED — the full-collection semantics without the volley.
    // (pay-003's collected_at is the newest → collected_at DESC puts it
    // first — the display order contract.)
    expect(payments.map((p) => p.id)).toEqual(["pay-003", "pay-002"]);
    expect(payments.find((p) => p.id === "pay-002")?.amount).toBe(999);
    expect(payments.find((p) => p.id === "pay-003")?.amount).toBe(700);
    // The display order contract (collected_at desc).
    const times = payments.map((p) => p.collectedAt);
    expect(times).toEqual([...times].sort((a, b) => String(b).localeCompare(String(a))));
  });

  it("the manual refresh resets to the COLD walk (the full re-read path)", async () => {
    const world = freshWorld();
    const { client, rpcCalls } = makePullClient({ payments: world });
    const repo = new SupabasePaymentRepository(client as unknown as SupabaseClient);
    repo.observe();
    await new Promise((r) => setTimeout(r, 20));
    await repo.refresh();
    await new Promise((r) => setTimeout(r, 20));
    const pulls = rpcCalls.filter((c) => c.fn === "pull_payments_for_sync");
    expect(pulls).toHaveLength(2);
    // The refresh's pull is COLD again (the epoch since).
    expect(pulls[1].args?.p_since).toBe("1970-01-01T00:00:00Z");
    expect(repo.observe().get()).toHaveLength(2);
  });

  it("version skew falls back to the legacy collection path (the §15.62c wire)", async () => {
    const rpcCalls: Array<{ fn: string; args?: Record<string, unknown> }> = [];
    const client = {
      rpc: (fn: string, args?: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        if (fn === "read_payments_collection") {
          return Promise.resolve({ data: PAYMENT_WORLD, error: null });
        }
        return Promise.resolve({ data: null, error: { code: "PGRST202", message: "not found" } });
      },
      from: () => {
        throw new Error("the legacy RPC path must not touch .from when the collection RPC answers");
      },
    };
    const repo = new SupabasePaymentRepository(client as unknown as SupabaseClient);
    const obs = repo.observe();
    await new Promise((r) => setTimeout(r, 20));
    expect(obs.get()).toHaveLength(2);
    expect(rpcCalls.map((c) => c.fn)).toEqual(["pull_payments_for_sync", "read_payments_collection"]);
  });
});

// ============================================================
// D. The phantom-dependency pins
// ============================================================

describe("T-592 — D. The phantom-dependency pins (the one-coherent-caching decision)", () => {
  it("main.tsx carries NO QueryClientProvider mount / react-query import (CODE — the historical name survives only in the decision comment)", () => {
    // The code-anchored pins: the JSX mount, the client construction, the
    // import. (The decision comment legitimately NAMES the pruned mount.)
    expect(MAIN_SRC).not.toMatch(/<QueryClientProvider/);
    expect(MAIN_SRC).not.toContain("new QueryClient(");
    expect(MAIN_SRC).not.toMatch(/from "@tanstack\/react-query"/);
    expect(MAIN_SRC).toContain("THE ONE-COHERENT-CACHING-ARCHITECTURE DECISION");
  });

  it("package.json carries NO react-query dependency", () => {
    expect(PACKAGE_JSON.dependencies["@tanstack/react-query"]).toBeUndefined();
    expect(PACKAGE_JSON.dependencies["@tanstack/react-table"]).toBeDefined(); // the LIVE table dep stays
  });

  it("the src/ tree imports react-query NOWHERE (the phantom is gone, not renamed)", () => {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    let hits = "";
    try {
      hits = execSync(
        `rg -l --fixed-strings "from \\"@tanstack/react-query\\"" ${join(SRC)} || true`,
        { encoding: "utf8", shell: "/bin/bash" },
      );
    } catch {
      hits = "";
    }
    expect(hits.trim()).toBe("");
  });
});

// ============================================================
// E. The documented students deviation
// ============================================================

describe("T-592 — E. The documented students deviation", () => {
  it("the students cache keeps the full keyset walk — the deviation is DOCUMENTED with its reason", () => {
    expect(SHARED_SRC).toContain("THE DOCUMENTED DEVIATION: the students cache KEEPS the");
    expect(SHARD_STUB_GUARD());
  });

  it("the four delta-wired classes declare their cursors (payments · installments · ledger · parents)", () => {
    expect(SHARED_SRC).toContain('new TableDeltaCursor("payments")');
    expect(SHARED_SRC).toContain('new TableDeltaCursor("installments")');
    expect(SHARED_SRC).toContain('new TableDeltaCursor("ledger_entries")');
    expect(SHARED_SRC).toContain('new TableDeltaCursor("parents")');
    expect(SHARED_SRC).not.toContain('new TableDeltaCursor("students")');
  });

  it("the refresh() paths reset to cold (the manual-refresh contract)", () => {
    expect(SHARED_SRC.match(/this\.deltaCursor\.reset\(\);/g)).toHaveLength(4);
  });
});

function SHARD_STUB_GUARD(): true {
  // The students seed's full-walk keyset read stays (the deviation's
  // mechanics — asserted by the existing t-423 suite; pinned here as a
  // presence check of the students keyset path).
  expect(SHARED_SRC).toContain(`.from("students").select("*").eq("tenant_id", tenantId).is("deleted_at", null)`);
  return true;
}
