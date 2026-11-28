// ============================================================================
// FILE: src/domain/calc/payment/payment-conflict.ts
// ============================================================================
/**
 * Payment Conflict & Similarity Engine — T-638 / FIN-115 / ADR-038.
 *
 * THE PROBLEM THIS MODULE SOLVES: the historical financial workbooks carry
 * NO unique payment identifiers or transaction references. A payment record
 * may carry an amount, a date (sometimes), a student name (sometimes), a
 * family, an academic year, a purpose, a tranche — or only a fraction of
 * these. Consequently, two similar records are AMBIGUOUS between: an
 * accidentally duplicated payment, two legitimate separate payments, partial
 * payments toward one obligation, payments on different dates, payments for
 * different children of one family, different services, a correction of a
 * mis-keyed amount, an already-registered payment, or a re-imported
 * historical row. This engine COMPARES what is known, SAYS what matches,
 * what differs and what is missing, and CLASSIFIES the relationship — it
 * NEVER decides, merges, deletes or modifies anything.
 *
 * CLASSIFICATION (AGENTS.md §15.53a): this is an ANALYTICAL layer — a PURE
 * comparison/classification engine consumed by BOTH the workbook-import
 * preview and the financial auditor (`webhook-diagnostics.ts`). There is
 * exactly ONE implementation of these rules (this file); the auditor's
 * legacy exact-tuple lane (T-511 check 3 / T-528 AUDIT-508) keeps its own
 * finding shape but its semantics are a strict subset of the classes here
 * (same-subject exact tuple ≡ `high_confidence_duplicate`; the sibling set
 * ≡ `distinct`; the shared receipt ≡ `confirmed_duplicate`).
 *
 * DESIGN CONTRACT (the owner's mandate, binding):
 *   1. Multi-attribute comparison — student, family, amount, date proximity,
 *      academic year, purpose/category, tranche/obligation, provenance
 *      (receipt/source key), method — evaluated TOGETHER, never amount-only.
 *   2. Missing information REDUCES certainty — it NEVER establishes that two
 *      payments are identical, and it NEVER invents a value.
 *   3. Every classification is EXPLAINABLE: the finding names the rule that
 *      fired, which attributes matched, which differed, which were missing.
 *   4. The certainty score is a weighted agreement fraction over the
 *      evidence dimensions — an EXPLAINABLE indicator, never a proof that
 *      a payment is duplicated.
 *   5. NEVER auto-merge, delete, overwrite or modify an uncertain record.
 *      Corrections ride the EXISTING authorized workflows.
 *   6. Deterministic and total: pure functions, no clock, no randomness,
 *      no repository access; the same inputs always produce the same
 *      findings in the same order (stable sort on subject keys).
 *   7. Refunded/cancelled records are EXCLUDED from pair candidates — an
 *      annulled payment followed by its corrected re-entry is the NORMAL
 *      correction flow, not a duplicate (the reversal history is already
 *      preserved by the existing audit trail).
 */
import type { PaymentCategory, PaymentMethod } from "../../model/payment";
// T-586/BUG-57 lineage: the canonical DZD formatter (NaN-safe) — every
// amount embedded in a clerk-facing reason is grouped the French way.
import { formatDzdPlain } from "../../../core/format/currency";

/** Integer DZD with fr-FR grouping for the reason strings. */
function dzd(n: number): string {
  return `${formatDzdPlain(Math.round(n))} DZD`;
}

/* ================================================================== */
/*  The comparison subject                                             */
/* ================================================================== */

/**
 * The minimal payment projection both sides can satisfy: a REGISTERED
 * payment (the auditor) or a PROJECTED workbook row (the import preview).
 * Every attribute is nullable — null means "this information is not
 * available", never "empty equals empty".
 */
export interface PaymentConflictSubject {
  /** Stable identity for reporting (registered payment id / projected row key). */
  readonly key: string;
  /** Where the record lives — the registered books or a projected import. */
  readonly origin: "application" | "import";
  readonly parentId: string | null;
  readonly studentId: string | null;
  /**
   * A normalized STUDENT NAME identity (uppercase, single-spaced) — the
   * fallback when the id is unavailable: it lets the comparison
   * DISTINGUISH siblings (different children of one family carry the
   * same tranche amounts by design) and MATCH a re-imported row to its
   * own student. The id ALWAYS wins when both sides carry one.
   */
  readonly studentNameKey: string | null;
  readonly amount: number;
  /** ISO date (yyyy-mm-dd…) or null = the date is unknown. */
  readonly collectedAt: string | null;
  readonly category: PaymentCategory | null;
  /** The obligation (installment/tranche) link, when known. */
  readonly installmentId: string | null;
  readonly academicYearId: string | null;
  readonly method: PaymentMethod | null;
  readonly status: string | null;
  readonly receiptNumber: string | null;
  /**
   * Provenance identity — the import source cell identity
   * (`IMP-<studentId>-<FIELD>`); two rows sharing it ARE the same source
   * record by construction. Null for payments without import provenance.
   */
  readonly sourceKey: string | null;
  /** Free-text purpose (the import description / the payment notes). */
  readonly description: string | null;
  /** The expected amount for the obligation this payment targets, when known. */
  readonly expectedAmount: number | null;
  /** Human label for evidence rendering (e.g. « Tranche 1 — Scolarité (V1) »). */
  readonly label: string | null;
}

/* ================================================================== */
/*  Thresholds                                                         */
/* ================================================================== */

