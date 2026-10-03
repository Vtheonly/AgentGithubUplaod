/**
 * T-482 — the auto-Relevé server-side design (UNKNOWN-030 / ADR-034 /
 * migration 0141): the desktop wiring pinned as unit tests (the
 * fake-client convention) and source guards (the t-374/t-480 convention).
 *
 * Bridge pins:
 *   1. logAutoReleveSideEffect invokes the canonical RPC with the exact
 *      payload contract (p_kind / p_class_id / p_class_subject_id / p_note).
 *   2. The fail-safe: an RPC error (or a thrown client) resolves WITHOUT
 *      rejecting — the primary classroom write is already persisted and
 *      must never break (the T-314 event-bridge pattern).
 *
 * Classroom wiring pins (fake client with rpc capture):
 *   3. enterGradesBatch fires ONE auto entry per batch (kind grade_entry,
 *      the batch note vocabulary).
 *   4. recordRollCall fires kind roll_call with the class + the
 *      present/total note.
 *   5. Homework push fires kind homework_push with the title/subject note.
 *
 * Read-side pins:
 *   6. mapRow surfaces autoKind ONLY for entry_source='auto' rows with a
 *      known kind; manual rows and unknown kinds fold to null.
 *
 * Source guards:
 *   7. Migration 0141 exists, scopes prevent_self_releve_entry to manual
 *      rows, declares the SECURITY DEFINER RPC, and registers itself.
 *   8. The three Supabase classroom write paths call the bridge.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAutoReleveSideEffect } from "../../infrastructure/supabase/repositories/auto-releve-bridge";
import { SupabaseReleveRepository } from "../../infrastructure/supabase/repositories/supabase-releve-repository";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================================
// Fake Supabase client with RPC capture (the t-239/t-481 convention,
// extended with an rpc() recorder)
// ============================================================================

type Row = Record<string, any>;
interface RpcCall {
  fn: string;
  args: Row;
}

class FakeRpcQuery {
  constructor(
    private readonly calls: RpcCall[],
    private readonly fn: string,
    private readonly args: Row,
    private readonly error: { message: string } | null,
    private readonly throwInstead: boolean,
  ) {}
  then<TResult1>(
    onFulfilled:
      | ((value: { data: unknown; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onRejected?: ((reason: unknown) => unknown) | null,
  ): Promise<TResult1> {
    this.calls.push({ fn: this.fn, args: this.args });
    if (this.throwInstead) {
      // A network-level rejection: the await machinery settles through
      // onRejected (the bridge's try/catch is the handler under test).
      const err = new Error("network down");
      if (typeof onRejected === "function") onRejected(err);
      return Promise.resolve(undefined as TResult1);
    }
    return Promise.resolve(onFulfilled!({ data: null, error: this.error } as never));
  }
}

class FakeRpcClient {
  calls: RpcCall[] = [];
  nextError: { message: string } | null = null;
  throwInstead = false;
  rpc(fn: string, args: Row): FakeRpcQuery {
    return new FakeRpcQuery(this.calls, fn, args, this.nextError, this.throwInstead);
  }
}

const fakeRpcClient = new FakeRpcClient();

// ============================================================================
// Read-side fixtures (the releve repository read path — a fake table)
// ============================================================================

const TENANT = "00000000-0000-0000-0000-000000000001";
const MEMBER_ID = "eeeeeeee-0000-0000-0000-0000000000e1";
const ADMIN_ACCOUNT = "cccccccc-0000-0000-0000-0000000000c1";

beforeEach(() => {
  fakeRpcClient.calls = [];
  fakeRpcClient.nextError = null;
  fakeRpcClient.throwInstead = false;
});

// ============================================================================
// Bridge tests
// ============================================================================

describe("auto-releve-bridge (T-482 / ADR-034 / migration 0141)", () => {
  it("1. invokes the canonical RPC with the exact payload contract", async () => {
    await logAutoReleveSideEffect(fakeRpcClient as unknown as SupabaseClient, {
      kind: "grade_entry",
      note: "Note saisie — 12/14/16",
      classId: "a1a1a1a1-0000-0000-0000-000000000011",
      classSubjectId: null,
    });
    expect(fakeRpcClient.calls.length).toBe(1);
    const call = fakeRpcClient.calls[0]!;
    expect(call.fn).toBe("record_auto_releve_entry");
    expect(call.args["p_kind"]).toBe("grade_entry");
    expect(call.args["p_class_id"]).toBe("a1a1a1a1-0000-0000-0000-000000000011");
    expect(call.args["p_class_subject_id"]).toBeNull();
    expect(call.args["p_note"]).toBe("Note saisie — 12/14/16");
    // The client NEVER re-derives the kind→activity mapping (ADR-034: the
    // mapping lives server-side in the RPC).
    expect(Object.keys(call.args).sort()).toEqual(
      ["p_class_id", "p_class_subject_id", "p_kind", "p_note"].sort(),
    );
  });

  it("2a. the fail-safe: an RPC ERROR resolves without rejecting", async () => {
    fakeRpcClient.nextError = { message: "no personnel row" };
    await expect(
      logAutoReleveSideEffect(fakeRpcClient as unknown as SupabaseClient, {
        kind: "roll_call",
        note: "Appel enregistré (matin) — 24/26 présents",
      }),
    ).resolves.toBeUndefined();
  });

  it("2b. the fail-safe: a THROWN client resolves without rejecting", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fakeRpcClient.throwInstead = true;
    await expect(
      logAutoReleveSideEffect(fakeRpcClient as unknown as SupabaseClient, {
        kind: "homework_push",
        note: "Devoir publié — « Exercices » (Mathématiques)",
      }),
    ).resolves.toBeUndefined();
    warn.mockRestore();
  });
});

// ============================================================================
// Read-side mapping (the autoKind surfacing)
// ============================================================================

describe("SupabaseReleveRepository.mapRow — autoKind (T-482)", () => {
  beforeEach(() => {
    localStorage.setItem(
      "el-imtiyaz.session",
      JSON.stringify({ tenantId: TENANT, userId: ADMIN_ACCOUNT }),
    );
    return () => localStorage.removeItem("el-imtiyaz.session");
  });

  function baseRow(overrides: Row): Row {
    return {
      id: "rel-uuid-x",
      tenant_id: TENANT,
      personnel_id: MEMBER_ID,
      activity_type: "correction",
      class_id: null,
      class_subject_id: null,
      description: null,
      clock_in_at: "2026-10-04T10:00:00+01:00",
      clock_out_at: null,
      duration_minutes: null,
      recorded_by: ADMIN_ACCOUNT,
      recorded_at: "2026-10-04T10:05:00Z",
      created_at: "2026-10-04T10:05:00Z",
      personnel: { first_name: "Amine", last_name: "Belkacem" },
      ...overrides,
    };
  }

  it("6a. an entry_source='auto' row with a known kind surfaces autoKind", async () => {
    const repo = new SupabaseReleveRepository(fakeRpcClient as unknown as SupabaseClient);
    const table: Row[] = [
      baseRow({ entry_source: "auto", auto_kind: "grade_entry" }),
    ];
    // Seed the cache through the internal refresh path: observeByPersonnel
    // triggers a select on the releve table — route it through a fake from().
    (fakeRpcClient as unknown as Record<string, unknown>)["from"] = (): unknown => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: () =>
                Promise.resolve({ data: table, error: null }),
            }),
          }),
        }),
      }),
    });
    const obs = repo.observeByPersonnel(MEMBER_ID, "2026-09-01", "2026-10-31");
    await new Promise((r) => setTimeout(r, 20));
    const entries = obs.get();
    expect(entries.length).toBe(1);
    expect(entries[0]!.autoKind).toBe("grade_entry");
  });

  it("6b. a manual row (or a missing/unknown kind) folds autoKind to null", async () => {
    const repo = new SupabaseReleveRepository(fakeRpcClient as unknown as SupabaseClient);
    const table: Row[] = [
      baseRow({ entry_source: "manual" }),
      baseRow({ id: "rel-uuid-y", entry_source: "auto", auto_kind: "mystery_kind" }),
      baseRow({ id: "rel-uuid-z" }), // a pre-0141 row: neither column present
    ];
    (fakeRpcClient as unknown as Record<string, unknown>)["from"] = (): unknown => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: table, error: null }),
            }),
          }),
        }),
      }),
    });
    const obs = repo.observeByPersonnel(MEMBER_ID, "2026-09-01", "2026-10-31");
    await new Promise((r) => setTimeout(r, 20));
    const entries = obs.get();
    expect(entries.length).toBe(3);
    expect(entries.find((e) => e.id === "rel-uuid-x")!.autoKind).toBeNull();
    expect(entries.find((e) => e.id === "rel-uuid-y")!.autoKind).toBeNull();
    expect(entries.find((e) => e.id === "rel-uuid-z")!.autoKind).toBeNull();
  });
});

// ============================================================================
// Classroom wiring pins (the REAL repositories against a fluent fake —
// the RPC must fire after each canonical write)
// ============================================================================

import {
  SupabaseGradeRepository,
  SupabaseAttendanceRepository,
  SupabaseHomeworkRepository,
} from "../../infrastructure/supabase/repositories/supabase-academic-repository";

/**
 * A fluent fake for the classroom tables: every chain method returns the
 * chain; the await settles with a per-table payload. The rpc() recorder
 * (fakeRpcClient) captures the auto-Relevé side effect.
 */
