/**
 * T-416 A (issue #12 / ADR-027) — the purge repository client contract.
 *
 * Pins the desktop half of the RPC call: the dry-run/execute payloads, the
 * verdict mapping, the gate rejections → precise French messages (the
 * T-153 precise-error-mapping lesson), the transport-error mapping, the
 * not-configured honest failure, and the single-shot discipline for the
 * destructive call (no idempotent retry — a lost RESPONSE on a committed
 * destructive op must surface, not silently re-fire).
 *
 * Run:
 *   npx vitest run src/tests/infrastructure/t-416-purge-repository.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../infrastructure/supabase/supabase-client", () => ({
  isSupabaseConfigured: vi.fn(() => true),
  getSupabaseClient: vi.fn(),
}));

import { isSupabaseConfigured, getSupabaseClient } from "../../infrastructure/supabase/supabase-client";
import {
  dryRunPurge,
  executePurge,
  PURGE_REJECTION_MESSAGES_FR,
} from "../../infrastructure/supabase/repositories/supabase-purge-repository";

const mockedConfigured = vi.mocked(isSupabaseConfigured);
const mockedClient = vi.mocked(getSupabaseClient);

const VERDICT = {
  ok: true,
  mode: "dry_run" as const,
  tenant_id: "00000000-0000-0000-0000-000000000001",
  counts: { parents: 196, students: 290, payments: 3, sync_queue_domain: 2 },
  total: 491,
  preserved: {
    backup_archives: "untouched",
    sync_queue_other: 7,
    audit_logs: "append_only",
    academic_catalog: "untouched",
    workforce_operations: "untouched",
  },
  audit_entry_id: null,
};

const EXECUTED_VERDICT = {
  ...VERDICT,
  mode: "executed" as const,
  audit_entry_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
};

type RpcArgs = Record<string, unknown>;

function makeFakeClient(reply: unknown, calls: RpcArgs[] = []) {
  return {
    rpc: vi.fn(async (_name: string, args: RpcArgs) => {
      calls.push(args);
      return reply;
    }),
  };
}

describe("T-416 A — the purge repository client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedConfigured.mockReturnValue(true);
  });

  it("dryRunPurge sends the read-only payload (empty phrase, p_dry_run:true, tenant from caller context)", async () => {
    const calls: RpcArgs[] = [];
    mockedClient.mockReturnValue(makeFakeClient({ data: VERDICT, error: null }, calls) as never);
    const r = await dryRunPurge();
    expect(r.ok).toBe(true);
    expect(calls).toEqual([
      { p_confirm_phrase: "", p_dry_run: true, p_tenant_id: null },
    ]);
  });

  it("executePurge sends the typed phrase with p_dry_run:false", async () => {
    const calls: RpcArgs[] = [];
    mockedClient.mockReturnValue(makeFakeClient({ data: EXECUTED_VERDICT, error: null }, calls) as never);
    const r = await executePurge("PURGER");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.audit_entry_id).toBeTruthy();
    expect(calls).toEqual([
      { p_confirm_phrase: "PURGER", p_dry_run: false, p_tenant_id: null },
    ]);
  });

  it("maps every server gate rejection to its precise French message", async () => {
    for (const code of ["forbidden", "tenant_unresolved", "invalid_tenant", "confirmation_required"] as const) {
      mockedClient.mockReturnValue(makeFakeClient({ data: { ok: false, code }, error: null }) as never);
      const r = await executePurge("WRONG");
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.serverCode).toBe(code);
        expect(r.error.userMessage).toBe(PURGE_REJECTION_MESSAGES_FR[code]);
      }
    }
  });

  it("maps a transport error to an Err with the server code attached", async () => {
    mockedClient.mockReturnValue(
      makeFakeClient({ data: null, error: { code: "42501", message: "RLS" } }) as never,
    );
    const r = await dryRunPurge();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.serverCode).toBe("42501");
  });

  it("fails honestly when Supabase is not configured (mock mode has no server data)", async () => {
    mockedConfigured.mockReturnValue(false);
    const r = await dryRunPurge();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("ERR_NOT_CONFIGURED");
      expect(r.error.userMessage).toContain("mode Supabase");
    }
  });

  it("fails honestly when the RPC returns no verdict", async () => {
    mockedClient.mockReturnValue(makeFakeClient({ data: null, error: null }) as never);
    const r = await dryRunPurge();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("ERR_PURGE_EMPTY");
  });

  it("does NOT retry the destructive call on transport failure (single-shot discipline)", async () => {
    const calls: RpcArgs[] = [];
    const client = {
      rpc: vi.fn(async (_n: string, args: RpcArgs) => {
        calls.push(args);
        return { data: null, error: { message: "network blip" } };
      }),
    };
    mockedClient.mockReturnValue(client as never);
    const r = await executePurge("PURGER");
    expect(r.ok).toBe(false);
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });
});
