/**
 * PII masking — plan §11.03.
 *
 * Pure functions that redact personally-identifiable information from a string
 * BEFORE sending it to the LLM adapter. The mask is reversible: each
 * placeholder maps back to its original via the `replacements` Map so the
 * caller can unmask the LLM response.
 *
 * Patterns recognized (Algerian context):
 *   - Phone: `+213 555 123 456`, `0555 123 456`, `213-555-123-456`
 *   - Email: `john@doe.com`
 *   - IBAN: `DZ` + 22 digits
 *   - National ID (NN): 10 consecutive digits
 *   - Parent names (from options.parentNames[])
 *   - Student names (from options.studentNames[])
 *
 * Each UNIQUE occurrence gets its own placeholder:
 *   - `[PHONE_1]`, `[PHONE_2]`, ...
 *   - `[EMAIL_1]`, `[EMAIL_2]`, ...
 *   - `[IBAN_1]`, ...
 *   - `[NN_1]`, ...
 *   - `[PARENT_1]`, ...
 *   - `[STUDENT_1]`, ...
 *
 * If the SAME value appears twice, the same placeholder is reused.
 *
 * The masking order matters: longer / more specific patterns must run BEFORE
 * shorter / more generic ones. Specifically, the 10-digit NN regex would
 * otherwise consume the digit-runs inside an IBAN or phone number. We
 * therefore mask IBAN → phone → email → NN → names.
 */
import type { PIIMaskResult } from "../model/ai";

export interface MaskPIIOptions {
  /** Parent names to redact. Each unique name → `[PARENT_N]`. */
  readonly parentNames?: readonly string[];
  /** Student names to redact. Each unique name → `[STUDENT_N]`. */
  readonly studentNames?: readonly string[];
}

/* ------------------------------------------------------------------ */
/*  Regex patterns                                                     */
/* ------------------------------------------------------------------ */

// Algerian phone numbers: +213 / 0 / 213 prefix, then 9 digits (with optional
// spaces / dashes / dots between groups). Captures the whole phone string.
// Matches:
//   +213 555 123 456
//   0555 123 456
//   213-555-123-456
//   0555123456
const PHONE_REGEX =
  /(?:(?:\+|00)?213|0)[\s\-.]?(?:[5-7][\s\-.]?\d{2}[\s\-.]?\d{3}[\s\-.]?\d{2,3}|[5-7]\d{8})/g;

// Standard email regex.
const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

// Algerian IBAN: DZ + 22 digits (24 chars total). With optional spaces every 4 chars.
// Format: DZ + 2 check digits + 5 groups of 4 digits = DZ + 22 digits.
const IBAN_REGEX = /DZ\d{2}(?:\s?\d{4}){5}/g;

// Algerian Numéro National (NN): exactly 10 consecutive digits, NOT preceded
// or followed by another digit (so it doesn't grab parts of longer numbers).
// We use lookarounds to enforce the boundary.
const NN_REGEX = /(?<!\d)\d{10}(?!\d)/g;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Apply a regex-based masker. For each match, look it up in `seen`:
 *   - if already seen, reuse its placeholder
 *   - if new, allocate the next placeholder index for this prefix
 *
 * Returns the masked string + a merged replacements Map.
 */
function applyMasker(
  text: string,
  regex: RegExp,
  placeholderPrefix: string,
  seen: Map<string, string>,
  replacements: Map<string, string>,
): string {
  return text.replace(regex, (match) => {
    const trimmed = match.trim();
    const existing = seen.get(trimmed);
    if (existing) return existing;
    const idx = seen.size + 1;
    const placeholder = `[${placeholderPrefix}_${idx}]`;
    seen.set(trimmed, placeholder);
    replacements.set(placeholder, trimmed);
    return placeholder;
  });
}

/**
 * Mask a list of proper names (parent / student). Case-sensitive, full-word
 * match. Names are sorted longest-first so that "Mohamed Ali" is masked
 * before "Mohamed" (avoiding partial overlaps).
 */
function applyNameMasker(
  text: string,
  names: readonly string[],
  placeholderPrefix: string,
  seen: Map<string, string>,
  replacements: Map<string, string>,
): string {
  const validNames = names
    .map((n) => n.trim())
    .filter((n) => n.length >= 2);
  if (validNames.length === 0) return text;
  // Sort longest-first so substrings don't get matched first.
  const sorted = [...new Set(validNames)].sort((a, b) => b.length - a.length);
  let result = text;
  for (const name of sorted) {
    // Escape regex metacharacters in the name.
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Whole-word, case-sensitive match.
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "gu");
    result = result.replace(re, () => {
      const existing = seen.get(name);
      if (existing) return existing;
      const idx = seen.size + 1;
      const placeholder = `[${placeholderPrefix}_${idx}]`;
      seen.set(name, placeholder);
      replacements.set(placeholder, name);
      return placeholder;
    });
  }
  return result;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Mask PII in `text`. Returns `{ masked, replacements }` where:
 *   - `masked` is the sanitized text (safe to send to the LLM)
 *   - `replacements` is a placeholder → original map for unmasking
 *
 * Edge cases:
 *   - empty string → `{ masked: "", replacements: new Map() }`
 *   - no PII found → `{ masked: text, replacements: new Map() }`
 *   - same value twice → same placeholder both times
 */
export function maskPII(text: string, options: MaskPIIOptions = {}): PIIMaskResult {
  if (!text) return { masked: text, replacements: new Map() };

  const replacements = new Map<string, string>();
  const phoneSeen = new Map<string, string>();
  const emailSeen = new Map<string, string>();
  const ibanSeen = new Map<string, string>();
  const nnSeen = new Map<string, string>();
  const parentSeen = new Map<string, string>();
  const studentSeen = new Map<string, string>();

  // Order matters: IBAN first (longest digit run), then phone (may contain
  // digits but not 10 contiguous), then email (no digits to confuse), then
  // NN (10 contiguous digits — would otherwise grab parts of an IBAN).
  let masked = text;
  masked = applyMasker(masked, IBAN_REGEX, "IBAN", ibanSeen, replacements);
  masked = applyMasker(masked, PHONE_REGEX, "PHONE", phoneSeen, replacements);
  masked = applyMasker(masked, EMAIL_REGEX, "EMAIL", emailSeen, replacements);
  masked = applyMasker(masked, NN_REGEX, "NN", nnSeen, replacements);
  masked = applyNameMasker(
    masked,
    options.parentNames ?? [],
    "PARENT",
    parentSeen,
    replacements,
  );
  masked = applyNameMasker(
    masked,
    options.studentNames ?? [],
    "STUDENT",
    studentSeen,
    replacements,
  );

  return { masked, replacements };
}

/**
 * Restore the original PII by replacing every placeholder in `masked` with
 * its original value from `replacements`.
 *
 * If a placeholder has no entry in the map (e.g. corrupted or stale), it is
 * left untouched.
 */
export function unmaskPII(masked: string, replacements: ReadonlyMap<string, string>): string {
  if (!masked) return masked;
  let result = masked;
  for (const [placeholder, original] of replacements) {
    // Use split+join for safe literal replacement (placeholders may contain
    // regex metacharacters like `[` and `]`).
    result = result.split(placeholder).join(original);
  }
  return result;
}
