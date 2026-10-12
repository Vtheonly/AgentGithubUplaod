/**
 * UI-339 — local recovery funnel prototype regression tests.
 *
 * All fixtures are synthetic and all derived values are computed in memory.
 * This suite deliberately does not initialize repositories or messaging APIs.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import "../../../i18n/i18n";
import { ToastProvider } from "../../../app/providers/toast-provider";
import {
  DEFAULT_RECOVERY_DEMO_CONFIG,
  DEMO_RECOVERY_HOUSEHOLDS,
  DEFAULT_RECOVERY_MESSAGE_TEMPLATES,
  RecoveryFunnelCard,
  type DemoRecoveryHousehold,
  createDemoRecoveryHouseholds,
  demoRecoveryHouseholdsForStage,
  deriveDemoRecoveryFunnel,
  renderDemoRecoveryMessage,
} from "../../../features/dashboard/components/recovery-funnel-card";
import type { FunnelStage } from "../../../features/dashboard/components/recovery-funnel-card";

afterEach(cleanup);

const PRODUCTION_STAGE_FIXTURE: FunnelStage[] = [
  { name: "Débiteurs (encours > 0)", count: 1182, rateFromPrevious: 100, color: "#b58b3c" },
  { name: "En retard (échus)", count: 548, rateFromPrevious: 46, color: "#5279a8" },
  { name: "Au-delà du seuil jaune", count: 0, rateFromPrevious: 0, color: "#d6a34d" },
  { name: "Critique", count: 0, rateFromPrevious: 0, color: "#c05252" },
];

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="route-location">{location.pathname + location.search}</output>;
}

function renderPrototype(headerActions?: ReactNode) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <RecoveryFunnelCard
          stages={PRODUCTION_STAGE_FIXTURE}
          headerActions={headerActions}
        />
        <LocationProbe />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("UI-339 — synthetic recovery funnel calculations", () => {
  it("starts at the requested 1,182 debtors / 548 overdue / 0 yellow / 0 critical", () => {
    expect(DEMO_RECOVERY_HOUSEHOLDS).toHaveLength(1182);
    expect(deriveDemoRecoveryFunnel()).toMatchObject([
      { count: 1182, rateFromPrevious: 100 },
      { count: 548, rateFromPrevious: 46 },
      { count: 0, rateFromPrevious: 0 },
      { count: 0, rateFromPrevious: 0 },
    ]);
  });

  it("recalculates yellow and critical counts from edited thresholds", () => {
    const yellowAt30 = deriveDemoRecoveryFunnel({
      ...DEFAULT_RECOVERY_DEMO_CONFIG,
      yellowDays: 30,
      redDays: 45,
    });
    expect(yellowAt30.map((stage) => stage.count)).toEqual([1182, 548, 270, 135]);
    expect(yellowAt30.map((stage) => stage.rateFromPrevious)).toEqual([100, 46, 23, 11]);
  });

  it("applies the amount criterion consistently to all stage assignments", () => {
    const thresholds = {
      ...DEFAULT_RECOVERY_DEMO_CONFIG,
      minimumOutstandingDzd: 50000,
      yellowDays: 30,
      redDays: 45,
    };
    const stages = deriveDemoRecoveryFunnel(thresholds);
    expect(stages[0].count).toBeLessThan(1182);
    expect(stages[1].count).toBeLessThanOrEqual(stages[0].count);
    expect(stages[2].count).toBeLessThanOrEqual(stages[1].count);
    expect(stages[3].count).toBeLessThanOrEqual(stages[2].count);
    expect(demoRecoveryHouseholdsForStage(3, thresholds)).toHaveLength(stages[3].count);
  });

  it("classifies yellow and red amount bands independently from debt age", () => {
    const households: DemoRecoveryHousehold[] = [
      { id: "amount-green", name: "Foyer Montant Vert", studentName: "Lina", outstandingAmount: 15000, daysOverdue: 0 },
      { id: "amount-yellow", name: "Foyer Montant Jaune", studentName: "Adam", outstandingAmount: 25000, daysOverdue: 0 },
      { id: "amount-red", name: "Foyer Montant Rouge", studentName: "Aya", outstandingAmount: 80000, daysOverdue: 0 },
      { id: "age-grace", name: "Foyer Retard Grâce", studentName: "Yanis", outstandingAmount: 15000, daysOverdue: 30 },
      { id: "age-yellow", name: "Foyer Retard Jaune", studentName: "Maya", outstandingAmount: 15000, daysOverdue: 100 },
      { id: "age-red", name: "Foyer Retard Rouge", studentName: "Amir", outstandingAmount: 15000, daysOverdue: 160 },
    ];
    const config = {
      ...DEFAULT_RECOVERY_DEMO_CONFIG,
      graceDays: 0,
      yellowDays: 90,
      redDays: 150,
      amountYellowDzd: 20000,
      amountRedDzd: 60000,
    };
    const stages = deriveDemoRecoveryFunnel(config, households);

    // Amount and aging are separate axes: a high balance can be yellow/red
    // even while no days are overdue. The funnel still remains cumulative.
    expect(stages.map((stage) => stage.count)).toEqual([6, 5, 4, 2]);
    expect(demoRecoveryHouseholdsForStage(1, config, households).map((h) => h.id)).toEqual([
      "amount-yellow", "amount-red", "age-grace", "age-yellow", "age-red",
    ]);
    expect(demoRecoveryHouseholdsForStage(2, config, households).map((h) => h.id)).toEqual([
      "amount-yellow", "amount-red", "age-yellow", "age-red",
    ]);
    expect(demoRecoveryHouseholdsForStage(3, config, households).map((h) => h.id)).toEqual([
      "amount-red", "age-red",
    ]);
  });

  it("uses stable, clearly fictional household identities", () => {
    const generated = createDemoRecoveryHouseholds();
    expect(generated[0].id).toBe("demo-family-0001");
    expect(generated[0].name).toContain("Démo 0001");
    expect(new Set(generated.map((household) => household.id)).size).toBe(1182);
  });

  it("renders all supported placeholders without requiring a messaging service", () => {
    const household = DEMO_RECOVERY_HOUSEHOLDS[0];
    const rendered = renderDemoRecoveryMessage(
      DEFAULT_RECOVERY_MESSAGE_TEMPLATES[1] +
        " Élève : {studentName}. Étape : {stageName}.",
      household,
      "En retard",
    );
    expect(rendered).toContain(household.name);
    expect(rendered).toContain(household.studentName);
    expect(rendered).toContain(String(household.daysOverdue));
    expect(rendered).toContain("En retard");
    expect(rendered).not.toContain("{parentName}");
    expect(rendered).not.toContain("{studentName}");
    expect(rendered).not.toContain("{amountDzd}");
    expect(rendered).not.toContain("{daysOverdue}");
    expect(rendered).not.toContain("{stageName}");
  });
});

describe("UI-339 — local funnel interactions", () => {
  it("opens a synthetic household list and runs the message preview-to-confirmation flow", async () => {
    renderPrototype();

    // The production data remains the default until the explicit prototype toggle.
    expect(screen.getByRole("button", { name: /aperçu local/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /aperçu local/i }));

    expect(screen.getByText(/données fictives/i)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /ouvrir la liste de l’étape 1/i }),
    );

    expect(screen.getByText("Foyers dans cette étape")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByText(/1[\s\u00a0\u202f.,]?182/)).toBeInTheDocument();
    expect(screen.getByText(/Nadia Benali · Démo 0001/)).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /préparer un message pour Nadia Benali/i }),
    );
    const previewDialog = screen.getByRole("dialog", { name: "Prévisualiser le message" });
    expect(within(previewDialog).getByLabelText(/message \(modifiable avant confirmation\)/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /continuer vers la confirmation/i }));
    const confirmationDialog = screen.getByRole("dialog", { name: "Confirmer la simulation" });
    expect(within(confirmationDialog).getByText(/ne contacte aucun parent/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirmer la simulation" }));
    expect(screen.queryByRole("dialog", { name: "Confirmer la simulation" })).not.toBeInTheDocument();
  });

  it("hides the persisted Settings trigger only while the local prototype is active", () => {
    renderPrototype(<button type="button">Persist real thresholds</button>);
    expect(
      screen.getByRole("button", { name: "Persist real thresholds" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /aperçu local/i }));
    expect(
      screen.queryByRole("button", { name: "Persist real thresholds" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /données du tableau/i }));
    expect(
      screen.getByRole("button", { name: "Persist real thresholds" }),
    ).toBeInTheDocument();
  });

  it("routes Finance actions with the selected fictional household context", () => {
    renderPrototype();
    fireEvent.click(screen.getByRole("button", { name: /aperçu local/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /ouvrir la liste de l’étape 1/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /ouvrir finances pour Nadia Benali/i }),
    );
    expect(screen.getByTestId("route-location")).toHaveTextContent(
      "/financials?familyId=demo-family-0001",
    );
  });

  it("previews and applies the yellow/red amount thresholds without touching Settings", () => {
    renderPrototype();
    fireEvent.click(screen.getByRole("button", { name: /aperçu local/i }));
    fireEvent.click(screen.getByRole("button", { name: /réglages de la démo/i }));

    const config = {
      ...DEFAULT_RECOVERY_DEMO_CONFIG,
      amountYellowDzd: 20000,
      amountRedDzd: 60000,
    };
    const expected = deriveDemoRecoveryFunnel(config);

    fireEvent.change(screen.getByLabelText("Seuil montant jaune (DZD)"), {
      target: { value: "20000" },
    });
    fireEvent.change(screen.getByLabelText("Seuil montant rouge (DZD)"), {
      target: { value: "60000" },
    });

    expect(
      screen.getByTestId("demo-preview-count-3").textContent?.replace(/\\D/g, ""),
    ).toBe(String(expected[2].count));
    expect(
      screen.getByTestId("demo-preview-count-4").textContent?.replace(/\\D/g, ""),
    ).toBe(String(expected[3].count));

    fireEvent.click(screen.getByRole("button", { name: "Appliquer localement" }));
    fireEvent.click(screen.getByRole("button", { name: /ouvrir la liste de l’étape 3/i }));
    expect(
      screen.getByTestId("demo-stage-household-count").textContent?.replace(/\\D/g, ""),
    ).toBe(String(expected[2].count));
  });

  it("shows a live preview of threshold edits before the operator applies them locally", () => {
    renderPrototype();
    fireEvent.click(screen.getByRole("button", { name: /aperçu local/i }));
    fireEvent.click(screen.getByRole("button", { name: /réglages de la démo/i }));

    fireEvent.change(screen.getByLabelText("Seuil jaune (jours)"), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByLabelText("Seuil rouge (jours)"), {
      target: { value: "45" },
    });

    expect(screen.getByText("270", { selector: "div" })).toBeInTheDocument();
    expect(screen.getByText("135", { selector: "div" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Appliquer localement" }));
    fireEvent.click(screen.getByRole("button", { name: /ouvrir la liste de l’étape 3/i }));
    expect(within(screen.getByRole("dialog")).getAllByText("270").length).toBeGreaterThan(0);
  });
});
