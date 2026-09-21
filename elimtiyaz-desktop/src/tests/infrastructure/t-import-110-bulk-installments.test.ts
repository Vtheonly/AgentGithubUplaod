/**
 * IMPORT-110 — the bulkImportInstallments fix (81st session, 2026-09-21).
 *
 * What this suite pins:
 *
 *   1. THE WIRE FORM — the bulk upsert must use `ignoreDuplicates: true`
 *      (ON CONFLICT DO NOTHING, no arbiter) and must NEVER send an
 *      `onConflict` column list again: the 0032 identity index is PARTIAL
 *      and PostgreSQL's ON CONFLICT (columns) inference cannot match it —
 *      the old form returned HTTP 400 42P10 on EVERY live call, silently
 *      degraded to Ok([]) by the old warn-and-continue (live-proven by the
 *      T-396 CRUD suite).
 *   2. THE HONEST ERROR — a chunk failure now returns Err (the adapter's
 *      catch aborts the import) instead of warn + continue + Ok([]).
 *   3. THE IDEMPOTENT SKIP — re-imported identities are skipped (the
 *      IMPORT-107 philosophy); fresh rows insert; the returned list
 *      carries only the actually-inserted rows.
 *
 * NOTE (the lesson): the mocked client cannot reproduce PostgREST's ON
 * CONFLICT inference rules — that is exactly why this defect survived every
 * prior suite and was only caught by the T-396 LIVE run. The wire-form pin
 * below (asserting the exact upsert options) is the regression guard the
 * mock CAN provide.
 *
 * Run:
 *   npx vitest run src/tests/infrastructure/t-import-110-bulk-installments.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseInstallmentRepository } from "../../infrastructure/supabase/repositories/supabase-shared-repositories";
import type { ImportInstallmentInput } from "../../domain/repository/repository";
import type { Result } from "../../core/result";
import type { Installment } from "../../domain/model/payment";

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

/* ------------------------------------------------------------------ */
/* The fake client — the installments surface only                      */
/* ------------------------------------------------------------------ */

type Row = Record<string, any>;

interface FakeCall {
  table: string;
  rows: Row[];
  options: Record<string, unknown> | undefined;
}

function makeFakeClient(opts: { failFirstChunkWith?: { code: string; message: string } } = {}) {
  const calls: FakeCall[] = [];
  const installments: Row[] = [];
  let chunkIndex = 0;

  const client = {
    from: (table: string) => {
      if (table !== "installments") throw new Error(`unexpected table ${table}`);
      return {
        select: () => {
          // The seed() read — return the store as-is.
          return Promise.resolve({ data: [...installments], error: null });
        },
        upsert: (rows: Row[] | Row, options?: Record<string, unknown>) => {
          const list = Array.isArray(rows) ? rows : [rows];
          calls.push({ table, rows: list, options });
          const thisChunk = chunkIndex;
          chunkIndex += 1;
          if (opts.failFirstChunkWith && thisChunk === 0) {
            return {
              select: () =>
                Promise.resolve({ data: null, error: opts.failFirstChunkWith }),
            };
          }
          // ON CONFLICT DO NOTHING semantics against the identity columns:
          // (tenant_id, parent_id, student_id, category, tranche_number).
          const inserted: Row[] = [];
          for (const r of list) {
            const clash = installments.some(
              (x) =>
                x.tenant_id === r.tenant_id &&
                x.parent_id === r.parent_id &&
                x.student_id === r.student_id &&
                x.category === r.category &&
                x.tranche_number === r.tranche_number,
            );
            if (!clash) {
              const row = { id: `inst-${installments.length + 1}`, ...r };
              installments.push(row);
              inserted.push(row);
            }
          }
          return {
            select: () => Promise.resolve({ data: inserted, error: null }),
          };
        },
      };
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
  return { client: client as unknown as SupabaseClient, calls, installments };
}

const INPUT = (n: 1 | 2 | 3, amount = 1000): ImportInstallmentInput => ({
  parentId: "parent-1",
  studentId: "student-1",
  category: "tuition",
  trancheNumber: n,
  label: `T${n}`,
  amountDue: amount,
  amountPaid: 0,
  dueDate: "2026-10-01",
  paidDate: null,
  status: "unpaid",
});

/* ------------------------------------------------------------------ */
/* The pins                                                             */
/* ------------------------------------------------------------------ */

describe("IMPORT-110 — bulkImportInstallments (the live-broken upsert fix)", () => {
  it("uses the ignoreDuplicates wire form and NEVER an onConflict column list", async () => {
    const { client, calls } = makeFakeClient();
    const repo = new SupabaseInstallmentRepository(client);
    const r = await repo.bulkImportInstallments([INPUT(1), INPUT(2), INPUT(3)]);
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].options).toBeDefined();
    // THE pin: ignoreDuplicates present, onConflict ABSENT.
    expect(calls[0].options!.ignoreDuplicates).toBe(true);
    expect("onConflict" in calls[0].options!).toBe(false);
  });

  it("returns only the actually-inserted rows (idempotent skip on re-import)", async () => {
    const { client } = makeFakeClient();
    const repo = new SupabaseInstallmentRepository(client);
    const first = await repo.bulkImportInstallments([INPUT(1), INPUT(2), INPUT(3)]);
    expect(first.ok).toBe(true);
    expect((first as Result<readonly Installment[]> & { ok: true }).value).toHaveLength(3);

    // Re-import the same identities + one NEW tranche (amount changed on a
    // conflicting row — the skip means the EXISTING row stays, per
    // IMPORT-107; the per-row importInstallment remains the update path).
    const second = await repo.bulkImportInstallments([
      INPUT(1, 9999), // conflict → skipped
      { ...INPUT(2), category: "transport" }, // new identity → inserted
    ]);
    expect(second.ok).toBe(true);
    expect((second as Result<readonly Installment[]> & { ok: true }).value).toHaveLength(1);
  });

  it("FAILS honestly on a chunk error (never Ok([]) again)", async () => {
    const { client } = makeFakeClient({
      failFirstChunkWith: { code: "42P10", message: "no unique or exclusion constraint" },
    });
    const repo = new SupabaseInstallmentRepository(client);
    const r = await repo.bulkImportInstallments([INPUT(1), INPUT(2), INPUT(3)]);
    // The old behavior: warn + continue → Ok([]) — silent total data loss.
    expect(r.ok).toBe(false);
    const err = (r as { error: { message: string; userMessage: string } }).error;
    expect(err.message).toContain("bulkImportInstallments chunk 0");
    expect(err.message).toContain("no unique or exclusion constraint");
  });
});
