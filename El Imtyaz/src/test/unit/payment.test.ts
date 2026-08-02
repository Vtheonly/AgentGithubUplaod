/**
 * Unit tests for payment domain logic.
 *
 * Covers:
 *   - agingBucketFromDays — 5-bucket debt aging classification
 *   - proofRequiredFor   — Check + Transfer require proof, Cash does not
 *
 * Plan §07 + §18.03: non-cash payments require proof scan (mandatory).
 * Plan §07.03: 5-bucket aging classification for outstanding debt.
 */
import { describe, it, expect } from "vitest";
import {
  agingBucketFromDays,
  proofRequiredFor,
} from "../../domain/model/payment";

describe("agingBucketFromDays", () => {
  it("classifies 0 days as 0_30 bucket", () => {
    expect(agingBucketFromDays(0)).toBe("0_30");
  });

  it("classifies 30 days as 0_30 bucket (boundary inclusive)", () => {
    expect(agingBucketFromDays(30)).toBe("0_30");
  });

  it("classifies 31 days as 31_60 bucket", () => {
    expect(agingBucketFromDays(31)).toBe("31_60");
  });

  it("classifies 60 days as 31_60 bucket (boundary inclusive)", () => {
    expect(agingBucketFromDays(60)).toBe("31_60");
  });

  it("classifies 61 days as 61_90 bucket", () => {
    expect(agingBucketFromDays(61)).toBe("61_90");
  });

  it("classifies 90 days as 61_90 bucket (boundary inclusive)", () => {
    expect(agingBucketFromDays(90)).toBe("61_90");
  });

  it("classifies 91 days as 91_180 bucket", () => {
    expect(agingBucketFromDays(91)).toBe("91_180");
  });

  it("classifies 180 days as 91_180 bucket (boundary inclusive)", () => {
    expect(agingBucketFromDays(180)).toBe("91_180");
  });

  it("classifies 181+ days as 180_plus bucket", () => {
    expect(agingBucketFromDays(181)).toBe("180_plus");
    expect(agingBucketFromDays(365)).toBe("180_plus");
    expect(agingBucketFromDays(9999)).toBe("180_plus");
  });

  it("handles negative days as 0_30 (defensive)", () => {
    // Negative days shouldn't happen in production, but the function should
    // still return a valid bucket rather than throw.
    expect(agingBucketFromDays(-1)).toBe("0_30");
    expect(agingBucketFromDays(-100)).toBe("0_30");
  });
});

describe("proofRequiredFor", () => {
  it("returns false for cash payments", () => {
    expect(proofRequiredFor("cash")).toBe(false);
  });

  it("returns true for check payments (plan §18.03)", () => {
    expect(proofRequiredFor("check")).toBe(true);
  });

  it("returns true for transfer payments (plan §18.03)", () => {
    expect(proofRequiredFor("transfer")).toBe(true);
  });

  it("covers all three payment methods (exhaustive)", () => {
    // Plan §07: exactly 3 methods — no 4th "CUSTOM" allowed.
    const allMethods: Array<"cash" | "check" | "transfer"> = [
      "cash",
      "check",
      "transfer",
    ];
    for (const m of allMethods) {
      expect(typeof proofRequiredFor(m)).toBe("boolean");
    }
  });
});
