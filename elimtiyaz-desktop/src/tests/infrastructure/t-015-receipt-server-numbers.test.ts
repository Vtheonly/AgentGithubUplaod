/**
 * T-015 — server-authoritative receipt numbers regression suite (DRIFT-011).
 *
 * Problem: receipt numbers were generated client-side on the import + sync
 * paths (desktop `PAY-{ts}-{random}` in bulkCollect, `PAY-YYYY-{random}` in
 * the sync-queue push, fabricated `REC-${paymentId}` display fallback) while
 * ADR-004 makes the sequential server-side number the only legitimate source.
 *
 * Fixed (migration 0058 + this repo):
 *  - bulkCollect allocates missing numbers via ONE `generate_receipt_numbers`
 *    RPC call and fails fast if allocation fails / miscounts;
 *  - the sync-queue payment push passes NULL (server generates);
 *  - generateReceipt shows an honest placeholder instead of fabricating REC-.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabasePaymentRepository } from "../../infrastructure/supabase/repositories/supabase-shared-repositories";

// T-053 (TENANT-103): getTenantId() no longer falls back to the demo tenant —
// tests that exercise tenant-scoped repositories set an explicit working
// tenant (the value the old fallback used to inject implicitly).
beforeAll(() => {
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: "00000000-0000-0000-0000-000000000001", userId: "staff-1" }),
  );
});
afterAll(() => {
  localStorage.removeItem("el-imtiyaz.session");
});


type Row = Record<string, any>;

type RpcCall = { fn: string; args: Row };
type RpcHandler = (args: Row) => { data: unknown; error: unknown } | Promise<{ data: unknown; error: unknown }>;

function makeClient(opts: {
  rpcHandlers?: Record<string, RpcHandler>;
  insertError?: { code: string; message: string } | null;
}) {
  const rpcCalls: RpcCall[] = [];
  const insertedRows: Row[] = [];
  const client = {
    rpc(fn: string, args: Row) {
      rpcCalls.push({ fn, args });
      const handler = opts.rpcHandlers?.[fn];
      if (!handler) return Promise.resolve({ data: null, error: { message: `function ${fn} not found` } });
      return Promise.resolve(handler(args));
    },
    from(_table: string) {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.insert = (payload: Row | Row[]) => {
        if (opts.insertError) {
          q.__outcome = { data: null, error: opts.insertError };
        } else {
          const items = Array.isArray(payload) ? payload : [payload];
          const withIds = items.map((item, i) => ({
            id: item.id ?? `pay-${i}`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...item,
          }));
          insertedRows.push(...withIds);
          q.__outcome = { data: withIds, error: null };
        }
        return q;
      };
      q.then = (resolve: unknown) =>
        Promise.resolve(q.__outcome ?? { data: null, error: null }).then(resolve as never);
      return q;
    },
  };
  return { client: client as unknown as SupabaseClient, rpcCalls, insertedRows };
}

const TENANT = "00000000-0000-0000-0000-000000000001";

const baseInput = {
  parentId: "p-1",
  studentId: "s-1",
  amount: 1000,
  method: "cash" as const,
  category: "tuition" as const,
  installmentId: null,
};

describe("T-015 — bulkCollect allocates missing receipt numbers server-side (DRIFT-011)", () => {
  it("calls generate_receipt_numbers once with the exact missing count and stamps the allocated numbers", async () => {
    const { client, rpcCalls, insertedRows } = makeClient({
      rpcHandlers: {
        generate_receipt_numbers: () => ({
          data: ["REC-2026-000901", "REC-2026-000902"],
          error: null,
        }),
      },
    });
    const repo = new SupabasePaymentRepository(client);
    const result = await repo.bulkCollect([
      { input: { ...baseInput }, collectedBy: "staff-1" },                     // no number → allocated
      { input: { ...baseInput, receiptNumber: "PAY-EXISTING-1" }, collectedBy: "staff-1" }, // keeps its own
      { input: { ...baseInput }, collectedBy: "staff-1" },                     // no number → allocated
    ]);
    expect(result.ok).toBe(true);
    const allocCalls = rpcCalls.filter((c) => c.fn === "generate_receipt_numbers");
    expect(allocCalls).toHaveLength(1);
    expect(allocCalls[0].args).toEqual({ p_tenant_id: TENANT, p_count: 2 });
    expect(insertedRows).toHaveLength(3);
    expect(insertedRows[0].payment_number).toBe("REC-2026-000901");
    expect(insertedRows[1].payment_number).toBe("PAY-EXISTING-1");
    expect(insertedRows[2].payment_number).toBe("REC-2026-000902");
    // No client-side PAY- fabrication anywhere in the inserted batch.
    for (const r of insertedRows) expect(r.payment_number).not.toMatch(/^PAY-\d+-/);
  });

  it("does not call the allocator when every input already carries a receipt number", async () => {
    const { client, rpcCalls, insertedRows } = makeClient({});
    const repo = new SupabasePaymentRepository(client);
    const result = await repo.bulkCollect([
      { input: { ...baseInput, receiptNumber: "PAY-R1" }, collectedBy: "staff-1" },
      { input: { ...baseInput, receiptNumber: "PAY-R2" }, collectedBy: "staff-1" },
    ]);
    expect(result.ok).toBe(true);
    expect(rpcCalls.filter((c) => c.fn === "generate_receipt_numbers")).toHaveLength(0);
    expect(insertedRows.map((r) => r.payment_number)).toEqual(["PAY-R1", "PAY-R2"]);
  });

  it("fails fast (Err, zero rows inserted) when server allocation fails", async () => {
    const { client, insertedRows } = makeClient({
      rpcHandlers: {
        generate_receipt_numbers: () => ({
          data: null,
          error: { message: "relation missing" },
        }),
      },
    });
    const repo = new SupabasePaymentRepository(client);
    const result = await repo.bulkCollect([{ input: { ...baseInput }, collectedBy: "staff-1" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("receipt-number allocation failed");
    expect(insertedRows).toHaveLength(0);
  });

  it("fails fast when the server allocates a mismatched count (defensive)", async () => {
    const { client, insertedRows } = makeClient({
      rpcHandlers: {
        generate_receipt_numbers: () => ({ data: ["REC-2026-000001"], error: null }), // 1 ≠ 2 requested
      },
    });
    const repo = new SupabasePaymentRepository(client);
    const result = await repo.bulkCollect([
      { input: { ...baseInput }, collectedBy: "staff-1" },
      { input: { ...baseInput }, collectedBy: "staff-1" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("expected 2");
    expect(insertedRows).toHaveLength(0);
  });
});

describe("T-015 — source-scan guards (no client-side receipt fabrication left)", () => {
  const SRC = join(__dirname, "../../");

  function walk(dir: string, acc: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        // Only scan app code (mock is the documented demo mirror; tests
        // legitimately mention the old formats).
        if (name === "mock" || name === "tests" || name === "test") continue;
        walk(full, acc);
      } else if (/\.(ts|tsx)$/.test(name)) {
        acc.push(full);
      }
    }
    return acc;
  }

  it("no random PAY- receipt generation in app code (bulkCollect + sync push cleaned)", () => {
    // Receipt-specific: a PAY- literal combined with a randomness/time source
    // on the same line. (ELV-/PAR- code generation is T-018's scope.)
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const lines = readFileSync(file, "utf8").split("\n");
      const bad = lines.some((l) => /PAY-/.test(l) && /(Date\.now\(\)|Math\.random\(\))/.test(l));
      if (bad) offenders.push(file.replace(SRC, ""));
    }
    expect(offenders).toEqual([]);
  });

  it("sync-provider passes NULL for missing payment numbers (server-side generation)", () => {
    const text = readFileSync(join(SRC, "app/providers/sync-provider.tsx"), "utf8");
    expect(text).toContain("p_payment_number: (p.receiptNumber as string) ?? (p.payment_number as string) ?? null");
    expect(text).not.toMatch(/p_payment_number:[^\n]*PAY-/);
  });

  it("generateReceipt no longer fabricates REC-{paymentId} numbers", () => {
    const text = readFileSync(
      join(SRC, "infrastructure/supabase/repositories/supabase-shared-repositories.ts"),
      "utf8",
    );
    expect(text).not.toContain("REC-${paymentId}");
  });
});
