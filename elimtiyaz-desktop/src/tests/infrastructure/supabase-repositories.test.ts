/**
 * Unit tests for the DESKTOP-1 Supabase repository wiring — audit log,
 * notifications, personnel + departments, and the academic promotion fix.
 *
 * The Supabase client is replaced by a hand-rolled in-memory fake that
 * implements the (small) PostgREST builder surface the repositories use:
 * from().select()/insert()/update()/delete() with eq/is/not/ilike/gte/lte/in/
 * order/range/limit/single/maybeSingle, plus rpc(). Row-level semantics
 * mirror PostgREST: filters compose with AND, updates/deletes apply to all
 * matching rows, insert().select() echoes the inserted row back.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseAuditLogRepository } from "../../infrastructure/supabase/repositories/supabase-audit-log-repository";
import { SupabaseNotificationRepository } from "../../infrastructure/supabase/repositories/supabase-notification-repository";
import {
  SupabasePersonnelRepository,
  SupabaseDepartmentRepository,
} from "../../infrastructure/supabase/repositories/supabase-personnel-repository";
import { SupabasePromotionRepository } from "../../infrastructure/supabase/repositories/supabase-academic-repository";
import { Role } from "../../core/rbac/roles";

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


// ============================================================================
// Fake Supabase client
// ============================================================================

type Row = Record<string, any>;

interface FakeTable {
  rows: Row[];
  /** When set, insert() fails once with this code (unique violation simulation). */
  insertErrorOnce?: { code: string; message: string };
}

