/**
 * T-264 / OPS-309 — approval-queue 406-console-noise regression tests.
 *
 * The defect (owner report 2026-09-09 20:36, production console at app
 * launch): SupabaseApprovalRepository.listPending() enriches every pending
 * approval request via findPotentialMatches(), which fired up to five
 * `.single()` lookups per request (activation_codes by code, parents by
 * id / email / national_id / phone). `.single()` ERRORS on zero rows
 * (PostgREST 406 PGRST116 "JSON object requested, multiple (or no) rows
 * returned") — and zero rows is the COMMON case (most pending web
 * registrations have no matching parent yet). The repository already
 * treated "error or null" as no-match (only `data` is destructured), so
 * the approval queue WORKED — but every refresh spammed ~15 red 406s
 * into the production console (`…bound_to_auth_user_id=is.null → 406`,
 * `…auth_user_id=is.null → 406`).
 *
 * Verified here:
 *   1. Zero-row `.maybeSingle()` lookups ({ data: null, error: null })
 *      surface NO error: listPending stays Ok() with `parent_match: null`
 *      — the fall-through semantics preserved (the enrichment contract is
 *      byte-identical to the pre-T-264 behaviour, minus the console noise).
 *   2. The activation-code canonical path still enriches when a match
 *      exists (codeRow → parent lookup → parent_match returned).
 *   3. The >1-row `.maybeSingle()` error case still falls through to the
 *      next matching strategy (email/national_id/phone) — no crash, no
 *      surfaced error, `parent_match: null`.
 *   4. The email fallback path still enriches when the parents lookup
 *      succeeds after the activation-code path found nothing.
 *   5. Source guards: no `.single();` call remains in the approval
 *      repository (only `.maybeSingle()`), and the four `.is(..., null)`
 *      null-filters are preserved verbatim (they encode "not already
 *      bound" — binding semantics, not noise).
 *
 * The fake client follows the t-099/t-145/t-184 convention (minimal
 * surface), extended with a per-table result map + call recorder.
 */
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { SupabaseApprovalRepository } from "../../infrastructure/supabase/repositories/supabase-approval-repository";
import type { AccountApprovalRequestRow } from "../../infrastructure/supabase/types";

type QueryResult = { data: unknown; error: unknown };

interface RecordedFilter {
  table: string;
  eq?: Record<string, unknown>;
  is?: Record<string, unknown>;
}

function makeRequestRow(overrides: Partial<AccountApprovalRequestRow> = {}): AccountApprovalRequestRow {
  return {
    id: "req-001",
    tenant_id: null,
    auth_user_id: "00000000-0000-0000-0000-0000000000aa",
    email: "nouveau.parent@example.dz",
    requested_role: "parent",
    requested_at: "2026-09-09T19:00:00.000Z",
    activation_code: null,
    national_id: null,
    phone: null,
    full_name: "Nouveau Parent",
    notes_from_user: null,
    target_parent_id: null,
    target_student_id: null,
    status: "pending",
    reviewed_by: null,
    reviewed_at: null,
    decision_note: null,
    created_at: "2026-09-09T19:00:00.000Z",
    updated_at: "2026-09-09T19:00:00.000Z",
    expires_at: "2026-09-16T19:00:00.000Z",
    ...overrides,
  };
}

/**
 * Minimal per-table fake: each table's builder resolves ONE configured
 * result — via `.maybeSingle()` (the findPotentialMatches path) or via
 * direct await (the listPending path, thenable). Filters (eq/is) are
 * recorded for the source-of-truth assertions.
 */
function makeFakeClient(opts: {
  requests: QueryResult;
  activationCodes?: QueryResult;
  parents?: QueryResult;
}): { client: unknown; filters: RecordedFilter[] } {
  const filters: RecordedFilter[] = [];

  const tableResults: Record<string, QueryResult | undefined> = {
    account_approval_requests: opts.requests,
    activation_codes: opts.activationCodes,
    parents: opts.parents,
  };

  const makeBuilder = (table: string): unknown => {
    const current: RecordedFilter = { table };
    let committed = false;
    const commit = (): QueryResult => {
      if (!committed) {
        committed = true;
        filters.push(current);
      }
      return tableResults[table] ?? { data: null, error: null };
    };
    const b = {
      select: () => b,
      eq: vi.fn((col: string, val: unknown) => {
        current.eq = { ...(current.eq ?? {}), [col]: val };
        return b;
      }),
      is: vi.fn((col: string, val: unknown) => {
        current.is = { ...(current.is ?? {}), [col]: val };
        return b;
      }),
      order: () => b,
      maybeSingle: () => Promise.resolve(commit()),
      single: () => Promise.resolve(commit()),
      then: (onFulfilled?: unknown, onRejected?: unknown) =>
        Promise.resolve(commit()).then(
          onFulfilled as never,
          onRejected as never,
        ),
    };
    return b;
  };

  const client = {
    from: (table: string) => makeBuilder(table),
  };
  return { client, filters };
}

function asClient(client: unknown): SupabaseClient {
  return client as unknown as SupabaseClient;
}

