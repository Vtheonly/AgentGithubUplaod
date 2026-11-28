// ============================================================================
// FILE: src/tests/domain/payment/t-638-payment-conflict.test.ts
// ============================================================================
/**
 * T-638 / FIN-115 / ADR-038 — the canonical payment conflict & similarity
 * engine. Every scenario of the owner's mandate is pinned here:
 *
 *  A. Identical payments with reliable shared identifiers  → confirmed_duplicate
 *  B. Identical amounts without identifiers (exact profile) → high_confidence_duplicate
 *  C. Missing payment dates → possible_duplicate with reduced certainty (never confirmed)
 *  D. Missing payment purposes (category) → degraded class, missing evidence named
 *  E. Two legitimate payments with the same amount, far apart  → distinct
 *  F. Payments made several days apart (within threshold)   → possible_duplicate
 *  G. Multiple partial payments toward one obligation       → possible_partial_split
 *  H. Wrong amount + complementary re-entry (the 5,000+5,000 = 10,000 case) → possible_correction
 *  I. Different children of the same family                 → distinct (the sibling class)
 *  J. Different academic years                              → distinct
 *  K. Different purposes (identical amounts)                → distinct
 *  L. Same source cell with a changed amount                → conflicting_information
 *  M. Insufficient information                              → insufficient_information
 *  N. Overpayments (single record + obligation projection)
 *  O. Determinism, purity (no input mutation), refunded/cancelled exclusion,
 *     pair scoping, and the NEVER-AUTO-MODIFY contract (findings only).
 */
import { describe, expect, it } from "vitest";
import {
  ATTRIBUTE_WEIGHTS,
  DEFAULT_PAYMENT_CONFLICT_THRESHOLDS,
  detectOverpayments,
  detectPaymentConflicts,
  classifyPaymentPair,
  comparePaymentSubjects,
  projectObligationTotals,
  type PaymentConflictSubject,
} from "@domain/calc/payment/payment-conflict";

function subject(overrides: Partial<PaymentConflictSubject> & { key: string }): PaymentConflictSubject {
  return {
    origin: "application",
    parentId: "p-1",
    studentId: "stu-1",
    studentNameKey: null,
    amount: 50_000,
    collectedAt: "2026-09-15T00:00:00.000Z",
    category: "tuition",
    installmentId: null,
    academicYearId: "ay-2627",
    method: "cash",
    status: "paid",
    receiptNumber: null,
    sourceKey: null,
    description: null,
    expectedAmount: null,
    label: null,
    ...overrides,
  };
}

function classify(a: PaymentConflictSubject, b: PaymentConflictSubject) {
  const cmp = comparePaymentSubjects(a, b);
  return { cmp, finding: classifyPaymentPair(cmp) };
}

/* ============================================================ */
/*  A. Reliable shared identifiers → confirmed_duplicate         */
/* ============================================================ */
describe("T-638 — A. confirmed duplicates (reliable identity evidence)", () => {
  it("the same receipt number + same amount → confirmed_duplicate (never a mere score)", () => {
    const { finding } = classify(
      subject({ key: "pay-1", receiptNumber: "REC-77" }),
      subject({ key: "pay-2", receiptNumber: "REC-77" }),
    );
    expect(finding.class).toBe("confirmed_duplicate");
    expect(finding.requiresReview).toBe(true);
    expect(finding.reason).toContain("reçu");
  });

  it("the same import source cell + same amount → confirmed_duplicate (the re-import identity)", () => {
    const { finding } = classify(
      subject({ key: "imp-1", origin: "import", sourceKey: "IMP-stu-1-V2" }),
      subject({ key: "pay-1", origin: "application", sourceKey: "IMP-stu-1-V2" }),
    );
    expect(finding.class).toBe("confirmed_duplicate");
    expect(finding.reason).toContain("cellule source");
  });

  it("the same receipt but a DIFFERENT amount → conflicting_information (the source disagrees with itself)", () => {
    const { finding } = classify(
      subject({ key: "pay-1", receiptNumber: "REC-9", amount: 50_000 }),
      subject({ key: "pay-2", receiptNumber: "REC-9", amount: 40_000 }),
    );
    expect(finding.class).toBe("conflicting_information");
  });
});