export interface PaymentConflictThresholds {
  /**
   * Two dates within this many days are "near" (a weak match — the
   * similar-payments-days-apart class). Beyond it they are "differ".
   * Default 7 (one working week — the documented collection rhythm).
   */
  readonly dateProximityDays: number;
  /** Absolute DZD tolerance for amount comparisons (DZD has no sub-unit). Default 1. */
  readonly amountToleranceDzd: number;
  /**
   * The minimum summed weight of COMPARABLE attributes below which a pair
   * cannot be classified at all (insufficient information). Default 0.5 —
   * i.e. at least half the evidence must be comparable.
   */
  readonly minimumComparableWeight: number;
  /**
   * The certainty at/above which a fully-matching candidate is
   * "high confidence" rather than merely "possible". Default 0.9 — the
   * minimum fully-matching profile (student+family+amount+date+category+
   * year, installment unlinked) scores 0.95, so a single missing core
   * attribute (0.85) can NEVER reach high confidence: missing information
   * degrades the class, exactly as the mandate requires.
   */
  readonly highConfidenceCertainty: number;
}

export const DEFAULT_PAYMENT_CONFLICT_THRESHOLDS: PaymentConflictThresholds = {
  dateProximityDays: 7,
  amountToleranceDzd: 1,
  minimumComparableWeight: 0.5,
  highConfidenceCertainty: 0.9,
};

/* ================================================================== */
/*  Per-attribute comparison                                           */
/* ================================================================== */

export type PaymentComparedAttribute =
  | "student"
  | "family"
  | "amount"
  | "date"
  | "category"
  | "academicYear"
  | "installment"
  | "receipt"
  | "sourceKey"
  | "method";

/** How one attribute compared. `near` exists only for dates. */
export type AttributeVerdict = "match" | "near" | "differ" | "missing";

export interface AttributeComparison {
  readonly attribute: PaymentComparedAttribute;
  readonly verdict: AttributeVerdict;
  /** FR detail — exactly what was compared and what was found. */
  readonly detail: string;
  /** The certainty weight this attribute carries (0 for informational ones). */
  readonly weight: number;
}

/** The certainty weights — fixed, documented, explainable (sum = 1.00). */
export const ATTRIBUTE_WEIGHTS: Readonly<Record<"student" | "family" | "amount" | "date" | "category" | "academicYear" | "installment", number>> = {
  student: 0.3,
  family: 0.2,
  amount: 0.2,
  date: 0.1,
  category: 0.1,
  academicYear: 0.05,
  installment: 0.05,
};

/** The result of comparing exactly two payment subjects. */
export interface PaymentComparison {
  readonly a: PaymentConflictSubject;
  readonly b: PaymentConflictSubject;
  /** Every compared attribute, in a fixed order — including the missing ones. */
  readonly attributes: readonly AttributeComparison[];
  readonly matching: readonly PaymentComparedAttribute[];
  readonly differing: readonly PaymentComparedAttribute[];
  readonly missing: readonly PaymentComparedAttribute[];
  /** |days| between the dates, when both known; null otherwise. */
  readonly daysApart: number | null;
  /** Sum of the weights of the attributes that COULD be compared. */
  readonly comparableWeight: number;
  /** Sum of the agreement weights (a "near" date contributes half its weight). */
  readonly agreementWeight: number;
  /**
   * The weighted agreement over ALL evidence dimensions (the weights sum
   * to 1.00): a MISSING attribute contributes ZERO agreement — missing
   * information REDUCES the certainty, it never leaves it untouched.
   * null only when nothing at all could be compared.
   */
  readonly certainty: number | null;
}

function isoDay(iso: string | null): string | null {
  return iso ? iso.slice(0, 10) : null;
}

/** The normalized student-name identity (uppercase, single-spaced). */
export function normalizeStudentNameKey(name: string | null | undefined): string | null {
  if (!name) return null;
  const key = name.trim().toUpperCase().replace(/\s+/g, " ");
  return key.length > 0 ? key : null;
}

