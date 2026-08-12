/**
 * Unit tests for the official `Prices.md` schedule generators.
 *
 * Verifies:
 *   - `getOfficialTuitionDueDates` returns Sept 15 / Dec 15 / Mar 15.
 *   - `getOfficialTuitionTrancheSplit` returns [40, 30, 30].
 *   - `splitNetTuitionByOfficialSchedule` conserves the total exactly.
 *   - `getOfficialTransportDueDates` returns Sept 15 / Dec 15 / Mar 15.
 *   - `getOfficialTransportTrancheSplit` returns the exact per-destination
 *     tranche amounts from `Prices.md` and they sum to the annual fee.
 */
import { describe, it, expect } from "vitest";
import {
  getOfficialTuitionDueDates,
  getOfficialTuitionTrancheSplit,
  splitNetTuitionByOfficialSchedule,
} from "../../../domain/calc/pricing/tuition";
import {
  getOfficialTransportDueDates,
  getOfficialTransportTrancheSplit,
} from "../../../domain/calc/pricing/transport";

describe("getOfficialTuitionDueDates", () => {
  it("returns Sept 15 / Dec 15 / Mar 15 for the 2026-2027 academic year", () => {
    const dates = getOfficialTuitionDueDates(2026, "primaire");
    expect(dates[0]).toBe("2026-09-15T00:00:00.000Z");
    expect(dates[1]).toBe("2026-12-15T00:00:00.000Z");
    expect(dates[2]).toBe("2027-03-15T00:00:00.000Z");
  });

  it("returns the same schedule for all cycles (Primaire = CEM = Lycée per Prices.md)", () => {
    const primaire = getOfficialTuitionDueDates(2026, "primaire");
    const cem = getOfficialTuitionDueDates(2026, "cem");
    const lycee = getOfficialTuitionDueDates(2026, "lycee");
    expect(cem).toEqual(primaire);
    expect(lycee).toEqual(primaire);
  });

  it("rolls the 3rd tranche into the next calendar year", () => {
    const dates = getOfficialTuitionDueDates(2026, "cem");
    expect(dates[2]).toContain("2027-03-15");
  });
});

describe("getOfficialTuitionTrancheSplit", () => {
  it("returns [40, 30, 30] percentages", () => {
    expect(getOfficialTuitionTrancheSplit(300_000, "primaire")).toEqual([40, 30, 30]);
  });

  it("returns the same split regardless of cycle", () => {
    expect(getOfficialTuitionTrancheSplit(300_000, "cem")).toEqual([40, 30, 30]);
    expect(getOfficialTuitionTrancheSplit(300_000, "lycee")).toEqual([40, 30, 30]);
  });
});

describe("splitNetTuitionByOfficialSchedule", () => {
  it("splits a net amount into 40% / 30% / 30% with exact conservation", () => {
    const [t1, t2, t3] = splitNetTuitionByOfficialSchedule(300_000);
    expect(t1).toBe(120_000); // 40%
    expect(t2).toBe(90_000); // 30%
    expect(t3).toBe(90_000); // 30% (with remainder)
    expect(t1 + t2 + t3).toBe(300_000);
  });

  it("conserves the total exactly even with non-round numbers", () => {
    const net = 245_000;
    const [t1, t2, t3] = splitNetTuitionByOfficialSchedule(net);
    expect(t1 + t2 + t3).toBe(net);
  });

  it("conserves the total for amounts that don't divide evenly", () => {
    const net = 99_999;
    const [t1, t2, t3] = splitNetTuitionByOfficialSchedule(net);
    expect(t1 + t2 + t3).toBe(net);
  });
});

describe("getOfficialTransportDueDates", () => {
  it("returns Sept 15 / Dec 15 / Mar 15 (same calendar as tuition)", () => {
    const dates = getOfficialTransportDueDates(2026);
    expect(dates[0]).toBe("2026-09-15T00:00:00.000Z");
    expect(dates[1]).toBe("2026-12-15T00:00:00.000Z");
    expect(dates[2]).toBe("2027-03-15T00:00:00.000Z");
  });
});

describe("getOfficialTransportTrancheSplit", () => {
  it("returns [20k, 10k, 10k] for Ville Boumerdes (totaling 40,000 DA)", () => {
    const split = getOfficialTransportTrancheSplit("ville_boumerdes");
    expect(split).toEqual([20_000, 10_000, 10_000]);
    expect(split[0] + split[1] + split[2]).toBe(40_000);
  });

  it("returns [20k, 13k, 10k] for Tidjelabine–Sahel–Figuier–Corso (totaling 43,000 DA)", () => {
    const split = getOfficialTransportTrancheSplit("tidjelabine_sahel_figuier_corso");
    expect(split).toEqual([20_000, 13_000, 10_000]);
    expect(split[0] + split[1] + split[2]).toBe(43_000);
  });

  it("returns [30k, 12k, 10k] for Boudouaou–Thenia–Zemmouri (totaling 52,000 DA)", () => {
    const split = getOfficialTransportTrancheSplit("boudouaou_thenia_zemmouri");
    expect(split).toEqual([30_000, 12_000, 10_000]);
    expect(split[0] + split[1] + split[2]).toBe(52_000);
  });

  it("returns [30k, 15k, 10k] for Autres (totaling 55,000 DA)", () => {
    const split = getOfficialTransportTrancheSplit("autres");
    expect(split).toEqual([30_000, 15_000, 10_000]);
    expect(split[0] + split[1] + split[2]).toBe(55_000);
  });
});
