/**
 * Seeded pseudo-random generator (mulberry32) + helpers.
 * Deterministic so the same seed → same fixtures every run.
 */

/** Mulberry32 — fast, well-distributed, deterministic PRNG. Returns [0,1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  next(): number;
  int(minInclusive: number, maxExclusive: number): number;
  pick<T>(arr: readonly T[]): T;
  maybe(probability: number): boolean;
  take<T>(arr: readonly T[], count: number): T[];
}

export function makeRng(seed: number): Rng {
  const r = mulberry32(seed);
  return {
    next: r,
    int: (min, max) => Math.floor(r() * (max - min)) + min,
    pick: (arr) => arr[Math.floor(r() * arr.length)],
    maybe: (p) => r() < p,
    take: (arr, n) => {
      const copy = [...arr];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy.slice(0, Math.min(n, copy.length));
    },
  };
}

export const pad = (n: number, width: number): string =>
  String(n).padStart(width, "0");

export const buildCode = (prefix: string, year: number, rng: Rng): string => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const a = alphabet[Math.floor(rng.next() * alphabet.length)];
  const b = alphabet[Math.floor(rng.next() * alphabet.length)];
  const digits = pad(rng.int(1000, 10000), 4);
  return `${prefix}-${year}-${a}${b}${digits}`;
};
