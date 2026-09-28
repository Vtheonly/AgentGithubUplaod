/**
 * MockIdentityResolutionRepository — T-438 (migration 0130 / ADR-032) — the
 * mock twin of `SupabaseIdentityResolutionRepository`, built on the SAME
 * store the other mock repositories use (mock/production parity, pinned by
 * the t-438 repository suite).
 *
 * The mock implements the SAME contract semantics as the 0130 RPCs:
 *  - observations + proposals persist per run (idempotent by hash/key);
 *  - decideProposal is the ONLY execution path (INV-50) — approve creates
 *    the active edge + event; reject creates the negative edge + event;
 *  - mergeParents re-points students/payments/installments/ledger in ONE
 *    operation, archives the merged-away parent (the mock layer's
 *    hard-remove convention — the Supabase twin soft-deletes), and records
 *    the COMPLETE prior mapping for the unmerge (INV-54);
 *  - unmergeParents replays the mapping in reverse and restores the parent.
 *
 * The ER collections ride the EXISTING backup snapshot (backup-service's
 * snapshotState reads them via the exported observables — never a parallel
 * backup system; identity-rules §9.4 / INV-57).
 */
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import type {
  ErAggregationEvent,
  ErIdentityEdge,
  ErMatchProposal,
  ErObservation,
} from "../../../domain/identity/types";
import type { ErPriorObservation } from "../../../domain/identity/engine";
import type {
  ErMergeParentsInput,
  ErMergeResult,
  ErReviewDecisionInput,
  ErSourceObservationRecord,
  ErUnmergeInput,
  IdentityResolutionRepository,
} from "../../../domain/identity/repository";
import type { ErAnalysisResult } from "../../../domain/identity/types";
import type { Parent } from "../../../domain/model/parent";
import { SubjectBehavior } from "../subject-behavior";
import { appendAudit, nowIso, store, TENANT_ID } from "./mock-store";
import { logger } from "../../../core/logger";

// ---------------------------------------------------------------------------
// The in-memory collections (the mock-store pattern — session singletons)
// ---------------------------------------------------------------------------

const observations: ErSourceObservationRecord[] = [];
const proposals: ErMatchProposal[] = [];
const edges: ErIdentityEdge[] = [];
const events: ErAggregationEvent[] = [];

/** The archived merged-away parents (the mock's reversibility archive). */
const archivedParents: Parent[] = [];

const proposals$ = new SubjectBehavior<readonly ErMatchProposal[]>([...proposals]);
const edges$ = new SubjectBehavior<readonly ErIdentityEdge[]>([...edges]);
const events$ = new SubjectBehavior<readonly ErAggregationEvent[]>([...events]);

function notify(): void {
  proposals$.set([...proposals]);
  edges$.set([...edges]);
  events$.set([...events]);
}

/** Test/reset hygiene — clears the ER state (the mock reset convention). */
export function resetMockIdentityResolution(): void {
  observations.length = 0;
  proposals.length = 0;
  edges.length = 0;
  events.length = 0;
  archivedParents.length = 0;
  notify();
}

/** Deterministic ids (no Math.random — the retry-convergence rule). */
let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${String(seq).padStart(6, "0")}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// The repository
// ---------------------------------------------------------------------------

export class MockIdentityResolutionRepository implements IdentityResolutionRepository {
  async recordObservations(
    incoming: readonly ErObservation[],
    run: ErAnalysisResult,
    hashes: ReadonlyMap<string, string>,
  ): Promise<Result<void>> {
    const byId = new Map(incoming.map((o) => [o.id, o]));
    for (const proposal of run.proposals) {
      for (const key of [proposal.aObservationId, proposal.bObservationId]) {
        const obs = byId.get(key);
        if (!obs) continue;
        const hash = hashes.get(key) ?? "";
        const exists = observations.some(
          (r) => r.tenantId === TENANT_ID && r.observationKey === obs.id && r.payloadHash === hash,
        );
        if (exists) continue;
        observations.push({
          id: nextId("er-obs"),
          tenantId: TENANT_ID,
          observationKey: obs.id,
          sourceSystem: obs.sourceSystem,
          sourceRecordId: obs.sourceRecordId,
          kind: obs.kind,
          canonicalId: obs.canonicalId,
          payloadHash: hash,
          displayName: obs.displayName,
          phones: obs.phones,
          email: obs.email,
          gradeLevelCode: obs.gradeLevelCode ? `${obs.gradeLevelCode}` : null,
          transportDestination: obs.transportDestination,
          academicYear: obs.academicYear,
          tier: obs.tier,
          analyzedAt: nowIso(),
          runId: run.runId,
        });
      }
    }
    logger.info("er.recordObservations", { runId: run.runId, total: observations.length });
    return Ok(undefined);
  }

