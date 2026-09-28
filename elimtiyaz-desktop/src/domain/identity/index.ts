/**
 * The ER-PMAE domain module's public surface — T-438 / ADR-032.
 *
 * `src/domain/identity/` is the ONE implementation of the identity rules
 * (docs/domain/identity-rules.md). Consumers import from HERE, never from
 * the internal files.
 */
export type {
  ErEntityKind,
  ErSourceTier,
  ErObservation,
  ErNormalized,
  ErBlockingPass,
  ErBlockingKey,
  ErEvidenceStatus,
  ErMatchEvidence,
  ErVetoId,
  ErDecisionBand,
  ErPairScore,
  ErProposalStatus,
  ErMatchProposal,
  ErEdgeStatus,
  ErIdentityEdge,
  ErAggregationEventType,
  ErAggregationEvent,
  ErAnalysisInput,
  ErAnalysisStats,
  ErAnalysisResult,
  ErSurvivorshipRule,
  ErFieldProvenance,
  ErCanonicalSynthesis,
} from "./types";

export {
  ER_EVIDENCE_WEIGHTS,
  ER_BAND_THRESHOLDS,
  ER_BLOCKING_SATURATION_LIMIT,
  ER_SIBLING_GUARDRAIL,
  ER_SAME_YEAR_CONTAINMENT_FLOOR,
  ER_CLUSTER_DENSITY_FLOOR,
  ER_NAME_COMPARISON,
} from "./types";

export {
  normalizeName,
  normalizePhones,
  gradeRankOf,
  normalizeTransportKey,
  normalizeEmail,
  normalizeObservation,
  normalizeAll,
  observationHash,
} from "./normalize";

export {
  blockingKeysFor,
  buildCandidatePool,
} from "./blocking";

export {
  levenshtein,
  levenshteinSimilarity,
  phoneticKey,
  compareNames,
  comparePhones,
  tokenContainment,
} from "./similarity";

export { evaluateVetoes } from "./vetoes";

export { bandOf, scorePair } from "./scoring";

export {
  connectedComponents,
  componentDensity,
  resolveClusters,
  type GraphEdge,
} from "./clustering";

export { synthesizeCanonical } from "./synthesis";

export {
  analyze,
  observationHashes,
  buildStrongIdIndex,
  type ErPriorObservation,
  type ErStrongIdIndex,
} from "./engine";
