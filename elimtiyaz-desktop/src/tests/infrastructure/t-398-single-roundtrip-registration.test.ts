/**
 * T-398 / PERF-502 — the ONE-round-trip registration (register_family_batch,
 * migrations 0102+0103): the client-side contract beyond the t-397 pins.
 *
 * What this suite pins (the counting-client contract, the t-393/t-397 mock
 * pattern):
 *
 *   A. THE FALLBACK PATH — when the caller does NOT pass `pricingConfig`
 *      (backward compatibility), the repository takes the readDbPricingConfig
 *      fallback (the pricing reads DO happen) but the write is STILL the ONE
 *      composite RPC — the single round-trip holds on both config paths.
 *   B. MULTI-STUDENT + TRANSPORT CONTENT — 2 students (one with a transport
 *      tier): the RPC payload carries per-student `student_ref` indexes
 *      (0/1), the transport charges/tranches ONLY for the transport student,
 *      the family-level fee with `student_ref: null`, and the code-bearing
 *      source_id identity tokens for every row.
 *   C. §15.37 AT THE SEAM — a blank `classId` string is nulled before the
 *      call (the blank-string-to-typed-RPC-arg class dies at the client
 *      seam, never reaching the jsonb→uuid cast inside the RPC).
 *
 * The one-round-trip pin itself, the billing content for the default
 * 1-student shape, the mapping of the returned rows, the atomic error
 * mapping and the idempotent retry live in the t-397 suite (updated the
 * same session — this file deliberately does not duplicate them).
 *
 * Run:
 *   npx vitest run src/tests/infrastructure/t-398-single-roundtrip-registration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseStudentRepository } from "../../infrastructure/supabase/repositories/supabase-shared-repositories";
import type { BatchRegistrationInput } from "../../domain/model/student";
import { defaultPricingConfig } from "../../infrastructure/mock/pricing-seed";

beforeAll(() => {
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: "00000000-0000-0000-0000-000000000001", userId: "staff-1" }),
  );
});
afterAll(() => {
  localStorage.removeItem("el-imtiyaz.session");
});

type Row = Record<string, unknown>;

function makeCountingClient() {
  const calls = {
    rpc: [] as Array<{ name: string; args?: Record<string, unknown> }>,
    reads: [] as string[],
    upserts: [] as Array<{ table: string; count: number }>,
  };
  let idSeq = 0;
  const uuid = () => {
    idSeq += 1;
    return `00000000-0000-0000-0000-${String(idSeq).padStart(12, "0")}`;
  };
  const client = {
    rpc: (name: string, args?: Record<string, unknown>) => {
      calls.rpc.push({ name, args });
      if (name !== "register_family_batch") {
        return Promise.resolve({ data: null, error: { message: `unexpected rpc ${name}` } });
      }
      const p = (args?.p_parent ?? {}) as Row;
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
      const students = ((args?.p_students ?? []) as Row[]).map((s) => ({
        id: uuid(),
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
      }));
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
    },
    from: (table: string) => {
      const selectBuilder = {
        eq: () => selectBuilder,
        is: () => selectBuilder,
        order: () => selectBuilder,
        limit: () => selectBuilder,
        maybeSingle: () => {
          calls.reads.push(table);
          return Promise.resolve({ data: null, error: null });
        },
        then: (onFulfilled: (v: { data: Row[]; error: unknown }) => void, onRejected?: (e: unknown) => void) => {
          calls.reads.push(table);
          // readDbPricingConfig's tables return empty lists → the seed
          // fallback (the honest degraded path) — the charges still build.
          return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
        },
      };
      return {
        select: () => selectBuilder,
        upsert: (rows: Row[] | Row) => {
          const list = Array.isArray(rows) ? rows : [rows];
          calls.upserts.push({ table, count: list.length });
          return { select: () => Promise.resolve({ data: list, error: null }) };
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const STUDENT = (over: Partial<BatchRegistrationInput["students"][number]> = {}) => ({
  firstName: "Enfant",
  lastName: "Sonde",
  gender: "unspecified" as const,
  birthDate: "2014-05-01",
  level: "cem" as const,
  gradeYear: 1,
  gradeLevel: "1am" as const,
  paymentPlan: "tranches" as const,
  remise: 0,
  chargeStickerPrice: false,
  medicalNotes: null,
  classId: null,
  middleName: null,
  transportTier: null,
  ...over,
});

/* ================================================================== */
/* A. The fallback path (no pricingConfig — backward compatible)        */
/* ================================================================== */