/* ============================================================ */
/*  B. Exact profile without identifiers → high confidence       */
/* ============================================================ */
describe("T-638 — B. exact multi-attribute profile (no receipt/source)", () => {
  it("same student+family+amount+date+category → high_confidence_duplicate", () => {
    const { finding } = classify(
      subject({ key: "pay-x", receiptNumber: "R-A" }),
      subject({ key: "pay-y", receiptNumber: "R-B" }),
    );
    expect(finding.class).toBe("high_confidence_duplicate");
    expect(finding.certainty).toBeGreaterThanOrEqual(
      DEFAULT_PAYMENT_CONFLICT_THRESHOLDS.highConfidenceCertainty,
    );
    // receipts differ (informational) — that must NOT block the class:
    expect(finding.differingEvidence.join(" ")).toContain("Reçus distincts");
  });
});

/* ============================================================ */
/*  C/D. Missing information reduces certainty, never confirms   */
/* ============================================================ */
describe("T-638 — C. missing dates", () => {
  it("same subject + amount, one date missing → possible_duplicate, never high-confidence", () => {
    const { finding, cmp } = classify(
      subject({ key: "pay-1", collectedAt: "2026-09-15T00:00:00.000Z" }),
      subject({ key: "pay-2", collectedAt: null }),
    );
    expect(finding.class).toBe("possible_duplicate");
    expect(finding.certainty).toBeLessThan(DEFAULT_PAYMENT_CONFLICT_THRESHOLDS.highConfidenceCertainty);
    expect(cmp.missing).toContain("date");
    expect(finding.missingEvidence.join(" ")).toContain("Date de paiement manquante");
  });

  it("BOTH dates missing → still only possible_duplicate with the gap named", () => {
    const { finding } = classify(
      subject({ key: "a", collectedAt: null }),
      subject({ key: "b", collectedAt: null }),
    );
    expect(finding.class).toBe("possible_duplicate");
    expect(finding.missingEvidence.some((e) => e.includes("Date de paiement manquante"))).toBe(true);
  });
});

describe("T-638 — D. missing purposes", () => {
  it("category missing on one side → class DEGRADES to possible_duplicate; the missing evidence is named", () => {
    const { finding, cmp } = classify(
      subject({ key: "a", category: "tuition" }),
      subject({ key: "b", category: null }),
    );
    expect(cmp.missing).toContain("category");
    // Without the purpose we cannot rule out two different services —
    // the class must degrade, never stay high-confidence:
    expect(finding.class).toBe("possible_duplicate");
    expect(finding.certainty).toBeLessThan(DEFAULT_PAYMENT_CONFLICT_THRESHOLDS.highConfidenceCertainty);
    expect(finding.missingEvidence.some((e) => e.includes("Catégorie"))).toBe(true);
  });
});

/* ============================================================ */
/*  E. Two legitimate same-amount payments, dates far apart      */
/* ============================================================ */
describe("T-638 — E. legitimate repeats (dates far apart)", () => {
  it("same amount + subject but 60 days apart → distinct (with the reason)", () => {
    const { finding } = classify(
      subject({ key: "a", collectedAt: "2026-09-15T00:00:00.000Z" }),
      subject({ key: "b", collectedAt: "2026-11-15T00:00:00.000Z" }),
    );
    expect(finding.class).toBe("distinct");
    expect(finding.requiresReview).toBe(false);
    expect(finding.reason).toContain("légitimes");
  });

  it("the 7-day boundary is exact: 7 days → near, 8 days → differ", () => {
    expect(
      classify(
        subject({ key: "a", collectedAt: "2026-09-10T00:00:00.000Z" }),
        subject({ key: "b", collectedAt: "2026-09-17T00:00:00.000Z" }),
      ).finding.class,
    ).toBe("possible_duplicate");
    expect(
      classify(
        subject({ key: "a", collectedAt: "2026-09-10T00:00:00.000Z" }),
        subject({ key: "b", collectedAt: "2026-09-18T00:00:00.000Z" }),
      ).finding.class,
    ).toBe("distinct");
  });
});

/* ============================================================ */
/*  F. Days apart (the near-date class)                          */
/* ============================================================ */
describe("T-638 — F. similar payments several days apart", () => {
  it("3 days apart, same subject+amount+category → possible_duplicate with the gap in the evidence", () => {
    const { finding, cmp } = classify(
      subject({ key: "a", collectedAt: "2026-09-10T00:00:00.000Z" }),
      subject({ key: "b", collectedAt: "2026-09-13T00:00:00.000Z" }),
    );
    expect(finding.class).toBe("possible_duplicate");
    expect(cmp.daysApart).toBe(3);
    expect(finding.matchingEvidence.some((e) => e.includes("3 jour(s)"))).toBe(true);
  });
});

