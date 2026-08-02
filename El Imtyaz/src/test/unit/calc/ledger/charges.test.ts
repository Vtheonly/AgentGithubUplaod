/**
 * Characterization tests for `calc/ledger/charges.ts`.
 *
 * Verifies the multi-entry charge builders produce the same outputs as
 * the original implementations in `domain/model/ledger.ts`.
 */
import { describe, it, expect } from "vitest";
import {
  buildTuitionChargeEntries,
  buildTransportChargeEntry,
  buildTransportChargeEntriesForDestination,
} from "@/domain/calc/ledger/charges";
import { defaultPricingConfig } from "@/infrastructure/mock/pricing-seed";
import { tuitionForGradeLevel, tuitionForLevel } from "@/domain/calc/pricing/tuition";
import { transportForDestination, transportForTier } from "@/domain/calc/pricing/transport";
import { applyDiscount } from "@/domain/calc/pricing/discounts";
import type { LedgerEntry } from "@/domain/model/ledger";

const TENANT = "tenant-1";
const DUE_DATES: [string, string, string] = [
  "2025-09-15T00:00:00.000Z",
  "2025-12-15T00:00:00.000Z",
  "2026-03-15T00:00:00.000Z",
];

describe("calc/ledger/charges — buildTuitionChargeEntries", () => {
  it("builds 3 charge entries for a 3-tranche tuition schedule (grade-level pricing)", () => {
    const config = defaultPricingConfig; // const value, not a function
    const entries = buildTuitionChargeEntries({
      tenantId: TENANT, parentId: "p1", studentId: "s1",
      level: "primaire", gradeLevel: "prescolaire_1",
      config, academicYear: "2025-2026",
      trancheDueDates: DUE_DATES,
      actorId: "a1", actorName: "Actor", sourceId: "src-1",
    });
    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.type === "charge")).toBe(true);
    expect(entries.every((e) => e.category === "tuition")).toBe(true);
  });

  it("uses the per-grade-level tranche amounts when gradeLevel is provided", () => {
    const config = defaultPricingConfig; // const value, not a function
    const entries = buildTuitionChargeEntries({
      tenantId: TENANT, parentId: "p1", studentId: "s1",
      level: "primaire", gradeLevel: "prescolaire_1",
      config, academicYear: "2025-2026",
      trancheDueDates: DUE_DATES,
      actorId: "a1", actorName: "Actor", sourceId: "src-1",
    });
    const pricing = tuitionForGradeLevel(config, "prescolaire_1");
    expect(entries[0].amount).toBe(pricing.installments[0]);
    expect(entries[1].amount).toBe(pricing.installments[1]);
    expect(entries[2].amount).toBe(pricing.installments[2]);
  });

  it("falls back to level-based equal-split pricing when gradeLevel is omitted", () => {
    const config = defaultPricingConfig; // const value, not a function
    const entries = buildTuitionChargeEntries({
      tenantId: TENANT, parentId: "p1", studentId: "s1",
      level: "primaire", // no gradeLevel
      config, academicYear: "2025-2026",
      trancheDueDates: DUE_DATES,
      actorId: "a1", actorName: "Actor", sourceId: "src-1",
    });
    const annual = tuitionForLevel(config, "primaire");
    const perTranche = Math.round(annual / 3);
    expect(entries[0].amount).toBe(perTranche);
    expect(entries[1].amount).toBe(perTranche);
    expect(entries[2].amount).toBe(annual - perTranche * 2);
  });

  it("applies discounts per-tranche when discounts are provided", () => {
    const config = defaultPricingConfig; // const value, not a function
    const discount = config.discounts.find((d) => d.discountCode === "seniority_5y");
    expect(discount).toBeDefined();
    const entries = buildTuitionChargeEntries({
      tenantId: TENANT, parentId: "p1", studentId: "s1",
      level: "primaire", gradeLevel: "prescolaire_1",
      config, academicYear: "2025-2026",
      trancheDueDates: DUE_DATES,
      actorId: "a1", actorName: "Actor", sourceId: "src-1",
      discounts: discount ? [discount] : [],
    });
    const pricing = tuitionForGradeLevel(config, "prescolaire_1");
    const expectedT1 = applyDiscount(pricing.installments[0], {
      amount: discount!.amount, discountType: discount!.discountType!,
    });
    expect(entries[0].amount).toBe(expectedT1);
  });

  it("assigns incrementing source IDs (src-1-t1, src-1-t2, src-1-t3)", () => {
    const config = defaultPricingConfig; // const value, not a function
    const entries = buildTuitionChargeEntries({
      tenantId: TENANT, parentId: "p1", studentId: "s1",
      level: "primaire", gradeLevel: "prescolaire_1",
      config, academicYear: "2025-2026",
      trancheDueDates: DUE_DATES,
      actorId: "a1", actorName: "Actor", sourceId: "src-1",
    });
    expect(entries[0].sourceId).toBe("src-1-t1");
    expect(entries[1].sourceId).toBe("src-1-t2");
    expect(entries[2].sourceId).toBe("src-1-t3");
  });

  it("uses the corresponding trancheDueDates[i] as the entry's `at` timestamp", () => {
    const config = defaultPricingConfig; // const value, not a function
    const entries = buildTuitionChargeEntries({
      tenantId: TENANT, parentId: "p1", studentId: "s1",
      level: "primaire", gradeLevel: "prescolaire_1",
      config, academicYear: "2025-2026",
      trancheDueDates: DUE_DATES,
      actorId: "a1", actorName: "Actor", sourceId: "src-1",
    });
    expect(entries[0].at).toBe(DUE_DATES[0]);
    expect(entries[1].at).toBe(DUE_DATES[1]);
    expect(entries[2].at).toBe(DUE_DATES[2]);
  });

  it("embeds tranche number, level, gradeLevel, and baseAmount in metadata", () => {
    const config = defaultPricingConfig; // const value, not a function
    const entries = buildTuitionChargeEntries({
      tenantId: TENANT, parentId: "p1", studentId: "s1",
      level: "primaire", gradeLevel: "prescolaire_1",
      config, academicYear: "2025-2026",
      trancheDueDates: DUE_DATES,
      actorId: "a1", actorName: "Actor", sourceId: "src-1",
    });
    expect(entries[0].metadata.tranche).toBe(1);
    expect(entries[0].metadata.level).toBe("primaire");
    expect(entries[0].metadata.gradeLevel).toBe("prescolaire_1");
    expect(entries[0].metadata.baseAmount).toBe(
      tuitionForGradeLevel(config, "prescolaire_1").annualAmount,
    );
  });
});

