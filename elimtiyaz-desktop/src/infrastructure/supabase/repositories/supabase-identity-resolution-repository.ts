/**
 * SupabaseIdentityResolutionRepository — T-438 (migration 0130 / ADR-032).
 *
 * The contract mirrors the 0130 RPCs 1:1. NO client-side matching logic:
 * the pure engine (src/domain/identity) computes proposals; this repository
 * persists them, drives the ONLY execution path (fn_er_decide_proposal —
 * INV-50), and delegates the reversible merge/unmerge to the one-transaction
 * RPCs (fn_er_merge_parents / fn_er_unmerge_parents — INV-54).
 *
 * Observations + proposals persist via direct table upserts (the
 * on-conflict keys are the migration's unique constraints — never
 * ignoreDuplicates-on-PK, the IMPORT-116 lesson). Edges + events are
 * written ONLY by the RPCs.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { supabaseErrorToAppError } from "../supabase-client";
import { SubjectBehavior } from "../../mock/subject-behavior";
import { getTenantId, isUuid } from "./supabase-shared-repositories";
import type {
  ErAggregationEvent,
  ErIdentityEdge,
  ErMatchProposal,
  ErObservation,
  ErAnalysisResult,
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

// ---------------------------------------------------------------------------
// Wire rows (snake_case) + mappers
// ---------------------------------------------------------------------------

interface ErProposalRow {
  id: string;
  run_id: string;
  a_observation_key: string;
  b_observation_key: string;
  b_canonical_id: string | null;
  confidence: number | string;
  band: string;
  evidence: unknown;
  vetoes: string[] | null;
  status: string;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  rationale: string | null;
  created_at: string;
}

function mapProposalRow(r: ErProposalRow): ErMatchProposal {
  return {
    id: r.id,
    runId: r.run_id,
    createdAt: r.created_at,
    aObservationId: r.a_observation_key,
    bObservationId: r.b_observation_key,
    score: {
      aId: r.a_observation_key,
      bId: r.b_observation_key,
      confidence: Number(r.confidence),
      band: r.band as ErMatchProposal["score"]["band"],
      evidence: (r.evidence ?? []) as ErMatchProposal["score"]["evidence"],
      vetoes: (r.vetoes ?? []) as ErMatchProposal["score"]["vetoes"],
    },
    status: r.status as ErMatchProposal["status"],
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
    rationale: r.rationale,
  };
}

interface ErEdgeRow {
  id: string;
  a_observation_key: string;
  b_observation_key: string;
  confidence: number | string;
  status: string;
  evidence: unknown;
  created_at: string;
  created_by: string | null;
  severed_at: string | null;
  severed_by: string | null;
}

function mapEdgeRow(r: ErEdgeRow): ErIdentityEdge {
  return {
    id: r.id,
    aObservationId: r.a_observation_key,
    bObservationId: r.b_observation_key,
    confidence: Number(r.confidence),
    status: r.status as ErIdentityEdge["status"],
    evidence: (r.evidence ?? []) as ErIdentityEdge["evidence"],
    createdAt: r.created_at,
    createdBy: r.created_by ?? "system",
    severedAt: r.severed_at,
    severedBy: r.severed_by,
  };
}

interface ErEventRow {
  id: string;
  event_type: string;
  run_id: string | null;
  canonical_id: string | null;
  merged_away_id: string | null;
  observation_keys: string[] | null;
  actor_id: string | null;
  actor_name: string | null;
  rationale: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

function mapEventRow(r: ErEventRow): ErAggregationEvent {
  return {
    id: r.id,
    eventType: r.event_type as ErAggregationEvent["eventType"],
    runId: r.run_id,
    canonicalId: r.canonical_id ?? "",
    mergedAwayId: r.merged_away_id,
    observationIds: r.observation_keys ?? [],
    actorId: r.actor_id ?? "system",
    actorName: r.actor_name ?? "Système",
    rationale: r.rationale,
    payload: r.payload ?? {},
    createdAt: r.created_at,
  };
}

// ---------------------------------------------------------------------------
// The repository
// ---------------------------------------------------------------------------

export class SupabaseIdentityResolutionRepository implements IdentityResolutionRepository {
  constructor(private readonly client: SupabaseClient) {}

  private proposals$ = new SubjectBehavior<readonly ErMatchProposal[]>([]);
  private edges$ = new SubjectBehavior<readonly ErIdentityEdge[]>([]);
  private events$ = new SubjectBehavior<readonly ErAggregationEvent[]>([]);

  async recordObservations(
    observations: readonly ErObservation[],
    run: ErAnalysisResult,
    hashes: ReadonlyMap<string, string>,
  ): Promise<Result<void>> {
    const tenantId = getTenantId();
    if (!tenantId) return Err(Errors.validation("Tenant non résolu — reconnectez-vous."));
    const byId = new Map(observations.map((o) => [o.id, o]));
    const rows: Array<Record<string, unknown>> = [];
    for (const proposal of run.proposals) {
      for (const key of [proposal.aObservationId, proposal.bObservationId]) {
        const obs = byId.get(key);
        if (!obs) continue;
        rows.push({
          tenant_id: tenantId,
          observation_key: obs.id,
          source_system: obs.sourceSystem,
          source_record_id: obs.sourceRecordId,
          kind: obs.kind,
          canonical_id: isUuid(obs.canonicalId ?? "") ? obs.canonicalId : null,
          payload_hash: hashes.get(key) ?? "",
          display_name: obs.displayName,
          phones: obs.phones,
          email: obs.email,
          grade_level_code: obs.gradeLevelCode ? `${obs.gradeLevelCode}` : null,
          transport_destination: obs.transportDestination,
          academic_year: obs.academicYear,
          tier: obs.tier,
          run_id: run.runId,
        });
      }
    }
    if (rows.length === 0) return Ok(undefined);
    // Dedupe by (observation_key, payload_hash) client-side (the same
    // observation may back multiple proposals).
    const seen = new Set<string>();
    const uniqueRows = rows.filter((r) => {
      const k = `${r.observation_key}|${r.payload_hash}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const { error } = await this.client
      .from("er_source_observations")
      .upsert(uniqueRows, { onConflict: "tenant_id,observation_key,payload_hash" });
    if (error) return Err(supabaseErrorToAppError(error));
    return Ok(undefined);
  }

  async listPriorObservations(): Promise<readonly ErPriorObservation[]> {
    const tenantId = getTenantId();
    if (!tenantId) return [];
    const { data, error } = await this.client
      .from("er_source_observations")
      .select("source_system, source_record_id, payload_hash")
      .eq("tenant_id", tenantId)
      .limit(20000);
    if (error || !data) return [];
    return (data as Array<{ source_system: string; source_record_id: string; payload_hash: string }>).map(
      (r) => ({ sourceSystem: r.source_system, sourceRecordId: r.source_record_id, payloadHash: r.payload_hash }),
    );
  }

  async recordProposals(run: ErAnalysisResult): Promise<Result<void>> {
    const tenantId = getTenantId();
    if (!tenantId) return Err(Errors.validation("Tenant non résolu — reconnectez-vous."));
    if (run.proposals.length === 0) return Ok(undefined);
    const rows = run.proposals.map((p) => {
      // The canonical-entity observation convention: key = `canonical:<uuid>`
      // (the unmerge RPC's edge-severing relies on the same shape).
      const bKey = p.bObservationId;
      const bCanonical =
        bKey.startsWith("canonical:") && isUuid(bKey.slice("canonical:".length))
          ? bKey.slice("canonical:".length)
          : null;
      return {
        id: p.id,
        tenant_id: tenantId,
        run_id: p.runId,
        a_observation_key: p.aObservationId,
        b_observation_key: p.bObservationId,
        b_canonical_id: bCanonical,
        confidence: p.score.confidence,
        band: p.score.band,
        evidence: p.score.evidence,
        vetoes: p.score.vetoes,
        status: p.status,
        rationale: p.rationale,
        created_at: p.createdAt,
      };
    });
    const { error } = await this.client
      .from("er_match_proposals")
      .upsert(rows, { onConflict: "id" });
    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(undefined);
  }

  observeProposals() {
    void this.refresh();
    return {
      get: () => this.proposals$.get(),
      subscribe: (cb: (rows: readonly ErMatchProposal[]) => void) => this.proposals$.subscribe(cb),
    };
  }

  private refreshing = false;

  private async refresh(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const tenantId = getTenantId();
      if (!tenantId) return;
      const [p, e, v] = await Promise.all([
        this.client
          .from("er_match_proposals")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .limit(2000),
        this.client
          .from("er_identity_edges")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .limit(4000),
        this.client
          .from("er_aggregation_events")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .limit(2000),
      ]);
      if (!p.error && p.data) this.proposals$.set((p.data as ErProposalRow[]).map(mapProposalRow));
      if (!e.error && e.data) this.edges$.set((e.data as ErEdgeRow[]).map(mapEdgeRow));
      if (!v.error && v.data) this.events$.set((v.data as ErEventRow[]).map(mapEventRow));
    } finally {
      this.refreshing = false;
    }
  }

  async decideProposal(
    input: ErReviewDecisionInput,
    _merge?: ErMergeParentsInput,
  ): Promise<Result<{ merge?: ErMergeResult }>> {
    try {
      const { error } = await this.client.rpc("fn_er_decide_proposal", {
        p_proposal_id: input.proposalId,
        p_decision: input.decision,
        p_actor_id: isUuid(input.actorId) ? input.actorId : null,
        p_actor_name: input.actorName || null,
        p_rationale: input.rationale,
        p_tenant_id: getTenantId(),
      });
      if (error) return Err(supabaseErrorToAppError(error));
      // A merge of two EXISTING canonical entities follows the decision
      // through its OWN one-transaction RPC (the caller passes merge only
      // when the proposal joins two canonical rows).
      let merge: ErMergeResult | undefined;
      if (_merge && input.decision === "approve") {
        const merged = await this.mergeParents(_merge);
        if (!merged.ok) return merged;
        merge = merged.value;
      }
      await this.refresh();
      return Ok({ merge });
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  observeEdges() {
    void this.refresh();
    return {
      get: () => this.edges$.get(),
      subscribe: (cb: (rows: readonly ErIdentityEdge[]) => void) => this.edges$.subscribe(cb),
    };
  }

  observeEvents() {
    void this.refresh();
    return {
      get: () => this.events$.get(),
      subscribe: (cb: (rows: readonly ErAggregationEvent[]) => void) => this.events$.subscribe(cb),
    };
  }

  async mergeParents(input: ErMergeParentsInput): Promise<Result<ErMergeResult>> {
    if (!isUuid(input.targetParentId) || !isUuid(input.sourceParentId)) {
      return Err(Errors.validation("Les identifiants de parent doivent être des UUID valides."));
    }
    try {
      const { data, error } = await this.client.rpc("fn_er_merge_parents", {
        p_target_parent_id: input.targetParentId,
        p_source_parent_id: input.sourceParentId,
        p_proposal_id: input.proposalId,
        p_actor_id: isUuid(input.actorId) ? input.actorId : null,
        p_actor_name: input.actorName || null,
        p_rationale: input.rationale,
        p_tenant_id: getTenantId(),
      });
      if (error) return Err(supabaseErrorToAppError(error));
      const res = (data ?? {}) as {
        eventId?: string;
        rePointed?: Record<string, Record<string, string>>;
      };
      await this.refresh();
      return Ok({
        eventId: res.eventId ?? "",
        rePointed: res.rePointed ?? {},
      });
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  async unmergeParents(input: ErUnmergeInput): Promise<Result<void>> {
    if (!isUuid(input.eventId)) {
      return Err(Errors.validation("L'identifiant d'événement doit être un UUID valide."));
    }
    try {
      const { error } = await this.client.rpc("fn_er_unmerge_parents", {
        p_event_id: input.eventId,
        p_actor_id: isUuid(input.actorId) ? input.actorId : null,
        p_actor_name: input.actorName || null,
        p_rationale: input.rationale,
        p_tenant_id: getTenantId(),
      });
      if (error) return Err(supabaseErrorToAppError(error));
      await this.refresh();
      return Ok(undefined);
    } catch (e) {
      return Err(Errors.unknown(e as Error));
    }
  }

  async hasAggregationState(): Promise<boolean> {
    try {
      const { data, error } = await this.client.rpc("fn_er_has_aggregation_state", {
        p_tenant_id: getTenantId(),
      });
      if (error || data === null) return false;
      return Boolean(data);
    } catch {
      return false;
    }
  }
}

/** The recordObservations mapper's shared shape (used by the import wiring too). */
export function erObservationRows(
  tenantId: string,
  observations: readonly ErObservation[],
  hashes: ReadonlyMap<string, string>,
  runId: string,
): Array<Record<string, unknown>> {
  return observations.map((obs) => ({
    tenant_id: tenantId,
    observation_key: obs.id,
    source_system: obs.sourceSystem,
    source_record_id: obs.sourceRecordId,
    kind: obs.kind,
    canonical_id: isUuid(obs.canonicalId ?? "") ? obs.canonicalId : null,
    payload_hash: hashes.get(obs.id) ?? "",
    display_name: obs.displayName,
    phones: obs.phones,
    email: obs.email,
    grade_level_code: obs.gradeLevelCode ? `${obs.gradeLevelCode}` : null,
    transport_destination: obs.transportDestination,
    academic_year: obs.academicYear,
    tier: obs.tier,
    run_id: runId,
  }));
}

export type { ErSourceObservationRecord };