function dayDiff(aIso: string, bIso: string): number | null {
  const a = Date.parse(`${aIso.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${bIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.abs(Math.round((a - b) / 86_400_000));
}

function amountsEqual(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

/**
 * Compare two subjects attribute by attribute. Pure, total, deterministic.
 * Missing values yield `missing` — they never count as agreement.
 */
export function comparePaymentSubjects(
  a: PaymentConflictSubject,
  b: PaymentConflictSubject,
  thresholds: PaymentConflictThresholds = DEFAULT_PAYMENT_CONFLICT_THRESHOLDS,
): PaymentComparison {
  const tol = thresholds.amountToleranceDzd;
  const attributes: AttributeComparison[] = [];

  // — Student (the subject whose obligation the payment settles) —
  //     The id is authoritative when both sides carry one; otherwise the
  //     normalized NAME key refines the dimension (sibling vs same child).
  if (a.studentId !== null && b.studentId !== null) {
    attributes.push({
      attribute: "student",
      verdict: a.studentId === b.studentId ? "match" : "differ",
      detail:
        a.studentId === b.studentId
          ? `Même élève (${a.studentId})`
          : `Élèves différents (${a.studentId} vs ${b.studentId})`,
      weight: ATTRIBUTE_WEIGHTS.student,
    });
  } else if (a.studentNameKey !== null && b.studentNameKey !== null) {
    const sameName = a.studentNameKey === b.studentNameKey;
    attributes.push({
      attribute: "student",
      verdict: sameName ? "match" : "differ",
      detail: sameName
        ? `Même élève par le nom (${a.studentNameKey})`
        : `Élèves différents par le nom (${a.studentNameKey} vs ${b.studentNameKey}) — frères et sœurs ou homonymes`,
      weight: ATTRIBUTE_WEIGHTS.student,
    });
  } else {
    attributes.push({
      attribute: "student",
      verdict: "missing",
      detail: "Élève non renseigné d'au moins un côté — comparaison impossible",
      weight: ATTRIBUTE_WEIGHTS.student,
    });
  }

  // — Family —
  if (a.parentId !== null && b.parentId !== null) {
    attributes.push({
      attribute: "family",
      verdict: a.parentId === b.parentId ? "match" : "differ",
      detail:
        a.parentId === b.parentId
          ? `Même famille (${a.parentId})`
          : `Familles différentes (${a.parentId} vs ${b.parentId})`,
      weight: ATTRIBUTE_WEIGHTS.family,
    });
  } else {
    attributes.push({
      attribute: "family",
      verdict: "missing",
      detail: "Famille non renseignée d'au moins un côté",
      weight: ATTRIBUTE_WEIGHTS.family,
    });
  }

  // — Amount —
  const amountsMatch = amountsEqual(a.amount, b.amount, tol);
  {
    const relation =
      a.amount === b.amount
        ? `Montants identiques (${a.amount} DZD)`
        : amountsMatch
          ? `Montants équivalents à la tolérance près (${a.amount} vs ${b.amount} DZD)`
          : `Montants différents (${a.amount} vs ${b.amount} DZD — écart ${Math.abs(a.amount - b.amount)} DZD)`;
    attributes.push({
      attribute: "amount",
      verdict: amountsMatch ? "match" : "differ",
      detail: relation,
      weight: ATTRIBUTE_WEIGHTS.amount,
    });
  }

  // — Date (with proximity) —
  const da = isoDay(a.collectedAt);
  const db = isoDay(b.collectedAt);
  let daysApart: number | null = null;
  if (da !== null && db !== null) {
    daysApart = dayDiff(da, db);
    if (daysApart === null) {
      // One of the dates is unparseable — treat as missing, never guess.
      attributes.push({
        attribute: "date",
        verdict: "missing",
        detail: "Date non interprétable — comparaison impossible",
        weight: ATTRIBUTE_WEIGHTS.date,
      });
    } else if (daysApart === 0) {
      attributes.push({
        attribute: "date",
        verdict: "match",
        detail: `Même date (${da})`,
        weight: ATTRIBUTE_WEIGHTS.date,
      });
    } else if (daysApart <= thresholds.dateProximityDays) {
      attributes.push({
        attribute: "date",
        verdict: "near",
        detail: `Dates proches (${da} vs ${db} — ${daysApart} jour(s) d'écart)`,
        weight: ATTRIBUTE_WEIGHTS.date,
      });
    } else {
      attributes.push({
        attribute: "date",
        verdict: "differ",
        detail: `Dates éloignées (${da} vs ${db} — ${daysApart} jours d'écart)`,
        weight: ATTRIBUTE_WEIGHTS.date,
      });
    }
  } else {
    attributes.push({
      attribute: "date",
      verdict: "missing",
      detail: `Date de paiement manquante (${da === null ? "côté importé/projeté" : "côté enregistré"}${da === null && db === null ? " et côté enregistré" : da === null ? "" : " côté importé/projeté"})`,
      weight: ATTRIBUTE_WEIGHTS.date,
    });
  }

  // — Category (purpose) —
  if (a.category !== null && b.category !== null) {
    attributes.push({
      attribute: "category",
      verdict: a.category === b.category ? "match" : "differ",
      detail:
        a.category === b.category
          ? `Même catégorie (${a.category})`
          : `Catégories différentes (${a.category} vs ${b.category})`,
      weight: ATTRIBUTE_WEIGHTS.category,
    });
  } else {
    attributes.push({
      attribute: "category",
      verdict: "missing",
      detail: "Catégorie (objet du paiement) non renseignée d'au moins un côté",
      weight: ATTRIBUTE_WEIGHTS.category,
    });
  }

  // — Academic year —
  if (a.academicYearId !== null && b.academicYearId !== null) {
    attributes.push({
      attribute: "academicYear",
      verdict: a.academicYearId === b.academicYearId ? "match" : "differ",
      detail:
        a.academicYearId === b.academicYearId
          ? `Même année scolaire (${a.academicYearId})`
          : `Années scolaires différentes (${a.academicYearId} vs ${b.academicYearId})`,
      weight: ATTRIBUTE_WEIGHTS.academicYear,
    });
  } else {
    attributes.push({
      attribute: "academicYear",
      verdict: "missing",
      detail: "Année scolaire non renseignée d'au moins un côté",
      weight: ATTRIBUTE_WEIGHTS.academicYear,
    });
  }

  // — Installment (the tranche obligation link) —
  if (a.installmentId !== null && b.installmentId !== null) {
    attributes.push({
      attribute: "installment",
      verdict: a.installmentId === b.installmentId ? "match" : "differ",
      detail:
        a.installmentId === b.installmentId
          ? `Même tranche (${a.installmentId})`
          : `Tranches différentes (${a.installmentId} vs ${b.installmentId})`,
      weight: ATTRIBUTE_WEIGHTS.installment,
    });
  } else {
    attributes.push({
      attribute: "installment",
      verdict: "missing",
      detail: "Tranche rattachée non renseignée d'au moins un côté",
      weight: ATTRIBUTE_WEIGHTS.installment,
    });
  }

  // — Receipt (informational identity evidence; weight 0 — the receipt is
  //    used by the CLASSIFICATION rules, not the certainty score) —
  if (a.receiptNumber !== null && b.receiptNumber !== null) {
    attributes.push({
      attribute: "receipt",
      verdict: a.receiptNumber === b.receiptNumber ? "match" : "differ",
      detail:
        a.receiptNumber === b.receiptNumber
          ? `Même numéro de reçu (${a.receiptNumber}) — preuve d'identité fiable`
          : `Reçus distincts (${a.receiptNumber} vs ${b.receiptNumber})`,
      weight: 0,
    });
  } else {
    attributes.push({
      attribute: "receipt",
      verdict: "missing",
      detail: "Numéro de reçu absent d'au moins un côté",
      weight: 0,
    });
  }

  // — Source key (the import provenance identity; same class as receipt) —
  if (a.sourceKey !== null && b.sourceKey !== null) {
    attributes.push({
      attribute: "sourceKey",
      verdict: a.sourceKey === b.sourceKey ? "match" : "differ",
      detail:
        a.sourceKey === b.sourceKey
          ? `Même cellule source du classeur (${a.sourceKey}) — même enregistrement source par construction`
          : `Cellules sources différentes (${a.sourceKey} vs ${b.sourceKey})`,
      weight: 0,
    });
  } else {
    attributes.push({
      attribute: "sourceKey",
      verdict: "missing",
      detail: "Origine d'import non renseignée d'au moins un côté",
      weight: 0,
    });
  }

  // — Method (informational; weight 0 — a shared method is weak evidence) —
  if (a.method !== null && b.method !== null) {
    attributes.push({
      attribute: "method",
      verdict: a.method === b.method ? "match" : "differ",
      detail: a.method === b.method ? `Même mode (${a.method})` : `Modes différents (${a.method} vs ${b.method})`,
      weight: 0,
    });
  } else {
    attributes.push({
      attribute: "method",
      verdict: "missing",
      detail: "Mode de paiement non renseigné d'au moins un côté",
      weight: 0,
    });
  }

  const matching = attributes.filter((x) => x.verdict === "match" || x.verdict === "near").map((x) => x.attribute);
  const differing = attributes.filter((x) => x.verdict === "differ").map((x) => x.attribute);
  const missing = attributes.filter((x) => x.verdict === "missing").map((x) => x.attribute);
  const comparableWeight = attributes
    .filter((x) => x.verdict === "match" || x.verdict === "near" || x.verdict === "differ")
    .reduce((s, x) => s + x.weight, 0);
  const agreementWeight = attributes
    .filter((x) => x.verdict === "match" || x.verdict === "near")
    .reduce((s, x) => s + (x.verdict === "near" ? x.weight / 2 : x.weight), 0);
  // Certainty = the agreement weight itself: the seven evidence dimensions
  // sum to exactly 1.00, so a missing dimension simply leaves its weight
  // uncounted (the mandate: missing information REDUCES certainty).
  // Rounded to a micro precision so the weight sums are FP-noise-free
  // (0.3+0.2+0.2+0.1+0.1 must equal 0.9 EXACTLY for the class thresholds).
  const certainty =
    comparableWeight > 0 ? Math.round(agreementWeight * 1e6) / 1e6 : null;

  return {
    a,
    b,
    attributes,
    matching,
    differing,
    missing,
    daysApart,
    comparableWeight,
    agreementWeight,
    certainty,
  };
}