describe("calc/ledger/charges — buildTransportChargeEntry (single, legacy)", () => {
  it("builds a single transport charge entry for a destination", () => {
    const config = defaultPricingConfig; // const value, not a function
    const entry = buildTransportChargeEntry({
      tenantId: TENANT, parentId: "p1", studentId: "s1",
      destination: "ville_boumerdes",
      config, academicYear: "2025-2026",
      dueDate: "2025-09-15T00:00:00.000Z",
      actorId: "a1", actorName: "Actor", sourceId: "src-tr-1",
    });
    expect(entry.type).toBe("charge");
    expect(entry.category).toBe("transport");
    expect(entry.amount).toBe(transportForDestination(config, "ville_boumerdes").annualAmount);
    expect(entry.description).toContain("ville_boumerdes");
  });

  it("falls back to tier-based pricing when destination is omitted", () => {
    const config = defaultPricingConfig; // const value, not a function
    const entry = buildTransportChargeEntry({
      tenantId: TENANT, parentId: "p1", studentId: null,
      tier: "t2",
      config, academicYear: "2025-2026",
      dueDate: "2025-09-15T00:00:00.000Z",
      actorId: "a1", actorName: "Actor", sourceId: "src-tr-2",
    });
    expect(entry.amount).toBe(transportForTier(config, "t2"));
    expect(entry.description).toContain("T2"); // tier label uppercased
  });

  it("defaults to tier t1 when neither destination nor tier is provided", () => {
    const config = defaultPricingConfig; // const value, not a function
    const entry = buildTransportChargeEntry({
      tenantId: TENANT, parentId: "p1", studentId: null,
      config, academicYear: "2025-2026",
      dueDate: "2025-09-15T00:00:00.000Z",
      actorId: "a1", actorName: "Actor", sourceId: "src-tr-3",
    });
    expect(entry.amount).toBe(transportForTier(config, "t1"));
  });
});

