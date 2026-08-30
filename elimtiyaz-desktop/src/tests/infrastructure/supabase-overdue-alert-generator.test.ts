/**
 * SupabaseOverdueAlertGenerator unit tests (T-080).
 *
 * Verifies the canonical contract:
 *   1. Scans installments WHERE status != 'paid' AND due_date < now
 *      (overdue) PLUS due_date <= now + 7d (upcoming).
 *   2. Dedupes against existing `notifications` with
 *      link_entity_type='installment' AND link_entity_id=<id>.
 *   3. Inserts ONE notification per new overdue installment, with
 *      priority = urgent (>90d) / high (31-90d) / medium (0-30d).
 *   4. Skips installments where remaining = amount_due - amount_paid <= 0
 *      (fully paid despite status).
 *   5. Writes an audit log entry via `write_audit_log` RPC (best-effort).
 *   6. Returns the list of newly-created domain notifications.
 *
 * The Supabase client is mocked in-test via a fake builder surface
 * matching the (small) PostgREST subset the generator uses:
 * from().select()/insert()/eq/neq/lt/gte/lte/in/order/single/rpc.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseOverdueAlertGenerator } from "../../infrastructure/supabase/repositories/supabase-overdue-alert-generator";

// ============================================================================
// Fake Supabase client — minimal PostgREST builder surface
// ============================================================================

type Row = Record<string, unknown>;

interface FakeTable {
  rows: Row[];
}

class FakeQuery {
  private filters: ((row: Row) => boolean)[] = [];
  private payload: Row | Row[] | null = null;
  private isInsert = false;

  constructor(
    private readonly table: FakeTable,
    private readonly tableName: string,
    private readonly rpcMock?: (name: string, args: Record<string, unknown>) => unknown,
  ) {}

  // Filter operators
  eq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  neq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] !== val);
    return this;
  }
  lt(col: string, val: unknown): this {
    this.filters.push((r) => (r[col] as string) < (val as string));
    return this;
  }
  gte(col: string, val: unknown): this {
    this.filters.push((r) => (r[col] as string) >= (val as string));
    return this;
  }
  lte(col: string, val: unknown): this {
    this.filters.push((r) => (r[col] as string) <= (val as string));
    return this;
  }
  in(col: string, vals: unknown[]): this {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }

  // Terminal: SELECT
  select(_cols?: string): this {
    // For this test we ignore the column projection — return all columns.
    return this;
  }

  // Terminal: INSERT — returns the inserted rows on .select() chain
  insert(rows: Row | Row[]): this {
    this.isInsert = true;
    this.payload = rows;
    return this;
  }

  // After insert + select, this returns the inserted rows
  // We chain .select() after .insert() — so the query result is the inserted rows
  private run(): { data: Row[] | null; error: null } {
    if (this.isInsert) {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      // Add IDs to the inserted rows so the generator can read them back.
      const withIds = rows.map((r, i) => ({
        ...r,
        id: `notif-${i + 1}`,
        created_at: "2026-08-30T00:00:00.000Z",
      }));
      // Apply filters? Insert doesn't apply filters in PostgREST.
      return { data: withIds, error: null };
    }
    // SELECT — apply filters
    const filtered = this.table.rows.filter((r) => this.filters.every((f) => f(r)));
    return { data: filtered, error: null };
  }

  // The Supabase JS client returns a Promise<{data, error}>. We mimic
  // that via then chaining.
  then<TResult1 = { data: Row[] | null; error: null }>(
    onFulfilled:
      | ((value: { data: Row[] | null; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
  ): Promise<TResult1> {
    const result = this.run();
    return Promise.resolve(result).then(onFulfilled) as Promise<TResult1>;
  }
}

class FakeClient {
  tables: Record<string, FakeTable> = {
    installments: { rows: [] },
    parents: { rows: [] },
    notifications: { rows: [] },
  };
  rpcMocks: Record<string, (args: Record<string, unknown>) => unknown> = {};

  from(tableName: string): FakeQuery {
    const table = this.tables[tableName] ?? { rows: [] };
    if (!this.tables[tableName]) this.tables[tableName] = table;
    return new FakeQuery(table, tableName);
  }

  rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    const mock = this.rpcMocks[name];
    if (mock) {
      try {
        const result = mock(args);
        return Promise.resolve(result ?? { data: null, error: null });
      } catch (e) {
        return Promise.reject(e);
      }
    }
    return Promise.resolve({ data: null, error: null });
  }
}

// ============================================================================
// Helper — set localStorage with the tenant id so the generator can resolve it
// ============================================================================

function setSessionTenantId(tenantId: string) {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation((key: string) => {
    if (key === "el-imtiyaz.session") {
      return JSON.stringify({ tenantId });
    }
    return null;
  });
}

// ============================================================================
// Tests
// ============================================================================

const TENANT = "00000000-0000-0000-0000-000000000001";
const PARENT_ID = "11111111-1111-1111-1111-111111111111";
const STUDENT_ID = "22222222-2222-2222-2222-222222222222";
// Use real UUID-format installment IDs — the generator filters
// installment IDs through isUuid() because the notifications table's
// link_entity_id column is a UUID type (non-UUID ids would cause a
// PostgREST IN-list error).
const INST_1 = "33333333-3333-3333-3333-333333333333";
const INST_100 = "44444444-4444-4444-4444-444444444444";
const INST_50 = "55555555-5555-5555-5555-555555555555";
const INST_PAID_BUT_PENDING = "66666666-6666-6666-6666-666666666666";
const INST_DUP = "77777777-7777-7777-7777-777777777777";
const INST_UPCOMING = "88888888-8888-8888-8888-888888888888";
const INST_NAME = "99999999-9999-9999-9999-999999999999";

describe("SupabaseOverdueAlertGenerator — T-080", () => {
  let client: FakeClient;

  beforeEach(() => {
    client = new FakeClient();
    setSessionTenantId(TENANT);
  });

  it("creates overdue alerts for unpaid installments past due_date", async () => {
    // 5 days overdue, 1000 DZD outstanding
    const dueDate = new Date(Date.now() - 5 * 86_400_000).toISOString();
    client.tables.installments.rows = [
      {
        id: INST_1,
        tenant_id: TENANT,
        parent_id: PARENT_ID,
        student_id: STUDENT_ID,
        category: "tuition",
        label: "Tranche 1",
        tranche_number: 1,
        amount_due: 5000,
        amount_paid: 4000,
        amount_pending: 0,
        due_date: dueDate,
        status: "pending",
      },
    ];
    client.tables.parents.rows = [
      {
        id: PARENT_ID,
        tenant_id: TENANT,
        display_name: "Famille Test",
        first_name: "",
        last_name: "Test",
      },
    ];
    // Empty notifications table — no existing alerts to dedup against
    client.tables.notifications.rows = [];
    // Audit RPC mock
    client.rpcMocks.write_audit_log = vi.fn(() => ({ data: null, error: null }));

    const gen = new SupabaseOverdueAlertGenerator(client as unknown as SupabaseClient);
    const result = await gen.run();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const created = result.value;
    expect(created).toHaveLength(1);
    expect(created[0].title).toContain("Famille Test");
    expect(created[0].priority).toBe("medium"); // 5 days → medium
    expect(created[0].type).toBe("payment_overdue");
    expect(created[0].entityType).toBe("installment");
    expect(created[0].entityId).toBe(INST_1);
    expect(created[0].source).toBe("system");
    expect(created[0].targetRole).toBe("financial_officer");
    // Audit log called once with the count
    expect(client.rpcMocks.write_audit_log).toHaveBeenCalledTimes(1);
  });

  it("uses priority 'urgent' for >90 days overdue", async () => {
    const dueDate = new Date(Date.now() - 100 * 86_400_000).toISOString();
    client.tables.installments.rows = [
      {
        id: INST_100,
        tenant_id: TENANT,
        parent_id: PARENT_ID,
        student_id: STUDENT_ID,
        category: "tuition",
        label: "Tranche 100",
        tranche_number: 1,
        amount_due: 10000,
        amount_paid: 0,
        amount_pending: 0,
        due_date: dueDate,
        status: "pending",
      },
    ];
    client.tables.parents.rows = [
      { id: PARENT_ID, tenant_id: TENANT, display_name: "F1", first_name: "", last_name: "L1" },
    ];

    const gen = new SupabaseOverdueAlertGenerator(client as unknown as SupabaseClient);
    const result = await gen.run();
    if (!result.ok) return;
    expect(result.value[0].priority).toBe("urgent");
  });

  it("uses priority 'high' for 31-90 days overdue", async () => {
    const dueDate = new Date(Date.now() - 50 * 86_400_000).toISOString();
    client.tables.installments.rows = [
      {
        id: INST_50,
        tenant_id: TENANT,
        parent_id: PARENT_ID,
        student_id: STUDENT_ID,
        category: "tuition",
        label: "Tranche 50",
        tranche_number: 1,
        amount_due: 10000,
        amount_paid: 0,
        amount_pending: 0,
        due_date: dueDate,
        status: "pending",
      },
    ];
    client.tables.parents.rows = [
      { id: PARENT_ID, tenant_id: TENANT, display_name: "F1", first_name: "", last_name: "L1" },
    ];

    const gen = new SupabaseOverdueAlertGenerator(client as unknown as SupabaseClient);
    const result = await gen.run();
    if (!result.ok) return;
    expect(result.value[0].priority).toBe("high");
  });

  it("skips installments where remaining = amount_due - amount_paid <= 0", async () => {
    const dueDate = new Date(Date.now() - 5 * 86_400_000).toISOString();
    client.tables.installments.rows = [
      {
        id: INST_PAID_BUT_PENDING,
        tenant_id: TENANT,
        parent_id: PARENT_ID,
        student_id: STUDENT_ID,
        category: "tuition",
        label: "Tranche 1",
        tranche_number: 1,
        amount_due: 5000,
        amount_paid: 5000, // fully paid despite status='pending'
        amount_pending: 0,
        due_date: dueDate,
        status: "pending",
      },
    ];
    client.tables.parents.rows = [
      { id: PARENT_ID, tenant_id: TENANT, display_name: "F1", first_name: "", last_name: "L1" },
    ];

    const gen = new SupabaseOverdueAlertGenerator(client as unknown as SupabaseClient);
    const result = await gen.run();
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });

  it("dedups against existing installment alerts (idempotent)", async () => {
    const dueDate = new Date(Date.now() - 5 * 86_400_000).toISOString();
    client.tables.installments.rows = [
      {
        id: INST_DUP,
        tenant_id: TENANT,
        parent_id: PARENT_ID,
        student_id: STUDENT_ID,
        category: "tuition",
        label: "Tranche 1",
        tranche_number: 1,
        amount_due: 5000,
        amount_paid: 0,
        amount_pending: 0,
        due_date: dueDate,
        status: "pending",
      },
    ];
    // An alert already exists for this installment
    client.tables.notifications.rows = [
      {
        id: "existing-notif",
        tenant_id: TENANT,
        link_entity_type: "installment",
        link_entity_id: INST_DUP,
      },
    ];
    client.tables.parents.rows = [
      { id: PARENT_ID, tenant_id: TENANT, display_name: "F1", first_name: "", last_name: "L1" },
    ];

    const gen = new SupabaseOverdueAlertGenerator(client as unknown as SupabaseClient);
    const result = await gen.run();
    if (!result.ok) return;
    expect(result.value).toHaveLength(0); // deduped — no new alert created
  });

  it("also generates upcoming-due alerts for installments due within 7 days", async () => {
    // Due in 3 days (within the 7-day upcoming window)
    const dueDate = new Date(Date.now() + 3 * 86_400_000).toISOString();
    client.tables.installments.rows = [
      {
        id: INST_UPCOMING,
        tenant_id: TENANT,
        parent_id: PARENT_ID,
        student_id: STUDENT_ID,
        category: "tuition",
        label: "Tranche prochaine",
        tranche_number: 1,
        amount_due: 5000,
        amount_paid: 0,
        amount_pending: 0,
        due_date: dueDate,
        status: "pending",
      },
    ];
    client.tables.parents.rows = [
      { id: PARENT_ID, tenant_id: TENANT, display_name: "F1", first_name: "", last_name: "L1" },
    ];

    const gen = new SupabaseOverdueAlertGenerator(client as unknown as SupabaseClient);
    const result = await gen.run();
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0].title).toContain("Échéance proche");
    expect(result.value[0].priority).toBe("medium");
  });

  it("uses parent.display_name first (first_name is empty on all 258 production rows)", async () => {
    const dueDate = new Date(Date.now() - 5 * 86_400_000).toISOString();
    client.tables.installments.rows = [
      {
        id: INST_NAME,
        tenant_id: TENANT,
        parent_id: PARENT_ID,
        student_id: STUDENT_ID,
        category: "tuition",
        label: "Tranche 1",
        tranche_number: 1,
        amount_due: 5000,
        amount_paid: 0,
        amount_pending: 0,
        due_date: dueDate,
        status: "pending",
      },
    ];
    // display_name set, first_name EMPTY (production artifact F-06)
    client.tables.parents.rows = [
      { id: PARENT_ID, tenant_id: TENANT, display_name: "Karim Benali", first_name: "", last_name: "" },
    ];

    const gen = new SupabaseOverdueAlertGenerator(client as unknown as SupabaseClient);
    const result = await gen.run();
    if (!result.ok) return;
    expect(result.value[0].title).toContain("Karim Benali");
  });

  it("returns Ok([]) when no installments are overdue or upcoming", async () => {
    client.tables.installments.rows = [];
    client.tables.parents.rows = [];

    const gen = new SupabaseOverdueAlertGenerator(client as unknown as SupabaseClient);
    const result = await gen.run();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });
});
