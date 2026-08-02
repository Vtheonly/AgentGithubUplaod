/**
 * Unit tests for pricing domain logic.
 *
 * Iteration 6: Updated for the new pricing model — per-grade-level tuition
 * (14 grades) and per-destination transport (4 named zones), each with their
 * own 3-tranche schedule. New tests cover:
 *   - tuitionForGradeLevel — grade-level lookup with non-equal tranche split
 *   - tuitionTranchesForGrade — 3-tranche schedule with specific due dates
 *   - transportForDestination — destination-based lookup
 *   - transportTranchesForDestination — destination-specific tranche schedule
 *   - computeSiblingDiscount — fixed-amount sibling discount accumulation
 *   - findDiscountByCode — canonical discount code lookup
 *   - applyDiscount — percentage and fixed-amount discounts
 *   - tuitionTranches — legacy equal-split helper (still used by some callers)
 *   - tuitionForLevel — legacy level-based lookup (delegates to first grade)
 *   - transportForTier — legacy tier-based lookup (delegates to destination)
 *
 * Plan §"Administration": "All pricing must be configurable by administrators.
 * Never hardcode payment values."
 */
import { describe, it, expect } from "vitest";
import {
  tuitionForLevel,
  tuitionForGradeLevel,
  tuitionTranches,
  tuitionTranchesForGrade,
  transportForTier,
  transportForDestination,
  transportTranchesForDestination,
  applyDiscount,
  findDiscountByCode,
  computeSiblingDiscount,
  type PricingConfig,
  type PricingEntry,
  type DiscountCode,
} from "../../domain/model/pricing";
import { GRADE_LEVELS, type GradeLevel } from "../../domain/model/student";
import { TRANSPORT_DESTINATIONS, type TransportDestination } from "../../domain/model/parent";

/**
 * Build a config with the OFFICIAL 2026-2027 fee schedule values
 * for the relevant subset (prescolaire_1, 1ap, 1am, 1ere_annee + all 4 transport destinations).
 */
