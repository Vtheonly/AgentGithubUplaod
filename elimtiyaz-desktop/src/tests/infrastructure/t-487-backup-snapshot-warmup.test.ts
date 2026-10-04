/**
 * T-487 (BKUP-508) — the backup snapshot's WARM-UP contract.
 *
 * THE DEFECT (live-demonstrated by the T-487 E2E in the isolated tenant):
 * `runBackup`'s snapshot read every collection with `observe().get()` — a
 * SYNCHRONOUS read of the current cache value. In Supabase mode the
 * repositories' `observe()` fires `void this.seed()` (async,
 * fire-and-forget) and returns the cache IMMEDIATELY, so a backup taken on
 * a cold app (no screen subscribed) or right after an import (whose bulk
 * write paths never seed the payments/installments caches) serialized
 * EMPTY or PARTIALLY-EMPTY collections into a "verified" archive — the
 * live run captured 741 parents and silently ZERO payments.
 *
 * THE FIX under test: `runBackup` awaits every snapshot source's public
 * `refresh()` (the force-re-seed seam) BEFORE the synchronous reads —
 * duck-typed so the MOCK layer (no refresh methods) is skipped unchanged.
 *
 * The contract pins, with the REAL backup service + the REAL vault:
 *   1. A lazy repository (empty cache until refresh()) contributes its
 *      server data to the snapshot WITHOUT any prior observe() — the
 *      warm-up is what reads it.
 *   2. The warmed content reaches the ARCHIVE itself (decrypt + parse +
 *      count, not just the metadata).
 *   3. A warm-up FAILURE (a rejecting refresh) degrades honestly: the
 *      backup still completes, the failed source contributes its cache's
 *      last-known (empty) state, and no error escapes to the caller.
 *   4. The MOCK path is byte-identical to before (no refresh methods —
 *      the existing t-415 suites already pin it; the guard here asserts
 *      the duck-typing skips cleanly when ONLY some slots carry refresh).
 *   5. The public refresh seam exists on every Supabase snapshot source
 *      (a source-scan guard — the warm-up is only as good as the seams).
 */
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runBackup,
  restore,
  inspectArchive,
  setBackupPassphrase,
} from "../../infrastructure/backup/backup-service";
import { clearVault, getArchive } from "../../infrastructure/backup/indexed-db-vault";
import { store as mockStore } from "../../infrastructure/mock/repositories/mock-store";
import { mockRepositories } from "../../app/providers/repository-provider";
import { SubjectBehavior } from "../../infrastructure/mock/subject-behavior";
import type { Parent } from "../../domain/model/parent";

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ */
/*  The lazy-repository stub — the Supabase cache semantics distilled  */
/* ------------------------------------------------------------------ */

/** A repository whose cache starts EMPTY and is only populated by an
 *  awaited refresh() — exactly the Supabase lazy-seed shape the backup
 *  used to read synchronously (the defect's mechanism). */
function makeLazyParentRepository(rows: Parent[], opts: { failRefresh?: boolean } = {}) {
  const cache = new SubjectBehavior<Parent[]>([]);
  let refreshCalls = 0;
  const repo = {
    observe: () => {
      // The Supabase pattern: observe() would fire-and-forget a seed —
      // modelled as a NO-OP here (the cache stays empty until refresh()).
      return cache;
    },
    refresh: async (): Promise<void> => {
      refreshCalls += 1;
      if (opts.failRefresh) throw new Error("simulated warm-up network failure");
      cache.set(rows);
    },
    getRefreshCallCount: () => refreshCalls,
  };
  return { repo, cache, getRefreshCallCount: () => refreshCalls };
}

const PARENT_A: Parent = {
  id: "par-t487-a",
  code: "PAR-T487-A",
  firstName: "FAKE",
  lastName: "T487ParentA",
  displayName: "FAKE T487ParentA",
  phone: "+213550000001",
  email: null,
  address: null,
  city: null,
  occupation: null,
  relationship: null,
  isActive: true,
  createdAt: "2026-10-04T00:00:00.000Z",
  updatedAt: "2026-10-04T00:00:00.000Z",
} as unknown as Parent;

beforeEach(async () => {
  await clearVault();
  localStorage.clear();
  setBackupPassphrase("phrase-de-test-t487");
});

afterEach(async () => {
  await clearVault();
  localStorage.clear();
  setBackupPassphrase(null);
});

/* ------------------------------------------------------------------ */
/*  1-3. The warm-up contract (lazy sources)                            */
/* ------------------------------------------------------------------ */