/* ============================================================ */
/*  G/H. Obligation arithmetic — partials and corrections         */
/* ============================================================ */
describe("T-638 — G. partial payments toward one obligation", () => {
  it("60,000 + 40,000 toward a 100,000 obligation → possible_partial_split", () => {
    const { finding } = classify(
      subject({ key: "a", amount: 60_000, expectedAmount: 100_000, collectedAt: "2026-09-15T00:00:00.000Z" }),
      subject({ key: "b", amount: 40_000, expectedAmount: 100_000, collectedAt: "2026-10-02T00:00:00.000Z" }),
    );
    expect(finding.class).toBe("possible_partial_split");
    expect(finding.reason).toContain("partiels");
  });

  it("without a known expected amount → NO partial/correction class is invented", () => {
    const { finding } = classify(
      subject({ key: "a", amount: 60_000, expectedAmount: null }),
      subject({ key: "b", amount: 40_000, expectedAmount: null }),
    );
    // amounts differ → no duplicate lane; no invented obligation → distinct.
    expect(finding.class).toBe("distinct");
  });
});

describe("T-638 — H. the owner's 10,000 / 5,000+5,000 correction case", () => {
  it("two equal 5,000 halves summing to the 10,000 obligation → possible_correction (NOT a duplicate)", () => {
    const { finding } = classify(
      subject({
        key: "a",
        amount: 5_000,
        expectedAmount: 10_000,
        collectedAt: "2026-09-15T00:00:00.000Z",
      }),
      subject({
        key: "b",
        amount: 5_000,
        expectedAmount: 10_000,
        collectedAt: "2026-09-16T00:00:00.000Z",
      }),
    );
    expect(finding.class).toBe("possible_correction");
    // The mandate: the reason must present BOTH readings, never assume:
    expect(finding.reason).toContain("erreur");
    expect(finding.reason).toContain("deux versements prévus");
    expect(finding.class).not.toBe("confirmed_duplicate");
    expect(finding.class).not.toBe("high_confidence_duplicate");
  });

  it("equal halves WITHOUT a known obligation → falls back to possible_duplicate (never correction-by-invention)", () => {
    const { finding } = classify(
      subject({ key: "a", amount: 5_000, expectedAmount: null, collectedAt: "2026-09-15T00:00:00.000Z" }),
      subject({ key: "b", amount: 5_000, expectedAmount: null, collectedAt: "2026-09-16T00:00:00.000Z" }),
    );
    expect(finding.class).toBe("possible_duplicate");
  });

  it("two FULL 10,000 payments for a 10,000 obligation (sum 20,000) → the duplicate lanes, not correction", () => {
    const { finding } = classify(
      subject({ key: "a", amount: 10_000, expectedAmount: 10_000, collectedAt: "2026-09-15T00:00:00.000Z" }),
      subject({ key: "b", amount: 10_000, expectedAmount: 10_000, collectedAt: "2026-09-15T00:00:00.000Z" }),
    );
    expect(finding.class).toBe("high_confidence_duplicate");
  });
});

/* ============================================================ */
/*  I/J/K. Distinguishing attributes → distinct                   */
/* ============================================================ */
describe("T-638 — I. different children of the same family (the sibling class)", () => {
  it("same family+amount+date, different KNOWN students → distinct with the sibling rationale", () => {
    const { finding } = classify(
      subject({ key: "a", studentId: "stu-1" }),
      subject({ key: "b", studentId: "stu-2" }),
    );
    expect(finding.class).toBe("distinct");
    expect(finding.reason).toContain("Élèves différents");
  });

  it("NULL students never count as sibling evidence (one null + one known stays comparable-missing)", () => {
    const { cmp } = classify(
      subject({ key: "a", studentId: null }),
      subject({ key: "b", studentId: "stu-2" }),
    );
    expect(cmp.attributes.find((x) => x.attribute === "student")?.verdict).toBe("missing");
  });

  it("the NAME key distinguishes siblings when one side carries no id (the new-child import shape)", () => {
    // The incoming import row for a NEW child of an existing family: no id
    // resolvable yet, but the workbook carries the child's name — and the
    // family's existing payment belongs to a DIFFERENT named child.
    const { finding, cmp } = classify(
      subject({ key: "imp-b", studentId: null, studentNameKey: "BENALI KARIM" }),
      subject({ key: "pay-a", studentId: "stu-1", studentNameKey: "BENALI AMINE" }),
    );
    expect(cmp.attributes.find((x) => x.attribute === "student")?.verdict).toBe("differ");
    expect(finding.class).toBe("distinct");
    expect(finding.reason).toContain("Élèves différents");
  });

  it("the NAME key MATCHES the same child when the id is absent on one side (the re-import shape)", () => {
    const { finding, cmp } = classify(
      subject({ key: "imp-a", studentId: null, studentNameKey: "BENALI AMINE" }),
      subject({ key: "pay-a", studentId: "stu-1", studentNameKey: "BENALI AMINE" }),
    );
    expect(cmp.attributes.find((x) => x.attribute === "student")?.verdict).toBe("match");
    // Same child + same amount + same date → the duplicate signature:
    expect(finding.class).toBe("high_confidence_duplicate");
  });

  it("the id OVERRIDES the name when both sides carry ids (a renamed student is still the same child)", () => {
    const { cmp } = classify(
      subject({ key: "a", studentId: "stu-1", studentNameKey: "OLD NAME" }),
      subject({ key: "b", studentId: "stu-1", studentNameKey: "NEW NAME" }),
    );
    expect(cmp.attributes.find((x) => x.attribute === "student")?.verdict).toBe("match");
  });
});

