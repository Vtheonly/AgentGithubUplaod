/**
 * T-192 / MSG-101 — the desktop debt-reminder delivery repair.
 *
 * The SupabaseDebtRepository's reminder actions NEVER delivered anything:
 *   1. broadcastReminders inserted notifications with NONEXISTENT columns
 *      (`type`, `entity_type`, `entity_id` — the table uses `kind`,
 *      `link_entity_type`, `link_entity_id`) → PostgREST 400, swallowed,
 *      counted as dispatched anyway.
 *   2. No target (target_user_id NULL) → even valid inserts were invisible
 *      to the debtor parent under notifications_select.
 *   3. sendReminder() was a literal no-op (Ok(undefined)).
 *   4. The audit call targeted the nonexistent `append_audit_entry` RPC.
 *
 * These tests pin the repaired contract:
 *   T1 broadcastReminders delegates to the canonical 0077
 *      `notify_parent_user` RPC per debtor (payload: kind alert, priority
 *      by age, source label, parent link, actor passthrough).
 *   T2 honest counting: only RPC-confirmed deliveries count
 *      (NULL = parent has no active portal account → undeliverable, NOT
 *      dispatched; RPC errors → NOT dispatched).
 *   T3 the bulk audit goes through the canonical `write_audit_log` RPC
 *      (0014) with the delivered/undeliverable split in after_json.
 *   T4 sendReminder(parentId) really sends (RPC call + Ok on a returned
 *      notification id).
 *   T5 sendReminder surfaces the undeliverable case (NULL → Err with the
 *      "no active portal account" message — never a silent Ok).
 *   T6 sendReminder validates the parentId BEFORE any RPC call.
 *   T7 source scans (regression guards): the repository file contains no
 *      domain-column raw notification insert (`type:`/`entity_type:`/
 *      `entity_id:` payload keys), no `append_audit_entry` call, and
 *      references `notify_parent_user` + `write_audit_log`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseDebtRepository } from "../../infrastructure/supabase/repositories/supabase-shared-repositories";
import * as fs from "node:fs";
import * as path from "node:path";

type Row = Record<string, any>;

const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "11111111-1111-4111-8111-111111111111";

// One overdue debtor (60 days, 45 000 DZD) + one fresh non-overdue row that
// must NOT be picked up.
const INSTALLMENTS: Row[] = [
  {
    parent_id: "22222222-2222-4222-8222-222222222221",
    amount_due: 50000,
    amount_paid: 5000,
    amount_pending: 0,
    due_date: new Date(Date.now() - 60 * 86_400_000).toISOString(),
  },
  {
    parent_id: "22222222-2222-4222-8222-222222222221",
    amount_due: 0,
    amount_paid: 0,
    amount_pending: 0,
    due_date: new Date(Date.now() + 86_400_000).toISOString(),
  },
];

interface FakeOpts {
  notifyResult?: string | null; // per-parent notification id (null = undeliverable)
  notifyError?: { message: string } | null;
}

function makeFakeClient(opts: FakeOpts): { client: unknown; rpcCalls: Array<{ fn: string; args: Row }> } {
  const rpcCalls: Array<{ fn: string; args: Row }> = [];
  const client = {
    rpc: vi.fn(async (fn: string, args?: Row) => {
      rpcCalls.push({ fn, args: args ?? {} });
      if (fn === "notify_parent_user") {
        if (opts.notifyError) return { data: null, error: opts.notifyError };
        return { data: opts.notifyResult ?? null, error: null };
      }
      return { data: null, error: null };
    }),
    from: vi.fn((table: string) => {
      if (table !== "installments") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          neq: () => ({
            lt: async () => ({ data: INSTALLMENTS, error: null }),
          }),
        }),
      };
    }),
  };
  return { client, rpcCalls };
}

beforeEach(() => {
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: TENANT, userId: ACTOR, displayName: "T-192 Tester" }),
  );
});

describe("T-192 / MSG-101 — broadcastReminders delivers via the canonical RPC", () => {
  it("T1: one notify_parent_user RPC per debtor with the correct payload", async () => {
    const { client, rpcCalls } = makeFakeClient({ notifyResult: "ntf-123" });
    const repo = new SupabaseDebtRepository(client as unknown as SupabaseClient);
    const res = await repo.broadcastReminders(0, ACTOR);
    expect(res.ok).toBe(true);
    expect((res as { value: number }).value).toBe(1);
    const notify = rpcCalls.filter((c) => c.fn === "notify_parent_user");
    expect(notify).toHaveLength(1);
    const args = notify[0].args;
    expect(args.p_parent_id).toBe("22222222-2222-4222-8222-222222222221");
    expect(args.p_kind).toBe("alert");
    expect(args.p_title).toContain("Rappel");
    expect(args.p_priority).toBe("high"); // 60 days ≤ 90 → high
    expect(args.p_source_label).toBe("Module Finances");
    expect(args.p_link_entity_type).toBe("parent");
    expect(args.p_link_entity_id).toBe("22222222-2222-4222-8222-222222222221");
    expect(args.p_actor_id).toBe(ACTOR);
    // Amount mirrors the remaining debt (45 000 DZD over 5 000 paid).
    expect(String(args.p_body)).toContain("45");
  });

  it("T2a: a NULL RPC result (no portal account) is NOT counted as dispatched", async () => {
    const { client, rpcCalls } = makeFakeClient({ notifyResult: null });
    const repo = new SupabaseDebtRepository(client as unknown as SupabaseClient);
    const res = await repo.broadcastReminders(0, ACTOR);
    expect(res.ok).toBe(true);
    expect((res as { value: number }).value).toBe(0);
    expect(rpcCalls.filter((c) => c.fn === "notify_parent_user")).toHaveLength(1);
  });

  it("T2b: an RPC error is NOT counted as dispatched", async () => {
    const { client } = makeFakeClient({ notifyError: { message: "42501 only staff" } });
    const repo = new SupabaseDebtRepository(client as unknown as SupabaseClient);
    const res = await repo.broadcastReminders(0, ACTOR);
    expect(res.ok).toBe(true);
    expect((res as { value: number }).value).toBe(0);
  });

  it("T3: the bulk audit goes through write_audit_log with the delivery split", async () => {
    const { client, rpcCalls } = makeFakeClient({ notifyResult: null });
    const repo = new SupabaseDebtRepository(client as unknown as SupabaseClient);
    await repo.broadcastReminders(0, ACTOR);
    const audit = rpcCalls.find((c) => c.fn === "write_audit_log");
    expect(audit).toBeDefined();
    expect(audit!.args.p_action).toBe("debt.broadcast_reminders");
    expect(audit!.args.p_after_json).toEqual({ dispatched: 0, undeliverable: 1, minDaysOverdue: 0 });
    expect(audit!.args.p_note).toContain("sans compte portail actif");
    expect(audit!.args.p_tenant_id).toBe(TENANT);
  });
});

describe("T-192 / MSG-101 — sendReminder really sends", () => {
  it("T4: delivers via the RPC and returns Ok when a notification id comes back", async () => {
    const { client, rpcCalls } = makeFakeClient({ notifyResult: "ntf-456" });
    const repo = new SupabaseDebtRepository(client as unknown as SupabaseClient);
    const res = await repo.sendReminder("22222222-2222-4222-8222-222222222221");
    expect(res.ok).toBe(true);
    const notify = rpcCalls.find((c) => c.fn === "notify_parent_user");
    expect(notify).toBeDefined();
    expect(notify!.args.p_parent_id).toBe("22222222-2222-4222-8222-222222222221");
    expect(notify!.args.p_title).toContain("Rappel");
  });

  it("T5: the undeliverable case (NULL) surfaces as an Err, never a silent Ok", async () => {
    const { client } = makeFakeClient({ notifyResult: null });
    const repo = new SupabaseDebtRepository(client as unknown as SupabaseClient);
    const res = await repo.sendReminder("22222222-2222-4222-8222-222222222221");
    expect(res.ok).toBe(false);
    const err = res as { error: { message: string } };
    expect(err.error.message).toContain("compte portail actif");
  });

  it("T6: a malformed parentId fails validation BEFORE any RPC call", async () => {
    const { client, rpcCalls } = makeFakeClient({ notifyResult: "ntf" });
    const repo = new SupabaseDebtRepository(client as unknown as SupabaseClient);
    const res = await repo.sendReminder("par-001");
    expect(res.ok).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("T-192 / MSG-101 — regression source scans (the defect class guards)", () => {
  const SRC = fs.readFileSync(
    path.resolve(__dirname, "../../infrastructure/supabase/repositories/supabase-shared-repositories.ts"),
    "utf8",
  );

  it("T7a: no raw notifications insert with the domain-style column names (the 400 class)", () => {
    // The broken insert sent `type:`/`entity_type:`/`entity_id:` payload keys
    // straight from the domain model. Any recurrence of that payload shape
    // inside a from("notifications") insert must fail this scan.
    expect(SRC).not.toMatch(/from\("notifications"\)[\s\S]{0,400}entity_type:/);
    expect(SRC).not.toMatch(/from\("notifications"\)[\s\S]{0,400}\btype:\s*"payment_overdue"/);
  });

  it("T7b: the nonexistent append_audit_entry RPC is gone (all audit via write_audit_log)", () => {
    expect(SRC).not.toContain('rpc("append_audit_entry"');
  });

  it("T7c: the repository references the canonical RPCs", () => {
    expect(SRC).toContain('rpc("notify_parent_user"');
    expect(SRC).toContain('rpc("write_audit_log"');
  });
});
