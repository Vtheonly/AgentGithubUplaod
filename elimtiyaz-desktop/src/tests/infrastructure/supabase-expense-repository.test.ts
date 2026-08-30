/**
 * SupabaseExpenseRepository unit tests (T-093 / DRIFT-013).
 *
 * Verifies the canonical contract of the expenses port:
 *   1. submit() inserts into `expense_tickets` with the DB status
 *      `pending_approval` (domain `submitted`), resolves the category
 *      id from `expense_categories`, persists `payee` (migration 0056),
 *      and writes the expense.submit audit entry.
 *   2. Status translation is lossless both ways
 *      (submitted↔pending_approval, approved↔approved_funds_released,
 *      settled↔settled_and_closed).
 *   3. Category translation handles the seeded DB codes
 *      (office_supplies→supplies, facilities→rent,
 *      educational_material→supplies) and the domain→DB direction
 *      (supplies→office_supplies, rent→facilities).
 *   4. approve()/reject() enforce the no-self-approval rule (mock parity)
 *      and reject illegal transitions (state machine parity).
 *   5. settleProof() requires the disbursed status + a proof, and
 *      persists final_spent_amount + receipt columns.
 *   6. observeByStatus() filters the cache.
 *
 * The Supabase client is faked with the same minimal PostgREST builder
 * surface as the T-080 suite (from/eq/order/limit/select/insert/update/
 * single/rpc/then), with the joined `expense_categories(code)` shape
 * pre-baked into the seeded rows.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseExpenseRepository } from "../../infrastructure/supabase/repositories/supabase-expense-repository";
import type { ExpenseTicketRow } from "../../infrastructure/supabase/types";

// ============================================================================
// Fake Supabase client — minimal PostgREST builder surface
// ============================================================================

type Row = Record<string, unknown>;

class FakeQuery {
  private filters: ((row: Row) => boolean)[] = [];
  private mode: "select" | "insert" | "update" = "select";
  private payload: Row | null = null;
  private wantSingle = false;
  private ordered = false;
  private orderCol = "";
  private limitN: number | null = null;

  constructor(
    private readonly table: Row[],
    private readonly tableName: string,
    private readonly rpcMock?: (name: string, args: Record<string, unknown>) => unknown,
  ) {}

  eq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }

  order(col: string): this {
    this.ordered = true;
    this.orderCol = col;
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  select(_cols?: string): this {
    return this;
  }

  insert(row: Row): this {
    this.mode = "insert";
    this.payload = row;
    return this;
  }

  update(patch: Row): this {
    this.mode = "update";
    this.payload = patch;
    return this;
  }

  single(): this {
    this.wantSingle = true;
    return this;
  }

  private run(): { data: Row | Row[] | null; error: { message: string } | null } {
    if (this.mode === "insert") {
      this.table.push({ ...(this.payload ?? {}) });
      return { data: this.payload, error: null };
    }
    if (this.mode === "update") {
      const patched: Row[] = [];
      for (const row of this.table) {
        if (this.filters.every((f) => f(row))) {
          Object.assign(row, this.payload ?? {});
          patched.push(row);
        }
      }
      return {
        data: patched.length === 0 ? null : patched,
        error: patched.length === 0 ? { message: "no rows updated" } : null,
      };
    }
    // SELECT
    let rows = this.table.filter((r) => this.filters.every((f) => f(r)));
    if (this.ordered) {
      rows = [...rows].sort((a, b) =>
        String(b[this.orderCol] ?? "").localeCompare(String(a[this.orderCol] ?? "")),
      );
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    return { data: rows, error: null };
  }

  then<TResult1>(
    onFulfilled:
      | ((value: { data: Row | Row[] | null; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
  ): Promise<TResult1> {
    const result = this.run();
    if (this.wantSingle) {
      const arr = result.data;
      if (Array.isArray(arr)) {
        if (arr.length === 0) {
          return Promise.resolve(
            (onFulfilled as unknown as (v: unknown) => TResult1)({
              data: null,
              error: { message: "no rows (PGRST116)" },
            }),
          );
        }
        return Promise.resolve(
          (onFulfilled as unknown as (v: unknown) => TResult1)({
            data: arr[0],
            error: null,
          }),
        );
      }
      return Promise.resolve(onFulfilled!(result as never));
    }
    return Promise.resolve(onFulfilled!(result as never));
  }
}

class FakeClient {
  tables: Record<string, Row[]> = {};
  rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  rpcMocks: Record<string, (args: Record<string, unknown>) => unknown> = {};

  from(tableName: string): FakeQuery {
    if (!this.tables[tableName]) this.tables[tableName] = [];
    return new FakeQuery(this.tables[tableName], tableName, (n, a) => {
      const m = this.rpcMocks[n];
      return m ? m(a) : undefined;
    });
  }

  async rpc(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    this.rpcCalls.push({ name, args });
    const mock = this.rpcMocks[name];
    if (mock) {
      try {
        return mock(args) ?? { data: null, error: null };
      } catch (e) {
        return { data: null, error: e };
      }
    }
    return { data: null, error: null };
  }
}

// ============================================================================
// Fixtures
// ============================================================================

const TENANT = "00000000-0000-0000-0000-000000000001";
const SUBMITTER = "aaaaaaaa-0000-0000-0000-0000000000a1";
const APPROVER = "aaaaaaaa-0000-0000-0000-0000000000a2";
const CAT_ID_UTILITIES = "cccccccc-0000-0000-0000-0000000000c1";
const CAT_ID_OFFICE = "cccccccc-0000-0000-0000-0000000000c2";

type TicketOverrides = Partial<ExpenseTicketRow> & {
  id: string;
  status: ExpenseTicketRow["status"];
  /** Joined shape produced by `select("*, expense_categories(code)")`. */
  expense_categories?: { code: string } | null;
};