describe("T-398 A. the pricingConfig fallback — the single RPC holds on both config paths", () => {
  it("without pricingConfig: the readDbPricingConfig reads happen, but the write is STILL one register_family_batch RPC", async () => {
    const { client, calls } = makeCountingClient();
    const repo = new SupabaseStudentRepository(client);
    const r = await repo.batchRegister({
      parent: {
        firstName: "Famille",
        lastName: "Sonde",
        phone: "0554288197",
        gender: "unspecified",
        preferredLanguage: "fr",
      },
      students: [STUDENT()],
      includeRegistration: true,
      includeTransport: false,
      // NOTE: no pricingConfig — the fallback path (any pre-T-398 caller).
    });
    expect(r.ok).toBe(true);

    // The fallback pricing reads DID happen — with the mock's empty
    // pricing_configs the reader short-circuits after the first two tables
    // (every later read is guarded by `if (cfg)`; the seed config covers
    // the rest — the honest degraded path).
    expect(calls.reads.length).toBeGreaterThanOrEqual(2);
    expect(calls.reads).toContain("pricing_configs");
    expect(calls.reads).toContain("academic_levels");

    // But the WRITE is still the ONE composite RPC — no upserts, no
    // per-entity calls, no follow-up fetches.
    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0].name).toBe("register_family_batch");
    expect(calls.upserts).toHaveLength(0);
  });

  it("with pricingConfig: ZERO reads (the wizard's default — the t-397 pin, restated for the contrast)", async () => {
    const { client, calls } = makeCountingClient();
    const repo = new SupabaseStudentRepository(client);
    const r = await repo.batchRegister({
      parent: {
        firstName: "Famille",
        lastName: "Sonde",
        phone: "0554288197",
        gender: "unspecified",
        preferredLanguage: "fr",
      },
      students: [STUDENT()],
      includeRegistration: true,
      includeTransport: false,
      pricingConfig: defaultPricingConfig,
    });
    expect(r.ok).toBe(true);
    expect(calls.reads).toHaveLength(0);
    expect(calls.rpc).toHaveLength(1);
  });
});

/* ================================================================== */
/* B. Multi-student + transport content                                 */
/* ================================================================== */

describe("T-398 B. the multi-student + transport payload", () => {
  it("carries per-student student_ref indexes, transport rows ONLY for the transport student, and the null-ref family fee", async () => {
    const { client, calls } = makeCountingClient();
    const repo = new SupabaseStudentRepository(client);
    const r = await repo.batchRegister({
      parent: {
        firstName: "Famille",
        lastName: "Sonde",
        phone: "0554288197",
        gender: "unspecified",
        preferredLanguage: "fr",
        transportDestination: null,
      },
      students: [
        STUDENT({ firstName: "Ainee", transportTier: null }),
        STUDENT({ firstName: "Cadet", transportTier: "boumerdes" }),
      ],
      includeRegistration: true,
      includeTransport: true,
      pricingConfig: defaultPricingConfig,
    });
    expect(r.ok).toBe(true);

    const args = calls.rpc[0].args as {
      p_students: Row[];
      p_ledger_entries: Row[];
      p_installments: Row[];
    };
    expect(args.p_students).toHaveLength(2);
    const code0 = args.p_students[0].student_code as string;
    const code1 = args.p_students[1].student_code as string;
    expect(code0).not.toBe(code1);

    // Student 0: tuition only (no transport tier, no parent destination).
    const ref0 = args.p_ledger_entries.filter((e) => e.student_ref === 0);
    const ref1 = args.p_ledger_entries.filter((e) => e.student_ref === 1);
    const fee = args.p_ledger_entries.filter((e) => e.student_ref === null);
    expect(ref0.every((e) => e.category === "tuition")).toBe(true);
    // Student 1: tuition + transport.
    expect(ref1.some((e) => e.category === "tuition")).toBe(true);
    expect(ref1.some((e) => e.category === "transport")).toBe(true);
    // The family fee: exactly one, null ref, source_id on the parent code.
    expect(fee).toHaveLength(1);

    // The identity tokens: every row's source_id carries the RIGHT code.
    for (const e of ref0) {
      expect(String(e.source_id)).toContain(code0);
    }
    for (const e of ref1) {
      expect(String(e.source_id)).toContain(code1);
    }

    // Installments mirror the charges per student.
    const inst0 = args.p_installments.filter((i) => i.student_ref === 0);
    const inst1 = args.p_installments.filter((i) => i.student_ref === 1);
    expect(inst0.every((i) => i.category === "tuition")).toBe(true);
    expect(inst1.some((i) => i.category === "transport")).toBe(true);
    for (const i of args.p_installments) {
      const code = i.student_ref === 0 ? code0 : code1;
      expect(i.source_id).toBe(`${code}:${i.category}:T${i.tranche_number}`);
    }
  });
});

/* ================================================================== */
/* C. §15.37 at the seam — the blank-string uuid guard                  */
/* ================================================================== */

describe("T-398 C. the §15.37 blank-string guard at the single-call seam", () => {
  it("a blank classId string is nulled before the call (never reaches the jsonb→uuid cast)", async () => {
    const { client, calls } = makeCountingClient();
    const repo = new SupabaseStudentRepository(client);
    const r = await repo.batchRegister({
      parent: {
        firstName: "Famille",
        lastName: "Sonde",
        phone: "0554288197",
        gender: "unspecified",
        preferredLanguage: "fr",
      },
      students: [STUDENT({ classId: "" })],
      includeRegistration: false,
      includeTransport: false,
      pricingConfig: defaultPricingConfig,
    });
    expect(r.ok).toBe(true);
    const args = calls.rpc[0].args as { p_students: Row[] };
    expect(args.p_students[0].class_id).toBeNull();
  });
});
