/**
 * t-588-rbac-matrix-editor.test.tsx — T-588 / BUG-017: the RBAC matrix
 * editor now persists through the canonical RbacRepository seam.
 *
 * What this suite pins:
 *
 *   A. The editor LOADS the effective matrix from the repository (not the
 *      fictional DEFAULT baseline) — a server-granted permission the
 *      desktop defaults deny shows up CHECKED.
 *   B. Save goes through repos.rbac.saveMatrix (the tenant_role_overrides
 *      path — the localStorage placebo is gone) AND writes the audit entry.
 *   C. Reset goes through repos.rbac.resetMatrix AND writes its own audit
 *      entry (a reset is a mutation — rule §7.6).
 *   D. Non-SuperAdmin stays read-only.
 *   E. The legacy server codes surface as ONE honest French note (the
 *      clutter mandate: no raw code walls in the clerk-facing view).
 *
 * Run:
 *   npx vitest run src/tests/features/settings/t-588-rbac-matrix-editor.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import React from "react";
import "../../../i18n/i18n";
import { RbacMatrixEditor } from "../../../features/settings/rbac-matrix-editor";
import { Role, ROLE_LABELS_FR } from "../../../core/rbac/roles";
import { Permission, PERMISSION_LABELS_FR } from "../../../core/rbac/permissions";
import { DEFAULT_ROLE_PERMISSIONS } from "../../../core/rbac/permissions";
import { RBAC_OVERRIDES_STORAGE_KEY } from "../../../domain/model/rbac";

const toasts = {
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showWarning: vi.fn(),
  showInfo: vi.fn(),
};
let mockSession: Record<string, unknown> | null = null;
let refreshPermissions: ReturnType<typeof vi.fn>;

/** The recorded repository calls (the seams this suite exists to pin). */
const rbacCalls = {
  loadEffectiveMatrix: vi.fn(),
  saveMatrix: vi.fn(),
  resetMatrix: vi.fn(),
};
const auditCalls = { log: vi.fn() };

vi.mock("../../../app/providers/repository-provider", () => ({
  useRepositories: () => ({
    rbac: rbacCalls,
    audit: auditCalls,
  }),
}));
vi.mock("../../../app/providers/toast-provider", () => ({
  useToast: () => toasts,
}));
vi.mock("../../../app/providers/auth-provider", () => ({
  useAuth: () => ({ session: mockSession, refreshPermissions }),
}));

/** The toggle button at (permission row × role column) — the cells are
 * icon-only buttons, so they are addressed by table geometry: the row
 * carrying the permission label, then the Nth button cell (the staff
 * role column order matches STAFF_ROLES). */
function cellButton(permissionLabel: string, roleIndex: number): HTMLElement {
  const row = screen.getByText(permissionLabel).closest("tr")!;
  const cells = within(row).getAllByRole("button");
  return cells[roleIndex];
}

const ROLE_INDEX: Partial<Record<Role, number>> = {
  [Role.SuperAdmin]: 0,
  [Role.FinancialOfficer]: 1,
  [Role.Teacher]: 2,
  [Role.SupportStaff]: 3,
  [Role.Manager]: 4,
  [Role.Buyer]: 5,
  [Role.Driver]: 6,
  [Role.WarehouseWorker]: 7,
  [Role.Worker]: 8,
};

function adminSession() {
  return {
    userId: "usr-adm-001",
    displayName: "Brahim Souilah",
    role: Role.SuperAdmin,
    tenantId: "t1",
    permissions: { has: () => true },
  };
}

