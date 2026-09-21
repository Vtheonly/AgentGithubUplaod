/**
 * T-397 / PERF-501 + DATA-019 — the batchRegister bulk rewire + the honest
 * billing warning + the idempotent-retry absorber.
 *
 * T-398 UPDATE (82nd session, PERF-502): the call-count contract is now the
 * ONE-round-trip pin — `batchRegister` issues EXACTLY ONE RPC
 * (`register_family_batch`, migrations 0102+0103) and NOTHING else when the
 * wizard passes its loaded pricing config (the t-398 passthrough): no
 * per-entity upserts, no full-row fetches, no pricing reads, no bulk
 * upserts. The billing content is asserted INSIDE the RPC payload.
 *
 * The ATOMICITY semantics (the registered upgrade of the DATA-019 scope
 * decision): a failing billing leg is a failing RPC — the whole
 * registration rolls back, `Ok` is impossible, the honest error says
 * NOTHING was written (the mock repository has had these semantics since
 * birth; the Supabase path now aligns).
 *
 * What this suite pins (the counting-client contract):
 *
 *   A. THE CALL-COUNT CONTRACT — a 1-student default registration issues
 *      EXACTLY 1 round-trip (register_family_batch) when pricingConfig is
 *      passed: the per-entity upsert RPCs are NEVER called, the per-row
 *      `upsert_ledger_entry_from_import` loop is gone, the bulk upserts are
 *      gone (the server writes them inside the RPC).
 *   B. THE BILLING CONTENT — the same charges + tranches the per-row path
 *      wrote (tuition tranches ×3 + registration fee, transport when
 *      selected), now inside the RPC payload (student_ref indexes +
 *      code-based source_id identity tokens).
 *   C. ATOMICITY — a failing RPC returns Err with the honest
 *      "RIEN n'a été écrit" reason (no partial state is possible).
 *   D. THE IDEMPOTENT RETRY — a network-class failure on the batch RPC is
 *      retried EXACTLY once and converges; a non-network error is NOT
 *      retried (a retry cannot fix validation/RLS). The createParent seam
 *      keeps its own retry pins (unchanged method).
 *
 * Run:
 *   npx vitest run src/tests/infrastructure/t-397-batch-register-bulk.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SupabaseStudentRepository,
  SupabaseParentRepository,
} from "../../infrastructure/supabase/repositories/supabase-shared-repositories";
import type { BatchRegistrationInput } from "../../domain/model/student";
import { defaultPricingConfig } from "../../infrastructure/mock/pricing-seed";

// The tenant the shared repositories resolve from the session fixture.
beforeAll(() => {
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: "00000000-0000-0000-0000-000000000001", userId: "staff-1" }),
  );
});
afterAll(() => {
  localStorage.removeItem("el-imtiyaz.session");
});

/* ================================================================== */
/* The counting mock client — records EVERY round-trip by kind          */
/* ================================================================== */

type Row = Record<string, unknown>;

interface CallLog {
  rpc: Array<{ name: string; args?: Record<string, unknown> }>;
  /** table → upsert payload row counts (the bulk legs). */
  upserts: Array<{ table: string; count: number; options?: Record<string, unknown> }>;
  /** table → row reads (selects). */
  reads: string[];
  inserts: string[];
}

interface MockOptions {
  /** Fail the FIRST register_family_batch RPC with a network-class error. */
  batchNetworkFailOnce?: boolean;
  /** Fail the FIRST register_family_batch RPC with a non-network error. */
  batchHardFailOnce?: boolean;
  /** Make every register_family_batch call return an error (atomicity leg). */
  batchAlwaysError?: { code: string; message: string };
  /** Fail the FIRST upsert_parent_from_import RPC with a network-class error. */
  parentNetworkFailOnce?: boolean;
  /** Fail the FIRST upsert_parent_from_import RPC with a non-network error. */
  parentHardFailOnce?: boolean;
}

