/**
 * ER-PMAE confidence scoring + decision bands — identity-rules §5 (T-438 / ADR-032).
 *
 * Field-level evidence with signed weights (the Fellegi-Sunter-style model
 * from the conceptual article, adapted: the weights are the documented
 * domain constants in identity-rules §5.1 — INV-49), squashed through a
 * logistic into [0,1], then classified into the four bands.
 */
import {
  compareNames as nameScore,
  comparePhones as phoneSets,
} from "./similarity";
import {
  ER_BAND_THRESHOLDS,
  ER_EVIDENCE_WEIGHTS,
  ER_NAME_COMPARISON,
} from "./types";
import type {
  ErDecisionBand,
  ErEvidenceStatus,
  ErMatchEvidence,
  ErNormalized,
  ErPairScore,
  ErVetoId,
} from "./types";

/** Classify a confidence value into its band (identity-rules §5.2). */
export function bandOf(confidence: number): ErDecisionBand {
  if (confidence >= ER_BAND_THRESHOLDS.definite) return "definite";
  if (confidence >= ER_BAND_THRESHOLDS.probable) return "probable";
  if (confidence >= ER_BAND_THRESHOLDS.review) return "review";
  return "separate";
}

/** Logistic squash: 1 / (1 + e^−x) — maps the summed weights into [0,1]. */
function squash(sum: number): number {
  return 1 / (1 + Math.exp(-sum));
}

function evidence(
  field: string,
  status: ErEvidenceStatus,
  weight: number,
  detail: string,
): ErMatchEvidence {
  return { field, status, weight, detail };
}

/**
 * Score one normalized pair (identity-rules §4–§5).
 *
 * Stage order per the rules: vetoes first (a triggered veto forces
 * `separate` with confidence 0), then the deterministic gate (an exact
 * strong identifier — a canonical code, OR the issue-#16 Band-1 condition
 * "matching phone + full fuzzy name ≥ 0.85" — short-circuits to 1.0), then
 * the probabilistic model.
 */