  async listPriorObservations(): Promise<readonly ErPriorObservation[]> {
    return observations.map((r) => ({
      sourceSystem: r.sourceSystem,
      sourceRecordId: r.sourceRecordId,
      payloadHash: r.payloadHash,
    }));
  }

  async recordProposals(run: ErAnalysisResult): Promise<Result<void>> {
    // Idempotent per run: a re-analysis of the same run replaces its rows.
    for (let i = proposals.length - 1; i >= 0; i--) {
      if (proposals[i].runId === run.runId) proposals.splice(i, 1);
    }
    proposals.push(...run.proposals.map((p) => ({ ...p })));
    proposals.sort((a, b) => b.score.confidence - a.score.confidence || (a.id < b.id ? -1 : 1));
    events.push({
      id: nextId("er-evt"),
      eventType: "ANALYSIS_RUN",
      runId: run.runId,
      canonicalId: "",
      mergedAwayId: null,
      observationIds: [],
      actorId: "system",
      actorName: "ER-PMAE",
      rationale: null,
      payload: { stats: run.stats },
      createdAt: nowIso(),
    });
    notify();
    appendAudit({
      action: "er.analysis_run",
      entityType: "er_match_proposal",
      entityId: run.runId,
      actorId: "system",
      actorName: "ER-PMAE",
      diff: {
        after: {
          runId: run.runId,
          proposals: run.proposals.length,
          stats: run.stats,
        },
      },
      note: `Analyse d'identité ER-PMAE : ${run.proposals.length} proposition(s) sur ${run.stats.incomingCount} observation(s) entrante(s).`,
    });
    return Ok(undefined);
  }

  observeProposals() {
    return {
      get: () => proposals$.get(),
      subscribe: (cb: (rows: readonly ErMatchProposal[]) => void) => proposals$.subscribe(cb),
    };
  }