function ticketRow(overrides: TicketOverrides): Row {
  return {
    tenant_id: TENANT,
    ticket_number: `EXP-2026-${overrides.id.slice(-6)}`,
    title: "Cartouches imprimante",
    description: "Trois cartouches pour la photocopieuse",
    justification: "Trois cartouches pour la photocopieuse",
    category_id: CAT_ID_OFFICE,
    expense_categories: { code: "office_supplies" },
    requested_amount: 12000,
    final_spent_amount: null,
    urgency: "medium",
    submitted_by: SUBMITTER,
    submitted_at: "2026-08-31T08:00:00.000Z",
    approved_by: null,
    approved_at: null,
    approval_note: null,
    rejected_reason: null,
    disbursed_at: null,
    settled_by: null,
    settled_at: null,
    receipt_path: null,
    receipt_uploaded_at: null,
    receipt_uploaded_by: null,
    payee: "Fournira Bureau SARL",
    anomaly_score: null,
    anomaly_flags_json: [],
    created_at: "2026-08-31T08:00:00.000Z",
    updated_at: "2026-08-31T08:00:00.000Z",
    ...overrides,
  };
}

function buildClient(tickets: Row[]): FakeClient {
  const client = new FakeClient();
  client.tables["expense_tickets"] = tickets;
  client.tables["expense_categories"] = [
    { id: CAT_ID_UTILITIES, tenant_id: TENANT, code: "utilities" },
    { id: CAT_ID_OFFICE, tenant_id: TENANT, code: "office_supplies" },
    { id: "cccccccc-0000-0000-0000-0000000000c3", tenant_id: TENANT, code: "other" },
    { id: "cccccccc-0000-0000-0000-0000000000c4", tenant_id: TENANT, code: "facilities" },
    { id: "cccccccc-0000-0000-0000-0000000000c5", tenant_id: TENANT, code: "maintenance" },
    { id: "cccccccc-0000-0000-0000-0000000000c6", tenant_id: TENANT, code: "transport" },
  ];
  client.rpcMocks["current_user_profile_id"] = () => ({ data: APPROVER, error: null });
  return client;
}

function setSessionTenantId(tenantId: string) {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation((key: string) => {
    if (key === "el-imtiyaz.session") {
      return JSON.stringify({ tenantId });
    }
    return null;
  });
}

/** The cache seeds asynchronously (`void this.refresh()`) — flush microtasks. */
const flush = () => new Promise((r) => setTimeout(r, 0));

let client: FakeClient;

