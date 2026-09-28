/**
 * The ER-PMAE wiring for the T-414 EntityMatcher seam — T-438 / ADR-032.
 *
 * This module bridges the pure domain engine (src/domain/identity) to the
 * import engine's extension point (import-config/extensions.ts — the seam
 * issue #14 shipped deliberately unwired):
 *
 *   - `erImportRowObservationId(rowIndex)` — the ONE observation-id
 *     convention shared by the analysis and the matcher call;
 *   - `erObservationFromImportRow` — an ImportRecord → ErObservation;
 *   - `erObservationsFromParents` — the existing roster as observations;
 *   - `ConfirmedEntityMatcher` — the EntityMatcher implementation that
 *     binds ONLY human-confirmed proposals (INV-50: nothing merges without
 *     explicit confirmation — this class is constructed exclusively from
 *     approved decisions);
 *   - `runErImportAnalysis` — the import-time orchestrator (analyze +
 *     persist through the IdentityResolutionRepository).
 *
 * When the experimental flag is OFF, none of this is constructed anywhere —
 * the import path stays byte-identical to pre-T-438 (INV-40).
 */
import type { ErObservation, ErMatchProposal } from "../../../domain/identity/types";
import { analyze } from "../../../domain/identity/engine";
import { observationHash, normalizeObservation } from "../../../domain/identity/normalize";
import type { Parent } from "../../../domain/model/parent";
import type { IdentityResolutionRepository } from "../../../domain/identity/repository";
import { resolveGradeFromClasse } from "./mappers/niveau-mapper";
import type { ImportRecord } from "./types";
import type {
  CanonicalEntityRef,
  EntityMatcher,
  EntityMatchOutcome,
} from "../import-config/extensions";

// ---------------------------------------------------------------------------
// The observation-id convention (shared by analysis + matcher)
// ---------------------------------------------------------------------------

/**
 * The observation id for an incoming import row. The rowIndex is unique
 * within one import session (the modal analyzes and commits the SAME file),
 * so this key is unambiguous where it is used — the bindings map.
 */
export function erImportRowObservationId(rowIndex: number): string {
  return `import:row:${rowIndex}`;
}

// ---------------------------------------------------------------------------
// Observation builders
// ---------------------------------------------------------------------------

function firstPhone(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((r) => String(r ?? ""));
  if (typeof raw === "string") return [raw];
  return [];
}

/** Build the incoming observation for one ETAT row (the family identity). */
export function erObservationFromImportRow(
  record: ImportRecord,
  rowIndex: number,
  sourceSystem: string,
  academicYear: string | null,
): ErObservation {
  const grade = resolveGradeFromClasse(record.classe, record.niveau);
  return {
    id: erImportRowObservationId(rowIndex),
    sourceSystem,
    sourceRecordId: `row-${rowIndex}`,
    kind: "parent",
    displayName: typeof record.nom === "string" && record.nom.trim().length > 0
      ? record.nom.trim()
      : typeof record.tuteur === "string" && record.tuteur.trim().length > 0
        ? record.tuteur.trim()
        : null,
    phones: firstPhone(record.nem),
    email: typeof record.email === "string" ? record.email : null,
    gradeLevelCode: grade.gradeLevel ?? null,
    transportDestination: typeof record.distination === "string" ? record.distination : null,
    gender: null,
    academicYear,
    extractedAt: new Date().toISOString(),
    tier: "import",
    canonicalId: null,
  };
}

/** The existing roster (parents) as observations — the analysis targets. */
export function erObservationsFromParents(parents: readonly Parent[]): ErObservation[] {
  return parents.map((p) => ({
    id: `canonical:${p.id}`,
    sourceSystem: "canonical",
    sourceRecordId: p.code,
    kind: "parent" as const,
    displayName: p.displayName ?? `${p.firstName} ${p.lastName}`.trim(),
    phones: [p.phone, ...(p.whatsapp ? [p.whatsapp] : [])].filter((x) => x && x.length > 0),
    email: p.email,
    gradeLevelCode: null,
    transportDestination: null,
    gender: null,
    academicYear: null,
    extractedAt: new Date().toISOString(),
    tier: "manual" as const,
    canonicalId: p.id,
  }));
}

