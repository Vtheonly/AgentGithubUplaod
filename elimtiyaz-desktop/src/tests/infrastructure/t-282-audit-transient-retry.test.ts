/**
 * T-282 — OPS-311 audit-read transient-retry suite (43rd session, 2026-09-10).
 *
 * The owner's production console showed an INTERMITTENT HTTP 500 on
 * `audit_logs?order=occurred_at.desc&limit=200` at app start (2026-09-09
 * 20:32, 2026-09-10 11:15 — the OPS-309 residual (a), "not reproducible").
 * Live-probed: the exact query returns 200 with 161 small rows — a
 * transient server-side blip under the startup query burst, not a query
 * defect. The fix: ONE short-delay retry on the three audit READ paths;
 * the write path (`log`) is never blindly retried.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SupabaseAuditLogRepository } from "../../infrastructure/supabase/repositories/supabase-audit-log-repository";

/* ------------------------------------------------------------------ */
/*  Harness: a chainable + thenable fake supabase query builder        */
/*  (each await consumes the NEXT queued result — awaiting the same    */
/*  builder twice, exactly like the retry wrapper does)                */
/* ------------------------------------------------------------------ */

interface QueuedResult {
  data?: unknown[] | null;
  error?: unknown;
  count?: number | null;
}

function makeAuditClient(results: QueuedResult[]) {
  let awaited = 0;
  const from = (table: string): Record<string, unknown> => {
    if (table !== "audit_logs") throw new Error(`unexpected table ${table}`);
    const builder: Record<string, unknown> = {};
    for (const method of [
      "select",
      "eq",
      "order",
      "limit",
      "range",
      "ilike",
      "gte",
      "lte",
    ]) {
      builder[method] = () => builder;
    }
    builder.then = (
      onFulfilled: (v: unknown) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => {
      const r = results[Math.min(awaited, results.length - 1)] ?? {
        data: null,
        error: null,
      };
      awaited++;
      return Promise.resolve({
        data: r.data ?? null,
        error: r.error ?? null,
        count: r.count ?? null,
      }).then(onFulfilled, onRejected);
    };
    return builder;
  };
  return {
    client: { from } as unknown as ConstructorParameters<
      typeof SupabaseAuditLogRepository
    >[0],
    attempts: () => awaited,
  };
}

const TRANSIENT = { message: "Unexpected token < in JSON", code: "PGRST000" };
const ROW = {
  id: "1b6d9c3e-0000-4000-8000-000000000001",
  tenant_id: "00000000-0000-0000-0000-000000000001",
  action: "ai.config_update",
  entity_type: "ai_config",
  entity_id: null,
  actor_id: "0a3597e7-9681-48b1-bd32-0360c7981d1e",
  actor_name: "Admin",
  note: null,
  before_json: null,
  after_json: null,
  ip_address: null,
  user_agent: null,
  occurred_at: "2026-09-10T11:16:15.368Z",
  created_at: "2026-09-10T11:16:15.368Z",
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/* ================================================================
 * 1. recent() — the OWNER-OBSERVED failing query (search index feed)
 * ================================================================ */

describe("T-282 — recent() absorbs the transient 5xx (OPS-311)", () => {
  it("first attempt errors → ONE delayed retry → success, exactly 2 attempts", async () => {
    const { client, attempts } = makeAuditClient([
      { error: TRANSIENT },
      { data: [ROW], count: 1 },
    ]);
    const repo = new SupabaseAuditLogRepository(client);

    const pending = repo.recent(200);
    // Inside the retry delay — not yet resolved, not yet re-queried.
    await vi.advanceTimersByTimeAsync(50);
    expect(attempts()).toBe(1);
    await vi.advanceTimersByTimeAsync(600);

    const result = await pending;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].action).toBe("ai.config_update");
    }
    expect(attempts()).toBe(2);
  });

  it("a PERSISTENT error surfaces after exactly one retry (never a third attempt)", async () => {
    const { client, attempts } = makeAuditClient([{ error: TRANSIENT }]);
    const repo = new SupabaseAuditLogRepository(client);

    const pending = repo.recent(200);
    await vi.advanceTimersByTimeAsync(800);
    const result = await pending;

    expect(result.ok).toBe(false);
    expect(attempts()).toBe(2);
  });

  it("a clean first attempt NEVER pays the retry delay", async () => {
    const { client, attempts } = makeAuditClient([{ data: [ROW] }]);
    const repo = new SupabaseAuditLogRepository(client);

    const result = await repo.recent(8);
    expect(result.ok).toBe(true);
    expect(attempts()).toBe(1);
  });
});

/* ================================================================
 * 2. byEntity() + query() — the same contract
 * ================================================================ */

describe("T-282 — byEntity() / query() share the transient-retry contract", () => {
  it("byEntity retries the transient error and returns the rows", async () => {
    const { client, attempts } = makeAuditClient([
      { error: TRANSIENT },
      { data: [ROW] },
    ]);
    const repo = new SupabaseAuditLogRepository(client);

    const pending = repo.byEntity("ai_config", "1b6d9c3e-0000-4000-8000-000000000001");
    await vi.advanceTimersByTimeAsync(700);
    const result = await pending;

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
    expect(attempts()).toBe(2);
  });

  it("query() retries and PRESERVES the count/hasMore pagination shape", async () => {
    const { client, attempts } = makeAuditClient([
      { error: TRANSIENT },
      { data: [ROW], count: 161 },
    ]);
    const repo = new SupabaseAuditLogRepository(client);

    const pending = repo.query({ limit: 1, offset: 0 });
    await vi.advanceTimersByTimeAsync(700);
    const result = await pending;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.total).toBe(161);
      expect(result.value.hasMore).toBe(true);
      expect(result.value.entries).toHaveLength(1);
    }
    expect(attempts()).toBe(2);
  });
});