describe("T-487 / BKUP-508 — the backup snapshot's warm-up contract", () => {
  it("a LAZY repository contributes its data with NO prior observe() — the warm-up reads it (the defect's fix)", async () => {
    const { repo, getRefreshCallCount } = makeLazyParentRepository([PARENT_A]);
    const repos = { ...mockRepositories, parents: repo as unknown as typeof mockRepositories.parents };

    // NOTE: no observe() subscription happens before this call — the exact
    // cold-cache state the pre-fix backup serialized as an empty archive.
    const r = await runBackup(repos, "staff-t487", "T487 Tester");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("backup failed");

    // The warm-up called the lazy source's refresh() exactly once.
    expect(getRefreshCallCount()).toBe(1);
    // The metadata counts reflect the WARMED content (not the empty cache).
    expect(r.value.metadata?.parentCount).toBe(1);

    // The ARCHIVE payload itself carries the warmed rows (decrypt + parse).
    const inspection = await inspectArchive(r.value.id);
    expect(inspection.ok).toBe(true);
    if (!inspection.ok) return;
    expect(inspection.value.integrity).toBe("verified");
    expect(inspection.value.counts.parents).toBe(1);

    const rec = await getArchive(r.value.id);
    expect(rec).not.toBeNull();
  });

  it("a FAILING refresh degrades honestly: the backup completes, the failed source contributes its (empty) cache, no error escapes", async () => {
    const { repo } = makeLazyParentRepository([PARENT_A], { failRefresh: true });
    const repos = { ...mockRepositories, parents: repo as unknown as typeof mockRepositories.parents };

    const r = await runBackup(repos, "staff-t487", "T487 Tester");
    expect(r.ok).toBe(true); // the honest degradation — never a crash
    if (!r.ok) return;
    // The failed source contributes its cache's last-known state (empty).
    expect(r.value.metadata?.parentCount).toBe(0);
    // The OTHER (synchronous mock) sources are unaffected.
    expect(r.value.metadata?.studentCount).toBe(mockStore.students.length);
  });

  it("the warm-up result reaches the RESTORE path (round-trip: backup → wipe → restore → the lazy source's rows return)", async () => {
    const { repo } = makeLazyParentRepository([PARENT_A]);
    const repos = { ...mockRepositories, parents: repo as unknown as typeof mockRepositories.parents };

    const backup = await runBackup(repos, "staff-t487", "T487 Tester");
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;

    // Wipe the operational state, then restore.
    mockStore.replaceOperationalState({});
    expect(mockStore.parents.length).toBe(0);

    const rr = await restore(repos, backup.value.id, "staff-t487", "T487 Tester");
    expect(rr.ok).toBe(true);
    // The lazy source's row returned through the archive.
    expect(mockStore.parents.length).toBe(1);
    expect(mockStore.parents[0]?.id).toBe(PARENT_A.id);
  });
});

/* ------------------------------------------------------------------ */
/*  5. The source-scan guard — the warm-up is only as good as the seams */
/* ------------------------------------------------------------------ */

describe("T-487 / BKUP-508 — the public refresh() seams exist on every Supabase snapshot source", () => {
  const REPO_ROOT = join(__dirname, "..", "..", "..");
  const SOURCES: ReadonlyArray<{ file: string; className: string }> = [
    { file: "src/infrastructure/supabase/repositories/supabase-shared-repositories.ts", className: "SupabaseParentRepository" },
    { file: "src/infrastructure/supabase/repositories/supabase-shared-repositories.ts", className: "SupabaseStudentRepository" },
    { file: "src/infrastructure/supabase/repositories/supabase-shared-repositories.ts", className: "SupabasePaymentRepository" },
    { file: "src/infrastructure/supabase/repositories/supabase-shared-repositories.ts", className: "SupabaseLedgerRepository" },
    { file: "src/infrastructure/supabase/repositories/supabase-shared-repositories.ts", className: "SupabaseInstallmentRepository" },
    { file: "src/infrastructure/supabase/repositories/supabase-expense-repository.ts", className: "SupabaseExpenseRepository" },
    { file: "src/infrastructure/supabase/repositories/supabase-personnel-repository.ts", className: "SupabasePersonnelRepository" },
    { file: "src/infrastructure/supabase/repositories/supabase-workflow-repository.ts", className: "SupabaseWorkflowRepository" },
  ];

  it.each(SOURCES)("export class $className exposes the PUBLIC async refresh() seam", ({ file, className }) => {
    const src = readFileSync(join(REPO_ROOT, file), "utf-8");
    const i = src.indexOf(`export class ${className}`);
    expect(i).toBeGreaterThan(-1);
    // The class body ends at the next top-level export (or EOF).
    const tail = src.slice(i);
    const nextExport = tail.indexOf("export class", 1);
    const body = tail.slice(0, nextExport === -1 ? undefined : nextExport);
    // PUBLIC (no `private`/`protected` modifier) + async + refresh().
    expect(body).toMatch(/(?<!private |protected )async refresh\(\): Promise<void>/);
  });

  it("the backup service WARMS the sources before the snapshot (the call-order source scan)", () => {
    const src = readFileSync(join(REPO_ROOT, "src/infrastructure/backup/backup-service.ts"), "utf-8");
    expect(src).toContain("async function warmSnapshotSources");
    const runBackupBody = src.slice(src.indexOf("export async function runBackup"));
    const warmCall = runBackupBody.indexOf("await warmSnapshotSources(repos);");
    const snapshotCall = runBackupBody.indexOf("const snapshot = snapshotState(repos);");
    expect(warmCall).toBeGreaterThan(-1);
    expect(snapshotCall).toBeGreaterThan(warmCall); // warm BEFORE snapshot
  });
});
