/**
 * T-414 (PRICING-500 / ADR-025) — per-academic-year price configuration,
 * MOCK repository contract tests.
 *
 * Verifies the mandated behavior of the year-config surface:
 *   1. listConfigs(): the current year's config materializes from the legacy
 *      single-config state (exactly one entry, ACTIVE, flagged current-year).
 *   2. createConfigForYear(): a new year's config starts INACTIVE; cloning
 *      copies the active config's grids; duplicate creation is rejected
 *      (the 0006 one-config-per-year constraint's mock twin); an unknown
 *      year is a not-found.
 *   3. activateConfig(): the atomic switch — the target becomes the single
 *      active config, observe() re-emits ITS payload (the calculation source
 *      of truth follows the activation), and the previously active config
 *      is PRESERVED (read back identical except the active flag).
 *   4. Historical preservation: after switching years and editing the NEW
 *      active config, the OLD year's config payload is byte-for-byte the
 *      prices it had at activation time (financial history is never
 *      silently re-priced — ADR-025 §5 / INV-1).
 *   5. readForYear(): year-scoped read of any configured year; not-found
 *      for a year without a config (honest null — §15.49 family).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MockPricingRepository } from "../../infrastructure/mock/repositories/pricing-repository";
import { defaultPricingConfig } from "../../infrastructure/mock/pricing-seed";
import { store } from "../../infrastructure/mock/repositories/mock-store";
import type { PricingConfig } from "../../domain/model/pricing";
import type { AcademicYear } from "../../domain/model/academic";

const CURRENT_YEAR = "ay-2025-2026"; // seed: isCurrent = true
const PAST_YEAR = "ay-2024-2025"; // seed: not current

function yearById(id: string): AcademicYear {
  const y = store.academicYears.find((x) => x.id === id);
  if (!y) throw new Error(`year ${id} missing from mock seed`);
  return y;
}

describe("T-414 mock pricing repository — per-year configuration", () => {
  let repo: MockPricingRepository;

  beforeEach(() => {
    repo = new MockPricingRepository();
  });

  it("listConfigs materializes the current year's config from the legacy single-config state", async () => {
    const r = await repo.listConfigs();
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("listConfigs failed");
    const configs = r.value;
    expect(configs.length).toBe(1);
    const c = configs[0];
    expect(c.academicYearId).toBe(CURRENT_YEAR);
    expect(c.academicYearCode).toBe(yearById(CURRENT_YEAR).code);
    expect(c.isActive).toBe(true);
    expect(c.isCurrentYear).toBe(true);
    expect(c.label).toContain(yearById(CURRENT_YEAR).code);
  });

  it("createConfigForYear creates an INACTIVE config (create-then-activate flow)", async () => {
    const r = await repo.createConfigForYear(
      { academicYearId: PAST_YEAR, cloneFromActive: false },
      "usr-test",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("createConfigForYear failed");
    expect(r.value.isActive).toBe(false);
    expect(r.value.academicYearId).toBe(PAST_YEAR);
    expect(r.value.isCurrentYear).toBe(false);

    // Exactly one ACTIVE config remains (the current year's).
    const listR = await repo.listConfigs();
    if (!listR.ok) throw new Error("listConfigs failed");
    const list = listR.value;
    expect(list.filter((c) => c.isActive)).toHaveLength(1);
    expect(list.find((c) => c.isActive)?.academicYearId).toBe(CURRENT_YEAR);
  });

  it("createConfigForYear with cloneFromActive copies the active config's grids", async () => {
    // Mutate the active config first so the clone is distinguishable.
    await repo.updateTuitionForGradeLevel("1ap", 333000, [111000, 111000, 111000], "usr-test");
    const activeBefore = repo.observe().get();

    const r = await repo.createConfigForYear(
      { academicYearId: PAST_YEAR, cloneFromActive: true },
      "usr-test",
    );
    expect(r.ok).toBe(true);

    const clonedR = await repo.readForYear(PAST_YEAR);
    if (!clonedR.ok) throw new Error("readForYear failed");
    const cloned = clonedR.value as PricingConfig;
    expect(cloned.tuitionByGradeLevel["1ap"].annualAmount).toBe(333000);
    expect(cloned.tuitionByGradeLevel["1ap"].installments).toEqual([111000, 111000, 111000]);
    expect(cloned.discounts.length).toBe(activeBefore.discounts.length);
    expect(cloned.additionalServices.length).toBe(activeBefore.additionalServices.length);

    // The clone is a COPY — editing the active config afterwards never
    // reaches the cloned year's stored payload.
    await repo.updateTuitionForGradeLevel("1ap", 999000, [333000, 333000, 333000], "usr-test");
    const clonedAfterR = await repo.readForYear(PAST_YEAR);
    if (!clonedAfterR.ok) throw new Error("readForYear failed");
    const clonedAfter = clonedAfterR.value as PricingConfig;
    expect(clonedAfter.tuitionByGradeLevel["1ap"].annualAmount).toBe(333000);
  });

  it("createConfigForYear rejects a duplicate config for the same year", async () => {
    const first = await repo.createConfigForYear(
      { academicYearId: PAST_YEAR, cloneFromActive: false },
      "usr-test",
    );
    expect(first.ok).toBe(true);

    const second = await repo.createConfigForYear(
      { academicYearId: PAST_YEAR, cloneFromActive: true },
      "usr-test",
    );
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("duplicate creation should have failed");
    expect(second.error.userMessage).toContain("existe déjà");
  });

  it("createConfigForYear rejects an unknown academic year (honest not-found)", async () => {
    const r = await repo.createConfigForYear(
      { academicYearId: "ay-does-not-exist", cloneFromActive: true },
      "usr-test",
    );
    expect(r.ok).toBe(false);
  });

  it("activateConfig switches the active config and observe() follows it", async () => {
    // Prepare the next year with a distinguishable price.
    await repo.createConfigForYear(
      { academicYearId: PAST_YEAR, cloneFromActive: true },
      "usr-test",
    );
    const listB = await repo.listConfigs();
    if (!listB.ok) throw new Error("listConfigs failed");
    const pastSummary = listB.value.find((c) => c.academicYearId === PAST_YEAR)!;
    expect(pastSummary.isActive).toBe(false);

    // The ACTIVE config drives observe() before the switch.
    const before = repo.observe().get();
    expect(before.tuitionByGradeLevel["1ap"].annualAmount)
      .toBe(defaultPricingConfig.tuitionByGradeLevel["1ap"].annualAmount);

    const r = await repo.activateConfig(pastSummary.id, "usr-test");
    expect(r.ok).toBe(true);

    // observe() now emits the newly ACTIVE year's config (source of truth
    // follows the activation — the calculation surfaces re-derive).
    const after = repo.observe().get();
    expect(after.tuitionByGradeLevel["1ap"].annualAmount)
      .toBe(defaultPricingConfig.tuitionByGradeLevel["1ap"].annualAmount);
    const yearBRead = await repo.readForYear(PAST_YEAR);
    if (!yearBRead.ok) throw new Error("readForYear failed");
    expect(after).toEqual(yearBRead.value);

    // Exactly one ACTIVE config (the switched-to year).
    const listC = await repo.listConfigs();
    if (!listC.ok) throw new Error("listConfigs failed");
    const list = listC.value;
    expect(list.filter((c) => c.isActive)).toHaveLength(1);
    expect(list.find((c) => c.isActive)?.academicYearId).toBe(PAST_YEAR);
  });

  it("activateConfig is idempotent for the already-active config", async () => {
    const listD = await repo.listConfigs();
    if (!listD.ok) throw new Error("listConfigs failed");
    const active = listD.value.find((c) => c.isActive)!;
    const r = await repo.activateConfig(active.id, "usr-test");
    expect(r.ok).toBe(true);
    const listE = await repo.listConfigs();
    if (!listE.ok) throw new Error("listConfigs failed");
    const list = listE.value;
    expect(list.filter((c) => c.isActive)).toHaveLength(1);
  });

  it("activateConfig rejects an unknown config id", async () => {
    const r = await repo.activateConfig("cfg-nope", "usr-test");
    expect(r.ok).toBe(false);
  });

  it("HISTORICAL PRESERVATION: editing the new active config never mutates the old year's payload", async () => {
    // Year A (current) active with a known price.
    await repo.updateTuitionForGradeLevel("1ap", 250000, [100000, 75000, 75000], "usr-test");

    // Prepare + activate Year B.
    await repo.createConfigForYear(
      { academicYearId: PAST_YEAR, cloneFromActive: true },
      "usr-test",
    );
    const listF = await repo.listConfigs();
    if (!listF.ok) throw new Error("listConfigs failed");
    const yearB = listF.value.find((c) => c.academicYearId === PAST_YEAR)!;
    await repo.activateConfig(yearB.id, "usr-test");

    // Year B is now active — edit it aggressively.
    await repo.updateTuitionForGradeLevel("1ap", 400000, [200000, 100000, 100000], "usr-test");
    await repo.updateRegistration(9999, "usr-test");
    await repo.updateSecondApronFee(5555, "usr-test");

    // Year A's stored config is UNCHANGED (the prices applicable at its
    // time — never silently re-priced with the new year's numbers).
    const yearAR = await repo.readForYear(CURRENT_YEAR);
    if (!yearAR.ok) throw new Error("readForYear failed");
    const yearA = yearAR.value as PricingConfig;
    expect(yearA.tuitionByGradeLevel["1ap"].annualAmount).toBe(250000);
    expect(yearA.tuitionByGradeLevel["1ap"].installments).toEqual([100000, 75000, 75000]);
    expect(yearA.registrationFee).toBe(defaultPricingConfig.registrationFee);
    expect(yearA.secondApronFee).toBe(defaultPricingConfig.secondApronFee);
  });

  it("readForYear returns a not-found for a year without a configuration", async () => {
    const r = await repo.readForYear("ay-unknown");
    expect(r.ok).toBe(false);
  });
});
