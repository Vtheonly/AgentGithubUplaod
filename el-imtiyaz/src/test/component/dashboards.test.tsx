/**
 * Component tests for the 7 role-based dashboards (iteration 9).
 *
 * Verifies that each dashboard:
 *   - Renders its header + KPI row
 *   - Renders the role-specific sections
 *   - Surfaces real data from the mock repositories (where applicable)
 *   - Shows the role-appropriate action buttons (modal triggers)
 *
 * The mock pattern mirrors `src/test/integration/iteration-8.test.tsx`:
 *   - `auth-context` and `toast-context` are mocked at module scope so each
 *     test can inject a synthetic Session without a real auth provider
 *   - `mockRepositories` is wired through `RepositoryProvider`
 *   - The fake session's `userId` matches a real seeded Personnel record so
 *     the iteration-9 auth→personnel bridge resolves to actual data
 *     (deliveries for per-011, classes for per-001, etc.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RepositoryProvider, mockRepositories } from "../../app/providers/repository-provider";
import { AdministratorDashboard } from "../../features/personnel/dashboards/administrator-dashboard";
import { ManagerDashboard } from "../../features/personnel/dashboards/manager-dashboard";
import { BuyerDashboard } from "../../features/personnel/dashboards/buyer-dashboard";
import { DriverDashboard } from "../../features/personnel/dashboards/driver-dashboard";
import { WarehouseWorkerDashboard } from "../../features/personnel/dashboards/warehouse-worker-dashboard";
import { TeacherDashboard } from "../../features/personnel/dashboards/teacher-dashboard";
import { WorkerDashboard } from "../../features/personnel/dashboards/worker-dashboard";
import { Role } from "../../core/rbac/roles";
import { DEFAULT_ROLE_PERMISSIONS } from "../../core/rbac/permissions";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "../../i18n/i18n";
import React from "react";
import type { Session } from "../../core/rbac/session";

// ---- Module-level mocks --------------------------------------------------

/**
 * Injectable session store — set `mockSessions.current = fakeSession(role)`
 * before each render to control which user the dashboard sees.
 */
const mockSessions: { current: Session | null } = { current: null };

