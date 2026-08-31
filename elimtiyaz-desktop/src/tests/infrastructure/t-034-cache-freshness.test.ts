/**
 * T-034 / CROSS-104 — desktop Supabase repository cache freshness.
 *
 * The defect: every Supabase-backed repository seeded its SubjectBehavior
 * cache exactly ONCE per session (one-shot `seeded` boolean). Writes from
 * OTHER clients (Android, the website, a second desktop instance, server
 * Edge Functions) stayed invisible until the desktop app restarted — while
 * the website (useFinancialRealtime) saw them immediately.
 *
 * The fix (design choice: TTL + window-focus force refresh, NOT realtime —
 * rationale in cache-freshness.ts and the change-log): the cache re-seeds
 * when a 30s TTL elapses or the window regains focus, so cross-client writes
 * surface within the freshness budget without a restart. A failed seed also
 * retries after the TTL now (the old boolean made a transient failure
 * permanent for the whole session).
 *
 * Test strategy: a counting fake Supabase client whose table contents CHANGE
 * between reads (simulating another client's write) + vitest fake timers for
 * the TTL.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabasePaymentRepository } from "../../infrastructure/supabase/repositories/supabase-shared-repositories";
import { CacheFreshness } from "../../infrastructure/supabase/cache-freshness";

/** The seed runs async (void this.seed()) — flush microtasks before reading the cache. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

beforeAll(() => {
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: "00000000-0000-0000-0000-000000000001", userId: "staff-1" }),
  );
});
afterAll(() => {
  localStorage.removeItem("el-imtiyaz.session");
});

type Row = Record<string, any>;

function paymentRow(id: string, amount: number): Row {
  return {
    id,
    tenant_id: "00000000-0000-0000-0000-000000000001",
    payment_number: `PAY-${id}`,
    receipt_number: `REC-2026-${id}`,
    parent_id: "p-1",
    student_id: "s-1",
    amount,
    method: "cash",
    status: "paid",
    category: "tuition",
    installment_id: null,
    proof_path: null,
    notes: null,
    collected_by: "staff-1",
    collected_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/** Fake payments table whose contents/count are controllable per test. */
function makeCountingFakeClient(table: { rows: Row[]; reads: number }) {
  const chain = {
    select: (_: string) => chain,
    eq: (_: string, __: string) => chain,
    order: (_: string, __: unknown) => chain,
    limit: (_: number) => chain,
    then: (resolve: (v: { data: unknown; error: unknown }) => unknown) => {
      table.reads += 1;
      return Promise.resolve({ data: [...table.rows], error: null }).then(resolve);
    },
  };
  return {
    from: (_table: string) => chain,
  } as unknown as SupabaseClient;
}

