/**
 * ER-PMAE normalization pipeline — identity-rules §2 (T-438 / ADR-032).
 *
 * Five pure, deterministic functions (INV-42: idempotent — normalizing an
 * already-normalized value is a no-op). This module owns NO mapping tables
 * that duplicate existing canonical mappers: grade ranking reuses the domain
 * `GRADE_LEVELS` ladder; transport normalization is a light key canonical-
 * ization (accents/case/spacing) — the import-time classe→grade mapping is
 * the CALLER's job (it already exists in the import engine's mappers).
 */
import { GRADE_LEVELS } from "../model/student";
import type { ErNormalized, ErObservation } from "./types";

// ---------------------------------------------------------------------------
// Names (identity-rules §2.1)
// ---------------------------------------------------------------------------

/**
 * Honorifics / operational-noise tokens stripped from names. Kept as a
 * documented set (identity-rules §2.1) — extending it is a rules change.
 */
const NAME_NOISE_TOKENS: ReadonlySet<string> = new Set([
  "dr", "mr", "mme", "mlle", "prof", "pr", "nv", "tuteur", "tutrice",
  "pere", "mere", "père", "mère", "par", "mois", "les", "livres", "et", "st", "ste", "m",
]);

/** NFKD decomposition + strip combining marks (é→e, ç→c). */
function stripDiacritics(input: string): string {
  return input.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Normalize one raw name into clean lowercase tokens.
 * `"SEDIKI, Ishak (NV)"` → `["sediki", "ishak"]` (identity-rules §2.1).
 * Idempotent: tokens are already clean → unchanged.
 */
export function normalizeName(raw: string | null | undefined): readonly string[] {
  if (!raw) return [];
  const lowered = stripDiacritics(raw).toLowerCase();
  // Non-alphanumeric → whitespace (keeps digits: numeric name parts are rare
  // but harmless), then tokenize and drop noise tokens.
  const tokens = lowered
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .filter((t) => !NAME_NOISE_TOKENS.has(t));
  return tokens;
}

// ---------------------------------------------------------------------------
// Phones (identity-rules §2.2 — phones are SETS of atomic contact points)
// ---------------------------------------------------------------------------

/** Delimiters that separate multiple contact numbers in one cell. */
const PHONE_DELIMITERS = /[,/;|\n]| et /gi;

/**
 * Normalize one raw phone token to the national Algerian form `0XXXXXXXXX`,
 * or null when the token is garbage.
 *
 * Handles: `+213 (0) 663...` → `0663...`, `00213...` → `0...`, spacing dots
 * and dashes. Validation: 8–14 digits survive; shorter = garbage (INV-43).
 */
function normalizePhoneToken(token: string): string | null {
  if (!token) return null;
  // Strip non-digits, keep a leading + for prefix resolution.
  let digits = token.replace(/[^\d+]/g, "");
  const hadPlus = digits.startsWith("+");
  if (hadPlus) digits = digits.slice(1);
  // International Algerian prefix: +213 / 00213 → drop it, keep national form.
  if (hadPlus && digits.startsWith("213")) {
    digits = digits.slice(3);
  } else if (!hadPlus && digits.startsWith("00213")) {
    digits = digits.slice(5);
  } else if (!hadPlus && digits.startsWith("213") && digits.length > 10) {
    // Bare 213-prefixed entry with national tail length.
    digits = digits.slice(3);
  }
  if (!/^\d+$/.test(digits)) return null;
  // National numbers start with 0; a bare 9-digit mobile tail gets its 0 back.
  if (!digits.startsWith("0") && digits.length === 9) digits = "0" + digits;
  const len = digits.length;
  if (len < 8 || len > 14) return null; // garbage / dummy lengths
  return digits;
}

/**
 * The obviously-dummy numbers that must NEVER act as matching evidence
 * (identity-rules §2.2): all-zero/sequential patterns clerks enter as
 * placeholders. The import placeholder "(inconnu)" normalizes to [].
 */
const DUMMY_PHONE_PATTERNS: ReadonlySet<string> = new Set([
  "0000000000", "000000000", "00000000", "00000000000",
  "111111111", "1111111111", "123456789", "1234567890",
]);

/**
 * Normalize a composite contact cell into the sorted, deduplicated SET of
 * valid numbers (INV-43). `"0663701834/0660800317"` → `["0660800317","0663701834"]`.
 */
export function normalizePhones(raw: readonly string[] | string | null | undefined): readonly string[] {
  const cells: string[] = [];
  if (typeof raw === "string") cells.push(raw);
  else if (Array.isArray(raw)) cells.push(...raw);
  const out = new Set<string>();
  for (const cell of cells) {
    if (!cell) continue;
    const lowered = stripDiacritics(String(cell)).toLowerCase();
    if (lowered.includes("inconnu")) continue; // the import placeholder
    for (const token of lowered.split(PHONE_DELIMITERS)) {
      const normalized = normalizePhoneToken(token);
      if (normalized === null) continue;
      if (DUMMY_PHONE_PATTERNS.has(normalized)) continue;
      out.add(normalized);
    }
  }
  return [...out].sort();
}

// ---------------------------------------------------------------------------
// Categorical context (identity-rules §2.3 — reuse the canonical ladder)
// ---------------------------------------------------------------------------

/** The canonical grade ladder index (rank); null when unknown. */
export function gradeRankOf(code: string | null | undefined): number | null {
  if (!code) return null;
  const idx = GRADE_LEVELS.indexOf(code as (typeof GRADE_LEVELS)[number]);
  return idx >= 0 ? idx : null;
}

/** Light transport-destination key: strip accents/case/spacing. */
export function normalizeTransportKey(dest: string | null | undefined): string | null {
  if (!dest) return null;
  const key = stripDiacritics(dest).toLowerCase().replace(/[^a-z0-9]/g, "");
  return key.length > 0 ? key : null;
}

/** Email normalization: trim + lowercase (no further semantics). */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const cleaned = email.trim().toLowerCase();
  return cleaned.includes("@") ? cleaned : null;
}