describe("T-638 — J. different academic years", () => {
  it("identical amounts, different years → distinct (each settles its own year)", () => {
    const { finding } = classify(
      subject({ key: "a", academicYearId: "ay-2526" }),
      subject({ key: "b", academicYearId: "ay-2627" }),
    );
    expect(finding.class).toBe("distinct");
    expect(finding.reason).toContain("Années scolaires différentes");
  });
});

describe("T-638 — K. identical amounts, different purposes", () => {
  it("tuition vs transport, same amount+student+date → distinct with the purpose rationale", () => {
    const { finding } = classify(
      subject({ key: "a", category: "tuition" }),
      subject({ key: "b", category: "transport" }),
    );
    expect(finding.class).toBe("distinct");
    expect(finding.reason).toContain("Objets");
  });
});

/* ============================================================ */
/*  L. Conflicting source information                            */
/* ============================================================ */
describe("T-638 — L. conflicting information", () => {
  it("same source cell, changed amount (overlapping workbooks) → conflicting_information", () => {
    const { finding } = classify(
      subject({ key: "imp-1", origin: "import", sourceKey: "IMP-stu-1-V2", amount: 122_000 }),
      subject({ key: "pay-1", origin: "application", sourceKey: "IMP-stu-1-V2", amount: 100_000 }),
    );
    expect(finding.class).toBe("conflicting_information");
    expect(finding.differingEvidence.join(" ")).toContain("Montants différents");
  });
});

/* ============================================================ */
/*  M. Insufficient information                                  */
/* ============================================================ */
describe("T-638 — M. insufficient information", () => {
  it("only family + amount comparable (no student, date, category, year) → insufficient_information", () => {
    const bare = {
      studentId: null,
      collectedAt: null,
      category: null,
      academicYearId: null,
      installmentId: null,
      method: null,
    };
    const { finding } = classify(
      subject({ key: "a", ...bare }),
      subject({ key: "b", ...bare }),
    );
    expect(finding.class).toBe("insufficient_information");
    expect(finding.requiresReview).toBe(true);
    expect(finding.reason).toContain("insuffisantes");
    // The record is preserved — the finding documents, never decides:
    expect(finding.matchingEvidence.length).toBeLessThanOrEqual(2);
  });
});

/* ============================================================ */
/*  N. Overpayments and obligation projection                    */
/* ============================================================ */
describe("T-638 — N1. single-record overpayment", () => {
  it("amount above the known expected → overpayment with the excess", () => {
    const out = detectOverpayments([
      subject({ key: "a", amount: 150_000, expectedAmount: 122_000 }),
      subject({ key: "b", amount: 122_000, expectedAmount: 122_000 }),
      subject({ key: "c", amount: 122_000, expectedAmount: null }), // no expected → never flagged
      subject({ key: "d", amount: 100_000, expectedAmount: 122_000, status: "refunded" }), // corrected → excluded
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].subject.key).toBe("a");
    expect(out[0].excess).toBe(28_000);
    expect(out[0].reason).toContain("excédent");
  });
});