/* ================================================================== */
/*  Classification                                                     */
/* ================================================================== */

/**
 * The classification vocabulary (the owner's mandate — nine classes).
 * Every class is produced by an EXPLICIT rule below; none is a score
 * threshold alone.
 */
export type PaymentConflictClass =
  /** Reliable identity or provenance evidence: same receipt / same source cell. */
  | "confirmed_duplicate"
  /** All comparable attributes agree, exact date, distinct records. */
  | "high_confidence_duplicate"
  /** Near match: same subject + amount, dates near or missing, rest tolerant. */
  | "possible_duplicate"
  /** Amounts of different sizes sum to one known obligation. */
  | "possible_partial_split"
  /** Equal amounts summing exactly to one known obligation (the mis-key + re-entry pattern). */
  | "possible_correction"
  /** Paid exceeds the known obligation, or the projected totals disagree with the books. */
  | "tranche_balance_discrepancy"
  /** Reliable identity evidence says "same record" but the facts disagree. */
  | "conflicting_information"
  /** Too few comparable attributes to say anything. */
  | "insufficient_information"
  /** A distinguishing attribute resolves the pair — legitimately separate payments. */
  | "distinct";

export const PAYMENT_CONFLICT_CLASS_LABELS_FR: Readonly<Record<PaymentConflictClass, string>> = {
  confirmed_duplicate: "Doublon confirmé",
  high_confidence_duplicate: "Doublon très probable",
  possible_duplicate: "Doublon possible",
  possible_partial_split: "Paiement partiel possible",
  possible_correction: "Correction possible",
  tranche_balance_discrepancy: "Écart de tranche ou de solde",
  conflicting_information: "Informations contradictoires",
  insufficient_information: "Informations insuffisantes",
  distinct: "Paiements distincts — aucun conflit détecté",
};

