/**
 * ETAT identity & payment-spec sharing — T-638 / FIN-115 (ADR-038).
 *
 * The commit-time adapter (`storage/repository-adapter.ts`) and the
 * dry-run CONFLICT PREVIEW (`payment-conflict-preview.ts`) must derive the
 * SAME parent identity, the SAME student identity and the SAME payment
 * projections from the SAME coerced ETAT record — otherwise the preview
 * would lie about what the commit will do. This module is the ONE home of
 * those derivations: the adapter DELEGATES here (behavior byte-identical),
 * and the preview consumes the same functions.
 *
 * Everything here is PURE: a coerced `ImportRecord` in, plain projections
 * out. No repository, no clock, no mutation.
 */
import type { ImportRecord } from "./types";
import type { CreateParentInput, Parent, TransportDestination } from "../../../domain/model/parent";
import {
  IMPORTED_BIRTH_DATE_PLACEHOLDER,
  type CreateStudentInput,
  type Student,
} from "../../../domain/model/student";
import type { PaymentCategory } from "../../../domain/model/payment";
import { splitFullName } from "./mappers/name-splitter";
import { resolveGradeFromClasse, isAutisteTrack } from "./mappers/niveau-mapper";
import { mapExcelDestinationToCanonical } from "./mappers/destination-mapper";
// T-435 (UI-317): the canonical due-date triple — ONE implementation
// shared with the adapter (no parallel schedule derivation that could
// silently drift).
import { getOfficialTuitionDueDates } from "../../../domain/calc/pricing";
import {
  REAL_TRANSPORT_MATRIX,
  REAL_TUITION_BY_GRADE,
  REAL_FI_BY_GRADE,
  REAL_TUITION_AUTISTE,
  REAL_FI_AUTISTE,
} from "../../../domain/calc/pricing/school-price-matrix";

/* ================================================================== */
/*  Numeric coercion (the shared numOrZero — one implementation)       */
/* ================================================================== */

