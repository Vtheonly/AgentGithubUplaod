/**
 * T-184 / ACT-202 — bind-activation-code structured-error surfacing tests.
 *
 * The defect (owner report 2026-09-05, the desktop half of "the activation
 * code is not working"): `SupabaseApprovalRepository.bindActivationCode`
 * consumed `functions.invoke`'s `{ data, error }` as if a non-2xx body
 * landed in `data` — but @supabase/functions-js (2.112.3, pinned by
 * node_modules inspection) returns `{ data: null, error:
 * FunctionsHttpError }` for EVERY non-2xx status. The hub EF responds with
 * the STRUCTURED body `{ error: { code, message } }` (the _shared/cors.ts
 * jsonError shape, live round-tripped by T-147), so every bind failure
 * collapsed into the generic "Function returned an error" — the staff could
 * not distinguish an invalid code from an expired one from an
 * already-bound family.
 *
 * Verified here:
 *   1. The desktop sends the EF's cross-platform body key `activation_code`.
 *   2. Each structured EF code (code_not_found / code_expired /
 *      parent_already_bound / account_already_active / account_suspended)
 *      maps to a PRECISE AppError category + the EF's real message.
 *   3. A context-less error (network class) still falls back to the
 *      supabaseErrorToAppError mapping — no regression on the generic path.
 *   4. A non-JSON / already-consumed context body falls back safely.
 *   5. The success path still unwraps `{ data: { data } }` (the jsonOk
 *      shape) — the pre-T-184 contract is preserved.
 *   6. Local format validation (6–7 digits) short-circuits before invoke.
 *
 * The fake client follows the t-099/t-145 convention (minimal surface),
 * extended with a functions.invoke recorder.
 */
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseApprovalRepository } from "../../infrastructure/supabase/repositories/supabase-approval-repository";

type Row = Record<string, unknown>;

/**
 * Build a FunctionsHttpError-shaped object the way functions-js 2.112.3
 * does: `message: "Function returned an error"`, `context: <raw Response>`,
 * and the response body carrying the hub EF's structured error.
 */