/** One classified conflict between two payment subjects. */
export interface PaymentConflictFinding {
  /** Stable: `conflict:<class>:<a.key>:<b.key>` (unique per detection run). */
  readonly id: string;
  readonly class: PaymentConflictClass;
  /**
   * The explainable certainty (0..1) — the weighted agreement over the
   * evidence dimensions. PRESENTED AS EVIDENCE, NEVER AS PROOF.
   * null when nothing could be compared.
   */
  readonly certainty: number | null;
  readonly comparison: PaymentComparison;
  /** FR: the rule that produced this class. */
  readonly reason: string;
  /** FR strings: which attributes matched. */
  readonly matchingEvidence: readonly string[];
  /** FR strings: which attributes differed. */
  readonly differingEvidence: readonly string[];
  /** FR strings: which information was missing (and therefore NOT evidence). */
  readonly missingEvidence: readonly string[];
  /** True unless the class is `distinct` — every other class needs a human. */
  readonly requiresReview: boolean;
}

function evidenceLines(cmp: PaymentComparison): {
  matching: string[];
  differing: string[];
  missing: string[];
} {
  return {
    matching: cmp.attributes.filter((x) => x.verdict === "match" || x.verdict === "near").map((x) => x.detail),
    differing: cmp.attributes.filter((x) => x.verdict === "differ").map((x) => x.detail),
    missing: cmp.attributes.filter((x) => x.verdict === "missing").map((x) => x.detail),
  };
}

function makeFinding(
  cls: PaymentConflictClass,
  cmp: PaymentComparison,
  reason: string,
): PaymentConflictFinding {
  const { matching, differing, missing } = evidenceLines(cmp);
  return {
    id: `conflict:${cls}:${cmp.a.key}:${cmp.b.key}`,
    class: cls,
    certainty: cmp.certainty,
    comparison: cmp,
    reason,
    matchingEvidence: matching,
    differingEvidence: differing,
    missingEvidence: missing,
    requiresReview: cls !== "distinct",
  };
}

/**
 * Classify one compared pair. The rules run in a FIXED precedence order —
 * each step's rationale is embedded in the returned reason. Pure and total.
 *
 * Precedence (first match wins):
 *   1. Identity/provenance evidence (receipt / source cell):
 *      same identity + same amount → confirmed_duplicate;
 *      same identity + differing facts → conflicting_information.
 *   2. Hard distinguishing evidence — KNOWN-different student, family,
 *      academic year or category → distinct (with the evidence named).
 *   3. Insufficient comparable evidence → insufficient_information.
 *   4. Obligation arithmetic — the two amounts sum to a known expected
 *      obligation that neither equals alone:
 *        equal halves  → possible_correction (could still be two planned halves);
 *        unequal parts → possible_partial_split.
 *   5. Duplicate classes — same subject + same amount:
 *        exact date + no differing comparable attribute + high certainty
 *          → high_confidence_duplicate;
 *        near or missing date, rest tolerant → possible_duplicate.
 *   6. Otherwise → distinct (e.g. dates too far apart with no obligation
 *      link — two legitimate identical payments).
 */
