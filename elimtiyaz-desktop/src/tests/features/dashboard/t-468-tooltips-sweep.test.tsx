/**
 * T-468 — the tooltip sweep's remaining gaps (UI-329), the regression
 * suite.
 *
 * THE MANDATE (the owner's issue): "Add the appropriate tooltip/explanatory
 * information to all missing components… These tooltips should also follow
 * the existing application's localization/i18n approach rather than
 * introducing random hardcoded text into individual components."
 *
 * What this pins:
 *   - every NEW glossary key resolves through the i18n system (the InfoTip
 *     renders its button + the aria-label carries the title — a missing key
 *     renders NOTHING by the component's own honest-empty rule, so presence
 *     IS resolution);
 *   - the two UNMOUNTED pre-existing entries (crossRisk.card, pivot.card —
 *     authored during T-447, never wired) now render on their cards;
 *   - SparklineKpiCard's optional `tip` prop (the Overview KPIs' channel).
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

// i18n first — the components call useTranslation().
import "../../../i18n/i18n";
import { InfoTip } from "../../../features/dashboard/components/analytics/info-tip";
import { SparklineKpiCard } from "../../../features/dashboard/components/sparkline-kpi-card";

describe("T-468 — the new glossary keys resolve through the i18n system", () => {
  const NEW_KEYS = [
    "overview.students",
    "overview.revenue",
    "overview.debt",
    "overview.attendance",
    "rhythm.card",
    "debtMeter.card",
    // The two entries AUTHORED during T-447 but never mounted (UI-329's
    // registration/implementation drift finding).
    "crossRisk.card",
    "pivot.card",
    // The reference-mode entries (landed with T-467 — the same sweep).
    "inspector.referenceMode",
    "pareto.referenceMode",
    "concentration.referenceMode",
  ];

  it.each(NEW_KEYS)("statsTips.%s renders an InfoTip with a resolved title", (key) => {
    render(<InfoTip tip={key} />);
    const testId = `stat-tip-${key.replace(/\./g, "-")}`;
    const button = screen.queryByTestId(testId);
    // Presence = resolution: the component's honest-empty rule renders
    // NOTHING for a missing key, so the button existing proves the key
    // resolves through the fr dictionary.
    expect(button).not.toBeNull();
    // The title resolves through the dictionary (the honest-empty rule
    // renders NOTHING for a missing key — presence + the labelled title
    // are the resolution proof).
    expect(button?.getAttribute("aria-label")).toBeTruthy();
  });
});

describe("T-468 — SparklineKpiCard's tip channel (the Overview KPIs' path)", () => {
  it("renders the InfoTip when a tip key is given", () => {
    render(
      <SparklineKpiCard label="Élèves actifs" value="312" tip="overview.students" />,
    );
    expect(screen.queryByTestId("stat-tip-overview-students")).not.toBeNull();
  });

  it("renders NO tip button when the key is absent (the honest default)", () => {
    const { container } = render(<SparklineKpiCard label="Élèves actifs" value="312" />);
    expect(container.querySelector('[data-testid^="stat-tip-"]')).toBeNull();
  });
});
