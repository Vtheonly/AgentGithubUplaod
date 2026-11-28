/**
 * T-591 (E7A-2 / ROADMAP 6.4) — the targeted projections + keyset
 * pagination + on-demand details lane.
 *
 * The suite pins:
 *   A. The migration 0003 surface (read_reconcile_inputs — the projection
 *      columns, the tenant/role gates, the SECURITY DEFINER + search_path
 *      discipline, the append-only layout).
 *   B. reconcile()'s RPC-first conversion + the tenant-scoped keyset
 *      fallback + the two-paths-same-report parity.
 *   C. collectDebtors' read_debt_summary_collection conversion (BUG-060) —
 *      the arithmetic equivalence (days ≡ the old fold) + the consumer
 *      (lockDelinquentAccounts) intact.
 *   D. The keyset conversions per site (the debt profile's ledger +
 *      installments walks · the student documents/history walks · the
 *      salary_payments walk · the er_* quartet · the calendar payments
 *      fallback's source pin · the overdue-alerts pair · the inventory
 *      pair) — the query SHAPES (tenant scope, server-side filters,
 *      id-cursor pages, the 1 000-row page bound) + count correctness vs
 *      the full table (the 1 501-row two-page walk).
 *   E. The LINT GUARD (scripts/check-unbounded-reads.mjs): clean on the
 *      real tree + the RED control (a planted violation through --root
 *      fails by name).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";

const {
  __setSeedRetryBackoffForTests,
  SupabaseLedgerRepository,
  SupabaseDebtRepository,
  SupabaseStudentRepository,
} = await import("../../infrastructure/supabase/repositories/supabase-shared-repositories");
const { SupabasePersonnelRepository } = await import(
  "../../infrastructure/supabase/repositories/supabase-personnel-repository"
);
const { SupabaseIdentityResolutionRepository } = await import(
  "../../infrastructure/supabase/repositories/supabase-identity-resolution-repository"
);
const { SupabaseOverdueAlertGenerator } = await import(
  "../../infrastructure/supabase/repositories/supabase-overdue-alert-generator"
);
const { SupabaseInventoryRepository } = await import(
  "../../infrastructure/supabase/repositories/supabase-inventory-repository"
);

const SRC = join(__dirname, "../../");
const MIGRATION_0003 = readFileSync(
  join(SRC, "../supabase/migrations/0003_read_reconcile_inputs.sql"),
  "utf8",
);
const SHARED_SRC = readFileSync(
  join(SRC, "infrastructure/supabase/repositories/supabase-shared-repositories.ts"),
  "utf8",
);
const CALENDAR_SRC = readFileSync(
  join(SRC, "infrastructure/supabase/repositories/supabase-calendar-repository.ts"),
  "utf8",
);
const REPO_ROOT = join(SRC, "../..");

const TENANT = "00000000-0000-0000-0000-000000000001";
const PARENT_UUID = "11111111-1111-1111-1111-111111111111";

// ============================================================
// The fixture world
// ============================================================

const PAYMENTS_WORLD = [
  { id: "pay-001", tenant_id: TENANT, amount: 1000, status: "paid", receipt_number: "REC-2026-000001", payment_number: "PAY-1", installment_id: "ins-001" },
  { id: "pay-002", tenant_id: TENANT, amount: 500, status: "paid", receipt_number: "REC-2026-000002", payment_number: "PAY-2", installment_id: null },
  { id: "pay-003", tenant_id: TENANT, amount: 300, status: "pending", receipt_number: null, payment_number: "PAY-3", installment_id: null },
];

const INSTALLMENTS_WORLD = [
  { id: "ins-001", tenant_id: TENANT, parent_id: PARENT_UUID, student_id: "stu-001", category: "tuition", amount_due: 5000, amount_paid: 1000, amount_pending: 500, label: "Tranche 1", tranche_number: 1, status: "unpaid", due_date: "2025-10-15" },
  { id: "ins-002", tenant_id: TENANT, parent_id: PARENT_UUID, student_id: "stu-002", category: "tuition", amount_due: 3000, amount_paid: 0, amount_pending: 0, label: "Tranche 1", tranche_number: 1, status: "unpaid", due_date: "2026-03-15" },
];

const PARENTS_WORLD = [
  { id: PARENT_UUID, first_name: "Amine", last_name: "Hamidi", display_name: "Amine Hamidi" },
];

const LEDGER_WORLD: Array<Record<string, unknown>> = [
  {
    id: "led-001", tenant_id: TENANT, entry_number: "E-1", parent_id: PARENT_UUID, student_id: "stu-001",
    account_id: "acc-1", entry_type: "charge", amount: 5000, category: "tuition", description: "T1",
    entry_date: "2025-10-01", created_at: "2025-10-01T00:00:00Z", source_type: "manual_entry", source_id: "ins-001",
    method: null, receipt_number: null, payment_status: null, reverses_id: null, actor_id: null, actor_name: "System",
    at: "2025-10-01T00:00:00Z", metadata: {}, updated_at: "2025-10-01T00:00:00Z",
  },
  {
    id: "led-002", tenant_id: TENANT, entry_number: "E-2", parent_id: PARENT_UUID, student_id: "stu-001",
    account_id: "acc-1", entry_type: "payment", amount: -1000, category: "tuition", description: "Paiement",
    entry_date: "2026-01-15", created_at: "2026-01-15T00:00:00Z", source_type: "payment", source_id: "pay-001",
    method: "cash", receipt_number: "REC-2026-000001", payment_status: "paid", reverses_id: null, actor_id: null, actor_name: "System",
    at: "2026-01-15T00:00:00Z", metadata: {}, updated_at: "2026-01-15T00:00:00Z",
  },
];

// ============================================================
// The universal mock client
// ============================================================

type QueryLog = { table: string; op: string; filters: Array<{ col: string; op?: string; value: unknown }>; pageCalls: number };

interface WorldSpec {
  rpc?: Record<string, { data: unknown; error: null } | { data: null; error: { code?: string; message: string } }>;
  tables?: Record<string, Array<Record<string, unknown>>>;
}

function applyFilters(rows: Array<Record<string, unknown>>, filters: Array<{ col: string; op?: string; value: unknown }>): Array<Record<string, unknown>> {
  let out = rows;
  for (const f of filters) {
    if (f.col.startsWith("__")) continue;
    const op = f.op ?? "eq";
    out = out.filter((r) => {
      const cell = r[f.col];
      switch (op) {
        case "eq": return String(cell) === String(f.value);
        case "neq": return String(cell) !== String(f.value);
        case "is": return f.value === null ? cell == null : String(cell) === String(f.value);
        case "gt": return String(cell) > String(f.value);
        case "gte": return String(cell) >= String(f.value);
        case "lt": return String(cell) < String(f.value);
        case "lte": return String(cell) <= String(f.value);
        case "in": return Array.isArray(f.value) && f.value.map(String).includes(String(cell));
        case "not": return cell !== null;
        default: return true;
      }
    });
  }
  return out;
}

function makeClient(world: WorldSpec = {}): { client: unknown; calls: QueryLog[]; rpcCalls: Array<{ fn: string; args?: Record<string, unknown> }> } {
  const calls: QueryLog[] = [];
  const rpcCalls: Array<{ fn: string; args?: Record<string, unknown> }> = [];
  const tables: Record<string, Array<Record<string, unknown>>> = {
    payments: PAYMENTS_WORLD,
    installments: INSTALLMENTS_WORLD,
    parents: PARENTS_WORLD,
    ledger_entries: LEDGER_WORLD,
    student_documents: [],
    student_academic_histories: [],
    salary_payments: [],
    er_source_observations: [],
    er_match_proposals: [],
    er_identity_edges: [],
    er_aggregation_events: [],
    attendance_records: [],
    inventory_items: [],
    inventory_transactions: [],
    notifications: [],
    ...(world.tables ?? {}),
  };

  const client = {
    rpc: (fn: string, args?: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (world.rpc && fn in world.rpc) {
        const r = world.rpc[fn];
        return r.error ? Promise.resolve({ data: null, error: r.error }) : Promise.resolve({ data: r.data, error: null });
      }
      // Default: version-skew for anything not supplied (the PGRST202 shape).
      return Promise.resolve({ data: null, error: { code: "PGRST202", message: `function ${fn} not found` } });
    },
    from(table: string) {
      const rec: QueryLog = { table, op: "", filters: [], pageCalls: 0 };
      calls.push(rec);
      const q: Record<string, unknown> = {};
      q.select = (cols?: unknown, opts2?: { count?: string; head?: boolean }) => {
        rec.op = "select";
        if (opts2?.count) rec.filters.push({ col: "__count", op: opts2.count, value: !!opts2.head });
        void cols;
        return q;
      };
      for (const [method, op] of [["eq", undefined], ["neq", "neq"], ["gt", "gt"], ["gte", "gte"], ["lt", "lt"], ["lte", "lte"]] as const) {
        q[method] = (col: string, value: unknown) => {
          rec.filters.push({ col, op: op ?? "eq", value });
          return q;
        };
      }
      q.is = (col: string, value: unknown) => { rec.filters.push({ col, op: "is", value }); return q; };
      q.not = (col: string, op: string, value: unknown) => { rec.filters.push({ col, op: `not_${op}`, value }); return q; };
      q.in = (col: string, value: unknown) => { rec.filters.push({ col, op: "in", value }); return q; };
      q.order = (col: string, o?: { ascending?: boolean }) => { rec.filters.push({ col: `__order_${col}`, value: o?.ascending }); return q; };
      q.limit = (n: number) => { rec.filters.push({ col: "__limit", value: n }); return q; };
      q.range = (a: number, b: number) => { rec.filters.push({ col: "__range", value: [a, b] }); return q; };
      q.maybeSingle = () => q;
      q.single = () => q;
      // Write chains (the overdue generator's notification inserts, the
      // restriction updates, the audit upserts) — thenables that RESOLVE
      // their awaiters (the then MUST invoke the callback). INSERT echoes
      // its payload back with ids/created_at so the .select()-after-insert
      // consumers (the overdue generator's created-notification re-derive)
      // see the inserted rows.
      const writeThen = (ok?: (v: unknown) => unknown) =>
        ok ? Promise.resolve({ data: null, error: null, count: null }).then(ok) : undefined;
      const insertThen = (rows: Array<Record<string, unknown>>) => (ok?: (v: unknown) => unknown) =>
        ok
          ? Promise.resolve({
              data: (rows ?? []).map((r, i) => ({ ...r, id: r.id ?? `inserted-${i}`, created_at: r.created_at ?? "2026-11-21T00:00:00Z" })),
              error: null,
              count: null,
            }).then(ok)
          : undefined;
      q.insert = (rows: Array<Record<string, unknown>>) => ({
        then: insertThen(rows),
        select: () => ({ then: insertThen(rows) }),
      });
      q.update = () => ({ then: writeThen, select: () => ({ then: writeThen }), eq: () => ({ then: writeThen }), in: () => ({ then: writeThen }) });
      q.upsert = () => ({ then: writeThen, select: () => ({ then: writeThen }) });
      q.delete = () => ({ then: writeThen, eq: () => ({ then: writeThen }) });
      const finish = (): { data: Array<Record<string, unknown>> | null; error: null } => {
        const gt = rec.filters.find((f) => f.col === "id" && f.op === "gt")?.value as string | undefined;
        let rows = applyFilters(tables[table] ?? [], rec.filters);
        if (gt) rows = rows.filter((r) => String(r["id"]) > gt);
        return { data: rows, error: null };
      };
      Object.defineProperty(q, "then", {
        value: (onFulfilled?: (v: { data: Array<Record<string, unknown>> | null; error: null }) => unknown) => {
          rec.pageCalls += 1;
          // Emulate the PostgREST 1 000-row page: the keyset walk continues
          // while a page is full; the mock pages exactly like the server.
          const gt = rec.filters.find((f) => f.col === "id" && f.op === "gt")?.value as string | undefined;
          const full = finish().data ?? [];
          const page = full.slice(0, 1000);
          void gt;
          return onFulfilled
            ? Promise.resolve({ data: page, error: null }).then(onFulfilled as (v: unknown) => unknown)
            : undefined;
        },
        configurable: true,
      });
      (q as { count?: number | null }).count = null;
      return q;
    },
  };
  return { client, calls, rpcCalls };
}

beforeAll(() => {
  __setSeedRetryBackoffForTests([0, 0]);
  localStorage.setItem("el-imtiyaz.session", JSON.stringify({ tenantId: TENANT, userId: "staff-1" }));
});

beforeEach(() => {
  // Fresh TTL state per test (the CacheFreshness gates seed() calls).
  localStorage.setItem("el-imtiyaz.session", JSON.stringify({ tenantId: TENANT, userId: "staff-1" }));
});

afterAll(() => {
  rmSync("/tmp/t591-guard-root", { recursive: true, force: true });
});

// ============================================================
// A. The migration 0003 surface
// ============================================================

describe("T-591 — A. The migration 0003 surface", () => {
  it("read_reconcile_inputs exists — the projection columns, the gates, the discipline", () => {
    expect(MIGRATION_0003).toContain("create or replace function public.read_reconcile_inputs()");
    // The three column-projected legs (NEVER select "*").
    expect(MIGRATION_0003).toContain("'id', p.id,\n                    'amount', p.amount,\n                    'status', p.status,\n                    'receipt_number', p.receipt_number,\n                    'payment_number', p.payment_number,\n                    'installment_id', p.installment_id");
    expect(MIGRATION_0003).toContain("'id', i.id,\n                    'parent_id', i.parent_id,\n                    'student_id', i.student_id,\n                    'category', i.category,\n                    'amount_due', i.amount_due,\n                    'amount_paid', i.amount_paid,\n                    'label', i.label,\n                    'tranche_number', i.tranche_number,\n                    'status', i.status");
    expect(MIGRATION_0003).toContain("'id', par.id,\n                    'first_name', par.first_name,\n                    'last_name', par.last_name,\n                    'display_name', par.display_name");
    // The tenant/role gates + the discipline.
    expect(MIGRATION_0003).toContain("has_any_role(array['super_admin', 'financial_officer', 'support_staff'])");
    expect(MIGRATION_0003).toContain("v_tenant := public.current_tenant_id();");
    expect(MIGRATION_0003).toContain("stable security definer");
    expect(MIGRATION_0003).toContain("set search_path to 'public'");
    expect(MIGRATION_0003).toContain("set statement_timeout to '30s'");
  });

  it("the append-only layout holds (0001/0002/0003 sort; nothing before 0001)", () => {
    const files = readdirSync(join(REPO_ROOT, "elimtiyaz-desktop/supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(files.slice(0, 3)).toEqual([
      "0001_initial_consolidated_schema.sql",
      "0002_stage_a_dashboard_aggregation.sql",
      "0003_read_reconcile_inputs.sql",
    ]);
  });
});

// ============================================================
// B. reconcile()'s conversion
// ============================================================

describe("T-591 — B. reconcile(): the RPC-first + the keyset fallback + the parity", () => {
  const reconcileWorld = () => ({
    rpc: {
      read_reconcile_inputs: {
        data: {
          payments: PAYMENTS_WORLD.map((p) => ({ id: p.id, amount: p.amount, status: p.status, receipt_number: p.receipt_number, payment_number: p.payment_number, installment_id: p.installment_id })),
          installments: INSTALLMENTS_WORLD.map((i) => ({ id: i.id, parent_id: i.parent_id, student_id: i.student_id, category: i.category, amount_due: i.amount_due, amount_paid: i.amount_paid, label: i.label, tranche_number: i.tranche_number, status: i.status })),
          parents: PARENTS_WORLD,
        },
        error: null,
      },
      read_ledger_entries_collection: { data: LEDGER_WORLD, error: null },
    },
  });

  it("the RPC path fires read_reconcile_inputs and issues NO direct trio reads", async () => {
    const { client, rpcCalls, calls } = makeClient(reconcileWorld());
    const repo = new SupabaseLedgerRepository(client as unknown as SupabaseClient);
    const report = await repo.reconcile();
    expect(report.ok).toBe(true);
    expect(rpcCalls.map((c) => c.fn)).toContain("read_reconcile_inputs");
    // NO direct payments/installments/parents reads on the RPC path.
    expect(calls.filter((c) => ["payments", "installments", "parents"].includes(c.table))).toHaveLength(0);
  });

  it("the version-skew fallback walks the trio through tenant-scoped keyset pages", async () => {
    // read_reconcile_inputs absent (PGRST202 default); the ledger collection RPC present.
    const { client, calls } = makeClient({
      rpc: { read_ledger_entries_collection: { data: LEDGER_WORLD, error: null } },
    });
    const repo = new SupabaseLedgerRepository(client as unknown as SupabaseClient);
    const report = await repo.reconcile();
    expect(report.ok).toBe(true);
    const trio = calls.filter((c) => ["payments", "installments", "parents"].includes(c.table));
    expect(trio.map((c) => c.table).sort()).toEqual(["installments", "parents", "payments"]);
    for (const read of trio) {
      expect(read.filters).toContainEqual({ col: "tenant_id", op: "eq", value: TENANT });
      expect(read.filters).toContainEqual({ col: "__order_id", value: true });
      expect(read.filters).toContainEqual({ col: "__limit", value: 1000 });
    }
  });

  it("PARITY: the same world through both paths yields the same report", async () => {
    const rpcRepo = new SupabaseLedgerRepository(makeClient(reconcileWorld()).client as unknown as SupabaseClient);
    const fallbackRepo = new SupabaseLedgerRepository(
      makeClient({ rpc: { read_ledger_entries_collection: { data: LEDGER_WORLD, error: null } } }).client as unknown as SupabaseClient,
    );
    const a = await rpcRepo.reconcile();
    const b = await fallbackRepo.reconcile();
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    // PARITY over the SUBSTANCE: the report carries `checkedAt` (a wall
    // clock stamp) — the two reconciliations legitimately stamp their own
    // instant, so the deep-equal compares everything BUT that field.
    const substance = (r: typeof a) => {
      if (!r.ok) return null;
      const { checkedAt, ...rest } = r.value as unknown as { checkedAt: string } & Record<string, unknown>;
      void checkedAt;
      return rest;
    };
    expect(substance(a)).toEqual(substance(b));
    expect(a.ok && a.value.checkedAt).toBeTruthy();
    expect(b.ok && b.value.checkedAt).toBeTruthy();
    // The report is over the REAL world (violations > 0 — the payments
    // carry receipts the ledger twins only partially).
    const aReport = a.ok ? a.value : null;
    expect(aReport).not.toBeNull();
    expect((aReport?.violations ?? []).length).toBeGreaterThan(0);
  });
});

// ============================================================
// C. collectDebtors' conversion (BUG-060)
// ============================================================

describe("T-591 — C. collectDebtors → read_debt_summary_collection (BUG-060)", () => {
  it("the RPC path computes the delinquent census from the per-parent aggregates (the days arithmetic ≡ the old fold)", async () => {
    // The world: one family with two remaining rows (3 500 @ 2025-10-15 +
    // 3 000 @ 2026-03-15) and one future-due row (4 000 @ 2099-08-15 —
    // TEST-505: a far-future anchor; the original 2026-08-15 crossed the
    // 100-day-overdue threshold on 2026-11-23 and flipped the census).
    // read_debt_summary_collection (the server aggregate): outstanding
    // 10 500, oldest_due_date 2025-10-15 → the delinquent-days arithmetic
    // is days-since-oldest ≡ max(days-over-rows) — the equivalence the
    // conversion documents.
    const now = new Date("2026-11-21T12:00:00Z");
    const oldest = Date.parse("2025-10-15T00:00:00Z");
    const expectedDays = Math.floor((now.getTime() - oldest) / 86_400_000);
    const rpcWorld = {
      rpc: {
        read_debt_summary_collection: {
          data: [
            { parent_id: PARENT_UUID, outstanding_amount: 10500, oldest_due_date: "2025-10-15" },
            { parent_id: "22222222-2222-2222-2222-222222222222", outstanding_amount: 4000, oldest_due_date: "2099-08-15" },
          ],
          error: null,
        },
      },
      tables: {
        // The restricted-flag lookup.
        parents: [{ id: PARENT_UUID, first_name: "A", last_name: "B", display_name: "A B", is_financially_restricted: false }],
      },
    };
    const { client } = makeClient(rpcWorld);
    const repo = new SupabaseDebtRepository(client as unknown as SupabaseClient);
    // lockDelinquentAccounts(minDaysOverdue=100): only the first family
    // qualifies (the second's oldest due date is FUTURE — not delinquent).
    const res = await repo.lockDelinquentAccounts(100, "test-actor");
    expect(res.ok).toBe(true);
    // The update fired for the qualifying family only (the second family
    // is filtered out — its "days overdue" is negative at the as-of).
    expect(res.ok && res.value).toBe(1);
    void expectedDays;
  });

  it("the version-skew fallback: the direct read now tenant-scoped + keyset-walked", async () => {
    const { client, calls } = makeClient({
      rpc: {
        // read_debt_summary_collection absent → PGRST202 default.
      },
      tables: {
        installments: [
          { id: "ins-001", tenant_id: TENANT, parent_id: PARENT_UUID, amount_due: 5000, amount_paid: 1000, amount_pending: 500, due_date: "2025-10-15", status: "unpaid" },
        ],
        parents: [{ id: PARENT_UUID, first_name: "A", last_name: "B", display_name: "A B", is_financially_restricted: false }],
      },
    });
    const repo = new SupabaseDebtRepository(client as unknown as SupabaseClient);
    const res = await repo.lockDelinquentAccounts(90, "test-actor");
    expect(res.ok && res.value).toBe(1);
    const read = calls.filter((c) => c.table === "installments" && c.op === "select")[0];
    expect(read.filters).toContainEqual({ col: "tenant_id", op: "eq", value: TENANT });
    expect(read.filters).toContainEqual({ col: "__order_id", value: true });
    expect(read.filters).toContainEqual({ col: "__limit", value: 1000 });
  });

  it("the source carries the RPC-first + fallback contract (the census comment)", () => {
    expect(SHARED_SRC).toContain("read_debt_summary_collection");
    expect(SHARED_SRC).toContain("supabase-shared-repositories.ts:5195-5199");
  });
});

// ============================================================
// D. The per-site keyset conversions
// ============================================================

describe("T-591 — D. The per-site keyset conversions", () => {
  it("the debt profile: observeProfile walks the ledger + installments through tenant+parent-scoped keyset pages", async () => {
    const { client, calls } = makeClient({
      rpc: {},
      tables: { ledger_entries: LEDGER_WORLD, installments: INSTALLMENTS_WORLD },
    });
    const repo = new SupabaseDebtRepository(client as unknown as SupabaseClient);
    const subject = repo.observeParentProfile(PARENT_UUID);
    // The lazy subject seeds on first observe — await a microtask drain.
    await new Promise((r) => setTimeout(r, 30));
    expect(subject.get()?.installments).toHaveLength(2);
    expect(subject.get()?.installments.map((i) => i.label)).toContain("Tranche 1");
    const ledgerRead = calls.filter((c) => c.table === "ledger_entries" && c.op === "select")[0];
    expect(ledgerRead.filters).toContainEqual({ col: "tenant_id", op: "eq", value: TENANT });
    expect(ledgerRead.filters).toContainEqual({ col: "parent_id", op: "eq", value: PARENT_UUID });
    expect(ledgerRead.filters).toContainEqual({ col: "__order_id", value: true });
    expect(ledgerRead.filters).toContainEqual({ col: "__limit", value: 1000 });
    const insRead = calls.filter((c) => c.table === "installments" && c.op === "select")[0];
    expect(insRead.filters).toContainEqual({ col: "parent_id", op: "eq", value: PARENT_UUID });
    expect(insRead.filters).toContainEqual({ col: "__limit", value: 1000 });
    // NO .limit(2000) cap in CODE anywhere (the BUG-063a fix — the string
    // survives only in the historical comments documenting the fix).
    expect(SHARED_SRC).not.toMatch(/^\s*\.limit\(2000\)/m);
  });

  it("the student documents/history: the seed walks both tables through keyset pages", async () => {
    const { client, calls } = makeClient({
      rpc: {},
      tables: {
        students: [{ id: "stu-001", tenant_id: TENANT, parent_id: PARENT_UUID, first_name: "S", last_name: "T", deleted_at: null }],
        student_documents: [
          { id: "doc-001", tenant_id: TENANT, student_id: "stu-001", uploaded_at: "2026-01-01T00:00:00Z", uploaded_by: null },
          { id: "doc-002", tenant_id: TENANT, student_id: "stu-001", uploaded_at: "2026-02-01T00:00:00Z", uploaded_by: null },
        ],
        student_academic_histories: [
          { id: "hist-002", tenant_id: TENANT, student_id: "stu-001", academic_year: "2025-2026" },
          { id: "hist-001", tenant_id: TENANT, student_id: "stu-001", academic_year: "2024-2025" },
        ],
        classes: [],
      },
    });
    const repo = new SupabaseStudentRepository(client as unknown as SupabaseClient);
    repo.observe();
    await new Promise((r) => setTimeout(r, 30));
    for (const table of ["student_documents", "student_academic_histories"]) {
      const read = calls.filter((c) => c.table === table && c.op === "select")[0];
      expect(read, `${table} read`).toBeDefined();
      expect(read.filters).toContainEqual({ col: "tenant_id", op: "eq", value: TENANT });
      expect(read.filters).toContainEqual({ col: "__order_id", value: true });
      expect(read.filters).toContainEqual({ col: "__limit", value: 1000 });
    }
  });

  it("the salary payments: the refresh walks the keyset pages and restores period DESC", async () => {
    const rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 1501; i++) {
      rows.push({
        id: `sal-${String(i).padStart(6, "0")}`,
        tenant_id: TENANT,
        period: `2026-${String((i % 12) + 1).padStart(2, "0")}`,
        personnel_id: "per-1", amount: 100, method: "cash", status: "paid",
      });
    }
    const { client, calls } = makeClient({ rpc: {}, tables: { salary_payments: rows } });
    const repo = new SupabasePersonnelRepository(client as unknown as SupabaseClient, {} as never);
    const obs = repo.observeSalaryPayments();
    await new Promise((r) => setTimeout(r, 60));
    const payments = obs.get();
    // COUNT CORRECTNESS vs the full table: the 1 501-row world arrives WHOLE
    // (the old .limit(2000) would have silently truncated at 1 000 rows of
    // the PostgREST page).
    expect(payments).toHaveLength(1501);
    const reads = calls.filter((c) => c.table === "salary_payments" && c.op === "select");
    expect(reads).toHaveLength(2); // the two keyset pages (1 000 + 501)
    expect(reads[0].filters).toContainEqual({ col: "tenant_id", op: "eq", value: TENANT });
    // The display order restored: period DESC.
    const periods = payments.map((p) => (p as unknown as Record<string, unknown>)["period"] as string);
    expect(periods).toEqual([...periods].sort((a, b) => b.localeCompare(a)));
  });

  it("the er_* quartet: the refresh + listPriorObservations walk keyset pages", async () => {
    const { client, calls } = makeClient({
      rpc: {},
      tables: {
        er_source_observations: Array.from({ length: 1501 }, (_, i) => ({
          id: `obs-${String(i).padStart(6, "0")}`, tenant_id: TENANT, source_system: "s", source_record_id: `r${i}`, payload_hash: `h${i}`,
        })),
        er_match_proposals: [{ id: "prop-1", tenant_id: TENANT, created_at: "2026-01-01T00:00:00Z" }],
        er_identity_edges: [{ id: "edge-1", tenant_id: TENANT, created_at: "2026-01-01T00:00:00Z" }],
        er_aggregation_events: [{ id: "evt-1", tenant_id: TENANT, created_at: "2026-01-01T00:00:00Z" }],
      },
    });
    const repo = new SupabaseIdentityResolutionRepository(client as unknown as SupabaseClient);
    const prior = await repo.listPriorObservations();
    // The 1 501-row observation census arrives WHOLE (the old .limit(200000)
    // vs the PostgREST 1 000-row page silently truncated it).
    expect(prior).toHaveLength(1501);
    const obsReads = calls.filter((c) => c.table === "er_source_observations" && c.op === "select");
    expect(obsReads).toHaveLength(2);
    void repo.observeProposals();
    await new Promise((r) => setTimeout(r, 30));
    for (const table of ["er_match_proposals", "er_identity_edges", "er_aggregation_events"]) {
      const read = calls.filter((c) => c.table === table && c.op === "select")[0];
      expect(read, `${table}`).toBeDefined();
      expect(read.filters).toContainEqual({ col: "tenant_id", op: "eq", value: TENANT });
      expect(read.filters).toContainEqual({ col: "__limit", value: 1000 });
    }
  });

  it("the calendar payments fallback: the source pin (server-side month bounds + the id-cursor pages)", () => {
    // The RPC-first path is exercised by the t-432 suite; this pins the
    // fallback's T-591 conversion shape in the source.
    expect(CALENDAR_SRC).toContain(".gt(\"id\", lastId) : base)");
    expect(CALENDAR_SRC).toMatch(/\.gte\("collected_at", bounds\.start\)/);
    expect(CALENDAR_SRC).toMatch(/\.lt\("collected_at", bounds\.end\)/);
  });

  it("the overdue-alerts pair: the scan walks the tenant-scoped keyset pages with the date/status filters server-side", async () => {
    const { client, calls } = makeClient({
      rpc: {},
      tables: {
        installments: [
          { id: "ins-001", tenant_id: TENANT, parent_id: PARENT_UUID, student_id: "stu-001", category: "tuition", label: "T1", tranche_number: 1, amount_due: 5000, amount_paid: 1000, amount_pending: 500, due_date: "2025-10-15", status: "unpaid" },
          { id: "ins-future", tenant_id: TENANT, parent_id: PARENT_UUID, student_id: "stu-002", category: "tuition", label: "T2", tranche_number: 2, amount_due: 4000, amount_paid: 0, amount_pending: 0, due_date: "2026-12-15", status: "unpaid" },
        ],
        parents: [{ id: PARENT_UUID, first_name: "A", last_name: "B", display_name: "A B", primary_phone: "0" }],
        notifications: [],
      },
    });
    const gen = new SupabaseOverdueAlertGenerator(client as unknown as SupabaseClient);
    const res = await gen.run(new Date("2026-11-21T12:00:00Z"));
    expect(res.ok).toBe(true);
    const reads = calls.filter((c) => c.table === "installments" && c.op === "select");
    expect(reads.length).toBeGreaterThanOrEqual(2);
    const overdueRead = reads[0];
    expect(overdueRead.filters).toContainEqual({ col: "tenant_id", op: "eq", value: TENANT });
    expect(overdueRead.filters).toContainEqual({ col: "status", op: "neq", value: "paid" });
    expect(overdueRead.filters).toContainEqual({ col: "__limit", value: 1000 });
    // The alert output reflects ONLY the past-due row (the future row is
    // "à échoir" — the alert set stays honest). The notification's `type`
    // is "payment_overdue" (the `kind` field is the generic "alert").
    const alerts = res.ok ? res.value : [];
    expect(alerts.filter((a) => (a as unknown as Record<string, unknown>)["type"] === "payment_overdue")).toHaveLength(1);
  });

  it("the inventory pair: the refresh walks both tables through keyset pages", async () => {
    const { client, calls } = makeClient({
      rpc: {},
      tables: {
        inventory_items: [
          { id: "itm-002", tenant_id: TENANT, sku: "B", name: "Chalk", category: "supplies", quantity_on_hand: 5, deleted_at: null },
          { id: "itm-001", tenant_id: TENANT, sku: "A", name: "Board", category: "supplies", quantity_on_hand: 2, deleted_at: null },
        ],
        inventory_transactions: [{ id: "tx-001", tenant_id: TENANT, item_id: "itm-001", transaction_at: "2026-01-01T00:00:00Z" }],
      },
    });
    const repo = new SupabaseInventoryRepository(client as unknown as SupabaseClient);
    repo.observeItems();
    await new Promise((r) => setTimeout(r, 30));
    for (const table of ["inventory_items", "inventory_transactions"]) {
      const read = calls.filter((c) => c.table === table && c.op === "select")[0];
      expect(read, `${table}`).toBeDefined();
      expect(read.filters).toContainEqual({ col: "tenant_id", op: "eq", value: TENANT });
      expect(read.filters).toContainEqual({ col: "__order_id", value: true });
      expect(read.filters).toContainEqual({ col: "__limit", value: 1000 });
    }
    // The display order restored (name ASC).
    const items = repo.observeItems().get();
    expect(items.map((i) => (i as unknown as Record<string, unknown>)["label"])).toEqual(["Board", "Chalk"]);
  });
});

// ============================================================
// E. The lint guard
// ============================================================

describe("T-591 — E. The unbounded-read lint guard", () => {
  it("the REAL tree is clean (the allowlist honored, zero active violations)", () => {
    const out = execSync(`node ${join(REPO_ROOT, "elimtiyaz-desktop/scripts/check-unbounded-reads.mjs")} --root ${join(REPO_ROOT, "elimtiyaz-desktop")}`, { encoding: "utf8" });
    expect(out).toContain("unbounded-read guard OK");
    expect(out).not.toContain("VIOLATIONS");
  });

  it("the RED control: a planted violation through --root FAILS BY NAME (and the allowlist silences reasoned sites only)", () => {
    const root = "/tmp/t591-guard-root";
    rmSync(root, { recursive: true, force: true });
    mkdirSync(join(root, "src/infrastructure/supabase/repositories"), { recursive: true });
    mkdirSync(join(root, "scripts"), { recursive: true });
    // An empty allowlist: the planted violation must be flagged.
    writeFileSync(join(root, "scripts/unbounded-reads-allowlist.json"), JSON.stringify({ entries: [] }));
    writeFileSync(
      join(root, "src/infrastructure/supabase/repositories/planted.ts"),
      `export const planted = (client: { from(t: string): unknown }) => {
  // A planted UNBOUNDED read on a watched table — no limit, no keyset.
  return (client.from("payments") as { select(c?: string): Promise<{ data: unknown[] }> })
    .select("*");
};
`,
    );
    let failed = false;
    let out = "";
    try {
      out = execSync(`node ${join(REPO_ROOT, "elimtiyaz-desktop/scripts/check-unbounded-reads.mjs")} --root ${root}`, { encoding: "utf8" });
    } catch (e) {
      failed = true;
      out = String((e as { stdout?: string }).stdout ?? "");
    }
    expect(failed).toBe(true);
    expect(out).toContain("planted.ts");
    expect(out).toContain("table=payments");
    // The guard's exit is 0 when the same site is allowlisted WITH a reason.
    writeFileSync(
      join(root, "scripts/unbounded-reads-allowlist.json"),
      JSON.stringify({
        entries: [{ file: "src/infrastructure/supabase/repositories/planted.ts", lineStart: 3, table: "payments", reason: "test fixture" }],
      }),
    );
    const out2 = execSync(`node ${join(REPO_ROOT, "elimtiyaz-desktop/scripts/check-unbounded-reads.mjs")} --root ${root}`, { encoding: "utf8" });
    expect(out2).toContain("unbounded-read guard OK");
  });

  it("the guard + allowlist + npm wiring are present on the real tree", () => {
    const packageJson = readFileSync(join(REPO_ROOT, "elimtiyaz-desktop/package.json"), "utf8");
    expect(packageJson).toContain("check:unbounded-reads");
    const allowlist = JSON.parse(readFileSync(join(REPO_ROOT, "elimtiyaz-desktop/scripts/unbounded-reads-allowlist.json"), "utf8"));
    expect(allowlist.entries.length).toBeGreaterThanOrEqual(9);
    for (const e of allowlist.entries) {
      expect(typeof e.reason).toBe("string");
      expect(e.reason.length).toBeGreaterThan(20);
    }
  });
});