// ---------------------------------------------------------------------------
// The observation normalizer (identity-rules §2 — the pipeline entry)
// ---------------------------------------------------------------------------

/**
 * Normalize one observation (deterministic; INV-42).
 * The output is what blocking/comparison/scoring consume.
 */
export function normalizeObservation(obs: ErObservation): ErNormalized {
  return {
    observationId: obs.id,
    nameTokens: normalizeName(obs.displayName),
    phones: normalizePhones(obs.phones),
    email: normalizeEmail(obs.email),
    gradeRank: gradeRankOf(obs.gradeLevelCode),
    transportKey: normalizeTransportKey(obs.transportDestination),
    gender: obs.gender ?? null,
    academicYear: obs.academicYear ?? null,
  };
}

/** Normalize a batch (preserving order). */
export function normalizeAll(observations: readonly ErObservation[]): readonly ErNormalized[] {
  return observations.map(normalizeObservation);
}

// ---------------------------------------------------------------------------
// The invariant observation hash (identity-rules §8.1 — INV-55)
// ---------------------------------------------------------------------------

/**
 * The stable hash over (sourceSystem, sourceRecordId, normalized payload).
 *
 * Deterministic, dependency-free (FNV-1a over the canonical JSON form —
 * object keys sorted). Re-analyzing an unchanged observation hits the same
 * hash and short-circuits. NOT cryptographic — collision safety is not the
 * concern (the hash gates redundant work, it does not authorize merges).
 */
export function observationHash(norm: ErNormalized, sourceSystem: string, sourceRecordId: string): string {
  const payload = JSON.stringify(
    {
      sourceSystem,
      sourceRecordId,
      nameTokens: norm.nameTokens,
      phones: norm.phones,
      email: norm.email,
      gradeRank: norm.gradeRank,
      transportKey: norm.transportKey,
      gender: norm.gender,
      academicYear: norm.academicYear,
    },
    null,
    0,
  );
  // FNV-1a 32-bit ×4 rounds over 4 offsets → a stable 32-hex digest.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  let h3 = 0xdeadbeef;
  let h4 = 0x41c6ce57;
  for (let i = 0; i < payload.length; i++) {
    const c = payload.charCodeAt(i);
    h1 = (h1 ^ c) * 0x01000193;
    h2 = (h2 + c) | 0;
    h3 = (h3 ^ (c + i)) * 0x85ebca6b;
    h4 = (h4 + Math.imul(c, i + 1)) | 0;
    h1 >>>= 0; h2 |= 0; h3 >>>= 0; h4 |= 0;
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return `${hex(h1)}${hex(h2)}${hex(h3)}${hex(h4)}`;
}