  async decideProposal(
    input: ErReviewDecisionInput,
    merge?: ErMergeParentsInput,
  ): Promise<Result<{ merge?: ErMergeResult }>> {
    const proposalIndex = proposals.findIndex((p) => p.id === input.proposalId);
    const proposal = proposalIndex >= 0 ? proposals[proposalIndex] : undefined;
    if (!proposal) return Err(Errors.notFound("ErMatchProposal", input.proposalId));
    if (proposal.status !== "proposed") {
      return Err(
        Errors.conflict(
          `Proposal ${input.proposalId} already decided (${proposal.status})`,
          "Cette proposition a déjà été décidée — le journal d'audit est la voie de correction.",
        ),
      );
    }

    const edgeIndex = edges.findIndex(
      (e) => e.aObservationId === proposal.aObservationId && e.bObservationId === proposal.bObservationId,
    );

    if (input.decision === "reject") {
      const edge: ErIdentityEdge = {
        id: nextId("er-edge"),
        aObservationId: proposal.aObservationId,
        bObservationId: proposal.bObservationId,
        confidence: proposal.score.confidence,
        status: "negative",
        evidence: proposal.score.evidence,
        createdAt: nowIso(),
        createdBy: input.actorId,
        severedAt: null,
        severedBy: null,
      };
      if (edgeIndex >= 0) edges[edgeIndex] = edge;
      else edges.push(edge);

      proposals[proposalIndex] = {
        ...proposal,
        status: "rejected" as const,
        decidedBy: input.actorId,
        decidedAt: nowIso(),
        rationale: input.rationale,
      };

      events.push({
        id: nextId("er-evt"),
        eventType: "PROPOSAL_REJECTED",
        runId: proposal.runId,
        canonicalId: observationCanonicalId(proposal.bObservationId) ?? "",
        mergedAwayId: null,
        observationIds: [proposal.aObservationId, proposal.bObservationId],
        actorId: input.actorId,
        actorName: input.actorName,
        rationale: input.rationale,
        payload: { proposalId: proposal.id, confidence: proposal.score.confidence },
        createdAt: nowIso(),
      });
      notify();
      appendAudit({
        action: "er.decide_proposal",
        entityType: "er_match_proposal",
        entityId: proposal.id,
        actorId: input.actorId,
        actorName: input.actorName,
        diff: { after: { proposalId: proposal.id, decision: "reject" } },
        note: `ER-PMAE : proposition rejetée (${proposal.id}) — contrainte négative enregistrée.`,
      });
      return Ok({});
    }

    // approve
    if (edgeIndex >= 0 && edges[edgeIndex].status === "negative") {
      return Err(
        Errors.conflict(
          `Pair ${proposal.aObservationId}/${proposal.bObservationId} was rejected before`,
          "Cette paire a déjà été rejetée — la contrainte négative est active.",
        ),
      );
    }
    const edge: ErIdentityEdge = {
      id: nextId("er-edge"),
      aObservationId: proposal.aObservationId,
      bObservationId: proposal.bObservationId,
      confidence: proposal.score.confidence,
      status: "active",
      evidence: proposal.score.evidence,
      createdAt: nowIso(),
      createdBy: input.actorId,
      severedAt: null,
      severedBy: null,
    };
    if (edgeIndex >= 0) edges[edgeIndex] = edge;
    else edges.push(edge);

    proposals[proposalIndex] = {
      ...proposal,
      status: "approved" as const,
      decidedBy: input.actorId,
      decidedAt: nowIso(),
      rationale: input.rationale,
    };

    events.push({
      id: nextId("er-evt"),
      eventType: "PROPOSAL_APPROVED",
      runId: proposal.runId,
      canonicalId: observationCanonicalId(proposal.bObservationId) ?? "",
      mergedAwayId: null,
      observationIds: [proposal.aObservationId, proposal.bObservationId],
      actorId: input.actorId,
      actorName: input.actorName,
      rationale: input.rationale,
      payload: { proposalId: proposal.id, confidence: proposal.score.confidence },
      createdAt: nowIso(),
    });

    // A merge of two EXISTING canonical entities rides the same decision.
    let mergeResult: ErMergeResult | undefined;
    if (merge) {
      const merged = await this.mergeParents(merge);
      if (!merged.ok) return merged;
      mergeResult = merged.value;
      proposals[proposalIndex] = { ...proposals[proposalIndex], status: "executed" as const };
    }
    notify();
    appendAudit({
      action: "er.decide_proposal",
      entityType: "er_match_proposal",
      entityId: proposal.id,
      actorId: input.actorId,
      actorName: input.actorName,
      diff: { after: { proposalId: proposal.id, decision: "approve", merged: !!merge } },
      note: `ER-PMAE : proposition approuvée (${proposal.id})${merge ? " — fusion exécutée" : ""}.`,
    });
    return Ok({ merge: mergeResult });
  }

  observeEdges() {
    return {
      get: () => edges$.get(),
      subscribe: (cb: (rows: readonly ErIdentityEdge[]) => void) => edges$.subscribe(cb),
    };
  }

  observeEvents() {
    return {
      get: () => events$.get(),
      subscribe: (cb: (rows: readonly ErAggregationEvent[]) => void) => events$.subscribe(cb),
    };
  }

