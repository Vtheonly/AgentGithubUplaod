/**
 * ER-PMAE hard vetoes — identity-rules §4.1 (T-438 / ADR-032).
 *
 * Negative evidence runs BEFORE any positive score: siblings sharing a
 * household's phone and surname must never be merged into one person
 * (INV-46). A veto is evidence about a PAIR (recorded only as a review
 * rejection's negative edge — identity-rules §4.1 note).
 */
import { levenshteinSimilarity } from "./similarity";
import { tokenContainment } from "./similarity";
import { ER_SIBLING_GUARDRAIL, ER_SAME_YEAR_CONTAINMENT_FLOOR } from "./types";
import type { ErNormalized, ErVetoId } from "./types";

/**
 * Evaluate the hard vetoes for a normalized pair.
 * Returns the triggered veto ids (empty = passed).
 */
export function evaluateVetoes(a: ErNormalized, b: ErNormalized): readonly ErVetoId[] {
  const vetoes: ErVetoId[] = [];

  // Veto 1 — the sibling guardrail (INV-46): shared contact + fully-formed
  // DISTINCT given names (low similarity) + ≥ 2 grade-rank divergence.
  // Recording order is NOT trusted ("SEDIKI Ishak" is surname-first while
  // "Ishak SEDIKI" is given-name-first) — the guardrail therefore compares
  // the tokens the two names do NOT share (the given names), taking the
  // MOST similar distinct-token pair as the "same given name?" probe.
  const sharePhone = a.phones.some((p) => b.phones.includes(p));
  if (sharePhone && a.nameTokens.length > 0 && b.nameTokens.length > 0) {
    const tokensA = a.nameTokens.filter((t) => !b.nameTokens.includes(t));
    const tokensB = b.nameTokens.filter((t) => !a.nameTokens.includes(t));
    // Only meaningful when both carry a distinct token beside the shared
    // household surname (or when the names are entirely disjoint).
    if (tokensA.length > 0 && tokensB.length > 0) {
      let bestSimilarity = 0;
      for (const ta of tokensA) {
        for (const tb of tokensB) {
          const sim = levenshteinSimilarity(ta, tb);
          if (sim > bestSimilarity) bestSimilarity = sim;
        }
      }
      const bothFormed = tokensA.every(
        (t) => t.length > ER_SIBLING_GUARDRAIL.minFirstNameLength,
      ) && tokensB.every((t) => t.length > ER_SIBLING_GUARDRAIL.minFirstNameLength);
      if (
        bothFormed &&
        bestSimilarity < ER_SIBLING_GUARDRAIL.firstNameSimilarityFloor &&
        a.gradeRank !== null &&
        b.gradeRank !== null &&
        Math.abs(a.gradeRank - b.gradeRank) >= ER_SIBLING_GUARDRAIL.gradeRankDivergence
      ) {
        vetoes.push("sibling-guardrail");
      }
    }
  }

  // Veto 2 — demographic incompatibility: both genders recorded and different.
  if (a.gender !== null && b.gender !== null && a.gender !== b.gender) {
    vetoes.push("demographic-incompatibility");
  }

  // Veto 3 — same-year identity clash: same academic year recorded on both,
  // yet the name token containment is below the floor (different concurrent
  // registrations, not one person).
  if (a.academicYear !== null && a.academicYear === b.academicYear) {
    const containment = Math.max(
      tokenContainment(a.nameTokens, b.nameTokens),
      tokenContainment(b.nameTokens, a.nameTokens),
    );
    if (containment < ER_SAME_YEAR_CONTAINMENT_FLOOR) {
      vetoes.push("same-year-identity-clash");
    }
  }

  return vetoes;
}
