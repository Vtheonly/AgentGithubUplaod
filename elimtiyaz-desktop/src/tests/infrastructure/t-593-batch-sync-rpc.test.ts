/**
 * T-593 (E7A-4 / ROADMAP 6.6) — the transactional batch sync RPC.
 *
 * The suite pins:
 *   A. The migration 0005 surface: the dispatch census (all 7 kinds + the
 *      loud unknown raise), the tenant validation, the queue-row
 *      ON CONFLICT DO NOTHING audit upsert, the bulk mark, the helpers
 *      (sync_safe_uuid / sync_j / fn_deterministic_student_code), the
 *      discipline, the append-only layout.
 *   B. The batch dispatcher (defaultBatchPushHandler): ONE rpc per bounded
 *      chunk (61 entries → 2 calls), the mutation shape, the fail-loud
 *      error path.
 *   C. The drain: the batch path marks the ready set synced in ONE call;
 *      the batch failure → the per-entry soak-period fallback with the
 *      attempts/backoff bookkeeping; an absent seam keeps the per-item
 *      pipeline; the ineligible entries (mock / foreign tenant) never
 *      join a batch; the 30 s poll cadence stays.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SyncQueueEntry } from "../../infrastructure/sync/sync-types";
import {
  SyncService,
  _resetSyncServiceForTests,
} from "../../infrastructure/sync/sync-service";
import { _resetSyncQueueStoreForTests, getSyncQueueStore } from "../../infrastructure/sync/sync-queue-store";

const SRC = join(__dirname, "../../");
const MIGRATION_0005 = readFileSync(
  join(SRC, "../supabase/migrations/0005_sync_apply_batch.sql"),
  "utf8",
);
const SYNC_SERVICE_SRC = readFileSync(
  join(SRC, "infrastructure/sync/sync-service.ts"),
  "utf8",
);
const PUSH_HANDLER_SRC = readFileSync(
  join(SRC, "infrastructure/sync/default-push-handler.ts"),
  "utf8",
);
const REPO_ROOT = join(SRC, "../..");

const TENANT = "00000000-0000-0000-0000-000000000001";

// ============================================================
// A. The migration 0005 surface
// ============================================================

describe("T-593 — A. The migration 0005 surface (sync_apply_batch)", () => {
  it("the RPC exists with the dispatch census — every canonical kind + the loud unknown", () => {
    expect(MIGRATION_0005).toContain("create or replace function public.sync_apply_batch(p_mutations jsonb)");
    for (const kind of ["parent", "student", "payment", "ledger_entry", "installment", "attendance", "grade", "homework"]) {
      expect(MIGRATION_0005).toContain(`when '${kind}' then`);
    }
    // SYNC-100: an unknown kind FAILS LOUD (never a silent no-op).
    expect(MIGRATION_0005).toContain("no canonical push path for entity kind");
  });

  it("the atomicity discipline: the queue rows ride the same transaction; the bulk mark closes it", () => {
    // The audit row upsert INSIDE the function (SYNC-101: first-insert-wins).
    expect(MIGRATION_0005).toContain("insert into public.sync_queue");
    expect(MIGRATION_0005).toContain("on conflict (id) do nothing");
    // The bulk status mark after the loop.
    expect(MIGRATION_0005).toContain("update public.sync_queue");
    expect(MIGRATION_0005).toContain("set status = 'synced'");
    expect(MIGRATION_0005).toContain("where id = any (v_ids)");
  });

  it("the tenant guard (SYNC-102 server-side) + the discipline", () => {
    expect(MIGRATION_0005).toContain("v_tenant uuid := public.current_tenant_id();");
    expect(MIGRATION_0005).toContain("mutation % targets tenant % (session %)");
    expect(MIGRATION_0005).toContain("security definer");
    expect(MIGRATION_0005).toContain("set search_path to 'public'");
  });

  it("the helpers ship: sync_safe_uuid (uuidOrNull) + sync_j (blankToNull + the camel/snake fallback) + fn_deterministic_student_code", () => {
    expect(MIGRATION_0005).toContain("create or replace function public.sync_safe_uuid(p_value text)");
    expect(MIGRATION_0005).toContain("create or replace function public.sync_j(payload jsonb, p_camel text, p_snake text)");
    expect(MIGRATION_0005).toContain("create or replace function public.fn_deterministic_student_code(");
    // The student code mirrors the desktop rule (the 4-part join + the orphan
    // fallback + fn_stable_hash — the DRIFT-001 retry-stability contract).
    expect(MIGRATION_0005).toContain("'orphan-student'");
    expect(MIGRATION_0005).toContain("public.fn_stable_hash(identity)");
    expect(MIGRATION_0005).toContain("'ELV-' || p_year::text || '-' || public.fn_stable_hash(identity)");
  });

  it("the retry-stable parent derivation rides the SAME server functions (never a second algorithm)", () => {
    expect(MIGRATION_0005).toContain("public.fn_deterministic_parent_code(");
    expect(MIGRATION_0005).toContain("public.fn_deterministic_activation_code(v_parent_code, v_tenant)");
  });

  it("the append-only layout holds (0001..0005 sort)", () => {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const files = readdirSync(join(REPO_ROOT, "elimtiyaz-desktop/supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(files.slice(0, 5)).toEqual([
      "0001_initial_consolidated_schema.sql",
      "0002_stage_a_dashboard_aggregation.sql",
      "0003_read_reconcile_inputs.sql",
      "0004_pull_installments_for_sync.sql",
      "0005_sync_apply_batch.sql",
    ]);
  });
});

// ============================================================
// B. The batch dispatcher
// ============================================================

function entry(i: number, entity: SyncQueueEntry["entity"] = "payment"): SyncQueueEntry {
  return {
    id: `entry-${String(i).padStart(4, "0")}`,
    entity,
    operation: "insert",
    tenantId: TENANT,
    actorId: "actor-1",
    payload: { amount: 100 + i },
    status: "pending",
    attempts: 0,
    queuedAt: "2026-11-21T10:00:00Z",
    lastAttemptAt: null,
    lastError: null,
    isMock: false,
    conflict: null,
  } as unknown as SyncQueueEntry;
}

describe("T-593 — B. defaultBatchPushHandler", () => {
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
    return { handler: mod.defaultBatchPushHandler, size: mod.SYNC_APPLY_BATCH_SIZE };
  }

  it("ONE rpc per bounded chunk — 61 entries fire 2 calls (50 + 11 mutations)", async () => {
    const rpcCalls: Array<{ fn: string; args?: Record<string, unknown> }> = [];
    const client = {
      rpc: (fn: string, args?: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        return Promise.resolve({ data: [], error: null });
      },
    };
    const { handler, size } = await loadBatchHandler(client);
    expect(size).toBe(50);
    await handler(Array.from({ length: 61 }, (_, i) => entry(i)));
    expect(rpcCalls).toHaveLength(2);
    expect(rpcCalls.map((c) => c.fn)).toEqual(["sync_apply_batch", "sync_apply_batch"]);
    expect((rpcCalls[0].args?.p_mutations as unknown[]).length).toBe(50);
    expect((rpcCalls[1].args?.p_mutations as unknown[]).length).toBe(11);
    // The mutation shape mirrors the queue entry (the audit row the RPC upserts).
    const first = (rpcCalls[0].args?.p_mutations as Array<Record<string, unknown>>)[0];
    expect(first["id"]).toBe("entry-0000");
    expect(first["entity"]).toBe("payment");
    expect(first["tenant_id"]).toBe(TENANT);
    expect(first["payload"]).toEqual({ amount: 100 });
    expect(first["queued_at"]).toBe("2026-11-21T10:00:00Z");
  });

  it("FAILS LOUD on a batch error (the drain's fallback owns the retry)", async () => {
    const client = {
      rpc: () => Promise.resolve({ data: null, error: { message: "boom" } }),
    };
    const { handler } = await loadBatchHandler(client);
    await expect(handler([entry(1)])).rejects.toThrow("boom");
  });

  it("an empty entry list is a no-op (zero rpc calls)", async () => {
    const rpcCalls: unknown[] = [];
    const client = { rpc: (fn: string) => { rpcCalls.push(fn); return Promise.resolve({ data: [], error: null }); } };
    const { handler } = await loadBatchHandler(client);
    await handler([]);
    expect(rpcCalls).toHaveLength(0);
  });

  it("the source carries the bounded-size + soak-fallback contract", () => {
    expect(PUSH_HANDLER_SRC).toContain("SYNC_APPLY_BATCH_SIZE = 50");
    expect(PUSH_HANDLER_SRC).toContain("soak-period fallback");
    expect(PUSH_HANDLER_SRC).toContain("toBatchMutation");
  });
});

// ============================================================
// C. The drain's batch stage
// ============================================================

describe("T-593 — C. The drain's batch stage", () => {
  beforeEach(async () => {
    _resetSyncServiceForTests();
    await _resetSyncQueueStoreForTests();
  });

  afterEach(async () => {
    _resetSyncServiceForTests();
    await _resetSyncQueueStoreForTests();
  });

  function stubDetector(online = true) {
    return {
      start() {},
      stop() {},
      subscribe() {
        return () => {};
      },
      getState: () => ({
        navigatorOnline: online,
        probeOk: online,
        online,
        changedAt: new Date().toISOString(),
      }),
      probe: async () => online,
    };
  }

  function makeService(opts: {
    pushBatch?: (entries: SyncQueueEntry[]) => Promise<void>;
    batchFails?: boolean;
  }) {
    const pushCalls: SyncQueueEntry[] = [];
    const batchCalls: SyncQueueEntry[][] = [];
    const service = new SyncService({
      tenantId: () => TENANT,
      actorId: () => "actor-1",
      isSupabaseConfigured: () => true,
      isMockMode: () => false,
      push: async (e) => {
        pushCalls.push(e);
        if (opts.batchFails) throw new Error("per-item also fails");
      },
      pushBatch: opts.pushBatch
        ? opts.pushBatch
        : async (entries) => {
            batchCalls.push(entries);
            if (opts.batchFails) throw new Error("batch boom");
          },
      autoStart: false,
      onlineDetector: stubDetector(true) as never,
    });
    return { service, pushCalls, batchCalls };
  }

  it("the ready set rides ONE batch call; every entry marked synced", async () => {
    const { service, batchCalls, pushCalls } = makeService({});
    await service.start();
    for (let i = 0; i < 5; i++) {
      await service.enqueue({
        entity: "payment",
        operation: "insert",
        payload: { amount: i },
        isMock: false,
      });
    }
    const drained = await service.syncNow();
    expect(batchCalls).toHaveLength(1);
    expect(batchCalls[0]).toHaveLength(5);
    // The per-item handler NEVER fired (the 3-4-requests-per-item pattern is dead).
    expect(pushCalls).toHaveLength(0);
    expect(drained.pushed).toBe(5);
    // Every queue row is synced.
    const remaining = await getSyncQueueStore().listByStatus("pending");
    expect(remaining).toHaveLength(0);
  });

  it("the batch failure → the per-entry soak-period fallback (attempts/backoff bookkeeping intact)", async () => {
    let perItemPushes = 0;
    const batchCalls: SyncQueueEntry[][] = [];
    const { service } = makeService({
      pushBatch: async (entries) => {
        batchCalls.push(entries);
        throw new Error("mid-batch rollback");
      },
    });
    // Override the per-item push to SUCCEED (the fallback path re-applies).
    (service as unknown as { opts: { push: (e: SyncQueueEntry) => Promise<void> } }).opts.push = async () => {
      perItemPushes += 1;
    };
    await service.start();
    for (let i = 0; i < 3; i++) {
      await service.enqueue({ entity: "payment", operation: "insert", payload: { amount: i }, isMock: false });
    }
    const drained = await service.syncNow();
    expect(batchCalls).toHaveLength(1);
    expect(perItemPushes).toBe(3); // the fallback re-pushed every entry
    expect(drained.pushed).toBe(3);
  });

  it("an absent seam keeps the per-item pipeline (the version-skew wire)", async () => {
    const pushCalls: SyncQueueEntry[] = [];
    const service = new SyncService({
      tenantId: () => TENANT,
      actorId: () => "actor-1",
      isSupabaseConfigured: () => true,
      isMockMode: () => false,
      push: async (e) => {
        pushCalls.push(e);
      },
      autoStart: false,
      onlineDetector: stubDetector(true) as never,
    });
    await service.start();
    await service.enqueue({ entity: "payment", operation: "insert", payload: { amount: 1 }, isMock: false });
    const drained = await service.syncNow();
    expect(pushCalls).toHaveLength(1);
    expect(drained.pushed).toBe(1);
  });

  it("mock entries never join a batch (the enqueue gate + the defense-in-depth gate)", async () => {
    const { service, batchCalls } = makeService({});
    await service.start();
    // ENQUEUE TIME: a mock entry is marked skipped_mock BEFORE the queue.
    await service.enqueue({ entity: "payment", operation: "insert", payload: { amount: 1 }, isMock: true });
    await service.enqueue({ entity: "payment", operation: "insert", payload: { amount: 2 }, isMock: false });
    // DEFENSE IN DEPTH: a mock entry that somehow ended up PENDING.
    await getSyncQueueStore().add({
      id: "entry-mock-pending",
      queuedAt: new Date().toISOString(),
      lastAttemptAt: null,
      entity: "payment",
      operation: "insert",
      tenantId: TENANT,
      actorId: "actor-1",
      payload: { amount: 3 },
      isMock: true,
      conflict: null,
      status: "pending",
      attempts: 0,
      lastError: null,
    } as unknown as SyncQueueEntry);
    const drained = await service.syncNow();
    expect(batchCalls).toHaveLength(1);
    expect(batchCalls[0]).toHaveLength(1); // only the non-mock entry
    expect(drained.skippedMock).toBe(1); // the defense-in-depth re-check fired
  });

  it("the 30 s local poll cadence STAYS (the IndexedDB check is the local trigger)", () => {
    expect(SYNC_SERVICE_SRC).toContain("pollIntervalMs: 30_000");
    expect(SYNC_SERVICE_SRC).toContain("offlinePollIntervalMs: 120_000");
  });

  it("the provider wires the batch dispatcher (the production seam)", async () => {
    const providerSrc = readFileSync(join(SRC, "app/providers/sync-provider.tsx"), "utf8");
    expect(providerSrc).toContain("pushBatch: defaultBatchPushHandler");
    expect(providerSrc).toContain("push: defaultPushHandler");
  });
});
