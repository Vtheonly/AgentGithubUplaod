/**
 * ER-PMAE canonical synthesis — identity-rules §6.3 (T-438 / ADR-032).
 *
 * Field survivorship rules (in precedence order) with MANDATORY field-level
 * provenance (INV-53): authoritative tier → temporal recency → additive set
 * union (phones) → structural completeness (longest name). The synthesis is
 * a PROJECTION (what the merged view should show) — the surviving canonical
 * entity stays the storage record; this module never writes anything.
 */
import type {
  ErCanonicalSynthesis,
  ErFieldProvenance,
  ErNormalized,
  ErObservation,
  ErSurvivorshipRule,
} from "./types";

/** Pick by authoritative tier, then recency, then completeness. */
function resolveScalar<T>(
  field: string,
  candidates: ReadonlyArray<{ observationId: string; value: T; tier: ErObservation["tier"]; extractedAt: string }>,
  now: string,
  preferComplete: (a: T, b: T) => boolean,
): ErFieldProvenance<T> {
  if (candidates.length === 0) {
    return { field, value: null as T, sourceObservationId: null, rule: "SINGLE_SOURCE", assignedAt: now };
  }
  if (candidates.length === 1) {
    const only = candidates[0];
    return { field, value: only.value, sourceObservationId: only.observationId, rule: "SINGLE_SOURCE", assignedAt: now };
  }
  const sorted = [...candidates].sort((x, y) => {
    // Tier first (manual > import).
    const tierRank = (t: ErObservation["tier"]) => (t === "manual" ? 0 : 1);
    const byTier = tierRank(x.tier) - tierRank(y.tier);
    if (byTier !== 0) return byTier;
    // Then recency (newest first).
    const byTime = y.extractedAt.localeCompare(x.extractedAt);
    if (byTime !== 0) return byTime;
    // Then completeness (longest/most complete wins).
    return preferComplete(x.value, y.value) ? -1 : 1;
  });
  const winner = sorted[0];
  const rule: ErSurvivorshipRule =
    winner.tier !== sorted[1].tier ? "AUTHORITATIVE_TIER"
      : winner.extractedAt !== sorted[1].extractedAt ? "TEMPORAL_RECENCY"
        : "STRUCTURAL_COMPLETENESS";
  return { field, value: winner.value, sourceObservationId: winner.observationId, rule, assignedAt: now };
}

/**
 * Synthesize the canonical projection of one accepted cluster
 * (identity-rules §6.3). Phones resolve by SET UNION across the cluster
 * (an incoming search by an older number still finds the profile);
 * every field records its provenance.
 */
export function synthesizeCanonical(
  clusterObservations: readonly ErObservation[],
  normalized: readonly ErNormalized[],
  now: string,
): ErCanonicalSynthesis {
  const normById = new Map(normalized.map((n) => [n.observationId, n]));
  const members = clusterObservations.filter((o) => normById.has(o.id));
  const ids = members.map((o) => o.id);

  // Display name: the raw recorded names, resolved by tier/recency/completeness.
  const nameCandidates = members
    .filter((o) => typeof o.displayName === "string" && o.displayName.trim().length > 0)
    .map((o) => ({
      observationId: o.id,
      value: (o.displayName as string).trim(),
      tier: o.tier,
      extractedAt: o.extractedAt,
    }));
  const displayName = resolveScalar(
    "displayName",
    nameCandidates,
    now,
    (a, b) => a.length > b.length,
  );

  // Phones: SET UNION of the normalized sets (all unique numbers survive).
  const phoneUnion = new Set<string>();
  let phoneSource: string | null = null;
  for (const m of members) {
    const n = normById.get(m.id);
    if (!n) continue;
    if (n.phones.length > 0 && phoneSource === null) phoneSource = m.id;
    for (const p of n.phones) phoneUnion.add(p);
  }
  const phones: ErFieldProvenance<readonly string[]> = {
    field: "phones",
    value: [...phoneUnion].sort(),
    sourceObservationId: phoneSource,
    rule: "SET_UNION",
    assignedAt: now,
  };

  // Email / grade / transport: scalar resolution.
  const emailCandidates = members
    .filter((o) => o.email !== null && o.email.trim().length > 0)
    .map((o) => ({ observationId: o.id, value: (o.email as string).trim(), tier: o.tier, extractedAt: o.extractedAt }));
  const email = resolveScalar("email", emailCandidates, now, () => false);

  const gradeCandidates = members
    .filter((o) => o.gradeLevelCode !== null && `${o.gradeLevelCode}`.length > 0)
    .map((o) => ({ observationId: o.id, value: `${o.gradeLevelCode}`, tier: o.tier, extractedAt: o.extractedAt }));
  const gradeLevelCode = resolveScalar("gradeLevelCode", gradeCandidates, now, () => false);

  const transportCandidates = members
    .filter((o) => o.transportDestination !== null && `${o.transportDestination}`.trim().length > 0)
    .map((o) => ({ observationId: o.id, value: `${o.transportDestination}`.trim(), tier: o.tier, extractedAt: o.extractedAt }));
  const transportDestination = resolveScalar("transportDestination", transportCandidates, now, (a, b) => a.length > b.length);

  return {
    observationIds: ids,
    displayName,
    phones,
    email,
    gradeLevelCode,
    transportDestination,
  };
}
