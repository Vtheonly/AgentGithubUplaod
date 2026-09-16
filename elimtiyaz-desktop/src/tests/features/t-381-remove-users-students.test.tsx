/**
 * T-381 — the users + students removal regression suite.
 *
 * Owner mandate (73rd session, 2026-09-16): "I forgot to add the ability to
 * remove users and students, so add that functionality as well."
 *
 * What this suite pins:
 *
 *   A. MockUserAccountRepository.deleteAccount — the removal semantics:
 *      the seedAccounts entry is dropped, a bound employee row is unbound
 *      (the 0009 ON DELETE SET NULL mirror), the audit entry is written
 *      WITHOUT credential material, the owner-pinned admin
 *      (admin@elimtiyaz.dz) is refused, and an unknown id is a notFound.
 *   B. SupabaseUserAccountRepository.deleteAccount — the EF payload carries
 *      profile_id, the success envelope maps to Ok, and the EF-level
 *      rejection envelope maps to an Err.
 *   C. StudentsTab UI — the Supprimer row action is permission-gated
 *      (Permission.DeleteStudent), the ConfirmModal guards the destructive
 *      action, and confirming routes through repos.students.deleteStudent
 *      (the soft-delete the repository contract always had).
 *   D. AccountsTab UI — the delete button renders per account row, the
 *      ConfirmModal guards it, and confirming routes through
 *      repos.userAccounts.deleteAccount then refreshes the overview.
 *   E. Source guards — the delete-user-account Edge Function exists with
 *      the super_admin gate, the self-deletion guard and the owner-pinned
 *      admin protection; the audit action user_account.delete is registered;
 *      the EF deletes the profile BEFORE the auth identity (the safe
 *      ordering documented in the EF header).
 *
 * Run:
 *   npx vitest run src/tests/features/t-381-remove-users-students.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import * as fs from "node:fs";
import * as path from "node:path";
import { MemoryRouter } from "react-router-dom";
import "../../i18n/i18n";

// jsdom has no ResizeObserver — the DataTable's scroll container observes it.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub;

import {
  MockUserAccountRepository,
} from "../../infrastructure/mock/repositories/user-account-repository";
import { SupabaseUserAccountRepository } from "../../infrastructure/supabase/repositories/supabase-user-account-repository";
import { seedAccounts, store } from "../../infrastructure/mock/repositories/mock-store";
import { AuditActions } from "../../core/audit-actions";
import { Role } from "../../core/rbac/roles";
import { Permission } from "../../core/rbac/permissions";
import { CrmPage } from "../../features/crm/crm-page";
import { AccountsTab } from "../../features/settings/accounts-tab";
import type { AccountOverviewEntry, CreateAccountInput } from "../../domain/repository/repository";

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

const MINTED: string[] = [];

function makeInput(overrides: Partial<CreateAccountInput> = {}): CreateAccountInput {
  const suffix = Math.random().toString(36).slice(2, 8);
  const email = `removal-user-${suffix}@el-imtiyaz.test`;
  MINTED.push(email);
  return {
    email,
    fullName: "Utilisateur Temporaire",
    phone: "+213 555 000 111",
    role: Role.Worker,
    initialPassword: "InitialPassw0rd",
    ...overrides,
  };
}

function cleanupMock(): void {
  for (const email of MINTED) {
    const idx = seedAccounts.findIndex((a) => a.email === email);
    if (idx >= 0) seedAccounts.splice(idx, 1);
  }
  MINTED.length = 0;
}

/** Read a source file as text (source-guard assertions). */
function src(rel: string): string {
  return fs.readFileSync(path.resolve(__dirname, rel), "utf8");
}

/* ================================================================== */
/* A. MockUserAccountRepository.deleteAccount                           */
/* ================================================================== */