function efError(
  status: number,
  code: string,
  message: string,
): { message: string; context: Response } {
  const body = JSON.stringify({ error: { code, message, details: null } });
  return {
    message: "Function returned an error",
    context: new Response(body, {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  };
}

function makeFakeClient(opts: {
  invokeResult?:
    | { data: unknown; error: unknown }
    | { data: unknown; error: unknown }[];
}): { client: unknown; invokes: Array<{ fn: string; body: Row }> } {
  const invokes: Array<{ fn: string; body: Row }> = [];
  const queue = Array.isArray(opts.invokeResult)
    ? opts.invokeResult
    : opts.invokeResult
      ? [opts.invokeResult]
      : [];

  const client = {
    functions: {
      invoke: vi.fn(async (fn: string, options?: { body?: Row }) => {
        invokes.push({ fn, body: options?.body ?? {} });
        return queue.length > 0 ? queue.shift() : { data: null, error: null };
      }),
    },
  };
  return { client, invokes };
}

function asClient(client: unknown): SupabaseClient {
  return client as unknown as SupabaseClient;
}

describe("T-184 / ACT-202 — bindActivationCode structured-error surfacing", () => {
  it("sends the cross-platform body key activation_code to bind-activation-code", async () => {
    const { client, invokes } = makeFakeClient({
      invokeResult: {
        data: { data: { parent_id: "p1", parent_full_name: "Famille TEST", student_count: 2 } },
        error: null,
      },
    });
    const repo = new SupabaseApprovalRepository(asClient(client));

    const res = await repo.bindActivationCode("741852");

    expect(invokes).toHaveLength(1);
    expect(invokes[0].fn).toBe("bind-activation-code");
    expect(invokes[0].body).toEqual({ activation_code: "741852" });
    expect(res.ok).toBe(true);
  });

  it("unwraps the jsonOk { data: { data } } success shape (pre-T-184 contract preserved)", async () => {
    const { client } = makeFakeClient({
      invokeResult: {
        data: {
          data: { parent_id: "p1", parent_full_name: "Famille TEST", student_count: 2 },
        },
        error: null,
      },
    });
    const repo = new SupabaseApprovalRepository(asClient(client));

    const res = await repo.bindActivationCode("741852");

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toEqual({
      parent_id: "p1",
      parent_full_name: "Famille TEST",
      student_count: 2,
    });
  });

  it("maps code_not_found (404) to a precise validation error with the EF's real message", async () => {
    const { client } = makeFakeClient({
      invokeResult: {
        data: null,
        error: efError(404, "code_not_found", "Invalid or already-used activation code"),
      },
    });
    const repo = new SupabaseApprovalRepository(asClient(client));

    const res = await repo.bindActivationCode("000111");

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("ERR_VALIDATION");
    expect(res.error.message).toBe("Invalid or already-used activation code");
    expect(res.error.userMessage).toBe("Code d'activation invalide ou déjà utilisé.");
  });

  it("maps code_expired (410) to a validation error with the expiry message", async () => {
    const { client } = makeFakeClient({
      invokeResult: {
        data: null,
        error: efError(410, "code_expired", "Activation code has expired. Please contact the school office."),
      },
    });
    const repo = new SupabaseApprovalRepository(asClient(client));

    const res = await repo.bindActivationCode("000111");

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("ERR_VALIDATION");
    expect(res.error.message).toContain("expired");
  });

  it("maps parent_already_bound (409) to a conflict error", async () => {
    const { client } = makeFakeClient({
      invokeResult: {
        data: null,
        error: efError(
          409,
          "parent_already_bound",
          "This family profile is already linked to another account. Contact the school office.",
        ),
      },
    });
    const repo = new SupabaseApprovalRepository(asClient(client));

    const res = await repo.bindActivationCode("000111");

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("ERR_CONFLICT");
    expect(res.error.message).toContain("already linked");
  });

  it("maps account_already_active (409, ADR-011 idempotent) to a conflict with the no-action message", async () => {
    const { client } = makeFakeClient({
      invokeResult: {
        data: null,
        error: efError(409, "account_already_active", "Account is already active."),
      },
    });
    const repo = new SupabaseApprovalRepository(asClient(client));

    const res = await repo.bindActivationCode("000111");

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("ERR_CONFLICT");
    expect(res.error.userMessage).toContain("déjà actif");
  });

  it("maps account_suspended (403) to a forbidden error", async () => {
    const { client } = makeFakeClient({
      invokeResult: {
        data: null,
        error: efError(403, "account_suspended", "This account is suspended. Contact the school administration."),
      },
    });
    const repo = new SupabaseApprovalRepository(asClient(client));

    const res = await repo.bindActivationCode("000111");

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("ERR_FORBIDDEN");
  });

  it("falls back to the generic mapping when the error carries no context (network class)", async () => {
    const { client } = makeFakeClient({
      invokeResult: { data: null, error: { message: "fetch failed" } },
    });
    const repo = new SupabaseApprovalRepository(asClient(client));

    const res = await repo.bindActivationCode("000111");

    expect(res.ok).toBe(false);
    if (res.ok) return;
    // supabaseErrorToAppError("fetch failed") → ERR_NETWORK
    expect(res.error.code).toBe("ERR_NETWORK");
  });

  it("falls back safely when the context body is not the structured shape", async () => {
    const { client } = makeFakeClient({
      invokeResult: {
        data: null,
        error: {
          message: "Function returned an error",
          context: new Response("plain text crash", { status: 500 }),
        },
      },
    });
    const repo = new SupabaseApprovalRepository(asClient(client));

    const res = await repo.bindActivationCode("000111");

    expect(res.ok).toBe(false);
    if (res.ok) return;
    // Non-JSON body → structured extraction null → generic path.
    expect(["ERR_SERVER", "ERR_UNKNOWN"]).toContain(res.error.code);
  });

  it("short-circuits malformed codes locally (no EF round-trip)", async () => {
    const { client, invokes } = makeFakeClient({});
    const repo = new SupabaseApprovalRepository(asClient(client));

    const res = await repo.bindActivationCode("12345");

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("ERR_VALIDATION");
    expect(invokes).toHaveLength(0);
  });
});