  async mergeParents(input: ErMergeParentsInput): Promise<Result<ErMergeResult>> {
    const target = store.parents.find((p) => p.id === input.targetParentId);
    const source = store.parents.find((p) => p.id === input.sourceParentId);
    if (!target || !source) {
      return Err(Errors.notFound("Parent", !target ? input.targetParentId : input.sourceParentId));
    }
    if (source.id === target.id) {
      return Err(Errors.validation("La cible et la source de la fusion doivent être distinctes."));
    }
    if (archivedParents.some((p) => p.id === source.id)) {
      return Err(
        Errors.conflict(
          `Parent ${source.id} is already merged away`,
          "Ce parent est déjà fusionné — annulez la fusion précédente d'abord.",
        ),
      );
    }

    // 1. Capture the COMPLETE prior mapping + re-point (INV-54).
    const rePointed: Record<string, Record<string, string>> = {
      students: {},
      payments: {},
      installments: {},
      ledger: {},
    };
    // The domain rows are readonly — replace them (the store arrays are
    // mutable; the notify below refreshes every open stream).
    store.students = store.students.map((s) =>
      s.parentId === source.id ? ((rePointed.students[s.id] = source.id), { ...s, parentId: target.id }) : s,
    );
    store.payments = store.payments.map((p) =>
      p.parentId === source.id ? ((rePointed.payments[p.id] = source.id), { ...p, parentId: target.id }) : p,
    );
    store.installments = store.installments.map((i) =>
      i.parentId === source.id ? ((rePointed.installments[i.id] = source.id), { ...i, parentId: target.id }) : i,
    );
    store.ledger = store.ledger.map((l) =>
      l.parentId === source.id ? ((rePointed.ledger[l.id] = source.id), { ...l, parentId: target.id }) : l,
    );
    store.notifyStudents();
    store.notifyPayments();
    store.notifyInstallments();
    store.notifyLedger();

    // 2. Archive + remove the merged-away parent (the mock's hard-remove
    //    convention — the Supabase twin soft-deletes; both hide the row
    //    from the roster while the event keeps it fully recoverable).
    archivedParents.push(source);
    store.parents = store.parents.filter((p) => p.id !== source.id);
    store.notifyParents();

    // 3. The append-only event with the complete restore mapping.
    const eventId = nextId("er-evt");
    events.push({
      id: eventId,
      eventType: "MERGE_EXECUTED",
      runId: null,
      canonicalId: target.id,
      mergedAwayId: source.id,
      observationIds: [],
      actorId: input.actorId,
      actorName: input.actorName,
      rationale: input.rationale,
      payload: {
        proposalId: input.proposalId,
        restoreMapping: rePointed,
        archivedParent: source,
      },
      createdAt: nowIso(),
    });
    notify();

    appendAudit({
      action: "er.merge_parents",
      entityType: "parent",
      entityId: target.id,
      actorId: input.actorId,
      actorName: input.actorName,
      diff: {
        before: { sourceParentId: source.id, sourceParentCode: source.code },
        after: {
          targetParentId: target.id,
          targetParentCode: target.code,
          eventId,
          rePointed: {
            students: Object.keys(rePointed.students).length,
            payments: Object.keys(rePointed.payments).length,
            installments: Object.keys(rePointed.installments).length,
            ledger: Object.keys(rePointed.ledger).length,
          },
        },
      },
      note: `ER-PMAE : fusion réversible du parent ${source.code} dans ${target.code} — mappage complet enregistré.`,
    });

    return Ok({ eventId, rePointed });
  }