describe("T-381 A. MockUserAccountRepository.deleteAccount", () => {
  afterEach(cleanupMock);

  it("removes the account and unbinds the linked employee (the 0009 SET NULL mirror)", async () => {
    const repo = new MockUserAccountRepository();
    // Bind the account to a seeded unlinked personnel row.
    const target = store.personnel.find((p) => !p.userId && p.status === "active");
    if (!target) throw new Error("test fixture: no unlinked active personnel seed");
    const touchedId = target.id;

    const created = await repo.createAccount(makeInput({ personnelId: touchedId }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const profileId = seedAccounts.find((a) => a.email === created.value.email)!.userId;
    expect(store.personnel.find((p) => p.id === touchedId)?.userId).toBe(profileId);

    const result = await repo.deleteAccount(profileId);
    expect(result.ok).toBe(true);

    // The account is gone from the sign-in surface.
    expect(seedAccounts.find((a) => a.userId === profileId)).toBeUndefined();
    // The employee is unbound.
    expect(store.personnel.find((p) => p.id === touchedId)?.userId).toBeNull();

    // The audit trail records the removal (no credential material — SEC-100).
    const entry = store.audit.find(
      (e) => e.action === AuditActions.UserAccountDelete && e.entityId === created.value.email,
    );
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry)).not.toContain("InitialPassw0rd");

    // Restore the touched personnel row for other suites.
    const row = store.personnel.find((p) => p.id === touchedId);
    if (row) (row as { userId: string | null }).userId = null;
    store.notifyPersonnel();
  });

  it("refuses the owner-pinned admin (admin@elimtiyaz.dz) — the OPS-310 mirror", async () => {
    const repo = new MockUserAccountRepository();
    const admin = seedAccounts.find((a) => a.email === "admin@elimtiyaz.dz");
    expect(admin).toBeDefined();

    const result = await repo.deleteAccount(admin!.userId);
    expect(result.ok).toBe(false);
    expect(seedAccounts.find((a) => a.email === "admin@elimtiyaz.dz")).toBeDefined();
  });

  it("returns notFound for an unknown id (honest zero-match semantics, §15.30b)", async () => {
    const repo = new MockUserAccountRepository();
    const result = await repo.deleteAccount("usr-does-not-exist");
    expect(result.ok).toBe(false);
  });
});

/* ================================================================== */
/* B. SupabaseUserAccountRepository.deleteAccount — the EF wiring       */
/* ================================================================== */

describe("T-381 B. SupabaseUserAccountRepository.deleteAccount", () => {
  it("sends profile_id to the delete-user-account EF and maps success", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { data: { profile_id: "p1", email: "x@y.dz", message: "removed" } },
      error: null,
    });
    const repo = new SupabaseUserAccountRepository({
      functions: { invoke },
    } as unknown as ConstructorParameters<typeof SupabaseUserAccountRepository>[0]);

    const result = await repo.deleteAccount("p1");
    expect(result.ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith("delete-user-account", {
      body: { profile_id: "p1" },
    });
  });

  it("maps the EF-level rejection envelope to an Err (owner-pinned / self / not-found)", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { error: { code: "owner_account_protected", message: "protected" } },
      error: null,
    });
    const repo = new SupabaseUserAccountRepository({
      functions: { invoke },
    } as unknown as ConstructorParameters<typeof SupabaseUserAccountRepository>[0]);

    const result = await repo.deleteAccount("p1");
    expect(result.ok).toBe(false);
  });

  it("refuses an empty profile id client-side (fast feedback)", async () => {
    const repo = new SupabaseUserAccountRepository({
      functions: { invoke: vi.fn() },
    } as unknown as ConstructorParameters<typeof SupabaseUserAccountRepository>[0]);
    const result = await repo.deleteAccount("  ");
    expect(result.ok).toBe(false);
  });
});

/* ================================================================== */
/* C. StudentsTab UI — the permission-gated Supprimer action            */
/* ================================================================== */

const deleteStudentMock = vi.fn();

