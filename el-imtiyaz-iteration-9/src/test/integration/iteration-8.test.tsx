/**
 * Iteration 8 — integration smoke tests.
 *
 * Verifies that all the new iteration-8 components compose correctly:
 *   - Workforce repositories are wired into the Repositories DI container
 *   - The role-based dashboard router dispatches to the right dashboard
 *   - The onboarding wizard renders without crashing
 *   - All workforce entities have stable label maps
 *
 * These are NOT deep UI tests (those live in component tests) — they're
 * smoke tests that catch wiring regressions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RepositoryProvider, mockRepositories } from "../../infrastructure/repository-provider";
import { RoleDashboardRouter } from "../../features/personnel/dashboards/role-dashboard-router";
import { OnboardingWizard } from "../../features/personnel/onboarding/onboarding-wizard";
import { Role } from "../../core/rbac/roles";
import { DEFAULT_ROLE_PERMISSIONS } from "../../core/rbac/permissions";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "../../i18n/i18n";
import React from "react";
import type { Session } from "../../core/rbac/session";

// Mock the auth context to inject a fake session per test.
const mockSessions: Record<string, Session | null> = {};
vi.mock("../../state/auth-context", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({
    session: mockSessions.current ?? null,
    isLoading: false,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));

// Mock the toast context to avoid the portal dependency.
vi.mock("../../state/toast-context", () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
    showInfo: vi.fn(),
    showWarning: vi.fn(),
  }),
}));

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <RepositoryProvider repositories={mockRepositories}>
            <MemoryRouter>{children}</MemoryRouter>
          </RepositoryProvider>
        </QueryClientProvider>
      </I18nextProvider>
    );
  };
}

function fakeSession(role: Role): Session {
  return {
    userId: `usr-${role}`,
    tenantId: "tenant-test",
    email: `${role}@test.dz`,
    displayName: `Test ${role}`,
    avatarUrl: null,
    role,
    permissions: DEFAULT_ROLE_PERMISSIONS[role] ?? new Set(),
    accessToken: "test-token",
    refreshToken: "test-refresh",
    expiresAt: Date.now() + 3600_000,
    locale: "fr",
  };
}

describe("Iteration 8 — repository DI wiring", () => {
  it("exposes all 9 workforce repositories via useRepositories()", () => {
    expect(mockRepositories.departments).toBeDefined();
    expect(mockRepositories.shifts).toBeDefined();
    expect(mockRepositories.schedules).toBeDefined();
    expect(mockRepositories.tasks).toBeDefined();
    expect(mockRepositories.workforceAttendance).toBeDefined();
    expect(mockRepositories.leaveRequests).toBeDefined();
    expect(mockRepositories.performanceReviews).toBeDefined();
    expect(mockRepositories.chat).toBeDefined();
    expect(mockRepositories.onboarding).toBeDefined();
  });

  it("workforce repositories expose the expected observe() methods", () => {
    expect(typeof mockRepositories.departments.observe).toBe("function");
    expect(typeof mockRepositories.shifts.observe).toBe("function");
    expect(typeof mockRepositories.tasks.observe).toBe("function");
    expect(typeof mockRepositories.chat.observeChannels).toBe("function");
    expect(typeof mockRepositories.onboarding.observe).toBe("function");
  });

  it("workforce repositories expose the expected mutating methods", () => {
    expect(typeof mockRepositories.departments.createDepartment).toBe("function");
    expect(typeof mockRepositories.tasks.createTask).toBe("function");
    expect(typeof mockRepositories.tasks.updateTaskStatus).toBe("function");
    expect(typeof mockRepositories.chat.sendMessage).toBe("function");
    expect(typeof mockRepositories.onboarding.start).toBe("function");
    expect(typeof mockRepositories.onboarding.complete).toBe("function");
  });

  it("workforce attendance repository exposes latestFor sync helper", () => {
    expect(typeof mockRepositories.workforceAttendance.latestFor).toBe("function");
  });
});

describe("Iteration 8 — RoleDashboardRouter dispatch", () => {
  beforeEach(() => {
    mockSessions.current = null;
  });

  it("renders AdministratorDashboard for SuperAdmin", () => {
    mockSessions.current = fakeSession(Role.SuperAdmin);
    const { container } = render(
      <RoleDashboardRouter role={Role.SuperAdmin} />,
      { wrapper: makeWrapper() },
    );
    expect(container.textContent).toContain("Tableau de bord");
  });

  it("renders AdministratorDashboard for FinancialOfficer", () => {
    mockSessions.current = fakeSession(Role.FinancialOfficer);
    const { container } = render(
      <RoleDashboardRouter role={Role.FinancialOfficer} />,
      { wrapper: makeWrapper() },
    );
    expect(container.textContent).toContain("Tableau de bord");
  });

  it("renders AdministratorDashboard for SupportStaff", () => {
    mockSessions.current = fakeSession(Role.SupportStaff);
    const { container } = render(
      <RoleDashboardRouter role={Role.SupportStaff} />,
      { wrapper: makeWrapper() },
    );
    expect(container.textContent).toContain("Tableau de bord");
  });

  it("renders ManagerDashboard for Manager", () => {
    mockSessions.current = fakeSession(Role.Manager);
    const { container } = render(
      <RoleDashboardRouter role={Role.Manager} />,
      { wrapper: makeWrapper() },
    );
    expect(container.textContent!.length).toBeGreaterThan(0);
  });

  it("renders BuyerDashboard for Buyer", () => {
    mockSessions.current = fakeSession(Role.Buyer);
    const { container } = render(
      <RoleDashboardRouter role={Role.Buyer} />,
      { wrapper: makeWrapper() },
    );
    expect(container.textContent!.length).toBeGreaterThan(0);
  });

  it("renders DriverDashboard for Driver", () => {
    mockSessions.current = fakeSession(Role.Driver);
    const { container } = render(
      <RoleDashboardRouter role={Role.Driver} />,
      { wrapper: makeWrapper() },
    );
    expect(container.textContent!.length).toBeGreaterThan(0);
  });

  it("renders WarehouseWorkerDashboard for WarehouseWorker", () => {
    mockSessions.current = fakeSession(Role.WarehouseWorker);
    const { container } = render(
      <RoleDashboardRouter role={Role.WarehouseWorker} />,
      { wrapper: makeWrapper() },
    );
    expect(container.textContent!.length).toBeGreaterThan(0);
  });

  it("renders TeacherDashboard for Teacher", () => {
    mockSessions.current = fakeSession(Role.Teacher);
    const { container } = render(
      <RoleDashboardRouter role={Role.Teacher} />,
      { wrapper: makeWrapper() },
    );
    expect(container.textContent!.length).toBeGreaterThan(0);
  });

  it("renders WorkerDashboard for Worker", () => {
    mockSessions.current = fakeSession(Role.Worker);
    const { container } = render(
      <RoleDashboardRouter role={Role.Worker} />,
      { wrapper: makeWrapper() },
    );
    expect(container.textContent!.length).toBeGreaterThan(0);
  });

  it("renders a fallback panel for Parent/Student roles", () => {
    mockSessions.current = null;
    const { container } = render(
      <RoleDashboardRouter role={Role.Parent} />,
      { wrapper: makeWrapper() },
    );
    expect(container.textContent).toContain("Accès non configuré");
  });
});

describe("Iteration 8 — OnboardingWizard smoke", () => {
  it("renders without crashing", () => {
    mockSessions.current = fakeSession(Role.SuperAdmin);
    const { container } = render(<OnboardingWizard />, { wrapper: makeWrapper() });
    expect(container.textContent!.length).toBeGreaterThan(0);
  });
});

describe("Iteration 8 — modal unification invariant (regression)", () => {
  it("no raw <Dialog> usage outside unified-modal.tsx and dialog.tsx primitives", async () => {
    const fs = await import("fs");
    const path = await import("path");

    function walk(dir: string, files: string[] = []): string[] {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
          walk(full, files);
        } else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
          files.push(full);
        }
      }
      return files;
    }

    const srcDir = path.resolve(__dirname, "../../..");
    const files = walk(srcDir);
    const allowed = ["unified-modal.tsx", "dialog.tsx"];
    const violations: string[] = [];
    for (const file of files) {
      const rel = path.relative(srcDir, file);
      if (allowed.some((a) => rel.endsWith(a))) continue;
      // Skip test files — they may reference the import path as a string.
      if (rel.includes("test/") || rel.includes(".test.")) continue;
      const content = fs.readFileSync(file, "utf-8");
      if (content.includes('from "@radix-ui/react-dialog"')) {
        violations.push(rel);
      }
    }
    expect(violations).toEqual([]);
  });
});
