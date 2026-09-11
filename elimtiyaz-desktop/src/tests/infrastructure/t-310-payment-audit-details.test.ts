/**
 * T-310 — AUDIT-502 payment-audit detail recovery suite (49th session,
 * 2026-09-12).
 *
 * The owner's report: "There is a problem with the payment audit … the
 * audit is not bringing up the payment details correctly." Live evidence
 * (2026-09-12): every `payment.collect` row carries before_json = NULL,
 * after_json = NULL and the full payment result ONLY in the legacy `diff`
 * column — a column mapAuditRow never read. The drawer rendered
 * "structurally identical" for every payment entry.
 *
 * This suite pins the mapper fallback (mapAuditRow in
 * supabase-audit-log-repository.ts) against the EXACT live row shapes:
 *   - payment.collect  (0034 RPC): flat diff object    → AFTER state
 *   - payment.refund   (0034 RPC): wrapped {before,after} → unwrapped
 *   - parent.update    (0086 trigger): canonical before/after → unchanged
 *   - canonical + legacy both present → canonical WINS
 *   - string-encoded diff (defensive) → parsed
 *   - everything null → diff stays null
 */
import { describe, it, expect } from "vitest";
import { SupabaseAuditLogRepository } from "../../infrastructure/supabase/repositories/supabase-audit-log-repository";
import type { AuditEntry } from "../../domain/model/audit";

/* ------------------------------------------------------------------ */
/* Harness: the t-282 chainable fake client (single queued result)     */
/* ------------------------------------------------------------------ */

function makeAuditClient(rows: unknown[]) {
  const from = (table: string): Record<string, unknown> => {
    if (table !== "audit_logs") throw new Error(`unexpected table ${table}`);
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "limit", "range", "ilike", "gte", "lte"]) {
      builder[method] = () => builder;
    }
    builder.then = (
      onFulfilled: (v: unknown) => unknown,
      _onRejected?: (e: unknown) => unknown,
    ) =>
      Promise.resolve({ data: rows, error: null, count: rows.length }).then(
        onFulfilled,
      );
    return builder;
  };
  return { from } as unknown as ConstructorParameters<typeof SupabaseAuditLogRepository>[0];
}

const BASE = {
  tenant_id: "00000000-0000-0000-0000-000000000001",
  actor_id: "dac9c821-22a3-4edb-857c-6c4414199d2e",
  actor_name: "dac9c821-22a3-4edb-857c-6c4414199d2e",
  actor_role: null,
  entity_type: "payment",
  note: null,
  ip_address: null,
  user_agent: null,
  occurred_at: "2026-09-11T19:35:57.439347+00:00",
  created_at: "2026-09-11T19:35:57.439347+00:00",
};

// The EXACT live payment.collect row (captured 2026-09-12, anonymized IDs).
const COLLECT_ROW = {
  ...BASE,
  id: "8355d21b-f721-4469-bf5f-33a41979b3a1",
  action: "payment.collect",
  entity_id: "07fc79e5-90f6-4b68-8b17-13ec1364ee6a",
  before_json: null,
  after_json: null,
  diff: {
    amount: 152500,
    method: "cash",
    status: "paid",
    receipt: "REC-2026-000001",
    allocations: [],
    unallocatedCredit: 152500,
  },
};

// A wrapped payment.refund row (the 0034 revert RPC's shape).
const REFUND_ROW = {
  ...BASE,
  id: "8355d21b-f721-4469-bf5f-33a41979b3a2",
  action: "payment.refund",
  entity_id: "07fc79e5-90f6-4b68-8b17-13ec1364ee6b",
  before_json: null,
  after_json: null,
  diff: {
    before: { status: "paid" },
    after: { status: "refunded", totalReverted: 152500, revertsCount: 3 },
  },
};

// A canonical 0086-trigger row (full snapshots, no legacy diff).
const TRIGGER_ROW = {
  ...BASE,
  id: "18328edc-5f8d-4be3-bdea-f5d2b2dd16e3",
  action: "parent.update",
  entity_type: "parent",
  entity_id: "75b47b59-459d-4dc5-9887-26007c276b11",
  actor_name: "admin@elimtiyaz.dz",
  actor_role: "super_admin",
  before_json: { first_name: "right now _T306", last_name: "right now " },
  after_json: { first_name: "right now ", last_name: "right now " },
  diff: null,
};

async function recent(client: ReturnType<typeof makeAuditClient>): Promise<AuditEntry[]> {
  const repo = new SupabaseAuditLogRepository(client);
  const result = await repo.recent(50);
  expect(result.ok).toBe(true);
  return result.ok ? result.value : [];
}

function parsedDiff(e: AuditEntry): { before: unknown; after: unknown } {
  expect(e.diff).toBeTruthy();
  return JSON.parse(e.diff as string) as { before: unknown; after: unknown };
}

/* ================================================================ */
/* 1. payment.collect — the flat `diff` object becomes the AFTER     */
/*    state (INSERT semantics: green added rows in the drawer)      */
/* ================================================================ */