describe("SupabaseExpenseRepository — T-093 (DRIFT-013)", () => {
  beforeEach(() => {
    setSessionTenantId(TENANT);
    client = buildClient([]);
  });

  // --------------------------------------------------------------------------
  // 1. submit
  // --------------------------------------------------------------------------
  it("submit() inserts a pending_approval ticket with the resolved category id and the payee", async () => {
    const repo = new SupabaseExpenseRepository(client as unknown as SupabaseClient);
    const result = await repo.submit(
      {
        title: "Facture SONELGAZ",
        description: "Facture bimestrielle",
        amount: 24500,
        category: "utilities",
        payee: "SONELGAZ Boumerdès",
        urgency: "high",
      },
      SUBMITTER,
    );
    expect(result.ok).toBe(true);
    const inserted = client.tables["expense_tickets"][0];
    expect(inserted.status).toBe("pending_approval"); // DB value, not domain "submitted"
    expect(inserted.payee).toBe("SONELGAZ Boumerdès"); // migration 0056
    expect(inserted.category_id).toBe(CAT_ID_UTILITIES); // utilities → utilities row
    expect(inserted.tenant_id).toBe(TENANT);
    expect(String(inserted.ticket_number)).toMatch(/^EXP-\d{4}-[A-Z0-9]{6}$/);
    // Audit via the canonical RPC
    expect(client.rpcCalls.some((c) => c.name === "write_audit_log" && c.args.p_action === "expense.submit")).toBe(true);
  });

  it("submit() maps the domain category supplies → office_supplies", async () => {
    const repo = new SupabaseExpenseRepository(client as unknown as SupabaseClient);
    await repo.submit(
      { title: "Stylos", description: "Fournitures", amount: 3000, category: "supplies", payee: "Papeterie" },
      SUBMITTER,
    );
    expect(client.tables["expense_tickets"][0].category_id).toBe(CAT_ID_OFFICE);
  });

  it("submit() copies the description into the NOT NULL justification column", async () => {
    const repo = new SupabaseExpenseRepository(client as unknown as SupabaseClient);
    await repo.submit(
      { title: "T", description: "DESC-TEXT", amount: 100, category: "other", payee: "X" },
      SUBMITTER,
    );
    expect(client.tables["expense_tickets"][0].justification).toBe("DESC-TEXT");
  });

  // --------------------------------------------------------------------------
  // 2. status + category read translation
  // --------------------------------------------------------------------------
  it("maps DB statuses back to domain statuses losslessly", async () => {
    const row = (id: string, status: ExpenseTicketRow["status"]) =>
      ticketRow({ id, status });
    client.tables["expense_tickets"] = [
      row("id-1", "pending_approval"),
      row("id-2", "approved_funds_released"),
      row("id-3", "settled_and_closed"),
      row("id-4", "rejected"),
    ];
    const repo = new SupabaseExpenseRepository(client as unknown as SupabaseClient);
    const obs = repo.observe();
    await flush(); // the cache seeds asynchronously — re-read AFTER the flush
    const rows = obs.get();
    expect(rows.map((e) => e.status)).toEqual([
      "submitted",
      "approved",
      "settled",
      "rejected",
    ]);
  });

  it("maps DB category codes back to domain categories (incl. lossy rows)", async () => {
    client.tables["expense_tickets"] = [
      ticketRow({ id: "id-1", status: "pending_approval", expense_categories: { code: "office_supplies" } }),
      ticketRow({ id: "id-2", status: "pending_approval", expense_categories: { code: "facilities" } }),
      ticketRow({ id: "id-3", status: "pending_approval", expense_categories: { code: "educational_material" } }),
      ticketRow({ id: "id-4", status: "pending_approval", expense_categories: { code: "medical" } }),
    ];
    const repo = new SupabaseExpenseRepository(client as unknown as SupabaseClient);
    const obs = repo.observe();
    await flush();
    const rows = obs.get();
    expect(rows.map((e) => e.category)).toEqual([
      "supplies",
      "rent",
      "supplies",
      "other",
    ]);
  });

  it("surfaces the payee + approval_note/rejected_reason through the domain model", async () => {
    client.tables["expense_tickets"] = [
      ticketRow({ id: "id-1", status: "rejected", rejected_reason: "Budget épuisé" }),
    ];
    const repo = new SupabaseExpenseRepository(client as unknown as SupabaseClient);
    const obs = repo.observe();
    await flush();
    const row = obs.get()[0];
    expect(row).toBeDefined();
    expect(row.payee).toBe("Fournira Bureau SARL");
    expect(row.approvalNote).toBe("Budget épuisé");
  });

  // --------------------------------------------------------------------------
  // 3. approve / reject — no-self-approval + state machine
  // --------------------------------------------------------------------------
  it("approve() rejects self-approval without touching the DB", async () => {
    const row = ticketRow({ id: "id-1", status: "pending_approval" });
    client.tables["expense_tickets"] = [row];
    const repo = new SupabaseExpenseRepository(client as unknown as SupabaseClient);
    repo.observe().get(); // seed cache
    await flush();
    const result = await repo.approve("id-1", SUBMITTER, "ok");
    expect(result.ok).toBe(false);
    expect(client.tables["expense_tickets"][0].status).toBe("pending_approval");
    expect(client.rpcCalls.some((c) => c.name === "write_audit_log")).toBe(false);
  });

  it("approve() transitions pending_approval → approved_funds_released and audits", async () => {
    const row = ticketRow({ id: "id-1", status: "pending_approval" });
    client.tables["expense_tickets"] = [row];
    const repo = new SupabaseExpenseRepository(client as unknown as SupabaseClient);
    repo.observe().get();
    await flush();
    const result = await repo.approve("id-1", APPROVER, "Bon budget");
    expect(result.ok).toBe(true);
    const updated = client.tables["expense_tickets"][0];
    expect(updated.status).toBe("approved_funds_released");
    expect(updated.approved_by).toBe(APPROVER);
    expect(updated.approval_note).toBe("Bon budget");
    expect(client.rpcCalls.some((c) => c.name === "write_audit_log" && c.args.p_action === "expense.approve")).toBe(true);
  });

  it("reject() writes the rejected_reason and enforces the state machine", async () => {
    const row = ticketRow({ id: "id-1", status: "pending_approval" });
    client.tables["expense_tickets"] = [row];
    const repo = new SupabaseExpenseRepository(client as unknown as SupabaseClient);
    repo.observe().get();
    await flush();
    const result = await repo.reject("id-1", APPROVER, "Hors budget");
    expect(result.ok).toBe(true);
    expect(client.tables["expense_tickets"][0].status).toBe("rejected");
    expect(client.tables["expense_tickets"][0].rejected_reason).toBe("Hors budget");

    // approved → approved is an illegal transition (state machine parity)
    const again = await repo.approve("id-1", APPROVER, "x");
    expect(again.ok).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 4. settleProof
  // --------------------------------------------------------------------------
  it("settleProof() requires proof + disbursed status and persists final_spent_amount", async () => {
    const row = ticketRow({ id: "id-1", status: "disbursed" });
    client.tables["expense_tickets"] = [row];
    const repo = new SupabaseExpenseRepository(client as unknown as SupabaseClient);
    repo.observe().get();
    await flush();

    const noProof = await repo.settleProof("id-1", "", APPROVER, 11000);
    expect(noProof.ok).toBe(false);

    const ok = await repo.settleProof("id-1", "expense-receipts/id-1.pdf", APPROVER, 11000);
    expect(ok.ok).toBe(true);
    const updated = client.tables["expense_tickets"][0];
    expect(updated.status).toBe("settled_and_closed");
    expect(updated.receipt_path).toBe("expense-receipts/id-1.pdf");
    expect(updated.final_spent_amount).toBe(11000);
    expect(updated.settled_by).toBe(APPROVER);
  });

  it("settleProof() rejects a ticket that is not disbursed (mock parity)", async () => {
    client.tables["expense_tickets"] = [ticketRow({ id: "id-2", status: "pending_approval" })];
    const repo = new SupabaseExpenseRepository(client as unknown as SupabaseClient);
    repo.observe().get();
    await flush();
    const result = await repo.settleProof("id-2", "proof.pdf", APPROVER);
    expect(result.ok).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 5. observeByStatus
  // --------------------------------------------------------------------------
  it("observeByStatus filters the cache by the DOMAIN status", async () => {
    client.tables["expense_tickets"] = [
      ticketRow({ id: "id-1", status: "pending_approval" }),
      ticketRow({ id: "id-2", status: "settled_and_closed" }),
      ticketRow({ id: "id-3", status: "pending_approval" }),
    ];
    const repo = new SupabaseExpenseRepository(client as unknown as SupabaseClient);
    const pendingObs = repo.observeByStatus("submitted");
    await flush();
    const pending = pendingObs.get();
    expect(pending.map((e) => e.id)).toEqual(["id-1", "id-3"]);
  });
});