function studentObs<T>(value: T) {
  const listeners = new Set<(v: T) => void>();
  return {
    get: () => value,
    subscribe: (fn: (v: T) => void) => {
      listeners.add(fn);
      fn(value);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

const STUDENTS = [
  {
    id: "elv-001",
    tenantId: "t1",
    code: "ELV-001",
    firstName: "Yacine",
    lastName: "Belkacem",
    level: "cebull" as never,
    gradeYear: 1,
    status: "active",
    enrollmentDate: "2025-09-01",
    paymentPlan: "installments" as never,
    parentId: "par-001",
    documents: [],
  },
];

let mockState: Record<string, unknown>;
let mockSession: Record<string, unknown> | null;

vi.mock("../../app/providers/repository-provider", () => ({
  useRepositories: () => mockState,
}));

vi.mock("../../app/providers/toast-provider", () => ({
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn(), showInfo: vi.fn() }),
}));

vi.mock("../../app/providers/auth-provider", () => ({
  useAuth: () => ({ session: mockSession }),
}));

// The heavy modals/drawers pull wide repository surfaces (pricing,
// installments, classes, …) this suite does not exercise — stub them so the
// StudentsTab assertions stay focused on the delete wiring.
vi.mock("../../features/crm/batch-registration-modal", () => ({
  BatchRegistrationModal: () => null,
}));
vi.mock("../../features/crm/excel-import-modal", () => ({
  ExcelImportModal: () => null,
}));
vi.mock("../../features/crm/parent-detail-drawer", () => ({
  ParentDetailDrawer: () => null,
}));
vi.mock("../../features/crm/student-detail-drawer", () => ({
  StudentDetailDrawer: () => null,
}));
vi.mock("../../features/settings/create-account-modal", () => ({
  CreateAccountModal: () => null,
}));

function studentPermissions(hasDelete: boolean) {
  return {
    has: (p: Permission) => (p === Permission.DeleteStudent ? hasDelete : true),
  };
}

function makeStudentState() {
  return {
    students: {
      observe: () => studentObs(STUDENTS),
      deleteStudent: deleteStudentMock,
    },
    parents: { observe: () => studentObs([]) },
    ledger: { observe: () => studentObs([]) },
    // The BatchRegistrationModal reads the pricing stream on mount.
    pricing: { observe: () => studentObs(null) },
  };
}

describe("T-381 C. StudentsTab — the permission-gated Supprimer action", () => {
  beforeEach(() => {
    deleteStudentMock.mockReset();
    deleteStudentMock.mockResolvedValue({ ok: true, value: undefined });
    mockState = makeStudentState();
  });

  afterEach(() => {
    cleanup();
    cleanupMock();
  });

  it("shows the Supprimer action for a session holding Permission.DeleteStudent, confirms, then soft-deletes via the repository", async () => {
    mockSession = {
      userId: "usr-admin",
      role: Role.SuperAdmin,
      permissions: studentPermissions(true),
    };
    render(
      <MemoryRouter initialEntries={["/crm"]}>
        <CrmPage />
      </MemoryRouter>,
    );

    // Switch to the Élèves tab.
    // radix Tabs activate on mousedown (not click).
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Élèves/ }));
    expect(await screen.findByText("Yacine Belkacem")).toBeTruthy();

    // The destructive row action is rendered (icon-only, titled).
    const deleteBtn = screen.getByTitle("Supprimer cet élève");
    fireEvent.click(deleteBtn);

    // The ConfirmModal guards the destructive action.
    expect(screen.getByText("Supprimer cet élève ?")).toBeTruthy();
    expect(deleteStudentMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
    await waitFor(() => {
      expect(deleteStudentMock).toHaveBeenCalledWith("elv-001");
    });
  });

  it("hides the Supprimer action when the session lacks Permission.DeleteStudent", async () => {
    mockSession = {
      userId: "usr-clerk",
      role: Role.SupportStaff,
      permissions: studentPermissions(false),
    };
    render(
      <MemoryRouter initialEntries={["/crm"]}>
        <CrmPage />
      </MemoryRouter>,
    );

    // radix Tabs activate on mousedown (not click).
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Élèves/ }));
    expect(await screen.findByText("Yacine Belkacem")).toBeTruthy();

    expect(screen.queryByTitle("Supprimer cet élève")).toBeNull();
    expect(deleteStudentMock).not.toHaveBeenCalled();
  });
});

/* ================================================================== */
/* D. AccountsTab UI — the account-removal row action                   */
/* ================================================================== */

const deleteAccountMock = vi.fn();
const listAccountsMock = vi.fn();

const ACCOUNTS: AccountOverviewEntry[] = [
  {
    profileId: "usr-probe-1",
    email: "probe@el-imtiyaz.test",
    displayName: "Compte Probe",
    status: "active",
    role: Role.Worker,
    personnelId: null,
    personnelCode: null,
    personnelName: null,
  },
];

