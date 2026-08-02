/**
 * Characterization tests for `calc/pricing/discounts.ts`,
 * `calc/pricing/tuition.ts`, and `calc/pricing/transport.ts`.
 *
 * Locks in the exact behavior of the extracted pricing calculations.
 */
import { describe, it, expect } from "vitest";
import {
  applyDiscount,
  findDiscountByCode,
  computeSiblingDiscount,
} from "@/domain/calc/pricing/discounts";
import {
  tuitionForGradeLevel,
  tuitionForLevel,
  tuitionTranchesForGrade,
  tuitionTranches,
} from "@/domain/calc/pricing/tuition";
import {
  transportForDestination,
  transportForTier,
  transportTranchesForDestination,
} from "@/domain/calc/pricing/transport";
import type {
  PricingConfig,
  DiscountCode,
} from "@/domain/model/pricing";
import { defaultPricingConfig } from "@/infrastructure/mock/pricing-seed";

/**
 * Build a fresh pricing config for testing. `defaultPricingConfig` is a const
 * value — we clone it so each test gets an independent copy that can be
 * mutated without affecting other tests.
 */
function makeConfig(): PricingConfig {
  // Deep clone via JSON since the config is fully serializable (no functions,
  // no Dates, no Maps).
  return JSON.parse(JSON.stringify(defaultPricingConfig)) as PricingConfig;
}

describe("calc/pricing/discounts", () => {
  describe("applyDiscount", () => {
    it("applies a percentage discount and rounds the result", () => {
      expect(applyDiscount(1000, { amount: 10, discountType: "percentage" })).toBe(900);
    });
    it("applies a 50% discount correctly", () => {
      expect(applyDiscount(1000, { amount: 50, discountType: "percentage" })).toBe(500);
    });
    it("applies a 100% discount (full waiver)", () => {
      expect(applyDiscount(1000, { amount: 100, discountType: "percentage" })).toBe(0);
    });
    it("clamps negative percentage to 0 (no effect)", () => {
      expect(applyDiscount(1000, { amount: -10, discountType: "percentage" })).toBe(1000);
    });
    it("clamps percentage over 100 to 100 (full waiver)", () => {
      expect(applyDiscount(1000, { amount: 150, discountType: "percentage" })).toBe(0);
    });
    it("rounds half-up (10% of 1005 = 100.5 → 101 discount → 904)", () => {
      // 1005 * (1 - 10/100) = 1005 * 0.9 = 904.5 → Math.round = 905
      expect(applyDiscount(1005, { amount: 10, discountType: "percentage" })).toBe(905);
    });
    it("applies a fixed-amount discount (stored as negative)", () => {
      // amount = -500 means "500 DZD off"
      expect(applyDiscount(1000, { amount: -500, discountType: "fixed_amount" })).toBe(500);
    });
    it("clamps fixed-amount discount result at 0 (no negative totals)", () => {
      expect(applyDiscount(300, { amount: -500, discountType: "fixed_amount" })).toBe(0);
    });
    it("treats zero fixed-amount as no discount", () => {
      expect(applyDiscount(1000, { amount: 0, discountType: "fixed_amount" })).toBe(1000);
    });
  });

  describe("findDiscountByCode", () => {
    it("returns the matching discount when it exists and is active", () => {
      const config = makeConfig();
      const result = findDiscountByCode(config, "sibling_fixed");
      expect(result).toBeDefined();
      expect(result?.discountCode).toBe("sibling_fixed");
      expect(result?.isActive).toBe(true);
    });
    it("returns undefined for an inactive discount", () => {
      const config = makeConfig();
      const modified: PricingConfig = {
        ...config,
        discounts: config.discounts.map((d) =>
          d.discountCode === "sibling_fixed" ? { ...d, isActive: false } : d,
        ),
      };
      expect(findDiscountByCode(modified, "sibling_fixed")).toBeUndefined();
    });
    it("returns undefined when the code does not exist in config.discounts", () => {
      const config = makeConfig();
      // Strip all discounts
      const modified: PricingConfig = { ...config, discounts: [] };
      expect(findDiscountByCode(modified, "sibling_fixed")).toBeUndefined();
    });
  });

  describe("computeSiblingDiscount", () => {
    it("returns 0 for 0 children", () => {
      expect(computeSiblingDiscount(makeConfig(), 0)).toBe(0);
    });
    it("returns 0 for 1 child (no siblings)", () => {
      expect(computeSiblingDiscount(makeConfig(), 1)).toBe(0);
    });
    it("returns the sibling_fixed discount × (children - 1)", () => {
      const config = makeConfig();
      const sibling = findDiscountByCode(config, "sibling_fixed");
      expect(sibling).toBeDefined();
      const expected = sibling!.amount * 2; // 3 children → 2 × sibling_fixed
      expect(computeSiblingDiscount(config, 3)).toBe(expected);
    });
    it("returns 0 when the sibling_fixed discount is missing", () => {
      const config = makeConfig();
      const modified: PricingConfig = {
        ...config,
        discounts: config.discounts.filter((d) => d.discountCode !== "sibling_fixed"),
      };
      expect(computeSiblingDiscount(modified, 5)).toBe(0);
    });
  });
});