const PARENT_ROW = {
  id: "00000000-0000-0000-0000-0000000000p1",
  parent_code: "PAR-2026-001",
  first_name: "Amine",
  last_name: "Boudjema",
  primary_phone: "+213555000111",
  email: "amine.boudjema@example.dz",
};

describe("T-264 / OPS-309 — findPotentialMatches .maybeSingle() (406 console noise)", () => {
  it("zero-row lookups surface NO error: listPending stays Ok() with parent_match null (the 406-spam case)", async () => {
    // The owner-reported scenario: a pending request with email only, no
    // matching parent → pre-T-264 this fired `.is("auth_user_id", null).single()`
    // → PostgREST 406 PGRST116 in the console. Post-T-264: maybeSingle →
    // { data: null, error: null } → silent fall-through.
    const { client, filters } = makeFakeClient({
      requests: { data: [makeRequestRow()], error: null },
      activationCodes: { data: null, error: null },
      parents: { data: null, error: null },
    });
    const repo = new SupabaseApprovalRepository(asClient(client));

    const res = await repo.listPending();

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected Ok");
    expect(res.value).toHaveLength(1);
    expect(res.value[0].parent_match).toBeNull();
    expect(res.value[0].student_match).toBeNull();
    // The email strategy WAS attempted (the fall-through walked the chain).
    const parentsFilters = filters.filter((f) => f.table === "parents");
    expect(parentsFilters.length).toBeGreaterThanOrEqual(1);
    expect(parentsFilters[parentsFilters.length - 1].is).toEqual({ auth_user_id: null });
  });

  it("the activation-code canonical path still enriches when a match exists", async () => {
    const { client } = makeFakeClient({
      requests: { data: [makeRequestRow({ activation_code: "741852" })], error: null },
      activationCodes: { data: { parent_id: PARENT_ROW.id, student_id: null }, error: null },
      parents: { data: PARENT_ROW, error: null },
    });
    const repo = new SupabaseApprovalRepository(asClient(client));

    const res = await repo.listPending();

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected Ok");
    expect(res.value[0].parent_match).toEqual(PARENT_ROW);
  });

  it("a >1-row maybeSingle error still falls through (multiple parents share a phone) — no crash, no match", async () => {
    // maybeSingle errors on MULTIPLE rows exactly like single() did — the
    // fall-through contract is unchanged for that edge.
    const { client } = makeFakeClient({
      requests: {
        data: [makeRequestRow({ activation_code: null, email: "partage@example.dz", phone: "+213555000111" })],
        error: null,
      },
      parents: {
        data: null,
        error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
      },
    });
    const repo = new SupabaseApprovalRepository(asClient(client));

    const res = await repo.listPending();

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected Ok");
    expect(res.value[0].parent_match).toBeNull();
  });

  it("the email fallback path still enriches after the activation-code path found nothing", async () => {
    const { client, filters } = makeFakeClient({
      requests: { data: [makeRequestRow({ activation_code: "000000" })], error: null },
      activationCodes: { data: null, error: null }, // code not found → fall through
      parents: { data: PARENT_ROW, error: null },
    });
    const repo = new SupabaseApprovalRepository(asClient(client));

    const res = await repo.listPending();

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected Ok");
    expect(res.value[0].parent_match).toEqual(PARENT_ROW);
    // Walked: activation_codes first, then the parents email strategy.
    expect(filters.some((f) => f.table === "activation_codes")).toBe(true);
    expect(filters.some((f) => f.table === "parents" && f.eq?.email === "nouveau.parent@example.dz")).toBe(true);
  });

  it("an empty pending queue performs NO matcher lookups at all (zero console chatter)", async () => {
    const { client, filters } = makeFakeClient({
      requests: { data: [], error: null },
    });
    const repo = new SupabaseApprovalRepository(asClient(client));

    const res = await repo.listPending();

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected Ok");
    expect(res.value).toEqual([]);
    expect(filters).toHaveLength(1); // only the account_approval_requests list query
  });
});

describe("T-264 / OPS-309 — source guards (the t-126 scan precedent)", () => {
  const repoSource = readFileSync(
    resolvePath(__dirname, "../../infrastructure/supabase/repositories/supabase-approval-repository.ts"),
    "utf-8",
  );

  it("findPotentialMatches uses .maybeSingle() everywhere — no bare .single() call site remains", () => {
    // Call sites end with `.single();` on their own line; the doc comment
    // legitimately MENTIONS `.single()` in prose (no trailing semicolon).
    expect(repoSource).not.toMatch(/^[ \t]*\.single\(\);/m);
    expect(repoSource.match(/^[ \t]*\.maybeSingle\(\);/gm) ?? []).toHaveLength(5);
  });

  it("the four not-yet-bound null filters are preserved verbatim (binding semantics, not noise)", () => {
    expect(repoSource).toContain('.is("bound_to_auth_user_id", null)');
    expect(repoSource.match(/\.is\("auth_user_id", null\)/g) ?? []).toHaveLength(3);
  });
});
