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
    // CALC-001: the seed no longer prices the fictional clubs — the builder
    // falls back to the per-category map.
    expect(chessEntry.metadata?.pricingSource).toBe("default_map");
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

describe("buildAdditionalServiceCharge (CALC-001 — the REAL school services)", () => {
  // The real billable services are the ETAT columns PSY1/PSY2/ORTH1/ORTH2/
  // E-PLANT/Ratrapage (+ AUTISTE). The fictional canteen/uniform/books
  // catalog is retired (problem CALC-001).
  it("psy1 produces a therapy_psychology charge priced from the real seed", () => {
    const entry = buildAdditionalServiceCharge(BASE_INPUT, "psy1");
    expect(entry.type).toBe("charge");
    expect(entry.category).toBe("therapy_psychology");
    expect(entry.amount).toBe(10_000);
    expect(entry.accountId).toBe(
      deriveAccountId("par-test-001", "therapy_psychology", "stu-test-001"),
    );
  });

  it("psy2 produces a therapy_psychology charge", () => {
    const entry = buildAdditionalServiceCharge(BASE_INPUT, "psy2");
    expect(entry.category).toBe("therapy_psychology");
    expect(entry.amount).toBe(10_000);
  });

  it("orth1 / orth2 produce therapy_speech charges", () => {
    const entry1 = buildAdditionalServiceCharge(BASE_INPUT, "orth1");
    const entry2 = buildAdditionalServiceCharge(BASE_INPUT, "orth2");
    expect(entry1.category).toBe("therapy_speech");
    expect(entry1.amount).toBe(10_000);
    expect(entry2.category).toBe("therapy_speech");
    expect(entry2.amount).toBe(10_000);
  });

  it("e_plant / ratrapage / autiste produce charges", () => {
    const ePlant = buildAdditionalServiceCharge(BASE_INPUT, "e_plant");
    const ratrapage = buildAdditionalServiceCharge(BASE_INPUT, "ratrapage");
    const autiste = buildAdditionalServiceCharge(BASE_INPUT, "autiste");
    expect(ePlant.category).toBe("other");
    expect(ePlant.amount).toBe(20_000);
    expect(ratrapage.amount).toBe(10_000);
    expect(autiste.amount).toBe(40_000);
  });

  it("metadata records the service qualifier", () => {
    const entry = buildAdditionalServiceCharge(BASE_INPUT, "psy1");
    expect(entry.metadata?.serviceQualifier).toBe("psy1");
    expect(entry.metadata?.pricingSource).toBe("pricing_seed");
  });

  it("all charges are positive (debits)", () => {
    const qualifiers = ["psy1", "psy2", "orth1", "orth2", "e_plant", "ratrapage", "autiste"] as const;
    for (const q of qualifiers) {
      const entry = buildAdditionalServiceCharge(BASE_INPUT, q);
      expect(entry.amount).toBeGreaterThan(0);
    }
  });
});
