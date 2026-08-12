/**
 * SyncService.enqueueBatch + dryRun report skipping — regression tests.
 *
 * Two bugs that shipped together and were both fixed in iteration 22:
 *
 * 1. SYNC NOTIFICATION FLOOD — the Excel import path called `enqueue()`
 *    once per domain entity (parent + student + ledger_entry per row ×
 *    ~390 rows ≈ 1,170 entries). Each `enqueue()` calls
 *    `refreshSnapshot()` which emits a snapshot to every subscriber,
 *    triggering 1,170 React re-renders across every `useSyncStatus()`
 *    consumer. The user reported "1,170 sync notifications during sync".
 *    Fix: `enqueueBatch()` writes ALL entries in ONE IndexedDB
 *    transaction and emits ONE snapshot at the end.
 *
 * 2. DUPLICATE EXCEL + JSON REPORTS — the ImportEngine generated JSON +
 *    Excel report files on EVERY `importFile()` call, including the
 *    dry-run preview step. The user saw "every time I upload an excel
 *    file, it generates another excel file and a json file, both at the
 *    beginning and at the end". Fix: skip report generation when
 *    `options.dryRun === true`.
 *
 * These tests verify both fixes hold across future refactors.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  SyncService,
  _resetSyncServiceForTests,
} from "../../infrastructure/sync/sync-service";
import { _resetSyncQueueStoreForTests } from "../../infrastructure/sync/sync-queue-store";
import { ImportEngine } from "../../infrastructure/excel/import-engine";
import { InMemoryAdapter } from "../../infrastructure/excel/import-engine/storage/in-memory-adapter";
import type { SyncQueueEntry } from "../../infrastructure/sync/sync-types";

// ── Test helpers ────────────────────────────────────────────────────────

/** Build a SyncService with a stub online detector (always online) + a
 * push handler that counts how many times it was called.
 *
 * We cast the stub to `OnlineDetector` because the constructor option
 * expects the class type, but we only need the structural shape (the
 * service only calls `.start()`, `.stop()`, `.subscribe()`, `.getState()`,
 * `.probe()` — all of which our stub implements).
 */
