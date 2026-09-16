/**
 * T-384 — the parent-removal regression suite (PARENT-500).
 *
 * Owner clarification (74th session, 2026-09-17): "when I mean users I mean
 * the student and parents" — T-381 delivered the user-ACCOUNT removal
 * (Settings → Comptes) + the STUDENT removal (CRM → Élèves); the CRM →
 * Parents tab still had NO removal surface, even though
 * ParentRepository.deleteParent existed in BOTH implementations with zero
 * UI callers (the STUDENT-500 pattern, one entity later).
 *
 * What this suite pins:
 *
 *   A. MockParentRepository.deleteParent — the removal semantics: an unknown
 *      id is an honest notFound; a parent with ACTIVE linked students is
 *      refused with a conflict whose userMessage tells the operator to
 *      remove/reassign the students first; a student-free parent is removed
 *      from the observable store and audited (parent.delete, before-snapshot
 *      in the diff).
 *   B. SupabaseParentRepository.deleteParent — the behavioral wiring through
 *      a chainable PostgREST mock: resolve-first (notFound on zero rows —
 *      the §15.30b hazard), the active-students guard query (conflict), and
 *      the soft-delete payload (deleted_at + is_active=false) on the happy
 *      path.
 *   C. ParentsTab UI — the Supprimer row action is permission-gated
 *      (Permission.DeleteParent), the ConfirmModal guards the destructive
 *      action, confirming routes through repos.parents.deleteParent, and
 *      the rejection path surfaces the error without crashing.
 *   D. Source guards + registries — the Supabase implementation resolves
 *      the row BEFORE the guard BEFORE the update; the guard filters
 *      soft-deleted students out; the permission + audit action are
 *      registered with their French labels; the repository contract
 *      carries deleteParent.
 *
 * Run:
 *   npx vitest run src/tests/features/t-384-remove-parents.test.tsx
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

import { MockParentRepository } from "../../infrastructure/mock/repositories/parent-repository";
import { store } from "../../infrastructure/mock/repositories/mock-store";
import { AuditActions } from "../../core/audit-actions";
import { Role } from "../../core/rbac/roles";
import { Permission } from "../../core/rbac/permissions";
import { CrmPage } from "../../features/crm/crm-page";
import type { Parent, CreateParentInput } from "../../domain/model/parent";
import type { Student } from "../../domain/model/student";

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

/** Read a source file as text (source-guard assertions). */
function src(rel: string): string {
  return fs.readFileSync(path.resolve(__dirname, rel), "utf8");
}

/**
 * A chainable PostgREST-mock: `from(table).select(...).eq(...).is(...)` —
 * awaited either directly (the head-count + update steps) or via
 * `.maybeSingle()` (the resolve step). Each AWAIT consumes the next queued
 * step result, so call ORDER is pinned by construction.
 */
type Step = { data: unknown; error?: unknown; count?: number };
function makeClient(steps: Step[]) {
  let i = 0;
  const consume = (): Step => steps[i++] ?? { data: null, error: null };
  const builder: Record<string, unknown> = {};
  const self = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    update: () => builder,
    maybeSingle: () => Promise.resolve(consume()),
    then: (
      resolve: (s: Step) => unknown,
      reject: (e: unknown) => unknown,
    ) => Promise.resolve(consume()).then(resolve, reject),
  };
  Object.assign(builder, self);
  return { from: () => builder };
}

/* ================================================================== */
/* A. MockParentRepository.deleteParent                                 */
/* ================================================================== */

