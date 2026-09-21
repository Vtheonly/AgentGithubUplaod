/**
 * Test-data value generators (T-399 / OPS-321) — the data source behind
 * the Ctrl+O form autofill.
 *
 * REUSE, not reimplementation (§6): the pools and the seeded Rng come from
 * the existing mock fixtures (`src/infrastructure/mock/fixtures/`) — the
 * SAME Algerian name pools the mock repository has always generated, now
 * exported additively. The identity-code formats come from the fixtures'
 * `buildCode` (PAR-2026-AB1234 / ELV-… — the deterministic identity-code
 * convention, ADR-003).
 *
 * Design rules (the owner's mandate, 2026-09-21):
 *   - realistic: real Algerian first/last names, real occupations/streets;
 *   - format-valid: phones match the app's validators (edit-parent-modal
 *     PHONE_RE `/^[+]?[0-9\s]{8,15}$/`, e-mail EMAIL_RE), dates are ISO
 *     YYYY-MM-DD, amounts are in-range DZD values;
 *   - coherent: ONE identity per Ctrl+O press — gender-consistent first
 *     names, a shared family last name, phone == WhatsApp, e-mail derived
 *     from the name;
 *   - run-unique: every press draws a fresh seed (Date.now-based), so
 *     repeated test inserts never collide with earlier probe rows.
 *
 * This module is PURE (no DOM) — it is imported both by the browser engine
 * and by the node live-e2e driver (`scripts/t-399-autofill-data-live-e2e.ts`).
 */
import { makeRng, buildCode, pad, type Rng } from "../../../infrastructure/mock/fixtures/rng";
import {
  FIRST_NAMES_FR_M,
  FIRST_NAMES_FR_F,
  LAST_NAMES,
  OCCUPATIONS,
  STREETS,
  FIXTURE_CITIES,
} from "../../../infrastructure/mock/fixtures/parent-fixtures";
import { FIRST_NAMES_M, FIRST_NAMES_F } from "../../../infrastructure/mock/fixtures/student-fixtures";

/** Male pools merged (adult + student) — realistic for parents AND students. */
export const MALE_FIRST_NAMES = [...FIRST_NAMES_FR_M, ...FIRST_NAMES_M];
/** Female pools merged (adult + student) — realistic for parents AND students. */
export const FEMALE_FIRST_NAMES = [...FIRST_NAMES_FR_F, ...FIRST_NAMES_F];

export type TestGender = "male" | "female" | "unspecified";

/** One coherent identity per autofill run — family-consistent test data. */
export interface TestIdentity {
  readonly gender: TestGender;
  /** The FAMILY last name — shared by every last-name field in the scope. */
  readonly lastName: string;
  readonly phone: string;
  readonly phoneIntl: string;
  readonly email: string;
  readonly occupation: string;
  readonly address: string;
  readonly city: string;
}

/** A per-run generator bundle: one identity + one Rng + fresh names on demand. */
export interface TestDataContext {
  readonly rng: Rng;
  readonly identity: TestIdentity;
  /** Each call returns a NEW gender-consistent first name (parent ≠ children). */
  nextFirstName(): string;
}

let pressCounter = 0;

/** Run-unique seed — two consecutive Ctrl+O presses never repeat data. */
export function nextSeed(): number {
  pressCounter += 1;
  return (Date.now() & 0x7fffffff) ^ (pressCounter * 2654435761);
}

/** Build a fresh, coherent identity bundle for one Ctrl+O press. */
export function makeTestDataContext(seed = nextSeed()): TestDataContext {
  const rng = makeRng(seed);
  const gender: TestGender = rng.pick(["male", "female"] as const);
  const lastName = rng.pick(LAST_NAMES);
  const localPhone = algerianMobileLocal(rng);
  const emailFirst = rng
    .pick(gender === "male" ? MALE_FIRST_NAMES : FEMALE_FIRST_NAMES)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const emailLocal = `${emailFirst}.${lastName.toLowerCase()}${rng.int(100, 999)}`;
  const identity: TestIdentity = {
    gender,
    lastName,
    phone: localPhone,
    phoneIntl: `+213 ${localPhone.slice(1, 3)} ${localPhone.slice(3, 5)} ${localPhone.slice(5, 7)} ${localPhone.slice(7, 9)} ${localPhone.slice(9)}`,
    email: `${emailLocal}@example.dz`,
    occupation: rng.pick(OCCUPATIONS),
    address: `${rng.int(1, 120)} ${rng.pick(STREETS)}`,
    city: rng.pick(FIXTURE_CITIES),
  };
  const used = new Set<string>();
  const nextFirstName = (): string => {
    const pool = gender === "male" ? MALE_FIRST_NAMES : FEMALE_FIRST_NAMES;
    for (let attempt = 0; attempt < pool.length; attempt += 1) {
      const name = rng.pick(pool);
      if (!used.has(name)) {
        used.add(name);
        return name;
      }
    }
    return pool[0]; // degenerate tiny pool — still a valid name
  };
  return { rng, identity, nextFirstName };
}

