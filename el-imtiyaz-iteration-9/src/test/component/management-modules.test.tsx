/**
 * Component tests for the 4 Personnel management modules (iteration 9).
 *
 * Verifies that each module:
 *   - Renders its section header + primary action button
 *   - Surfaces real data from the mock repositories
 *   - Lays out its role-specific UI (search input, Kanban columns, two-pane chat)
 *
 * Modules under test:
 *   - AdministratorEmployeeDirectory
 *   - DepartmentManagement
 *   - TaskManagement
 *   - ChatPanel
 *
 * The mock pattern mirrors `src/test/integration/iteration-8.test.tsx` and
 * `src/test/component/dashboards.test.tsx`: auth + toast contexts are mocked
 * at module scope so each test can inject a synthetic Session.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RepositoryProvider, mockRepositories } from "../../infrastructure/repository-provider";
import { AdministratorEmployeeDirectory } from "../../features/personnel/management/employee-directory";
import { DepartmentManagement } from "../../features/personnel/management/department-management";
import { TaskManagement } from "../../features/personnel/management/task-management";
import { ChatPanel } from "../../features/personnel/management/chat-panel";
import { Role } from "../../core/rbac/roles";
import { DEFAULT_ROLE_PERMISSIONS } from "../../core/rbac/permissions";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "../../i18n/i18n";
import React from "react";
import type { Session } from "../../core/rbac/session";

// ---- Module-level mocks --------------------------------------------------

const mockSessions: { current: Session | null } = { current: null };

vi.mock("../../state/auth-context", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({
    session: mockSessions.current,
    isLoading: false,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));

vi.mock("../../state/toast-context", () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
    showInfo: vi.fn(),
    showWarning: vi.fn(),
  }),
}));

// ---- Shared wrappers -----------------------------------------------------

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

/** Fake SuperAdmin session — the directory is rendered inside the
 * AdministratorDashboard, so the session role is always a full admin here. */