describe("calc/ledger/charges — buildTransportChargeEntriesForDestination (3-tranche)", () => {
  it("builds 3 transport charge entries for a destination", () => {
    const config = defaultPricingConfig; // const value, not a function
    const entries = buildTransportChargeEntriesForDestination({
      tenantId: TENANT, parentId: "p1", studentId: "s1",
      destination: "ville_boumerdes",
      config, academicYear: "2025-2026",
      trancheDueDates: DUE_DATES,
      actorId: "a1", actorName: "Actor", sourceId: "src-tr-1",
    });
    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.type === "charge")).toBe(true);
    expect(entries.every((e) => e.category === "transport")).toBe(true);
  });

  it("uses the per-destination tranche amounts", () => {
    const config = defaultPricingConfig; // const value, not a function
    const entries = buildTransportChargeEntriesForDestination({
      tenantId: TENANT, parentId: "p1", studentId: "s1",
      destination: "ville_boumerdes",
      config, academicYear: "2025-2026",
      trancheDueDates: DUE_DATES,
      actorId: "a1", actorName: "Actor", sourceId: "src-tr-1",
    });
    const pricing = transportForDestination(config, "ville_boumerdes");
    expect(entries[0].amount).toBe(pricing.installments[0]);
    expect(entries[1].amount).toBe(pricing.installments[1]);
    expect(entries[2].amount).toBe(pricing.installments[2]);
  });

  it("assigns incrementing source IDs and due dates", () => {
    const config = defaultPricingConfig; // const value, not a function
    const entries = buildTransportChargeEntriesForDestination({
      tenantId: TENANT, parentId: "p1", studentId: "s1",
      destination: "ville_boumerdes",
      config, academicYear: "2025-2026",
      trancheDueDates: DUE_DATES,
      actorId: "a1", actorName: "Actor", sourceId: "src-tr-1",
    });
    expect(entries[0].sourceId).toBe("src-tr-1-t1");
    expect(entries[1].sourceId).toBe("src-tr-1-t2");
    expect(entries[2].sourceId).toBe("src-tr-1-t3");
    expect(entries[0].at).toBe(DUE_DATES[0]);
    expect(entries[1].at).toBe(DUE_DATES[1]);
    expect(entries[2].at).toBe(DUE_DATES[2]);
  });

  it("embeds tranche number and destination in metadata", () => {
    const config = defaultPricingConfig; // const value, not a function
    const entries = buildTransportChargeEntriesForDestination({
      tenantId: TENANT, parentId: "p1", studentId: "s1",
      destination: "ville_boumerdes",
      config, academicYear: "2025-2026",
      trancheDueDates: DUE_DATES,
      actorId: "a1", actorName: "Actor", sourceId: "src-tr-1",
    });
    expect(entries[0].metadata.tranche).toBe(1);
    expect(entries[0].metadata.destination).toBe("ville_boumerdes");
  });

  it("uses FR tranche labels with destination name in description", () => {
    const config = defaultPricingConfig; // const value, not a function
    const entries = buildTransportChargeEntriesForDestination({
      tenantId: TENANT, parentId: "p1", studentId: "s1",
      destination: "ville_boumerdes",
      config, academicYear: "2025-2026",
      trancheDueDates: DUE_DATES,
      actorId: "a1", actorName: "Actor", sourceId: "src-tr-1",
    });
    expect(entries[0].description).toContain("Tranche 1");
    expect(entries[0].description).toContain("ville_boumerdes");
  });
});
