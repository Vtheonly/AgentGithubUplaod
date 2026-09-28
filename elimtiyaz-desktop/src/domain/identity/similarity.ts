/**
 * ER-PMAE field-level comparators — identity-rules §4.3 (T-438 / ADR-032).
 *
 * Pure string algorithms implemented in-repo (ADR-032 decision 1: no
 * external matching library — the same discipline as the timetable solver):
 *   - levenshtein + similarity
 *   - the asymmetric token-wise name coverage (INV-47)
 *   - phone-set intersection (INV-43's set semantics)
 *   - a compact phonetic key encoder (Metaphone-class, §3 pass P3)
 */
import { ER_NAME_COMPARISON } from "./types";

// ---------------------------------------------------------------------------
// Levenshtein (bounded, iterative — the classic two-row form)
// ---------------------------------------------------------------------------

/** Edit distance between two strings. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[b.length];
}

/** Normalized similarity ∈ [0,1]: 1 − distance/max(len). */
export function levenshteinSimilarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// ---------------------------------------------------------------------------
// The phonetic key encoder (identity-rules §3 pass P3)
// ---------------------------------------------------------------------------

/**
 * A compact Metaphone-class phonetic key for a single name token.
 *
 * Goal: names transliterated between Arabic/French/English orthographies
 * that SOUND identical collapse to the same key ("sediki"/"seddiki"/"ssediki"
 * → `STK`). Deliberately simple (first-letter preservation + consonant-class
 * compression + digraph folding) — documented, deterministic, no deps.
 */
export function phoneticKey(token: string): string {
  if (token.length === 0) return "";
  let s = token.toLowerCase().replace(/[^a-z]/g, "");
  if (s.length === 0) return "";
  const first = s[0];
  s = s.slice(1);
  // Fold common digraphs/trigraphs to single classes.
  s = s
    .replace(/([^c]|^)kh/g, "$1k")
    .replace(/([^c]|^)ch/g, "$1k")
    .replace(/([^c]|^)sh/g, "$1s")
    .replace(/ph/g, "f")
    .replace(/gh/g, "g")
    .replace(/th/g, "t")
    .replace(/ck/g, "k")
    .replace(/qc/g, "k")
    .replace(/([^c]|^)qu/g, "$1k")
    .replace(/([a-z])\1+/g, "$1"); // collapse doubled letters (ss→s, dd→d)
  // Vowel-class compression: keep the INITIAL vowel info only (positions
  // matter less than the consonant skeleton for name phonetics).
  const skeleton: string[] = [];
  let lastWasVowel = false;
  for (const ch of s) {
    const isVowel = "aeiouy".includes(ch);
    if (isVowel) {
      if (!lastWasVowel && skeleton.length > 0) skeleton.push("a"); // one vowel slot
      lastWasVowel = true;
    } else {
      // Voiced/unvoiced collapse: d↔t, b↔p, v↔f, z↔s, g↔k(c), m↔n kept distinct.
      const cls =
        ch === "d" ? "t" :
        ch === "b" ? "p" :
        ch === "v" ? "f" :
        ch === "z" ? "s" :
        ch === "g" ? "k" :
        ch === "c" ? "k" :
        ch === "q" ? "k" :
        ch === "x" ? "ks" :
        ch;
      skeleton.push(cls);
      lastWasVowel = false;
    }
  }
  return (first + skeleton.join("")).slice(0, 12);
}

// ---------------------------------------------------------------------------
// The asymmetric token-wise name comparator (INV-47)
// ---------------------------------------------------------------------------

/**
 * Similarity between two name TOKENS:
 *  - exact equality → 1.0
 *  - one is a single letter matching the other's initial → the initial score
 *    (0.9 — "F." vs "Fatima" is an abbreviation, not a mismatch)
 *  - otherwise 1 − levenshtein/maxLen.
 */
function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 1 && b.length > 1) return b.startsWith(a) ? ER_NAME_COMPARISON.initialMatchScore : 0;
  if (b.length === 1 && a.length > 1) return a.startsWith(b) ? ER_NAME_COMPARISON.initialMatchScore : 0;
  return levenshteinSimilarity(a, b);
}

/** Directional coverage: how thoroughly A's tokens are satisfied by B's. */
function coverage(aTokens: readonly string[], bTokens: readonly string[]): number {
  if (aTokens.length === 0) return 0;
  let sum = 0;
  for (const ta of aTokens) {
    let best = 0;
    for (const tb of bTokens) {
      const sim = tokenSimilarity(ta, tb);
      if (sim > best) best = sim;
    }
    sum += best;
  }
  return sum / aTokens.length;
}

/**
 * The order-independent asymmetric name score (identity-rules §4.3):
 * `max(cov(A→B), cov(B→A)) − 0.08·|len(A) − len(B)|`.
 *
 * A short query fully contained in a comprehensive record scores ~1.0
 * (the abbreviation asymmetry rule — INV-47); transposed first/last names
 * score identically to ordered ones (token-max matching is order-blind).
 */
export function compareNames(
  aTokens: readonly string[],
  bTokens: readonly string[],
): number {
  if (aTokens.length === 0 || bTokens.length === 0) return 0;
  const forward = coverage(aTokens, bTokens);
  const backward = coverage(bTokens, aTokens);
  const tokenCountPenalty = ER_NAME_COMPARISON.tokenCountPenalty * Math.abs(aTokens.length - bTokens.length);
  return Math.max(forward, backward) - tokenCountPenalty;
}

// ---------------------------------------------------------------------------
// Phone-set comparison (INV-43's set semantics)
// ---------------------------------------------------------------------------

export interface PhoneComparison {
  readonly intersection: readonly string[];
  readonly jaccard: number;
}

/** Phone-set intersection + Jaccard similarity (never a sole merge basis). */
export function comparePhones(a: readonly string[], b: readonly string[]): PhoneComparison {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter((p) => setB.has(p));
  const unionSize = setA.size + setB.size - intersection.length;
  const jaccard = unionSize === 0 ? 0 : intersection.length / unionSize;
  return { intersection, jaccard };
}

/** Token containment: the share of A's tokens present (fuzzily) in B. */
export function tokenContainment(aTokens: readonly string[], bTokens: readonly string[]): number {
  if (aTokens.length === 0) return 0;
  let hit = 0;
  for (const ta of aTokens) {
    if (bTokens.some((tb) => tb === ta || levenshteinSimilarity(ta, tb) >= 0.8)) hit++;
  }
  return hit / aTokens.length;
}

// ---------------------------------------------------------------------------
// Context comparison helpers (supporting evidence only — INV-48)
// ---------------------------------------------------------------------------

export function gradeRanksClose(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return false;
  return Math.abs(a - b) <= 1;
}