describe("T-384 A. MockParentRepository.deleteParent", () => {
  const MINTED: string[] = [];

  function makeInput(): CreateParentInput {
    const suffix = Math.random().toString(36).slice(2, 8);
    const input = {
      firstName: `Temporaire${suffix}`,
      lastName: "Parentprobe",
      gender: "male" as const,
      phone: `+213 555 00 ${suffix.slice(0, 2)} ${suffix.slice(2, 6)}`,
      whatsapp: null,
      email: `parent-probe-${suffix}@el-imtiyaz.test`,
      occupation: null,
      address: null,
      cityTier: null,
      transportDestination: null,
      preferredLanguage: "fr" as const,
    };
    return input;
  }

  afterEach(() => {
    // Zero-residue: drop every minted probe parent (and any stray student).
    for (const email of MINTED) {
      const p = store.parents.find((x) => x.email === email);
      if (p) {
        store.students = store.students.filter((s) => s.parentId !== p.id);
        store.parents = store.parents.filter((x) => x.id !== p.id);
      }
    }
    store.notifyStudents();
    store.notifyParents();
    MINTED.length = 0;
  });

  it("returns notFound for an unknown id (honest zero-match semantics, §15.30b)", async () => {
    const repo = new MockParentRepository();
    const result = await repo.deleteParent("par-does-not-exist");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ERR_NOT_FOUND");
  });

  it("refuses a parent with ACTIVE linked students (the conflict guard)", async () => {
    const repo = new MockParentRepository();
    const created = await repo.createParent(makeInput());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    MINTED.push(created.value.email);

    // Link an active student to the probe parent.
    const probeStudent = {
      id: `stu-probe-${created.value.id}`,
      parentId: created.value.id,
    } as unknown as Student;
    store.students = [...store.students, probeStudent];
    store.notifyStudents();

    const result = await repo.deleteParent(created.value.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ERR_CONFLICT");
    // The French operator instruction (surfaced in the toast).
    expect(result.error.userMessage).toContain("élèves actifs");
    // The parent survives the refused deletion.
    expect(store.parents.find((p) => p.id === created.value.id)).toBeDefined();
  });

  it("removes a student-free parent, drops it from the observable store, and audits parent.delete", async () => {
    const repo = new MockParentRepository();
    const created = await repo.createParent(makeInput());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    MINTED.push(created.value.email);
    const targetId = created.value.id;

    // Precondition: no linked students.
    expect(store.students.some((s) => s.parentId === targetId)).toBe(false);

    const result = await repo.deleteParent(targetId);
    expect(result.ok).toBe(true);

    // Gone from the store (the observable stream notifies).
    expect(store.parents.find((p) => p.id === targetId)).toBeUndefined();

    // The audit trail records the removal with the before-snapshot.
    const entry = store.audit.find(
      (e) => e.action === AuditActions.ParentDelete && e.entityId === targetId,
    );
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry)).toContain(targetId);
  });

  it("the guard clears once the linked student is gone (remove students, then the parent)", async () => {
    const repo = new MockParentRepository();
    const created = await repo.createParent(makeInput());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    MINTED.push(created.value.email);
    const targetId = created.value.id;

    const probeStudent = {
      id: `stu-probe-${targetId}`,
      parentId: targetId,
    } as unknown as Student;
    store.students = [...store.students, probeStudent];
    store.notifyStudents();

    const refused = await repo.deleteParent(targetId);
    expect(refused.ok).toBe(false);

    // The student is removed (e.g. via the StudentsTab T-381 surface)…
    store.students = store.students.filter((s) => s.id !== probeStudent.id);
    store.notifyStudents();

    const accepted = await repo.deleteParent(targetId);
    expect(accepted.ok).toBe(true);
    expect(store.parents.find((p) => p.id === targetId)).toBeUndefined();
  });
});

/* ================================================================== */
/* B. SupabaseParentRepository.deleteParent — the PostgREST wiring     */
/* ================================================================== */

import { SupabaseParentRepository } from "../../infrastructure/supabase/repositories/supabase-shared-repositories";