describe("T-638 — N2. obligation projection (current → projected → expected)", () => {
  const existing = [
    subject({ key: "pay-1", parentId: "p-1", studentId: "stu-1", category: "tuition", amount: 100_000 }),
  ];
  const incoming = [
    subject({ key: "imp-1", origin: "import", parentId: "p-1", studentId: "stu-1", category: "tuition", amount: 22_000 }),
  ];
  const expected = new Map([["p-1|stu-1|tuition", 122_000]]);

  it("projects current + incoming against the expected total", () => {
    const rows = projectObligationTotals(existing, incoming, expected);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.currentPaid).toBe(100_000);
    expect(row.incoming).toBe(22_000);
    expect(row.projectedPaid).toBe(122_000);
    expect(row.expectedTotal).toBe(122_000);
    expect(row.changesTotal).toBe(true);
    expect(row.overpaid).toBe(false);
  });

  it("flags overpayment at the group level when the projection exceeds the obligation", () => {
    const rows = projectObligationTotals(existing, [
      subject({ key: "imp-1", origin: "import", parentId: "p-1", studentId: "stu-1", category: "tuition", amount: 50_000 }),
    ], expected);
    expect(rows[0].projectedPaid).toBe(150_000);
    expect(rows[0].overpaid).toBe(true);
  });

  it("unknown expected totals stay null (never invented)", () => {
    const rows = projectObligationTotals(existing, incoming, new Map());
    expect(rows[0].expectedTotal).toBeNull();
    expect(rows[0].overpaid).toBe(false);
  });

  it("cancelled/refunded records are excluded from BOTH lanes", () => {
    const rows = projectObligationTotals(
      [subject({ key: "pay-r", status: "refunded", amount: 999_999 })],
      [subject({ key: "imp-c", origin: "import", status: "cancelled", amount: 888_888 })],
      expected,
    );
    expect(rows).toHaveLength(0);
  });
});

/* ============================================================ */
/*  O. Detection: grouping, scoping, determinism, purity          */
/* ============================================================ */
describe("T-638 — O1. detectPaymentConflicts grouping and scoping", () => {
  const registered = [
    subject({ key: "pay-1", studentId: "stu-1", parentId: "p-1", amount: 50_000, collectedAt: "2026-09-15T00:00:00.000Z" }),
    subject({ key: "pay-2", studentId: "stu-2", parentId: "p-1", amount: 50_000, collectedAt: "2026-09-15T00:00:00.000Z" }),
  ];
  const projected = [
    subject({ key: "imp-1", origin: "import", studentId: "stu-1", parentId: "p-1", amount: 50_000, collectedAt: "2026-09-18T00:00:00.000Z" }),
    // The same-workbook ambiguity shape: a second projected row for the
    // same student carrying the SAME tranche amount on the SAME anchor
    // date (e.g. V2 and SEPTEMBRE both filled) — distinct source cells.
    subject({ key: "imp-2", origin: "import", studentId: "stu-1", parentId: "p-1", amount: 50_000, collectedAt: "2026-09-18T00:00:00.000Z" }),
  ];

  it("incoming-vs-existing scope: cross pairs only, no internal import pairs", () => {
    const findings = detectPaymentConflicts([...registered, ...projected], {
      pairScope: "incoming-vs-existing",
    });
    for (const f of findings) {
      expect(f.comparison.a.origin).not.toBe(f.comparison.b.origin);
    }
    // imp-1 vs pay-1 (near date, same subject) → possible_duplicate:
    expect(findings.some((f) => f.class === "possible_duplicate")).toBe(true);
  });

  it("incoming-vs-any scope ALSO catches the same-workbook internal ambiguity (V2 + SEPTEMBRE = the same tranche 1 twice)", () => {
    const findings = detectPaymentConflicts([...registered, ...projected], {
      pairScope: "incoming-vs-any",
    });
    const internal = findings.find((f) => f.comparison.a.key === "imp-1" && f.comparison.b.key === "imp-2");
    expect(internal).toBeDefined();
    expect(internal!.class).toBe("high_confidence_duplicate");
  });

  it("the auditor scope (all) includes existing-vs-existing pairs", () => {
    const findings = detectPaymentConflicts([...registered, ...projected], { pairScope: "all" });
    expect(findings.some((f) => f.comparison.a.key === "pay-1" && f.comparison.b.key === "pay-2")).toBe(true);
  });

  it("cross-family pairs are never candidates", () => {
    const findings = detectPaymentConflicts([
      subject({ key: "x", parentId: "p-1", studentId: "stu-1", amount: 50_000 }),
      subject({ key: "y", parentId: "p-2", studentId: "stu-9", amount: 50_000 }),
    ]);
    expect(findings).toHaveLength(0);
  });

  it("subjects with no family AND no student link are never candidates", () => {
    const findings = detectPaymentConflicts([
      subject({ key: "x", parentId: null, studentId: null, amount: 50_000 }),
      subject({ key: "y", parentId: null, studentId: null, amount: 50_000 }),
    ]);
    expect(findings).toHaveLength(0);
  });

  it("refunded/cancelled records are excluded from candidates (already corrected)", () => {
    const findings = detectPaymentConflicts([
      subject({ key: "a", amount: 50_000, status: "refunded" }),
      subject({ key: "b", amount: 50_000, status: "paid" }),
    ]);
    expect(findings).toHaveLength(0);
  });

  it("a 1,200-payment single-family shape with unique amounts computes ZERO pairs (the complexity guard)", () => {
    const many = Array.from({ length: 1_200 }, (_, i) =>
      subject({ key: `pay-${i}`, amount: 10_000 + i, collectedAt: "2026-09-10" }),
    );
    const findings = detectPaymentConflicts(many);
    expect(findings).toHaveLength(0);
  });
});

