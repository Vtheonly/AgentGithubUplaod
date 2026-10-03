/**
 * T-469 — the configurable AMOUNT thresholds + per-level messages
 * (DEBT-103), the regression suite.
 *
 * THE MANDATE (the owner's issue): "if we configure a particular debt
 * threshold as: Green: below X, Yellow: X–Y, Red: above Y then Year
 * Tracking, Finance, Dashboard, filters, and every other relevant view must
 * use the same configuration when evaluating that metric… There should also
 * be a configurable message/template associated with each risk level."
 *
 * What this pins:
 *   - the canonical classifyOutstandingAmount boundary matrix (the SAME
 *     thresholds object the day engine consumes — never a page hardcode);
 *   - the configured-level-message resolver (empty = the canonical engine
 *     text stands; configured = extends it);
 *   - the mock repository's extended threshold contract (the defaults the
 *     surfaces degrade to);
 *   - the settings edit path's AMOUNT hierarchy validation (0 ≤ yellow ≤
 *     red — the INV-16a discipline applied to the amount axis).
 */
import { describe, expect, it } from "vitest";

import {
  classifyOutstandingAmount,
  configuredLevelMessage,
  DEFAULT_DEBT_AGING_THRESHOLDS,
  type DebtAgingThresholds,
} from "../../../domain/calc/ledger/debt-aging";
import { validateDebtThresholdUpdate } from "../../../features/settings/configuration/category-cards";
import { mockDebtRepository } from "../../../infrastructure/mock/mock-repositories";
import type { SystemSetting } from "../../../infrastructure/system-config";

/* ============================================================ */
/*  1 — the canonical amount classification's boundary matrix    */
/* ============================================================ */

describe("T-469 — classifyOutstandingAmount (the canonical amount bands)", () => {
  const T: DebtAgingThresholds = {
    gracePeriodDays: 5,
    yellowDays: 15,
    redDays: 60,
    activePayerGraceDays: 15,
    amountYellowDzd: 20_000,
    amountRedDzd: 60_000,
  };

  it("green strictly below the yellow edge; yellow AT the edge (>=); red strictly above the red edge", () => {
    expect(classifyOutstandingAmount(19_999.99, T)).toBe("green");
    expect(classifyOutstandingAmount(20_000, T)).toBe("yellow");
    expect(classifyOutstandingAmount(60_000, T)).toBe("yellow");
    expect(classifyOutstandingAmount(60_000.01, T)).toBe("red");
    expect(classifyOutstandingAmount(1_000_000, T)).toBe("red");
  });

  it("0 DISABLES an edge (the documented semantics — never a silent zero-band)", () => {
    expect(classifyOutstandingAmount(500_000, { ...T, amountYellowDzd: 0, amountRedDzd: 0 })).toBe("green");
    expect(classifyOutstandingAmount(500_000, { ...T, amountYellowDzd: 0 })).toBe("red");
    expect(classifyOutstandingAmount(500_000, { ...T, amountRedDzd: 0 })).toBe("yellow");
  });

  it("absent edges degrade to green (the pre-0138 payload — honest, never a fabricated band)", () => {
    expect(classifyOutstandingAmount(999_999, {})).toBe("green");
  });

  it("the amount dimension is INDEPENDENT of the day dimension (neither masks the other)", () => {
    // A small very-late debt: day-RED / amount-GREEN.
    expect(classifyOutstandingAmount(3_000, T)).toBe("green");
    // A large fresh debt: day-GREEN / amount-RED.
    expect(classifyOutstandingAmount(90_000, T)).toBe("red");
  });

  it("the documented DEFAULTS carry the 0138 seed edges (20 000 / 60 000)", () => {
    expect(DEFAULT_DEBT_AGING_THRESHOLDS.amountYellowDzd).toBe(20_000);
    expect(DEFAULT_DEBT_AGING_THRESHOLDS.amountRedDzd).toBe(60_000);
    expect(DEFAULT_DEBT_AGING_THRESHOLDS.levelMessages).toEqual({});
  });
});

/* ============================================================ */
/*  2 — the configured per-level messages                       */
/* ============================================================ */