describe("calc/pricing/tuition", () => {
  describe("tuitionForGradeLevel", () => {
    it("returns the configured tuition for an existing grade level", () => {
      const config = makeConfig();
      const result = tuitionForGradeLevel(config, "prescolaire_1");
      expect(result.annualAmount).toBeGreaterThan(0);
      expect(result.installments).toHaveLength(3);
    });
    it("returns zero pricing for a missing grade level (preserves fallback)", () => {
      const config = makeConfig();
      const partial: Record<string, unknown> = { ...config.tuitionByGradeLevel };
      delete partial["prescolaire_1"];
      const modified: PricingConfig = {
        ...config,
        tuitionByGradeLevel: partial as typeof config.tuitionByGradeLevel,
      };
      const result = tuitionForGradeLevel(modified, "prescolaire_1");
      expect(result.annualAmount).toBe(0);
      expect(result.installments).toEqual([0, 0, 0]);
    });
  });

  describe("tuitionForLevel", () => {
    it("returns the annual amount of the FIRST grade level in the academic level", () => {
      const config = makeConfig();
      const result = tuitionForLevel(config, "primaire");
      expect(result).toBeGreaterThan(0);
    });
  });

  describe("tuitionTranchesForGrade", () => {
    it("returns 3 tranches with the stored per-tranche amounts", () => {
      const config = makeConfig();
      const result = tuitionTranchesForGrade(config, "prescolaire_1");
      expect(result).toHaveLength(3);
      const pricing = tuitionForGradeLevel(config, "prescolaire_1");
      expect(result[0].amountDue).toBe(pricing.installments[0]);
      expect(result[1].amountDue).toBe(pricing.installments[1]);
      expect(result[2].amountDue).toBe(pricing.installments[2]);
    });
    it("uses the FR tranche labels with month ranges", () => {
      const result = tuitionTranchesForGrade(makeConfig(), "prescolaire_1");
      expect(result[0].label).toContain("Tranche 1");
      expect(result[0].label).toContain("Sept");
      expect(result[1].label).toContain("Tranche 2");
      expect(result[2].label).toContain("Tranche 3");
    });
  });

  describe("tuitionTranches (flat total)", () => {
    it("splits 30000 into 3 equal parts of 10000", () => {
      const result = tuitionTranches(30000);
      expect(result).toHaveLength(3);
      expect(result.map((t) => t.amountDue)).toEqual([10000, 10000, 10000]);
    });
    it("puts the remainder in tranche 3 (preserves original rounding)", () => {
      // 10000 / 3 = 3333.33 → round = 3333; last = 10000 - 3333*2 = 3334
      const result = tuitionTranches(10000);
      expect(result.map((t) => t.amountDue)).toEqual([3333, 3333, 3334]);
    });
    it("uses simple 'Tranche N' labels (no month ranges)", () => {
      const result = tuitionTranches(9000);
      expect(result[0].label).toBe("Tranche 1");
      expect(result[1].label).toBe("Tranche 2");
      expect(result[2].label).toBe("Tranche 3");
    });
  });
});

describe("calc/pricing/transport", () => {
  describe("transportForDestination", () => {
    it("returns the configured transport pricing for an existing destination", () => {
      const config = makeConfig();
      const result = transportForDestination(config, "ville_boumerdes");
      expect(result.annualAmount).toBeGreaterThan(0);
      expect(result.installments).toHaveLength(3);
    });
    it("returns zero pricing for a missing destination (preserves fallback)", () => {
      const config = makeConfig();
      const partial: Record<string, unknown> = { ...config.transportByDestination };
      delete partial["ville_boumerdes"];
      const modified: PricingConfig = {
        ...config,
        transportByDestination: partial as typeof config.transportByDestination,
      };
      const result = transportForDestination(modified, "ville_boumerdes");
      expect(result.annualAmount).toBe(0);
      expect(result.installments).toEqual([0, 0, 0]);
    });
  });

  describe("transportForTier (legacy)", () => {
    it("returns the annual amount via the tier→destination mapping", () => {
      const config = makeConfig();
      const t1 = transportForTier(config, "t1");
      expect(t1).toBeGreaterThan(0);
      // t1 should map to "ville_boumerdes" per cityTierToDestination
      expect(t1).toBe(transportForDestination(config, "ville_boumerdes").annualAmount);
    });
    it("returns different amounts for different tiers", () => {
      const config = makeConfig();
      const t1 = transportForTier(config, "t1");
      const t2 = transportForTier(config, "t2");
      const t3 = transportForTier(config, "t3");
      // At least one should be different (depends on config)
      const set = new Set([t1, t2, t3]);
      expect(set.size).toBeGreaterThan(1);
    });
  });

  describe("transportTranchesForDestination", () => {
    it("returns 3 tranches with the stored per-tranche amounts", () => {
      const config = makeConfig();
      const result = transportTranchesForDestination(config, "ville_boumerdes");
      expect(result).toHaveLength(3);
      const pricing = transportForDestination(config, "ville_boumerdes");
      expect(result[0].amountDue).toBe(pricing.installments[0]);
      expect(result[1].amountDue).toBe(pricing.installments[1]);
      expect(result[2].amountDue).toBe(pricing.installments[2]);
    });
    it("uses FR tranche labels with date ranges", () => {
      const result = transportTranchesForDestination(makeConfig(), "ville_boumerdes");
      expect(result[0].label).toContain("inscription");
      expect(result[1].label).toContain("Déc");
      expect(result[2].label).toContain("Mar");
    });
  });
});