/** The effective snapshot the fake repository serves. */
function snapshot(overrides?: Partial<Parameters<typeof rbacCalls.loadEffectiveMatrix>[0]> extends never ? never : {
  teacherGranted?: Permission[];
  hasOverrides?: boolean;
  unmapped?: string[];
}) {
  const matrix = {} as Record<Role, Permission[]>;
  for (const role of Object.values(Role) as Role[]) {
    matrix[role] = Array.from(DEFAULT_ROLE_PERMISSIONS[role] ?? new Set());
  }
  // The server grants the teacher something the desktop DEFAULTS deny —
  // the editor must display it CHECKED (the effective matrix, not defaults).
  matrix[Role.Teacher] = [
    ...Array.from(DEFAULT_ROLE_PERMISSIONS[Role.Teacher]),
    Permission.ManagePricing,
  ];
  return {
    matrix,
    unmappedServerCodes: overrides?.unmapped ?? ["view_students", "push_homework"],
    hasOverrides: overrides?.hasOverrides ?? true,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  refreshPermissions = vi.fn().mockResolvedValue(true);
  mockSession = adminSession();
  rbacCalls.loadEffectiveMatrix.mockResolvedValue({ ok: true, value: snapshot() });
  rbacCalls.saveMatrix.mockResolvedValue({ ok: true, value: { saved: 2, removed: 0 } });
  rbacCalls.resetMatrix.mockResolvedValue({ ok: true, value: { removed: 3 } });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("T-588 / BUG-017 — the RBAC matrix editor persistence seam", () => {
  it("A: loads the EFFECTIVE matrix from the repository (a server-only grant displays checked)", async () => {
    render(<RbacMatrixEditor />);
    // the load fired exactly once on mount
    await waitFor(() => expect(rbacCalls.loadEffectiveMatrix).toHaveBeenCalledTimes(1));
    // ManagePricing is NOT in the desktop teacher defaults…
    expect(DEFAULT_ROLE_PERMISSIONS[Role.Teacher].has(Permission.ManagePricing)).toBe(false);
    // …but the effective snapshot grants it → the cell renders granted
    // (the granted button carries the status-success class)
    await waitFor(() => {
      const cell = cellButton(PERMISSION_LABELS_FR[Permission.ManagePricing], ROLE_INDEX[Role.Teacher]!);
      expect(cell.className).toContain("status-success");
    });
  });

  it("A2: the legacy server codes surface as ONE honest note — no raw code walls", async () => {
    render(<RbacMatrixEditor />);
    await waitFor(() => expect(rbacCalls.loadEffectiveMatrix).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(
        screen.getByText(/2 permission\(s\) serveur supplémentaire\(s\)/),
      ).toBeTruthy();
    });
    // the raw codes are NOT dumped into the view
    expect(screen.queryByText(/view_students/)).toBeNull();
    expect(screen.queryByText(/push_homework/)).toBeNull();
  });

  it("B: save rides repos.rbac.saveMatrix + the audit entry (never localStorage)", async () => {
    render(<RbacMatrixEditor />);
    await waitFor(() => expect(rbacCalls.loadEffectiveMatrix).toHaveBeenCalledTimes(1));

    // toggle ONE cell (grant the Buyer ViewAuditLog) → dirty
    const target = cellButton(PERMISSION_LABELS_FR[Permission.ViewAuditLog], ROLE_INDEX[Role.Buyer]!);
    expect(target.className).not.toContain("status-success");
    fireEvent.click(target);

    await waitFor(() =>
      screen.getByRole("button", { name: /Enregistrer/i }).hasAttribute("disabled") === false,
    );
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/i }));

    await waitFor(() => expect(rbacCalls.saveMatrix).toHaveBeenCalledTimes(1));
    // the payload covers every staff role
    const payload = rbacCalls.saveMatrix.mock.calls[0][0] as Record<string, string[]>;
    expect(Object.keys(payload).sort()).toEqual(
      Array.from(
        new Set(["super_admin", "financial_officer", "teacher", "support_staff", "manager", "buyer", "driver", "warehouse_worker", "worker"]),
      ).sort(),
    );
    // the audit entry was written through the canonical repository
    await waitFor(() =>
      expect(auditCalls.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: "rbac.matrix_update" }),
      ),
    );
    // the placebo path is DEAD: the editor never writes localStorage itself
    expect(localStorage.getItem(RBAC_OVERRIDES_STORAGE_KEY)).toBeNull();
  });

  it("B2: a save failure surfaces the honest error and does NOT audit", async () => {
    rbacCalls.saveMatrix.mockResolvedValueOnce({
      ok: false,
      error: { message: "boom", userMessage: "Connexion perdue" },
    });
    render(<RbacMatrixEditor />);
    await waitFor(() => expect(rbacCalls.loadEffectiveMatrix).toHaveBeenCalledTimes(1));
    const target = cellButton(PERMISSION_LABELS_FR[Permission.ViewAuditLog], ROLE_INDEX[Role.Buyer]!);
    fireEvent.click(target);
    fireEvent.click(await screen.findByRole("button", { name: /Enregistrer/i }));

    await waitFor(() => expect(toasts.showError).toHaveBeenCalled());
    expect(auditCalls.log).not.toHaveBeenCalled();
  });

  it("C: reset rides repos.rbac.resetMatrix + its own audit entry", async () => {
    render(<RbacMatrixEditor />);
    await waitFor(() => expect(rbacCalls.loadEffectiveMatrix).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /Réinitialiser/i }));

    await waitFor(() => expect(rbacCalls.resetMatrix).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(auditCalls.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: "rbac.matrix_reset" }),
      ),
    );
    expect(toasts.showInfo).toHaveBeenCalled();
  });

  it("D: a non-SuperAdmin is read-only (no save/reset, toggles disabled)", async () => {
    mockSession = {
      userId: "usr-t-001",
      displayName: "Teacher",
      role: Role.Teacher,
      tenantId: "t1",
      permissions: { has: () => false },
    };
    render(<RbacMatrixEditor />);
    await waitFor(() => expect(rbacCalls.loadEffectiveMatrix).toHaveBeenCalledTimes(1));
    expect(screen.getAllByText(/Lecture seule/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole("button", { name: /Enregistrer/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Réinitialiser/i })).toBeNull();
    const cells = screen.getAllByRole("button").filter((b) => b.tagName === "BUTTON");
    for (const c of cells) expect(c.hasAttribute("disabled")).toBe(true);
  });
});
