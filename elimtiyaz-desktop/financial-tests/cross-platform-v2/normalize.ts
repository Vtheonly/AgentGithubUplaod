/**
 * cross-platform-v2 — Result normalization.
 *
 * Canonicalizes platform outputs so that representations which are
 * semantically identical compare equal, while REAL business divergences
 * (amounts, statuses, bucket edges, validation outcomes) remain visible.
 *
 * Rules:
 *  - money: integers (centimes) — decimals are rounded half-up to centimes
 *  - null / undefined / "" → null (the v1 comparator counted these as diffs)
 *  - missing numeric keys that default to 0 → 0 (installment amountPending etc.)
 *  - timestamps/receipt sequences/uuids are NOT normalized here — adapters
 *    emit semantic keys instead of raw ids
 *  - arrays sorted by a stable semantic key
 */

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export function normalize(value: unknown): Json {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Math.round(value * 100) / 100; // canonical numeric precision
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    // Numeric strings ("50000.00") stay strings EXCEPT in known numeric
    // contexts — adapters convert explicitly. Here we keep string identity.
    return trimmed;
  }
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value
      .map(normalize)
      .filter((v) => v !== null)
      .sort((a, b) => stableCompare(a, b));
  }
  if (typeof value === "object") {
    const out: { [k: string]: Json } = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = normalize(v);
    }
    return out;
  }
  return null;
}

function stableCompare(a: Json, b: Json): number {
  return JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0;
}

/** Deep-equal after normalization. */
export function normalizedEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}
