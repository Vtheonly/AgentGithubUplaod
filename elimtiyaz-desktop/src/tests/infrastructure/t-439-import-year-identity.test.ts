/**
 * T-439 — DATA-055 regression suite: the desktop import path's YEAR-AWARE
 * identity (the 0129 `installments_bulk_import_identity_idx` client-side
 * mirror).
 *
 * THE BUG (registered before the fix per §13): migration 0129 made the
 * installments identity YEAR-SCOPED server-side (COALESCE year component)
 * so a continuing student can carry the same tranche in two academic
 * years — but the desktop twins were never aligned:
 *
 *   1. `importInstallment`'s find matched (tenant, parent, student,
 *      category, tranche) WITHOUT the year — post-0129 `.maybeSingle()`
 *      throws PGRST116 on the two-row match, and pre-0129-style it
 *      matched the WRONG (prior-year) row;
 *   2. the UPDATE branch overwrote `academic_year_id` unconditionally
 *      (re-derived from the NEW due date — the INV-18b freeze broken
 *      client-side; the 0127 server twin COALESCEs);
 *   3. `listImportInstallmentIdentities` + the adapter's preflight key
 *      carried no year — a NEXT-YEAR workbook's tranches for every
 *      continuing student were silently dropped client-side as
 *      "already imported" (the exact DATA-054 class 0129 fixed
 *      server-side, resurrected on the client).
 *
 * THE FIX mirrors the 0129 semantics exactly: exact-year row preferred,
 * then the NULL-year (claimable legacy) row; COALESCE preservation on
 * update; the preflight key gains the year component through the SAME
 * resolver the write path stamps with.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseInstallmentRepository } from "../../infrastructure/supabase/repositories/supabase-shared-repositories";
import type { ImportInstallmentInput, InstallmentRepository } from "../../domain/repository/repository";
import { RepositoryStorageAdapter } from "../../infrastructure/excel/import-engine/storage/repository-adapter";
import { MockInstallmentRepository } from "../../infrastructure/mock/repositories/financial-repository";
import { store } from "../../infrastructure/mock/repositories/mock-store";
import type { Result } from "../../core/result";
import type { Installment } from "../../domain/model/payment";

const TENANT = "00000000-0000-0000-0000-000000000001";
beforeAll(() => {
  localStorage.setItem("el-imtiyaz.session", JSON.stringify({ tenantId: TENANT, userId: "staff-1" }));
});
afterAll(() => {
  localStorage.removeItem("el-imtiyaz.session");
});

const YEAR_A = "11111111-1111-1111-1111-111111111111"; // 2026-2027
const YEAR_B = "22222222-2222-2222-2222-222222222222"; // 2027-2028

/* ------------------------------------------------------------------ */
/* The fake Supabase client — the installments + academic_years tables  */
/* ------------------------------------------------------------------ */

type Row = Record<string, any>;

interface QueryCall {
  table: string;
  filters: Record<string, unknown>;
  op: "select-one" | "insert" | "update" | "select-all";
  row?: Row;
}

