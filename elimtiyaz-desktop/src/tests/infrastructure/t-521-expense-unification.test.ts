/**
 * T-521 (issue #29) — the expense unification regression suite.
 *
 * Covers the canonical contract additions that make ONE expense system
 * shared across Finance, Staff/Personnel, and mobile:
 *
 *   A. RESPONSIBLE PERSON (WORKFORCE-520)
 *      A1 submit() persists responsible_profile_id (the distinct accountable
 *          person) and defaults it to the submitter when not named.
 *      A2 update() patches the responsible person (and the other editable
 *          fields) on the SAME row — never a duplicate.
 *      A3 update() is REJECTED once the ticket left the pre-approval window
 *          (the 0064 state machine owns the lifecycle after that).
 *
 *   B. ATTACHMENTS (WORKFORCE-518)
 *      B1 addAttachment() uploads through the ONE media vault
 *          (expense-receipts bucket) and registers the canonical
 *          expense_attachments metadata row — it NEVER creates a second
 *          expense.
 *      B2 observeAttachments() is reactive over the store/cache.
 *      B3 removeAttachment() removes the metadata row; an unknown id is a
 *          notFound (the §15.30b affected-row discipline).
 *      B4 Multiple attachments accumulate for ONE expense (multi-image).
 *
 *   C. THE "ddd" REGRESSION (WORKFORCE-517 — the cross-surface visibility)
 *      C1 an expense submitted through the ONE repository is visible on the
 *          SAME observe() stream every surface reads — the Finance tab and
 *          the Personnel review queue share the record by construction.
 *
 * Mock-twin tests run against the real MockExpenseRepository + MockStore;
 * Supabase-twin tests run against the fake PostgREST client (the T-093
 * pattern) with uploadPrivateMedia mocked at the module boundary.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// The vault is mocked at the module boundary for BOTH twins: the mock twin
// calls it for the in-memory vault, the Supabase twin for the bucket — the
// assertion target is the ONE-call contract, not the bytes.
const uploadMock = vi.fn(
  async (params: { bucket: string; entityId: string; tenantId: string; file: File }) => ({
    path: `${params.tenantId}/${params.entityId}/${Date.now()}-abc-${params.file.name}`,
    bucket: params.bucket,
    sizeBytes: params.file.size,
    contentType: params.file.type,
  }),
);
vi.mock("../../infrastructure/storage/media-vault", () => ({
  uploadPrivateMedia: (p: Parameters<typeof uploadMock>[0]) => uploadMock(p),
  freshSignedMediaUrl: async () => null,
}));

import { SupabaseExpenseRepository } from "../../infrastructure/supabase/repositories/supabase-expense-repository";
import {
  MockExpenseRepository,
  mockExpenseRepository,
} from "../../infrastructure/mock/repositories/financial-repository";
import { store as mockStore } from "../../infrastructure/mock/repositories/mock-store";
import type { ExpenseAttachmentFile } from "../../domain/model/expense";

// ============================================================================
// Shared fixtures
// ============================================================================

const TENANT = "00000000-0000-0000-0000-000000000001";
const SUBMITTER = "aaaaaaaa-0000-0000-0000-0000000000a1";
const APPROVER = "aaaaaaaa-0000-0000-0000-0000000000a2";
const RESPONSIBLE = "aaaaaaaa-0000-0000-0000-0000000000a3";
const CAT_ID_OFFICE = "cccccccc-0000-0000-0000-0000000000c2";

function fakeImageFile(name = "recu-facture.png", size = 90_000): ExpenseAttachmentFile {
  return {
    name,
    type: "image/png",
    size,
    blob: new Blob([new Uint8Array(Math.min(size, 1024))], { type: "image/png" }) as unknown as Blob,
  };
}

// ============================================================================
// The MOCK twin — the real MockExpenseRepository + MockStore
// ============================================================================

describe("T-521 — mock twin: responsible person + attachments", () => {
  let repo: MockExpenseRepository;

  beforeEach(() => {
    vi.restoreAllMocks();
    uploadMock.mockClear();
    // Isolate the shared store: empty expenses + attachments for this suite.
    mockStore.expenses = [];
    mockStore.expenseAttachments = [];
    mockStore.notifyExpenses();
    mockStore.notifyExpenseAttachments();
    repo = new MockExpenseRepository();
  });

  it("A1: submit() persists the distinct responsible person; defaults to the submitter when omitted", async () => {
    const withResponsible = await repo.submit(
      {
        title: "Carburant minibus",
        description: "Plein pour la sortie scolaire",
        amount: 8000,
        category: "transport",
        payee: "Naftal",
        responsibleProfileId: RESPONSIBLE,
      },
      SUBMITTER,
    );
    expect(withResponsible.ok).toBe(true);
    if (!withResponsible.ok) return;
    expect(withResponsible.value.responsibleProfileId).toBe(RESPONSIBLE);
    expect(withResponsible.value.submittedBy).toBe(SUBMITTER); // distinct roles preserved

    const withoutResponsible = await repo.submit(
      {
        title: "Fournitures diverses",
        description: "Achat ponctuel",
        amount: 3200,
        category: "supplies",
        payee: "Papeterie El Baraka",
      },
      SUBMITTER,
    );
    expect(withoutResponsible.ok).toBe(true);
    if (!withoutResponsible.ok) return;
    expect(withoutResponsible.value.responsibleProfileId).toBe(SUBMITTER); // the default
  });

  it("A2: update() patches the SAME row — no duplicate expenses created", async () => {
    const created = await repo.submit(
      {
        title: "Réparation photocopieuse",
        description: "Remplacement du tambour",
        amount: 15000,
        category: "maintenance",
        payee: "Climat Oran Services",
      },
      SUBMITTER,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.value.id;

    const before = mockStore.expenses.length;
    const updated = await repo.update(
      id,
      { title: "Réparation photocopieuse (devis révisé)", amount: 17500, responsibleProfileId: RESPONSIBLE },
      SUBMITTER,
    );
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.title).toContain("devis révisé");
    expect(updated.value.amount).toBe(17500);
    expect(updated.value.responsibleProfileId).toBe(RESPONSIBLE);
    expect(updated.value.requestCode).toBe(created.value.requestCode); // SAME record
    expect(mockStore.expenses.length).toBe(before); // NO duplicate
  });

  it("A3: update() is rejected once the ticket is approved (the pre-approval window)", async () => {
    const created = await repo.submit(
      {
        title: "Abonnement internet",
        description: "Trimestre 1",
        amount: 21000,
        category: "utilities",
        payee: "Algérie Télécom",
      },
      SUBMITTER,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await repo.approve(created.value.id, APPROVER, "OK");

    const rejected = await repo.update(created.value.id, { amount: 1 }, APPROVER);
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.error.userMessage).toContain("modifiabl");
  });

  it("B1+B4: addAttachment() registers canonical metadata and NEVER creates a second expense (multi-image)", async () => {
    const created = await repo.submit(
      {
        title: "Sortie pédagogique",
        description: "Transport + repas",
        amount: 45000,
        category: "event",
        payee: "Agence Tassili",
      },
      SUBMITTER,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const expenseId = created.value.id;
    const expensesBefore = mockStore.expenses.length;

    const a1 = await repo.addAttachment(expenseId, fakeImageFile("ticket-bus.png"), SUBMITTER);
    const a2 = await repo.addAttachment(expenseId, fakeImageFile("facture-repas.jpg"), SUBMITTER, "mobile_camera");
    expect(a1.ok).toBe(true);
    expect(a2.ok).toBe(true);

    expect(mockStore.expenses.length).toBe(expensesBefore); // NEVER a second expense
    expect(mockStore.expenseAttachments.length).toBe(2);
    expect(mockStore.expenseAttachments.every((a) => a.expenseId === expenseId)).toBe(true);

    // The ONE upload path: the vault was called with the canonical bucket.
    expect(uploadMock).toHaveBeenCalledTimes(2);
    expect(uploadMock.mock.calls.every((c) => c[0].bucket === "expense-receipts")).toBe(true);

    if (a1.ok) {
      expect(a1.value.storagePath).toContain(expenseId); // the <tenant>/<expense>/<file> canon
      expect(a1.value.source).toBe("desktop");
    }
    if (a2.ok) expect(a2.value.source).toBe("mobile_camera");
  });

  it("B2: observeAttachments() is reactive over the store", async () => {
    const created = await repo.submit(
      {
        title: "Achat matériel IT",
        description: "Deux claviers",
        amount: 6400,
        category: "supplies",
        payee: "Computer Shop",
      },
      SUBMITTER,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const stream = repo.observeAttachments(created.value.id);
    expect(stream.get()).toEqual([]);
    await repo.addAttachment(created.value.id, fakeImageFile("facture1.png"), SUBMITTER);
    expect(stream.get().length).toBe(1);
    expect(stream.get()[0].fileName).toBe("facture1.png");
  });

  it("B3: removeAttachment() removes the metadata row; unknown ids are notFound", async () => {
    const created = await repo.submit(
      {
        title: "Dépense test",
        description: "…",
        amount: 1000,
        category: "other",
        payee: "X",
      },
      SUBMITTER,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const added = await repo.addAttachment(created.value.id, fakeImageFile("a.png"), SUBMITTER);
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    const removed = await repo.removeAttachment(added.value.id, APPROVER);
    expect(removed.ok).toBe(true);
    expect(mockStore.expenseAttachments.length).toBe(0);

    const unknown = await repo.removeAttachment("expatt-does-not-exist", APPROVER);
    expect(unknown.ok).toBe(false);
  });

  it("C1: the cross-surface visibility pin — the SAME observe() stream serves every surface", async () => {
    // The "ddd" regression: an expense created in Finance (this repository
    // call) must appear on the stream the Personnel review queue reads —
    // there is exactly ONE record store, so visibility is by construction.
    const created = await repo.submit(
      {
        title: "ddd",
        description: "La dépense de test du propriétaire",
        amount: 5000,
        category: "other",
        payee: "Test",
      },
      SUBMITTER,
    );
    expect(created.ok).toBe(true);

    // The Finance tab's stream and the Personnel review queue's stream are
    // the SAME observable — one source of truth.
    const financeStream = repo.observe();
    const personnelStream = mockExpenseRepository.observe();
    expect(financeStream.get().some((e) => e.title === "ddd")).toBe(true);
    expect(personnelStream.get().some((e) => e.title === "ddd")).toBe(true);

    // The pending queue (the Staff/Personnel review filter) sees it too.
    const pending = repo.observeByStatus("submitted");
    expect(pending.get().some((e) => e.title === "ddd")).toBe(true);
  });
});

// ============================================================================
// The SUPABASE twin — the fake PostgREST client (T-093 pattern + delete)
// ============================================================================

type Row = Record<string, unknown>;

class FakeQuery {
  private filters: ((row: Row) => boolean)[] = [];
  private mode: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row | null = null;
  private wantSingle = false;

  constructor(
    private readonly table: Row[],
    private readonly tableName: string,
    private readonly rpcMock?: (name: string, args: Record<string, unknown>) => unknown,
  ) {}

  eq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  order(): this { return this; }
  limit(): this { return this; }
  select(): this { return this; }
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
  delete(): this {
    this.mode = "delete";
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
    if (this.mode === "delete") {
      const deleted: Row[] = [];
      for (let i = this.table.length - 1; i >= 0; i--) {
        if (this.filters.every((f) => f(this.table[i]))) {
          deleted.unshift(this.table[i]);
          this.table.splice(i, 1);
        }
      }
      // §15.30b: PostgREST returns 200 + [] when a DELETE matches zero rows.
      return { data: deleted, error: null };
    }
    const rows = this.table.filter((r) => this.filters.every((f) => f(r)));
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
        return Promise.resolve((onFulfilled as unknown as (v: unknown) => TResult1)({ data: arr[0], error: null }));
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

const EXPENSE_ID = "eeeeeeee-0000-0000-0000-0000000000e1";

function ticketRow(status: string, overrides: Row = {}): Row {
  return {
    id: EXPENSE_ID,
    tenant_id: TENANT,
    ticket_number: "EXP-2026-000001",
    title: "ddd",
    description: "La dépense de test du propriétaire",
    justification: "La dépense de test du propriétaire",
    category_id: CAT_ID_OFFICE,
    expense_categories: { code: "office_supplies" },
    requested_amount: 5000,
    final_spent_amount: null,
    urgency: "medium",
    status,
    submitted_by: SUBMITTER,
    responsible_profile_id: null,
    submitted_at: "2026-10-13T08:00:00.000Z",
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
    payee: "Test",
    anomaly_score: null,
    anomaly_flags_json: [],
    created_at: "2026-10-13T08:00:00.000Z",
    updated_at: "2026-10-13T08:00:00.000Z",
    ...overrides,
  };
}

function setSessionTenantId(tenantId: string) {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation((key: string) => {
    if (key === "el-imtiyaz.session") {
      return JSON.stringify({ tenantId });
    }
    return null;
  });
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("T-521 — supabase twin: responsible person + attachments", () => {
  let client: FakeClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    uploadMock.mockClear();
    setSessionTenantId(TENANT);
    client = new FakeClient();
    client.tables["expense_categories"] = [
      { id: CAT_ID_OFFICE, tenant_id: TENANT, code: "office_supplies" },
    ];
    client.rpcMocks["current_user_profile_id"] = () => ({ data: APPROVER, error: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("A1: submit() carries responsible_profile_id to the canonical row", async () => {
    client.tables["expense_tickets"] = [];
    const repo = new SupabaseExpenseRepository(client as unknown as SupabaseClient);
    const result = await repo.submit(
      {
        title: "Carburant minibus",
        description: "Plein",
        amount: 8000,
        category: "supplies",
        payee: "Naftal",
        responsibleProfileId: RESPONSIBLE,
      },
      SUBMITTER,
    );
    expect(result.ok).toBe(true);
    const inserted = client.tables["expense_tickets"][0];
    expect(inserted.responsible_profile_id).toBe(RESPONSIBLE);
  });

  it("A2: update() patches only the provided DB columns on the SAME row", async () => {
    client.tables["expense_tickets"] = [ticketRow("pending_approval")];
    const repo = new SupabaseExpenseRepository(client as unknown as SupabaseClient);
    await repo.observe(); // seed the cache
    await flush();

    const updated = await repo.update(
      EXPENSE_ID,
      { amount: 6200, responsibleProfileId: RESPONSIBLE },
      APPROVER,
    );
    expect(updated.ok).toBe(true);
    const row = client.tables["expense_tickets"][0];
    expect(row.requested_amount).toBe(6200);
    expect(row.responsible_profile_id).toBe(RESPONSIBLE);
    expect(row.title).toBe("ddd"); // untouched columns preserved
    expect(client.tables["expense_tickets"].length).toBe(1); // SAME row, no duplicate
  });

  it("A3: update() is rejected after approval (the pre-approval window)", async () => {
    client.tables["expense_tickets"] = [ticketRow("approved_funds_released")];
    const repo = new SupabaseExpenseRepository(client as unknown as SupabaseClient);
    await repo.observe();
    await flush();

    const rejected = await repo.update(EXPENSE_ID, { amount: 1 }, APPROVER);
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.error.userMessage).toContain("modifiabl");
  });

  it("B1: addAttachment() uploads to the expense-receipts bucket and inserts the canonical metadata row", async () => {
    client.tables["expense_tickets"] = [ticketRow("pending_approval")];
    client.tables["expense_attachments"] = [];
    const repo = new SupabaseExpenseRepository(client as unknown as SupabaseClient);
    await repo.observe();
    await flush();

    const added = await repo.addAttachment(EXPENSE_ID, fakeImageFile("justificatif.png"), SUBMITTER);
    expect(added.ok).toBe(true);
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(uploadMock.mock.calls[0][0].bucket).toBe("expense-receipts");
    expect(uploadMock.mock.calls[0][0].entityId).toBe(EXPENSE_ID);
    expect(client.tables["expense_tickets"].length).toBe(1); // NEVER a second expense

    const row = client.tables["expense_attachments"][0];
    expect(row.expense_id).toBe(EXPENSE_ID);
    expect(row.storage_bucket).toBe("expense-receipts");
    expect(row.file_name).toBe("justificatif.png");
    expect(row.source).toBe("desktop");
    expect(String(row.storage_path)).toContain(EXPENSE_ID);
  });

  it("B2: observeAttachments() seeds from the canonical table", async () => {
    client.tables["expense_tickets"] = [ticketRow("pending_approval")];
    client.tables["expense_attachments"] = [
      {
        id: "att-1",
        tenant_id: TENANT,
        expense_id: EXPENSE_ID,
        storage_bucket: "expense-receipts",
        storage_path: `${TENANT}/${EXPENSE_ID}/x.png`,
        file_name: "x.png",
        mime_type: "image/png",
        size_bytes: 1000,
        uploaded_by: SUBMITTER,
        uploaded_at: "2026-10-13T09:00:00.000Z",
        source: "mobile_camera",
        created_at: "2026-10-13T09:00:00.000Z",
      },
    ];
    const repo = new SupabaseExpenseRepository(client as unknown as SupabaseClient);
    const stream = repo.observeAttachments(EXPENSE_ID);
    await flush();
    expect(stream.get().length).toBe(1);
    expect(stream.get()[0].source).toBe("mobile_camera"); // the scanner's images surface on desktop
  });

  it("B3: removeAttachment() asserts the affected-row count (§15.30b — the empty-delete trap)", async () => {
    client.tables["expense_tickets"] = [ticketRow("pending_approval")];
    client.tables["expense_attachments"] = [];
    const repo = new SupabaseExpenseRepository(client as unknown as SupabaseClient);
    await repo.observe();
    await flush();
    const added = await repo.addAttachment(EXPENSE_ID, fakeImageFile("z.png"), SUBMITTER);
    expect(added.ok).toBe(true);

    const removed = await repo.removeAttachment("att-not-there", APPROVER);
    expect(removed.ok).toBe(false); // zero-row delete → notFound, never a silent success

    if (added.ok) {
      const real = await repo.removeAttachment(added.value.id, APPROVER);
      expect(real.ok).toBe(true);
      expect(client.tables["expense_attachments"].length).toBe(0);
    }
  });
});
