/**
 * T-432 (PERF-509, the live 500-storm report) — the collection-RPC
 * in-flight dedupe.
 *
 * The owner's live console showed the boot storm hitting the SAME RPC three
 * times at once (read_installments_collection 500 × 3: the dashboard KPIs,
 * the aging chart and the finance seeds each issuing a full SECURITY
 * DEFINER scan of the tenant's schedule within the same tick). The dedupe
 * shares ONE underlying request among concurrent callers of the same
 * function — and ONLY the in-flight window: a completed read is never
 * reused (zero staleness by construction).
 */
import { describe, expect, it, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  callCollectionRpc,
  __clearInflightCollectionRpcsForTests,
} from "../../infrastructure/supabase/repositories/supabase-shared-repositories";

interface FakeState {
  calls: number;
  mode: "ok" | "transient";
}

function fakeClientWithCounter(): { client: unknown; state: FakeState } {
  const state: FakeState = { calls: 0, mode: "ok" };
  const client = {
    async rpc(_fn: string): Promise<{ data: unknown[] | null; error: { code?: string; message?: string } | null }> {
      state.calls += 1;
      await new Promise((r) => setTimeout(r, 5));
      if (state.mode === "transient") {
        return { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
      }
      return { data: [{ id: "r1" }, { id: "r2" }], error: null };
    },
  };
  return { client, state };
}

const asClient = (c: unknown) => c as SupabaseClient;

describe("T-432 (PERF-509) — the collection-RPC in-flight dedupe", () => {
  beforeEach(() => {
    __clearInflightCollectionRpcsForTests();
  });

  it("two concurrent calls of the SAME function share ONE underlying request (the boot-storm collapse)", async () => {
    const { client, state } = fakeClientWithCounter();
    const [a, b] = await Promise.all([
      callCollectionRpc(asClient(client), "read_installments_collection"),
      callCollectionRpc(asClient(client), "read_installments_collection"),
    ]);
    expect(state.calls).toBe(1);
    expect(a).toEqual([{ id: "r1" }, { id: "r2" }]);
    expect(b).toEqual(a);
  });

  it("a COMPLETED read is never reused — the next call issues a fresh request (no result caching)", async () => {
    const { client, state } = fakeClientWithCounter();
    await callCollectionRpc(asClient(client), "read_installments_collection");
    await callCollectionRpc(asClient(client), "read_installments_collection");
    expect(state.calls).toBe(2);
  });

  it("different functions do not dedupe against each other", async () => {
    const { client, state } = fakeClientWithCounter();
    await Promise.all([
      callCollectionRpc(asClient(client), "read_installments_collection"),
      callCollectionRpc(asClient(client), "read_payments_collection"),
    ]);
    expect(state.calls).toBe(2);
  });

  it("a transient failure propagates to every awaiter (each caller's own retry ladder handles it)", async () => {
    const { client, state } = fakeClientWithCounter();
    state.mode = "transient";
    const [a, b] = await Promise.allSettled([
      callCollectionRpc(asClient(client), "read_installments_collection"),
      callCollectionRpc(asClient(client), "read_installments_collection"),
    ]);
    expect(state.calls).toBe(1);
    expect(a.status).toBe("rejected");
    expect(b.status).toBe("rejected");
  });

  it("the version-skew class still classifies to null (the caller falls back to the direct read)", async () => {
    const client = {
      async rpc(_fn: string) {
        return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
      },
    };
    const rows = await callCollectionRpc<{ id: string }>(asClient(client), "read_payments_collection");
    expect(rows).toBeNull();
  });
});
