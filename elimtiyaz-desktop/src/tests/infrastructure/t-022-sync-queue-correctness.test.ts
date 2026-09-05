/**
 * T-022 — desktop sync queue correctness regression suite
 * (SYNC-100, SYNC-101, SYNC-102, CACHE-102).
 *
 * SYNC-100: defaultPushHandler silently no-opped 11 of the 15 SyncEntityKind
 * values (marking them "synced" with no server write). Fixed: installment /
 * attendance / grade / homework now push through their canonical paths
 * (upsert_installment_from_import 0037; upsert_attendance_from_import +
 * upsert_assessment_from_import 0041; direct `homework` upsert mirroring the
 * Android dispatcher), and every remaining kind FAILS LOUD.
 *
 * SYNC-101: the sync_queue upsert reset status to "pending" on every drain,
 * clobbering the server-side audit trail. Fixed: ignoreDuplicates.
 *
 * SYNC-102: the queue survived logout/login (user A's entries pushed under
 * user B's JWT). Fixed: sign-out clears the queue + the drain skips foreign
 * actors (defense in depth).
 *
 * CACHE-102: the IndexedDB→memory fallback was console.warn-only. Fixed:
 * isUsingFallback() + snapshot field + the indicator's explicit warning.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SyncQueueEntry } from "../../infrastructure/sync/sync-types";

const SRC = join(__dirname, "../../");
const PROVIDER = join(SRC, "app/providers/sync-provider.tsx");

beforeAll(() => {
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: "00000000-0000-0000-0000-000000000001", userId: "staff-1" }),
  );
});

// ---------------------------------------------------------------------------
// Fake Supabase client capturing rpc/table calls
// ---------------------------------------------------------------------------

type RpcCall = { fn: string; args: Record<string, unknown> };
type TableCall = { table: string; op: string; payload: unknown; options: unknown };

function makeClient() {
  const rpcCalls: RpcCall[] = [];
  const tableCalls: TableCall[] = [];
  const client = {
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: "ok", error: null });
    },
    from(table: string) {
      const q: Record<string, unknown> = {};
      q.upsert = (payload: unknown, options?: unknown) => {
        tableCalls.push({ table, op: "upsert", payload, options });
        return Promise.resolve({ data: null, error: null });
      };
      return q;
    },
  };
  return { client: client as unknown as SupabaseClient, rpcCalls, tableCalls };
}

function entry(entity: SyncQueueEntry["entity"], payload: Record<string, unknown>): SyncQueueEntry {
  return {
    id: `sync_${entity}`,
    entity,
    operation: "insert",
    tenantId: "00000000-0000-0000-0000-000000000001",
    actorId: "staff-1",
    payload,
    isMock: false,
    status: "pending",
    attempts: 0,
    queuedAt: new Date().toISOString(),
    lastAttemptAt: null,
    lastError: null,
  };
}

// The handler dynamically imports the supabase client — mock that module so
// the tests drive the REAL dispatcher with the fake client.
async function loadHandler(client: SupabaseClient) {
  vi.doMock("../../infrastructure/supabase/supabase-client", () => ({
    getSupabaseClient: () => client,
    isSupabaseConfigured: () => true,
  }));
  const mod = await import("../../infrastructure/sync/default-push-handler");
  return mod.defaultPushHandler;
}

describe("T-022 — SYNC-100: all 15 entity kinds handled or explicitly rejected", () => {
  it("installment pushes through upsert_installment_from_import (migration 0037)", async () => {
    const { client, rpcCalls, tableCalls } = makeClient();
    const handler = await loadHandler(client);
    await handler(
      entry("installment", {
        parentId: "p-1",
        studentId: "s-1",
        category: "tuition",
        amountDue: 33000,
        amountPaid: 0,
        dueDate: "2026-09-10",
        status: "unpaid",
      }),
    );
    const call = rpcCalls.find((c) => c.fn === "upsert_installment_from_import");
    expect(call).toBeDefined();
    expect(call!.args.p_parent_id).toBe("p-1");
    expect(call!.args.p_amount_due).toBe(33000);
    // marked synced afterwards
    expect(rpcCalls.some((c) => c.fn === "mark_sync_queue_processed")).toBe(true);
    // the audit-trail row was written exactly once
    const queueWrites = tableCalls.filter((c) => c.table === "sync_queue");
    expect(queueWrites).toHaveLength(1);
  });

  it("attendance pushes through upsert_attendance_from_import (migration 0041)", async () => {
    const { client, rpcCalls } = makeClient();
    const handler = await loadHandler(client);
    await handler(
      entry("attendance", { studentId: "s-1", recordDate: "2026-09-01", status: "late", session: "morning" }),
    );
    const call = rpcCalls.find((c) => c.fn === "upsert_attendance_from_import");
    expect(call).toBeDefined();
    expect(call!.args.p_record_date).toBe("2026-09-01");
    expect(call!.args.p_status).toBe("late");
  });

  it("grade pushes through upsert_assessment_from_import (migration 0041)", async () => {
    const { client, rpcCalls } = makeClient();
    const handler = await loadHandler(client);
    await handler(
      entry("grade", {
        studentId: "s-1",
        subjectId: "sub-1",
        term: 1,
        academicYear: "2026-2027",
        devoir1: 15,
        examen: 16,
      }),
    );
    const call = rpcCalls.find((c) => c.fn === "upsert_assessment_from_import");
    expect(call).toBeDefined();
    expect(call!.args.p_student_id).toBe("s-1");
    expect(call!.args.p_devoir1).toBe(15);
  });

  it("homework upserts the canonical homework table (Android parity)", async () => {
    const { client, tableCalls } = makeClient();
    const handler = await loadHandler(client);
    await handler(
      entry("homework", {
        id: "hw-1",
        classId: "c-1",
        subjectId: "sub-1",
        title: "Exercices",
        description: "Page 12",
        dueDate: "2026-09-05",
        attachments: '["a.jpg"]',
      }),
    );
    const hw = tableCalls.find((c) => c.table === "homework" && c.op === "upsert");
    expect(hw).toBeDefined();
    const payload = hw!.payload as Record<string, unknown>;
    expect(payload.id).toBe("hw-1");
    expect(payload.tenant_id).toBe("00000000-0000-0000-0000-000000000001");
    expect(payload.attachments).toEqual(["a.jpg"]); // parsed from the JSON string
  });

  it("homework without id/classId/subjectId fails loud (validation)", async () => {
    const { client } = makeClient();
    const handler = await loadHandler(client);
    await expect(handler(entry("homework", { title: "x" }))).rejects.toThrow(
      /id, classId and subjectId are required/,
    );
  });

  it("an UNSUPPORTED kind rejects instead of silently 'syncing' (expense example)", async () => {
    const { client, rpcCalls } = makeClient();
    const handler = await loadHandler(client);
    await expect(handler(entry("expense", { amount: 500 }))).rejects.toThrow(
      /no canonical push path for entity kind "expense"/,
    );
    // mark_sync_queue_processed('failed') IS called by the catch path — the
    // audit trail records the failure (it must NOT record 'synced').
    const marked = rpcCalls.filter((c) => c.fn === "mark_sync_queue_processed");
    expect(marked).toHaveLength(1);
    expect((marked[0].args as { p_status?: string }).p_status).toBe("failed");
  });

  it("source-scan: the old silent-no-op default is gone", () => {
    const text = readFileSync(PROVIDER, "utf8");
    expect(text).not.toContain("just mark as synced without upserting");
  });
});

describe("T-022 — SYNC-101: the sync_queue upsert no longer clobbers audit history", () => {
  it("the audit-trail upsert uses onConflict id + ignoreDuplicates", async () => {
    const { client, tableCalls } = makeClient();
    const handler = await loadHandler(client);
    await handler(entry("parent", { code: "PAR-2026-AAAA", firstName: "A", lastName: "B" }));
    const queueWrite = tableCalls.find((c) => c.table === "sync_queue");
    expect(queueWrite).toBeDefined();
    expect(queueWrite!.options).toEqual({ onConflict: "id", ignoreDuplicates: true });
  });
});

describe("T-022 — SYNC-102: queue is session-scoped", () => {
  it("source-scan: sign-out clears the sync queue", () => {
    const text = readFileSync(join(SRC, "app/providers/auth-provider.tsx"), "utf8");
    expect(text).toContain("getSyncQueueStore().clear()");
  });

  it("source-scan: the drain skips entries owned by another actor", () => {
    const text = readFileSync(join(SRC, "infrastructure/sync/sync-service.ts"), "utf8");
    // T-171 renamed the loop variable to entryToPush (legacy tenant re-scope
    // patch) — the SYNC-102 foreign-actor skip semantics are unchanged and
    // additionally pinned behaviorally by t-171-sync-recovery.test.ts.
    expect(text).toContain("entryToPush.actorId !== currentActor");
  });
});

describe("T-022 — CACHE-102: the in-memory fallback is surfaced", () => {
  it("source-scan: store + snapshot + indicator surface the fallback", () => {
    const store = readFileSync(join(SRC, "infrastructure/sync/sync-queue-store.ts"), "utf8");
    expect(store).toContain("isUsingFallback(): boolean");
    const types = readFileSync(join(SRC, "infrastructure/sync/sync-types.ts"), "utf8");
    expect(types).toContain("queueUsingFallback: boolean");
    const service = readFileSync(join(SRC, "infrastructure/sync/sync-service.ts"), "utf8");
    expect(service).toContain("queueUsingFallback: this.store.isUsingFallback()");
    const indicator = readFileSync(join(SRC, "infrastructure/sync/sync-indicator.tsx"), "utf8");
    expect(indicator).toContain("queueUsingFallback");
    expect(indicator).toContain("PERDUS à la fermeture");
  });

  it("behavioral: the store reports the fallback when indexedDB is unavailable", async () => {
    const { getSyncQueueStore, _resetSyncQueueStoreForTests } = await import(
      "../../infrastructure/sync/sync-queue-store"
    );
    await _resetSyncQueueStoreForTests();
    const origIndexedDB = (globalThis as { indexedDB?: unknown }).indexedDB;
    (globalThis as { indexedDB?: unknown }).indexedDB = undefined;
    try {
      const store = getSyncQueueStore();
      await store.init();
      expect(store.isUsingFallback()).toBe(true);
    } finally {
      (globalThis as { indexedDB?: unknown }).indexedDB = origIndexedDB;
      await _resetSyncQueueStoreForTests();
    }
  });
});
