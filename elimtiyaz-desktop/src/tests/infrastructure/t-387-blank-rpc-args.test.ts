/**
 * T-387 — SYNC-300 regression suite: blank strings must NEVER reach a
 * uuid/date/timestamp-typed RPC parameter.
 *
 * The live repro (NEW project vebfehrpzajhstyhinnw, 2026-09-17): the desktop
 * sync push sent `p_class_id: ""` (the `??` coalescing operator does NOT
 * convert "" to null) and PostgREST answered the reported HTTP 400
 * `{"code":"22P02","message":"invalid input syntax for type uuid: \"\""}` —
 * the cast fails BEFORE the SECURITY DEFINER body runs, so the server-side
 * NULLIF/TRIM normalization cannot save it.
 *
 * Family: the ACAD-501 REST-filter sibling (`?class_id=eq.` — same 22P02 on
 * the READ path, fixed T-373). This suite pins the WRITE path (RPC args).
 *
 * Guards under test:
 *   A. student   — p_class_id "" / mock id / valid uuid; p_date_of_birth ""
 *   B. attendance — p_class_id "", p_recorded_by mock id, p_record_date ""
 *   C. installment — p_due_date "" / p_paid_date ""
 *   D. payment   — p_collected_at "", p_collected_by mock id
 *   E. ledger    — p_at ""
 *   F. grade     — p_class_id "", p_entered_by mock actorId
 *   G. source scan — the raw `?? null` typed-param patterns are GONE and the
 *      blankToNull/uuidOrNull guards are present (regression tripwire)
 *   H. types.ts census — upsert_student_from_import declares the 0028/0037
 *      params (the live pg_proc signature; the generated types were behind)
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SyncQueueEntry } from "../../infrastructure/sync/sync-types";

const SRC = join(__dirname, "../../");
const HANDLER_SRC = readFileSync(
  join(SRC, "infrastructure/sync/default-push-handler.ts"),
  "utf-8",
);
const TYPES_SRC = readFileSync(
  join(SRC, "infrastructure/supabase/types.ts"),
  "utf-8",
);

const TENANT = "00000000-0000-0000-0000-000000000001";
const PARENT_ID = "1ba1a362-fc13-4cdd-8219-ef3e37bb6ea0";
const VALID_CLASS_ID = "11111111-2222-3333-4444-555555555555";

beforeAll(() => {
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: TENANT, userId: "staff-1" }),
  );
});

// ---------------------------------------------------------------------------
// Fake Supabase client capturing rpc/table calls (the t-022 pattern)
// ---------------------------------------------------------------------------

type RpcCall = { fn: string; args: Record<string, unknown> };

function makeClient() {
  const rpcCalls: RpcCall[] = [];
  const client = {
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: "ok", error: null });
    },
    from(table: string) {
      const q: Record<string, unknown> = {};
      q.upsert = () => Promise.resolve({ data: null, error: null });
      void table;
      return q;
    },
  };
  return { client: client as unknown as SupabaseClient, rpcCalls };
}

function entry(entity: SyncQueueEntry["entity"], payload: Record<string, unknown>): SyncQueueEntry {
  return {
    id: `sync_${entity}_${Math.random().toString(36).slice(2, 8)}`,
    entity,
    operation: "insert",
    tenantId: TENANT,
    actorId: "staff-1",
    payload,
    isMock: false,
    status: "pending",
    attempts: 0,
    queuedAt: new Date().toISOString(),
    lastAttemptAt: null,
    lastError: null,
  };
}

async function loadHandler(client: SupabaseClient) {
  vi.doMock("../../infrastructure/supabase/supabase-client", () => ({
    getSupabaseClient: () => client,
    isSupabaseConfigured: () => true,
  }));
  const mod = await import("../../infrastructure/sync/default-push-handler");
  return mod.defaultPushHandler;
}

// ---------------------------------------------------------------------------
// A. student — the confirmed live repro (p_class_id "")
// ---------------------------------------------------------------------------

describe("T-387 — SYNC-300: blank strings never reach typed RPC params", () => {
  it("A1: student classId \"\" → p_class_id null (the live 22P02 repro)", async () => {
    const { client, rpcCalls } = makeClient();
    const handler = await loadHandler(client);
    await handler(
      entry("student", {
        code: "ELV-T385-A1",
        parentId: PARENT_ID,
        firstName: "PROBE",
        lastName: "A1",
        classId: "",
      }),
    );
    const call = rpcCalls.find((c) => c.fn === "upsert_student_from_import");
    expect(call).toBeDefined();
    expect(call!.args.p_class_id).toBeNull();
    // the entry SYNCED (no failed marking)
    const mark = rpcCalls.find((c) => c.fn === "mark_sync_queue_processed");
    expect(mark?.args.p_status).toBe("synced");
  });

  it("A2: student classId mock id (\"cls-003\") → p_class_id null (isUuid guard)", async () => {
    const { client, rpcCalls } = makeClient();
    const handler = await loadHandler(client);
    await handler(
      entry("student", {
        code: "ELV-T385-A2",
        parentId: PARENT_ID,
        firstName: "PROBE",
        lastName: "A2",
        classId: "cls-003",
      }),
    );
    const call = rpcCalls.find((c) => c.fn === "upsert_student_from_import");
    expect(call!.args.p_class_id).toBeNull();
  });

  it("A3: student classId VALID uuid → passed through unchanged", async () => {
    const { client, rpcCalls } = makeClient();
    const handler = await loadHandler(client);
    await handler(
      entry("student", {
        code: "ELV-T385-A3",
        parentId: PARENT_ID,
        firstName: "PROBE",
        lastName: "A3",
        classId: VALID_CLASS_ID,
      }),
    );
    const call = rpcCalls.find((c) => c.fn === "upsert_student_from_import");
    expect(call!.args.p_class_id).toBe(VALID_CLASS_ID);
  });

  it("A4: student birthDate \"\" → p_date_of_birth null (22007 class)", async () => {
    const { client, rpcCalls } = makeClient();
    const handler = await loadHandler(client);
    await handler(
      entry("student", {
        code: "ELV-T385-A4",
        parentId: PARENT_ID,
        firstName: "PROBE",
        lastName: "A4",
        birthDate: "",
      }),
    );
    const call = rpcCalls.find((c) => c.fn === "upsert_student_from_import");
    expect(call!.args.p_date_of_birth).toBeNull();
  });

  it("A5: student birthDate whitespace-only → null; real date preserved", async () => {
    const { client, rpcCalls } = makeClient();
    const handler = await loadHandler(client);
    await handler(
      entry("student", {
        code: "ELV-T385-A5",
        parentId: PARENT_ID,
        firstName: "PROBE",
        lastName: "A5",
        birthDate: "   ",
      }),
    );
    let call = rpcCalls.find((c) => c.fn === "upsert_student_from_import");
    expect(call!.args.p_date_of_birth).toBeNull();

    await handler(
      entry("student", {
        code: "ELV-T385-A5b",
        parentId: PARENT_ID,
        firstName: "PROBE",
        lastName: "A5b",
        birthDate: "2015-03-01",
      }),
    );
    call = rpcCalls.find(
      (c) => c.fn === "upsert_student_from_import" && c.args.p_student_code === "ELV-T385-A5b",
    );
    expect(call!.args.p_date_of_birth).toBe("2015-03-01");
  });

  // -------------------------------------------------------------------------
  // B. attendance
  // -------------------------------------------------------------------------

  it("B1: attendance classId \"\" + recordedBy mock id + recordDate \"\" → all null", async () => {
    const { client, rpcCalls } = makeClient();
    const handler = await loadHandler(client);
    await handler(
      entry("attendance", {
        studentId: "4a55abe0-4c49-48ec-8f78-8b1c2804e26e",
        recordDate: "",
        classId: "",
        recordedBy: "staff-1",
        status: "present",
      }),
    );
    const call = rpcCalls.find((c) => c.fn === "upsert_attendance_from_import");
    expect(call).toBeDefined();
    expect(call!.args.p_class_id).toBeNull();
    expect(call!.args.p_recorded_by).toBeNull();
    expect(call!.args.p_record_date).toBeNull();
  });

  // -------------------------------------------------------------------------
  // C. installment
  // -------------------------------------------------------------------------

  it("C1: installment dueDate \"\" + paidDate \"\" → nulls", async () => {
    const { client, rpcCalls } = makeClient();
    const handler = await loadHandler(client);
    await handler(
      entry("installment", {
        parentId: PARENT_ID,
        studentId: "4a55abe0-4c49-48ec-8f78-8b1c2804e26e",
        dueDate: "",
        paidDate: "",
        amountDue: 33000,
        status: "unpaid",
      }),
    );
    const call = rpcCalls.find((c) => c.fn === "upsert_installment_from_import");
    expect(call).toBeDefined();
    expect(call!.args.p_due_date).toBeNull();
    expect(call!.args.p_paid_date).toBeNull();
  });

  // -------------------------------------------------------------------------
  // D. payment
  // -------------------------------------------------------------------------

  it("D1: payment collectedAt \"\" + collectedBy mock id → nulls", async () => {
    const { client, rpcCalls } = makeClient();
    const handler = await loadHandler(client);
    await handler(
      entry("payment", {
        parentId: PARENT_ID,
        amount: 1000,
        collectedAt: "",
        collectedBy: "staff-1",
      }),
    );
    const call = rpcCalls.find((c) => c.fn === "upsert_payment_from_import");
    expect(call).toBeDefined();
    expect(call!.args.p_collected_at).toBeNull();
    expect(call!.args.p_collected_by).toBeNull();
  });

  // -------------------------------------------------------------------------
  // E. ledger_entry
  // -------------------------------------------------------------------------

  it("E1: ledger_entry at \"\" → p_at null", async () => {
    const { client, rpcCalls } = makeClient();
    const handler = await loadHandler(client);
    await handler(
      entry("ledger_entry", {
        parentId: PARENT_ID,
        amount: 1000,
        at: "",
        type: "charge",
      }),
    );
    const call = rpcCalls.find((c) => c.fn === "upsert_ledger_entry_from_import");
    expect(call).toBeDefined();
    expect(call!.args.p_at).toBeNull();
  });

  // -------------------------------------------------------------------------
  // F. grade
  // -------------------------------------------------------------------------

  it("F1: grade classId \"\" + mock actorId → p_class_id/p_entered_by null", async () => {
    const { client, rpcCalls } = makeClient();
    const handler = await loadHandler(client);
    await handler(
      entry("grade", {
        studentId: "4a55abe0-4c49-48ec-8f78-8b1c2804e26e",
        subjectId: "99999999-9999-9999-9999-999999999999",
        academicYear: "2026-2027",
        classId: "",
        devoir1: 15,
      }),
    );
    const call = rpcCalls.find((c) => c.fn === "upsert_assessment_from_import");
    expect(call).toBeDefined();
    expect(call!.args.p_class_id).toBeNull();
    expect(call!.args.p_entered_by).toBeNull();
  });

  // -------------------------------------------------------------------------
  // G. source guards — the raw patterns are gone, the guards are present
  // -------------------------------------------------------------------------

  describe("G. source guards (regression tripwire)", () => {
    it("G1: no raw `?? null` coalescing remains on the typed params", () => {
      // The exact patterns that shipped the live 400 (T-387 pre-fix):
      expect(HANDLER_SRC).not.toContain(
        "(p.classId as string) ?? (p.class_id as string) ?? null",
      );
      expect(HANDLER_SRC).not.toContain(
        "(p.birthDate as string) ?? (p.date_of_birth as string) ?? null",
      );
      expect(HANDLER_SRC).not.toContain(
        "(p.collectedAt as string) ?? (p.collected_at as string) ?? null",
      );
      expect(HANDLER_SRC).not.toContain(
        '(p.dueDate as string) ?? (p.due_date as string) ?? null',
      );
      expect(HANDLER_SRC).not.toContain(
        "(p.paidDate as string) ?? (p.paid_date as string) ?? null",
      );
    });

    it("G2: the blankToNull/uuidOrNull guards exist at every typed seam", () => {
      expect(HANDLER_SRC).toContain("function blankToNull(");
      expect(HANDLER_SRC).toContain("function uuidOrNull(");
      // student
      expect(HANDLER_SRC).toContain("p_class_id: uuidOrNull((p.classId as string)");
      expect(HANDLER_SRC).toContain("p_date_of_birth: blankToNull(");
      // payment
      expect(HANDLER_SRC).toContain("p_collected_at: blankToNull(");
      expect(HANDLER_SRC).toContain("p_collected_by: uuidOrNull(");
      // ledger
      expect(HANDLER_SRC).toContain("p_at: blankToNull(");
      // installment
      expect(HANDLER_SRC).toContain("p_due_date: blankToNull(");
      expect(HANDLER_SRC).toContain("p_paid_date: blankToNull(");
      // attendance
      expect(HANDLER_SRC).toContain("p_record_date: blankToNull(");
      expect(HANDLER_SRC).toContain("p_recorded_by: uuidOrNull(");
      // grade
      expect(HANDLER_SRC).toContain("p_entered_by: uuidOrNull(entry.actorId)");
    });
  });

  // -------------------------------------------------------------------------
  // H. types.ts census — the RPC declaration matches the live pg_proc
  // -------------------------------------------------------------------------

  describe("H. types.ts — upsert_student_from_import signature census", () => {
    it("H1: declares the 0028/0037 params the live pg_proc signature carries", () => {
      expect(TYPES_SRC).toContain("p_grade_level_code?: string | null");
      expect(TYPES_SRC).toContain("p_transport_tier?: string | null");
      expect(TYPES_SRC).toContain("p_payment_plan?: string");
    });

    it("H2: the Returns shape carries the 0031 out_* column names", () => {
      expect(TYPES_SRC).toContain(
        "Returns: { out_student_id: string; out_student_code: string; out_was_inserted: boolean }[]",
      );
    });
  });
});