/* ------------------------------------------------------------------ */
/* Phones — format-driven so the value ALWAYS matches the field's own   */
/* validator/placeholder (the app's two live formats are both covered). */
/* ------------------------------------------------------------------ */

/** Local Algerian mobile, spaced form: "05X XX XX XX" (matches the
 *  edit-parent-modal placeholder "0550 12 34 56" and PHONE_RE). */
export function algerianMobileLocal(rng: Rng): string {
  const prefix = rng.pick(["055", "066", "077", "054", "065", "079"]);
  return `${prefix}${rng.int(0, 10)} ${pad(rng.int(0, 100), 2)} ${pad(rng.int(0, 100), 2)} ${pad(rng.int(0, 100), 2)}`;
}

/** International form: "+213 X XX XX XX XX" (the wizard hint format). */
export function algerianMobileIntl(rng: Rng): string {
  return `+213 ${rng.pick(["5", "6", "7"])}${rng.int(0, 10)} ${pad(rng.int(0, 100), 2)} ${pad(rng.int(0, 100), 2)} ${pad(rng.int(0, 100), 2)}`;
}

/**
 * Fill a phone-shaped TEMPLATE (the field's placeholder) digit-by-digit,
 * keeping every non-digit character and the Algerian mobile head intact:
 *   "0550 12 34 56"     -> "0661 87 23 49"   (local head kept 05/06/07)
 *   "+213 555 12 34 56" -> "+213 770 87 23 49" (country head kept)
 *   "0554288142"        -> "0661287234"      (compact form kept compact)
 * Falls back to the spaced local form when there is no template.
 */
export function phoneFromTemplate(rng: Rng, template: string | null | undefined): string {
  if (!template) return algerianMobileLocal(rng);
  const plus = template.trim().startsWith("+");
  const digitsOnly = template.replace(/\D/g, "");
  if (digitsOnly.length < 6) return algerianMobileLocal(rng);
  // The head: "+213" (country digits) or a local "05"/"06"/"07" mobile
  // head — randomized WITHIN the valid set so the number stays realistic.
  let head: string;
  let headLen: number;
  if (plus) {
    headLen = 3;
    head = `+${digitsOnly.slice(0, 3)}`;
  } else if (/^0[567]/.test(digitsOnly)) {
    head = rng.pick(["05", "06", "07"]);
    headLen = 2;
  } else {
    headLen = 2;
    head = digitsOnly.slice(0, 2);
  }
  const rest = digitsOnly.slice(headLen);
  const randomized = rest.replace(/\d/g, () => String(rng.int(0, 10)));
  let raw = `${plus ? head.slice(1) : head}${randomized}`;
  if (plus && raw.length > 3) {
    // International: the digit right after the +213 country head is the
    // mobile indicator — keep it a real one (5/6/7), never a 0-4/8-9.
    raw = `${raw.slice(0, 3)}${rng.pick(["5", "6", "7"])}${raw.slice(4)}`;
  }
  // Re-apply the template's exact spacing onto the generated digits.
  let di = 0;
  return template.replace(/\d/g, () => raw[di++] ?? "0");
}

/* ------------------------------------------------------------------ */
/* Dates — ISO YYYY-MM-DD (the <input type="date"> wire format).        */
/* ------------------------------------------------------------------ */

function isoDate(year: number, month: number, day: number): string {
  const d = new Date(Date.UTC(year, month - 1, Math.min(day, 28)));
  return d.toISOString().slice(0, 10);
}

/** School-age birth date (6–17 y.o.), clamped into [min,max] when given. */
export function birthDate(rng: Rng, min?: string | null, max?: string | null): string {
  const currentYear = new Date().getFullYear();
  const age = rng.int(6, 17);
  let candidate = isoDate(currentYear - age, rng.int(1, 13), rng.int(1, 29));
  if (min && candidate < min) candidate = min;
  if (max && candidate > max) candidate = max;
  return candidate;
}

/** Hire date: 1–15 years in the past (personnel). */
export function hireDate(rng: Rng, min?: string | null, max?: string | null): string {
  const now = new Date();
  let candidate = isoDate(now.getFullYear() - rng.int(1, 15), rng.int(1, 13), rng.int(1, 29));
  if (min && candidate < min) candidate = min;
  if (max && candidate > max) candidate = max;
  return candidate;
}

/** Generic date: -30…+90 days from today (documents, sessions, filters). */
export function nearDate(rng: Rng, min?: string | null, max?: string | null): string {
  let candidate = new Date(Date.now() + rng.int(-30, 90) * 86_400_000).toISOString().slice(0, 10);
  if (min && candidate < min) candidate = min;
  if (max && candidate > max) candidate = max;
  return candidate;
}