function makeService(opts?: { online?: boolean }) {
  const online = opts?.online ?? true;
  const pushCalls: SyncQueueEntry[] = [];
  const stub = {
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
  const service = new SyncService({
    tenantId: () => "tenant-test",
    actorId: () => "actor-test",
    isSupabaseConfigured: () => true,
    isMockMode: () => false,
    push: async (entry) => {
      pushCalls.push(entry);
    },
    autoStart: false,
    onlineDetector: stub as unknown as ConstructorParameters<typeof SyncService>[0]["onlineDetector"],
  });
  return { service, pushCalls };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("SyncService.enqueueBatch", () => {
  beforeEach(async () => {
    _resetSyncServiceForTests();
    await _resetSyncQueueStoreForTests();
  });

  afterEach(async () => {
    _resetSyncServiceForTests();
    await _resetSyncQueueStoreForTests();
  });

  it("writes all entries in ONE snapshot emission (not N)", async () => {
    const { service } = makeService();
    await service.start();

    // Subscribe to snapshot changes — count how many times the listener
    // fires. Without batching, enqueueing N entries triggers N+1 emissions
    // (N during enqueue + 1 final refresh). With batching, we should see
    // exactly ONE emission for the whole batch.
    let emitCount = 0;
    service.subscribe(() => {
      emitCount++;
    });
    // Reset after the initial subscribe() callback fires (subscribe always
    // emits the current snapshot synchronously — that's not what we're
    // counting).
    emitCount = 0;

    const N = 50;
    const inputs = Array.from({ length: N }, (_, i) => ({
      entity: "parent" as const,
      operation: "insert" as const,
      payload: { firstName: `Parent${i}`, displayName: `Parent ${i}` },
      isMock: false,
      sourceFile: "test.xlsx",
      importRunId: "run-1",
    }));

    await service.enqueueBatch(inputs);

    // The batch should emit EXACTLY ONE snapshot — not N. The previous
    // implementation emitted N snapshots (one per enqueue call), which
    // caused the "1,170 sync notifications during sync" flood.
    expect(emitCount).toBe(1);

    // All N entries should be in the queue.
    const snap = service.getSnapshot();
    expect(snap.pendingCount).toBe(N);
  });

  it("returns the created queue entry IDs in order", async () => {
    const { service } = makeService();
    await service.start();

    const inputs = [
      {
        entity: "parent" as const,
        operation: "insert" as const,
        payload: { displayName: "A" },
        isMock: false,
      },
      {
        entity: "student" as const,
        operation: "insert" as const,
        payload: { displayName: "B" },
        isMock: false,
      },
      {
        entity: "ledger_entry" as const,
        operation: "insert" as const,
        payload: { amount: 100 },
        isMock: false,
      },
    ];

    const ids = await service.enqueueBatch(inputs);
    expect(ids).toHaveLength(3);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[1]).not.toBe(ids[2]);

    // Each ID should be retrievable from the store.
    const store = service.getStore();
    const e0 = await store.get(ids[0]);
    const e1 = await store.get(ids[1]);
    const e2 = await store.get(ids[2]);
    expect(e0?.entity).toBe("parent");
    expect(e1?.entity).toBe("student");
    expect(e2?.entity).toBe("ledger_entry");
  });

  it("marks mock entries as skipped_mock (defense in depth, batched)", async () => {
    const { service } = makeService();
    await service.start();

    const ids = await service.enqueueBatch([
      {
        entity: "parent",
        operation: "insert",
        payload: { displayName: "Real" },
        isMock: false,
      },
      {
        entity: "parent",
        operation: "insert",
        payload: { displayName: "Mock" },
        isMock: true,
      },
    ]);

    expect(ids).toHaveLength(2);
    const snap = service.getSnapshot();
    expect(snap.pendingCount).toBe(1); // only the real entry
    expect(snap.skippedMockCount).toBe(1); // the mock entry
  });

  it("empty batch is a no-op (no snapshot emission, no drain schedule)", async () => {
    const { service } = makeService();
    await service.start();

    let emitCount = 0;
    service.subscribe(() => {
      emitCount++;
    });
    emitCount = 0; // reset initial sync emit

    const ids = await service.enqueueBatch([]);
    expect(ids).toEqual([]);
    expect(emitCount).toBe(0);
    expect(service.getSnapshot().pendingCount).toBe(0);
  });

  it("enqueueBatch matches N individual enqueues for correctness", async () => {
    // Run the same payload through both paths and verify the final queue
    // state is identical. This guards against regressions where the batch
    // path drops entries or stamps them differently.
    const inputs = Array.from({ length: 10 }, (_, i) => ({
      entity: "parent" as const,
      operation: "insert" as const,
      payload: { displayName: `Parent ${i}` },
      isMock: false,
      sourceFile: "batch.xlsx",
      importRunId: "run-batch",
    }));

    // Path 1: batched
    const svcBatch = makeService();
    await svcBatch.service.start();
    await svcBatch.service.enqueueBatch(inputs);
    const batchEntries = await svcBatch.service.getStore().listAll();

    // Wipe the store before Path 2 — otherwise both services share the
    // same IndexedDB singleton and Path 2 would see Path 1's entries.
    await svcBatch.service.clearQueue();
    await _resetSyncQueueStoreForTests();

    // Path 2: individual
    const svcIndividual = makeService();
    await svcIndividual.service.start();
    for (const input of inputs) {
      await svcIndividual.service.enqueue(input);
    }
    const individualEntries = await svcIndividual.service.getStore().listAll();

    // Compare relevant fields — IDs and timestamps will differ, but
    // entity, operation, payload, isMock, sourceFile, importRunId, status
    // should match.
    expect(batchEntries).toHaveLength(individualEntries.length);
    for (let i = 0; i < batchEntries.length; i++) {
      const b = batchEntries[i];
      const ind = individualEntries[i];
      expect(b.entity).toBe(ind.entity);
      expect(b.operation).toBe(ind.operation);
      expect(b.payload).toEqual(ind.payload);
      expect(b.isMock).toBe(ind.isMock);
      expect(b.sourceFile).toBe(ind.sourceFile);
      expect(b.importRunId).toBe(ind.importRunId);
      expect(b.status).toBe(ind.status);
      expect(b.attempts).toBe(ind.attempts);
    }
  });
});

// ── ImportEngine dryRun report skipping tests ──────────────────────────

describe("ImportEngine — dryRun skips report generation", () => {
  /**
   * Build a tiny valid .xlsx workbook so the ExcelParser can actually
   * open it — without this, the engine throws at parse time and never
   * reaches the report-generation step, which is what we're testing.
   */
  async function buildMinimalXlsx(): Promise<Uint8Array> {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    // A sheet whose name is NOT recognized as any known schema → the
    // engine will add a warning but still complete the run successfully.
    const ws = wb.addWorksheet("UnknownSheet");
    ws.addRow(["col1", "col2"]);
    ws.addRow(["a", "b"]);
    const buffer = await wb.xlsx.writeBuffer();
    return new Uint8Array(buffer);
  }

  it("does NOT generate reports when dryRun=true (preview step)", async () => {
    // Spy on the JSON + Excel reporters — they should NOT be called
    // during a dry-run import. The previous implementation called them
    // unconditionally, causing the "Excel upload generates another
    // excel + json file at the beginning AND at the end" bug.
    const jsonWrite = vi.fn().mockResolvedValue({ fileName: "should-not-be-called.json" });
    const excelWrite = vi.fn().mockResolvedValue({ fileName: "should-not-be-called.xlsx" });

    const storage = new InMemoryAdapter();
    const engine = new ImportEngine({ storage });
    (engine as unknown as { jsonReporter: { write: typeof jsonWrite } }).jsonReporter = {
      write: jsonWrite,
    };
    (engine as unknown as { excelReporter: { write: typeof excelWrite } }).excelReporter = {
      write: excelWrite,
    };

    const bytes = await buildMinimalXlsx();
    await engine.importFile(bytes, "minimal.xlsx", { dryRun: true });

    expect(jsonWrite).not.toHaveBeenCalled();
    expect(excelWrite).not.toHaveBeenCalled();
  });

  it("DOES generate reports when dryRun=false (commit step)", async () => {
    // Verify the non-dry-run path STILL generates reports — we don't
    // want to break the commit step's report download UX.
    // NOTE: reporters now return in-memory bytes instead of auto-downloading.
    const jsonWrite = vi.fn().mockResolvedValue({
      fileName: "report.json",
      bytes: new TextEncoder().encode("{}"),
      summary: {},
    });
    const excelWrite = vi.fn().mockResolvedValue({
      fileName: "report.xlsx",
      bytes: new Uint8Array([0x50, 0x4b]), // PK zip header
    });

    const storage = new InMemoryAdapter();
    const engine = new ImportEngine({ storage });
    (engine as unknown as { jsonReporter: { write: typeof jsonWrite } }).jsonReporter = {
      write: jsonWrite,
    };
    (engine as unknown as { excelReporter: { write: typeof excelWrite } }).excelReporter = {
      write: excelWrite,
    };

    const bytes = await buildMinimalXlsx();
    const ctx = await engine.importFile(bytes, "minimal.xlsx", { dryRun: false });

    // Both reporters SHOULD have been called for the commit step.
    expect(jsonWrite).toHaveBeenCalledTimes(1);
    expect(excelWrite).toHaveBeenCalledTimes(1);
    // Reports are attached to the context (not auto-downloaded).
    expect(ctx.reports.json).toBeDefined();
    expect(ctx.reports.json?.fileName).toBe("report.json");
    expect(ctx.reports.excel).toBeDefined();
    expect(ctx.reports.excel?.fileName).toBe("report.xlsx");
  });
});