// ---------------------------------------------------------------------------
// The confirmed-bindings matcher (the T-414 EntityMatcher implementation)
// ---------------------------------------------------------------------------

/**
 * The EntityMatcher that binds ONLY human-confirmed proposals.
 *
 * Constructed exclusively from APPROVED decisions (the review surface) —
 * INV-50. With an empty bindings map it answers "no match" for everything
 * (the NoOp-equivalent behavior).
 */
export class ConfirmedEntityMatcher implements EntityMatcher {
  constructor(private readonly bindings: ReadonlyMap<string, string>) {}

  async match(
    source: CanonicalEntityRef,
    existing: readonly CanonicalEntityRef[],
  ): Promise<EntityMatchOutcome> {
    const targetId = this.bindings.get(source.id);
    if (!targetId) {
      return { matched: false, reason: "aucun rapprochement confirmé pour cette ligne" };
    }
    const target = existing.find((e) => e.id === targetId);
    if (!target) {
      return { matched: false, reason: "la cible confirmée n'existe plus dans le registre" };
    }
    return { matched: true, target, confidence: 1, strategy: "er-pmae-confirmed" };
  }
}

// ---------------------------------------------------------------------------
// The import-time analysis orchestrator
// ---------------------------------------------------------------------------

export interface ErImportAnalysisInput {
  readonly records: ReadonlyArray<{ record: ImportRecord; rowIndex: number }>;
  readonly parents: readonly Parent[];
  readonly repo: IdentityResolutionRepository;
  /** The workbook identity (e.g. "xlsx:2027-2026.xlsx"). */
  readonly sourceSystem: string;
  readonly academicYear: string | null;
  readonly now?: string;
}

export interface ErImportAnalysisOutput {
  readonly runId: string;
  readonly proposals: readonly ErMatchProposal[];
  readonly stats: {
    readonly analyzed: number;
    readonly definite: number;
    readonly probable: number;
    readonly review: number;
    readonly unbound: number;
  };
  /** The rowIndex → observation-id map (the review surface's join key). */
  readonly rowObservationIds: ReadonlyMap<number, string>;
}

/**
 * Run the ER analysis for an import session and persist it (identity-rules
 * §7.2 — the dry-run analysis → the dedicated review surface; nothing is
 * bound yet).
 */
export async function runErImportAnalysis(
  input: ErImportAnalysisInput,
): Promise<ErImportAnalysisOutput> {
  const now = input.now ?? new Date().toISOString();
  const incoming = input.records.map(({ record, rowIndex }) =>
    erObservationFromImportRow(record, rowIndex, input.sourceSystem, input.academicYear),
  );
  const existing = erObservationsFromParents(input.parents);

  const prior = await input.repo.listPriorObservations();
  const result = analyze(
    { incoming, existing, negativePairs: [], now },
    prior,
  );

  // Persist the observations + proposals (the auditable analysis record).
  const hashes = new Map<string, string>();
  for (const obs of incoming) {
    hashes.set(
      obs.id,
      observationHash(normalizeObservation(obs), obs.sourceSystem, obs.sourceRecordId),
    );
  }
  await input.repo.recordObservations(incoming, result, hashes);
  await input.repo.recordProposals(result);

  const rowObservationIds = new Map<number, string>(
    input.records.map(({ rowIndex }) => [rowIndex, erImportRowObservationId(rowIndex)] as const),
  );

  return {
    runId: result.runId,
    proposals: result.proposals,
    stats: {
      analyzed: incoming.length,
      definite: result.stats.proposals.definite,
      probable: result.stats.proposals.probable,
      review: result.stats.proposals.review,
      unbound: result.unbound.length,
    },
    rowObservationIds,
  };
}
