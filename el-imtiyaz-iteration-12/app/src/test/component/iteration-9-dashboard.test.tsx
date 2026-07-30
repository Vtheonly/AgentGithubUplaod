/**
 * Iteration 9 — Dashboard page integration tests.
 *
 * Verifies that the dashboard page reflects the iteration 9 changes:
 *   - Removed: AI Drafting Assistant button
 *   - Removed: static "Export" header button
 *   - Removed: separate "Analytics" tab (merged into Overview)
 *   - Removed: alerts widget from Overview tab
 *   - Added: AcademicYearSelector in the header
 *   - Added: Calendar view embedded in Overview
 *   - Restructured: Reports tab shows ONLY global reports
 *
 * Uses the production mock repositories so the test exercises the real
 * data flow.
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { HashRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import i18n from "../../i18n/i18n";
import { DashboardPage } from "../../features/dashboard/dashboard-page";
import { RepositoryProvider, mockRepositories } from "../../infrastructure/repository-provider";
import { AuthProvider } from "../../state/auth-context";
import { ToastProvider } from "../../state/toast-context";

function renderDashboard() {
  return render(
    <HashRouter>
      <I18nextProvider i18n={i18n}>
        <AuthProvider>
          <ToastProvider>
            <RepositoryProvider>
              <DashboardPage />
            </RepositoryProvider>
          </ToastProvider>
        </AuthProvider>
      </I18nextProvider>
    </HashRouter>,
  );
}

describe("Iteration 9 — Dashboard page (spec §2.1, §2.2, §2.3, §3.1, §4.1, §5.1)", () => {
  it("renders the AcademicYearSelector (replaces static year button)", () => {
    renderDashboard();
    // The selector shows the current academic year as a button label.
    expect(screen.getByText("2025-2026")).toBeInTheDocument();
  });

  it("does NOT render the AI Drafting Assistant button (spec §2.1)", () => {
    renderDashboard();
    expect(screen.queryByText("Assistant de rédaction")).not.toBeInTheDocument();
  });

  it("does NOT render the static Export button in the header (spec §2.1)", () => {
    renderDashboard();
    // The old header had a static "Export" button. The new one has only
    // the AcademicYearSelector and the SeeDetails button.
    // We verify that no button with the exact label "Export" exists in the header.
    // (Export buttons still exist in the Reports tab but only AFTER clicking it.)
    const headerButtons = screen.getAllByRole("button");
    const headerExportButtons = headerButtons.filter((b) => b.textContent?.trim() === "Export");
    // The header itself should not have an Export button.
    // We allow zero matches because the new header removed it.
    expect(headerExportButtons.length).toBe(0);
  });

  it("does NOT render a separate 'Analytique' tab (spec §2.2 — merged into Overview)", () => {
    renderDashboard();
    // The Analytics tab label is "Analytique" (FR). After iteration 9 it
    // is merged into the Overview tab.
    expect(screen.queryByText("Analytique")).not.toBeInTheDocument();
  });

  it("renders the 3 expected tabs: Overview / Alerts / Reports", () => {
    renderDashboard();
    // Three tabs should be present. After iteration 9, the Analytics tab is gone.
    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBe(3);
    // Verify tab labels exist as text somewhere in the document
    const allText = document.body.textContent ?? "";
    expect(allText).toContain("Vue d'ensemble");
    expect(allText).toContain("Alertes");
    expect(allText).toContain("Rapports");
    // Verify the Analytics tab text is gone (merged into Overview per spec §2.2)
    expect(allText).not.toContain("Analytique");
  });

  it("does NOT render an alerts widget in the Overview tab (spec §4.1)", () => {
    renderDashboard();
    // The Overview tab previously had a "Notifications récentes du système" card.
    // After iteration 9, alerts live only in the Alerts tab.
    expect(screen.queryByText("Notifications récentes du système")).not.toBeInTheDocument();
  });

  it("renders the See Details button", () => {
    renderDashboard();
    // The SeeDetails button uses t("dashboard.seeDetails") = "Voir les détails"
    // We check the document text because the button contains an icon + text.
    const allText = document.body.textContent ?? "";
    expect(allText).toContain("Voir les détails");
  });
});
