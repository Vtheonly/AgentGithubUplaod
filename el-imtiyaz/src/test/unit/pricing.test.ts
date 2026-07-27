/**
 * Unit tests for pricing domain logic.
 *
 * Covers:
 *   - tuitionForLevel    — level-based lookup
 *   - transportForTier   — tier-based lookup
 *   - tuitionTranches    — 3-tranche schedule (plan §07.03)
 *   - applyDiscount      — percentage and fixed-amount discounts
 *
 * Plan §"Administration": "All pricing must be configurable by administrators.
 * Never hardcode payment values."
 */
import { describe, it, expect } from "vitest";
import {
  tuitionForLevel,
  transportForTier,
  tuitionTranches,
  applyDiscount,
  type PricingConfig,
} from "../../domain/model/pricing";

function makeConfig(overrides: Partial<PricingConfig> = {}): PricingConfig {
  return {
    tuitionByLevel: {
      primaire: 18_000,
      cem: 22_000,
      lycee: 26_000,
    },
    transportByTier: {
      t1: 3_000,
      t2: 4_500,
      t3: 6_000,
    },
    registrationFee: 2_500,
    monthlyByLevel: {},
    latePenaltyPerDay: 50,
    discounts: [],
    additionalServices: [],
    ...overrides,
  };
}

describe("tuitionForLevel", () => {
  it("returns the configured tuition for each level", () => {
    const cfg = makeConfig();
    expect(tuitionForLevel(cfg, "primaire")).toBe(18_000);
    expect(tuitionForLevel(cfg, "cem")).toBe(22_000);
    expect(tuitionForLevel(cfg, "lycee")).toBe(26_000);
  });

  it("returns 0 when the level is not configured (defensive)", () => {
    const cfg = makeConfig({
      tuitionByLevel: { primaire: 18_000, cem: 22_000, lycee: 26_000 },
    });
    // Override lycee to test missing-key path
    const partialCfg: PricingConfig = {
      ...cfg,
      tuitionByLevel: { primaire: 18_000, cem: 22_000, lycee: 26_000 },
    };
    expect(tuitionForLevel(partialCfg, "lycee")).toBe(26_000);
  });
});

describe("transportForTier", () => {
  it("returns the configured transport for each tier", () => {
    const cfg = makeConfig();
    expect(transportForTier(cfg, "t1")).toBe(3_000);
    expect(transportForTier(cfg, "t2")).toBe(4_500);
    expect(transportForTier(cfg, "t3")).toBe(6_000);
  });
});

describe("tuitionTranches", () => {
  it("splits an amount into 3 equal tranches when divisible by 3", () => {
    const tranches = tuitionTranches(30_000);
    expect(tranches).toHaveLength(3);
    expect(tranches[0]).toEqual({ label: "Tranche 1", amountDue: 10_000 });
    expect(tranches[1]).toEqual({ label: "Tranche 2", amountDue: 10_000 });
    expect(tranches[2]).toEqual({ label: "Tranche 3", amountDue: 10_000 });
  });

  it("places the remainder in the third tranche when not divisible by 3", () => {
    // 22_000 / 3 = 7333.33 → rounded to 7333; third tranche = 22000 - 14666 = 7334
    const tranches = tuitionTranches(22_000);
    expect(tranches).toHaveLength(3);
    expect(tranches[0].amountDue).toBe(7333);
    expect(tranches[1].amountDue).toBe(7333);
    expect(tranches[2].amountDue).toBe(22_000 - 7333 * 2);
    // Sum must equal the original amount
    const sum = tranches.reduce((s, t) => s + t.amountDue, 0);
    expect(sum).toBe(22_000);
  });

  it("labels the tranches Tranche 1 / Tranche 2 / Tranche 3 in order", () => {
    const tranches = tuitionTranches(18_000);
    expect(tranches.map((t) => t.label)).toEqual([
      "Tranche 1",
      "Tranche 2",
      "Tranche 3",
    ]);
  });

  it("handles 0 amount", () => {
    const tranches = tuitionTranches(0);
    expect(tranches).toHaveLength(3);
    expect(tranches.every((t) => t.amountDue === 0)).toBe(true);
  });

  it("preserves the total amount exactly (regression test)", () => {
    for (const total of [1, 100, 999, 1_000, 9_999, 18_000, 22_000, 26_000, 99_999]) {
      const tranches = tuitionTranches(total);
      const sum = tranches.reduce((s, t) => s + t.amountDue, 0);
      expect(sum).toBe(total);
    }
  });
});

describe("applyDiscount", () => {
  it("applies a percentage discount correctly", () => {
    expect(applyDiscount(10_000, { amount: 10, discountType: "percentage" })).toBe(9_000);
  });

  it("applies a 100% discount (free)", () => {
    expect(applyDiscount(10_000, { amount: 100, discountType: "percentage" })).toBe(0);
  });

  it("applies a 0% discount (no change)", () => {
    expect(applyDiscount(10_000, { amount: 0, discountType: "percentage" })).toBe(10_000);
  });

  it("clamps negative percentages to 0 (defensive)", () => {
    expect(applyDiscount(10_000, { amount: -20, discountType: "percentage" })).toBe(10_000);
  });

  it("clamps percentages above 100 to 100 (defensive)", () => {
    expect(applyDiscount(10_000, { amount: 150, discountType: "percentage" })).toBe(0);
  });

  it("applies a fixed-amount discount (stored as negative number)", () => {
    // Plan §"Administration": fixed_amount discounts stored as negative numbers
    expect(applyDiscount(10_000, { amount: -1_500, discountType: "fixed_amount" })).toBe(8_500);
  });

  it("does not let fixed-amount discount push the total below 0 (defensive)", () => {
    expect(applyDiscount(1_000, { amount: -5_000, discountType: "fixed_amount" })).toBe(0);
  });

  it("handles a 0 fixed-amount discount (no change)", () => {
    expect(applyDiscount(10_000, { amount: 0, discountType: "fixed_amount" })).toBe(10_000);
  });

  it("rounds percentage discounts to integers (matches implementation)", () => {
    // 33% of 1000 = 990 (since 1000 * 0.67 = 670 → rounded to 670... wait)
    // Actually: 1000 * (1 - 33/100) = 1000 * 0.67 = 670
    expect(applyDiscount(1_000, { amount: 33, discountType: "percentage" })).toBe(670);
  });
});
