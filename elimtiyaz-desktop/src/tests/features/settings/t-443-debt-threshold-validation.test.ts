/**
 * T-443 (DEBT-101) — the debt-threshold settings validation suite.
 *
 * Pins `validateDebtThresholdUpdate` (the Configuration tab's pre-write
 * guard):
 *   1. The row's own documented bounds (migration 0125's validation_min /
 *      validation_max columns) are enforced client-side.
 *   2. The cross-row INV-16a no-gap hierarchy (grace ≤ yellow ≤ red) is
 *      enforced against the currently-loaded rows with the edited key
 *      substituted — the server has no cross-row CHECK, so this guard is the
 *      only thing stopping an operator from silently making a tier
 *      unreachable.
 *   3. Non-debt categories pass through untouched (the guard is
 *      debt-specific).
 */
import { describe, it, expect } from "vitest";
import {
  validateDebtThresholdUpdate,
  CATEGORY_CARDS,
  type CategoryCardConfig,
} from "../../../features/settings/configuration/category-cards";
import type { SystemSetting } from "../../../infrastructure/system-config";

function debtSetting(
  key: string,
  value: number,
  min: number | null,
  max: number | null,
): SystemSetting {
  return {
    id: `id-${key}`,
    category: "debt",
    key,
    label_fr: key,
    label_ar: null,
    label_en: null,
    description_fr: null,
    value_type: "number",
    value,
    is_sensitive: false,
    is_editable: true,
    is_required: true,
    sort_order: 80,
    validation_pattern: null,
    validation_min: min,
    validation_max: max,
    options: null,
    is_configured: true,
    updated_at: "2026-09-30T00:00:00Z",
  };
}

/** The migration-0125 seed rows (the live defaults). */
function seededRows(): SystemSetting[] {
  return [
    debtSetting("debt.grace_period_days", 5, 0, 30),
    debtSetting("debt.threshold_yellow_days", 15, 1, 90),
    debtSetting("debt.threshold_red_days", 60, 5, 365),
    debtSetting("debt.active_payer_grace_days", 15, 0, 90),
  ];
}

describe("T-443 — validateDebtThresholdUpdate (the INV-16a pre-write guard)", () => {
  it("accepts a valid in-hierarchy update", () => {
    const rows = seededRows();
    const yellow = rows.find((r) => r.key === "debt.threshold_yellow_days")!;
    expect(validateDebtThresholdUpdate(rows, yellow, 20)).toBeNull();
  });

  it("enforces the row's own documented bounds (validation_min / validation_max)", () => {
    const rows = seededRows();
    const red = rows.find((r) => r.key === "debt.threshold_red_days")!;
    expect(validateDebtThresholdUpdate(rows, red, 2)).toMatch(/trop basse.*5/i);
    expect(validateDebtThresholdUpdate(rows, red, 400)).toMatch(/trop élevée.*365/i);
  });

  it("rejects a non-numeric value before it reaches the wire (JSON.stringify(NaN) would write null)", () => {
    const rows = seededRows();
    const yellow = rows.find((r) => r.key === "debt.threshold_yellow_days")!;
    expect(validateDebtThresholdUpdate(rows, yellow, Number.NaN)).toMatch(/nombre/i);
    expect(validateDebtThresholdUpdate(rows, yellow, "abc")).toMatch(/nombre/i);
  });

  it("rejects yellow < grace (the yellow tier would become unreachable)", () => {
    const rows = seededRows();
    const yellow = rows.find((r) => r.key === "debt.threshold_yellow_days")!;
    // yellow 3 < grace 5 → the grace tier absorbs the yellow tier.
    const violation = validateDebtThresholdUpdate(rows, yellow, 3);
    expect(violation).toMatch(/Hiérarchie invalide.*grâce \(5 j\)/);
    expect(violation).toMatch(/3 j/);
  });

  it("rejects red < yellow (the orange tier would be absorbed)", () => {
    const rows = seededRows();
    const red = rows.find((r) => r.key === "debt.threshold_red_days")!;
    // red 10 < yellow 15 → the orange tier is silently gone.
    const violation = validateDebtThresholdUpdate(rows, red, 10);
    expect(violation).toMatch(/Hiérarchie invalide/);
    expect(violation).toMatch(/15 j/);
    expect(violation).toMatch(/10 j/);
  });

  it("validates the SUBSTITUTED value against the other rows' CURRENT values (not the stale row)", () => {
    const rows = seededRows();
    const grace = rows.find((r) => r.key === "debt.grace_period_days")!;
    // grace 20 ≤ yellow 15? NO → rejected.
    expect(validateDebtThresholdUpdate(rows, grace, 20)).toMatch(/Hiérarchie invalide/);
    // The active-payer window is NOT part of the hierarchy — any
    // bound-valid value passes.
    const active = rows.find((r) => r.key === "debt.active_payer_grace_days")!;
    expect(validateDebtThresholdUpdate(rows, active, 90)).toBeNull();
    const yellow = rows.find((r) => r.key === "debt.threshold_yellow_days")!;
    expect(validateDebtThresholdUpdate(rows, yellow, 15)).toBeNull();
  });

  it("passes non-debt categories through untouched (the guard is debt-specific)", () => {
    const other: SystemSetting = {
      ...debtSetting("ai.model", 1, 0, 10),
      category: "ai",
    };
    // Even a hierarchy-violating number on a non-debt row is not this
    // guard's business (the row's own bounds are handled by the input).
    expect(validateDebtThresholdUpdate([other], other, 999)).toBeNull();
  });

  it("the category card config still carries the debt card (the UI entry point)", () => {
    // A light source-scan pin: the "Configuration des Créances" card stays
    // registered so the thresholds remain editable from Settings.
    const cards: readonly CategoryCardConfig[] = CATEGORY_CARDS;
    const debt = cards.find((c) => c.category === "debt");
    expect(debt).toBeDefined();
    expect(debt!.title).toBe("Configuration des Créances");
  });
});