function makeCountingClient(opts: MockOptions = {}) {
  const calls: CallLog = { rpc: [], upserts: [], reads: [], inserts: [] };
  let batchRpcCalls = 0;
  let parentRpcCalls = 0;
  let idSeq = 0;
  const uuid = () => {
    idSeq += 1;
    return `00000000-0000-0000-0000-${String(idSeq).padStart(12, "0")}`;
  };

  const studentRows = new Map<string, Row>(); // by student id
  const parentRows = new Map<string, Row>();

  const client = {
    rpc: (name: string, args?: Record<string, unknown>) => {
      calls.rpc.push({ name, args });
      if (name === "register_family_batch") {
        batchRpcCalls += 1;
        if (opts.batchNetworkFailOnce && batchRpcCalls === 1) {
          return Promise.resolve({
            data: null,
            error: { code: "ERR_NETWORK", message: "TypeError: fetch failed" },
          });
        }
        if (opts.batchHardFailOnce && batchRpcCalls === 1) {
          return Promise.resolve({
            data: null,
            error: { code: "42501", message: "new row violates row-level security policy" },
          });
        }
        if (opts.batchAlwaysError) {
          return Promise.resolve({ data: null, error: opts.batchAlwaysError });
        }
        // Build the response the RPC shape promises: the FULL parent +
        // student rows (payload order) + the write counts.
        const p = (args?.p_parent ?? {}) as Record<string, unknown>;
        const parentId = uuid();
        const parentRow: Row = {
          id: parentId,
          tenant_id: args?.p_tenant_id,
          parent_code: p.parent_code,
          first_name: p.first_name,
          last_name: p.last_name,
          primary_phone: p.primary_phone,
          display_name: p.display_name,
          transport_destination: p.transport_destination,
          city_tier: p.city_tier,
          preferred_language: p.preferred_language,
          is_active: true,
          deleted_at: null,
          created_at: "2026-09-21T00:00:00Z",
          updated_at: "2026-09-21T00:00:00Z",
        };
        parentRows.set(parentId, parentRow);
        const students = ((args?.p_students ?? []) as Row[]).map((s) => {
          const id = uuid();
          const row: Row = {
            id,
            tenant_id: args?.p_tenant_id,
            student_code: s.student_code,
            parent_id: parentId,
            first_name: s.first_name,
            last_name: s.last_name,
            display_name: s.display_name,
            middle_name: s.middle_name,
            date_of_birth: s.date_of_birth,
            gender: s.gender,
            class_id: s.class_id,
            medical_notes: s.medical_notes,
            grade_level_code: s.grade_level_code,
            transport_tier: s.transport_tier,
            payment_plan: s.payment_plan,
            enrollment_status: s.enrollment_status,
            is_active: true,
            deleted_at: null,
            created_at: "2026-09-21T00:00:00Z",
            updated_at: "2026-09-21T00:00:00Z",
          };
          studentRows.set(id, row);
          return row;
        });
        return Promise.resolve({
          data: [
            {
              out_parent: parentRow,
              out_students: students,
              out_ledger_written: ((args?.p_ledger_entries ?? []) as Row[]).length,
              out_installments_written: ((args?.p_installments ?? []) as Row[]).length,
            },
          ],
          error: null,
        });
      }
      if (name === "upsert_parent_from_import") {
        parentRpcCalls += 1;
        if (opts.parentNetworkFailOnce && parentRpcCalls === 1) {
          return Promise.resolve({
            data: null,
            error: { code: "ERR_NETWORK", message: "TypeError: fetch failed" },
          });
        }
        if (opts.parentHardFailOnce && parentRpcCalls === 1) {
          return Promise.resolve({
            data: null,
            error: { code: "42501", message: "new row violates row-level security policy" },
          });
        }
        const id = uuid();
        parentRows.set(id, {
          id,
          tenant_id: args?.p_tenant_id,
          parent_code: args?.p_parent_code,
          first_name: args?.p_first_name,
          last_name: args?.p_last_name,
          primary_phone: args?.p_primary_phone,
          display_name: args?.p_display_name,
          transport_destination: args?.p_transport_destination,
          city_tier: args?.p_city_tier,
          preferred_language: args?.p_preferred_language,
          is_active: true,
          deleted_at: null,
          created_at: "2026-09-21T00:00:00Z",
          updated_at: "2026-09-21T00:00:00Z",
        });
        return Promise.resolve({
          data: [{ out_parent_id: id, out_parent_code: args?.p_parent_code, out_was_inserted: true }],
          error: null,
        });
      }
      if (name === "upsert_student_from_import") {
        const id = uuid();
        studentRows.set(id, {
          id,
          tenant_id: args?.p_tenant_id,
          student_code: args?.p_student_code,
          parent_id: args?.p_parent_id,
          first_name: args?.p_first_name,
          last_name: args?.p_last_name,
          display_name: args?.p_display_name,
          middle_name: args?.p_middle_name,
          date_of_birth: args?.p_date_of_birth,
          gender: args?.p_gender,
          class_id: args?.p_class_id,
          medical_notes: args?.p_medical_notes,
          grade_level_code: args?.p_grade_level_code,
          transport_tier: args?.p_transport_tier,
          payment_plan: args?.p_payment_plan,
          enrollment_status: args?.p_enrollment_status,
          is_active: true,
          deleted_at: null,
          created_at: "2026-09-21T00:00:00Z",
          updated_at: "2026-09-21T00:00:00Z",
        });
        return Promise.resolve({
          data: [{ out_student_id: id, out_student_code: args?.p_student_code, out_was_inserted: true }],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: { message: `unexpected rpc ${name}` } });
    },
    from: (table: string) => {
      const conds: Array<[string, unknown]> = [];
      const rowsOf = (): Row[] => {
        if (table === "parents") return [...parentRows.values()];
        if (table === "students") return [...studentRows.values()];
        return [];
      };
      const selectBuilder = {
        eq: (col: string, val: unknown) => {
          conds.push([col, val]);
          return selectBuilder;
        },
        is: (col: string, val: unknown) => {
          conds.push([col, val]);
          return selectBuilder;
        },
        order: () => selectBuilder,
        limit: () => selectBuilder,
        maybeSingle: () => {
          calls.reads.push(table);
          let rows = rowsOf();
          for (const [col, val] of conds) rows = rows.filter((r) => r[col] === val);
          return Promise.resolve({ data: rows[0] ?? null, error: null });
        },
        then: (onFulfilled: (v: { data: Row[]; error: unknown }) => void, onRejected?: (e: unknown) => void) => {
          calls.reads.push(table);
          // The pricing reads (the readDbPricingConfig FALLBACK path —
          // only taken when pricingConfig is NOT passed): empty lists make
          // it fall back to the seed config (the honest degraded path).
          return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
        },
      };
      return {
        select: () => selectBuilder,
        upsert: (rows: Row[] | Row, options?: Record<string, unknown>) => {
          const list = Array.isArray(rows) ? rows : [rows];
          calls.upserts.push({ table, count: list.length, options });
          return {
            select: () => Promise.resolve({ data: list.map((r) => ({ ...r, id: uuid() })), error: null }),
          };
        },
        insert: (rows: Row[] | Row) => {
          const list = Array.isArray(rows) ? rows : [rows];
          calls.inserts.push(`${table}:${list.length}`);
          return { select: () => Promise.resolve({ data: list, error: null }) };
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const INPUT = (overrides: Partial<BatchRegistrationInput> = {}): BatchRegistrationInput => ({
  parent: {
    firstName: "Famille",
    lastName: "Sonde",
    phone: "0554288197",
    gender: "unspecified",
    preferredLanguage: "fr",
  },
  students: [
    {
      firstName: "Enfant",
      lastName: "Sonde",
      gender: "unspecified",
      birthDate: "2014-05-01",
      level: "cem",
      gradeYear: 1,
      gradeLevel: "1am",
      paymentPlan: "tranches",
      remise: 0,
      chargeStickerPrice: false,
      medicalNotes: null,
      classId: null,
      middleName: null,
      transportTier: null,
    },
  ],
  includeRegistration: true,
  includeTransport: false,
  // T-398: the wizard's loaded config — with it the write path issues ZERO
  // pricing reads (the one-round-trip contract).
  pricingConfig: defaultPricingConfig,
  ...overrides,
});

/* ================================================================== */
/* A. The call-count contract — the ONE round-trip                      */
/* ================================================================== */

describe("T-397/T-398 A. batchRegister — the ONE-round-trip call-count contract (PERF-502)", () => {
  it("issues EXACTLY ONE register_family_batch RPC — no upserts, no fetches, no pricing reads, no bulk writes", async () => {
    const { client, calls } = makeCountingClient();
    const repo = new SupabaseStudentRepository(client);
    const r = await repo.batchRegister(INPUT());
    expect(r.ok).toBe(true);

    // THE pin: exactly one round-trip, and it is the composite RPC.
    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0].name).toBe("register_family_batch");

    // The OLD legs are GONE: no per-entity upserts (parent/student), no
    // per-row ledger RPC loop, no bulk upserts, no full-row fetches, no
    // pricing reads.
    const parentRpcs = calls.rpc.filter((c) => c.name === "upsert_parent_from_import").length;
    const studentRpcs = calls.rpc.filter((c) => c.name === "upsert_student_from_import").length;
    const ledgerRpcs = calls.rpc.filter((c) => c.name === "upsert_ledger_entry_from_import").length;
    expect(parentRpcs).toBe(0);
    expect(studentRpcs).toBe(0);
    expect(ledgerRpcs).toBe(0);
    expect(calls.reads).toHaveLength(0);
    expect(calls.upserts).toHaveLength(0);
    expect(calls.inserts).toHaveLength(0);

    // The total round-trip count — the old path measured 21+ sequential
    // round-trips live, T-397 took it to ~11, the ONE-RPC shape is 1.
    const total =
      calls.rpc.length + calls.reads.length + calls.upserts.length + calls.inserts.length;
    expect(total).toBe(1);
  });

  it("carries the same billing content the per-row path wrote — INSIDE the RPC payload (tuition ×3 + fee; transport when selected)", async () => {
    const { client, calls } = makeCountingClient();
    const repo = new SupabaseStudentRepository(client);
    const r = await repo.batchRegister(INPUT());
    expect(r.ok).toBe(true);
    expect(r.ok && !r.value.billingWarning).toBe(true);

    const args = calls.rpc[0].args as {
      p_parent: Row;
      p_students: Row[];
      p_ledger_entries: Row[];
      p_installments: Row[];
    };
    // The identity: deterministic codes, payload order preserved.
    expect(args.p_parent.parent_code).toMatch(/^PAR-\d{4}-/);
    expect(args.p_students).toHaveLength(1);
    expect(args.p_students[0].student_code).toMatch(/^ELV-\d{4}-/);

    // 3 tuition tranches + 1 registration fee (transport OFF in this input).
    expect(args.p_ledger_entries).toHaveLength(4);
    expect(args.p_installments).toHaveLength(3);

    // The identity-token contract (the 0103 substitution's input):
    // student_ref indexes + code-bearing source_ids.
    const studentCode = args.p_students[0].student_code as string;
    for (const e of args.p_ledger_entries) {
      if (e.student_ref === null) {
        expect(e.source_id).toBe(`reg-${args.p_parent.parent_code}-fee`);
      } else {
        expect(e.student_ref).toBe(0);
        expect(String(e.source_id)).toMatch(new RegExp(`^reg-${studentCode}(-transport)?-t[123]$`));
      }
    }
    for (const inst of args.p_installments) {
      expect(inst.student_ref).toBe(0);
      expect(inst.source_id).toBe(`${studentCode}:tuition:T${inst.tranche_number}`);
    }
  });

  it("maps the returned full rows to the domain models with the input patches (gradeLevel/level/gradeYear)", async () => {
    const { client } = makeCountingClient();
    const repo = new SupabaseStudentRepository(client);
    const r = await repo.batchRegister(INPUT());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The parent model (mapParentRow over the returned jsonb row).
    expect(r.value.parent.code).toMatch(/^PAR-\d{4}-/);
    expect(r.value.parent.phone).toBe("0554288197");
    // The student model (mapStudentRow + the input patches — createStudent's
    // exact convention).
    expect(r.value.students).toHaveLength(1);
    const s = r.value.students[0];
    expect(s.code).toMatch(/^ELV-\d{4}-/);
    expect(s.gradeLevel).toBe("1am");
    expect(s.level).toBe("cem");
    expect(s.gradeYear).toBe(1);
  });
});

/* ================================================================== */
/* B. ATOMICITY — the honest everything-or-nothing failure              */
/* ================================================================== */

describe("T-397/T-398 B. batchRegister — the ATOMIC failure (the DATA-019 scope upgrade)", () => {
  it("a failing RPC returns Err with the honest nothing-was-written reason (no partial state possible)", async () => {
    const { client } = makeCountingClient({
      batchAlwaysError: { code: "23514", message: 'new row for relation "ledger_entries" violates check constraint' },
    });
    const repo = new SupabaseStudentRepository(client);
    const r = await repo.batchRegister(INPUT());
    // The atomic contract: NO Ok is possible when any leg failed — the
    // family, the students and the billing are ONE transaction.
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.userMessage).toContain("RIEN n'a été écrit");
    expect(r.error.userMessage).toContain("ledger_entries");
  });
});

/* ================================================================== */
/* C. The idempotent retry                                              */
/* ================================================================== */

describe("T-397/T-398 C. the idempotent-retry absorber (PERF-501/502 transient class)", () => {
  it("retries a network-class batch-RPC failure EXACTLY once and converges (the composite is idempotent)", async () => {
    const { client, calls } = makeCountingClient({ batchNetworkFailOnce: true });
    const repo = new SupabaseStudentRepository(client);
    const r = await repo.batchRegister(INPUT());
    expect(r.ok).toBe(true);
    const batchRpcs = calls.rpc.filter((c) => c.name === "register_family_batch").length;
    expect(batchRpcs).toBe(2); // failed once (network) + retried once
  });

  it("does NOT retry a non-network batch failure (RLS/validation cannot be fixed by a retry)", async () => {
    const { client, calls } = makeCountingClient({ batchHardFailOnce: true });
    const repo = new SupabaseStudentRepository(client);
    const r = await repo.batchRegister(INPUT());
    expect(r.ok).toBe(false);
    const batchRpcs = calls.rpc.filter((c) => c.name === "register_family_batch").length;
    expect(batchRpcs).toBe(1); // hard failure — no retry
  });

  it("retries a network-class parent-upsert failure EXACTLY once and converges (the createParent seam, unchanged)", async () => {
    const { client, calls } = makeCountingClient({ parentNetworkFailOnce: true });
    const repo = new SupabaseParentRepository(client);
    const r = await repo.createParent({
      firstName: "Famille",
      lastName: "Sonde",
      phone: "0554288197",
      gender: "unspecified",
      preferredLanguage: "fr",
    });
    expect(r.ok).toBe(true);
    const parentRpcs = calls.rpc.filter((c) => c.name === "upsert_parent_from_import").length;
    expect(parentRpcs).toBe(2); // failed once (network) + retried once
  });

  it("does NOT retry a non-network parent-upsert failure (the createParent seam, unchanged)", async () => {
    const { client, calls } = makeCountingClient({ parentHardFailOnce: true });
    const repo = new SupabaseParentRepository(client);
    const r = await repo.createParent({
      firstName: "Famille",
      lastName: "Sonde",
      phone: "0554288197",
      gender: "unspecified",
      preferredLanguage: "fr",
    });
    expect(r.ok).toBe(false);
    const parentRpcs = calls.rpc.filter((c) => c.name === "upsert_parent_from_import").length;
    expect(parentRpcs).toBe(1); // hard failure — no retry
  });
});
