/**
 * ER-PMAE domain types — the identity-resolution engine's contracts.
 *
 * T-438 / ADR-032 / docs/domain/identity-rules.md (2026-09-29, issues #15+#16).
 *
 * The engine is a PURE TypeScript domain module (the `domain/calc/*`
 * reference-engine pattern): no React, no Supabase, no I/O. The invariant
 * numbering (INV-40..58) referenced throughout lives in identity-rules.md §10.
 *
 * CORE MODEL (identity-rules §1):
 *   - An ErObservation is an OBSERVATION of a person (an import row, an
 *     existing canonical parent/student row) — never the person itself.
 *   - The surviving entity of any aggregation is an EXISTING canonical row
 *     (parents/students); the engine's persistent output is LINKAGE +
 *     PROVENANCE (edges, proposals, events), never a second person store.
 */
import type { GradeLevel } from "../model/student";

// ---------------------------------------------------------------------------
// 1. Observations (identity-rules §1, §2)
// ---------------------------------------------------------------------------

/** The trust tier of an observation's source (survivorship rule 1, §6.3). */
export type ErSourceTier =
  /** Manually verified through a staff UI — the highest trust. */
  | "manual"
  /** An imported spreadsheet observation. */
  | "import";

/** What kind of person this observation describes. */
export type ErEntityKind = "parent" | "student";

/**
 * One identity-bearing observation of a person.
 *
 * The caller (import engine / CRM surfaces) constructs these from its own
 * rows — the ER engine never reads repositories itself (purity).
 */
export interface ErObservation {
  /** Stable observation id (source-qualified, e.g. `xlsx:2027-2026:row-42`). */
  readonly id: string;
  /** The system the observation came from (e.g. the workbook id, `canonical`). */
  readonly sourceSystem: string;
  /** The row/entity id inside the source system. */
  readonly sourceRecordId: string;
  readonly kind: ErEntityKind;
  /** The raw full name as recorded (may carry honorifics/noise). */
  readonly displayName: string | null;
  /** Raw contact strings — composite cells allowed ("0663.../0770..."). */
  readonly phones: readonly string[];
  readonly email: string | null;
  /** Canonical grade code when known (students; the caller maps raw classe codes). */
  readonly gradeLevelCode: GradeLevel | string | null;
  readonly transportDestination: string | null;
  readonly gender: "M" | "F" | null;
  /** The academic year the observation belongs to ("2026-2027"), if known. */
  readonly academicYear: string | null;
  /** ISO timestamp of the observation's extraction/last-verification. */
  readonly extractedAt: string;
  readonly tier: ErSourceTier;
  /**
   * The canonical entity id when this observation IS one (an existing
   * parent/student row) — the link target for incoming observations.
   */
  readonly canonicalId: string | null;
}

/** The deterministic normalization output (identity-rules §2, INV-42/43). */
export interface ErNormalized {
  readonly observationId: string;
  /** Cleaned name tokens, order preserved ("sediki", "ishak"). */
  readonly nameTokens: readonly string[];
  /** Sorted, deduplicated, validated phone numbers (the SET view). */
  readonly phones: readonly string[];
  readonly email: string | null;
  /** Grade rank on the canonical ladder (GRADE_LEVELS index), null if unknown. */
  readonly gradeRank: number | null;
  /** Normalized transport destination key, null if unknown. */
  readonly transportKey: string | null;
  readonly gender: "M" | "F" | null;
  readonly academicYear: string | null;
}

// ---------------------------------------------------------------------------
// 2. Blocking (identity-rules §3)
// ---------------------------------------------------------------------------

/** The four independent blocking passes (identity-rules §3.1). */
export type ErBlockingPass = "phone" | "token-pair" | "phonetic" | "initial-surname";

/** One generated blocking key. */
export interface ErBlockingKey {
  readonly pass: ErBlockingPass;
  readonly key: string;
}

// ---------------------------------------------------------------------------
// 3. Comparison evidence (identity-rules §4, §5)
// ---------------------------------------------------------------------------

/** How one field comparison resolved. */
export type ErEvidenceStatus = "exact" | "fuzzy" | "initial" | "missing" | "mismatch";

/** One piece of match evidence (INV-51 — the full evidence vector is mandatory). */
export interface ErMatchEvidence {
  /** The compared field ("national-id", "phones", "name", "grade", "transport", "email"). */
  readonly field: string;
  readonly status: ErEvidenceStatus;
  /** The signed weight this evidence contributed (match +, mismatch −, missing 0). */
  readonly weight: number;
  /** Human-readable detail for the review surface (French UI). */
  readonly detail: string;
}