vi.mock("../../app/providers/auth-provider", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({
    session: mockSessions.current,
    isLoading: false,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));

vi.mock("../../app/providers/toast-provider", () => ({
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

/**
 * Build a fake Session for a role. The `userId` is chosen to match a real
 * seeded Personnel record (per the seed-data table) so the iteration-9
 * auth→personnel bridge resolves to actual data. The override lets a test
 * swap the userId if it needs a non-seeded user (e.g. to test empty states).
 */
const SEEDED_USER_ID: Record<Role, string> = {
  [Role.SuperAdmin]: "usr-adm-001",        // per-007 Brahim Souilah
  [Role.FinancialOfficer]: "usr-fin-001",  // per-008 Fatima Belkacem
  [Role.SupportStaff]: "usr-sup-001",      // per-009 Toufik Ammar
  [Role.Teacher]: "usr-tea-001",           // per-001 Aïcha Bouhenni
  [Role.Manager]: "usr-mgr-001",           // per-014 Leïla Cherif
  [Role.Buyer]: "usr-buy-001",             // per-012 Yacine Mansouri
  [Role.Driver]: "usr-drv-001",            // per-011 Messaoud Khalfaoui
  [Role.WarehouseWorker]: "usr-whw-001",   // per-013 Rachid Hadj
  [Role.Worker]: "usr-wrk-001",            // per-010 Said Bouzid
  [Role.Parent]: "usr-par-001",
  [Role.Student]: "usr-stu-001",
};

function fakeSession(role: Role, userId?: string): Session {
  return {
    userId: userId ?? SEEDED_USER_ID[role],
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
// AdministratorDashboard
// ==========================================================================

describe("AdministratorDashboard", () => {
  beforeEach(() => {
    mockSessions.current = null;
  });

  it("renders with SuperAdmin session and shows 'Tableau de bord' heading", () => {
    mockSessions.current = fakeSession(Role.SuperAdmin);
    const { container } = render(
      <AdministratorDashboard role={Role.SuperAdmin} />,
      { wrapper: makeWrapper() },
    );
    expect(container.textContent).toContain("Tableau de bord");
  });

  it("displays KPI row with Effectif total, Départements, Demandes en attente, En congé", () => {
    mockSessions.current = fakeSession(Role.SuperAdmin);
    const { container } = render(
      <AdministratorDashboard role={Role.SuperAdmin} />,
      { wrapper: makeWrapper() },
    );
    expect(container.textContent).toContain("Effectif total");
    expect(container.textContent).toContain("Départements");
    expect(container.textContent).toContain("Demandes en attente");
    expect(container.textContent).toContain("En congé");
  });

  it("displays department cards with headcounts", () => {
    mockSessions.current = fakeSession(Role.SuperAdmin);
    const { container } = render(
      <AdministratorDashboard role={Role.SuperAdmin} />,
      { wrapper: makeWrapper() },
    );
    // The seeded "Administration" department should appear as a card.
    expect(container.textContent).toContain("Administration");
    // Each card surfaces a headcount chip with the word "employé".
    expect(container.textContent).toMatch(/employé/);
  });

  it("shows pending leave requests section (or its empty state)", () => {
    mockSessions.current = fakeSession(Role.SuperAdmin);
    const { container } = render(
      <AdministratorDashboard role={Role.SuperAdmin} />,
      { wrapper: makeWrapper() },
    );
    expect(container.textContent).toContain("Demandes à traiter");
    // Either the empty-state copy or an "Approuver" action button is acceptable.
    const text = container.textContent ?? "";
    const isEmpty = text.includes("Aucune demande en attente.");
    const hasAction = text.includes("Approuver");
    expect(isEmpty || hasAction).toBe(true);
  });

  it("shows recent activity section", () => {
    mockSessions.current = fakeSession(Role.SuperAdmin);
    const { container } = render(
      <AdministratorDashboard role={Role.SuperAdmin} />,
      { wrapper: makeWrapper() },
    );
    expect(container.textContent).toContain("Activité récente");
  });

  it("shows employee directory section (SuperAdmin only)", () => {
    mockSessions.current = fakeSession(Role.SuperAdmin);
    const { container } = render(
      <AdministratorDashboard role={Role.SuperAdmin} />,
      { wrapper: makeWrapper() },
    );
    expect(container.textContent).toContain("Annuaire des employés");
  });

  it("shows department management section (SuperAdmin only)", () => {
    mockSessions.current = fakeSession(Role.SuperAdmin);
    const { container } = render(
      <AdministratorDashboard role={Role.SuperAdmin} />,
      { wrapper: makeWrapper() },
    );
    // The DepartmentManagement module renders its own "Nouveau département" button.
    expect(container.textContent).toContain("Nouveau département");
  });

  it("FinancialOfficer role renders but without employee directory section", () => {
    mockSessions.current = fakeSession(Role.FinancialOfficer);
    const { container } = render(
      <AdministratorDashboard role={Role.FinancialOfficer} />,
      { wrapper: makeWrapper() },
    );
    expect(container.textContent).toContain("Tableau de bord");
    expect(container.textContent).not.toContain("Annuaire des employés");
  });

  it("SupportStaff role renders but without employee directory section", () => {
    mockSessions.current = fakeSession(Role.SupportStaff);
    const { container } = render(
      <AdministratorDashboard role={Role.SupportStaff} />,
      { wrapper: makeWrapper() },
    );
    expect(container.textContent).toContain("Tableau de bord");
    expect(container.textContent).not.toContain("Annuaire des employés");
  });
});

// ==========================================================================
// ManagerDashboard
// ==========================================================================

describe("ManagerDashboard", () => {
  beforeEach(() => {
    mockSessions.current = null;
  });

  it("renders with Manager session", () => {
    mockSessions.current = fakeSession(Role.Manager);
    const { container } = render(<ManagerDashboard />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Tableau de bord Responsable");
  });

  it("displays KPI row", () => {
    mockSessions.current = fakeSession(Role.Manager);
    const { container } = render(<ManagerDashboard />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Effectif équipe");
    expect(container.textContent).toContain("Tâches ouvertes");
    expect(container.textContent).toContain("Demandes en attente");
    expect(container.textContent).toContain("Assiduité aujourd'hui");
  });

  it("displays team roster section", () => {
    mockSessions.current = fakeSession(Role.Manager);
    const { container } = render(<ManagerDashboard />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Équipe");
    // The seeded manager (per-014) supervises per-001..per-006 — at least one
    // of those teachers' positions should appear in the roster.
    expect(container.textContent).toContain("Professeur");
  });

  it("displays team tasks section", () => {
    mockSessions.current = fakeSession(Role.Manager);
    const { container } = render(<ManagerDashboard />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Tâches de l'équipe");
  });

  it("displays pending requests section", () => {
    mockSessions.current = fakeSession(Role.Manager);
    const { container } = render(<ManagerDashboard />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Demandes à traiter");
  });
});

// ==========================================================================
// BuyerDashboard
// ==========================================================================

describe("BuyerDashboard", () => {
  beforeEach(() => {
    mockSessions.current = null;
  });

  it("renders with Buyer session", () => {
    mockSessions.current = fakeSession(Role.Buyer);
    const { container } = render(<BuyerDashboard />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Tableau de bord Acheteur");
  });

  it("displays KPI row", () => {
    mockSessions.current = fakeSession(Role.Buyer);
    const { container } = render(<BuyerDashboard />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Demandes ouvertes");
    expect(container.textContent).toContain("Livraisons en attente");
    expect(container.textContent).toContain("Fournisseurs");
    expect(container.textContent).toContain("Temps de réponse moyen");
  });

  it("displays purchase requests section with real data from repos.purchaseRequests", () => {
    mockSessions.current = fakeSession(Role.Buyer);
    const { container } = render(<BuyerDashboard />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Demandes d'achat");
    // The seeded purchase requests all use the "PR-2025-NNN" code prefix.
    expect(container.textContent).toContain("PR-2025-");
    // The section header shows the live request count.
    expect(container.textContent).toMatch(/au total/);
  });

  it("displays suppliers section with real data from repos.suppliers", () => {
    mockSessions.current = fakeSession(Role.Buyer);
    const { container } = render(<BuyerDashboard />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Fournisseurs");
    // Seeded supplier "Éditions Alpha" should appear in the suppliers grid.
    expect(container.textContent).toContain("Éditions Alpha");
  });

  it("'Nouvelle demande d'achat' button is present", () => {
    mockSessions.current = fakeSession(Role.Buyer);
    const { container } = render(<BuyerDashboard />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Nouvelle demande d'achat");
  });
});

// ==========================================================================
// DriverDashboard
// ==========================================================================

describe("DriverDashboard", () => {
  beforeEach(() => {
    mockSessions.current = null;
  });

  it("renders with Driver session", () => {
    mockSessions.current = fakeSession(Role.Driver);
    const { container } = render(<DriverDashboard />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Tableau de bord Chauffeur");
  });

  it("displays KPI row", () => {
    mockSessions.current = fakeSession(Role.Driver);
    const { container } = render(<DriverDashboard />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Livraisons affectées");
    expect(container.textContent).toContain("Terminées aujourd'hui");
    expect(container.textContent).toContain("En attente");
    expect(container.textContent).toContain("Retards signalés");
  });

  it("displays deliveries list with real data from repos.deliveries", () => {
    // The seeded driver per-011 (usr-drv-001) has 4 deliveries.
    mockSessions.current = fakeSession(Role.Driver);
    const { container } = render(<DriverDashboard />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Mes livraisons");
    // The 4 seeded deliveries use codes DEL-2025-001..004 — at least one shows.
    expect(container.textContent).toContain("DEL-2025-");
  });

  it("shows delivery status chips", () => {
    mockSessions.current = fakeSession(Role.Driver);
    const { container } = render(<DriverDashboard />, {
      wrapper: makeWrapper(),
    });
    // The DELIVERY_STATUS_LABELS_FR map contains "En transit", "Affectée",
    // "Livrée", "Confirmée", "En retard", "Échouée". At least one of these
    // should appear for the 4 seeded deliveries.
    const text = container.textContent ?? "";
    const statusLabels = ["En transit", "Affectée", "Livrée", "Confirmée", "En retard", "Échouée"];
    expect(statusLabels.some((l) => text.includes(l))).toBe(true);
  });
});

// ==========================================================================
// WarehouseWorkerDashboard
// ==========================================================================

describe("WarehouseWorkerDashboard", () => {
  beforeEach(() => {
    mockSessions.current = null;
  });

  it("renders with WarehouseWorker session", () => {
    mockSessions.current = fakeSession(Role.WarehouseWorker);
    const { container } = render(<WarehouseWorkerDashboard />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Tableau de bord Magasinier");
  });

  it("displays KPI row", () => {
    mockSessions.current = fakeSession(Role.WarehouseWorker);
    const { container } = render(<WarehouseWorkerDashboard />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Réceptions en attente");
    expect(container.textContent).toContain("Expéditions en attente");
    expect(container.textContent).toContain("Alertes stock bas");
    expect(container.textContent).toContain("Avaries signalées");
  });

  it("displays pending receipts section with real data from repos.warehouseTasks", () => {
    mockSessions.current = fakeSession(Role.WarehouseWorker);
    const { container } = render(<WarehouseWorkerDashboard />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Réceptions à traiter");
    // Seeded receipt rcp-001 is from supplier "Fournitures Scolaires Oran".
    expect(container.textContent).toContain("Fournitures Scolaires Oran");
  });

  it("displays pending dispatches section", () => {
    mockSessions.current = fakeSession(Role.WarehouseWorker);
    const { container } = render(<WarehouseWorkerDashboard />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Expéditions à préparer");
    // Seeded dispatch dsp-001 ships "Manuels Maths CEM1" to "Site annexe Hydra".
    expect(container.textContent).toContain("Manuels Maths CEM1");
  });

  it("displays recent inventory activity from repos.inventory", () => {
    mockSessions.current = fakeSession(Role.WarehouseWorker);
    const { container } = render(<WarehouseWorkerDashboard />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Activité récente du stock");
    // Seeded inventory transactions reference SKUs like "STY-BLE-50".
    expect(container.textContent).toContain("STY-BLE-50");
  });

  it("'Scanner un produit' button is present", () => {
    mockSessions.current = fakeSession(Role.WarehouseWorker);
    const { container } = render(<WarehouseWorkerDashboard />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Scanner un produit");
  });

  it("'Signaler une avarie' button is present", () => {
    mockSessions.current = fakeSession(Role.WarehouseWorker);
    const { container } = render(<WarehouseWorkerDashboard />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Signaler une avarie");
  });
});

// ==========================================================================
// TeacherDashboard
// ==========================================================================

describe("TeacherDashboard", () => {
  beforeEach(() => {
    mockSessions.current = null;
  });

  it("renders with Teacher session", () => {
    mockSessions.current = fakeSession(Role.Teacher);
    const { container } = render(<TeacherDashboard />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Tableau de bord Enseignant");
  });

  it("displays KPI row", () => {
    mockSessions.current = fakeSession(Role.Teacher);
    const { container } = render(<TeacherDashboard />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Mes classes");
    expect(container.textContent).toContain("Mes élèves");
    expect(container.textContent).toContain("Devoirs à noter");
    expect(container.textContent).toContain("Appel à faire");
  });

  it("displays 'Mes classes' section with seeded class data", () => {
    mockSessions.current = fakeSession(Role.Teacher);
    const { container } = render(<TeacherDashboard />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Mes classes");
    // The seeded teacher per-001 is the homeroom teacher of cls-001 "4ème A".
    expect(container.textContent).toContain("4ème A");
  });

  it("displays recent homework section", () => {
    mockSessions.current = fakeSession(Role.Teacher);
    const { container } = render(<TeacherDashboard />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Devoirs donnés récemment");
    // Either the seeded homework or the empty-state copy is acceptable.
    const text = container.textContent ?? "";
    const hasHomework = text.includes("Mathématiques"); // seeded hw-001 subject
    const isEmpty = text.includes("Aucun devoir récent.");
    expect(hasHomework || isEmpty).toBe(true);
  });
});

// ==========================================================================
// WorkerDashboard
// ==========================================================================

describe("WorkerDashboard", () => {
  beforeEach(() => {
    mockSessions.current = null;
  });

  it("renders with Worker session", () => {
    mockSessions.current = fakeSession(Role.Worker);
    const { container } = render(<WorkerDashboard />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Tableau de bord Ouvrier");
  });

  it("displays clock-in/out card", () => {
    mockSessions.current = fakeSession(Role.Worker);
    const { container } = render(<WorkerDashboard />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("État du pointage");
    // The clock-state label is one of "Non pointé", "En service", or "En pause".
    const text = container.textContent ?? "";
    const clockStates = ["Non pointé", "En service", "En pause"];
    expect(clockStates.some((s) => text.includes(s))).toBe(true);
  });

  it("displays KPI row", () => {
    mockSessions.current = fakeSession(Role.Worker);
    const { container } = render(<WorkerDashboard />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Tâches affectées");
    expect(container.textContent).toContain("Terminées cette semaine");
    expect(container.textContent).toContain("Demandes en attente");
    expect(container.textContent).toContain("Heures cette semaine");
  });

  it("displays 'Mes tâches' section", () => {
    mockSessions.current = fakeSession(Role.Worker);
    const { container } = render(<WorkerDashboard />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Mes tâches");
  });

  it("displays 'Demander un congé' button", () => {
    mockSessions.current = fakeSession(Role.Worker);
    const { container } = render(<WorkerDashboard />, {
      wrapper: makeWrapper(),
    });
    expect(container.textContent).toContain("Demander un congé");
  });
});