function makeYearAwareFakeClient() {
  const installments: Row[] = [];
  const calls: QueryCall[] = [];
  let seq = 0;

  const matches = (r: Row, f: Record<string, unknown>) =>
    Object.entries(f).every(([k, v]) => (v === null ? r[k] === null : r[k] === v));

  // The keyset-preflight's .gt("id", lastId) — encoded as `id__gt`.
  const applyGt = (rows: Row[], f: Record<string, unknown>) =>
    f.id__gt != null ? rows.filter((r) => String(r.id) > String(f.id__gt)) : rows;

  const client = {
    from(table: string) {
      if (table === "academic_years") {
        return {
          select: () => ({
            order: () =>
              Promise.resolve({
                data: [
                  { id: YEAR_A, start_date: "2026-09-01", end_date: "2027-06-30" },
                  { id: YEAR_B, start_date: "2027-09-01", end_date: "2028-06-30" },
                ],
                error: null,
              }),
          }),
        };
      }
      if (table !== "installments") throw new Error(`unexpected table ${table}`);
      return {
        select: (cols: string) => {
          const filters: Record<string, unknown> = {};
          let resultLimit = Infinity;
          const builder = {
            eq(k: string, v: unknown) { filters[k] = v; return builder; },
            is(k: string, v: unknown) { filters[k] = v; return builder; },
            gt(k: string, v: unknown) { filters[`${k}__gt`] = v; return builder; },
            order() { return builder; },
            limit(n: number) { resultLimit = n; return builder; },
            maybeSingle() {
              const found = applyGt(installments.filter((r) => matches(r, filters)), filters);
              if (found.length > 1) {
                calls.push({ table, filters, op: "select-one" });
                return Promise.resolve({
                  data: null,
                  error: { code: "PGRST116", message: "multiple rows returned" },
                });
              }
              calls.push({ table, filters, op: "select-one" });
              return Promise.resolve({ data: found[0] ?? null, error: null });
            },
            then(resolve: any, reject: any) {
              // The awaited-list path (seed(), .limit(2) probes, the
              // keyset preflight pages).
              calls.push({ table, filters, op: "select-all" });
              const rows = applyGt(
                installments.filter((r) => matches(r, filters)),
                filters,
              ).slice(0, resultLimit);
              return resolve
                ? Promise.resolve(resolve({ data: rows, error: null }))
                : Promise.reject(reject);
            },
          };
          void cols;
          return builder;
        },
        insert(row: Row) {
          return {
            select: () => ({
              single: () => {
                seq += 1;
                const inserted = { id: `ins-${seq}`, ...row };
                installments.push(inserted);
                calls.push({ table, filters: {}, op: "insert", row });
                return Promise.resolve({ data: inserted, error: null });
              },
            }),
          };
        },
        update(row: Row) {
          return {
            eq(k: string, v: unknown) {
              const idx = installments.findIndex((r) => r[k] === v);
              if (idx >= 0) installments[idx] = { ...installments[idx], ...row };
              calls.push({ table, filters: { [k]: v }, op: "update", row });
              return Promise.resolve({ error: null });
            },
          };
        },
        upsert(rows: Row[] | Row, options?: Record<string, unknown>) {
          void options;
          const list = Array.isArray(rows) ? rows : [rows];
          const inserted: Row[] = [];
          for (const r of list) {
            const clash = installments.some(
              (x) =>
                x.tenant_id === r.tenant_id &&
                x.parent_id === r.parent_id &&
                x.student_id === r.student_id &&
                x.category === r.category &&
                x.tranche_number === r.tranche_number &&
                (x.academic_year_id ?? "NULL") === (r.academic_year_id ?? "NULL"),
            );
            if (!clash) {
              seq += 1;
              const row = { id: `ins-${seq}`, ...r };
              installments.push(row);
              inserted.push(row);
            }
          }
          return { select: () => Promise.resolve({ data: inserted, error: null }) };
        },
      };
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
  return { client: client as unknown as SupabaseClient, calls, installments };
}

const INPUT = (dueDate: string): ImportInstallmentInput => ({
  parentId: "par-1",
  studentId: "stu-1",
  category: "tuition",
  trancheNumber: 1,
  label: "Tranche 1",
  amountDue: 40_000,
  amountPaid: 0,
  dueDate,
  paidDate: null,
  status: "unpaid",
});

/* ------------------------------------------------------------------ */
/* 1. The Supabase importInstallment year-aware identity                */
/* ------------------------------------------------------------------ */

describe("T-439 / DATA-055 — Supabase importInstallment mirrors the 0129 year-aware identity", () => {
  it("a continuing student's NEXT-YEAR tranche INSERTS (never matches the prior-year row, never PGRST116)", async () => {
    const { client, installments } = makeYearAwareFakeClient();
    const repo = new SupabaseInstallmentRepository(client);
    // The prior-year row exists (year A).
    const first = await repo.importInstallment(INPUT("2026-09-15"));
    expect(first.ok).toBe(true);
    expect(installments).toHaveLength(1);
    expect(installments[0].academic_year_id).toBe(YEAR_A);

    // THE regression: the same tranche in year B — the old year-blind
    // find matched the year-A row (or threw PGRST116 through PostgREST).
    const second = await repo.importInstallment({ ...INPUT("2027-09-15"), amountDue: 45_000 });
    expect(second.ok).toBe(true);
    expect(installments).toHaveLength(2);
    expect(installments[0].amount_due).toBe(40_000); // year A untouched
    expect(installments[1].academic_year_id).toBe(YEAR_B);
    expect(installments[1].amount_due).toBe(45_000);
  });

  it("a SAME-YEAR re-import UPDATES the exact-year row in place", async () => {
    const { client, installments } = makeYearAwareFakeClient();
    const repo = new SupabaseInstallmentRepository(client);
    await repo.importInstallment(INPUT("2026-09-15"));
    const again = await repo.importInstallment({ ...INPUT("2026-09-15"), amountPaid: 10_000 });
    expect(again.ok).toBe(true);
    expect(installments).toHaveLength(1); // updated, not duplicated
    expect(installments[0].amount_paid).toBe(10_000);
  });

  it("a NULL-year legacy row is CLAIMED and stamped when the due date resolves (the 0129 Identity-2)", async () => {
    const { client, installments } = makeYearAwareFakeClient();
    // A pre-0127 legacy row: identity match, no year.
    installments.push({
      id: "ins-legacy", tenant_id: TENANT, parent_id: "par-1", student_id: "stu-1",
      category: "tuition", tranche_number: 1, academic_year_id: null, amount_due: 1,
    });
    const repo = new SupabaseInstallmentRepository(client);
    const res = await repo.importInstallment(INPUT("2026-09-15"));
    expect(res.ok).toBe(true);
    expect(installments).toHaveLength(1); // claimed, not duplicated
    expect(installments[0].id).toBe("ins-legacy");
    expect(installments[0].academic_year_id).toBe(YEAR_A); // stamped
  });

  it("an UNRESOLVABLE due date NEVER overwrites the persisted year (the INV-18b COALESCE freeze)", async () => {
    const { client, installments } = makeYearAwareFakeClient();
    // A row already attributed to year A whose due date is later moved
    // outside every window (the échéance-edit scenario).
    installments.push({
      id: "ins-frozen", tenant_id: TENANT, parent_id: "par-1", student_id: "stu-1",
      category: "tuition", tranche_number: 1, academic_year_id: YEAR_A,
      amount_due: 40_000, amount_paid: 0, amount_pending: 0, due_date: "2026-09-15",
      paid_date: null, status: "unpaid", label: "Tranche 1", payment_plan: "tranches",
      is_custom_schedule: false, custom_schedule_note: null, source_type: "bulk_import",
      source_id: "x", academic_cycle: null, created_at: "2026-01-01", updated_at: "2026-01-01",
    });
    const repo = new SupabaseInstallmentRepository(client);
    // Due date 2030 — outside both windows → resolution NULL.
    const res = await repo.importInstallment({ ...INPUT("2030-01-01"), amountDue: 42_000 });
    expect(res.ok).toBe(true);
    const row = installments.find((r: Row) => r.id === "ins-frozen")!;
    expect(row.academic_year_id).toBe(YEAR_A); // COALESCE preserved
    expect(row.amount_due).toBe(42_000); // the row itself updated
  });

  it("listImportInstallmentIdentities keys by the YEAR (the COALESCE mirror)", async () => {
    const { client, installments } = makeYearAwareFakeClient();
    const repo = new SupabaseInstallmentRepository(client);
    await repo.importInstallment(INPUT("2026-09-15"));
    await repo.importInstallment({ ...INPUT("2027-09-15") });
    const ids = await repo.listImportInstallmentIdentities();
    expect(ids.has(`par-1|stu-1|tuition|1|${YEAR_A}`)).toBe(true);
    expect(ids.has(`par-1|stu-1|tuition|1|${YEAR_B}`)).toBe(true);
    // The year-blind key is GONE — a next-year import must not be eaten.
    expect(ids.has("par-1|stu-1|tuition|1")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 2. The adapter preflight — the year-scoped cross-run dedup           */
/* ------------------------------------------------------------------ */

function makeFakeRepo(
  existingKeys: Set<string>,
  yearByDue: Map<string, string | null>,
  withResolver = true,
): InstallmentRepository & { written: ImportInstallmentInput[] } {
  const written: ImportInstallmentInput[] = [];
  const base: Record<string, unknown> = {
    written,
    async listImportInstallmentIdentities() {
      return new Set(existingKeys);
    },
    async bulkImportInstallmentsWithProgress(
      inputs: readonly ImportInstallmentInput[],
      onProgress?: (n: number) => void,
    ) {
      written.push(...inputs);
      onProgress?.(inputs.length);
      return { ok: true, value: inputs.map(() => ({} as Installment)) };
    },
  };
  // The resolver is genuinely ABSENT when withResolver=false — the
  // adapter's `typeof === "function"` guard must see the legacy shape.
  if (withResolver) {
    base.resolveImportAcademicYearId = async (dueDate: string) => yearByDue.get(dueDate) ?? null;
  }
  return base as unknown as InstallmentRepository & { written: ImportInstallmentInput[] };
}

describe("T-439 / DATA-055 — the adapter's installments preflight is year-scoped", () => {
  async function runImport(repo: Partial<InstallmentRepository>): Promise<ImportInstallmentInput[]> {
    const fake = repo as InstallmentRepository;
    const adapter = new RepositoryStorageAdapter({
      parents: null as never, students: null as never, ledger: null as never,
      payments: null as never, installments: fake, tenantId: TENANT,
      actorId: "staff-1", actorName: "Test",
    });
    // Two pending rows: the SAME tranche in year A (already imported) and
    // in year B (the continuing student's new obligation).
    const flush = (adapter as unknown as { flushPendingBatches(): Promise<void> });
    (adapter as unknown as { pendingInstallments: ImportInstallmentInput[] }).pendingInstallments = [
      INPUT("2026-09-15"),
      { ...INPUT("2027-09-15"), amountDue: 45_000 },
    ];
    await flush.flushPendingBatches.call(adapter);
    return (fake as unknown as { written: ImportInstallmentInput[] }).written ?? [];
  }

  it("drops the same-year re-import but KEEPS the next-year tranche (the DATA-055 core)", async () => {
    const repo = makeFakeRepo(
      new Set([`par-1|stu-1|tuition|1|${YEAR_A}`]),
      new Map([["2026-09-15", YEAR_A], ["2027-09-15", YEAR_B]]),
    );
    const written = await runImport(repo);
    expect(written).toHaveLength(1);
    expect(written[0].dueDate).toBe("2027-09-15");
  });

  it("a NULL-year resolution groups under the empty key (the COALESCE zero-uuid semantics)", async () => {
    const repo = makeFakeRepo(
      new Set(["par-1|stu-1|tuition|1|"]), // the NULL-year legacy group
      new Map([["2030-01-01", null]]),
    );
    const written = await runImport(repo);
    // The NULL-year pending row hits the NULL-year existing key → dropped.
    expect(written).toHaveLength(0);
  });

  it("a repository WITHOUT the resolver falls back to the LEGACY year-blind key (the pre-T-439 contract)", async () => {
    const repo = makeFakeRepo(
      new Set(["par-1|stu-1|tuition|1"]),
      new Map(),
      false, // NO resolver — the legacy pre-T-439 repository shape
    );
    const written = await runImport(repo);
    // Legacy semantics: the year-blind key matches both rows' identities →
    // the FIRST pending row is dropped as a duplicate; the second is a
    // within-batch duplicate of the first → also dropped. (This pins the
    // fallback's shape, not its desirability — the Supabase/mock twins
    // both carry the resolver.)
    expect(written).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* 3. The mock twin parity                                              */
/* ------------------------------------------------------------------ */

describe("T-439 / DATA-055 — the mock twin stamps + scopes identically", () => {
  it("two years of the same tranche mint TWO rows (the mock-side DATA-054), each stamped", async () => {
    const yearsBackup = store.academicYears;
    // REPLACE (not extend): the seed years overlap the probe windows and
    // the resolver's latest-start preference would tie-break to the seed.
    store.academicYears = [
      { id: YEAR_A, tenantId: TENANT, code: "2026-2027", label: "2026-2027", startDate: "2026-09-01", endDate: "2027-06-30", termStructure: "trimester", isCurrent: false, isArchived: false },
      { id: YEAR_B, tenantId: TENANT, code: "2027-2028", label: "2027-2028", startDate: "2027-09-01", endDate: "2028-06-30", termStructure: "trimester", isCurrent: false, isArchived: false },
    ] as typeof store.academicYears;
    const instBackup = store.installments;
    try {
      const before = store.installments.length;
      const repo = new MockInstallmentRepository();
      const a = await repo.bulkImportInstallments([INPUT("2026-09-15")]);
      const b = await repo.bulkImportInstallments([INPUT("2027-09-15")]);
      expect(a.ok && a.value.length).toBe(1);
      expect(b.ok && b.value.length).toBe(1);
      expect(store.installments.length).toBe(before + 2); // TWO rows — the old mock collapsed them
      const yearARow = store.installments.find((i) => i.academicYearId === YEAR_A);
      const yearBRow = store.installments.find((i) => i.academicYearId === YEAR_B);
      expect(yearARow?.amountDue).toBe(40_000);
      expect(yearBRow?.amountDue).toBe(40_000);
      // The identities are year-scoped.
      const ids = await repo.listImportInstallmentIdentities();
      expect(ids.has(`par-1|stu-1|tuition|1|${YEAR_A}`)).toBe(true);
      expect(ids.has(`par-1|stu-1|tuition|1|${YEAR_B}`)).toBe(true);
      // A re-import of year A updates in place (idempotent).
      const again = await repo.bulkImportInstallments([INPUT("2026-09-15")]);
      expect(again.ok && again.value.length).toBe(1);
      expect(store.installments.length).toBe(before + 2);
    } finally {
      store.academicYears = yearsBackup;
      store.installments = instBackup;
      store.notifyInstallments?.();
    }
  });
});
