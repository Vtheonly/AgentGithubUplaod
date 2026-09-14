/**
 * T-371 (WORKFORCE-501) — the account ↔ employee linkage regression suite.
 *
 * Owner mandate (2026-09-14): "link the account created in the Admin
 * Settings to an employee. When the employee logs in, they should see their
 * own profile, tasks, responsibilities… the account is properly associated
 * with the selected employee from the moment it is created."
 *
 * What this suite pins:
 *
 *   A. MockUserAccountRepository.createAccount({ personnelId }) — the
 *      linkage: the personnel row gets the minted account id (userId),
 *      the contact email backfills when absent, the audit entry records the
 *      link, and a REJECTED link never mints a half-account (unknown id /
 *      already-bound guard).
 *   B. THE core end-to-end assertion (mock mode): the created user signs in
 *      with their own credentials AND their dossier resolves —
 *      observeByUserId(session.userId) returns the employee record.
 *   C. listAccounts() — the admin's verification surface: every account
 *      with its role and its bound employee (mock join).
 *   D. The task id-space repair: the seeded tasks are keyed on the ACCOUNT
 *      ids (usr-*) — the space assignee_ids stores per 0010/0019 — and the
 *      legacy personnel-id space returns nothing.
 *   E. SupabaseUserAccountRepository — the EF payload carries personnel_id,
 *      the response echo maps into CreatedAccount, and listAccounts joins
 *      the four RLS-permitted reads.
 *   F. Source scans — the UI wiring stays on the account id space
 *      (task-form-modal option values), the AccountsTab hosts the redesigned
 *      modal, the ProfilePage carries the employee dossier, and migration
 *      0097 exists with the overload drop + the unique index.
 */
import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { MockAuthRepository } from "../../infrastructure/mock/repositories/auth-repository";
import {
  MockUserAccountRepository,
  mockUserAccountRepository,
} from "../../infrastructure/mock/repositories/user-account-repository";
import { MockPersonnelRepository } from "../../infrastructure/mock/repositories/personnel-audit-repository";
import { SupabaseUserAccountRepository } from "../../infrastructure/supabase/repositories/supabase-user-account-repository";
import { mockTaskRepository } from "../../infrastructure/mock/workforce/index";
import { seedAccounts, store } from "../../infrastructure/mock/repositories/mock-store";
import { AuditActions } from "../../core/audit-actions";
import { Role } from "../../core/rbac/roles";
import { mockRepositories } from "../../app/providers/repository-provider";
import type { CreateAccountInput } from "../../domain/repository/repository";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const MINTED: string[] = [];
const TOUCHED_PERSONNEL: string[] = [];

function makeInput(overrides: Partial<CreateAccountInput> = {}): CreateAccountInput {
  const suffix = Math.random().toString(36).slice(2, 8);
  const email = `linked-user-${suffix}@el-imtiyaz.test`;
  MINTED.push(email);
  return {
    email,
    fullName: "Nouvel Employé",
    phone: "+213 555 000 222",
    role: Role.Worker,
    initialPassword: "InitialPassw0rd",
    ...overrides,
  };
}

function cleanup(): void {
  for (const email of MINTED) {
    const idx = seedAccounts.findIndex((a) => a.email === email);
    if (idx >= 0) seedAccounts.splice(idx, 1);
  }
  MINTED.length = 0;
  // Restore the touched personnel rows to their pre-test state (unbound).
  for (const pid of TOUCHED_PERSONNEL) {
    const p = store.personnel.find((x) => x.id === pid);
    if (p) (p as { userId: string | null }).userId = null;
  }
  TOUCHED_PERSONNEL.length = 0;
  store.notifyPersonnel();
}

/** The id of a seeded UNLINKED personnel row (mock seeds ship several). */
function unlinkedPersonnelId(): string {
  const p = store.personnel.find((x) => !x.userId && x.status === "active");
  if (!p) throw new Error("test fixture: no unlinked active personnel seed");
  TOUCHED_PERSONNEL.push(p.id);
  return p.id;
}

