/**
 * Integration tests for non-tuition billing (Epic 4.3 / 4.4).
 *
 * Verifies that:
 *   - Club enrollment appends an `extracurricular` charge to the ledger.
 *   - Psychology follow-up creation appends a `therapy_psychology` charge.
 *   - Orthophonie follow-up creation appends a `therapy_speech` charge.
 *   - `appendManualCharge` writes the REAL service charges (PSY1/ORTH1/
 *     E-PLANT/Ratrapage — CALC-001; the fictional canteen/uniform/books
 *     catalog is retired).
 *   - All charges are student-scoped and roll up to the parent summary
 *     via `computeAccountBalance`.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockClubRepository } from "../../infrastructure/mock/repositories/club-repository";
import {
  mockPsychologyRepository,
  mockOrthophonieRepository,
} from "../../infrastructure/mock/repositories/therapy-repository";
import { mockPaymentRepository } from "../../infrastructure/mock/repositories/financial-repository";
import { store } from "../../infrastructure/mock/repositories/mock-store";
import { computeParentSummary } from "../../domain/calc/ledger/balance";
import { defaultPricingConfig } from "../../infrastructure/mock/pricing-seed";

const ACTOR = { actorId: "usr-test-001", actorName: "Test Actor" };

describe("Integration: Non-Tuition Billing (Epic 4.3 / 4.4)", () => {
  beforeEach(() => {
    // Reset is implicit via seed state — tests should not mutate shared
    // state destructively. We pick seed students / clubs that exist.
  });

  it("appendManualCharge writes a psy1 charge to the ledger (CALC-001)", async () => {
    const before = store.ledger.length;
    const res = await mockPaymentRepository.appendManualCharge(
      {
        parentId: "par-001",
        studentId: "stu-001",
        serviceQualifier: "psy1",
      },
      ACTOR.actorId,
    );
    expect(res.ok).toBe(true);
    expect(store.ledger.length).toBe(before + 1);
    const entry = store.ledger[store.ledger.length - 1];
    expect(entry.type).toBe("charge");
    expect(entry.category).toBe("therapy_psychology");
    expect(entry.amount).toBe(10_000); // psy1 per the real pricing seed
    expect(entry.studentId).toBe("stu-001");
    expect(entry.parentId).toBe("par-001");
  });

  it("appendManualCharge writes an orth1 charge", async () => {
    const before = store.ledger.length;
    const res = await mockPaymentRepository.appendManualCharge(
      {
        parentId: "par-001",
        studentId: "stu-001",
        serviceQualifier: "orth1",
      },
      ACTOR.actorId,
    );
    expect(res.ok).toBe(true);
    const entry = store.ledger[store.ledger.length - 1];
    expect(entry.category).toBe("therapy_speech");
    expect(entry.amount).toBe(10_000);
  });

  it("appendManualCharge writes an e_plant charge (20,000 DA)", async () => {
    const res = await mockPaymentRepository.appendManualCharge(
      {
        parentId: "par-001",
        studentId: "stu-001",
        serviceQualifier: "e_plant",
      },
      ACTOR.actorId,
    );
    expect(res.ok).toBe(true);
    const entry = store.ledger[store.ledger.length - 1];
    expect(entry.category).toBe("other");
    expect(entry.amount).toBe(20_000);
  });

  it("appendManualCharge writes a ratrapage charge", async () => {
    const res = await mockPaymentRepository.appendManualCharge(
      {
        parentId: "par-001",
        studentId: "stu-001",
        serviceQualifier: "ratrapage",
      },
      ACTOR.actorId,
    );
    expect(res.ok).toBe(true);
    const entry = store.ledger[store.ledger.length - 1];
    expect(entry.category).toBe("other");
    expect(entry.amount).toBe(10_000);
  });

  it("club enrollment writes an extracurricular charge (9,000 DA for chess)", async () => {
    const before = store.ledger.length;
    // Create a fresh chess club.
    const createRes = await mockClubRepository.createClub(
      {
        code: "CLUB-BILL-TEST",
        name: "Billing Test Chess Club",
        category: "chess",
        academicYearId: "ay-2025-2026",
        academicYearCode: "2025-2026",
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(createRes.ok).toBe(true);
    const newClubId = (createRes as any).value.id;
    // Use a student not already in any club.
    const enrollRes = await mockClubRepository.enrollMember({
      clubId: newClubId,
      studentId: "stu-011",
      enrolledById: ACTOR.actorId,
      enrolledByName: ACTOR.actorName,
    });
    expect(enrollRes.ok).toBe(true);
    // Verify the charge was appended.
    expect(store.ledger.length).toBe(before + 1);
    const entry = store.ledger[store.ledger.length - 1];
    expect(entry.type).toBe("charge");
    expect(entry.category).toBe("extracurricular");
    expect(entry.amount).toBe(9_000); // chess_club per pricing-seed
    expect(entry.studentId).toBe("stu-011");
    expect(entry.sourceType).toBe("manual_entry");
  });

  it("psychology follow-up creation writes a therapy_psychology charge (10,000 DA semester)", async () => {
    const before = store.ledger.length;
    const res = await mockPsychologyRepository.createFollowUp(
      {
        studentId: "stu-008",
        psychologistId: "per-007",
        psychologistName: "Mme Bensaïd",
        reason: "Motif sufficiently long for validation testing",
        startDate: "2025-09-15",
        parentConsent: true,
        parentConsentDate: "2025-09-10",
        academicYearId: "ay-2025-2026",
        academicYearCode: "2025-2026",
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(true);
    expect(store.ledger.length).toBe(before + 1);
    const entry = store.ledger[store.ledger.length - 1];
    expect(entry.type).toBe("charge");
    expect(entry.category).toBe("therapy_psychology");
    expect(entry.amount).toBe(10_000); // semester forfait per Prices.md
    expect(entry.studentId).toBe("stu-008");
  });

  it("orthophonie follow-up creation writes a therapy_speech charge (10,000 DA semester)", async () => {
    const before = store.ledger.length;
    const res = await mockOrthophonieRepository.createFollowUp(
      {
        studentId: "stu-011",
        therapistId: "per-008",
        therapistName: "Mme Kaci",
        reason: "Motif sufficiently long for validation testing",
        startDate: "2025-09-15",
        parentConsent: true,
        parentConsentDate: "2025-09-10",
        academicYearId: "ay-2025-2026",
        academicYearCode: "2025-2026",
      },
      ACTOR.actorId,
      ACTOR.actorName,
    );
    expect(res.ok).toBe(true);
    expect(store.ledger.length).toBe(before + 1);
    const entry = store.ledger[store.ledger.length - 1];
    expect(entry.type).toBe("charge");
    expect(entry.category).toBe("therapy_speech");
    expect(entry.amount).toBe(10_000);
    expect(entry.studentId).toBe("stu-011");
  });

  it("non-tuition charges roll up to the parent summary via computeParentSummary", () => {
    // Use a parent that we just added charges to (par-001).
    const summary = computeParentSummary(store.ledger, "par-001", "Test Parent");
    // The summary should include the REAL service categories from the
    // previous tests (CALC-001).
    const categoriesPresent = new Set(summary.accounts.map((a) => a.category));
    expect(categoriesPresent.has("therapy_psychology")).toBe(true);
    expect(categoriesPresent.has("therapy_speech")).toBe(true);
    expect(categoriesPresent.has("other")).toBe(true);
    // Total charged should include 10,000 + 10,000 + 20,000 + 10,000 = 50,000 DA
    // (plus any prior charges from seed data, so check >= )
    expect(summary.totalCharged).toBeGreaterThanOrEqual(50_000);
  });

  it("pricing-seed has the REAL service qualifiers (CALC-001)", () => {
    const psy1 = defaultPricingConfig.additionalServices.find((s) => s.qualifier === "psy1");
    expect(psy1?.amount).toBe(10_000);
    const ePlant = defaultPricingConfig.additionalServices.find((s) => s.qualifier === "e_plant");
    expect(ePlant?.amount).toBe(20_000);
    const ratrapage = defaultPricingConfig.additionalServices.find((s) => s.qualifier === "ratrapage");
    expect(ratrapage?.amount).toBe(10_000);
    const autiste = defaultPricingConfig.additionalServices.find((s) => s.qualifier === "autiste");
    expect(autiste?.amount).toBe(40_000);
  });

  it("pricing-seed has psychology and speech_therapy complementary services with semester + annual amounts", () => {
    const psy = defaultPricingConfig.complementaryServices.find((s) => s.qualifier === "psychology");
    expect(psy?.semesterAmount).toBe(10_000);
    expect(psy?.annualAmount).toBe(20_000);
    const ortho = defaultPricingConfig.complementaryServices.find((s) => s.qualifier === "speech_therapy");
    expect(ortho?.semesterAmount).toBe(10_000);
    expect(ortho?.annualAmount).toBe(20_000);
  });
});
