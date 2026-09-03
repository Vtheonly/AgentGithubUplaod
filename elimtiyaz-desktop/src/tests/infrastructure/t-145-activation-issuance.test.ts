/**
 * T-145 / ACT-200 — activation-code issuance persistence tests.
 *
 * The live defect (owner report 2026-09-03, "the activation code is
 * rejected as already been used"): the desktop issued 5 codes (audit logs
 * prove it) yet `activation_codes` held 0 rows — every parent received a
 * phantom deterministic fallback code that could never validate.
 *
 * Root cause layers verified here:
 *
 *   1. `SupabaseApprovalRepository.generateActivationCode` MUST include
 *      `tenant_id` in the activation_codes INSERT (NOT NULL, no default —
 *      omitting it is a guaranteed constraint violation). It must also
 *      resolve the tenant ONCE and propagate RPC/insert failures as Err
 *      with the real message (never a silent Ok).
 *   2. A tenantless session (current_tenant_id returns null) is an Err —
 *      not a fallthrough that would produce another phantom code path.
 *
 * The fake client follows the t-099 convention (minimal PostgREST builder
 * surface), extended with an rpc() recorder so the INSERT payload can be
 * asserted field-by-field.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseApprovalRepository } from "../../infrastructure/supabase/repositories/supabase-approval-repository";

type Row = Record<string, unknown>;

// ============================================================================
// Fake Supabase client — minimal surface for this repository's needs
// ============================================================================

class FakeInsertBuilder {
  constructor(
    private readonly insertRecorder: (payload: Row) => void,
    private readonly failInsert: boolean,
  ) {}

  insert(payload: Row): this {
    this.insertRecorder(payload);
    return this;
  }

  select(): this {
    return this;
  }

  async then(
    resolve: (v: unknown) => void,
    _reject: (e: unknown) => void,
  ): Promise<void> {
    if (this.failInsert) {
      resolve({
        data: null,
        error: {
          message:
            'null value in column "tenant_id" of relation "activation_codes" violates not-null constraint',
          code: "23502",
        },
      });
      return;
    }
    resolve({ data: null, error: null });
  }
}

function makeFakeClient(opts: {
  tenantId: string | null;
  profileId: string | null;
  generatedCode?: string | null;
  generateError?: { message: string } | null;
  failInsert?: boolean;
}): { client: unknown; inserts: Row[] } {
  const inserts: Row[] = [];
  const rpcCalls: Array<{ fn: string; args: Row }> = [];

  const client = {
    rpc: vi.fn(async (fn: string, args?: Row) => {
      rpcCalls.push({ fn, args: args ?? {} });
      if (fn === "current_tenant_id") {
        return { data: opts.tenantId, error: null };
      }
      if (fn === "current_user_profile_id") {
        return { data: opts.profileId, error: null };
      }
      if (fn === "generate_activation_code") {
        if (opts.generateError) {
          return { data: null, error: opts.generateError };
        }
        return { data: opts.generatedCode, error: null };
      }
      return { data: null, error: null };
    }),
    from: vi.fn((table: string) => {
      expect(table).toBe("activation_codes");
      return new FakeInsertBuilder(
        (p) => inserts.push(p),
        opts.failInsert ?? false,
      );
    }),
    __rpcCalls: rpcCalls,
  };
  return { client, inserts };
}

function asClient(client: unknown): SupabaseClient {
  return client as unknown as SupabaseClient;
}

describe("T-145 / ACT-200 — SupabaseApprovalRepository.generateActivationCode", () => {
  const PARENT_ID = "11111111-1111-4111-8111-111111111111";
  const TENANT_ID = "22222222-2222-4222-8222-222222222222";
  const PROFILE_ID = "33333333-3333-4333-8333-333333333333";

  it("includes tenant_id in the activation_codes INSERT (the pre-fix insert always violated NOT NULL)", async () => {
    const { client, inserts } = makeFakeClient({
      tenantId: TENANT_ID,
      profileId: PROFILE_ID,
      generatedCode: "741852",
    });
    const repo = new SupabaseApprovalRepository(asClient(client));

    const res = await repo.generateActivationCode(PARENT_ID);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toBe("741852");
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      tenant_id: TENANT_ID,
      parent_id: PARENT_ID,
      code: "741852",
      issued_by: PROFILE_ID,
    });
    expect(typeof inserts[0].expires_at).toBe("string");
  });

  it("propagates the INSERT failure as Err with the real message (no silent Ok, no phantom code)", async () => {
    const { client, inserts } = makeFakeClient({
      tenantId: TENANT_ID,
      profileId: PROFILE_ID,
      generatedCode: "741852",
      failInsert: true,
    });
    const repo = new SupabaseApprovalRepository(asClient(client));

    const res = await repo.generateActivationCode(PARENT_ID);

    expect(res.ok).toBe(false);
    // The insert was ATTEMPTED (with the right payload shape)…
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ tenant_id: TENANT_ID, parent_id: PARENT_ID });
    // …and the failure surfaces the DB's message.
    if (res.ok) return;
    expect(String((res.error as { message?: string }).message ?? "")).toContain("tenant_id");
  });

  it("propagates the RPC failure as Err (generate_activation_code error)", async () => {
    const { client, inserts } = makeFakeClient({
      tenantId: TENANT_ID,
      profileId: PROFILE_ID,
      generateError: { message: "function public.generate_activation_code does not exist" },
    });
    const repo = new SupabaseApprovalRepository(asClient(client));

    const res = await repo.generateActivationCode(PARENT_ID);

    expect(res.ok).toBe(false);
    // No INSERT must be attempted after the RPC failed — otherwise a
    // null code row could be written.
    expect(inserts).toHaveLength(0);
  });

  it("rejects a tenantless session (current_tenant_id null) before any code generation", async () => {
    const { client, inserts } = makeFakeClient({
      tenantId: null,
      profileId: PROFILE_ID,
      generatedCode: "741852",
    });
    const repo = new SupabaseApprovalRepository(asClient(client));

    const res = await repo.generateActivationCode(PARENT_ID);

    expect(res.ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("tolerates a missing issuer profile (issued_by null) — the code itself is still persisted", async () => {
    const { client, inserts } = makeFakeClient({
      tenantId: TENANT_ID,
      profileId: null,
      generatedCode: "963852",
    });
    const repo = new SupabaseApprovalRepository(asClient(client));

    const res = await repo.generateActivationCode(PARENT_ID);

    expect(res.ok).toBe(true);
    expect(inserts[0]).toMatchObject({
      tenant_id: TENANT_ID,
      code: "963852",
      issued_by: null,
    });
  });
});