export function classifyPaymentPair(
  cmp: PaymentComparison,
  thresholds: PaymentConflictThresholds = DEFAULT_PAYMENT_CONFLICT_THRESHOLDS,
): PaymentConflictFinding {
  const { a, b } = cmp;
  const tol = thresholds.amountToleranceDzd;
  const amountsMatch = amountsEqual(a.amount, b.amount, tol);
  const attr = (name: PaymentComparedAttribute) => cmp.attributes.find((x) => x.attribute === name);
  const sameStudent = attr("student")?.verdict === "match";
  const studentDiffer = attr("student")?.verdict === "differ";
  const familyDiffer = attr("family")?.verdict === "differ";
  const yearDiffer = attr("academicYear")?.verdict === "differ";
  const categoryDiffer = attr("category")?.verdict === "differ";
  const dateVerdict = attr("date")?.verdict;
  const sameReceipt = attr("receipt")?.verdict === "match";
  const sameSourceKey = attr("sourceKey")?.verdict === "match";

  // 1 — reliable identity / provenance evidence.
  if (sameReceipt || sameSourceKey) {
    const identityLabel = sameReceipt
      ? `le même numéro de reçu (${a.receiptNumber})`
      : `la même cellule source du classeur (${a.sourceKey})`;
    if (amountsMatch && !studentDiffer && !familyDiffer) {
      return makeFinding(
        "confirmed_duplicate",
        cmp,
        `Les deux enregistrements partagent ${identityLabel} et le montant concorde — preuve d'identité fiable. ` +
          `Le second est très probablement le même paiement enregistré deux fois (rejeu ou ré-import). ` +
          `Aucune fusion automatique : confirmez puis régularisez par le flux d'annulation existant.`,
      );
    }
    return makeFinding(
      "conflicting_information",
      cmp,
      `Les deux enregistrements partagent ${identityLabel} — la même source — mais les faits divergent ` +
        `(montant, élève ou famille). L'un des deux est enregistré avec des informations incorrectes.`,
    );
  }

  // 2 — hard distinguishing evidence (KNOWN-different facts).
  if (studentDiffer) {
    return makeFinding(
      "distinct",
      cmp,
      "Élèves différents et identifiés — deux obligations distinctes (frères et sœurs ou homonymes). " +
        "Des montants identiques entre élèves différents sont attendus (tarification par niveau).",
    );
  }
  if (familyDiffer) {
    return makeFinding(
      "distinct",
      cmp,
      "Familles différentes et identifiées — deux paiements de deux comptes distincts.",
    );
  }
  if (yearDiffer) {
    return makeFinding(
      "distinct",
      cmp,
      "Années scolaires différentes — chaque paiement règle l'obligation de sa propre année " +
        "(un règlement d'arriérés d'une année antérieure est un paiement légitime distinct).",
    );
  }
  if (categoryDiffer) {
    return makeFinding(
      "distinct",
      cmp,
      "Objets (catégories) différents — un même montant peut régler deux services distincts " +
        "(ex. scolarité et transport). Deux paiements légitimes séparés.",
    );
  }

  // 3 — insufficient comparable evidence.
  if (cmp.comparableWeight < thresholds.minimumComparableWeight) {
    return makeFinding(
      "insufficient_information",
      cmp,
      `Informations comparables insuffisantes (poids ${cmp.comparableWeight.toFixed(2)} < ` +
        `${thresholds.minimumComparableWeight.toFixed(2)}) : trop d'attributs essentiels manquent (élève, date, objet…) ` +
        `pour établir si ces deux paiements sont identiques ou distincts. Les deux enregistrements sont conservés.`,
    );
  }

  // 4 — obligation arithmetic (needs a known expected amount; NEVER invented).
  //     The two amounts must TOGETHER cover the expected obligation while
  //     NEITHER covers it alone — the arithmetic signature of a split
  //     registration. Equal halves (the 5,000 + 5,000 = 10,000 case) read as
  //     a possible CORRECTION of a mis-keyed amount; unequal parts read as
  //     possible PARTIAL payments. Both remain HYPOTHESES — the reason
  //     always names the alternative reading.
  const expected = a.expectedAmount ?? b.expectedAmount;
  const sameSubject = sameStudent; // family already matched at candidate time
  if (
    sameSubject &&
    attr("category")?.verdict === "match" &&
    expected !== null &&
    expected > 0 &&
    !amountsEqual(a.amount, expected, tol) &&
    !amountsEqual(b.amount, expected, tol) &&
    amountsEqual(a.amount + b.amount, expected, tol)
  ) {
    if (amountsMatch) {
      return makeFinding(
        "possible_correction",
        cmp,
        `Deux montants égaux (${dzd(a.amount)} + ${dzd(b.amount)}) totalisent exactement l'obligation attendue ` +
          `(${dzd(expected)}) alors qu'aucun ne la couvre seul — le schéma classique d'un montant saisi par erreur ` +
          `puis complété. Cela peut aussi être deux versements prévus : les DEUX lectures restent possibles. ` +
          `Aucune supposition automatique : vérifiez avec le relevé de caisse.`,
      );
    }
    return makeFinding(
      "possible_partial_split",
      cmp,
      `Deux montants différents (${dzd(a.amount)} + ${dzd(b.amount)}) totalisent l'obligation attendue ` +
        `(${dzd(expected)}) — très probablement des versements partiels successifs de la même tranche. ` +
        `Cela reste une hypothèse à confirmer.`,
    );
  }

  // 5 — the duplicate lanes. The subject link is either a KNOWN same
  //     student OR an UNVERIFIABLE subject (at least one side carries no
  //     student) anchored on the SAME family — the conservative reading:
  //     when the subject cannot be verified, an identical profile is a
  //     possible duplicate, never proof (the certainty stays reduced and
  //     high confidence stays unreachable without the student weight).
  const studentMissing = attr("student")?.verdict === "missing";
  const familyMatch = attr("family")?.verdict === "match";
  const subjectLinked = sameStudent || (studentMissing && familyMatch);
  if (subjectLinked && amountsMatch) {
    const noComparableDiffers = cmp.differing.every((d) =>
      // informational attributes may differ (receipt/source/method are
      // expected to differ between two separately-registered payments)
      d === "receipt" || d === "sourceKey" || d === "method",
    );
    if (
      dateVerdict === "match" &&
      noComparableDiffers &&
      cmp.certainty !== null &&
      cmp.certainty >= thresholds.highConfidenceCertainty
    ) {
      return makeFinding(
        "high_confidence_duplicate",
        cmp,
        `Tous les attributs comparables concordent (élève, famille, montant, date, objet) — ` +
          `la signature d'un paiement enregistré deux fois. À confirmer avant toute régularisation.`,
      );
    }
    if (dateVerdict === "match" || dateVerdict === "near" || dateVerdict === "missing") {
      const datePhrase =
        dateVerdict === "match"
          ? "à la même date"
          : dateVerdict === "near"
            ? `à ${cmp.daysApart} jour(s) d'écart`
            : "sans date comparable (au moins une date manquante)";
      const subjectPhrase = sameStudent
        ? "même élève"
        : "élève non renseigné (sujet invérifiable), même famille";
      return makeFinding(
        "possible_duplicate",
        cmp,
        `${subjectPhrase.charAt(0).toUpperCase() + subjectPhrase.slice(1)}, même montant, ${datePhrase} — un doublon est possible mais NON établi : ` +
          `${cmp.missing.length > 0 ? `${cmp.missing.length} attribut(s) n'ont pas pu être comparés et ` : ""}` +
          `deux paiements légitimes identiques restent plausibles (ex. deux versements prévus). À examiner.`,
      );
    }
    // dateVerdict === "differ" — falls through to distinct.
  }

  // 6 — nothing suspicious holds: distinct.
  return makeFinding(
    "distinct",
    cmp,
    "Aucun indice de doublon retenable : les attributs discriminants (dates éloignées, objets ou obligations " +
      "distincts) séparent ces deux paiements de façon cohérente avec deux règlements légitimes.",
  );
}

