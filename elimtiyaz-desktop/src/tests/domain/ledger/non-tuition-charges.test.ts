/**
 * Unit tests for the non-tuition charge builders (Epic 4.3 / 4.4).
 *
 * Verifies the pure helper functions in
 * `domain/calc/ledger/non-tuition-charges.ts` produce correct `LedgerEntry`
 * objects with:
 *   - The right category (extracurricular / therapy_psychology / etc.)
 *   - The right amount (chess: 9,000 DA, semester: 10,000 DA, etc.)
 *   - Student-scoped account IDs
 *   - Positive amounts (debits)
 */
import { describe, it, expect } from "vitest";
import {
  buildClubEnrollmentCharge,
  buildTherapyCharge,
  buildAdditionalServiceCharge,
} from "../../../domain/calc/ledger/non-tuition-charges";
import { deriveAccountId } from "../../../domain/calc/ledger/account-id";

const BASE_INPUT = {
  tenantId: "tenant-test-001",
  parentId: "par-test-001",
  studentId: "stu-test-001",
  actorId: "usr-test-001",
  actorName: "Test Actor",
  sourceType: "manual_entry" as const,
  sourceId: "src-test-001",
};

describe("buildClubEnrollmentCharge (Epic 4.3)", () => {
  it("chess club produces a 9,000 DA extracurricular charge", () => {
    const entry = buildClubEnrollmentCharge(BASE_INPUT, "chess", "Club Échecs");
    expect(entry.type).toBe("charge");
    expect(entry.category).toBe("extracurricular");
    expect(entry.amount).toBe(9_000);
    expect(entry.studentId).toBe("stu-test-001");
    expect(entry.parentId).toBe("par-test-001");
    expect(entry.accountId).toBe(
      deriveAccountId("par-test-001", "extracurricular", "stu-test-001"),
    );
    expect(entry.description).toContain("Club Échecs");
  });

  it("english club produces an 11,000 DA extracurricular charge", () => {
    const entry = buildClubEnrollmentCharge(BASE_INPUT, "english", "Club Anglais");
    expect(entry.amount).toBe(11_000);
  });

  it("sports_arts club falls back to default 8,000 DA (no pricing-seed entry)", () => {
    const entry = buildClubEnrollmentCharge(BASE_INPUT, "sports_arts", "Sport & Arts");
    expect(entry.amount).toBe(8_000);
  });

  it("IT club falls back to default 10,000 DA", () => {
    const entry = buildClubEnrollmentCharge(BASE_INPUT, "it", "Club Informatique");
    expect(entry.amount).toBe(10_000);
  });

  it("other club falls back to default 5,000 DA", () => {
    const entry = buildClubEnrollmentCharge(BASE_INPUT, "other", "Autre Club");
    expect(entry.amount).toBe(5_000);
  });

  it("charge amount is always positive (debit)", () => {
    const categories: Array<"chess" | "english" | "it" | "sports_arts" | "other"> = [
      "chess", "english", "it", "sports_arts", "other",
    ];
    for (const c of categories) {
      const entry = buildClubEnrollmentCharge(BASE_INPUT, c, `Club ${c}`);
      expect(entry.amount).toBeGreaterThan(0);
    }
  });

  it("metadata records the pricing source (pricing_seed vs default_map)", () => {
    const chessEntry = buildClubEnrollmentCharge(BASE_INPUT, "chess", "Chess");
    expect(chessEntry.metadata?.pricingSource).toBe("pricing_seed");
    const otherEntry = buildClubEnrollmentCharge(BASE_INPUT, "other", "Other");
    expect(otherEntry.metadata?.pricingSource).toBe("default_map");
  });
});

describe("buildTherapyCharge (Epic 4.4)", () => {
  it("psychology semester produces a 10,000 DA therapy_psychology charge", () => {
    const entry = buildTherapyCharge(BASE_INPUT, "psychology", "semester", "Yacine BENALI");
    expect(entry.type).toBe("charge");
    expect(entry.category).toBe("therapy_psychology");
    expect(entry.amount).toBe(10_000);
    expect(entry.studentId).toBe("stu-test-001");
    expect(entry.accountId).toBe(
      deriveAccountId("par-test-001", "therapy_psychology", "stu-test-001"),
    );
    expect(entry.description).toContain("Psychologie");
    expect(entry.description).toContain("Semestre");
  });

  it("psychology annual produces a 20,000 DA therapy_psychology charge", () => {
    const entry = buildTherapyCharge(BASE_INPUT, "psychology", "annual");
    expect(entry.amount).toBe(20_000);
  });

  it("speech_therapy semester produces a 10,000 DA therapy_speech charge", () => {
    const entry = buildTherapyCharge(BASE_INPUT, "speech_therapy", "semester", "Lina BENALI");
    expect(entry.category).toBe("therapy_speech");
    expect(entry.amount).toBe(10_000);
    expect(entry.description).toContain("Orthophonie");
  });

  it("speech_therapy annual produces a 20,000 DA therapy_speech charge", () => {
    const entry = buildTherapyCharge(BASE_INPUT, "speech_therapy", "annual");
    expect(entry.amount).toBe(20_000);
  });

  it("metadata records the therapy kind, period, and session count", () => {
    const entry = buildTherapyCharge(BASE_INPUT, "psychology", "semester");
    expect(entry.metadata?.therapyKind).toBe("psychology");
    expect(entry.metadata?.period).toBe("semester");
    expect(entry.metadata?.sessionCount).toBe(20);
  });
});

describe("buildAdditionalServiceCharge (Epic 4.3 — canteen / uniform / books / 2nd apron)", () => {
  it("canteen_term produces a 12,000 DA canteen charge", () => {
    const entry = buildAdditionalServiceCharge(BASE_INPUT, "canteen_term");
    expect(entry.type).toBe("charge");
    expect(entry.category).toBe("canteen");
    expect(entry.amount).toBe(12_000);
    expect(entry.accountId).toBe(
      deriveAccountId("par-test-001", "canteen", "stu-test-001"),
    );
  });

  it("uniform produces an 8,500 DA uniform charge", () => {
    const entry = buildAdditionalServiceCharge(BASE_INPUT, "uniform");
    expect(entry.category).toBe("uniform");
    expect(entry.amount).toBe(8_500);
  });

  it("books produces a 6,500 DA books charge", () => {
    const entry = buildAdditionalServiceCharge(BASE_INPUT, "books");
    expect(entry.category).toBe("books");
    expect(entry.amount).toBe(6_500);
  });

  it("second_apron produces a 2,000 DA second_apron charge", () => {
    const entry = buildAdditionalServiceCharge(BASE_INPUT, "second_apron");
    expect(entry.category).toBe("second_apron");
    expect(entry.amount).toBe(2_000);
  });

  it("metadata records the service qualifier", () => {
    const entry = buildAdditionalServiceCharge(BASE_INPUT, "uniform");
    expect(entry.metadata?.serviceQualifier).toBe("uniform");
    expect(entry.metadata?.pricingSource).toBe("pricing_seed");
  });

  it("all charges are positive (debits)", () => {
    const qualifiers = ["canteen_term", "uniform", "books", "second_apron"] as const;
    for (const q of qualifiers) {
      const entry = buildAdditionalServiceCharge(BASE_INPUT, q);
      expect(entry.amount).toBeGreaterThan(0);
    }
  });
});