/** A triggered hard veto (identity-rules §4.1). */
export type ErVetoId = "sibling-guardrail" | "demographic-incompatibility" | "same-year-identity-clash";

/** The four decision bands (identity-rules §5.2). */
export type ErDecisionBand = "definite" | "probable" | "review" | "separate";

/** The scored outcome of comparing a pair of normalized observations. */
export interface ErPairScore {
  readonly aId: string;
  readonly bId: string;
  readonly confidence: number;
  readonly band: ErDecisionBand;
  readonly evidence: readonly ErMatchEvidence[];
  /** Triggered vetoes (empty when none — a veto forces `separate`). */
  readonly vetoes: readonly ErVetoId[];
}

// ---------------------------------------------------------------------------
// 4. Proposals + decisions (identity-rules §7)
// ---------------------------------------------------------------------------

export type ErProposalStatus = "proposed" | "approved" | "rejected" | "executed" | "superseded";

/**
 * A match proposal: the engine believes observation A (incoming) and
 * observation B (an existing canonical entity) describe the same person.
 *
 * INV-50: a proposal NEVER executes on its own — only an explicit human
 * confirmation (approve) can move it to `approved`/`executed`.
 */
export interface ErMatchProposal {
  readonly id: string;
  /** The analysis run that produced the proposal. */
  readonly runId: string;
  readonly createdAt: string;
  /** The incoming/source observation id. */
  readonly aObservationId: string;
  /** The existing canonical observation id (carries `canonicalId`). */
  readonly bObservationId: string;
  readonly score: ErPairScore;
  readonly status: ErProposalStatus;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  /** Operator rationale for the decision (audit surface). */
  readonly rationale: string | null;
}

// ---------------------------------------------------------------------------
// 5. Identity edges + events (identity-rules §6, §7; ADR-032 §3)
// ---------------------------------------------------------------------------

export type ErEdgeStatus = "active" | "severed" | "negative";

/**
 * An identity-graph edge between two OBSERVATIONS (or an observation and a
 * canonical entity). Active edges define the merged clusters; negative
 * edges are permanent review rejections (never re-proposed); severed edges
 * are undone merges (unmerge provenance).
 */
export interface ErIdentityEdge {
  readonly id: string;
  readonly aObservationId: string;
  readonly bObservationId: string;
  readonly confidence: number;
  readonly status: ErEdgeStatus;
  /** The evidence snapshot at decision time (INV-51). */
  readonly evidence: readonly ErMatchEvidence[];
  readonly createdAt: string;
  readonly createdBy: string;
  readonly severedAt: string | null;
  readonly severedBy: string | null;
}

export type ErAggregationEventType =
  | "ANALYSIS_RUN"
  | "PROPOSAL_APPROVED"
  | "PROPOSAL_REJECTED"
  | "MERGE_EXECUTED"
  | "MERGE_UNDONE"
  | "BINDING_EXECUTED";

/**
 * The append-only aggregation event — the audit trail (identity-rules §7.4).
 *
 * A MERGE_EXECUTED event carries the COMPLETE prior mapping (every re-pointed
 * row's previous parent) so an unmerge restores the exact prior state
 * (INV-54); a MERGE_UNDONE event references the merge it reverses.
 */