/* ================================================================== */
/*  Detection (candidate generation + classification)                  */
/* ================================================================== */

export interface DetectPaymentConflictsOptions {
  readonly thresholds?: PaymentConflictThresholds;
  /**
   * Which pairs to evaluate:
   *  - "all": every pair among the subjects (the auditor mode).
   *  - "incoming-vs-existing": only cross pairs (the import mode).
   *  - "incoming-vs-any": cross pairs AND incoming-vs-incoming pairs
   *    (the import mode with same-workbook internal ambiguity).
   */
  readonly pairScope?: "all" | "incoming-vs-existing" | "incoming-vs-any";
}

/** Statuses that mean "already corrected" — excluded from pair candidates. */
function isActiveStatus(status: string | null): boolean {
  return status !== "refunded" && status !== "cancelled";
}

/**
 * The deterministic candidate link: payments of the SAME family (or, when
 * the family is unknown, the same student). Pairs without any reliable link
 * are never compared — cross-family similar amounts are a mapping question,
 * not a duplicate question.
 */
function linkKey(s: PaymentConflictSubject): string | null {
  if (s.parentId !== null) return `p:${s.parentId}`;
  if (s.studentId !== null) return `s:${s.studentId}`;
  return null;
}

/**
 * Detect conflicts among payment subjects. PURE and DETERMINISTIC.
 *
 * CANDIDATE GENERATION (the complexity guard): two subjects are compared
 * ONLY when they share a reliable link AND a similarity anchor —
 *   - the same family (or, when the family is unknown, the same student),
 *     AND
 *   - the same rounded DZD amount (the duplicate/insufficient lanes), OR
 *     a shared receipt number / source cell (the identity-evidence lanes),
 *     OR the same known obligation (student + category + expected amount —
 *     the partial/correction lanes).
 * Pairs with different amounts, no identity link and no shared obligation
 * could only ever classify `distinct` — comparing them is pure waste (the
 * 1,200-payment single-family shape would compute ~720,000 dead pairs),
 * so they are never generated. Nothing detectable is lost.
 *
 * Emitted findings are in a stable order (sorted link key, then a.key,
 * then b.key); no input is ever mutated. Excluded by construction:
 * refunded/cancelled records (already corrected), same-key self pairs and
 * cross-family/cross-student pairs.
 */
export function detectPaymentConflicts(
  subjects: readonly PaymentConflictSubject[],
  options: DetectPaymentConflictsOptions = {},
): PaymentConflictFinding[] {
  const thresholds = options.thresholds ?? DEFAULT_PAYMENT_CONFLICT_THRESHOLDS;
  const scope = options.pairScope ?? "all";

  const active = subjects.filter((s) => isActiveStatus(s.status));
  const buckets = new Map<string, PaymentConflictSubject[]>();
  for (const s of active) {
    const key = linkKey(s);
    if (key === null) continue; // no reliable link — not a candidate
    const list = buckets.get(key) ?? [];
    list.push(s);
    buckets.set(key, list);
  }

  const findings: PaymentConflictFinding[] = [];
  const seen = new Set<string>();

  const inScope = (a: PaymentConflictSubject, b: PaymentConflictSubject): boolean => {
    if (a.key === b.key) return false; // the same record
    if (scope === "incoming-vs-existing") return a.origin !== b.origin;
    if (scope === "incoming-vs-any") {
      return !(a.origin === "application" && b.origin === "application");
    }
    return true;
  };

  const considerPair = (a: PaymentConflictSubject, b: PaymentConflictSubject) => {
    if (!inScope(a, b)) return;
    const pairId = a.key < b.key ? `${a.key}|${b.key}` : `${b.key}|${a.key}`;
    if (seen.has(pairId)) return;
    seen.add(pairId);
    const orderedPair = a.key < b.key ? [a, b] : [b, a];
    const cmp = comparePaymentSubjects(orderedPair[0], orderedPair[1], thresholds);
    findings.push(classifyPaymentPair(cmp, thresholds));
  };

  const bucketKeys = [...buckets.keys()].sort();
  for (const bucketKey of bucketKeys) {
    const members = buckets
      .get(bucketKey)!
      .slice()
      .sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));

    // Anchor lane 1 — the same rounded DZD amount (the duplicate lanes and
    // the insufficient lane both require amount agreement).
    const byAmount = new Map<number, PaymentConflictSubject[]>();
    // Anchor lane 2 — a shared receipt number (identity evidence).
    const byReceipt = new Map<string, PaymentConflictSubject[]>();
    // Anchor lane 3 — a shared import source cell (identity evidence).
    const bySourceKey = new Map<string, PaymentConflictSubject[]>();
    // Anchor lane 4 — the same KNOWN obligation (student + category +
    // expected amount): the partial/correction arithmetic.
    const byObligation = new Map<string, PaymentConflictSubject[]>();
    for (const s of members) {
      const amt = byAmount.get(Math.round(s.amount)) ?? [];
      amt.push(s);
      byAmount.set(Math.round(s.amount), amt);
      if (s.receiptNumber !== null) {
        const list = byReceipt.get(s.receiptNumber) ?? [];
        list.push(s);
        byReceipt.set(s.receiptNumber, list);
      }
      if (s.sourceKey !== null) {
        const list = bySourceKey.get(s.sourceKey) ?? [];
        list.push(s);
        bySourceKey.set(s.sourceKey, list);
      }
      if (s.studentId !== null && s.category !== null && s.expectedAmount !== null && s.expectedAmount > 0) {
        const obKey = `${s.studentId}|${s.category}|${Math.round(s.expectedAmount)}`;
        const list = byObligation.get(obKey) ?? [];
        list.push(s);
        byObligation.set(obKey, list);
      }
    }

    const pairWithin = (group: PaymentConflictSubject[]) => {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          considerPair(group[i], group[j]);
        }
      }
    };
    for (const group of byAmount.values()) pairWithin(group);
    for (const group of byReceipt.values()) pairWithin(group);
    for (const group of bySourceKey.values()) pairWithin(group);
    for (const group of byObligation.values()) pairWithin(group);
  }
  return findings;
}