export function scorePair(
  a: ErNormalized,
  b: ErNormalized,
  vetoes: readonly ErVetoId[],
  strongIdMatch: boolean,
): ErPairScore {
  const aId = a.observationId;
  const bId = b.observationId;

  // Stage 1 — any veto forces separation (confidence pinned to 0).
  if (vetoes.length > 0) {
    return {
      aId,
      bId,
      confidence: 0,
      band: "separate",
      evidence: [
        evidence("vetoes", "mismatch", -1, `Veto dur déclenché : ${vetoes.join(", ")}`),
      ],
      vetoes,
    };
  }

  // Stage 2 — the deterministic gate: (a) an exact strong identifier (a
  // canonical deterministic code / national-id-class evidence), OR (b) the
  // issue-#16 Band-1 condition — an exact shared phone AND full fuzzy name
  // similarity ≥ 0.85 — resolves deterministically at maximum confidence.
  const nameSimilarity = nameScore(a.nameTokens, b.nameTokens);
  const phoneIntersection = a.phones.filter((p) => b.phones.includes(p));
  if (
    strongIdMatch ||
    (phoneIntersection.length > 0 && nameSimilarity >= ER_NAME_COMPARISON.deterministicNameFloor)
  ) {
    return {
      aId,
      bId,
      confidence: 1,
      band: "definite",
      evidence: [
        evidence(
          "national-id",
          "exact",
          ER_EVIDENCE_WEIGHTS.nationalId.match,
          strongIdMatch
            ? "Identifiant déterministe exact (code canonique)"
            : `Porte déterministe : téléphone exact partagé (${phoneIntersection.join(", ")}) + nom ≥ 0.85 (${nameSimilarity.toFixed(2)})`,
        ),
        evidence("phones", "exact", ER_EVIDENCE_WEIGHTS.phoneUnique.match, `Téléphone(s) partagé(s) : ${phoneIntersection.join(", ")}`),
        evidence("name", "fuzzy", ER_EVIDENCE_WEIGHTS.nameStrong.match, `Nom fortement similaire (score ${nameSimilarity.toFixed(2)})`),
      ],
      vetoes: [],
    };
  }

  // Stage 3 — the probabilistic multi-field model.
  const items: ErMatchEvidence[] = [];
  let sum = 0;

  // 3a. Phones (set semantics — INV-43).
  const phones = phoneSets(a.phones, b.phones);
  if (a.phones.length > 0 && b.phones.length > 0) {
    if (phones.intersection.length > 0) {
      sum += ER_EVIDENCE_WEIGHTS.phoneUnique.match;
      items.push(
        evidence(
          "phones",
          "exact",
          ER_EVIDENCE_WEIGHTS.phoneUnique.match,
          `Téléphone(s) partagé(s) : ${phones.intersection.join(", ")}`,
        ),
      );
    } else {
      sum += ER_EVIDENCE_WEIGHTS.phoneUnique.mismatch;
      items.push(
        evidence(
          "phones",
          "mismatch",
          ER_EVIDENCE_WEIGHTS.phoneUnique.mismatch,
          "Téléphones renseignés des deux côtés, aucun en commun",
        ),
      );
    }
  } else {
    items.push(evidence("phones", "missing", 0, "Téléphone absent d'un côté — aucune preuve"));
  }

  // 3b. Email (when both carry one).
  if (a.email !== null && b.email !== null) {
    if (a.email === b.email) {
      sum += ER_EVIDENCE_WEIGHTS.email.match;
      items.push(
        evidence("email", "exact", ER_EVIDENCE_WEIGHTS.email.match, `E-mail identique : ${a.email}`),
      );
    } else {
      sum += ER_EVIDENCE_WEIGHTS.email.mismatch;
      items.push(evidence("email", "mismatch", ER_EVIDENCE_WEIGHTS.email.mismatch, "E-mails différents"));
    }
  } else {
    items.push(evidence("email", "missing", 0, "E-mail absent — aucune preuve"));
  }

  // 3c. The name (the asymmetric comparator — INV-47).
  const nameScoreValue = nameSimilarity;
  if (a.nameTokens.length > 0 && b.nameTokens.length > 0) {
    if (nameScoreValue >= ER_NAME_COMPARISON.strongSimilarityFloor) {
      sum += ER_EVIDENCE_WEIGHTS.nameStrong.match;
      items.push(
        evidence(
          "name",
          "fuzzy",
          ER_EVIDENCE_WEIGHTS.nameStrong.match,
          `Nom fortement similaire (score ${nameScoreValue.toFixed(2)})`,
        ),
      );
    } else if (nameScoreValue >= 0.5) {
      // A weak/partial name alignment: initial-level evidence.
      sum += ER_EVIDENCE_WEIGHTS.nameInitial.match;
      items.push(
        evidence(
          "name",
          "initial",
          ER_EVIDENCE_WEIGHTS.nameInitial.match,
          `Nom partiellement similaire (score ${nameScoreValue.toFixed(2)})`,
        ),
      );
    } else {
      sum += ER_EVIDENCE_WEIGHTS.nameStrong.mismatch;
      items.push(
        evidence(
          "name",
          "mismatch",
          ER_EVIDENCE_WEIGHTS.nameStrong.mismatch,
          `Noms nettement différents (score ${nameScoreValue.toFixed(2)})`,
        ),
      );
    }
  } else {
    items.push(evidence("name", "missing", 0, "Nom absent — aucune preuve"));
  }

  // 3d. Context — supporting evidence only (INV-48): grade + transport.
  if (a.gradeRank !== null && b.gradeRank !== null) {
    if (Math.abs(a.gradeRank - b.gradeRank) <= 1) {
      sum += ER_EVIDENCE_WEIGHTS.grade.match;
      items.push(evidence("grade", "exact", ER_EVIDENCE_WEIGHTS.grade.match, "Niveau scolaire compatible"));
    } else {
      sum += ER_EVIDENCE_WEIGHTS.grade.mismatch;
      items.push(evidence("grade", "mismatch", ER_EVIDENCE_WEIGHTS.grade.mismatch, "Niveaux scolaires éloignés"));
    }
  } else {
    items.push(evidence("grade", "missing", 0, "Niveau scolaire inconnu"));
  }
  if (a.transportKey !== null && b.transportKey !== null) {
    if (a.transportKey === b.transportKey) {
      sum += ER_EVIDENCE_WEIGHTS.transport.match;
      items.push(
        evidence("transport", "exact", ER_EVIDENCE_WEIGHTS.transport.match, "Destination de transport identique"),
      );
    } else {
      sum += ER_EVIDENCE_WEIGHTS.transport.mismatch;
      items.push(
        evidence(
          "transport",
          "mismatch",
          ER_EVIDENCE_WEIGHTS.transport.mismatch,
          "Destinations de transport différentes",
        ),
      );
    }
  } else {
    items.push(evidence("transport", "missing", 0, "Transport inconnu"));
  }

  const confidence = squash(sum);
  return {
    aId,
    bId,
    confidence: Math.round(confidence * 10000) / 10000,
    band: bandOf(confidence),
    evidence: items,
    vetoes: [],
  };
}
