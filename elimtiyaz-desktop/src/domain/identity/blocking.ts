/**
 * ER-PMAE candidate generation (blocking) — identity-rules §3 (T-438 / ADR-032).
 *
 * Four independent passes; a candidate pair enters the evaluation pool when
 * it shares AT LEAST ONE key in ANY pass. Saturated keys (> limit entities)
 * are skipped for that pass, never fatal (INV-44).
 */
import { phoneticKey } from "./similarity";
import { ER_BLOCKING_SATURATION_LIMIT } from "./types";
import type { ErBlockingKey, ErNormalized } from "./types";

/** Generate one observation's blocking keys across all four passes. */
export function blockingKeysFor(norm: ErNormalized): readonly ErBlockingKey[] {
  const keys: ErBlockingKey[] = [];
  // P1 — exact phone (bridges severely misspelled names).
  for (const phone of norm.phones) {
    keys.push({ pass: "phone", key: `TEL:${phone}` });
  }
  // P2 — order-invariant name tokens (the two alphabetically-first tokens).
  const sortedTokens = [...norm.nameTokens].sort();
  if (sortedTokens.length >= 2) {
    keys.push({ pass: "token-pair", key: `TOK:${sortedTokens[0]}_${sortedTokens[1]}` });
  } else if (sortedTokens.length === 1) {
    keys.push({ pass: "token-pair", key: `TOK:${sortedTokens[0]}` });
  }
  // P3 — phonetic compression of the two primary tokens (record order).
  if (norm.nameTokens.length >= 1) {
    const t1 = phoneticKey(norm.nameTokens[0]);
    const t2 = norm.nameTokens.length >= 2 ? phoneticKey(norm.nameTokens[1]) : "";
    keys.push({ pass: "phonetic", key: `PHON:${t1}_${t2}` });
  }
  // P4 — initial of the first recorded token + the second token (abbreviations
  // still intersect their full forms; works when P2's pair was reordered).
  if (norm.nameTokens.length >= 2) {
    keys.push({
      pass: "initial-surname",
      key: `INIT:${norm.nameTokens[0][0]}:${norm.nameTokens[1]}`,
    });
  }
  return keys;
}

/**
 * Build the inverted index over the EXISTING entities, then resolve the
 * candidate pool for each incoming observation.
 *
 * Returns per-incoming-observation candidate id sets (the union of all
 * non-saturated pass hits) + the saturation census for the stats surface.
 */
export function buildCandidatePool(
  incoming: readonly ErNormalized[],
  existing: readonly ErNormalized[],
  saturationLimit: number = ER_BLOCKING_SATURATION_LIMIT,
): {
  readonly candidatesByObservation: ReadonlyMap<string, ReadonlySet<string>>;
  readonly candidatesBlocked: number;
  readonly saturatedKeysSkipped: number;
} {
  // The inverted index: key → existing observation ids.
  const index = new Map<string, Set<string>>();
  for (const ex of existing) {
    for (const { key } of blockingKeysFor(ex)) {
      let bucket = index.get(key);
      if (!bucket) {
        bucket = new Set<string>();
        index.set(key, bucket);
      }
      bucket.add(ex.observationId);
    }
  }
  // Saturation census: keys whose bucket exceeds the limit are skipped.
  const saturatedKeys = new Set<string>();
  for (const [key, bucket] of index) {
    if (bucket.size > saturationLimit) saturatedKeys.add(key);
  }
  const candidatesByObservation = new Map<string, ReadonlySet<string>>();
  let candidatesBlocked = 0;
  for (const inc of incoming) {
    const pool = new Set<string>();
    for (const { key } of blockingKeysFor(inc)) {
      if (saturatedKeys.has(key)) continue; // INV-44 — skipped, never fatal
      const bucket = index.get(key);
      if (!bucket) continue;
      for (const id of bucket) pool.add(id);
    }
    candidatesByObservation.set(inc.observationId, pool);
    candidatesBlocked += pool.size;
  }
  return { candidatesByObservation, candidatesBlocked, saturatedKeysSkipped: saturatedKeys.size };
}
