/**
 * T-397 / PERF-501 + DATA-019 — the batchRegister bulk rewire + the honest
 * billing warning + the idempotent-retry absorber.
 *
 * What this suite pins (the counting-client contract):
 *
 *   A. THE CALL-COUNT CONTRACT — a 1-student default registration issues
 *      ~7 round-trips (parent RPC + fetch, student RPC + fetch, the pricing
 *      reads, ONE ledger bulk upsert, ONE installments bulk upsert) and
 *      NEVER the per-row `upsert_ledger_entry_from_import` RPC loop (the
 *      old path: 21+ sequential round-trips, the owner's 10–20 s at the
 *      Algeria→eu-west-1 RTT band).
 *   B. THE BILLING CONTENT — the same charges + tranches the per-row path
 *      wrote (tuition tranches ×3 + registration fee, transport when
 *      selected), now through the bulk payloads.
 *   C. DATA-019 — a bulk-leg failure returns Ok({ ..., billingWarning })
 *      with the honest reason (the family records stay); the wizard
 *      surfaces it (pinned at the result level here, at the toast level by
 *      the modal's own suite).
 *   D. THE IDEMPOTENT RETRY — a network-class failure on the parent upsert
 *      RPC is retried EXACTLY once and converges; a non-network error is
 *      NOT retried (a retry cannot fix validation/RLS).
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
  /** Fail the FIRST upsert_parent_from_import RPC with a network-class error. */
  parentNetworkFailOnce?: boolean;
  /** Fail the FIRST upsert_parent_from_import RPC with a non-network error. */
  parentHardFailOnce?: boolean;
  /** Make the ledger bulk upsert return an error (the DATA-019 leg). */
  ledgerBulkError?: { code: string; message: string };
}

function makeCountingClient(opts: MockOptions = {}) {
  const calls: CallLog = { rpc: [], upserts: [], reads: [], inserts: [] };
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
          let rows = rowsOf();
          for (const [col, val] of conds) rows = rows.filter((r) => (r[col] ?? null) === val || String(r[col] ?? "") === String(val ?? ""));
          // The pricing reads (pricing_configs / academic_levels /
          // grade_level_tuition / transport_destinations /
          // complementary_services) — empty lists make readDbPricingConfig
          // fall back to the seed config (the honest degraded path).
          return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
        },
      };
      return {
        select: () => selectBuilder,
        upsert: (rows: Row[] | Row, options?: Record<string, unknown>) => {
          const list = Array.isArray(rows) ? rows : [rows];
          calls.upserts.push({ table, count: list.length, options });
          if (table === "ledger_entries" && opts.ledgerBulkError) {
            return {
              select: () => Promise.resolve({ data: null, error: opts.ledgerBulkError }),
            };
          }
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
  ...overrides,
});

/* ================================================================== */
/* A. The call-count contract                                          */
/* ================================================================== */

describe("T-397 A. batchRegister — the call-count contract (PERF-501)", () => {
  it("writes the billing through ONE bulk call per table — never the per-row RPC loop", async () => {
    const { client, calls } = makeCountingClient();
    const repo = new SupabaseStudentRepository(client);
    const r = await repo.batchRegister(INPUT());
    expect(r.ok).toBe(true);

    // The identity legs: parent RPC ×1 + fetch, student RPC ×1 + fetch.
    const parentRpcs = calls.rpc.filter((c) => c.name === "upsert_parent_from_import").length;
    const studentRpcs = calls.rpc.filter((c) => c.name === "upsert_student_from_import").length;
    expect(parentRpcs).toBe(1);
    expect(studentRpcs).toBe(1);

    // THE pin: the per-row ledger RPC loop is GONE.
    const ledgerRpcs = calls.rpc.filter((c) => c.name === "upsert_ledger_entry_from_import").length;
    expect(ledgerRpcs).toBe(0);

    // The billing went through ONE bulk upsert per table.
    const ledgerBulk = calls.upserts.filter((u) => u.table === "ledger_entries");
    const instBulk = calls.upserts.filter((u) => u.table === "installments");
    expect(ledgerBulk).toHaveLength(1);
    expect(instBulk).toHaveLength(1);

    // The total round-trip count (RPCs + reads + bulk writes) — the old
    // path measured 21+ sequential round-trips live for the same payload.
    const total =
      calls.rpc.length + calls.reads.length + calls.upserts.length + calls.inserts.length;
    expect(total).toBeLessThanOrEqual(12);
    expect(total).toBeGreaterThanOrEqual(6);
  });

  it("carries the same billing content the per-row path wrote (tuition ×3 + fee; transport when selected)", async () => {
    const { client, calls } = makeCountingClient();
    const repo = new SupabaseStudentRepository(client);
    const r = await repo.batchRegister(INPUT());
    expect(r.ok).toBe(true);
    expect(r.ok && !r.value.billingWarning).toBe(true);

    const ledgerBulk = calls.upserts.find((u) => u.table === "ledger_entries");
    const instBulk = calls.upserts.find((u) => u.table === "installments");
    // 3 tuition tranches + 1 registration fee (transport OFF in this input).
    expect(ledgerBulk?.count).toBe(4);
    expect(instBulk?.count).toBe(3);
  });
});

/* ================================================================== */
/* B. DATA-019 — the honest billing warning                            */
/* ================================================================== */

describe("T-397 B. batchRegister — the DATA-019 honest billing warning", () => {
  it("returns Ok + billingWarning (with the reason) when the ledger bulk leg fails", async () => {
    const { client } = makeCountingClient({
      ledgerBulkError: { code: "42P10", message: "no unique or exclusion constraint" },
    });
    const repo = new SupabaseStudentRepository(client);
    const r = await repo.batchRegister(INPUT());
    // The family records stay — the registration does NOT fail.
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.parent).toBeTruthy();
    expect(r.value.students).toHaveLength(1);
    // The honest warning carries the failure reason.
    expect(r.value.billingWarning).toBeTruthy();
    expect(r.value.billingWarning).toContain("facturation");
    expect(r.value.billingWarning).toContain("grand livre");
    expect(r.value.billingWarning).toContain("no unique or exclusion constraint");
  });
});

/* ================================================================== */
/* C. The idempotent retry                                             */
/* ================================================================== */

describe("T-397 C. the idempotent-retry absorber (PERF-501 transient class)", () => {
  it("retries a network-class parent-upsert failure EXACTLY once and converges", async () => {
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

  it("does NOT retry a non-network failure (RLS/validation cannot be fixed by a retry)", async () => {
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