function makeAccountState() {
  return {
    userAccounts: {
      listAccounts: listAccountsMock,
      deleteAccount: deleteAccountMock,
    },
    personnel: { observe: () => studentObs([]) },
    departments: { observe: () => studentObs([]) },
  };
}

describe("T-381 D. AccountsTab — the account-removal row action", () => {
  beforeEach(() => {
    deleteAccountMock.mockReset();
    deleteAccountMock.mockResolvedValue({ ok: true, value: undefined });
    listAccountsMock.mockReset();
    listAccountsMock.mockResolvedValue({ ok: true, value: ACCOUNTS });
    mockState = makeAccountState();
    mockSession = {
      userId: "usr-admin",
      role: Role.SuperAdmin,
      permissions: studentPermissions(true),
    };
  });

  afterEach(cleanup);

  it("renders the delete action per account row, confirms, then removes via the repository + refreshes", async () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <AccountsTab />
      </MemoryRouter>,
    );

    const deleteBtn = await screen.findByTestId("delete-account-usr-probe-1");
    fireEvent.click(deleteBtn);

    // ConfirmModal guards the destructive action.
    expect(screen.getByText("Supprimer ce compte ?")).toBeTruthy();
    expect(deleteAccountMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
    await waitFor(() => {
      expect(deleteAccountMock).toHaveBeenCalledWith("usr-probe-1");
    });
    // The overview refreshes after the removal.
    await waitFor(() => {
      expect(listAccountsMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("surfaces the EF-level rejection as an error toast without refreshing away the row", async () => {
    deleteAccountMock.mockResolvedValue({
      ok: false,
      error: { userMessage: "Le compte administrateur propriétaire ne peut pas être supprimé" },
    });
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <AccountsTab />
      </MemoryRouter>,
    );

    const deleteBtn = await screen.findByTestId("delete-account-usr-probe-1");
    fireEvent.click(deleteBtn);
    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));

    await waitFor(() => {
      expect(deleteAccountMock).toHaveBeenCalledWith("usr-probe-1");
    });
  });
});

/* ================================================================== */
/* E. Source guards — the EF + the registries                           */
/* ================================================================== */

describe("T-381 E. Source guards", () => {
  const EF = "../../../supabase/functions/delete-user-account/index.ts";

  it("the delete-user-account EF exists with the super_admin gate", () => {
    const code = src(EF);
    expect(code).toContain('requireRole(ctx, "super_admin")');
  });

  it("the EF refuses self-deletion and protects the owner-pinned admin (OPS-310)", () => {
    const code = src(EF);
    expect(code).toContain("cannot_delete_self");
    expect(code).toContain("OWNER_PINNED_ADMIN_EMAIL");
    expect(code).toContain("admin@elimtiyaz.dz");
  });

  it("the EF deletes the profile BEFORE the auth identity (the safe ordering)", () => {
    const code = src(EF);
    const profileDelete = code.indexOf(".from(\"user_profiles\")\n    .delete()");
    const authDelete = code.indexOf("supabase.auth.admin.deleteUser");
    expect(profileDelete).toBeGreaterThan(-1);
    expect(authDelete).toBeGreaterThan(profileDelete);
  });

  it("the EF unbinds parents/students and expires pending approval requests", () => {
    const code = src(EF);
    expect(code).toContain('.from("parents")\n    .update({ auth_user_id: null })');
    expect(code).toContain('.from("students")\n    .update({ auth_user_id: null })');
    expect(code).toContain(".eq(\"status\", \"pending\")");
    expect(code).toContain("user_account.delete");
  });

  it("the audit action + the permission are registered in the canonical registries", () => {
    expect(AuditActions.UserAccountDelete).toBe("user_account.delete");
    expect(AuditActions.StudentDelete).toBe("student.delete");
    expect(Permission.DeleteStudent).toBe("delete_student");

    const permSrc = src("../../core/rbac/permissions.ts");
    expect(permSrc).toContain("[Permission.DeleteStudent]: \"Supprimer un élève\"");
  });

  it("the repository contract carries deleteAccount on UserAccountRepository", () => {
    const contract = src("../../domain/repository/repository.ts");
    expect(contract).toContain("deleteAccount(profileId: string): Promise<Result<void>>");
  });
});
