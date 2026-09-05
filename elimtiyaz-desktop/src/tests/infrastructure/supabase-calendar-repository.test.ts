/**
 * SupabaseCalendarRepository unit tests (T-175 / T-047 port #1).
 *
 * Verifies the canonical contract of the calendar port:
 *   1. create() inserts manual events with the full column mapping
 *      (date+time → start_at, all_day, priority, assignment, follow-up-call /
 *      meeting / reminder extras) and the bucket reflects the write.
 *   2. update() patches mutable fields and re-derives start_at when the date
 *      or time changes; auto-generated kinds are rejected (mock parity).
 *   3. delete() SOFT-deletes (is_deleted = true — 0013 semantics) and the
 *      event leaves the bucket.
 *   4. observeForDate/observeForMonth merge the four sources — manual
 *      calendar_events rows + DERIVED payments (paid/partial, joined parents)
 *      + audit_logs (auth noise skipped) + expense milestones — with the
 *      mock's sort order (timed first, then all-day by createdAt).
 *   5. Persistence-across-restart: a SECOND repository instance over the
 *      same table data sees the manual event (the table is the store —
 *      the ARCH-006 mock-leak fix).
 *   6. Source scans: the supabase-repositories.ts wiring overrides the
 *      `calendar` slot; the kind union is identical across the domain model,
 *      migration 0013's CHECK constraint and the website's CalendarEventRow
 *      (cross-platform parity — the website reads the same table).
 *
 * The Supabase client is faked with the same minimal PostgREST builder
 * surface as the T-093/T-080 suites (from/eq/is/gte/lt/in/order/limit/
 * select/insert/update/single/maybeSingle/then).
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseCalendarRepository } from "../../infrastructure/supabase/repositories/supabase-calendar-repository";
import { Role } from "../../core/rbac/roles";
import type {
  CalendarEvent,
  FollowUpCallCalendarEvent,
  PaymentCalendarEvent,
  ExpenseCalendarEvent,
} from "../../domain/model/calendar";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// Fake Supabase client — minimal PostgREST builder surface
// ============================================================================

type Row = Record<string, any>;

class FakeQuery {
  private filters: ((row: Row) => boolean)[] = [];
  private mode: "select" | "insert" | "update" = "select";
  private payload: Row | null = null;
  private wantSingle = false;
  private maybeMode = false;
  private orderCol = "";
  private orderAsc = true;
  private limitN: number | null = null;

  constructor(private readonly table: Row[]) {}

  eq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }

  is(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }

  gte(col: string, val: unknown): this {
    this.filters.push((r) => String(r[col]) >= String(val));
    return this;
  }

  lt(col: string, val: unknown): this {
    this.filters.push((r) => String(r[col]) < String(val));
    return this;
  }

  in(col: string, vals: readonly unknown[]): this {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderCol = col;
    this.orderAsc = opts?.ascending !== false;
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

  maybeSingle(): this {
    this.wantSingle = true;
    this.maybeMode = true;
    return this;
  }

  private run(): { data: Row | Row[] | null; error: { message: string } | null } {
    if (this.mode === "insert") {
      const row = { id: "new-cal-1", created_at: "2026-09-05T10:00:00Z", updated_at: "2026-09-05T10:00:00Z", is_deleted: false, ...this.payload };
      this.table.push(row);
      return { data: row, error: null };
    }
    if (this.mode === "update") {
      const patched: Row[] = [];
      for (const row of this.table) {
        if (this.filters.every((f) => f(row))) {
          Object.assign(row, this.payload ?? {});
          patched.push(row);
        }
      }
      if (this.wantSingle) {
        if (patched.length === 0) {
          return { data: null, error: { message: "no rows (PGRST116)" } };
        }
        return { data: patched[0], error: null };
      }
      return { data: patched, error: null };
    }
    // SELECT
    let rows = this.table.filter((r) => this.filters.every((f) => f(r)));
    if (this.orderCol) {
      rows = [...rows].sort((a, b) => {
        const cmp = String(a[this.orderCol] ?? "").localeCompare(String(b[this.orderCol] ?? ""));
        return this.orderAsc ? cmp : -cmp;
      });
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    if (this.wantSingle) {
      if (rows.length === 0) {
        return this.maybeMode
          ? { data: null, error: null }
          : { data: null, error: { message: "no rows (PGRST116)" } };
      }
      return { data: rows[0], error: null };
    }
    return { data: rows, error: null };
  }

  then<TResult1>(
    onFulfilled:
      | ((value: { data: Row | Row[] | null; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
  ): Promise<TResult1> {
    return Promise.resolve(onFulfilled!(this.run() as never));
  }
}

class FakeClient {
  tables: Record<string, Row[]> = {};

  from(tableName: string): FakeQuery {
    if (!this.tables[tableName]) this.tables[tableName] = [];
    return new FakeQuery(this.tables[tableName]);
  }
}

const fakeClient = new FakeClient();

// ============================================================================
// Fixtures
// ============================================================================

const TENANT = "00000000-0000-0000-0000-000000000001";
const STAFF = "bbbbbbbb-0000-0000-0000-0000000000b1";
const PARENT_UUID = "dddddddd-0000-0000-0000-0000000000d1";

function manualRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "cal-uuid-1",
    tenant_id: TENANT,
    kind: "follow_up_call",
    title: "Appel Mme MAMER",
    description: "Rappeler au sujet de la tranche 2",
    start_at: "2026-09-10T14:30:00",
    end_at: null,
    all_day: false,
    location: null,
    attendee_count: 0,
    target_entity_type: "parent",
    target_entity_id: PARENT_UUID,
    target_name: "MAMER A",
    target_phone: "+213555000111",
    created_by: STAFF,
    priority: "high",
    assigned_to_user_id: null,
    assigned_to_role: "financial_officer",
    created_at: "2026-09-05T10:00:00Z",
    updated_at: "2026-09-05T10:00:00Z",
    is_deleted: false,
    ...overrides,
  };
}

function paymentRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "pay-uuid-1",
    tenant_id: TENANT,
    receipt_number: "RC-2026-0001",
    payment_number: "RC-2026-0001",
    parent_id: PARENT_UUID,
    amount: 90000,
    method: "cash",
    category: "tuition",
    status: "paid",
    collected_at: "2026-09-10T09:15:00",
    collected_by: STAFF,
    created_at: "2026-09-10T09:15:00Z",
    parents: { display_name: "MAMER A", first_name: "", last_name: "MAMER" },
    ...overrides,
  };
}

function auditRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "aud-uuid-1",
    tenant_id: TENANT,
    action: "payment.create",
    entity_type: "payment",
    entity_id: "pay-uuid-1",
    actor_id: STAFF,
    actor_name: "Admin",
    note: null,
    occurred_at: "2026-09-10T11:00:00",
    created_at: "2026-09-10T11:00:00Z",
    ...overrides,
  };
}

function expenseRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "exp-uuid-1",
    tenant_id: TENANT,
    ticket_number: "DEP-2026-001",
    title: "Fournitures de bureau",
    requested_amount: 25000,
    status: "pending_approval",
    submitted_by: STAFF,
    submitted_at: "2026-09-10T08:00:00",
    approved_by: null,
    approved_at: null,
    disbursed_at: null,
    created_at: "2026-09-10T08:00:00Z",
    ...overrides,
  };
}

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 10));
}

// ============================================================================
// Tests
// ============================================================================

describe("SupabaseCalendarRepository (T-175)", () => {
  beforeEach(() => {
    fakeClient.tables = {};
    localStorage.setItem(
      "el-imtiyaz.session",
      JSON.stringify({ tenantId: TENANT, userId: STAFF }),
    );
    return () => localStorage.removeItem("el-imtiyaz.session");
  });

  it("1. create() maps the full manual-event contract onto calendar_events", async () => {
    const repo = new SupabaseCalendarRepository(fakeClient as unknown as SupabaseClient);
    const result = await repo.create({
      kind: "follow_up_call",
      date: "2026-09-10",
      time: "14:30",
      title: "Appel Mme MAMER",
      description: "Rappeler au sujet de la tranche 2",
      priority: "high",
      assignedToRole: Role.FinancialOfficer,
      createdBy: STAFF,
      targetType: "parent",
      targetId: PARENT_UUID,
      targetName: "MAMER A",
      phone: "+213555000111",
    });
    expect(result.ok).toBe(true);
    const row = fakeClient.tables["calendar_events"][0];
    expect(row.tenant_id).toBe(TENANT);
    expect(row.kind).toBe("follow_up_call");
    expect(row.start_at).toBe("2026-09-10T14:30:00");
    expect(row.all_day).toBe(false);
    expect(row.priority).toBe("high");
    expect(row.assigned_to_role).toBe("financial_officer");
    expect(row.target_entity_type).toBe("parent");
    expect(row.target_entity_id).toBe(PARENT_UUID);
    expect(row.target_name).toBe("MAMER A");
    expect(row.target_phone).toBe("+213555000111");
    const event = (result as { value: FollowUpCallCalendarEvent }).value;
    expect(event.kind).toBe("follow_up_call");
    expect(event.date).toBe("2026-09-10");
    expect(event.time).toBe("14:30");
    expect(event.phone).toBe("+213555000111");
  });

  it("2. create() all-day events store midnight + all_day=true (0013 convention)", async () => {
    const repo = new SupabaseCalendarRepository(fakeClient as unknown as SupabaseClient);
    const result = await repo.create({
      kind: "custom",
      date: "2026-09-12",
      time: null,
      title: "Journée portes ouvertes",
      description: null,
      priority: "medium",
      createdBy: STAFF,
    });
    expect(result.ok).toBe(true);
    const row = fakeClient.tables["calendar_events"][0];
    expect(row.start_at).toBe("2026-09-12T00:00:00");
    expect(row.all_day).toBe(true);
  });

  it("3. create() maps meeting + reminder extras", async () => {
    const repo = new SupabaseCalendarRepository(fakeClient as unknown as SupabaseClient);
    await repo.create({
      kind: "meeting",
      date: "2026-09-15",
      time: "10:00",
      title: "Réunion parents",
      description: null,
      priority: "medium",
      createdBy: STAFF,
      location: "Salle 2",
      attendeeCount: 12,
    });
    await repo.create({
      kind: "reminder",
      date: "2026-09-16",
      time: "09:00",
      title: "Relance impayés",
      description: null,
      priority: "low",
      createdBy: STAFF,
      linkedEntityType: "payment",
      linkedEntityId: "eeeeeeee-0000-0000-0000-0000000000e1",
    });
    const rows = fakeClient.tables["calendar_events"];
    expect(rows[0].location).toBe("Salle 2");
    expect(rows[0].attendee_count).toBe(12);
    expect(rows[1].target_entity_type).toBe("payment");
    expect(rows[1].target_entity_id).toBe("eeeeeeee-0000-0000-0000-0000000000e1");
  });

  it("4. create() rejects auto-generated kinds (mock parity)", async () => {
    const repo = new SupabaseCalendarRepository(fakeClient as unknown as SupabaseClient);
    fakeClient.from("calendar_events"); // ensure the table exists in the fake
    const result = await repo.create({
      kind: "payment_received",
      date: "2026-09-10",
      time: null,
      title: "x",
      description: null,
      priority: "low",
      createdBy: STAFF,
    } as unknown as Parameters<SupabaseCalendarRepository["create"]>[0]); // deliberate type-level violation — the runtime guard is under test
    expect(result.ok).toBe(false);
    expect(fakeClient.tables["calendar_events"]).toHaveLength(0);
  });

  it("5. update() patches fields and re-derives start_at; auto kinds rejected", async () => {
    fakeClient.tables["calendar_events"] = [manualRow()];
    const repo = new SupabaseCalendarRepository(fakeClient as unknown as SupabaseClient);
    const ok = await repo.update("cal-uuid-1", {
      title: "Appel Mme MAMER (reporté)",
      time: "16:00",
      priority: "urgent",
    });
    expect(ok.ok).toBe(true);
    const row = fakeClient.tables["calendar_events"][0];
    expect(row.title).toBe("Appel Mme MAMER (reporté)");
    expect(row.start_at).toBe("2026-09-10T16:00:00");
    expect(row.priority).toBe("urgent");
    expect(row.updated_at).not.toBe("2026-09-05T10:00:00Z");

    fakeClient.tables["calendar_events"] = [
      manualRow({ id: "cal-auto-1", kind: "payment_received" }),
    ];
    const rejected = await repo.update("cal-auto-1", { title: "x" });
    expect(rejected.ok).toBe(false);
  });

  it("6. delete() soft-deletes (is_deleted=true) and the bucket drops the event", async () => {
    fakeClient.tables["calendar_events"] = [manualRow()];
    const repo = new SupabaseCalendarRepository(fakeClient as unknown as SupabaseClient);
    const obs = repo.observeForDate("2026-09-10");
    await settle();
    expect(obs.get()).toHaveLength(1);
    const result = await repo.delete("cal-uuid-1");
    expect(result.ok).toBe(true);
    expect(fakeClient.tables["calendar_events"][0].is_deleted).toBe(true);
    expect(obs.get()).toHaveLength(0);
  });

  it("7. observeForDate merges manual + derived payment/audit/expense events, sorted timed-first", async () => {
    fakeClient.tables["calendar_events"] = [manualRow()]; // 14:30 follow-up call
    fakeClient.tables["payments"] = [paymentRow()]; // 09:15 payment
    fakeClient.tables["audit_logs"] = [
      auditRow(),
      auditRow({ id: "aud-uuid-2", action: "auth.login", occurred_at: "2026-09-10T07:00:00" }),
    ];
    fakeClient.tables["expense_tickets"] = [expenseRow()]; // 08:00 submission
    const repo = new SupabaseCalendarRepository(fakeClient as unknown as SupabaseClient);
    const obs = repo.observeForDate("2026-09-10");
    await settle();
    const events = obs.get();
    // 4 events: payment + audit + expense + manual (auth.login skipped)
    expect(events).toHaveLength(4);
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("payment_received");
    expect(kinds).toContain("audit_log");
    expect(kinds).toContain("expense_event");
    expect(kinds).toContain("follow_up_call");
    // Timed events in chronological order: 08:00, 09:15, 11:00, 14:30
    expect(events.map((e) => e.time)).toEqual(["08:00", "09:15", "11:00", "14:30"]);
    // Payment derived shape
    const pay = events.find(
      (e): e is PaymentCalendarEvent => e.kind === "payment_received",
    );
    expect(pay).toBeDefined();
    if (pay) {
      expect(pay.title).toBe("Paiement — MAMER A");
      expect(pay.amount).toBe(90000);
      expect(pay.receiptNumber).toBe("RC-2026-0001");
      expect(pay.parentName).toBe("MAMER A");
    }
    // Expense milestone label + priority escalation
    const exp = events.find(
      (e): e is ExpenseCalendarEvent => e.kind === "expense_event",
    );
    expect(exp).toBeDefined();
    if (exp) {
      expect(exp.title).toBe("Soumission — Fournitures de bureau");
      expect(exp.priority).toBe("low");
      expect(exp.expenseStatus).toBe("pending_approval");
    }
  });

  it("8. observeForDate filters other dates and payments by status (paid/partial only)", async () => {
    fakeClient.tables["payments"] = [
      paymentRow(),
      paymentRow({ id: "pay-uuid-2", status: "pending", collected_at: "2026-09-10T12:00:00" }),
      paymentRow({ id: "pay-uuid-3", collected_at: "2026-08-31T12:00:00" }),
    ];
    const repo = new SupabaseCalendarRepository(fakeClient as unknown as SupabaseClient);
    const obs = repo.observeForDate("2026-09-10");
    await settle();
    const events = obs.get();
    expect(events).toHaveLength(1); // only the paid payment on 2026-09-10
    expect(events[0].kind).toBe("payment_received");
    const only = events[0] as PaymentCalendarEvent;
    expect(only.paymentId).toBe("pay-uuid-1");
  });

  it("9. expense milestones: approve + disburse dates derive separate events in their own months", async () => {
    fakeClient.tables["expense_tickets"] = [
      expenseRow({
        approved_by: STAFF,
        approved_at: "2026-09-12T13:00:00",
        disbursed_at: "2026-10-02T09:00:00",
      }),
    ];
    const repo = new SupabaseCalendarRepository(fakeClient as unknown as SupabaseClient);
    const sept = repo.observeForDate("2026-09-12");
    await settle();
    // 2026-09-12: submit (08:00 on 09-10 — NOT this date) + approve (13:00)
    const septEvents = sept.get();
    expect(septEvents).toHaveLength(1);
    expect(septEvents[0].title).toContain("Approbation");
    expect((septEvents[0] as any).priority).toBe("medium");

    const oct = repo.observeForMonth("2026-10");
    await settle();
    const octEvents = oct.get();
    expect(octEvents).toHaveLength(1);
    expect(octEvents[0].title).toContain("Décaissement");
  });

  it("10. persistence-across-restart: a second repository instance reads the same table", async () => {
    fakeClient.tables["calendar_events"] = [manualRow()];
    const first = new SupabaseCalendarRepository(fakeClient as unknown as SupabaseClient);
    const created = await first.create({
      kind: "custom",
      date: "2026-09-20",
      time: "11:00",
      title: "Événement persisté",
      description: null,
      priority: "medium",
      createdBy: STAFF,
    });
    expect(created.ok).toBe(true);
    // A "restart" = a new repository instance with an empty bucket map.
    const second = new SupabaseCalendarRepository(fakeClient as unknown as SupabaseClient);
    const obs = second.observeForDate("2026-09-20");
    await settle();
    const events = obs.get();
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("Événement persisté");
    expect((events[0] as CalendarEvent).date).toBe("2026-09-20");
  });

  it("11. source scan: supabase-repositories.ts wires the calendar slot (T-047 port #1)", () => {
    const wiring = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../infrastructure/supabase/supabase-repositories.ts",
      ),
      "utf-8",
    );
    expect(wiring).toContain("import { SupabaseCalendarRepository }");
    expect(wiring).toMatch(/const calendar = new SupabaseCalendarRepository\(client\)/);
    expect(wiring).toMatch(/^ {4}calendar,/m);
    // The mock calendar must NOT be wired in Supabase mode anymore.
    expect(wiring).not.toMatch(/calendar:\s*mockCalendarRepository/);
  });

  it("12. cross-platform kind parity: domain union == migration 0013 CHECK == website CalendarEventRow", () => {
    // (a) Domain model kinds
    const domainKinds = [
      "payment_received",
      "audit_log",
      "expense_event",
      "follow_up_call",
      "reminder",
      "meeting",
      "custom",
    ];
    const domainSrc = fs.readFileSync(
      path.resolve(__dirname, "../../domain/model/calendar.ts"),
      "utf-8",
    );
    for (const k of domainKinds) {
      expect(domainSrc).toContain(`"${k}"`);
    }
    // (b) Migration 0013 CHECK constraint carries the same set
    const migration = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../supabase/migrations/0013_calendar_notifications_backup.sql",
      ),
      "utf-8",
    );
    for (const k of domainKinds) {
      expect(migration).toContain(`'${k}'`);
    }
    // (c) The website's typed CalendarEventRow carries the same set — the
    // website repo must be checked out as a sibling (AgentGithubUplaod/
    // elimtiyaz-desktop ↔ ../elimtiyaz-website); skipped gracefully when
    // absent so the desktop suite stays runnable standalone.
    const websiteTypesPath = path.resolve(
      __dirname,
      "../../../../../../elimtiyaz-website/src/lib/types/database.ts",
    );
    if (fs.existsSync(websiteTypesPath)) {
      const websiteTypes = fs.readFileSync(websiteTypesPath, "utf-8");
      for (const k of domainKinds) {
        expect(websiteTypes).toContain(`"${k}"`);
      }
    }
  });
});