describe("T-034 — SupabasePaymentRepository cache freshness (CROSS-104)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("DEFECT REPRODUCTION: another client's write is invisible inside the TTL but visible after it (no restart)", async () => {
    const table = { rows: [paymentRow("r1", 1_000)], reads: 0 };
    const repo = new SupabasePaymentRepository(makeCountingFakeClient(table));

    const obs = repo.observe();
    await flush();
    const first = obs.get();
    expect(first.map((p) => p.id)).toEqual(["r1"]);
    expect(table.reads).toBe(1);

    // Another client (Android/website/second desktop) writes a payment.
    table.rows.push(paymentRow("r2", 2_000));

    // Immediately re-observing: still within TTL → one cached snapshot.
    const cachedObs = repo.observe();
    await flush();
    const cached = cachedObs.get();
    expect(cached.map((p) => p.id)).toEqual(["r1"]);
    expect(table.reads).toBe(1);

    // Freshness budget elapses → the next observe re-seeds WITHOUT a restart.
    vi.advanceTimersByTime(30_001);
    const refreshedObs = repo.observe();
    await flush();
    const refreshed = refreshedObs.get();
    expect(refreshed.map((p) => p.id)).toEqual(["r1", "r2"]);
    expect(table.reads).toBe(2);
  });

  it("window-focus force refresh: the next observe re-seeds even inside the TTL", async () => {
    const table = { rows: [paymentRow("r1", 1_000)], reads: 0 };
    const repo = new SupabasePaymentRepository(makeCountingFakeClient(table));
    const obs1 = repo.observe();
    await flush();
    obs1.get();
    expect(table.reads).toBe(1);

    table.rows.push(paymentRow("r2", 2_000));
    table.rows.push(paymentRow("r3", 3_000));

    // Simulate the renderer window regaining focus (e.g. after Android wrote).
    repo["freshness"].forceRefresh();
    const refreshedObs = repo.observe();
    await flush();
    const refreshed = refreshedObs.get();
    expect(refreshed.map((p) => p.id)).toEqual(["r1", "r2", "r3"]);
    expect(table.reads).toBe(2);
  });

  it("repeated observes inside the TTL do NOT hammer the server (single read)", async () => {
    const table = { rows: [paymentRow("r1", 1_000)], reads: 0 };
    const repo = new SupabasePaymentRepository(makeCountingFakeClient(table));
    const o1 = repo.observe();
    await flush(); o1.get();
    const o2 = repo.observe();
    await flush(); o2.get();
    const o3 = repo.observe();
    await flush(); o3.get();
    expect(table.reads).toBe(1);
  });

  it("a FAILED seed no longer poisons the whole session (retries after the TTL)", async () => {
    const table = { rows: [paymentRow("r1", 1_000)], reads: 0 };
    const failingThenOk = {
      select: () => failingThenOk,
      eq: () => failingThenOk,
      order: () => failingThenOk,
      limit: () => failingThenOk,
      then: (resolve: (v: { data: unknown; error: unknown }) => unknown) => {
        table.reads += 1;
        const fail = table.reads === 1;
        return Promise.resolve(
          fail ? { data: null, error: { message: "network down" } } : { data: [...table.rows], error: null },
        ).then(resolve);
      },
    } as unknown as SupabaseClient;
    // The chain object is what `.from("payments")` returns — wrap it.
    const client = { from: () => failingThenOk } as unknown as SupabaseClient;
    const repo = new SupabasePaymentRepository(client);

    // Old behaviour: the failed seed set the boolean and cached [] forever.
    const failedObs = repo.observe();
    await flush();
    expect(failedObs.get()).toEqual([]);
    expect(table.reads).toBe(1);

    // Server recovers + TTL elapses → the cache recovers WITHOUT a restart.
    vi.advanceTimersByTime(30_001);
    const recoveredObs = repo.observe();
    await flush();
    const recovered = recoveredObs.get();
    expect(recovered.map((p) => p.id)).toEqual(["r1"]);
    expect(table.reads).toBe(2);
  });
});

describe("T-034 — CacheFreshness unit semantics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("TTL boundary: reseed allowed strictly after the TTL, not at it", () => {
    let now = 1_000;
    const f = new CacheFreshness(30_000, () => now, { addEventListener: () => {} });
    expect(f.shouldReseed()).toBe(true); // never seeded
    f.markSeeded();
    expect(f.shouldReseed()).toBe(false);
    now += 30_000;
    expect(f.shouldReseed()).toBe(false); // at the boundary — still fresh
    now += 1;
    expect(f.shouldReseed()).toBe(true);
  });

  it("forceRefresh applies to exactly one seed cycle", () => {
    const now = 1_000;
    const f = new CacheFreshness(30_000, () => now, { addEventListener: () => {} });
    f.markSeeded();
    f.forceRefresh();
    expect(f.shouldReseed()).toBe(true);
    f.markSeeded();
    expect(f.shouldReseed()).toBe(false); // consumed
  });

  it("registers a window focus listener when a window exists (freshness on focus)", () => {
    const listeners: Array<() => void> = [];
    const fakeWindow = { addEventListener: (type: string, l: () => void) => { if (type === "focus") listeners.push(l); } };
    const now = 1_000;
    const f = new CacheFreshness(30_000, () => now, fakeWindow as unknown as Window);
    f.markSeeded();
    expect(f.shouldReseed()).toBe(false);
    // The window regains focus → forced refresh.
    listeners.forEach((l) => l());
    expect(f.shouldReseed()).toBe(true);
  });
});