describe("T-638 — O2. determinism and purity", () => {
  const pool = [
    subject({ key: "a", studentId: "stu-1", amount: 50_000, collectedAt: "2026-09-15T00:00:00.000Z" }),
    subject({ key: "b", studentId: "stu-1", amount: 50_000, collectedAt: "2026-09-16T00:00:00.000Z" }),
    subject({ key: "c", studentId: "stu-2", amount: 50_000, collectedAt: "2026-09-15T00:00:00.000Z" }),
    subject({ key: "d", studentId: null, parentId: "p-1", amount: 50_000, collectedAt: null, category: null, academicYearId: null }),
  ];

  it("identical inputs → identical findings in identical order (100 shuffled runs)", () => {
    const first = detectPaymentConflicts(pool);
    for (let i = 0; i < 100; i++) {
      const shuffled = [...pool];
      // Fisher-Yates with a fixed seed pattern (deterministic shuffles).
      for (let j = shuffled.length - 1; j > 0; j--) {
        const k = (i * 7 + j * 13) % (j + 1);
        [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
      }
      expect(detectPaymentConflicts(shuffled).map((f) => f.id)).toEqual(first.map((f) => f.id));
    }
    expect(first.length).toBeGreaterThan(0);
  });

  it("inputs are NEVER mutated (deep-frozen)", () => {
    const frozen = pool.map((s) => Object.freeze({ ...s }));
    expect(() => detectPaymentConflicts(frozen)).not.toThrow();
  });

  it("finding ids are stable and unique", () => {
    const findings = detectPaymentConflicts(pool);
    const ids = findings.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith("conflict:")).toBe(true);
  });
});

describe("T-638 — O3. the certainty contract", () => {
  it("the weights are documented and sum to 1.00", () => {
    const sum = Object.values(ATTRIBUTE_WEIGHTS).reduce((s, w) => s + w, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });

  it("missing attributes contribute ZERO agreement — the certainty is the agreement weight over all 1.00 of evidence", () => {
    const full = comparePaymentSubjects(
      subject({ key: "a" }),
      subject({ key: "b" }),
    );
    const noDate = comparePaymentSubjects(
      subject({ key: "a", collectedAt: null }),
      subject({ key: "b", collectedAt: null }),
    );
    // Full profile (installment not linked in the default subject):
    // 0.30 + 0.20 + 0.20 + 0.10 + 0.10 + 0.05 = 0.95 comparable, all agree.
    expect(full.certainty).toBeCloseTo(0.95, 9);
    // Missing date: the 0.10 date weight leaves the agreement entirely.
    expect(noDate.certainty).toBeCloseTo(0.85, 9);
    expect(noDate.certainty!).toBeLessThan(full.certainty!);
  });

  it("a near date contributes half its weight (0.10 → 0.05)", () => {
    const cmp = comparePaymentSubjects(
      subject({ key: "a", collectedAt: "2026-09-10T00:00:00.000Z" }),
      subject({ key: "b", collectedAt: "2026-09-13T00:00:00.000Z" }),
    );
    // 0.95 (full comparable) − 0.10 (date) + 0.05 (near) = 0.90.
    expect(cmp.certainty).toBeCloseTo(0.9, 9);
  });
});