function makeWiringClient(): { client: SupabaseClient; rpcCalls: RpcCall[] } {
  const rpcCalls: RpcCall[] = [];
  const payloads: Record<string, unknown> = {
    academic_years: { code: "2026-2027", label: "2026-2027", is_archived: false },
    assessments: [
      {
        id: "e1e1e1e1-0000-0000-0000-0000000000e1",
        student_id: "51555555-0000-0000-0000-000000000051",
        class_id: "c1c1c1c1-0000-0000-0000-0000000000c1",
        subject_id: "a0a0a0a0-0000-0000-0000-0000000000b1",
        term: 1,
        academic_year: "2026-2027",
        devoir1: 12,
        devoir2: 14,
        examen: 16,
        cc: null,
        coefficient: 3,
        subject_average: 14.5,
        entered_by: "d0d0d0d0-0000-0000-0000-0000000000d1",
        entered_at: "2026-10-04T10:00:00Z",
        updated_at: "2026-10-04T10:00:00Z",
      },
    ],
    attendance_records: [
      {
        id: "f1f1f1f1-0000-0000-0000-0000000000f1",
        tenant_id: TENANT,
        student_id: "51555555-0000-0000-0000-000000000051",
        class_id: "c1c1c1c1-0000-0000-0000-0000000000c1",
        date: "2026-10-04",
        record_date: "2026-10-04",
        session: "morning",
        status: "present",
        arrival_time: null,
        recorded_by: "d0d0d0d0-0000-0000-0000-0000000000d1",
        recorded_at: "2026-10-04T08:30:00Z",
        synced_at: "2026-10-04T08:30:00Z",
      },
      {
        id: "f2f2f2f2-0000-0000-0000-0000000000f2",
        tenant_id: TENANT,
        student_id: "52555555-0000-0000-0000-000000000052",
        class_id: "c1c1c1c1-0000-0000-0000-0000000000c1",
        date: "2026-10-04",
        record_date: "2026-10-04",
        session: "morning",
        status: "late",
        arrival_time: "08:45",
        recorded_by: "d0d0d0d0-0000-0000-0000-0000000000d1",
        recorded_at: "2026-10-04T08:30:00Z",
        synced_at: "2026-10-04T08:30:00Z",
      },
    ],
    subjects: { name_fr: "Mathématiques" },
    students: [],
    homework: {
      id: "abababab-0000-0000-0000-0000000000ab",
      class_id: "c1c1c1c1-0000-0000-0000-0000000000c1",
      subject_id: "a0a0a0a0-0000-0000-0000-0000000000b1",
      subject_name: "Mathématiques",
      teacher_id: "d0d0d0d0-0000-0000-0000-0000000000d1",
      teacher_name: "Amine Belkacem",
      title: "Exercices page 12",
      description: "Faire les exercices 1 à 5",
      due_date: "2026-10-10",
      attachments: [],
      academic_year: "2026-2027",
      pushed_at: "2026-10-04T10:00:00Z",
      created_at: "2026-10-04T10:00:00Z",
    },
  };
  const client = {
    rpc(fn: string, args: Row) {
      return {
        then(onFulfilled: (v: unknown) => unknown) {
          rpcCalls.push({ fn, args });
          return Promise.resolve(onFulfilled({ data: null, error: null }));
        },
      };
    },
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const settle = (onFulfilled: (v: unknown) => unknown) =>
        Promise.resolve(onFulfilled({ data: payloads[table] ?? [], error: null }));
      const methods = [
        "select", "eq", "in", "gte", "lte", "upsert", "insert", "update",
        "order", "limit", "single", "maybeSingle", "not", "is",
      ];
      for (const m of methods) {
        chain[m] = () => chain;
      }
      chain["then"] = (onFulfilled: (v: unknown) => unknown) =>
        settle(onFulfilled);
      return chain;
    },
  } as unknown as SupabaseClient;
  return { client, rpcCalls };
}

