/**
 * Integration tests for non-tuition billing (Epic 4.3 / 4.4).
 *
 * Verifies that:
 *   - Club enrollment appends an `extracurricular` charge to the ledger.
 *   - Psychology follow-up creation appends a `therapy_psychology` charge.
 *   - Orthophonie follow-up creation appends a `therapy_speech` charge.
 *   - `appendManualCharge` writes canteen / uniform / books / 2nd apron charges.
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

  it("appendManualCharge writes a canteen_term charge to the ledger", async () => {
    const before = store.ledger.length;
    const res = await mockPaymentRepository.appendManualCharge(
      {
        parentId: "par-001",
        studentId: "stu-001",
        serviceQualifier: "canteen_term",
      },
      ACTOR.actorId,
    );
    expect(res.ok).toBe(true);
    expect(store.ledger.length).toBe(before + 1);
    const entry = store.ledger[store.ledger.length - 1];
    expect(entry.type).toBe("charge");
    expect(entry.category).toBe("canteen");
    expect(entry.amount).toBe(12_000); // canteen_term per pricing-seed
    expect(entry.studentId).toBe("stu-001");
    expect(entry.parentId).toBe("par-001");
  });

  it("appendManualCharge writes a uniform charge", async () => {
    const before = store.ledger.length;
    const res = await mockPaymentRepository.appendManualCharge(
      {
        parentId: "par-001",
        studentId: "stu-001",
        serviceQualifier: "uniform",
      },
      ACTOR.actorId,
    );
    expect(res.ok).toBe(true);
    const entry = store.ledger[store.ledger.length - 1];
    expect(entry.category).toBe("uniform");
    expect(entry.amount).toBe(8_500); // uniform per pricing-seed
  });

  it("appendManualCharge writes a second_apron charge (2,000 DA per Prices.md)", async () => {
    const res = await mockPaymentRepository.appendManualCharge(
      {
        parentId: "par-001",
        studentId: "stu-001",
        serviceQualifier: "second_apron",
      },
      ACTOR.actorId,
    );
    expect(res.ok).toBe(true);
    const entry = store.ledger[store.ledger.length - 1];
    expect(entry.category).toBe("second_apron");
    expect(entry.amount).toBe(2_000); // 2nd apron per Prices.md
  });

  it("appendManualCharge writes a books charge", async () => {
    const res = await mockPaymentRepository.appendManualCharge(
      {
        parentId: "par-001",
        studentId: "stu-001",
        serviceQualifier: "books",
      },
      ACTOR.actorId,
    );
    expect(res.ok).toBe(true);
    const entry = store.ledger[store.ledger.length - 1];
    expect(entry.category).toBe("books");
    expect(entry.amount).toBe(6_500); // books per pricing-seed
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
    // The summary should include at least one canteen + uniform + 2nd apron + books
    // charge from the previous tests.
    const categoriesPresent = new Set(summary.accounts.map((a) => a.category));
    expect(categoriesPresent.has("canteen")).toBe(true);
    expect(categoriesPresent.has("uniform")).toBe(true);
    expect(categoriesPresent.has("second_apron")).toBe(true);
    expect(categoriesPresent.has("books")).toBe(true);
    // Total charged should include 12,000 + 8,500 + 2,000 + 6,500 = 29,000 DA
    // (plus any prior charges from seed data, so check >= )
    expect(summary.totalCharged).toBeGreaterThanOrEqual(29_000);
  });

  it("pricing-seed has chess_club and english_club qualifiers with correct amounts", () => {
    const chess = defaultPricingConfig.additionalServices.find((s) => s.qualifier === "chess_club");
    expect(chess?.amount).toBe(9_000);
    const english = defaultPricingConfig.additionalServices.find((s) => s.qualifier === "english_club");
    expect(english?.amount).toBe(11_000);
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