  async unmergeParents(input: ErUnmergeInput): Promise<Result<void>> {
    const event = events.find((e) => e.id === input.eventId && e.eventType === "MERGE_EXECUTED");
    if (!event) return Err(Errors.notFound("ErAggregationEvent", input.eventId));
    if (events.some((e) => e.eventType === "MERGE_UNDONE" && (e.payload as { reversesEventId?: string }).reversesEventId === input.eventId)) {
      return Err(Errors.conflict(`Merge ${input.eventId} is already undone`, "Cette fusion est déjà annulée."));
    }

    const mapping = (event.payload as { restoreMapping?: Record<string, Record<string, string>> }).restoreMapping;
    const archived = (event.payload as { archivedParent?: Parent }).archivedParent;

    // 1. Replay the prior mapping (only rows still pointing at the target).
    const restored = { students: 0, payments: 0, installments: 0, ledger: 0 };
    if (mapping) {
      store.students = store.students.map((s) => {
        const prev = (mapping.students ?? {})[s.id];
        if (prev !== undefined && s.parentId === event.canonicalId) {
          restored.students++;
          return { ...s, parentId: prev };
        }
        return s;
      });
      store.payments = store.payments.map((p) => {
        const prev = (mapping.payments ?? {})[p.id];
        if (prev !== undefined && p.parentId === event.canonicalId) {
          restored.payments++;
          return { ...p, parentId: prev };
        }
        return p;
      });
      store.installments = store.installments.map((i) => {
        const prev = (mapping.installments ?? {})[i.id];
        if (prev !== undefined && i.parentId === event.canonicalId) {
          restored.installments++;
          return { ...i, parentId: prev };
        }
        return i;
      });
      store.ledger = store.ledger.map((l) => {
        const prev = (mapping.ledger ?? {})[l.id];
        if (prev !== undefined && l.parentId === event.canonicalId) {
          restored.ledger++;
          return { ...l, parentId: prev };
        }
        return l;
      });
    }

    // 2. Restore the merged-away parent.
    if (archived && !store.parents.some((p) => p.id === archived.id)) {
      store.parents = [archived, ...store.parents];
      const idx = archivedParents.findIndex((p) => p.id === archived.id);
      if (idx >= 0) archivedParents.splice(idx, 1);
    }
    store.notifyStudents();
    store.notifyPayments();
    store.notifyInstallments();
    store.notifyLedger();
    store.notifyParents();

    // 3. Sever the active edges tied to the merged-away canonical entity.
    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      if (
        edge.status === "active" &&
        (edge.aObservationId === `canonical:${event.mergedAwayId}` ||
          edge.bObservationId === `canonical:${event.mergedAwayId}`)
      ) {
        edges[i] = {
          ...edge,
          status: "severed" as const,
          severedAt: nowIso(),
          severedBy: input.actorId,
        };
      }
    }

    // 4. The MERGE_UNDONE event.
    events.push({
      id: nextId("er-evt"),
      eventType: "MERGE_UNDONE",
      runId: event.runId,
      canonicalId: event.canonicalId,
      mergedAwayId: event.mergedAwayId,
      observationIds: event.observationIds,
      actorId: input.actorId,
      actorName: input.actorName,
      rationale: input.rationale,
      payload: { reversesEventId: input.eventId, restored },
      createdAt: nowIso(),
    });
    notify();

    appendAudit({
      action: "er.unmerge_parents",
      entityType: "parent",
      entityId: event.mergedAwayId ?? "",
      actorId: input.actorId,
      actorName: input.actorName,
      diff: {
        before: { mergeEventId: input.eventId },
        after: { restoredParentId: event.mergedAwayId, restored },
      },
      note: `ER-PMAE : annulation de la fusion ${input.eventId} — mappage restauré, parent rétabli.`,
    });
    return Ok(undefined);
  }

  async hasAggregationState(): Promise<boolean> {
    return (
      proposals.some((p) => p.status !== "proposed") ||
      edges.some((e) => e.status === "active") ||
      events.some((e) => ["MERGE_EXECUTED", "MERGE_UNDONE", "BINDING_EXECUTED"].includes(e.eventType))
    );
  }
}

function observationCanonicalId(key: string): string | null {
  const row = observations.find((o) => o.observationKey === key);
  return row?.canonicalId ?? null;
}

export const mockIdentityResolutionRepository = new MockIdentityResolutionRepository();

/** The backup snapshot's ER section (backup-service consumes this). */
export function erBackupSnapshot(): Record<string, unknown> {
  return {
    erObservations: [...observations],
    erProposals: [...proposals],
    erEdges: [...edges],
    erEvents: [...events],
    erArchivedParents: [...archivedParents],
  };
}

/** The restore path's ER section applier (a pre-aggregation backup restores ZERO residue — INV-58). */
export function erBackupRestore(snapshot: Record<string, unknown>): void {
  const arr = (key: string): unknown[] => (Array.isArray(snapshot[key]) ? (snapshot[key] as unknown[]) : []);
  observations.length = 0;
  observations.push(...(arr("erObservations") as ErSourceObservationRecord[]));
  proposals.length = 0;
  proposals.push(...(arr("erProposals") as ErMatchProposal[]));
  edges.length = 0;
  edges.push(...(arr("erEdges") as ErIdentityEdge[]));
  events.length = 0;
  events.push(...(arr("erEvents") as ErAggregationEvent[]));
  archivedParents.length = 0;
  archivedParents.push(...(arr("erArchivedParents") as Parent[]));
  notify();
}
