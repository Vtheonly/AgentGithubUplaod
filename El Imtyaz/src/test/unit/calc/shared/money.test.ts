/**
 * Characterization + unit tests for `calc/shared/money.ts`.
 *
 * Coverage target: 100% lines + branches.
 */
import { describe, it, expect } from "vitest";
import {
  absAmount,
  clampNonNegative,
  roundCurrency,
  sumOf,
  amountsApproximatelyEqual,
  splitIntoParts,
} from "@/domain/calc/shared/money";

describe("calc/shared/money", () => {
  describe("absAmount", () => {
    it("returns the absolute value of a negative amount", () => {
      expect(absAmount(-1500)).toBe(1500);
    });
    it("returns the same value for a positive amount", () => {
      expect(absAmount(1500)).toBe(1500);
    });
    it("returns 0 for 0", () => {
      expect(absAmount(0)).toBe(0);
    });
    it("handles -0 by returning 0", () => {
      expect(absAmount(-0)).toBe(0);
    });
  });

  describe("clampNonNegative", () => {
    it("returns the value when positive", () => {
      expect(clampNonNegative(250)).toBe(250);
    });
    it("returns 0 when negative", () => {
      expect(clampNonNegative(-100)).toBe(0);
    });
    it("returns 0 when zero", () => {
      expect(clampNonNegative(0)).toBe(0);
    });
    it("preserves fractional values", () => {
      expect(clampNonNegative(0.5)).toBe(0.5);
    });
  });

  describe("roundCurrency", () => {
    it("rounds 0.5 up to 1 (half-up)", () => {
      expect(roundCurrency(0.5)).toBe(1);
    });
    it("rounds 0.4 down to 0", () => {
      expect(roundCurrency(0.4)).toBe(0);
    });
    it("rounds 1234.567 to 1235", () => {
      expect(roundCurrency(1234.567)).toBe(1235);
    });
    it("rounds -0.5 to 0 (Math.round semantics — preserves original)", () => {
      // Math.round(-0.5) === -0 in JS — preserves pre-refactor behavior.
      expect(Object.is(roundCurrency(-0.5), -0)).toBe(true);
    });
  });

  describe("sumOf", () => {
    it("sums a non-empty list with a field extractor", () => {
      const items = [{ x: 1 }, { x: 2 }, { x: 3 }];
      expect(sumOf(items, (i) => i.x)).toBe(6);
    });
    it("returns 0 for an empty list", () => {
      expect(sumOf([], () => 1)).toBe(0);
    });
    it("skips non-finite extractor results (NaN, Infinity)", () => {
      const items = [{ x: 1 }, { x: NaN }, { x: 2 }, { x: Infinity }, { x: 3 }];
      expect(sumOf(items, (i) => i.x)).toBe(6);
    });
    it("handles negative numbers", () => {
      const items = [{ x: -100 }, { x: 200 }, { x: -50 }];
      expect(sumOf(items, (i) => i.x)).toBe(50);
    });
  });

  describe("amountsApproximatelyEqual", () => {
    it("returns true for exact equality", () => {
      expect(amountsApproximatelyEqual(100, 100)).toBe(true);
    });
    it("returns true within default tolerance (0.01)", () => {
      expect(amountsApproximatelyEqual(100, 100.005)).toBe(true);
    });
    it("returns false outside default tolerance", () => {
      expect(amountsApproximatelyEqual(100, 100.02)).toBe(false);
    });
    it("honors custom tolerance", () => {
      expect(amountsApproximatelyEqual(100, 105, 10)).toBe(true);
      expect(amountsApproximatelyEqual(100, 200, 10)).toBe(false);
    });
    it("handles negative differences symmetrically", () => {
      expect(amountsApproximatelyEqual(-100, -100.005)).toBe(true);
    });
  });

  describe("splitIntoParts", () => {
    it("splits 30000 into 3 equal parts of 10000", () => {
      expect(splitIntoParts(30000, 3)).toEqual([10000, 10000, 10000]);
    });
    it("puts the remainder in the last part (non-even split)", () => {
      // 10000 / 3 = 3333.33 → round = 3333; last = 10000 - 3333*2 = 3334
      expect(splitIntoParts(10000, 3)).toEqual([3333, 3333, 3334]);
    });
    it("returns the full total when count is 1", () => {
      expect(splitIntoParts(9999, 1)).toEqual([9999]);
    });
    it("returns empty array when count is 0", () => {
      expect(splitIntoParts(1000, 0)).toEqual([]);
    });
    it("returns empty array when count is negative", () => {
      expect(splitIntoParts(1000, -3)).toEqual([]);
    });
    it("handles 4 parts correctly", () => {
      // 10000 / 4 = 2500; last = 10000 - 2500*3 = 2500
      expect(splitIntoParts(10000, 4)).toEqual([2500, 2500, 2500, 2500]);
    });
    it("preserves rounding remainder in last part for 7 parts", () => {
      // 1000 / 7 = 142.857 → round = 143; last = 1000 - 143*6 = 142
      expect(splitIntoParts(1000, 7)).toEqual([143, 143, 143, 143, 143, 143, 142]);
    });
  });
});