/* ================================================================== */
/*  Obligation projection (the import preview's tranche arithmetic)    */
/* ================================================================== */

/** The projected financial situation of one obligation group. */
export interface ObligationProjectionRow {
  readonly linkKey: string;
  readonly parentId: string | null;
  readonly studentId: string | null;
  readonly category: PaymentCategory | null;
  /** Σ existing active payments. */
  readonly currentPaid: number;
  /** Σ incoming projected payments. */
  readonly incoming: number;
  /** currentPaid + incoming. */
  readonly projectedPaid: number;
  /** Σ installment amountDue when available; null = unknown. */
  readonly expectedTotal: number | null;
  /** True when the import CHANGES the total for this group. */
  readonly changesTotal: boolean;
  /** True when projectedPaid exceeds expectedTotal (overpayment at the group level). */
  readonly overpaid: boolean;
}

export interface ObligationProjectionOptions {
  readonly amountToleranceDzd?: number;
}

/**
 * Project the per-obligation financial situation after an import: for each
 * (family/student, category) group, the CURRENT paid total, the INCOMING
 * projected total, and the PROJECTED total — against the EXPECTED
 * obligation total when installments supply one. PURE; never invents an
 * expected value (null when unknown).
 */
export function projectObligationTotals(
  existing: readonly PaymentConflictSubject[],
  incoming: readonly PaymentConflictSubject[],
  expectedTotals: ReadonlyMap<string, number>,
  options: ObligationProjectionOptions = {},
): ObligationProjectionRow[] {
  const tol = options.amountToleranceDzd ?? 1;
  const groups = new Map<
    string,
    {
      parentId: string | null;
      studentId: string | null;
      category: PaymentCategory | null;
      currentPaid: number;
      incoming: number;
    }
  >();
  const groupKey = (s: PaymentConflictSubject) =>
    `${s.parentId ?? ""}|${s.studentId ?? ""}|${s.category ?? ""}`;

  const add = (s: PaymentConflictSubject, lane: "current" | "incoming") => {
    if (!isActiveStatus(s.status)) return;
    const key = groupKey(s);
    const g = groups.get(key) ?? {
      parentId: s.parentId,
      studentId: s.studentId,
      category: s.category,
      currentPaid: 0,
      incoming: 0,
    };
    if (lane === "current") g.currentPaid += s.amount;
    else g.incoming += s.amount;
    groups.set(key, g);
  };
  for (const s of existing) add(s, "current");
  for (const s of incoming) add(s, "incoming");

  const rows: ObligationProjectionRow[] = [];
  for (const key of [...groups.keys()].sort()) {
    const g = groups.get(key)!;
    // The expected total may be keyed by any of the group's identities —
    // look up by the exact group key, then by the studentless family form.
    const expectedTotal = expectedTotals.get(key) ?? expectedTotals.get(`${g.parentId ?? ""}||${g.category ?? ""}`) ?? null;
    const projectedPaid = g.currentPaid + g.incoming;
    rows.push({
      linkKey: key,
      parentId: g.parentId,
      studentId: g.studentId,
      category: g.category,
      currentPaid: g.currentPaid,
      incoming: g.incoming,
      projectedPaid,
      expectedTotal,
      changesTotal: Math.abs(g.incoming) > tol,
      overpaid: expectedTotal !== null && projectedPaid > expectedTotal + tol,
    });
  }
  return rows;
}

/**
 * Single-record overpayment check (scenario 9): a payment exceeding the
 * known expected amount of its own obligation. PURE; expectedAmount null →
 * no finding (never invent a price).
 */
export function detectOverpayments(
  subjects: readonly PaymentConflictSubject[],
  toleranceDzd = 1,
): Array<{
  readonly subject: PaymentConflictSubject;
  readonly excess: number;
  readonly reason: string;
}> {
  const out: Array<{ subject: PaymentConflictSubject; excess: number; reason: string }> = [];
  const ordered = [...subjects]
    .filter((s) => isActiveStatus(s.status) && s.expectedAmount !== null && s.expectedAmount > 0)
    .sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  for (const s of ordered) {
    const expected = s.expectedAmount as number;
    const excess = s.amount - expected;
    if (excess > toleranceDzd) {
      out.push({
        subject: s,
        excess,
        reason:
          `Paiement de ${s.amount} DZD pour une obligation attendue de ${expected} DZD — ` +
          `un excédent de ${excess} DZD. À vérifier : erreur de saisie, avance volontaire ou obligation mal estimée.`,
      });
    }
  }
  return out;
}
