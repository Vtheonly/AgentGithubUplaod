/**
 * T-438 — the ER-PMAE repository suite (identity-rules §7–§9; migration
 * 0130 / ADR-032; problems IDENT-100/101/102; issues #15/#16).
 *
 * What this suite pins:
 *
 *   A. THE MOCK REPOSITORY CONTRACT — recordObservations/recordProposals
 *      (idempotent per run), decideProposal as the ONLY execution path
 *      (INV-50: approve → the active edge + the event; reject → the
 *      negative edge + the event; a decided proposal is immutable).
 *   B. THE REVERSIBLE MERGE (INV-54) — mergeParents re-points
 *      students/payments/installments/ledger in ONE operation, archives the
 *      merged-away parent (absent from the roster), and records the complete
 *      prior mapping; unmergeParents replays it — every row back at its
 *      original parent, the archived parent restored, the edges severed,
 *      the MERGE_UNDONE event written; a second unmerge is refused.
 *   C. THE IDEMPOTENCY GATE (INV-55) — listPriorObservations feeds the
 *      engine's skip set; hasAggregationState stays honest.
 *   D. THE BACKUP ROUND-TRIP (INV-57/58) — erBackupSnapshot captures the
 *      full aggregation state; erBackupRestore({}) (a pre-aggregation
 *      archive) returns ZERO residue.
 *   E. THE SUPABASE WIRE SHAPES — fn_er_decide_proposal / fn_er_merge_parents /
 *      fn_er_unmerge_parents / fn_er_has_aggregation_state called with the
 *      0130 parameter names (the fake-client convention).
 *
 * Run:
 *   npx vitest run src/tests/infrastructure/t-438-er-repositories.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MockIdentityResolutionRepository,
  resetMockIdentityResolution,
  erBackupSnapshot,
  erBackupRestore,
} from "../../infrastructure/mock/repositories/identity-resolution-repository";
import { store } from "../../infrastructure/mock/repositories/mock-store";
import { SupabaseIdentityResolutionRepository } from "../../infrastructure/supabase/repositories/supabase-identity-resolution-repository";
import { analyze, observationHash, normalizeObservation } from "../../domain/identity";
import type { ErObservation } from "../../domain/identity/types";

const NOW = "2026-09-29T12:00:00.000Z";

beforeAll(() => {
  localStorage.setItem(
    "el-imtiyaz.session",
    JSON.stringify({ tenantId: "00000000-0000-0000-0000-000000000001", userId: "staff-1" }),
  );
});
afterAll(() => {
  localStorage.removeItem("el-imtiyaz.session");
});

// ---------------------------------------------------------------------------
// Fixtures — a two-family roster + an incoming workbook observation
// ---------------------------------------------------------------------------

const TARGET_PARENT_ID = "p-target-1";
const SOURCE_PARENT_ID = "p-source-1";

function seedTwoFamilies(): void {
  store.parents = [
    {
      ...store.parents[0],
      id: TARGET_PARENT_ID,
      code: "PAR-2026-TGT1",
      firstName: "Mohamed",
      lastName: "SEDIKI",
      displayName: "SEDIKI Mohamed",
      phone: "0663701834",
    },
    {
      ...store.parents[0],
      id: SOURCE_PARENT_ID,
      code: "PAR-2026-SRC1",
      firstName: "Mohamed",
      lastName: "SEDIKY",
      displayName: "SEDIKY Mohamed",
      phone: "0663701834", // same household phone — the duplicate's tell
    },
  ];
  store.students = [
    { ...store.students[0], id: "s-1", parentId: TARGET_PARENT_ID },
    { ...store.students[0], id: "s-2", parentId: SOURCE_PARENT_ID },
  ];
  store.payments = [
    {
      ...store.payments[0],
      id: "pay-1",
      parentId: SOURCE_PARENT_ID,
      amount: 125000,
    },
  ];
  store.installments = [
    { ...store.installments[0], id: "inst-1", parentId: SOURCE_PARENT_ID },
  ];
  store.ledger = [
    { ...store.ledger[0], id: "led-1", parentId: SOURCE_PARENT_ID },
  ];
}

function incomingObservation(): ErObservation {
  return {
    id: "xlsx:2027-2026:row-42",
    sourceSystem: "xlsx:2027-2026",
    sourceRecordId: "row-42",
    kind: "parent",
    displayName: "SEDIKI Mohamed",
    phones: ["0663701834"],
    email: null,
    gradeLevelCode: null,
    transportDestination: null,
    gender: null,
    academicYear: "2026-2027",
    extractedAt: NOW,
    tier: "import",
    canonicalId: null,
  };
}

function existingObservations(): ErObservation[] {
  return [
    {
      id: `canonical:${TARGET_PARENT_ID}`,
      sourceSystem: "canonical",
      sourceRecordId: "PAR-2026-TGT1",
      kind: "parent",
      displayName: "SEDIKI Mohamed",
      phones: ["0663701834"],
      email: null,
      gradeLevelCode: null,
      transportDestination: null,
      gender: null,
      academicYear: null,
      extractedAt: NOW,
      tier: "manual",
      canonicalId: TARGET_PARENT_ID,
    },
    {
      id: `canonical:${SOURCE_PARENT_ID}`,
      sourceSystem: "canonical",
      sourceRecordId: "PAR-2026-SRC1",
      kind: "parent",
      displayName: "SEDIKY Mohamed",
      phones: ["0663701834"],
      email: null,
      gradeLevelCode: null,
      transportDestination: null,
      gender: null,
      academicYear: null,
      extractedAt: NOW,
      tier: "manual",
      canonicalId: SOURCE_PARENT_ID,
    },
  ];
}

async function runAnalysis(repo: MockIdentityResolutionRepository) {
  const incoming = [incomingObservation()];
  const existing = existingObservations();
  const result = analyze({ incoming, existing, negativePairs: [], now: NOW });
  const hashes = new Map<string, string>();
  hashes.set(incoming[0].id, observationHash(normalizeObservation(incoming[0]), incoming[0].sourceSystem, incoming[0].sourceRecordId));
  await repo.recordObservations(incoming, result, hashes);
  await repo.recordProposals(result);
  return result;
}

// ---------------------------------------------------------------------------
// A. The mock repository contract (INV-50 — decisions)
// ---------------------------------------------------------------------------

describe("T-438 A — the mock repository decision contract", () => {
  it("recordProposals persists the proposals and the analysis event (idempotent per run)", async () => {
    resetMockIdentityResolution();
    seedTwoFamilies();
    const repo = new MockIdentityResolutionRepository();
    const result = await runAnalysis(repo);

    const proposals = repo.observeProposals().get();
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals.every((p) => p.status === "proposed")).toBe(true);
    expect(repo.observeEvents().get().some((e) => e.eventType === "ANALYSIS_RUN")).toBe(true);

    // Re-recording the SAME run replaces (no duplicates).
    await repo.recordProposals(result);
    expect(repo.observeProposals().get().length).toBe(proposals.length);
  });

  it("approve creates the ACTIVE edge + the event; a decided proposal is immutable", async () => {
    resetMockIdentityResolution();
    seedTwoFamilies();
    const repo = new MockIdentityResolutionRepository();
    await runAnalysis(repo);
    const proposal = repo.observeProposals().get()[0];

    const decision = await repo.decideProposal({
      proposalId: proposal.id,
      decision: "approve",
      actorId: "staff-1",
      actorName: "Admin",
      rationale: "Vérifié sur acte de naissance",
    });
    expect(decision.ok).toBe(true);
    expect(repo.observeProposals().get()[0].status).toBe("approved");
    expect(repo.observeEdges().get().some((e) => e.status === "active")).toBe(true);
    expect(repo.observeEvents().get().some((e) => e.eventType === "PROPOSAL_APPROVED")).toBe(true);

    // A decided proposal never re-decides (the audit trail is the correction path).
    const again = await repo.decideProposal({
      proposalId: proposal.id,
      decision: "reject",
      actorId: "staff-1",
      actorName: "Admin",
      rationale: null,
    });
    expect(again.ok).toBe(false);
    expect(repo.observeProposals().get()[0].status).toBe("approved");
  });

  it("reject creates the NEGATIVE edge (never re-proposed) + the event", async () => {
    resetMockIdentityResolution();
    seedTwoFamilies();
    const repo = new MockIdentityResolutionRepository();
    await runAnalysis(repo);
    const proposal = repo.observeProposals().get()[0];

    const decision = await repo.decideProposal({
      proposalId: proposal.id,
      decision: "reject",
      actorId: "staff-1",
      actorName: "Admin",
      rationale: "Deux personnes distinctes",
    });
    expect(decision.ok).toBe(true);
    expect(repo.observeProposals().get()[0].status).toBe("rejected");
    expect(repo.observeEdges().get().some((e) => e.status === "negative")).toBe(true);
    expect(repo.observeEvents().get().some((e) => e.eventType === "PROPOSAL_REJECTED")).toBe(true);

    // The negative edge feeds the engine's never-re-propose gate.
    const prior = await repo.listPriorObservations();
    expect(prior.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// B. The reversible merge (INV-54)
// ---------------------------------------------------------------------------

describe("T-438 B — the reversible merge/unmerge", () => {
  it("mergeParents re-points every relationship, archives the source, records the mapping", async () => {
    resetMockIdentityResolution();
    seedTwoFamilies();
    const repo = new MockIdentityResolutionRepository();

    const merged = await repo.mergeParents({
      targetParentId: TARGET_PARENT_ID,
      sourceParentId: SOURCE_PARENT_ID,
      proposalId: null,
      actorId: "staff-1",
      actorName: "Admin",
      rationale: "Doublon confirmé",
    });
    expect(merged.ok).toBe(true);

    // Every relationship now points at the survivor.
    expect(store.students.find((s) => s.id === "s-2")?.parentId).toBe(TARGET_PARENT_ID);
    expect(store.payments.find((p) => p.id === "pay-1")?.parentId).toBe(TARGET_PARENT_ID);
    expect(store.installments.find((i) => i.id === "inst-1")?.parentId).toBe(TARGET_PARENT_ID);
    expect(store.ledger.find((l) => l.id === "led-1")?.parentId).toBe(TARGET_PARENT_ID);
    // The merged-away parent left the roster.
    expect(store.parents.some((p) => p.id === SOURCE_PARENT_ID)).toBe(false);
    expect(store.parents.some((p) => p.id === TARGET_PARENT_ID)).toBe(true);

    // The complete prior mapping is recorded (the restore contract).
    const event = repo.observeEvents().get().find((e) => e.eventType === "MERGE_EXECUTED");
    expect(event).toBeDefined();
    const mapping = (event!.payload as { restoreMapping: Record<string, Record<string, string>> }).restoreMapping;
    expect(mapping.students["s-2"]).toBe(SOURCE_PARENT_ID);
    expect(mapping.payments["pay-1"]).toBe(SOURCE_PARENT_ID);
    expect(mapping.installments["inst-1"]).toBe(SOURCE_PARENT_ID);
    expect(mapping.ledger["led-1"]).toBe(SOURCE_PARENT_ID);

    // The not-pristine flag is honest.
    expect(await repo.hasAggregationState()).toBe(true);
  });

  it("unmergeParents restores the EXACT prior state; a second unmerge is refused", async () => {
    resetMockIdentityResolution();
    seedTwoFamilies();
    const repo = new MockIdentityResolutionRepository();

    const merged = await repo.mergeParents({
      targetParentId: TARGET_PARENT_ID,
      sourceParentId: SOURCE_PARENT_ID,
      proposalId: null,
      actorId: "staff-1",
      actorName: "Admin",
      rationale: null,
    });
    expect(merged.ok).toBe(true);
    if (!merged.ok) throw new Error("merge failed");
    const eventId = merged.value.eventId;

    const undone = await repo.unmergeParents({
      eventId,
      actorId: "staff-1",
      actorName: "Admin",
      rationale: "Fusion erronée",
    });
    expect(undone.ok).toBe(true);

    // Every row back at its ORIGINAL parent — the exact prior state.
    expect(store.students.find((s) => s.id === "s-2")?.parentId).toBe(SOURCE_PARENT_ID);
    expect(store.payments.find((p) => p.id === "pay-1")?.parentId).toBe(SOURCE_PARENT_ID);
    expect(store.installments.find((i) => i.id === "inst-1")?.parentId).toBe(SOURCE_PARENT_ID);
    expect(store.ledger.find((l) => l.id === "led-1")?.parentId).toBe(SOURCE_PARENT_ID);
    // The archived parent is restored to the roster.
    expect(store.parents.some((p) => p.id === SOURCE_PARENT_ID)).toBe(true);
    // The MERGE_UNDONE event is written.
    expect(repo.observeEvents().get().some((e) => e.eventType === "MERGE_UNDONE")).toBe(true);

    // Idempotence of the reversal: one unmerge per merge.
    const second = await repo.unmergeParents({
      eventId,
      actorId: "staff-1",
      actorName: "Admin",
      rationale: null,
    });
    expect(second.ok).toBe(false);
  });

  it("merge guards: unknown parents, self-merge, and double-merge are refused", async () => {
    resetMockIdentityResolution();
    seedTwoFamilies();
    const repo = new MockIdentityResolutionRepository();

    const unknown = await repo.mergeParents({
      targetParentId: "does-not-exist",
      sourceParentId: SOURCE_PARENT_ID,
      proposalId: null,
      actorId: "staff-1",
      actorName: "Admin",
      rationale: null,
    });
    expect(unknown.ok).toBe(false);

    const self = await repo.mergeParents({
      targetParentId: TARGET_PARENT_ID,
      sourceParentId: TARGET_PARENT_ID,
      proposalId: null,
      actorId: "staff-1",
      actorName: "Admin",
      rationale: null,
    });
    expect(self.ok).toBe(false);

    await repo.mergeParents({
      targetParentId: TARGET_PARENT_ID,
      sourceParentId: SOURCE_PARENT_ID,
      proposalId: null,
      actorId: "staff-1",
      actorName: "Admin",
      rationale: null,
    });
    const again = await repo.mergeParents({
      targetParentId: store.parents.find((p) => p.id !== TARGET_PARENT_ID)?.id ?? "x",
      sourceParentId: SOURCE_PARENT_ID,
      proposalId: null,
      actorId: "staff-1",
      actorName: "Admin",
      rationale: null,
    });
    expect(again.ok).toBe(false); // source already merged away
  });
});

// ---------------------------------------------------------------------------
// C. The idempotency gate (INV-55) + the honest state flag
// ---------------------------------------------------------------------------

describe("T-438 C — the idempotency gate + the state flag", () => {
  it("a pristine repository reports NO aggregation state", async () => {
    resetMockIdentityResolution();
    const repo = new MockIdentityResolutionRepository();
    expect(await repo.hasAggregationState()).toBe(false);
  });

  it("the engine's second analysis over the prior keys is a no-op", async () => {
    resetMockIdentityResolution();
    seedTwoFamilies();
    const repo = new MockIdentityResolutionRepository();
    const incoming = [incomingObservation()];
    const existing = existingObservations();
    const input = { incoming, existing, negativePairs: [], now: NOW };

    const first = await runAnalysis(repo);
    expect(first.proposals.length).toBeGreaterThan(0);

    // The persisted observations feed the idempotency gate.
    const prior = await repo.listPriorObservations();
    expect(prior.length).toBeGreaterThan(0);
    const second = analyze(input, prior);
    expect(second.proposals).toHaveLength(0);
    expect(second.stats.pairsScored).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// D. The backup round-trip (INV-57/58)
// ---------------------------------------------------------------------------

describe("T-438 D — the backup round-trip with aggregation state", () => {
  it("the snapshot captures the aggregation state; a full restore round-trips it", async () => {
    resetMockIdentityResolution();
    seedTwoFamilies();
    const repo = new MockIdentityResolutionRepository();
    await runAnalysis(repo);
    await repo.mergeParents({
      targetParentId: TARGET_PARENT_ID,
      sourceParentId: SOURCE_PARENT_ID,
      proposalId: null,
      actorId: "staff-1",
      actorName: "Admin",
      rationale: "backup round-trip",
    });

    const snapshot = erBackupSnapshot();
    expect((snapshot.erEvents as unknown[]).length).toBeGreaterThan(0);
    expect((snapshot.erProposals as unknown[]).length).toBeGreaterThan(0);
    expect((snapshot.erArchivedParents as unknown[]).length).toBe(1);

    // A FULL restore (the post-aggregation archive) restores the state.
    erBackupRestore({});
    expect((erBackupSnapshot().erEvents as unknown[]).length).toBe(0);
    erBackupRestore(snapshot as Record<string, unknown>);
    expect((erBackupSnapshot().erEvents as unknown[]).length).toBe(
      (snapshot.erEvents as unknown[]).length,
    );
    expect(await new MockIdentityResolutionRepository().hasAggregationState()).toBe(true);
  });

  it("restoring a PRE-aggregation archive leaves ZERO aggregation residue (INV-58)", async () => {
    resetMockIdentityResolution();
    seedTwoFamilies();
    const repo = new MockIdentityResolutionRepository();

    // The archive taken BEFORE any aggregation (the empty sections).
    const preAggregationArchive = erBackupSnapshot();
    expect((preAggregationArchive.erEvents as unknown[]).length).toBe(0);

    // ...then aggregation happens...
    await runAnalysis(repo);
    await repo.mergeParents({
      targetParentId: TARGET_PARENT_ID,
      sourceParentId: SOURCE_PARENT_ID,
      proposalId: null,
      actorId: "staff-1",
      actorName: "Admin",
      rationale: null,
    });
    expect(await repo.hasAggregationState()).toBe(true);

    // ...and restoring the pre-aggregation archive returns the prior state.
    erBackupRestore(preAggregationArchive as Record<string, unknown>);
    const after = erBackupSnapshot();
    expect((after.erObservations as unknown[]).length).toBe(0);
    expect((after.erProposals as unknown[]).length).toBe(0);
    expect((after.erEdges as unknown[]).length).toBe(0);
    expect((after.erEvents as unknown[]).length).toBe(0);
    expect((after.erArchivedParents as unknown[]).length).toBe(0);
    expect(await new MockIdentityResolutionRepository().hasAggregationState()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// E. The Supabase wire shapes (the fake-client convention)
// ---------------------------------------------------------------------------

describe("T-438 E — the Supabase repository wire shapes", () => {
  function fakeClient(calls: Array<{ fn: string; args: Record<string, unknown> }>) {
    return {
      rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        if (fn === "fn_er_decide_proposal") return { data: { eventId: "evt-1", status: "approved" }, error: null };
        if (fn === "fn_er_merge_parents") {
          return {
            data: { eventId: "evt-merge-1", rePointed: { students: { "s-2": SOURCE_PARENT_ID } } },
            error: null,
          };
        }
        if (fn === "fn_er_unmerge_parents") return { data: { eventId: "evt-2" }, error: null };
        if (fn === "fn_er_has_aggregation_state") return { data: true, error: null };
        return { data: {}, error: null };
      }),
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn(async () => ({ data: [], error: null })),
            })),
            limit: vi.fn(async () => ({ data: [], error: null })),
          })),
        })),
        upsert: vi.fn(async () => ({ error: null })),
      })),
    } as unknown as SupabaseClient;
  }

  it("decideProposal calls fn_er_decide_proposal with the 0130 parameter names", async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const repo = new SupabaseIdentityResolutionRepository(fakeClient(calls));
    const res = await repo.decideProposal({
      proposalId: "er-run:a→b",
      decision: "approve",
      actorId: "00000000-0000-0000-0000-000000000001",
      actorName: "Admin",
      rationale: "test",
    });
    expect(res.ok).toBe(true);
    const call = calls.find((c) => c.fn === "fn_er_decide_proposal");
    expect(call).toBeDefined();
    expect(call!.args.p_proposal_id).toBe("er-run:a→b");
    expect(call!.args.p_decision).toBe("approve");
    expect(call!.args.p_actor_name).toBe("Admin");
    expect(call!.args.p_rationale).toBe("test");
    expect(call!.args).toHaveProperty("p_tenant_id");
  });

  it("mergeParents calls fn_er_merge_parents with the 0130 parameter names", async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const repo = new SupabaseIdentityResolutionRepository(fakeClient(calls));
    const res = await repo.mergeParents({
      targetParentId: "11111111-1111-1111-1111-111111111111",
      sourceParentId: "22222222-2222-2222-2222-222222222222",
      proposalId: "prop-1",
      actorId: "00000000-0000-0000-0000-000000000001",
      actorName: "Admin",
      rationale: "doublon",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("merge rpc failed");
    expect(res.value.eventId).toBe("evt-merge-1");
    const call = calls.find((c) => c.fn === "fn_er_merge_parents");
    expect(call!.args.p_target_parent_id).toBe("11111111-1111-1111-1111-111111111111");
    expect(call!.args.p_source_parent_id).toBe("22222222-2222-2222-2222-222222222222");
    expect(call!.args.p_proposal_id).toBe("prop-1");
  });

  it("unmergeParents + hasAggregationState call their 0130 RPCs", async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const repo = new SupabaseIdentityResolutionRepository(fakeClient(calls));
    const undone = await repo.unmergeParents({
      eventId: "33333333-3333-3333-3333-333333333333",
      actorId: "00000000-0000-0000-0000-000000000001",
      actorName: "Admin",
      rationale: null,
    });
    expect(undone.ok).toBe(true);
    expect(await repo.hasAggregationState()).toBe(true);
    expect(calls.find((c) => c.fn === "fn_er_unmerge_parents")!.args.p_event_id).toBe(
      "33333333-3333-3333-3333-333333333333",
    );
    expect(calls.find((c) => c.fn === "fn_er_has_aggregation_state")).toBeDefined();
  });
});