export interface ErAggregationEvent {
  readonly id: string;
  readonly eventType: ErAggregationEventType;
  readonly runId: string | null;
  /** The canonical entity that survived / was bound. */
  readonly canonicalId: string;
  /** The canonical entity merged away (merge events only). */
  readonly mergedAwayId: string | null;
  readonly observationIds: readonly string[];
  readonly actorId: string;
  readonly actorName: string;
  readonly rationale: string | null;
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// 6. The analysis run contract (the engine's top-level API)
// ---------------------------------------------------------------------------

/** What the engine analyzes: incoming observations vs. the existing roster. */
export interface ErAnalysisInput {
  readonly incoming: readonly ErObservation[];
  /** Existing canonical entities as observations (constructed by the caller). */
  readonly existing: readonly ErObservation[];
  /** Known negative edges from prior review rejections (never re-proposed). */
  readonly negativePairs: readonly Readonly<{ aId: string; bId: string }>[];
  /** ISO timestamp of the run (deterministic in tests). */
  readonly now: string;
}

export interface ErAnalysisStats {
  readonly incomingCount: number;
  readonly existingCount: number;
  readonly pairsScored: number;
  readonly candidatesBlocked: number;
  readonly saturatedKeysSkipped: number;
  readonly vetoed: number;
  readonly proposals: { readonly definite: number; readonly probable: number; readonly review: number };
}

export interface ErAnalysisResult {
  readonly runId: string;
  readonly analyzedAt: string;
  /** Proposals in the definite/probable/review bands (sorted by confidence desc). */
  readonly proposals: readonly ErMatchProposal[];
  /** Observations the engine could NOT bind — they proceed as new entities. */
  readonly unbound: readonly ErObservation[];
  readonly stats: ErAnalysisStats;
}

// ---------------------------------------------------------------------------
// 7. Field-level provenance for canonical synthesis (identity-rules §6.3)
// ---------------------------------------------------------------------------

export type ErSurvivorshipRule =
  | "AUTHORITATIVE_TIER"
  | "TEMPORAL_RECENCY"
  | "SET_UNION"
  | "STRUCTURAL_COMPLETENESS"
  | "SINGLE_SOURCE";

/** The provenance record for one synthesized field value (INV-53). */
export interface ErFieldProvenance<T> {
  readonly field: string;
  readonly value: T;
  readonly sourceObservationId: string | null;
  readonly rule: ErSurvivorshipRule;
  readonly assignedAt: string;
}

/** A synthesized (projected) canonical field set for a cluster. */
export interface ErCanonicalSynthesis {
  readonly observationIds: readonly string[];
  readonly displayName: ErFieldProvenance<string | null>;
  readonly phones: ErFieldProvenance<readonly string[]>;
  readonly email: ErFieldProvenance<string | null>;
  readonly gradeLevelCode: ErFieldProvenance<string | null>;
  readonly transportDestination: ErFieldProvenance<string | null>;
}

// ---------------------------------------------------------------------------
// 8. Constants (identity-rules §5.1 — INV-49: documented domain constants)
// ---------------------------------------------------------------------------

/**
 * The evidence weight matrix (identity-rules §5.1). Changing these is a
 * RULES change: update identity-rules.md and re-run the ER suite.
 *
 * CALIBRATION (T-438 Phase 2, pinned by the engine suite): the weights feed
 * a logistic squash, so they are scaled so that the business-correct
 * outcomes land in the documented bands — strong name + shared phone is
 * ALSO caught by the deterministic gate (definite); strong name + email +
 * context lands `probable`; a partial name + shared family phone lands
 * `review` (the issue's own Band-3 example); context alone never clears
 * even the review floor (INV-48).
 */
export const ER_EVIDENCE_WEIGHTS = {
  nationalId: { match: 0.95, mismatch: -0.9 },
  phoneUnique: { match: 0.9, mismatch: -0.6 },
  nameStrong: { match: 1.0, mismatch: -1.0 },
  nameInitial: { match: 0.35, mismatch: -0.2 },
  transport: { match: 0.2, mismatch: -0.1 },
  grade: { match: 0.15, mismatch: -0.1 },
  email: { match: 0.5, mismatch: -0.4 },
} as const;

/** The decision band thresholds (identity-rules §5.2). */
export const ER_BAND_THRESHOLDS = {
  definite: 0.92,
  probable: 0.8,
  review: 0.6,
} as const;

/** A blocking key mapping to more entities than this is saturated (INV-44). */
export const ER_BLOCKING_SATURATION_LIMIT = 50;

/** Sibling-guardrail constants (identity-rules §4.1, INV-46). */
export const ER_SIBLING_GUARDRAIL = {
  minFirstNameLength: 2,
  firstNameSimilarityFloor: 0.4,
  gradeRankDivergence: 2,
} as const;

/** The same-year identity-clash containment floor (identity-rules §4.1). */
export const ER_SAME_YEAR_CONTAINMENT_FLOOR = 0.2;

/** Cluster density floor for ≥ 3-node clusters (identity-rules §6.2, INV-52). */
export const ER_CLUSTER_DENSITY_FLOOR = 0.75;

/** Name-comparison constants (identity-rules §4.3, INV-47). */
export const ER_NAME_COMPARISON = {
  initialMatchScore: 0.9,
  tokenCountPenalty: 0.08,
  strongSimilarityFloor: 0.88,
  deterministicNameFloor: 0.85,
} as const;