export function numOrZero(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v.trim().replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/* ================================================================== */
/*  Parent identity (verbatim from the adapter's buildParentInput)     */
/* ================================================================== */

export function extractEtatPhone(record: ImportRecord): string {
  const raw = record.nem;
  if (Array.isArray(raw)) return String(raw[0] ?? "");
  if (typeof raw === "string") {
    const first = raw.split(/[/,;]/)[0]?.trim();
    return first ?? "";
  }
  return "";
}

export function buildEtatParentInput(record: ImportRecord): CreateParentInput {
  const phone = extractEtatPhone(record);
  const tuteurRaw = (record.tuteur as string | undefined)?.trim();
  const email = (record.email as string | undefined)?.trim() || null;

  // Per `Clients_Sheet_Merged.md` → "03 - ETAT Columns / 01 - Identity (B-K)",
  // the TUTEUR column is *usually just the family name* (e.g. `ABDELAOUI`).
  // In the REAL workbook 325 of 390 rows have an EMPTY TUTEUR cell and the
  // 65 non-empty values are all "NV" (a status flag, not a name).
  //
  // The rules (migration 0027's display-name fix, preserved verbatim):
  //   1. TUTEUR name-like → the COMPLETE parent name ("Famille X (Y)").
  //   2. Otherwise → the family name from the student's NOM (LASTNAME
  //      FIRSTNAME order): "Famille {lastName}".
  //   3. NEVER "Tuteur" as a placeholder.
  //   4. The parent displayName is NEVER the student's full name.
  //   5. A real phone is appended for same-name disambiguation.

  let lastName = "Inconnu";
  let firstName = "";
  let displayName: string | null = null;

  const isNameLikeTuteur =
    !!tuteurRaw &&
    !/^(nv|n\/?a|none|-|\?)$/i.test(tuteurRaw) &&
    // A single token with no digits and length >= 2 is treated as a name.
    // Anything else (numbers, "NV", short codes) is treated as missing.
    /^[a-zA-ZÀ-ÿ\u0600-\u06FF][a-zA-ZÀ-ÿ\u0600-\u06FF\s'-]{1,}$/.test(tuteurRaw);

  if (isNameLikeTuteur) {
    // TUTEUR is a real name — use it as the parent's name.
    const tuteurParts = splitFullName(tuteurRaw);
    lastName = tuteurParts.lastName || "Inconnu";
    firstName = tuteurParts.firstName || "";
    // Parent display = "Famille {lastName}" to distinguish from students.
    displayName = firstName
      ? `Famille ${lastName} (${firstName})`
      : `Famille ${lastName}`;
  } else if (record.nom) {
    // Derive parent family name from student NOM (LASTNAME FIRSTNAME order).
    const nomParts = splitFullName(record.nom);
    if (nomParts.lastName) {
      lastName = nomParts.lastName;
    }
    firstName = "";
    // PARENT-AS-STUDENT FIX: parent displayName = "Famille {lastName}",
    // NOT the student's full name.
    displayName = `Famille ${lastName}`;
  }

  // If we have a phone number, append it to the displayName for extra
  // disambiguation when multiple families share the same last name.
  if (phone && phone !== "(inconnu)" && displayName) {
    displayName = `${displayName} — ${phone}`;
  }

  return {
    firstName,
    lastName,
    displayName,
    gender: "unspecified",
    phone: phone || "(inconnu)",
    email,
    preferredLanguage: "fr",
  };
}

/* ================================================================== */
/*  Student identity (verbatim from the adapter's buildStudentInput)   */
/* ================================================================== */

export function buildEtatStudentInput(record: ImportRecord): CreateStudentInput {
  const nameParts = splitFullName(record.nom);
  // CALC-001: resolve the EXACT grade from the CLASSE column (H) first —
  // the broad NIVEAU code (G: PRIM/COLG/LYC) would store every primary
  // student as 1ap and price them at the CP rate.
  const mapping = resolveGradeFromClasse(record.classe, record.niveau);
  // Store the DISTINATION town name as transportTier when present; fall
  // back to the OPTION code when the town is empty but OPTION indicates
  // transport.
  const distination = (record.distination as string | undefined)?.trim() || null;
  const optionCode = (record.option as string | undefined)?.trim() || null;
  // Preserve the FULL student NOM (e.g. "BENALI Mohamed") as the display
  // name so the UI shows the complete name verbatim.
  const nomRaw = (record.nom as string | undefined)?.trim() || null;
  return {
    firstName: nameParts.firstName,
    lastName: nameParts.lastName || "Inconnu",
    displayName: nomRaw,
    gender: "unspecified",
    // DATA-018: the shared pinned placeholder (see student.ts) — never a
    // literal again; the demographics layer routes it to "Non renseigné".
    birthDate: IMPORTED_BIRTH_DATE_PLACEHOLDER,
    level: mapping.academicLevel,
    gradeYear: mapping.gradeYear,
    gradeLevel: mapping.gradeLevel,
    classId: null,
    medicalNotes: null,
    transportTier: distination ?? optionCode,
  };
}

/* ================================================================== */
/*  Student-in-family match (verbatim from findStudentInFamily)        */
/* ================================================================== */

/**
 * The IMPORT-109 EXACT match: displayName first, then firstName+lastName,
 * scoped to the parent's own students. Returns null when the family has
 * no such student (the row will CREATE one).
 */
export function findEtatStudentInFamily(
  studentsOfParent: readonly Student[],
  input: CreateStudentInput,
): Student | null {
  const byDisplayName = studentsOfParent.find(
    (s) =>
      input.displayName != null &&
      s.displayName === input.displayName,
  );
  if (byDisplayName) return byDisplayName;
  return (
    studentsOfParent.find(
      (s) => s.firstName === input.firstName && s.lastName === input.lastName,
    ) ?? null
  );
}

/* ================================================================== */
/*  The ETAT payment-spec table (verbatim from buildPaymentRows)        */
/* ================================================================== */

/** The per-row expected schedule pieces the spec table needs. */
export interface EtatPaymentSpecContext {
  /** The expected registration fee for the row's grade. */
  readonly fiExpected: number;
  /** The expected tuition tranches [V2, 2V, v3] — remise ALREADY applied to [0]. */
  readonly expectedTuitionTranches: readonly [number, number, number];
  /** The expected transport tranches [T1, T2, T3]. */
  readonly expectedTransportTranches: readonly [number, number, number];
  /** The canonical transport destination label. */
  readonly destination: string;
}

export interface EtatPaymentSpec {
  /** The workbook column identity (FI, V2, T1, PSY3, …). */
  readonly field: string;
  readonly amount: number;
  readonly category: PaymentCategory;
  readonly description: string;
  /** The expected amount for this tranche (0 = no price basis). */
  readonly expectedAmount: number;
  /**
   * The RECORDED-PERIOD anchor index (T-502/DATA-062): 0 = September,
   * 1 = December, 2 = March, null = no recorded period (the import
   * timestamps the payment at the run clock).
   */
  readonly period: 0 | 1 | 2 | null;
}

/**
 * The ONE payment-spec table for an ETAT row — every workbook column that
 * becomes a payment, with its category, description, expected amount and
 * recorded-period anchor. The commit path (buildPaymentRows) and the
 * conflict preview BOTH consume this table, so the preview projects
 * exactly what the commit would write.
 */
export function buildEtatPaymentSpecs(
  record: ImportRecord,
  ctx: EtatPaymentSpecContext,
): EtatPaymentSpec[] {
  type SpecTuple = [string, number, PaymentCategory, string, number, 0 | 1 | 2 | null];
  const specs: SpecTuple[] = [
    ["REGLEMENTS_DETTES", numOrZero(record.reglementsDettes), "tuition", "Règlement dettes antérieures", 0, null],
    ["FI", numOrZero(record.fi), "tuition", "Frais d'inscription (FI)", ctx.fiExpected, 0],
    ["V2", numOrZero(record.v2), "tuition", "Tranche 1 — Scolarité (V1)", ctx.expectedTuitionTranches[0], 0],
    ["V2_ALT", numOrZero(record.v2Alt), "tuition", "Tranche 2 — Scolarité (2V)", ctx.expectedTuitionTranches[1], 1],
    ["V3", numOrZero(record.v3), "tuition", "Tranche 3 — Scolarité (v3)", ctx.expectedTuitionTranches[2], 2],
    ["T1", numOrZero(record.t1), "transport", `Tranche 1 transport (1T) — ${ctx.destination}`, ctx.expectedTransportTranches[0], 0],
    ["T2", numOrZero(record.t2), "transport", `Tranche 2 transport (T2) — ${ctx.destination}`, ctx.expectedTransportTranches[1], 1],
    ["T3", numOrZero(record.t3), "transport", `Tranche 3 transport (t3) — ${ctx.destination}`, ctx.expectedTransportTranches[2], 2],
    ["PSY1", numOrZero(record.psy1), "therapy_psychology", "Séance psychologie 1 (PSY1)", 10_000, null],
    ["PSY2", numOrZero(record.psy2), "therapy_psychology", "Séance psychologie 2 (PSY2)", 10_000, null],
    ["ORTH1", numOrZero(record.orth1), "therapy_speech", "Séance orthophonie 1 (ORTH1)", 10_000, null],
    ["ORTH2", numOrZero(record.orth2), "therapy_speech", "Séance orthophonie 2 (ORTH2)", 10_000, null],
    ["EPLANT", numOrZero(record.eplant), "other", "E-PLANT (plan d'accompagnement)", 0, null],
    ["RATRAPAGE", numOrZero(record.ratrapage), "tuition", "Rattrapage", 0, null],
    ["SEPTEMBRE", numOrZero(record.septembre), "tuition", "Tranche septembre — Tranche 1", ctx.expectedTuitionTranches[0], 0],
    ["DECEMBRE", numOrZero(record.decembre), "tuition", "Tranche décembre — Tranche 2", ctx.expectedTuitionTranches[1], 1],
    ["MARS", numOrZero(record.mars), "tuition", "Tranche mars — Tranche 3", ctx.expectedTuitionTranches[2], 2],
    // ── The 2027-2026 format's expanded therapy grid (PSY3…PSY14). ──
    ...Array.from({ length: 12 }, (_, i) => {
      const n = i + 3;
      return [
        `PSY${n}`,
        numOrZero(record[`psy${n}`]),
        "therapy_psychology",
        `Séance psychologie ${n} (PSY${n})`,
        10_000,
        null,
      ] as SpecTuple;
    }),
    ["COURS_SUP", numOrZero(record.coursSup), "tuition", "COURS SUP (cours de soutien)", 0, null],
    ["LIVRES", numOrZero(record.livres), "books", "Livres scolaires", 0, null],
    ["CLUB", numOrZero(record.club), "extracurricular", "Club (activité extrascolaire)", 0, null],
    ["SORTIES", numOrZero(record.sorties), "extracurricular", "Sortie scolaire", 0, null],
  ];
  return specs.map(([field, amount, category, description, expectedAmount, period]) => ({
    field,
    amount,
    category,
    description,
    expectedAmount,
    period,
  }));
}

/* ================================================================== */
/*  The real pricing schedule + recorded-period anchors (shared)       */
/* ================================================================== */

/**
 * CALC-001 REAL PRICING for one ETAT row — verbatim from the adapter's
 * realScheduleFor: the exact grade from the CLASSE column (the broad
 * NIVEAU code would price every primary student at the CP rate), the
 * autisme track, and the transport matrix by canonical destination.
 */
export function etatRealScheduleFor(record: ImportRecord): {
  fi: number;
  tuitionTranches: [number, number, number]; // [V2, 2V, v3] stickers
  transport: readonly [number, number, number, number];
  destination: TransportDestination;
} {
  const mapping = resolveGradeFromClasse(record.classe, record.niveau);
  const gradeLevel = mapping.gradeLevel;
  const isAutiste = isAutisteTrack(record.classe, record.option);
  const schedule = isAutiste ? REAL_TUITION_AUTISTE : REAL_TUITION_BY_GRADE[gradeLevel];
  const fi = isAutiste ? REAL_FI_AUTISTE : REAL_FI_BY_GRADE[gradeLevel];
  const tuitionTranches: [number, number, number] = schedule
    ? [schedule.v2, schedule.tranche3, schedule.tranche4]
    : [0, 0, 0];
  const destination = mapExcelDestinationToCanonical(record.distination);
  const transport = REAL_TRANSPORT_MATRIX[destination] ?? [0, 0, 0, 0];
  return { fi, tuitionTranches, transport, destination };
}

/**
 * T-502 (DATA-062): the academic year's CANONICAL period anchors — the
 * OFFICIAL tranche schedule (getOfficialTuitionDueDates: Sept 15 /
 * Dec 15 / Mar 15 of the following year), sliced to the bare yyyy-MM-dd
 * form the pipeline stores. ONE derivation shared by the installment due
 * dates, the payment collectedAt attribution AND the dry-run conflict
 * preview. The clock is INJECTED for purity (the adapter passes nothing —
 * the real wall clock; tests pass a fixed date).
 */
export function etatAcademicPeriodAnchors(now: Date = new Date()): readonly [string, string, string] {
  const academicYearStart = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  const [t1, t2, t3] = getOfficialTuitionDueDates(academicYearStart);
  return [t1.slice(0, 10), t2.slice(0, 10), t3.slice(0, 10)];
}

/* ================================================================== */
/*  Preview-time family resolution (mirrors the commit ladder)          */
/* ================================================================== */

/**
 * Resolve a workbook row's family against the CURRENT parents snapshot —
 * the SAME match ladder the commit-time BatchParentIndex walks:
 *   1. exact phone (when the input phone is real);
 *   2. exact email;
 *   3. placeholder stages — (firstName, lastName) under "(inconnu)",
 *      then exact displayName, then the legacy "Tuteur" firstName form.
 * Returns null when the row would CREATE a new family.
 */
export function resolveEtatParentSnapshot(
  input: CreateParentInput,
  parents: readonly Parent[],
): Parent | null {
  if (input.phone && input.phone !== "(inconnu)") {
    const hit = parents.find((p) => p.phone === input.phone);
    if (hit) return hit;
  }
  if (input.email) {
    const hit = parents.find((p) => p.email === input.email);
    if (hit) return hit;
  }
  const byName = parents.find(
    (p) =>
      p.phone === "(inconnu)" &&
      p.firstName === input.firstName &&
      p.lastName === input.lastName,
  );
  if (byName) return byName;
  const byDisplayName = parents.find(
    (p) =>
      p.phone === "(inconnu)" &&
      input.displayName !== null &&
      p.displayName === input.displayName,
  );
  if (byDisplayName) return byDisplayName;
  const byLegacyTuteur = parents.find(
    (p) =>
      p.phone === "(inconnu)" &&
      p.firstName === "Tuteur" &&
      p.lastName === input.lastName,
  );
  if (byLegacyTuteur) return byLegacyTuteur;
  return null;
}
