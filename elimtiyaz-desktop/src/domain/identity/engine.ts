/**
 * The ER-PMAE engine orchestrator — T-438 / ADR-032 / identity-rules.md.
 *
 * The one entry point (`analyze`): incoming observations vs. the existing
 * roster through normalize → block → veto → score → band → proposal.
 *
 * PURITY CONTRACT: no I/O, no repositories, no clock reads (the caller
 * supplies `now`). The engine PROPOSES — it never merges (INV-50: nothing
 * merges without explicit human confirmation; execution lives in the
 * repository layer's review-decision operations).
 *
 * IDEMPOTENCY (INV-55): observations whose (sourceSystem, sourceRecordId,
 * hash) triple already exists in the prior-observation set are skipped —
 * re-analyzing an unchanged workbook is a no-op.
 */
import { buildCandidatePool } from "./blocking";
import { normalizeAll, observationHash } from "./normalize";
import { scorePair } from "./scoring";
import { evaluateVetoes } from "./vetoes";
import type {
  ErAnalysisInput,
  ErAnalysisResult,
  ErAnalysisStats,
  ErMatchProposal,
  ErNormalized,
  ErObservation,
  ErPairScore,
} from "./types";
import { ER_NAME_COMPARISON } from "./types";

/** A prior ingested observation (for the idempotency short-circuit). */
export interface ErPriorObservation {
  readonly sourceSystem: string;
  readonly sourceRecordId: string;
  readonly payloadHash: string;
}

/** The deterministic strong-identifier gate inputs (per pair). */
export interface ErStrongIdIndex {
  /** canonicalId → the set of deterministic codes that identify it exactly. */
  readonly byCanonicalId: ReadonlyMap<string, ReadonlySet<string>>;
}

/** Build the strong-id index from the existing observations (helper). */
export function buildStrongIdIndex(
  existing: readonly ErObservation[],
): ErStrongIdIndex {
  const byCanonicalId = new Map<string, Set<string>>();
  for (const obs of existing) {
    if (!obs.canonicalId) continue;
    let codes = byCanonicalId.get(obs.canonicalId);
    if (!codes) {
      codes = new Set<string>();
      byCanonicalId.set(obs.canonicalId, codes);
    }
    codes.add(obs.sourceRecordId); // the canonical code (e.g. PAR-2026-XXXX)
    if (obs.email) codes.add(`email:${obs.email.toLowerCase()}`);
  }
  return { byCanonicalId };
}

/** A run-scoped deterministic id (stable within a run; no Math.random). */
function proposalId(runId: string, aId: string, bId: string): string {
  return `${runId}:${aId}→${bId}`;
}

/**
 * The deterministic-gate + full analysis for one incoming observation
 * against its candidate pool.
 */
