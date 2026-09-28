/**
 * The IdentityResolutionRepository contract — T-438 / ADR-032.
 *
 * The persistence + execution layer behind the pure ER engine. It owns:
 *   - the analyzed source observations (+ their idempotency hashes),
 *   - the proposals + their review decisions (INV-50 — decision writes ONLY),
 *   - the identity edges (active / negative / severed),
 *   - the append-only aggregation events (the audit trail),
 *   - the REVERSIBLE merge/unmerge operations for canonical parents.
 *
 * The contract mirrors the mock + Supabase duality (the
 * PromotionCycleRepository / ReEnrollmentRepository pattern): the mock
 * implementation is store-based; the Supabase implementation mirrors the
 * migration-0130 RPCs 1:1. NO client-side business logic — the matching
 * itself lives in `src/domain/identity/` (the pure engine).
 */
import type { Result } from "../../core/result";
import type {
  ErAggregationEvent,
  ErAnalysisResult,
  ErIdentityEdge,
  ErMatchProposal,
  ErObservation,
} from "../identity/types";
import type { ErPriorObservation } from "../identity/engine";

// ---------------------------------------------------------------------------
// Persistence records (the DB-shaped rows; the engine's types are the
// analysis-time shapes — these carry ids + audit columns)
// ---------------------------------------------------------------------------

/** A persisted analyzed observation (er_source_observations). */
export interface ErSourceObservationRecord {
  readonly id: string;
  readonly tenantId: string;
  /** The caller-constructed stable observation key (the engine's ErObservation.id). */
  readonly observationKey: string;
  readonly sourceSystem: string;
  readonly sourceRecordId: string;
  readonly kind: "parent" | "student";
  readonly canonicalId: string | null;
  readonly payloadHash: string;
  readonly displayName: string | null;
  readonly phones: readonly string[];
  readonly email: string | null;
  readonly gradeLevelCode: string | null;
  readonly transportDestination: string | null;
  readonly academicYear: string | null;
  readonly tier: "manual" | "import";
  readonly analyzedAt: string;
  readonly runId: string | null;
}

/** The review-decision inputs. */
export interface ErReviewDecisionInput {
  readonly proposalId: string;
  readonly decision: "approve" | "reject";
  readonly actorId: string;
  readonly actorName: string;
  readonly rationale: string | null;
}

/** The merge execution contract (INV-54 — the reversible merge). */
export interface ErMergeParentsInput {
  /** The SURVIVING canonical parent id. */
  readonly targetParentId: string;
  /** The canonical parent merged away (soft-deleted). */
  readonly sourceParentId: string;
  /** The proposal/edge that justified the merge (provenance). */
  readonly proposalId: string | null;
  readonly actorId: string;
  readonly actorName: string;
  readonly rationale: string | null;
}

export interface ErMergeResult {
  readonly eventId: string;
  /** Every re-pointed row: kind → { rowId → previousParentId } (the restore map). */
  readonly rePointed: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

export interface ErUnmergeInput {
  /** The MERGE_EXECUTED event to reverse. */
  readonly eventId: string;
  readonly actorId: string;
  readonly actorName: string;
  readonly rationale: string | null;
}

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

export interface IdentityResolutionRepository {
  // -- Observations (the analyzed corpus + idempotency) --

  /** Persist the analyzed incoming observations of a run (upsert by hash). */
  recordObservations(
    observations: readonly ErObservation[],
    run: ErAnalysisResult,
    hashes: ReadonlyMap<string, string>,
  ): Promise<Result<void>>;

  /** The prior observation keys for the idempotency gate (INV-55). */
  listPriorObservations(): Promise<readonly ErPriorObservation[]>;

  // -- Proposals + the review decisions --

  /** Persist a run's proposals (idempotent per runId — re-analysis replaces). */
  recordProposals(run: ErAnalysisResult): Promise<Result<void>>;

  /** All proposals, newest first. */
  observeProposals(): {
    get(): readonly ErMatchProposal[];
    subscribe(cb: (rows: readonly ErMatchProposal[]) => void): () => void;
  };

  /**
   * Apply a review decision (INV-50's ONLY execution path):
   *  - approve → the proposal flips to `approved`, an ACTIVE identity edge is
   *    created, a PROPOSAL_APPROVED event lands, and — when both sides are
   *    existing canonical entities — the MERGE executes in the same
   *    operation (one transaction; the caller sees the merge result).
   *  - reject → the proposal flips to `rejected`, a NEGATIVE edge is created
   *    (never re-proposed), a PROPOSAL_REJECTED event lands.
   */
  decideProposal(
    input: ErReviewDecisionInput,
    merge?: ErMergeParentsInput,
  ): Promise<Result<{ merge?: ErMergeResult }>>;

  // -- Edges + events (the audit surfaces) --

  observeEdges(): {
    get(): readonly ErIdentityEdge[];
    subscribe(cb: (rows: readonly ErIdentityEdge[]) => void): () => void;
  };

  observeEvents(): {
    get(): readonly ErAggregationEvent[];
    subscribe(cb: (rows: readonly ErAggregationEvent[]) => void): () => void;
  };

  // -- The reversible merge/unmerge (INV-54) --

  /** The full merge operation (see ErMergeParentsInput). */
  mergeParents(input: ErMergeParentsInput): Promise<Result<ErMergeResult>>;

  /**
   * Reverse a merge: replays the recorded prior mapping, restores the
   * soft-deleted source parent, severs the cluster's edges for the restored
   * observations, and writes a MERGE_UNDONE event.
   */
  unmergeParents(input: ErUnmergeInput): Promise<Result<void>>;

  // -- Experimental mode hygiene --

  /** True when ANY aggregation state exists (the honest "not pristine" flag). */
  hasAggregationState(): Promise<boolean>;
}