describe("T-469 — configuredLevelMessage (the per-level templates)", () => {
  it("null when not configured (the canonical engine explanation STANDS)", () => {
    expect(configuredLevelMessage("red", DEFAULT_DEBT_AGING_THRESHOLDS)).toBeNull();
    expect(configuredLevelMessage("red", {})).toBeNull();
    expect(configuredLevelMessage("red", { levelMessages: { red: "   " } })).toBeNull();
  });

  it("the configured message EXTENDS (never replaces) — one resolver, every level", () => {
    const t: DebtAgingThresholds = {
      ...DEFAULT_DEBT_AGING_THRESHOLDS,
      levelMessages: {
        green: "Compte à jour.",
        yellow: "Surveiller le prochain versement.",
        orange: "Relance téléphonique recommandée.",
        red: "Contentieux — convoquer la famille.",
      },
    };
    expect(configuredLevelMessage("green", t)).toBe("Compte à jour.");
    expect(configuredLevelMessage("yellow", t)).toBe("Surveiller le prochain versement.");
    expect(configuredLevelMessage("orange", t)).toBe("Relance téléphonique recommandée.");
    expect(configuredLevelMessage("red", t)).toBe("Contentieux — convoquer la famille.");
  });
});

/* ============================================================ */
/*  3 — the mock repository's extended threshold contract        */
/* ============================================================ */

describe("T-469 — the mock observeThresholds carries the extended contract", () => {
  it("emits the amount edges + the empty messages (the documented defaults)", () => {
    const t = mockDebtRepository.observeThresholds().get();
    expect(t.amountYellowDzd).toBe(20_000);
    expect(t.amountRedDzd).toBe(60_000);
    expect(t.levelMessages).toEqual({});
    // The day-dimension fields are untouched (the T-443 contract).
    expect(t.gracePeriodDays).toBe(5);
    expect(t.yellowDays).toBe(15);
    expect(t.redDays).toBe(60);
    expect(t.activePayerGraceDays).toBe(15);
  });
});

/* ============================================================ */
/*  4 — the settings edit path's AMOUNT hierarchy validation     */
/* ============================================================ */

describe("T-469 — validateDebtThresholdUpdate's amount hierarchy (0 ≤ yellow ≤ red)", () => {
  function debtSetting(key: string, value: number): SystemSetting {
    return {
      id: `set-${key}`,
      tenantId: "t-1",
      category: "debt",
      key,
      label_fr: key,
      label_en: key,
      description_fr: null,
      valueType: "number",
      value,
      isSensitive: false,
      isRequired: true,
      sortOrder: 0,
      validationMin: 0,
      validationMax: 100_000_000,
    } as unknown as SystemSetting;
  }

  const SETTINGS: SystemSetting[] = [
    debtSetting("debt.grace_period_days", 5),
    debtSetting("debt.threshold_yellow_days", 15),
    debtSetting("debt.threshold_red_days", 60),
    debtSetting("debt.active_payer_grace_days", 15),
    debtSetting("debt.amount_threshold_yellow_dzd", 20_000),
    debtSetting("debt.amount_threshold_red_dzd", 60_000),
  ];

  it("a VALID amount update passes (yellow stays ≤ red)", () => {
    const violation = validateDebtThresholdUpdate(
      SETTINGS,
      debtSetting("debt.amount_threshold_yellow_dzd", 20_000),
      30_000,
    );
    expect(violation).toBeNull();
  });

  it("yellow ABOVE red is refused (the no-gap partition on the amount axis)", () => {
    const violation = validateDebtThresholdUpdate(
      SETTINGS,
      debtSetting("debt.amount_threshold_yellow_dzd", 20_000),
      70_000,
    );
    expect(violation).toContain("Hiérarchie invalide");
    expect(violation).toContain("70 000");
  });

  it("red BELOW yellow is refused", () => {
    const violation = validateDebtThresholdUpdate(
      SETTINGS,
      debtSetting("debt.amount_threshold_red_dzd", 60_000),
      10_000,
    );
    expect(violation).toContain("Hiérarchie invalide");
  });

  it("0 stays LEGAL (the edge-disabled semantics) and the day hierarchy still gates", () => {
    expect(
      validateDebtThresholdUpdate(SETTINGS, debtSetting("debt.amount_threshold_red_dzd", 60_000), 0),
    ).toBeNull();
    const dayViolation = validateDebtThresholdUpdate(
      SETTINGS,
      debtSetting("debt.threshold_red_days", 60),
      10,
    );
    expect(dayViolation).toContain("INV-16a");
  });
});
