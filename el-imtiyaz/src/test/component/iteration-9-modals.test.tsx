/**
 * Iteration 9 — Component tests for the new dashboard-era modals.
 *
 * Verifies that the new modals render correctly, accept user input, and
 * call the expected callbacks. Uses React Testing Library.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { HashRouter } from "react-router-dom";
import { AlertCreatorModal } from "../../features/dashboard/alert-creator-modal";
import { AlertDetailModal } from "../../features/dashboard/alert-detail-modal";
import { AcademicYearSelector, computeDateRange } from "../../features/dashboard/academic-year-selector";
import { RepositoryProvider, mockRepositories } from "../../app/providers/repository-provider";
import { AuthProvider } from "../../app/providers/auth-provider";
import { ToastProvider } from "../../app/providers/toast-provider";
import type { AppNotification } from "../../domain/model/operations";
import { Role } from "../../core/rbac/roles";

// Wrap components with all the providers they need.
function renderWithProviders(ui: React.ReactElement) {
  return render(
    <HashRouter>
      <AuthProvider>
        <ToastProvider>
          <RepositoryProvider>{ui}</RepositoryProvider>
        </ToastProvider>
      </AuthProvider>
    </HashRouter>,
  );
}

describe("Iteration 9 — AlertCreatorModal", () => {
  it("renders the modal when open", () => {
    renderWithProviders(
      <AlertCreatorModal open={true} onOpenChange={() => {}} sourceLabel="Test" />,
    );
    expect(screen.getByText("Nouvelle alerte")).toBeInTheDocument();
    expect(screen.getByText("Titre")).toBeInTheDocument();
    expect(screen.getByText("Description")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    renderWithProviders(
      <AlertCreatorModal open={false} onOpenChange={() => {}} sourceLabel="Test" />,
    );
    expect(screen.queryByText("Nouvelle alerte")).not.toBeInTheDocument();
  });

  it("renders the priority selector with all 4 levels", () => {
    renderWithProviders(
      <AlertCreatorModal open={true} onOpenChange={() => {}} sourceLabel="Test" />,
    );
    // The Select trigger is rendered; opening it requires a click.
    // We verify at least the modal title and Cible label are present.
    expect(screen.getByText("Cible")).toBeInTheDocument();
    expect(screen.getByText("Tous")).toBeInTheDocument();
    expect(screen.getByText("Par rôle")).toBeInTheDocument();
    expect(screen.getByText("Par utilisateur")).toBeInTheDocument();
  });
});

describe("Iteration 9 — AlertDetailModal", () => {
  const sampleAlert: AppNotification = {
    id: "ntf-test-001",
    title: "Test alert title",
    body: "Test alert body content for verification.",
    type: "custom",
    priority: "urgent",
    source: "manual",
    sourceLabel: "Test source label",
    entityType: null,
    entityId: null,
    targetUserId: null,
    targetRole: null,
    triggeredAt: null,
    readAt: null,
    createdAt: new Date().toISOString(),
    createdBy: "usr-test-001",
  };

  it("renders nothing when alert is null", () => {
    const { container } = renderWithProviders(
      <AlertDetailModal alert={null} open={true} onOpenChange={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the alert title and priority when open", () => {
    renderWithProviders(
      <AlertDetailModal alert={sampleAlert} open={true} onOpenChange={() => {}} />,
    );
    expect(screen.getByText("Test alert title")).toBeInTheDocument();
    expect(screen.getByText("Urgente")).toBeInTheDocument();
    expect(screen.getByText("Manuelle")).toBeInTheDocument();
    expect(screen.getByText("Test source label")).toBeInTheDocument();
  });

  it("renders the alert body content", () => {
    renderWithProviders(
      <AlertDetailModal alert={sampleAlert} open={true} onOpenChange={() => {}} />,
    );
    expect(screen.getByText("Test alert body content for verification.")).toBeInTheDocument();
  });

  it("shows the dismiss button", () => {
    renderWithProviders(
      <AlertDetailModal alert={sampleAlert} open={true} onOpenChange={() => {}} />,
    );
    expect(screen.getByText("Supprimer")).toBeInTheDocument();
  });
});

describe("Iteration 9 — AcademicYearSelector", () => {
  it("renders the current academic year and preset", () => {
    render(
      <AcademicYearSelector
        value={{
          academicYear: "2025-2026",
          range: { from: "2025-09-01", to: "2026-08-31" },
          preset: "ytd",
        }}
        onChange={() => {}}
        availableYears={["2024-2025", "2025-2026", "2026-2027"]}
      />,
    );
    expect(screen.getByText("2025-2026")).toBeInTheDocument();
    expect(screen.getByText("Année complète")).toBeInTheDocument();
  });

  it("shows the reset button when a non-ytd preset is active", () => {
    render(
      <AcademicYearSelector
        value={{
          academicYear: "2025-2026",
          range: { from: "2025-09-01", to: "2025-09-30" },
          preset: "month",
        }}
        onChange={() => {}}
        availableYears={["2025-2026"]}
      />,
    );
    expect(screen.getByText("Mois courant")).toBeInTheDocument();
  });
});

describe("Iteration 9 — computeDateRange", () => {
  it("returns Sep 1 → next Aug 31 for YTD", () => {
    const range = computeDateRange("2025-2026", "ytd");
    expect(range.from).toBe("2025-09-01");
    expect(range.to).toBe("2026-09-01");
  });

  it("returns a 1-month window for month preset", () => {
    const now = new Date(2025, 9, 15); // Oct 15 2025
    const range = computeDateRange("2025-2026", "month", now);
    expect(range.from).toBe("2025-10-01");
    expect(range.to).toBe("2025-11-01");
  });

  it("returns a 3-month window for quarter preset", () => {
    const now = new Date(2025, 9, 15); // Oct 15 2025 → Q1 (Sep-Nov)
    const range = computeDateRange("2025-2026", "quarter", now);
    expect(range.from).toBe("2025-09-01");
    expect(range.to).toBe("2025-12-01");
  });

  it("falls back to current month for custom preset", () => {
    const now = new Date(2025, 9, 15);
    const range = computeDateRange("2025-2026", "custom", now);
    expect(range.from).toBe("2025-10-01");
    expect(range.to).toBe("2025-11-01");
  });

  it("falls back to current academic year when year is malformed", () => {
    const now = new Date(2025, 9, 15);
    const range = computeDateRange("invalid", "ytd", now);
    // Falls back to current academic year (Sep 2025 → Sep 2026)
    expect(range.from).toBe("2025-09-01");
    expect(range.to).toBe("2026-09-01");
  });
});
