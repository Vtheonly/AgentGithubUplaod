/**
 * UI-339 — local recovery funnel prototype regression tests.
 *
 * All fixtures are synthetic and all derived values are computed in memory.
 * This suite deliberately does not initialize repositories or messaging APIs.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "../../../i18n/i18n";
import { ToastProvider } from "../../../app/providers/toast-provider";
import {
  DEFAULT_RECOVERY_DEMO_CONFIG,
  DEMO_RECOVERY_HOUSEHOLDS,
  DEFAULT_RECOVERY_MESSAGE_TEMPLATES,
  RecoveryFunnelCard,
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

function renderPrototype() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <RecoveryFunnelCard stages={PRODUCTION_STAGE_FIXTURE} />
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
    expect(screen.getByText("Prévisualiser le message")).toBeInTheDocument();
    expect(screen.getByLabelText(/message \(modifiable avant confirmation\)/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /continuer vers la confirmation/i }));
    expect(screen.getByText("Confirmer la simulation")).toBeInTheDocument();
    expect(screen.getByText(/ne contacte aucun parent/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirmer la simulation" }));
    expect(screen.queryByText("Confirmer la simulation")).not.toBeInTheDocument();
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