function analyzeObservation(
  incoming: ErNormalized,
  incomingRaw: ErObservation,
  pool: ReadonlySet<string>,
  existingNormById: ReadonlyMap<string, ErNormalized>,
  existingRawById: ReadonlyMap<string, ErObservation>,
  negativePairs: ReadonlySet<string>,
  strongIds: ErStrongIdIndex,
): { best: ErPairScore | null; scored: number; vetoed: number } {
  let best: ErPairScore | null = null;
  let scored = 0;
  let vetoed = 0;
  for (const candidateId of pool) {
    const candNorm = existingNormById.get(candidateId);
    const candRaw = existingRawById.get(candidateId);
    if (!candNorm || !candRaw) continue;
    const negKey = pairKey(incoming.observationId, candidateId);
    if (negativePairs.has(negKey)) continue; // never re-propose a rejection
    // Deterministic gate: an exact strong identifier (canonical code /
    // shared verified email as national-id-class evidence).
    const codes = candRaw.canonicalId ? strongIds.byCanonicalId.get(candRaw.canonicalId) : undefined;
    const strongHit =
      (codes?.has(incomingRaw.sourceRecordId) ?? false) ||
      (incomingRaw.email !== null && candRaw.email !== null &&
        incomingRaw.email.toLowerCase() === candRaw.email.toLowerCase());
    const vetoes = evaluateVetoes(incoming, candNorm);
    if (vetoes.length > 0) vetoed++;
    const pairScore = scorePair(incoming, candNorm, vetoes, strongHit);
    scored++;
    if (best === null || pairScore.confidence > best.confidence) best = pairScore;
  }
  return { best, scored, vetoed };
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Run the identity analysis (identity-rules §2–§5, §8).
 *
 * The result's proposals are sorted by confidence desc; the `unbound` list
 * carries every incoming observation with no ≥ review-band proposal — the
 * caller proceeds with those as new entities (INV-45: the legacy exact-match
 * path remains the fallback).
 */
export function analyze(
  input: ErAnalysisInput,
  priorObservations: readonly ErPriorObservation[] = [],
  strongIds?: ErStrongIdIndex,
): ErAnalysisResult {
  const now = input.now;
  const runId = `er-${now}`;
  const strongIdIndex = strongIds ?? buildStrongIdIndex(input.existing);

  // -- Idempotency (INV-55): skip unchanged prior observations entirely. --
  const priorKeys = new Set(
    priorObservations.map((p) => `${p.sourceSystem}|${p.sourceRecordId}|${p.payloadHash}`),
  );

  const normalizedIncoming = normalizeAll(input.incoming);
  const normalizedExisting = normalizeAll(input.existing);
  const existingNormById = new Map(normalizedExisting.map((n) => [n.observationId, n]));
  const existingRawById = new Map(input.existing.map((o) => [o.id, o]));

  // Hash each incoming observation once for the idempotency gate + return.
  const hashes = new Map<string, string>();
  for (let i = 0; i < input.incoming.length; i++) {
    const raw = input.incoming[i];
    const norm = normalizedIncoming[i];
    hashes.set(
      raw.id,
      observationHash(norm, raw.sourceSystem, raw.sourceRecordId),
    );
  }

  const fresh: ErObservation[] = [];
  for (let i = 0; i < input.incoming.length; i++) {
    const raw = input.incoming[i];
    const key = `${raw.sourceSystem}|${raw.sourceRecordId}|${hashes.get(raw.id)}`;
    if (!priorKeys.has(key)) fresh.push(raw);
  }

  // -- Blocking over the FRESH observations only. --
  const freshNorm = fresh.map((o) => normalizedIncoming.find((n) => n.observationId === o.id)).filter((n): n is ErNormalized => n !== undefined);
  const { candidatesByObservation, candidatesBlocked, saturatedKeysSkipped } =
    buildCandidatePool(freshNorm, normalizedExisting);

  // -- Negative pairs index. --
  const negativePairs = new Set(input.negativePairs.map((p) => pairKey(p.aId, p.bId)));

  // -- Score each fresh observation against its pool. --
  const proposals: ErMatchProposal[] = [];
  const unbound: ErObservation[] = [];
  let pairsScored = 0;
  let vetoedTotal = 0;
  const bandCounts = { definite: 0, probable: 0, review: 0 };

  for (const raw of fresh) {
    const norm = freshNorm.find((n) => n.observationId === raw.id);
    if (!norm) {
      unbound.push(raw);
      continue;
    }
    const pool = candidatesByObservation.get(raw.id) ?? new Set<string>();
    const { best, scored, vetoed } = analyzeObservation(
      norm,
      raw,
      pool,
      existingNormById,
      existingRawById,
      negativePairs,
      strongIdIndex,
    );
    pairsScored += scored;
    vetoedTotal += vetoed;
    if (best && (best.band === "definite" || best.band === "probable" || best.band === "review")) {
      bandCounts[best.band]++;
      proposals.push({
        id: proposalId(runId, best.aId, best.bId),
        runId,
        createdAt: now,
        aObservationId: best.aId,
        bObservationId: best.bId,
        score: best,
        status: "proposed",
        decidedBy: null,
        decidedAt: null,
        rationale: null,
      });
    } else {
      unbound.push(raw);
    }
  }

  // Deterministic ordering: confidence desc, then id (stable).
  proposals.sort((x, y) => y.score.confidence - x.score.confidence || (x.id < y.id ? -1 : 1));

  const stats: ErAnalysisStats = {
    incomingCount: input.incoming.length,
    existingCount: input.existing.length,
    pairsScored,
    candidatesBlocked,
    saturatedKeysSkipped,
    vetoed: vetoedTotal,
    proposals: bandCounts,
  };

  return {
    runId,
    analyzedAt: now,
    proposals,
    unbound,
    stats,
  };
}

/**
 * The per-observation payload hashes (the caller persists these with the
 * analysis run — the idempotency gate's `priorObservations` next time).
 */
export function observationHashes(result: ErAnalysisResult, input: ErAnalysisInput): ReadonlyMap<string, string> {
  // Re-derive: the engine computed these during analyze(); expose them again
  // for the caller without re-running the pipeline.
  const out = new Map<string, string>();
  const normAll = normalizeAll(input.incoming);
  for (let i = 0; i < input.incoming.length; i++) {
    const raw = input.incoming[i];
    const norm = normAll[i];
    out.set(raw.id, observationHash(norm, raw.sourceSystem, raw.sourceRecordId));
  }
  return out;
}

export { ER_NAME_COMPARISON };