function makeOfficialConfig(overrides: Partial<PricingConfig> = {}): PricingConfig {
  const tuitionByGradeLevel = {} as Record<GradeLevel, { annualAmount: number; installments: readonly [number, number, number] }>;
  for (const g of GRADE_LEVELS) {
    tuitionByGradeLevel[g] = { annualAmount: 100_000, installments: [40_000, 30_000, 30_000] };
  }
  // Override with the official 2026-2027 values for the grades we test.
  tuitionByGradeLevel.prescolaire_1 = { annualAmount: 130_000, installments: [52_000, 39_000, 39_000] };
  tuitionByGradeLevel["1ap"] = { annualAmount: 245_000, installments: [98_000, 73_500, 73_500] };
  tuitionByGradeLevel["1am"] = { annualAmount: 330_000, installments: [132_000, 99_000, 99_000] };
  tuitionByGradeLevel["1ere_annee"] = { annualAmount: 375_000, installments: [150_000, 112_500, 112_500] };

  const transportByDestination = {} as Record<TransportDestination, { annualAmount: number; installments: readonly [number, number, number] }>;
  transportByDestination.ville_boumerdes = { annualAmount: 40_000, installments: [20_000, 10_000, 10_000] };
  transportByDestination.tidjelabine_sahel_figuier_corso = { annualAmount: 43_000, installments: [20_000, 13_000, 10_000] };
  transportByDestination.boudouaou_thenia_zemmouri = { annualAmount: 52_000, installments: [30_000, 12_000, 10_000] };
  transportByDestination.autres = { annualAmount: 55_000, installments: [30_000, 15_000, 10_000] };

  const discounts: PricingEntry[] = [
    {
      id: "disc-passage-palier",
      tenantId: "test-tenant",
      category: "discount",
      qualifier: "passage_palier",
      label: "Passage de palier (−10 000 DA)",
      amount: -10_000,
      discountType: "fixed_amount",
      discountCode: "passage_palier",
      isActive: true,
      updatedAt: new Date().toISOString(),
      updatedBy: "test",
    },
    {
      id: "disc-seniority",
      tenantId: "test-tenant",
      category: "discount",
      qualifier: "seniority_5y",
      label: "Ancienneté > 5 ans (−5%)",
      amount: 5,
      discountType: "percentage",
      discountCode: "seniority_5y",
      isActive: true,
      updatedAt: new Date().toISOString(),
      updatedBy: "test",
    },
    {
      id: "disc-sibling",
      tenantId: "test-tenant",
      category: "discount",
      qualifier: "sibling_fixed",
      label: "Fratrie — par enfant supplémentaire (−5 000 DA)",
      amount: -5_000,
      discountType: "fixed_amount",
      discountCode: "sibling_fixed",
      isActive: true,
      updatedAt: new Date().toISOString(),
      updatedBy: "test",
    },
  ];

  return {
    tuitionByGradeLevel,
    transportByDestination,
    registrationFee: 5_000,
    monthlyByLevel: { primaire: 6_000, cem: 6_800, lycee: 7_800 },
    latePenaltyPerDay: 100,
    discounts,
    additionalServices: [],
    complementaryServices: [],
    secondApronFee: 2_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// tuitionForGradeLevel — grade-level lookup
// ---------------------------------------------------------------------------
describe("tuitionForGradeLevel", () => {
  it("returns the configured tuition for prescolaire_1 (130 000 DA)", () => {
    const cfg = makeOfficialConfig();
    const result = tuitionForGradeLevel(cfg, "prescolaire_1");
    expect(result.annualAmount).toBe(130_000);
    expect(result.installments).toEqual([52_000, 39_000, 39_000]);
  });

  it("returns the configured tuition for 1AP (245 000 DA)", () => {
    const cfg = makeOfficialConfig();
    expect(tuitionForGradeLevel(cfg, "1ap").annualAmount).toBe(245_000);
  });

  it("returns the configured tuition for 1AM (330 000 DA)", () => {
    const cfg = makeOfficialConfig();
    expect(tuitionForGradeLevel(cfg, "1am").annualAmount).toBe(330_000);
  });

  it("returns the configured tuition for 1ère Année (375 000 DA)", () => {
    const cfg = makeOfficialConfig();
    expect(tuitionForGradeLevel(cfg, "1ere_annee").annualAmount).toBe(375_000);
  });

  it("returns 0 for an unknown grade (defensive)", () => {
    const cfg = makeOfficialConfig();
    cfg.tuitionByGradeLevel["1ap"] = { annualAmount: 0, installments: [0, 0, 0] };
    expect(tuitionForGradeLevel(cfg, "1ap").annualAmount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// tuitionTranchesForGrade — 3-tranche schedule
// ---------------------------------------------------------------------------
describe("tuitionTranchesForGrade", () => {
  it("returns 3 tranches for prescolaire_1 with the official split (52k + 39k + 39k)", () => {
    const cfg = makeOfficialConfig();
    const tranches = tuitionTranchesForGrade(cfg, "prescolaire_1");
    expect(tranches).toHaveLength(3);
    expect(tranches[0]).toEqual({ label: "Tranche 1 (Sept–Déc)", amountDue: 52_000 });
    expect(tranches[1]).toEqual({ label: "Tranche 2 (Jan–Mar)", amountDue: 39_000 });
    expect(tranches[2]).toEqual({ label: "Tranche 3 (Avr–Juin)", amountDue: 39_000 });
  });

  it("the sum of tranches equals the annual amount (no rounding loss)", () => {
    const cfg = makeOfficialConfig();
    for (const g of GRADE_LEVELS) {
      const tranches = tuitionTranchesForGrade(cfg, g);
      const sum = tranches.reduce((s, t) => s + t.amountDue, 0);
      expect(sum).toBe(cfg.tuitionByGradeLevel[g].annualAmount);
    }
  });

  it("returns 0s for an unconfigured grade (defensive)", () => {
    const cfg = makeOfficialConfig();
    cfg.tuitionByGradeLevel["5ap"] = { annualAmount: 0, installments: [0, 0, 0] };
    const tranches = tuitionTranchesForGrade(cfg, "5ap");
    expect(tranches.every((t) => t.amountDue === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// transportForDestination + transportTranchesForDestination
// ---------------------------------------------------------------------------
describe("transportForDestination", () => {
  it("returns Ville Boumerdès pricing (40 000 DA, 20k+10k+10k)", () => {
    const cfg = makeOfficialConfig();
    const r = transportForDestination(cfg, "ville_boumerdes");
    expect(r.annualAmount).toBe(40_000);
    expect(r.installments).toEqual([20_000, 10_000, 10_000]);
  });

  it("returns Tidjelabine pricing (43 000 DA, 20k+13k+10k)", () => {
    const cfg = makeOfficialConfig();
    const r = transportForDestination(cfg, "tidjelabine_sahel_figuier_corso");
    expect(r.annualAmount).toBe(43_000);
    expect(r.installments).toEqual([20_000, 13_000, 10_000]);
  });

  it("returns Boudouaou pricing (52 000 DA, 30k+12k+10k)", () => {
    const cfg = makeOfficialConfig();
    const r = transportForDestination(cfg, "boudouaou_thenia_zemmouri");
    expect(r.annualAmount).toBe(52_000);
    expect(r.installments).toEqual([30_000, 12_000, 10_000]);
  });

  it("returns Autres pricing (55 000 DA, 30k+15k+10k)", () => {
    const cfg = makeOfficialConfig();
    const r = transportForDestination(cfg, "autres");
    expect(r.annualAmount).toBe(55_000);
    expect(r.installments).toEqual([30_000, 15_000, 10_000]);
  });
});

describe("transportTranchesForDestination", () => {
  it("returns 3 tranches for each destination with proper labels", () => {
    const cfg = makeOfficialConfig();
    for (const d of TRANSPORT_DESTINATIONS) {
      const tranches = transportTranchesForDestination(cfg, d);
      expect(tranches).toHaveLength(3);
      expect(tranches[0].label).toContain("Tranche 1");
      expect(tranches[1].label).toContain("01 Déc");
      expect(tranches[2].label).toContain("01 Mar");
      // Sum equals annual.
      const sum = tranches.reduce((s, t) => s + t.amountDue, 0);
      expect(sum).toBe(cfg.transportByDestination[d].annualAmount);
    }
  });

  it("preserves the 3-tranche schedule with non-equal splits (Tidjelabine: 20k+13k+10k)", () => {
    const cfg = makeOfficialConfig();
    const tranches = transportTranchesForDestination(cfg, "tidjelabine_sahel_figuier_corso");
    expect(tranches.map((t) => t.amountDue)).toEqual([20_000, 13_000, 10_000]);
  });
});

// ---------------------------------------------------------------------------
// Legacy helpers — kept for backward-compat
// ---------------------------------------------------------------------------
describe("tuitionForLevel (legacy)", () => {
  it("returns the first grade level's annual tuition within an academic level", () => {
    const cfg = makeOfficialConfig();
    // primaire's first grade is prescolaire_1 → 130 000 DA
    expect(tuitionForLevel(cfg, "primaire")).toBe(130_000);
  });
});

describe("transportForTier (legacy)", () => {
  it("maps t1 → ville_boumerdes and returns its annual amount", () => {
    const cfg = makeOfficialConfig();
    expect(transportForTier(cfg, "t1")).toBe(40_000);
  });

  it("maps t2 → tidjelabine_sahel_figuier_corso and returns its annual amount", () => {
    const cfg = makeOfficialConfig();
    expect(transportForTier(cfg, "t2")).toBe(43_000);
  });

  it("maps t3 → boudouaou_thenia_zemmouri and returns its annual amount", () => {
    const cfg = makeOfficialConfig();
    expect(transportForTier(cfg, "t3")).toBe(52_000);
  });
});

// ---------------------------------------------------------------------------
// tuitionTranches — legacy equal-split helper
// ---------------------------------------------------------------------------
describe("tuitionTranches (legacy equal-split)", () => {
  it("splits an amount into 3 equal tranches when divisible by 3", () => {
    const tranches = tuitionTranches(30_000);
    expect(tranches).toHaveLength(3);
    expect(tranches[0].amountDue).toBe(10_000);
    expect(tranches[1].amountDue).toBe(10_000);
    expect(tranches[2].amountDue).toBe(10_000);
  });

  it("places the remainder in the third tranche when not divisible by 3", () => {
    const tranches = tuitionTranches(22_000);
    expect(tranches).toHaveLength(3);
    expect(tranches[0].amountDue).toBe(7333);
    expect(tranches[1].amountDue).toBe(7333);
    expect(tranches[2].amountDue).toBe(22_000 - 7333 * 2);
  });

  it("preserves the total amount exactly (regression test)", () => {
    for (const total of [1, 100, 999, 1_000, 9_999, 18_000, 22_000, 26_000, 99_999, 245_000, 375_000]) {
      const tranches = tuitionTranches(total);
      const sum = tranches.reduce((s, t) => s + t.amountDue, 0);
      expect(sum).toBe(total);
    }
  });

  it("handles 0 amount", () => {
    const tranches = tuitionTranches(0);
    expect(tranches.every((t) => t.amountDue === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findDiscountByCode + computeSiblingDiscount
// ---------------------------------------------------------------------------
describe("findDiscountByCode", () => {
  it("finds the passage_palier discount", () => {
    const cfg = makeOfficialConfig();
    const d = findDiscountByCode(cfg, "passage_palier");
    expect(d).toBeDefined();
    expect(d?.amount).toBe(-10_000);
    expect(d?.discountType).toBe("fixed_amount");
  });

  it("finds the seniority_5y discount", () => {
    const cfg = makeOfficialConfig();
    const d = findDiscountByCode(cfg, "seniority_5y");
    expect(d).toBeDefined();
    expect(d?.amount).toBe(5);
    expect(d?.discountType).toBe("percentage");
  });

  it("returns undefined for an unknown code", () => {
    const cfg = makeOfficialConfig();
    expect(findDiscountByCode(cfg, "custom" as DiscountCode)).toBeUndefined();
  });

  it("skips inactive discounts", () => {
    const baseCfg = makeOfficialConfig();
    const cfg = makeOfficialConfig({
      discounts: baseCfg.discounts.map((d) =>
        d.discountCode === "passage_palier" ? { ...d, isActive: false } : d,
      ),
    });
    expect(findDiscountByCode(cfg, "passage_palier")).toBeUndefined();
  });
});

describe("computeSiblingDiscount", () => {
  it("returns 0 for a single child", () => {
    const cfg = makeOfficialConfig();
    expect(computeSiblingDiscount(cfg, 1)).toBe(0);
  });

  it("returns 0 for 0 children (defensive)", () => {
    const cfg = makeOfficialConfig();
    expect(computeSiblingDiscount(cfg, 0)).toBe(0);
  });

  it("returns -5 000 DA for 2 children (1 additional)", () => {
    const cfg = makeOfficialConfig();
    expect(computeSiblingDiscount(cfg, 2)).toBe(-5_000);
  });

  it("returns -10 000 DA for 3 children (2 additional)", () => {
    const cfg = makeOfficialConfig();
    expect(computeSiblingDiscount(cfg, 3)).toBe(-10_000);
  });

  it("returns -25 000 DA for 6 children (5 additional)", () => {
    const cfg = makeOfficialConfig();
    expect(computeSiblingDiscount(cfg, 6)).toBe(-25_000);
  });

  it("returns 0 when the sibling_fixed discount is not configured", () => {
    const baseCfg = makeOfficialConfig();
    const cfg = makeOfficialConfig({
      discounts: baseCfg.discounts.filter((d) => d.discountCode !== "sibling_fixed"),
    });
    expect(computeSiblingDiscount(cfg, 3)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// applyDiscount
// ---------------------------------------------------------------------------
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
    expect(applyDiscount(10_000, { amount: -1_500, discountType: "fixed_amount" })).toBe(8_500);
  });

  it("does not let fixed-amount discount push the total below 0 (defensive)", () => {
    expect(applyDiscount(1_000, { amount: -5_000, discountType: "fixed_amount" })).toBe(0);
  });

  it("handles a 0 fixed-amount discount (no change)", () => {
    expect(applyDiscount(10_000, { amount: 0, discountType: "fixed_amount" })).toBe(10_000);
  });

  it("applies the passage_palier discount (-10 000 DA) to a 245 000 DA tuition", () => {
    // 245 000 + (-10 000) = 235 000
    expect(applyDiscount(245_000, { amount: -10_000, discountType: "fixed_amount" })).toBe(235_000);
  });

  it("applies the seniority_5y discount (-5%) to a 245 000 DA tuition", () => {
    // 245 000 * (1 - 5/100) = 245 000 * 0.95 = 232 750
    expect(applyDiscount(245_000, { amount: 5, discountType: "percentage" })).toBe(232_750);
  });

  it("applies the full_annual discount (-10%) to a 245 000 DA tuition", () => {
    // 245 000 * (1 - 10/100) = 245 000 * 0.90 = 220 500
    expect(applyDiscount(245_000, { amount: 10, discountType: "percentage" })).toBe(220_500);
  });
});