describe("T-482 classroom wiring (the real repositories)", () => {
  beforeEach(() => {
    localStorage.setItem(
      "el-imtiyaz.session",
      JSON.stringify({ tenantId: TENANT, userId: ADMIN_ACCOUNT }),
    );
    return () => localStorage.removeItem("el-imtiyaz.session");
  });

  it("3. enterGradesBatch fires ONE auto entry per batch (kind grade_entry)", async () => {
    const { client, rpcCalls } = makeWiringClient();
    const repo = new SupabaseGradeRepository(client);
    const res = await repo.enterGradesBatch([
      {
        studentId: "51555555-0000-0000-0000-000000000051",
        classId: "c1c1c1c1-0000-0000-0000-0000000000c1",
        subjectId: "a0a0a0a0-0000-0000-0000-0000000000b1",
        term: "T1",
        academicYear: "2026-2027",
        enteredBy: "d0d0d0d0-0000-0000-0000-0000000000d1",
        devoir1: 12,
        devoir2: 14,
        examen: 16,
        coefficient: 3,
      },
    ]);
    expect(res.ok).toBe(true);
    // Let the void-fired side effect settle.
    await new Promise((r) => setTimeout(r, 20));
    const releveCalls = rpcCalls.filter((c) => c.fn === "record_auto_releve_entry");
    expect(releveCalls.length).toBe(1);
    expect(releveCalls[0]!.args["p_kind"]).toBe("grade_entry");
    expect(releveCalls[0]!.args["p_class_id"]).toBe("c1c1c1c1-0000-0000-0000-0000000000c1");
    expect(String(releveCalls[0]!.args["p_note"])).toContain("Saisie groupée");
  });

  it("4. recordRollCall fires kind roll_call with the class + present/total note", async () => {
    const { client, rpcCalls } = makeWiringClient();
    const repo = new SupabaseAttendanceRepository(client);
    const res = await repo.recordRollCall({
      classId: "c1c1c1c1-0000-0000-0000-0000000000c1",
      date: "2026-10-04",
      session: "morning",
      statuses: new Map([
        ["51555555-0000-0000-0000-000000000051", "present"],
        ["52555555-0000-0000-0000-000000000052", "late"],
      ]),
      recordedBy: "d0d0d0d0-0000-0000-0000-0000000000d1",
    });
    expect(res.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    const releveCalls = rpcCalls.filter((c) => c.fn === "record_auto_releve_entry");
    expect(releveCalls.length).toBe(1);
    expect(releveCalls[0]!.args["p_kind"]).toBe("roll_call");
    expect(String(releveCalls[0]!.args["p_note"])).toContain("2/2 présents");
  });

  it("5. homework push fires kind homework_push with the title/subject note", async () => {
    const { client, rpcCalls } = makeWiringClient();
    const repo = new SupabaseHomeworkRepository(client);
    const res = await repo.push({
      classId: "c1c1c1c1-0000-0000-0000-0000000000c1",
      subjectId: "a0a0a0a0-0000-0000-0000-0000000000b1",
      teacherId: "d0d0d0d0-0000-0000-0000-0000000000d1",
      teacherName: "Amine Belkacem",
      title: "Exercices page 12",
      description: "Faire les exercices 1 à 5",
      dueDate: "2026-10-10",
      attachments: [],
    });
    expect(res.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    const releveCalls = rpcCalls.filter((c) => c.fn === "record_auto_releve_entry");
    expect(releveCalls.length).toBe(1);
    expect(releveCalls[0]!.args["p_kind"]).toBe("homework_push");
    expect(String(releveCalls[0]!.args["p_note"])).toContain("Exercices page 12");
    expect(String(releveCalls[0]!.args["p_note"])).toContain("Mathématiques");
  });
});

// ============================================================================
// Source guards (the t-480 convention)
// ============================================================================

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, "../../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(desktopRoot, rel), "utf-8");
}

describe("T-482 source guards", () => {
  it("7. migration 0141: the scoped trigger + the SECURITY DEFINER RPC + the registration", () => {
    const mig = read("supabase/migrations/0141_releve_auto_entries.sql");
    expect(mig).toContain("add column if not exists entry_source");
    expect(mig).toContain("add column if not exists auto_kind");
    // The §09.05 ban is re-scoped to manual rows (the auto early-return).
    expect(mig).toContain("if new.entry_source = 'auto' then");
    expect(mig).toContain("create or replace function public.prevent_self_releve_entry");
    expect(mig).toContain("raise exception 'Plan §09.05 violation");
    // The canonical RPC.
    expect(mig).toContain("create or replace function public.record_auto_releve_entry");
    expect(mig).toContain("security definer");
    expect(mig).toContain("grant execute on function public.record_auto_releve_entry");
    // The kind whitelist (the §09.06 vocabulary).
    expect(mig).toContain("'grade_entry', 'homework_push', 'roll_call'");
    // The T-091/MIG-TOKENS registration.
    expect(mig).toContain("values ('0141'");
  });

  it("8. the three Supabase classroom write paths call the bridge", () => {
    const academic = read(
      "src/infrastructure/supabase/repositories/supabase-academic-repository.ts",
    );
    expect(academic.split("logAutoReleveSideEffect").length - 1).toBeGreaterThanOrEqual(4); // import + 3 call sites + (batch = 4 uses)
    const kinds = (academic.match(/kind: "(grade_entry|roll_call|homework_push)"/g) ?? []).sort();
    expect(kinds).toEqual(['kind: "grade_entry"', 'kind: "grade_entry"', 'kind: "homework_push"', 'kind: "roll_call"']);
  });

  it("8b. the bridge file exists and documents the fail-safe contract", () => {
    const bridge = read("src/infrastructure/supabase/repositories/auto-releve-bridge.ts");
    expect(bridge).toContain("record_auto_releve_entry");
    expect(bridge).toContain("NEVER propagates");
  });
});