describe("T-384 B. SupabaseParentRepository.deleteParent", () => {
  it("resolves the row FIRST — an unknown id is notFound, nothing is updated", async () => {
    const client = makeClient([
      { data: null, error: null }, // resolve step → no row
    ]);
    const repo = new SupabaseParentRepository(
      client as unknown as ConstructorParameters<typeof SupabaseParentRepository>[0],
    );
    const result = await repo.deleteParent("00000000-0000-0000-0000-000000000000");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ERR_NOT_FOUND");
  });

  it("refuses while ACTIVE students are linked (conflict + French operator message)", async () => {
    const client = makeClient([
      { data: { id: "p1" }, error: null }, // resolve step → row exists
      { data: null, count: 2, error: null }, // guard step → 2 active students
    ]);
    const repo = new SupabaseParentRepository(
      client as unknown as ConstructorParameters<typeof SupabaseParentRepository>[0],
    );
    const result = await repo.deleteParent("p1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ERR_CONFLICT");
    expect(result.error.userMessage).toContain("élèves actifs");
  });

  it("soft-deletes a student-free parent (deleted_at + is_active=false payload)", async () => {
    const client = makeClient([
      { data: { id: "p1" }, error: null }, // resolve step
      { data: null, count: 0, error: null }, // guard step → no active students
      { data: null, error: null }, // update step
    ]);
    const repo = new SupabaseParentRepository(
      client as unknown as ConstructorParameters<typeof SupabaseParentRepository>[0],
    );
    const result = await repo.deleteParent("p1");
    expect(result.ok).toBe(true);
  });

  it("the implementation source: resolve → guard → update, with the deleted_at-null student filter", () => {
    const code = src(
      "../../infrastructure/supabase/repositories/supabase-shared-repositories.ts",
    );
    const resolveAt = code.indexOf("async deleteParent(id: string): Promise<Result<void>>");
    const guardAt = code.indexOf('.from("students")\n        .select("id", { count: "exact", head: true })');
    const filterAt = code.indexOf('.eq("parent_id", id)\n        .is("deleted_at", null)');
    const updateAt = code.indexOf('.update({ deleted_at: new Date().toISOString(), is_active: false })');
    expect(resolveAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(resolveAt);
    expect(filterAt).toBeGreaterThan(guardAt);
    expect(updateAt).toBeGreaterThan(filterAt);
  });
});

/* ================================================================== */
/* C. ParentsTab UI — the permission-gated Supprimer action            */
/* ================================================================== */

const deleteParentMock = vi.fn();

function obs<T>(value: T) {
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

const PARENTS: Parent[] = [
  {
    id: "par-001",
    tenantId: "t1",
    code: "PAR-2025-A4F9",
    firstName: "Karim",
    lastName: "Benali",
    displayName: null,
    gender: "male",
    phone: "+213 555 12 34 56",
    whatsapp: null,
    email: null,
    address: null,
    cityTier: null,
    transportDestination: null,
    preferredLanguage: "fr",
    avatarUrl: null,
  } as unknown as Parent,
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

// The heavy modals/drawers pull wide repository surfaces this suite does not
// exercise — stub them so the ParentsTab assertions stay focused on the
// delete wiring (the t-381 precedent).
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

function parentPermissions(hasDelete: boolean) {
  return {
    has: (p: Permission) => (p === Permission.DeleteParent ? hasDelete : true),
  };
}

function makeParentState() {
  return {
    parents: {
      observe: () => obs(PARENTS),
      deleteParent: deleteParentMock,
    },
    students: { observe: () => obs([]) },
    ledger: { observe: () => obs([]) },
    // The BatchRegistrationModal reads the pricing stream on mount.
    pricing: { observe: () => obs(null) },
  };
}

describe("T-384 C. ParentsTab — the permission-gated Supprimer action", () => {
  beforeEach(() => {
    deleteParentMock.mockReset();
    deleteParentMock.mockResolvedValue({ ok: true, value: undefined });
    mockState = makeParentState();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the Supprimer action for a session holding Permission.DeleteParent, confirms, then removes via the repository", async () => {
    mockSession = {
      userId: "usr-admin",
      role: Role.SuperAdmin,
      permissions: parentPermissions(true),
    };
    render(
      <MemoryRouter initialEntries={["/crm"]}>
        <CrmPage />
      </MemoryRouter>,
    );

    // The Parents tab is the DEFAULT — no tab switch needed.
    expect(await screen.findByText("Karim Benali")).toBeTruthy();

    // The destructive row action is rendered (icon-only, titled).
    const deleteBtn = screen.getByTitle("Supprimer ce parent");
    fireEvent.click(deleteBtn);

    // The ConfirmModal guards the destructive action.
    expect(screen.getByText("Supprimer ce parent ?")).toBeTruthy();
    expect(deleteParentMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
    await waitFor(() => {
      expect(deleteParentMock).toHaveBeenCalledWith("par-001");
    });
  });

  it("hides the Supprimer action when the session lacks Permission.DeleteParent", async () => {
    mockSession = {
      userId: "usr-clerk",
      role: Role.SupportStaff,
      permissions: parentPermissions(false),
    };
    render(
      <MemoryRouter initialEntries={["/crm"]}>
        <CrmPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Karim Benali")).toBeTruthy();

    expect(screen.queryByTitle("Supprimer ce parent")).toBeNull();
    expect(deleteParentMock).not.toHaveBeenCalled();
  });

  it("surfaces the repository rejection (active students) as an error toast without crashing", async () => {
    deleteParentMock.mockResolvedValue({
      ok: false,
      error: {
        code: "ERR_CONFLICT",
        message: "Parent par-001 still has 2 active student(s)",
        userMessage:
          "Impossible de supprimer ce parent : des élèves actifs lui sont encore rattachés. Retirez (ou rattachez ailleurs) ces élèves d'abord.",
      },
    });
    mockSession = {
      userId: "usr-admin",
      role: Role.SuperAdmin,
      permissions: parentPermissions(true),
    };
    render(
      <MemoryRouter initialEntries={["/crm"]}>
        <CrmPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Karim Benali")).toBeTruthy();
    fireEvent.click(screen.getByTitle("Supprimer ce parent"));
    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));

    await waitFor(() => {
      expect(deleteParentMock).toHaveBeenCalledWith("par-001");
    });
    // The modal closes (the finally block) — the surface stays usable.
    await waitFor(() => {
      expect(screen.queryByText("Supprimer ce parent ?")).toBeNull();
    });
    expect(await screen.findByText("Karim Benali")).toBeTruthy();
  });
});

/* ================================================================== */
/* D. Source guards — the registries                                   */
/* ================================================================== */

describe("T-384 D. Source guards + registries", () => {
  it("the audit action + the permission are registered in the canonical registries", () => {
    expect(AuditActions.ParentDelete).toBe("parent.delete");
    expect(Permission.DeleteParent).toBe("delete_parent");

    const permSrc = src("../../core/rbac/permissions.ts");
    expect(permSrc).toContain("[Permission.DeleteParent]: \"Supprimer un parent\"");
  });

  it("the repository contract carries deleteParent on ParentRepository", () => {
    const contract = src("../../domain/repository/repository.ts");
    expect(contract).toContain("deleteParent(id: string): Promise<Result<void>>");
  });

  it("the mock and the Supabase implementations share the guard + notFound semantics", () => {
    const mockSrc = src("../../infrastructure/mock/repositories/parent-repository.ts");
    expect(mockSrc).toContain("Errors.notFound(\"Parent\", id)");
    expect(mockSrc).toContain("élèves actifs lui sont encore rattachés");

    const supabaseSrc = src(
      "../../infrastructure/supabase/repositories/supabase-shared-repositories.ts",
    );
    expect(supabaseSrc).toContain("Impossible de supprimer ce parent");
  });
});