/** Due/deadline date: 7–120 days in the future (échéances). */
export function futureDate(rng: Rng, min?: string | null, max?: string | null): string {
  let candidate = new Date(Date.now() + rng.int(7, 120) * 86_400_000).toISOString().slice(0, 10);
  if (min && candidate < min) candidate = min;
  if (max && candidate > max) candidate = max;
  return candidate;
}

/** Time-of-day HH:MM (schedules: 07:00–18:45). */
export function timeOfDay(rng: Rng): string {
  return `${pad(rng.int(7, 18), 2)}:${rng.pick(["00", "15", "30", "45"])}`;
}

/* ------------------------------------------------------------------ */
/* Amounts — DZD-realistic, ALWAYS inside the declared [min,max]/step.  */
/* ------------------------------------------------------------------ */

/** A DZD amount inside [min,max], snapped to step (default 100 DZD). */
export function amountInRange(
  rng: Rng,
  min: number | null | undefined,
  max: number | null | undefined,
  step: number | null | undefined,
): number {
  const lo = typeof min === "number" && Number.isFinite(min) ? min : 2_000;
  const hi = typeof max === "number" && Number.isFinite(max) && max > lo ? max : Math.max(lo + 1, 45_000);
  const st = typeof step === "number" && step > 0 ? step : 100;
  const raw = lo + Math.floor(rng.next() * (hi - lo + 1));
  const snapped = Math.round(raw / st) * st;
  return Math.min(Math.max(snapped, lo), hi);
}

/** School year: 2020–current+1, clamped to [min,max]. */
export function yearInRange(rng: Rng, min?: number | null, max?: number | null): number {
  const current = new Date().getFullYear();
  const lo = typeof min === "number" && Number.isFinite(min) ? min : 2020;
  const hi = typeof max === "number" && Number.isFinite(max) && max > lo ? max : current + 1;
  return rng.int(lo, hi);
}

/* ------------------------------------------------------------------ */
/* Codes / references — the fixtures' buildCode identity formats plus   */
/* template-preserving generation for arbitrary masked references.      */
/* ------------------------------------------------------------------ */

export type CodeKind = "parent" | "student" | "activation" | "generic";

const CODE_PREFIXES: Record<CodeKind, string> = {
  parent: "PAR",
  student: "ELV",
  activation: "ACT",
  generic: "TST",
};

/** Identity code in the canonical ADR-003 format: PREFIX-YYYY-AB1234. */
export function identityCode(rng: Rng, kind: CodeKind): string {
  return buildCode(CODE_PREFIXES[kind], new Date().getFullYear(), rng);
}

/**
 * Template-preserving reference generation: replace every letter with a
 * random letter (case kept) and every digit with a random digit, keeping
 * separators — a "PAR-2026-AB1234" template yields a PAR-2026-XX9999-
 * shaped string whose FORMAT is byte-compatible with the template (cheque
 * numbers, receipt references, transaction ids, masked inputs).
 */
export function referenceFromTemplate(rng: Rng, template: string): string {
  const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  return template.replace(/[a-zA-Z0-9]/g, (ch) => {
    if (/[0-9]/.test(ch)) return String(rng.int(0, 10));
    if (ch === ch.toUpperCase()) return LETTERS[rng.int(0, LETTERS.length)];
    return LETTERS[rng.int(0, LETTERS.length)].toLowerCase();
  });
}

/* ------------------------------------------------------------------ */
/* Free text / credentials / URLs.                                      */
/* ------------------------------------------------------------------ */

/** Human sentence for notes/descriptions — dated so probe rows are traceable. */
export function noteSentence(rng: Rng): string {
  const who = rng.pick(["Dossier de test", "Cas de test", "Enregistrement de test"]);
  return `${who} — généré le ${new Date().toISOString().slice(0, 10)} (Ctrl+O).`;
}

/** Password that satisfies the common rules (length, upper, lower, digit). */
export function testPassword(rng: Rng): string {
  const LETTERS = "abcdefghjkmnpqrstuvwxyz";
  const tail = Array.from({ length: 6 }, () => LETTERS[rng.int(0, LETTERS.length)]).join("");
  return `Test-${rng.int(1000, 9999)}-${tail}`;
}

/** URL in a safe shape (the AI-config / webhook style fields). */
export function testUrl(rng: Rng): string {
  return `https://example.dz/${referenceFromTemplate(rng, "abcdef123456")}`;
}

/** Generic short text (titles, subjects): realistic + run-stamped. */
export function shortText(rng: Rng): string {
  const what = rng.pick([
    "Élément de test",
    "Épreuve de test",
    "Séance de test",
    "Dossier de test",
    "Tâche de test",
  ]);
  return `${what} ${rng.int(1, 99)}`;
}