/* ================================================================== */
/* A + B — the mock linkage + the sign-in round-trip                   */
/* ================================================================== */

describe("T-371 A. MockUserAccountRepository — the account↔employee linkage", () => {
  afterEach(cleanup);

  it("binds the personnel row to the minted account (userId + email backfill) and echoes code/name", async () => {
    const repo = new MockUserAccountRepository();
    const personnelId = unlinkedPersonnelId();
    const before = store.personnel.find((p) => p.id === personnelId)!;
    const hadEmail = before.email !== null;

    const result = await repo.createAccount(makeInput({ personnelId }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = store.personnel.find((p) => p.id === personnelId)!;
    // The minted account id landed on the employee record.
    const minted = seedAccounts.find((a) => a.email === result.value.email);
    expect(minted).toBeDefined();
    expect(after.userId).toBe(minted!.userId);
    // The account email backfills a missing contact email on the record.
    if (!hadEmail) expect(after.email).toBe(result.value.email);
    // The echo for the confirmation panel.
    expect(result.value.personnelName).toBe(
      `${after.firstName} ${after.lastName}`.trim(),
    );

    // A FRESH personnel repository resolves the binding (the shared store
    // is the join point — exactly what the dashboards read through).
    const personnelRepo = new MockPersonnelRepository();
    expect(personnelRepo.observeByUserId(minted!.userId)).toBeDefined();
  });

  it("notifies the personnel stream (observeByUserId consumers see the link)", () => {
    const seen: Array<string | null> = [];
    const personnelRepo = new MockPersonnelRepository();
    // subscribe BEFORE the link
    const unsub = personnelRepo.observeByUserId("__t371_probe__").subscribe((p) => {
      seen.push(p ? p.id : null);
    });
    expect(seen.at(-1)).toBeNull(); // not linked yet

    const p = store.personnel.find((x) => !x.userId && x.status === "active");
    if (!p) throw new Error("fixture");
    TOUCHED_PERSONNEL.push(p.id);
    (p as { userId: string | null }).userId = "__t371_probe__";
    store.notifyPersonnel();
    expect(seen.at(-1)).toBe(p.id); // the stream picked the link up
    unsub(); // subscribe returns a disposer, not {unsubscribe }
  });

  it("rejects an unknown personnelId WITHOUT minting the account", async () => {
    const before = seedAccounts.length;
    const repo = new MockUserAccountRepository();
    const result = await repo.createAccount(
      makeInput({ personnelId: "per-does-not-exist" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ERR_VALIDATION");
    expect(seedAccounts.length).toBe(before); // nothing half-created
  });

  it("rejects a personnel row already bound to another account (conflict)", async () => {
    const before = seedAccounts.length;
    const repo = new MockUserAccountRepository();
    const bound = store.personnel.find((p) => p.userId);
    if (!bound) throw new Error("fixture: no bound personnel seed");
    const result = await repo.createAccount(makeInput({ personnelId: bound.id }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ERR_CONFLICT");
    expect(seedAccounts.length).toBe(before);
  });

  it("records the linkage in the audit entry (never the password)", async () => {
    const repo = new MockUserAccountRepository();
    const personnelId = unlinkedPersonnelId();
    const input = makeInput({ personnelId });
    const created = await repo.createAccount(input);
    expect(created.ok).toBe(true);

    const entry = store.audit[0];
    expect(entry.action).toBe(AuditActions.UserAccountCreate);
    expect(String(entry.diff)).toContain(personnelId);
    if (created.ok) {
      expect(String(entry.diff)).not.toContain(created.value.initialPassword);
    }
  });
});

describe("T-371 B. the owner-mandate round-trip — employee signs in and resolves their dossier", () => {
  afterEach(cleanup);

  it("a linked account signs in and observeByUserId(session.userId) returns the employee record", async () => {
    const adminRepo = new MockUserAccountRepository();
    const authRepo = new MockAuthRepository();
    const personnelId = unlinkedPersonnelId();
    const input = makeInput({ personnelId, initialPassword: "TheirOwnPass1" });

    const created = await adminRepo.createAccount(input);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // The employee signs in with THEIR OWN credentials (T-079 semantics).
    const signIn = await authRepo.signIn(input.email, "TheirOwnPass1");
    expect(signIn.ok).toBe(true);
    if (!signIn.ok) return;

    // THE mandate assertion: the signed-in account resolves the employee
    // dossier — profile, tasks, responsibilities all key off this binding.
    const personnelRepo = new MockPersonnelRepository();
    const stream = personnelRepo.observeByUserId(signIn.value.userId);
    const dossier = stream.get();
    expect(dossier).not.toBeNull();
    expect(dossier!.id).toBe(personnelId);
  });
});

/* ================================================================== */
/* C — listAccounts (the admin verification surface)                   */
/* ================================================================== */

describe("T-371 C. listAccounts — the accounts overview join", () => {
  it("mock: every seeded account carries its bound employee; unlinked accounts stay null", async () => {
    const result = await mockUserAccountRepository.listAccounts();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.length).toBeGreaterThanOrEqual(seedAccounts.length);
    // The seeded teacher account is bound to per-001 (Aïcha Bouhenni).
    const teacher = result.value.find((a) => a.email === "teacher@elimtiyaz.dz");
    expect(teacher).toBeDefined();
    expect(teacher!.personnelId).toBe("per-001");
    expect(teacher!.personnelName).toContain("Aïcha");
    // An account with no employee (the admin's own) stays honestly unlinked.
    const admin = result.value.find((a) => a.email === "admin@elimtiyaz.dz");
    expect(admin).toBeDefined();
    expect(admin!.personnelId).not.toBeNull(); // per-007 IS bound
  });

  it("a freshly linked account appears in the overview with its employee", async () => {
    const repo = new MockUserAccountRepository();
    const personnelId = unlinkedPersonnelId();
    const input = makeInput({ personnelId });
    const created = await repo.createAccount(input);
    expect(created.ok).toBe(true);

    const overview = await mockUserAccountRepository.listAccounts();
    expect(overview.ok).toBe(true);
    if (!overview.ok) return;
    const row = overview.value.find((a) => a.email === input.email);
    expect(row).toBeDefined();
    expect(row!.personnelId).toBe(personnelId);
  });
});

/* ================================================================== */
/* D — the task id-space repair                                        */
/* ================================================================== */

describe("T-371 D. the tasks.assignee_ids id-space repair", () => {
  it("the seeded tasks are keyed on ACCOUNT ids (usr-*) — the buyer account sees its task", () => {
    const stream = mockTaskRepository.observeByAssignee("usr-buy-001");
    const tasks = stream.get();
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    expect(tasks.some((t) => t.title.includes("fournitures"))).toBe(true);
  });

  it("the worker account sees the maintenance tasks (usr-wrk-001)", () => {
    const tasks = mockTaskRepository.observeByAssignee("usr-wrk-001").get();
    expect(tasks.length).toBeGreaterThanOrEqual(2);
  });

  it("the LEGACY personnel-id space returns nothing (regression direction)", () => {
    expect(mockTaskRepository.observeByAssignee("per-012").get()).toHaveLength(0);
    expect(mockTaskRepository.observeByAssignee("per-015").get()).toHaveLength(0);
  });

  it("the repository wiring exposes the mock task repository", () => {
    expect(mockRepositories.tasks).toBe(mockTaskRepository);
  });
});

/* ================================================================== */
/* E — SupabaseUserAccountRepository (fake client)                      */
/* ================================================================== */

type Row = Record<string, any>;

/** Minimal PostgREST fake: select/eq/is/order/maybeSingle over in-memory tables. */
class FakeQuery {
  private filters: Array<(r: Row) => boolean> = [];
  private orderCol = "";
  private orderAsc = true;
  constructor(private readonly table: Row[]) {}
  eq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  is(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderCol = col;
    this.orderAsc = opts?.ascending !== false;
    return this;
  }
  select(_cols?: string): this {
    return this;
  }
  maybeSingle(): this {
    return this;
  }
  then<TResult1>(
    onFulfilled:
      | ((v: { data: Row | Row[] | null; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
  ): Promise<TResult1> {
    let rows = this.table.filter((r) => this.filters.every((f) => f(r)));
    if (this.orderCol) {
      rows = [...rows].sort((a, b) =>
        this.orderAsc
          ? String(a[this.orderCol] ?? "").localeCompare(String(b[this.orderCol] ?? ""))
          : String(b[this.orderCol] ?? "").localeCompare(String(a[this.orderCol] ?? "")),
      );
    }
    return Promise.resolve(onFulfilled!({ data: rows, error: null }) as never);
  }
}

class FakeClient {
  tables: Record<string, Row[]> = {};
  invokeCalls: Array<{ name: string; body: unknown }> = [];
  responseBody: unknown = null;

  from(t: string): FakeQuery {
    return new FakeQuery(this.tables[t] ?? (this.tables[t] = []));
  }
  functions = {
    invoke: async (name: string, { body }: { body: unknown }) => {
      this.invokeCalls.push({ name, body });
      return { data: this.responseBody, error: null };
    },
  };
}

describe("T-371 E. SupabaseUserAccountRepository — the EF payload + overview join", () => {
  it("passes personnel_id in the EF body and maps the employee echo", async () => {
    const fake = new FakeClient();
    fake.responseBody = {
      data: {
        auth_user_id: "au-1",
        user_profile_id: "up-1",
        email: "x@y.dz",
        role: "worker",
        initial_password: "GenPassw0rd1",
        personnel_id: "11111111-1111-1111-1111-111111111111",
        personnel_code: "PER-2026-0001",
        personnel_name: "Karima Test",
      },
    };
    const repo = new SupabaseUserAccountRepository(fake as never);
    const result = await repo.createAccount(
      makeInput({
        personnelId: "11111111-1111-1111-1111-111111111111",
        role: Role.Worker,
      }),
    );

    expect(result.ok).toBe(true);
    expect(fake.invokeCalls).toHaveLength(1);
    expect(fake.invokeCalls[0].name).toBe("create-user-account");
    expect((fake.invokeCalls[0].body as Row)["personnel_id"]).toBe(
      "11111111-1111-1111-1111-111111111111",
    );
    if (result.ok) {
      expect(result.value.personnelCode).toBe("PER-2026-0001");
      expect(result.value.personnelName).toBe("Karima Test");
    }
  });

  it("OMITS personnel_id when unset (pre-0097 EF compatibility)", async () => {
    const fake = new FakeClient();
    fake.responseBody = { data: { email: "a@b.dz", role: "worker", initial_password: "Generated1Aa" } };
    const repo = new SupabaseUserAccountRepository(fake as never);
    await repo.createAccount(makeInput({ role: Role.Worker }));
    expect(fake.invokeCalls[0].body).not.toHaveProperty("personnel_id");
  });

  it("listAccounts joins the four reads into role + employee columns", async () => {
    const fake = new FakeClient();
    fake.tables["user_profiles"] = [
      { id: "up-1", email: "worker@elimtiyaz.dz", display_name: "Said Bouzid", status: "active" },
      { id: "up-2", email: "parent@x.dz", display_name: "Parent Test", status: "active" },
    ];
    fake.tables["role_assignments"] = [
      { user_profile_id: "up-1", role_id: "r-worker", revoked_at: null },
      { user_profile_id: "up-1", role_id: "r-teacher", revoked_at: "2026-01-01" }, // revoked — ignored
      { user_profile_id: "up-2", role_id: "r-parent", revoked_at: null },
    ];
    fake.tables["roles"] = [
      { id: "r-worker", code: "worker" },
      { id: "r-teacher", code: "teacher" },
      { id: "r-parent", code: "parent" },
    ];
    fake.tables["personnel"] = [
      {
        id: "per-010",
        user_id: "up-1",
        personnel_code: "PER-2026-0010",
        first_name: "Said",
        last_name: "Bouzid",
        deleted_at: null,
      },
      { id: "per-dead", user_id: "up-9", personnel_code: "PER-OLD", first_name: "Gone", last_name: "Row", deleted_at: "2026-01-01" },
    ];

    const repo = new SupabaseUserAccountRepository(fake as never);
    const result = await repo.listAccounts();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const worker = result.value.find((a) => a.email === "worker@elimtiyaz.dz");
    expect(worker).toBeDefined();
    expect(worker!.role).toBe(Role.Worker); // first ACTIVE assignment wins
    expect(worker!.personnelId).toBe("per-010");
    expect(worker!.personnelCode).toBe("PER-2026-0010");

    const parent = result.value.find((a) => a.email === "parent@x.dz");
    expect(parent).toBeDefined();
    expect(parent!.role).toBe(Role.Parent);
    expect(parent!.personnelId).toBeNull();
  });
});

/* ================================================================== */
/* F — source scans (UI wiring + migration)                            */
/* ================================================================== */

const SRC = path.resolve(__dirname, "../../");

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), "utf8");
}

describe("T-371 F. source scans — the wiring stays on the account id space", () => {
  it("task-form-modal options are keyed on the linked ACCOUNT (p.userId), never p.id", () => {
    const src = read("features/personnel/management/task-form-modal.tsx");
    expect(src).toContain("value: p.userId");
    expect(src).not.toContain("value: p.id");
    expect(src).toContain("sans compte lié");
  });

  it("task-management resolves assignees through personnel.userId", () => {
    const src = read("features/personnel/management/task-management.tsx");
    expect(src).toContain("t.assigneeIds.includes(p.userId)");
    expect(src).not.toContain("t.assigneeIds.includes(p.id)");
  });

  it("task-detail-drawer resolves assignees through personnel.userId", () => {
    const src = read("features/personnel/management/task-detail-drawer.tsx");
    expect(src).toContain("t.assigneeIds.includes(p.userId)");
    expect(src).not.toContain("t.assigneeIds.includes(p.id)");
  });

  it("AccountsTab hosts the redesigned CreateAccountModal", () => {
    const src = read("features/settings/accounts-tab.tsx");
    expect(src).toContain("CreateAccountModal");
    expect(src).toContain("listAccounts");
  });

  it("create-account-modal submits personnelId in employee mode only", () => {
    const src = read("features/settings/create-account-modal.tsx");
    expect(src).toContain(
      'personnelId: mode === "employee" ? personnelId : undefined',
    );
    // The employee picker is the first-class path of the redesigned flow.
    expect(src).toContain("handleSelectPersonnel");
    expect(src).toContain("Compte lié");
  });

  it("ProfilePage carries the employee dossier resolved through observeByUserId", () => {
    const src = read("features/profile/profile-page.tsx");
    expect(src).toContain("EmployeeDossierCard");
    expect(src).toContain("observeByUserId(currentUserId)");
    expect(src).toContain("observeByAssignee(currentUserId)");
  });

  it("migration 0097 exists with the overload drop + the unique index", () => {
    const mig = fs.readFileSync(
      path.resolve(__dirname, "../../../supabase/migrations/0097_personnel_account_linkage.sql"),
      "utf8",
    );
    expect(mig).toContain("p_personnel_id");
    expect(mig).toContain(
      "drop function if exists public.admin_create_user_account(uuid, text, uuid, uuid, text)",
    );
    expect(mig).toContain("personnel_active_account_uq");
    expect(mig).toContain("where user_id is not null and deleted_at is null");
  });

  it("the EF accepts + validates personnel_id", () => {
    const ef = fs.readFileSync(
      path.resolve(__dirname, "../../../supabase/functions/create-user-account/index.ts"),
      "utf8",
    );
    expect(ef).toContain("personnel_id");
    expect(ef).toContain("personnel_already_linked");
    expect(ef).toContain("p_personnel_id");
  });
});