describe("T-310 — payment.collect details recovered from the legacy diff column", () => {
  it("the flat result object maps to the AFTER state (before stays null)", async () => {
    const entries = await recent(makeAuditClient([COLLECT_ROW]));
    const { before, after } = parsedDiff(entries[0]);
    expect(before).toBeNull();
    // Every payment detail the owner reported missing is now present.
    expect(after).toEqual({
      amount: 152500,
      method: "cash",
      status: "paid",
      receipt: "REC-2026-000001",
      allocations: [],
      unallocatedCredit: 152500,
    });
  });

  it("the recovered payload renders field rows (green added — drawer-ready)", async () => {
    const entries = await recent(makeAuditClient([COLLECT_ROW]));
    // The drawer's exact pipeline: parseAuditDiff → computeFieldDiff → rows.
    const { computeFieldDiff, flattenDiffRows } = await import(
      "../../domain/calc/diff/field-diff"
    );
    const { before, after } = parsedDiff(entries[0]);
    const rows = flattenDiffRows(computeFieldDiff(before, after));
    expect(rows.length).toBe(6); // amount, method, status, receipt, allocations, unallocatedCredit
    expect(rows.every((r) => r.kind === "added")).toBe(true);
    const receipt = rows.find((r) => r.field === "receipt");
    expect(receipt?.newDisplay).toContain("REC-2026-000001");
  });

  it("actor attribution survives the mapping (id + name + role fields)", async () => {
    const entries = await recent(makeAuditClient([COLLECT_ROW]));
    expect(entries[0].actorId).toBe(BASE.actor_id);
    expect(entries[0].actorName).toBe(BASE.actor_name);
    expect(entries[0].actorRole).toBeNull();
  });
});

/* ================================================================ */
/* 2. payment.refund — the wrapped {before, after} diff unwraps     */
/* ================================================================ */

describe("T-310 — payment.refund wrapped diff unwraps to the snapshots", () => {
  it("before/after map to the wrapped object's fields", async () => {
    const entries = await recent(makeAuditClient([REFUND_ROW]));
    const { before, after } = parsedDiff(entries[0]);
    expect(before).toEqual({ status: "paid" });
    expect(after).toEqual({ status: "refunded", totalReverted: 152500, revertsCount: 3 });
  });

  it("the unwrapped refund diff renders a red removed + green added pair", async () => {
    const entries = await recent(makeAuditClient([REFUND_ROW]));
    const { computeFieldDiff, flattenDiffRows } = await import(
      "../../domain/calc/diff/field-diff"
    );
    const { before, after } = parsedDiff(entries[0]);
    const rows = flattenDiffRows(computeFieldDiff(before, after));
    const status = rows.find((r) => r.field === "status");
    expect(status?.kind).toBe("changed");
    expect(status?.oldDisplay).toContain("paid");
    expect(status?.newDisplay).toContain("refunded");
  });
});

/* ================================================================ */
/* 3. Canonical columns win / regression guards                     */
/* ================================================================ */

describe("T-310 — canonical snapshots + regression guards", () => {
  it("0086-trigger rows (full before/after, no legacy diff) map unchanged", async () => {
    const entries = await recent(makeAuditClient([TRIGGER_ROW]));
    const { before, after } = parsedDiff(entries[0]);
    expect(before).toEqual(TRIGGER_ROW.before_json);
    expect(after).toEqual(TRIGGER_ROW.after_json);
    expect(entries[0].actorName).toBe("admin@elimtiyaz.dz");
    expect(entries[0].actorRole).toBe("super_admin");
  });

  it("canonical columns WIN when the legacy diff also exists", async () => {
    const row = {
      ...COLLECT_ROW,
      before_json: { amount: 100 },
      after_json: { amount: 152500 },
    };
    const entries = await recent(makeAuditClient([row]));
    const { before, after } = parsedDiff(entries[0]);
    expect(before).toEqual({ amount: 100 });
    expect(after).toEqual({ amount: 152500 });
  });

  it("a string-encoded legacy diff (defensive) parses to the AFTER state", async () => {
    const row = {
      ...COLLECT_ROW,
      diff: JSON.stringify({ amount: 5, method: "cash", status: "paid", receipt: "R", allocations: [], unallocatedCredit: 0 }),
    };
    const entries = await recent(makeAuditClient([row]));
    const { before, after } = parsedDiff(entries[0]);
    expect(before).toBeNull();
    expect((after as { amount: number }).amount).toBe(5);
  });

  it("a malformed string-encoded diff never throws (raw string becomes the AFTER)", async () => {
    const row = { ...COLLECT_ROW, diff: "not-json{{{" };
    const entries = await recent(makeAuditClient([row]));
    const { after } = parsedDiff(entries[0]);
    expect(after).toBe("not-json{{{");
  });

  it("everything null → diff stays null (the honest no-details row)", async () => {
    const row = { ...COLLECT_ROW, diff: null };
    const entries = await recent(makeAuditClient([row]));
    expect(entries[0].diff).toBeNull();
  });
});