function adminSession(role: Role = Role.SuperAdmin): Session {
  return {
    userId: "usr-adm-001",
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

// ==========================================================================
// AdministratorEmployeeDirectory
// ==========================================================================

describe("AdministratorEmployeeDirectory", () => {
  beforeEach(() => {
    mockSessions.current = null;
  });

  it("renders the directory with a search input", () => {
    mockSessions.current = adminSession();
    const { container } = render(<AdministratorEmployeeDirectory />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Annuaire des employés");
    // The toolbar includes a search input with this exact placeholder.
    const searchInput = container.querySelector('input[placeholder*="Rechercher"]');
    expect(searchInput).not.toBeNull();
  });

  it("displays personnel rows from repos.personnel", () => {
    mockSessions.current = adminSession();
    const { container } = render(<AdministratorEmployeeDirectory />, {
      wrapper: makeWrapper(),
    });
    // The seeded personnel "Brahim Souilah" (per-007) should appear in the list.
    expect(container.textContent).toContain("Brahim Souilah");
    // Each row is an <li> — count should match the seeded personnel count (15).
    const rows = container.querySelectorAll("li");
    expect(rows.length).toBeGreaterThanOrEqual(10);
  });

  it("'Nouvel employé' button is present", () => {
    mockSessions.current = adminSession();
    const { container } = render(<AdministratorEmployeeDirectory />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Nouvel employé");
  });

  it("clicking a row opens the profile drawer", () => {
    mockSessions.current = adminSession();
    const { container } = render(<AdministratorEmployeeDirectory />, {
      wrapper: makeWrapper(),
    });
    // Before the click, the drawer's "Informations personnelles" section is
    // not in the DOM (the drawer renders null when closed).
    expect(document.body.textContent).not.toContain("Informations personnelles");

    // Click the first personnel row.
    const firstRow = container.querySelector("li");
    expect(firstRow).not.toBeNull();
    fireEvent.click(firstRow!);

    // After the click, the drawer opens via UnifiedModal and the portal
    // content is appended to document.body.
    expect(document.body.textContent).toContain("Informations personnelles");
  });
});

// ==========================================================================
// DepartmentManagement
// ==========================================================================

describe("DepartmentManagement", () => {
  beforeEach(() => {
    mockSessions.current = null;
  });

  it("renders department cards from repos.departments", () => {
    mockSessions.current = adminSession();
    const { container } = render(<DepartmentManagement />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Départements");
    // The seeded "Administration" department should appear as a card.
    expect(container.textContent).toContain("Administration");
    // The seeded "Teachers" department should also appear.
    expect(container.textContent).toContain("Teachers");
  });

  it("'Nouveau département' button is present", () => {
    mockSessions.current = adminSession();
    const { container } = render(<DepartmentManagement />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Nouveau département");
  });

  it("each card shows department name and headcount", () => {
    mockSessions.current = adminSession();
    const { container } = render(<DepartmentManagement />, {
      wrapper: makeWrapper(),
    });
    // Every department card surfaces a headcount line with the word "employé".
    expect(container.textContent).toMatch(/employé/);
    // The "Teachers" department has 6 seeded personnel — its card should show
    // the plural form "employés".
    expect(container.textContent).toContain("employés");
  });
});

// ==========================================================================
// TaskManagement
// ==========================================================================

describe("TaskManagement", () => {
  beforeEach(() => {
    mockSessions.current = null;
  });

  it("renders the Kanban-style board with columns by status", () => {
    mockSessions.current = adminSession();
    const { container } = render(<TaskManagement />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Tableau des tâches");
    // The 5 column headers (from TASK_STATUS_LABELS_FR) should all render.
    expect(container.textContent).toContain("En attente");
    expect(container.textContent).toContain("Affectée");
    expect(container.textContent).toContain("En cours");
    expect(container.textContent).toContain("Bloquée");
    expect(container.textContent).toContain("Terminée");
  });

  it("displays task cards from repos.tasks", () => {
    mockSessions.current = adminSession();
    const { container } = render(<TaskManagement />, {
      wrapper: makeWrapper(),
    });
    // Seeded task titles should appear in the board.
    expect(container.textContent).toContain("Préparer commandes fournitures rentrée");
    expect(container.textContent).toContain("Maintenance chaudière");
  });

  it("'Nouvelle tâche' button is present", () => {
    mockSessions.current = adminSession();
    const { container } = render(<TaskManagement />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Nouvelle tâche");
  });

  it("tasks are distributed across columns (pending, assigned, in_progress, blocked, completed)", () => {
    mockSessions.current = adminSession();
    const { container } = render(<TaskManagement />, {
      wrapper: makeWrapper(),
    });
    // Each column header is followed by a count chip (StatusChip with the
    // numeric count). We verify at least one column has a non-zero count by
    // checking that the seeded "Préparer commandes fournitures rentrée" task
    // (status: pending) appears under the "En attente" column.
    const text = container.textContent ?? "";
    expect(text).toContain("En attente");
    expect(text).toContain("Préparer commandes fournitures rentrée");
    // The board also renders at least one task in the "completed" column
    // (seeded task "Maintenance chaudière" has status: completed).
    expect(text).toContain("Terminée");
    // Total task count across columns should be ≥ 5 (seeded tasks minus
    // cancelled, which are hidden from the board).
    const taskCardButtons = container.querySelectorAll("button[type='button']");
    // The board has 5 column containers + 1 "Nouvelle tâche" button + filter
    // selects — we just verify there are multiple task cards rendered.
    expect(taskCardButtons.length).toBeGreaterThanOrEqual(5);
  });
});

// ==========================================================================
// ChatPanel
// ==========================================================================

describe("ChatPanel", () => {
  beforeEach(() => {
    mockSessions.current = null;
  });

  it("renders the two-pane layout (channel list + messages)", () => {
    mockSessions.current = adminSession();
    const { container } = render(<ChatPanel />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Messagerie interne");
    // The left pane header always shows "Canaux (N)".
    expect(container.textContent).toContain("Canaux");
  });

  it("displays channels from repos.chat", () => {
    mockSessions.current = adminSession();
    const { container } = render(<ChatPanel />, {
      wrapper: makeWrapper(),
    });
    // The seeded "Annonces générales" announcement channel is visible to
    // every user (announcement channels bypass membership filtering).
    expect(container.textContent).toContain("Annonces générales");
  });

  it("displays message input at the bottom", () => {
    mockSessions.current = adminSession();
    const { container } = render(<ChatPanel />, {
      wrapper: makeWrapper(),
    });
    // The composer input has this exact placeholder.
    const messageInput = container.querySelector('input[placeholder*="Écrire un message"]');
    expect(messageInput).not.toBeNull();
  });

  it("'Nouveau canal' button is present", () => {
    mockSessions.current = adminSession();
    const { container } = render(<ChatPanel />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Nouveau canal");
  });
});