class FakeQuery {
  private filters: ((row: Row) => boolean)[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private rangeClause: [number, number] | null = null;
  private limitClause: number | null = null;
  private singleMode: "single" | "maybe" | null = null;
  private wantCount = false;
  private payload: Row | Row[] | null = null;
  private isInsert = false;
  private isUpdate = false;
  private isDelete = false;

  constructor(
    private readonly table: FakeTable,
    private readonly tableName: string,
  ) {}

  // ---- query shaping ------------------------------------------------------
  select(_cols: string, opts?: { count?: "exact" }) {
    if (opts?.count === "exact") this.wantCount = true;
    return this;
  }
  insert(payload: Row | Row[]) {
    this.payload = payload;
    this.isInsert = true;
    return this;
  }
  update(payload: Row) {
    this.payload = payload;
    this.isUpdate = true;
    return this;
  }
  upsert(payload: Row | Row[]) {
    this.payload = payload;
    this.isInsert = true; // simplified: treat as insert
    return this;
  }
  delete() {
    this.isDelete = true;
    return this;
  }
  eq(col: string, value: unknown) {
    this.filters.push((r) => r[col] === value);
    return this;
  }
  neq(col: string, value: unknown) {
    this.filters.push((r) => r[col] !== value);
    return this;
  }
  filter(col: string, op: string, value: unknown) {
    if (op === "neq") return this.neq(col, value);
    return this;
  }
  is(col: string, value: null) {
    this.filters.push((r) => (value === null ? r[col] == null : r[col] === value));
    return this;
  }
  not(col: string, _op: string, value: null) {
    return this.is(col, value === null ? "not-null-marker" as never : value);
  }
  ilike(col: string, pattern: string) {
    const rx = new RegExp(
      `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`,
      "i",
    );
    this.filters.push((r) => rx.test(String(r[col] ?? "")));
    return this;
  }
  gte(col: string, value: unknown) {
    this.filters.push((r) => String(r[col] ?? "") >= String(value));
    return this;
  }
  lte(col: string, value: unknown) {
    this.filters.push((r) => String(r[col] ?? "") <= String(value));
    return this;
  }
  in(col: string, values: readonly unknown[]) {
    this.filters.push((r) => values.includes(r[col]));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orders.push({ col, asc: opts?.ascending !== false });
    return this;
  }
  range(from: number, to: number) {
    this.rangeClause = [from, to];
    return this;
  }
  limit(n: number) {
    this.limitClause = n;
    return this;
  }
  single() {
    this.singleMode = "single";
    return this;
  }
  maybeSingle() {
    this.singleMode = "maybe";
    return this;
  }

  // ---- execution ----------------------------------------------------------
  private matches(): Row[] {
    return this.table.rows.filter((r) => this.filters.every((f) => f(r)));
  }

  private applyOrder(rows: Row[]): Row[] {
    const out = [...rows];
    for (const { col, asc } of [...this.orders].reverse()) {
      out.sort((a, b) => {
        const av = a[col] ?? "";
        const bv = b[col] ?? "";
        const cmp = String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0;
        return asc ? cmp : -cmp;
      });
    }
    return out;
  }

  private async exec(): Promise<{ data: any; error: any; count: number | null }> {
    if (this.isInsert) {
      if (this.table.insertErrorOnce) {
        const err = this.table.insertErrorOnce;
        this.table.insertErrorOnce = undefined;
        return { data: null, error: err, count: null };
      }
      const items = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted = items.map((item) => ({
        id: item.id ?? `row-${Math.random().toString(36).slice(2, 10)}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...item,
      }));
      this.table.rows.push(...inserted);
      const result =
        this.singleMode || Array.isArray(this.payload) === false
          ? inserted[0] ?? null
          : inserted;
      if (this.singleMode === "single" && inserted.length !== 1) {
        return { data: null, error: { code: "PGRST116", message: "JSON object requested" }, count: null };
      }
      return { data: result ?? null, error: null, count: inserted.length };
    }

    if (this.isUpdate) {
      const patch = this.payload as Row;
      const matched = this.matches();
      for (const row of matched) {
        Object.assign(row, patch);
      }
      if (this.singleMode === "single") {
        if (matched.length !== 1) {
          return { data: null, error: { code: "PGRST116", message: "JSON object requested" }, count: null };
        }
        return { data: matched[0], error: null, count: null };
      }
      return { data: matched, error: null, count: matched.length };
    }

    if (this.isDelete) {
      const matched = this.matches();
      this.table.rows = this.table.rows.filter((r) => !matched.includes(r));
      return { data: matched, error: null, count: matched.length };
    }

    // SELECT
    let rows = this.applyOrder(this.matches());
    const total = rows.length;
    if (this.rangeClause) {
      rows = rows.slice(this.rangeClause[0], this.rangeClause[1] + 1);
    } else if (this.limitClause != null) {
      rows = rows.slice(0, this.limitClause);
    }
    if (this.singleMode === "single") {
      if (rows.length !== 1) {
        return { data: null, error: { code: "PGRST116", message: "JSON object requested" }, count: null };
      }
      return { data: rows[0], error: null, count: null };
    }
    if (this.singleMode === "maybe") {
      return { data: rows[0] ?? null, error: null, count: null };
    }
    return { data: rows, error: null, count: this.wantCount ? total : null };
  }

  then(onFulfilled: any, onRejected?: any) {
    return this.exec().then(onFulfilled, onRejected);
  }
}

function createFakeClient(tables: Record<string, Row[]>) {
  const fakeTables: Record<string, FakeTable> = {};
  for (const [name, rows] of Object.entries(tables)) {
    fakeTables[name] = { rows: [...rows] };
  }
  const rpcHandlers: Record<string, (args: Row) => any> = {};

  const client = {
    from(tableName: string) {
      if (!fakeTables[tableName]) fakeTables[tableName] = { rows: [] };
      return new FakeQuery(fakeTables[tableName], tableName);
    },
    rpc(fn: string, args: Row) {
      const handler = rpcHandlers[fn];
      if (!handler) {
        return Promise.resolve({
          data: null,
          error: { code: "PGRST202", message: `Could not find the function ${fn}` },
        });
      }
      try {
        return Promise.resolve({ data: handler(args), error: null });
      } catch (e) {
        return Promise.resolve({ data: null, error: { message: String(e) } });
      }
    },
    functions: {
      invoke: () => Promise.resolve({ data: null, error: null }),
    },
    __tables: fakeTables,
    __rpcHandlers: rpcHandlers,
  };
  return client as unknown as SupabaseClient & {
    __tables: Record<string, FakeTable>;
    __rpcHandlers: Record<string, (args: Row) => any>;
  };
}

const TENANT = "00000000-0000-0000-0000-000000000001";

// ============================================================================
// Audit log repository
// ============================================================================

describe("SupabaseAuditLogRepository", () => {
  beforeEach(() => {
    localStorage.clear();
    // T-053: repositories read the working tenant from the session — keep an
    // explicit tenant set after clearing (no demo fallback anymore).
    localStorage.setItem(
      "el-imtiyaz.session",
      JSON.stringify({ tenantId: TENANT, userId: "staff-1" }),
    );
  });

  it("log() appends via the write_audit_log RPC and re-reads the row", async () => {
    const client = createFakeClient({ audit_logs: [] });
    let rpcArgs: Row | null = null;
    client.__rpcHandlers["write_audit_log"] = (args) => {
      rpcArgs = args;
      const row = {
        id: "aud-1",
        tenant_id: args.p_tenant_id,
        action: args.p_action,
        entity_type: args.p_entity_type,
        entity_id: args.p_entity_id,
        actor_id: args.p_actor_id,
        actor_name: args.p_actor_name,
        before_json: args.p_before_json,
        after_json: args.p_after_json,
        note: args.p_note,
        ip_address: null,
        user_agent: null,
        occurred_at: "2026-08-11T10:00:00Z",
        created_at: "2026-08-11T10:00:00Z",
      };
      client.__tables["audit_logs"].rows.push(row);
      return "aud-1";
    };

    const repo = new SupabaseAuditLogRepository(client);
    const result = await repo.log({
      action: "parent.create",
      entityType: "parent",
      entityId: "11111111-1111-1111-1111-111111111111",
      actorId: "22222222-2222-2222-2222-222222222222",
      actorName: "Admin Test",
      tenantId: TENANT,
      diff: { before: null, after: { name: "BENALI" } },
      note: "Création",
    });

    expect(result.ok).toBe(true);
    expect(rpcArgs).toMatchObject({
      p_tenant_id: TENANT,
      p_action: "parent.create",
      p_entity_id: "11111111-1111-1111-1111-111111111111",
    });
    if (result.ok) {
      expect(result.value.id).toBe("aud-1");
      expect(result.value.at).toBe("2026-08-11T10:00:00Z");
      expect(JSON.parse(result.value.diff!)).toEqual({
        before: null,
        after: { name: "BENALI" },
      });
    }
  });

  it("log() falls back to a direct table insert when the RPC is unavailable", async () => {
    const client = createFakeClient({ audit_logs: [] });
    // No write_audit_log handler registered → rpc fails → fallback insert.

    const repo = new SupabaseAuditLogRepository(client);
    const result = await repo.log({
      action: "auth.login",
      entityType: "session",
      entityId: "sess-1", // NOT a uuid → must be stored as null
      actorId: "usr-1",
      actorName: "Legacy",
      tenantId: TENANT,
    });

    expect(result.ok).toBe(true);
    const row = client.__tables["audit_logs"].rows[0];
    expect(row.action).toBe("auth.login");
    expect(row.entity_id).toBeNull();
    // The raw non-uuid entityId is preserved inside the note.
    expect(String(row.note)).toContain("sess-1");
    if (result.ok) expect(result.value.action).toBe("auth.login");
  });

  it("query() filters server-side and paginates with hasMore", async () => {
    const rows: Row[] = [];
    for (let i = 0; i < 8; i++) {
      rows.push({
        id: `aud-${i}`,
        tenant_id: TENANT,
        action: i % 2 === 0 ? "payment.collect" : "parent.create",
        entity_type: "payment",
        entity_id: null,
        actor_id: null,
        actor_name: i < 4 ? "Admin Test" : "Autre Agent",
        before_json: null,
        after_json: null,
        note: null,
        ip_address: null,
        user_agent: null,
        occurred_at: `2026-08-0${i + 1}T10:00:00Z`,
        created_at: `2026-08-0${i + 1}T10:00:00Z`,
      });
    }
    const client = createFakeClient({ audit_logs: rows });
    const repo = new SupabaseAuditLogRepository(client);

    const result = await repo.query({
      action: "payment.collect",
      actorNameContains: "admin",
      limit: 2,
      offset: 0,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.entries).toHaveLength(2);
      expect(result.value.total).toBe(2); // even indices with actor Admin Test: i=0,2
      expect(result.value.hasMore).toBe(false);
      expect(result.value.entries.every((e) => e.action === "payment.collect")).toBe(true);
    }
  });

  it("byEntity() returns [] for non-UUID entity ids (mock-era ids)", async () => {
    const client = createFakeClient({ audit_logs: [] });
    const repo = new SupabaseAuditLogRepository(client);
    const result = await repo.byEntity("parent", "par-001");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });

  it("recent() returns the newest entries first", async () => {
    const client = createFakeClient({
      audit_logs: [
        {
          id: "aud-old",
          tenant_id: TENANT,
          action: "a.old",
          entity_type: "x",
          entity_id: null,
          actor_id: null,
          actor_name: null,
          before_json: null,
          after_json: null,
          note: null,
          ip_address: null,
          user_agent: null,
          occurred_at: "2026-01-01T00:00:00Z",
          created_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "aud-new",
          tenant_id: TENANT,
          action: "a.new",
          entity_type: "x",
          entity_id: null,
          actor_id: null,
          actor_name: null,
          before_json: null,
          after_json: null,
          note: null,
          ip_address: null,
          user_agent: null,
          occurred_at: "2026-08-11T00:00:00Z",
          created_at: "2026-08-11T00:00:00Z",
        },
      ],
    });
    const repo = new SupabaseAuditLogRepository(client);
    const result = await repo.recent(1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].id).toBe("aud-new");
    }
  });
});

// ============================================================================
// Notification repository
// ============================================================================

describe("SupabaseNotificationRepository", () => {
  beforeEach(() => {
    localStorage.clear();
    // T-053: repositories read the working tenant from the session — keep an
    // explicit tenant set after clearing (no demo fallback anymore).
    localStorage.setItem(
      "el-imtiyaz.session",
      JSON.stringify({ tenantId: TENANT, userId: "staff-1" }),
    );
  });

  function seedNotifications(): Row[] {
    return [
      {
        id: "ntf-broadcast",
        tenant_id: TENANT,
        kind: "info",
        title: "Broadcast",
        body: "À tous",
        priority: "medium",
        source: "system",
        source_label: "Système",
        target_user_id: null,
        target_role: null,
        is_read: false,
        read_at: null,
        dismissed_at: null,
        triggered_at: "2026-08-11T08:00:00Z",
        expires_at: null,
        link_entity_type: null,
        link_entity_id: null,
        created_by: null,
        created_at: "2026-08-11T08:00:00Z",
        updated_at: "2026-08-11T08:00:00Z",
      },
      {
        id: "ntf-user",
        tenant_id: TENANT,
        kind: "warning",
        title: "Pour l'agent financier",
        body: "Tranche en retard",
        priority: "high",
        source: "system",
        source_label: "Module Finances",
        target_user_id: "user-42",
        target_role: null,
        is_read: false,
        read_at: null,
        dismissed_at: null,
        triggered_at: "2026-08-11T09:00:00Z",
        expires_at: null,
        link_entity_type: "installment",
        link_entity_id: null,
        created_by: null,
        created_at: "2026-08-11T09:00:00Z",
        updated_at: "2026-08-11T09:00:00Z",
      },
      {
        id: "ntf-role",
        tenant_id: TENANT,
        kind: "system",
        title: "Pour les enseignants",
        body: "Conseil de classe",
        priority: "low",
        source: "schedule",
        source_label: "Planning",
        target_user_id: null,
        target_role: "teacher",
        is_read: true,
        read_at: "2026-08-10T09:00:00Z",
        dismissed_at: null,
        triggered_at: "2026-08-10T09:00:00Z",
        expires_at: null,
        link_entity_type: null,
        link_entity_id: null,
        created_by: null,
        created_at: "2026-08-10T09:00:00Z",
        updated_at: "2026-08-10T09:00:00Z",
      },
      {
        id: "ntf-dismissed",
        tenant_id: TENANT,
        kind: "alert",
        title: "Masquée",
        body: "—",
        priority: "low",
        source: "manual",
        source_label: "Manuelle",
        target_user_id: null,
        target_role: null,
        is_read: true,
        read_at: null,
        dismissed_at: "2026-08-10T10:00:00Z",
        triggered_at: "2026-08-10T10:00:00Z",
        expires_at: null,
        link_entity_type: null,
        link_entity_id: null,
        created_by: null,
        created_at: "2026-08-10T10:00:00Z",
        updated_at: "2026-08-10T10:00:00Z",
      },
    ];
  }

  it("observe() seeds from the table and hides dismissed notifications", async () => {
    const client = createFakeClient({ notifications: seedNotifications() });
    const repo = new SupabaseNotificationRepository(client);
    const items = repo.observe();
    // Wait for the async seed to settle.
    await new Promise((r) => setTimeout(r, 10));
    const list = items.get();
    // Ordered by created_at DESC: user (09:00) > broadcast (08:00) > role (08-10).
    expect(list.map((n) => n.id)).toEqual([
      "ntf-user",
      "ntf-broadcast",
      "ntf-role",
    ]);
  });

  it("observeForSession() keeps broadcast + user-targeted + role-targeted alerts", async () => {
    const client = createFakeClient({ notifications: seedNotifications() });
    const repo = new SupabaseNotificationRepository(client);
    const stream = repo.observeForSession({ userId: "user-42", role: Role.Teacher });
    await new Promise((r) => setTimeout(r, 10));
    const ids = stream.get().map((n) => n.id);
    expect(ids).toContain("ntf-broadcast");
    expect(ids).toContain("ntf-user");
    expect(ids).toContain("ntf-role");
    expect(ids).not.toContain("ntf-dismissed");

    // A different user (not teacher) sees only the broadcast.
    const other = repo.observeForSession({ userId: "user-7", role: Role.Parent });
    await new Promise((r) => setTimeout(r, 10));
    expect(other.get().map((n) => n.id)).toEqual(["ntf-broadcast"]);
  });

  it("maps kind↔type and readAt; immediate alerts have null triggeredAt", async () => {
    const client = createFakeClient({ notifications: seedNotifications() });
    const repo = new SupabaseNotificationRepository(client);
    repo.observe();
    await new Promise((r) => setTimeout(r, 10));
    const list = repo.observe().get();
    const broadcast = list.find((n) => n.id === "ntf-broadcast")!;
    expect(broadcast.type).toBe("message"); // kind info → message
    expect(broadcast.triggeredAt).toBeNull(); // triggered_at === created_at
    expect(broadcast.readAt).toBeNull();

    const roleAlert = list.find((n) => n.id === "ntf-role")!;
    expect(roleAlert.type).toBe("system");
    expect(roleAlert.readAt).toBe("2026-08-10T09:00:00Z");
  });

  it("create() stores the manual alert and maps it back", async () => {
    const userUuid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const client = createFakeClient({ notifications: [] });
    const repo = new SupabaseNotificationRepository(client);
    const result = await repo.create({
      title: "Rappel réunion",
      body: "Réunion demain 10h",
      type: "custom",
      priority: "high",
      sourceLabel: "Alertes — Manuelle",
      entityType: null,
      entityId: null,
      targetUserId: userUuid,
      targetRole: null,
      triggeredAt: null,
      createdBy: userUuid,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.source).toBe("manual");
      expect(result.value.type).toBe("custom");
      expect(result.value.targetUserId).toBe(userUuid);
      expect(result.value.readAt).toBeNull();
    }
    const row = client.__tables["notifications"].rows[0];
    expect(row.kind).toBe("alert");
    expect(row.source).toBe("manual");
    expect(row.target_user_id).toBe(userUuid);
  });

  it("markRead() flags the row and refreshes the cache", async () => {
    const client = createFakeClient({ notifications: seedNotifications() });
    const repo = new SupabaseNotificationRepository(client);
    repo.observe();
    await new Promise((r) => setTimeout(r, 10));

    const result = await repo.markRead("ntf-broadcast");
    expect(result.ok).toBe(true);
    const row = client.__tables["notifications"].rows.find(
      (r: Row) => r.id === "ntf-broadcast",
    )!;
    expect(row.is_read).toBe(true);
    expect(row.read_at).toBeTruthy();
    await new Promise((r) => setTimeout(r, 10));
    expect(repo.observe().get().find((n) => n.id === "ntf-broadcast")?.readAt).toBeTruthy();
  });

  it("dismiss() soft-dismisses (dismissed_at) and hides the alert from the feed", async () => {
    const client = createFakeClient({ notifications: seedNotifications() });
    const repo = new SupabaseNotificationRepository(client);
    repo.observe();
    await new Promise((r) => setTimeout(r, 10));

    const result = await repo.dismiss("ntf-user");
    expect(result.ok).toBe(true);
    const row = client.__tables["notifications"].rows.find(
      (r: Row) => r.id === "ntf-user",
    )!;
    expect(row.dismissed_at).toBeTruthy();
    await new Promise((r) => setTimeout(r, 10));
    expect(repo.observe().get().map((n) => n.id)).not.toContain("ntf-user");
  });

  it("update() patches priority and title", async () => {
    const client = createFakeClient({ notifications: seedNotifications() });
    const repo = new SupabaseNotificationRepository(client);
    repo.observe();
    await new Promise((r) => setTimeout(r, 10));

    const result = await repo.update("ntf-broadcast", {
      title: "Broadcast (modifié)",
      priority: "urgent",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe("Broadcast (modifié)");
      expect(result.value.priority).toBe("urgent");
    }
  });
});

// ============================================================================
// Personnel + departments
// ============================================================================

const ROLES: Row[] = [
  { id: "role-super", code: "super_admin" },
  { id: "role-teacher", code: "teacher" },
  { id: "role-support", code: "support_staff" },
];

function personnelRow(overrides: Row = {}): Row {
  return {
    id: "per-uuid-1",
    tenant_id: TENANT,
    personnel_code: "PER-2026-0001",
    user_id: null,
    first_name: "Amine",
    last_name: "Kaci",
    date_of_birth: null,
    national_id: null,
    staff_category: "teaching",
    role_id: "role-teacher",
    department_id: null,
    supervisor_id: null,
    position: "Professeur de Mathématiques",
    hire_date: "2025-09-01",
    end_date: null,
    is_active: true,
    base_salary: 45000,
    payment_method: "bank_transfer",
    bank_account: null,
    bonuses_json: [],
    primary_phone: "0555000000",
    email: null,
    address: null,
    emergency_contact: { name: "Sara", phone: "0666000000", relation: "Épouse" },
    documents_json: [],
    notes: null,
    created_at: "2025-09-01T00:00:00Z",
    updated_at: "2025-09-01T00:00:00Z",
    deleted_at: null,
    ...overrides,
  };
}

describe("SupabasePersonnelRepository", () => {
  beforeEach(() => {
    localStorage.clear();
    // T-053: repositories read the working tenant from the session — keep an
    // explicit tenant set after clearing (no demo fallback anymore).
    localStorage.setItem(
      "el-imtiyaz.session",
      JSON.stringify({ tenantId: TENANT, userId: "staff-1" }),
    );
  });

  it("maps a personnel row to the domain (category teacher, role code, emergency contact)", async () => {
    const client = createFakeClient({ personnel: [personnelRow()], roles: ROLES });
    const repo = new SupabasePersonnelRepository(client);
    repo.observe();
    await new Promise((r) => setTimeout(r, 10));

    const list = repo.observe().get();
    expect(list).toHaveLength(1);
    const p = list[0];
    expect(p.staffCategory).toBe("teacher"); // DB "teaching" → domain "teacher"
    expect(p.roleId).toBe(Role.Teacher); // role uuid → code
    expect(p.emergencyContact?.name).toBe("Sara");
    expect(p.status).toBe("active");
    expect(p.salary).toBe(45000);
  });

  it("createPersonnel() maps the domain → row shape (category, role, emergency contact)", async () => {
    const client = createFakeClient({ personnel: [], roles: ROLES });
    const repo = new SupabasePersonnelRepository(client);
    const result = await repo.createPersonnel({
      userId: null,
      firstName: "Nadia",
      lastName: "Belkacem",
      staffCategory: "teacher",
      roleId: Role.Teacher,
      departmentId: null,
      supervisorId: null,
      position: "Professeure d'Arabe",
      phone: "0777000000",
      email: "nadia@example.dz",
      address: null,
      hireDate: "2026-09-01",
      terminationDate: null,
      salary: 40000,
      paymentMethod: "mobile_money", // not allowed by the DB CHECK → NULL
      bankAccount: null,
      weeklyHoursTarget: 40,
      avatarUrl: null,
      dateOfBirth: null,
      nationalId: null,
      status: "active",
      bonuses: [],
      documents: [],
      notes: [],
      emergencyContact: null,
    });

    expect(result.ok).toBe(true);
    const row = client.__tables["personnel"].rows[0];
    expect(row.staff_category).toBe("teaching");
    expect(row.role_id).toBe("role-teacher");
    expect(row.payment_method).toBeNull();
    expect(row.personnel_code).toMatch(/^PER-\d{4}-[0-9A-F]{6}$/);
    expect(row.emergency_contact).toEqual({});
    if (result.ok) {
      expect(result.value.roleId).toBe(Role.Teacher);
      expect(result.value.staffCategory).toBe("teacher");
      expect(result.value.status).toBe("active");
    }
  });

  it("deletePersonnel() soft-deletes (deleted_at) and removes the row from the feed", async () => {
    const client = createFakeClient({ personnel: [personnelRow()], roles: ROLES });
    const repo = new SupabasePersonnelRepository(client);
    repo.observe();
    await new Promise((r) => setTimeout(r, 10));
    expect(repo.observe().get()).toHaveLength(1);

    const result = await repo.deletePersonnel("per-uuid-1");
    expect(result.ok).toBe(true);
    const row = client.__tables["personnel"].rows[0];
    expect(row.deleted_at).toBeTruthy();
    await new Promise((r) => setTimeout(r, 10));
    expect(repo.observe().get()).toHaveLength(0);
  });

  it("observeByUserId() resolves the signed-in staff member", async () => {
    const client = createFakeClient({
      personnel: [personnelRow({ user_id: "user-9" })],
      roles: ROLES,
    });
    const repo = new SupabasePersonnelRepository(client);
    const stream = repo.observeByUserId("user-9");
    await new Promise((r) => setTimeout(r, 10));
    expect(stream.get()?.id).toBe("per-uuid-1");
    expect(repo.observeByUserId("user-404").get()).toBeNull();
  });

  it("terminated personnel read back as terminated via end_date", async () => {
    const client = createFakeClient({
      personnel: [personnelRow({ is_active: false, end_date: "2026-06-30" })],
      roles: ROLES,
    });
    const repo = new SupabasePersonnelRepository(client);
    repo.observe();
    await new Promise((r) => setTimeout(r, 10));
    expect(repo.observe().get()[0].status).toBe("terminated");
  });
});

describe("SupabaseDepartmentRepository", () => {
  beforeEach(() => {
    localStorage.clear();
    // T-053: repositories read the working tenant from the session — keep an
    // explicit tenant set after clearing (no demo fallback anymore).
    localStorage.setItem(
      "el-imtiyaz.session",
      JSON.stringify({ tenantId: TENANT, userId: "staff-1" }),
    );
  });

  it("maps color tokens to hex on write and back on read", async () => {
    const client = createFakeClient({ departments: [] });
    const repo = new SupabaseDepartmentRepository(client);

    const created = await repo.createDepartment({
      name: "Informatique",
      description: "IT & systèmes",
      color: "brand-gold",
      headId: null,
      parentId: null,
    });
    expect(created.ok).toBe(true);
    const row = client.__tables["departments"].rows[0];
    expect(row.name_fr).toBe("Informatique");
    expect(row.color_hex).toBe("#c8a98c");
    expect(row.code).toMatch(/^[A-Z0-9]{1,4}-[0-9A-F]{6}$/);

    repo.observe();
    await new Promise((r) => setTimeout(r, 10));
    const list = repo.observe().get();
    expect(list).toHaveLength(1);
    expect(list[0].color).toBe("brand-gold");
    expect(list[0].name).toBe("Informatique");
  });

  it("archive / unarchive toggles archivedAt", async () => {
    const client = createFakeClient({ departments: [] });
    const repo = new SupabaseDepartmentRepository(client);
    const created = await repo.createDepartment({
      name: "Transport",
      description: "",
      color: "status-info",
      headId: null,
      parentId: null,
    });
    expect(created.ok).toBe(true);
    const id = created.ok ? created.value.id : "";

    const archived = await repo.archiveDepartment(id);
    expect(archived.ok).toBe(true);
    if (archived.ok) expect(archived.value.archivedAt).toBeTruthy();

    const restored = await repo.unarchiveDepartment(id);
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(restored.value.archivedAt).toBeNull();
  });

  it("deleteDepartment() removes the row", async () => {
    const client = createFakeClient({ departments: [] });
    const repo = new SupabaseDepartmentRepository(client);
    const created = await repo.createDepartment({
      name: "Cantine",
      description: "",
      color: "brand-blue",
      headId: null,
      parentId: null,
    });
    const id = created.ok ? created.value.id : "";
    const result = await repo.deleteDepartment(id);
    expect(result.ok).toBe(true);
    expect(client.__tables["departments"].rows).toHaveLength(0);
  });
});

// ============================================================================
// Promotion repository (execute_batch_promotion RPC removal)
// ============================================================================

describe("SupabasePromotionRepository", () => {
  beforeEach(() => {
    localStorage.clear();
    // T-053: repositories read the working tenant from the session — keep an
    // explicit tenant set after clearing (no demo fallback anymore).
    localStorage.setItem(
      "el-imtiyaz.session",
      JSON.stringify({ tenantId: TENANT, userId: "staff-1" }),
    );
  });

  const STUDENT_ID = "11111111-1111-1111-1111-111111111111";

  function candidate(overrides: Row = {}) {
    return {
      student: {
        id: STUDENT_ID,
        gradeLevel: "5ap",
        level: "primaire",
        gradeYear: 5,
        classId: "cls-uuid",
      },
      yearlyGpa: 14.5,
      isPassing: true,
      suggestedDecision: "promoted",
      nextGradeLevel: "1am",
      nextAcademicLevel: "cem",
      nextGradeYear: 1,
      ...overrides,
    };
  }

  it("advances students via direct table updates (no execute_batch_promotion RPC)", async () => {
    const client = createFakeClient({
      students: [
        {
          id: STUDENT_ID,
          tenant_id: TENANT,
          student_code: "ELV-2026-000001",
          first_name: "Sara",
          last_name: "Benali",
          parent_id: "p1",
          grade_level_code: "5ap",
          class_id: "cls-uuid",
          enrollment_status: "active",
          is_active: true,
          date_of_birth: "2014-01-01",
          enrollment_date: "2025-09-01",
          payment_plan: "tranches",
          created_at: "2025-09-01T00:00:00Z",
          updated_at: "2025-09-01T00:00:00Z",
        },
      ],
      student_academic_histories: [],
    });
    let auditCalled = false;
    client.__rpcHandlers["write_audit_log"] = () => {
      auditCalled = true;
      return "aud-promo";
    };

    const repo = new SupabasePromotionRepository(client);
    const result = await repo.executeBatchPromotion({
      candidates: [{ candidate: candidate() as any, finalDecision: "promoted" }],
      targetAcademicYear: "2026-2027",
      performedBy: "user-1",
      performedByName: "Admin",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.updatedCount).toBe(1);
      expect(result.value.promotedStudents[0].gradeLevel).toBe("1am");
      expect(result.value.promotedStudents[0].level).toBe("cem");
    }

    const student = client.__tables["students"].rows[0];
    expect(student.grade_level_code).toBe("1am");
    expect(student.class_id).toBeNull();

    // History entry recorded for the COMPLETED year (2025-2026).
    const history = client.__tables["student_academic_histories"].rows[0];
    expect(history.academic_year).toBe("2025-2026");
    expect(history.decision).toBe("promoted");
    expect(history.gpa).toBe(14.5);

    expect(auditCalled).toBe(true);
  });

  it("graduates 3eme_annee students instead of advancing them", async () => {
    const client = createFakeClient({
      students: [
        {
          id: STUDENT_ID,
          tenant_id: TENANT,
          student_code: "ELV-2026-000002",
          first_name: "Yacine",
          last_name: "Amrani",
          parent_id: "p1",
          grade_level_code: "3eme_annee",
          class_id: "cls-uuid",
          enrollment_status: "active",
          is_active: true,
          date_of_birth: "2007-01-01",
          enrollment_date: "2025-09-01",
          payment_plan: "tranches",
          created_at: "2025-09-01T00:00:00Z",
          updated_at: "2025-09-01T00:00:00Z",
        },
      ],
      student_academic_histories: [],
    });
    client.__rpcHandlers["write_audit_log"] = () => "aud-grad";

    const repo = new SupabasePromotionRepository(client);
    const result = await repo.executeBatchPromotion({
      candidates: [
        {
          candidate: candidate({
            student: {
              id: STUDENT_ID,
              gradeLevel: "3eme_annee",
              level: "lycee",
              gradeYear: 3,
              classId: "cls-uuid",
            },
            nextGradeLevel: null,
            nextAcademicLevel: null,
            nextGradeYear: null,
          }) as any,
          finalDecision: "graduated",
        },
      ],
      targetAcademicYear: "2026-2027",
      performedBy: "user-1",
      performedByName: "Admin",
    });

    expect(result.ok).toBe(true);
    const student = client.__tables["students"].rows[0];
    expect(student.enrollment_status).toBe("graduated");
    expect(student.class_id).toBeNull();
  });
});
