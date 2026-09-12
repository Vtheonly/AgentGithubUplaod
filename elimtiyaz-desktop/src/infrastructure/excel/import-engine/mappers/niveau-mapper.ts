/**
 * niveau-code mapper — translates the loose `niveau` codes found in the
 * real `Suivis clients AAAA_AAAA.xlsx` ETAT sheet into the canonical
 * `GradeLevel` enum used by the rest of the application.
 *
 * Source of truth for the codes: `docs/Clients_Sheet_Merged.txt` →
 * "01 - Level Codes (niveau)". Unknown codes fall back to a sensible
 * default rather than rejecting the row, per the "import student no
 * matter what" requirement.
 */
import type { AcademicLevel, GradeLevel } from "../../../../domain/model/student";

export interface NiveauMapping {
  readonly gradeLevel: GradeLevel;
  readonly academicLevel: AcademicLevel;
  readonly gradeYear: number;
}

/** Canonical map — every code documented in `Clients_Sheet_Merged.txt`. */
const NIVEAU_MAP: Record<string, NiveauMapping> = {
  // Broad school levels → best-effort placement into year 1 of each level.
  PRIM: { gradeLevel: "1ap", academicLevel: "primaire", gradeYear: 1 },
  COLG: { gradeLevel: "1am", academicLevel: "cem", gradeYear: 1 },
  LYC: { gradeLevel: "1ere_annee", academicLevel: "lycee", gradeYear: 1 },
  CLYC: { gradeLevel: "1ere_annee", academicLevel: "lycee", gradeYear: 1 },
  LYCI: { gradeLevel: "1ere_annee", academicLevel: "lycee", gradeYear: 1 },

  // Pre-school sections.
  GS: { gradeLevel: "prescolaire_2", academicLevel: "primaire", gradeYear: 0 },
  MS: { gradeLevel: "prescolaire_2", academicLevel: "primaire", gradeYear: 0 },
  PS: { gradeLevel: "prescolaire_1", academicLevel: "primaire", gradeYear: 0 },
  TPS: { gradeLevel: "prescolaire_1", academicLevel: "primaire", gradeYear: 0 },

  // Special-needs class — placed in prescolaire_2 as a neutral slot.
  AUTISTE: { gradeLevel: "prescolaire_2", academicLevel: "primaire", gradeYear: 0 },

  // Non-gradeable variants — placed in year 1 of corresponding level.
  NV2: { gradeLevel: "1ap", academicLevel: "primaire", gradeYear: 1 },
  NV3: { gradeLevel: "1am", academicLevel: "cem", gradeYear: 1 },
  NV4: { gradeLevel: "1ere_annee", academicLevel: "lycee", gradeYear: 1 },
  NV5: { gradeLevel: "1ere_annee", academicLevel: "lycee", gradeYear: 1 },
};

/** Default fallback when the code is unrecognized — preserves "import no matter what". */
export const DEFAULT_NIVEAU_MAPPING: NiveauMapping = {
  gradeLevel: "1ap",
  academicLevel: "primaire",
  gradeYear: 1,
};

/**
 * CALC-001 — EXACT per-grade resolution from the CLASSE column (H).
 *
 * The ETAT sheet carries the BROAD level in `niveau` (G: PRIM / COLG / LYC)
 * but the EXACT class in `classe` (H: CP, CE1…CM2, 1AAM…4AAM, 1ER…3EM).
 * Pricing per grade (FI + scolarité + tranches) requires the exact class:
 * mapping PRIM→1ap would price every primary student at the CP rate and
 * dump the difference onto the last tranche via the T-105 reconciliation.
 *
 * These codes are the ones observed across ALL 390 rows of the real
 * workbook (plus the 1AS/2AS/3AS, 1CS…4CS, 1EM variants and the PS/TPS
 * preschool sections from the REF reference sheet).
 */
const CLASSE_CODE_MAP: Record<string, NiveauMapping> = {
  // Préscolaire
  MS: { gradeLevel: "prescolaire_1", academicLevel: "primaire", gradeYear: 0 },
  PS: { gradeLevel: "prescolaire_1", academicLevel: "primaire", gradeYear: 0 },
  TPS: { gradeLevel: "prescolaire_1", academicLevel: "primaire", gradeYear: 0 },
  GS: { gradeLevel: "prescolaire_2", academicLevel: "primaire", gradeYear: 0 },
  // Primaire — exact grade per class code
  CP: { gradeLevel: "1ap", academicLevel: "primaire", gradeYear: 1 },
  "1AP": { gradeLevel: "1ap", academicLevel: "primaire", gradeYear: 1 },
  CE1: { gradeLevel: "2ap", academicLevel: "primaire", gradeYear: 2 },
  "2AP": { gradeLevel: "2ap", academicLevel: "primaire", gradeYear: 2 },
  CE2: { gradeLevel: "3ap", academicLevel: "primaire", gradeYear: 3 },
  "3AP": { gradeLevel: "3ap", academicLevel: "primaire", gradeYear: 3 },
  CM1: { gradeLevel: "4ap", academicLevel: "primaire", gradeYear: 4 },
  "4AP": { gradeLevel: "4ap", academicLevel: "primaire", gradeYear: 4 },
  CM2: { gradeLevel: "5ap", academicLevel: "primaire", gradeYear: 5 },
  "5AP": { gradeLevel: "5ap", academicLevel: "primaire", gradeYear: 5 },
  // CEM
  "1AAM": { gradeLevel: "1am", academicLevel: "cem", gradeYear: 1 },
  "1AM": { gradeLevel: "1am", academicLevel: "cem", gradeYear: 1 },
  "2AAM": { gradeLevel: "2am", academicLevel: "cem", gradeYear: 2 },
  "2AM": { gradeLevel: "2am", academicLevel: "cem", gradeYear: 2 },
  "3AAM": { gradeLevel: "3am", academicLevel: "cem", gradeYear: 3 },
  "3AM": { gradeLevel: "3am", academicLevel: "cem", gradeYear: 3 },
  "4AAM": { gradeLevel: "4am", academicLevel: "cem", gradeYear: 4 },
  "4AM": { gradeLevel: "4am", academicLevel: "cem", gradeYear: 4 },
  // Lycée
  "1ER": { gradeLevel: "1ere_annee", academicLevel: "lycee", gradeYear: 1 },
  "1AS": { gradeLevel: "1ere_annee", academicLevel: "lycee", gradeYear: 1 },
  "1EM": { gradeLevel: "1ere_annee", academicLevel: "lycee", gradeYear: 1 },
  "1CS": { gradeLevel: "1ere_annee", academicLevel: "lycee", gradeYear: 1 },
  "2EM": { gradeLevel: "2eme_annee", academicLevel: "lycee", gradeYear: 2 },
  "2AS": { gradeLevel: "2eme_annee", academicLevel: "lycee", gradeYear: 2 },
  "2CS": { gradeLevel: "2eme_annee", academicLevel: "lycee", gradeYear: 2 },
  "3EM": { gradeLevel: "3eme_annee", academicLevel: "lycee", gradeYear: 3 },
  "3AS": { gradeLevel: "3eme_annee", academicLevel: "lycee", gradeYear: 3 },
  "3CS": { gradeLevel: "3eme_annee", academicLevel: "lycee", gradeYear: 3 },
  // Special-needs integration track — neutral slot (pricing uses the
  // dedicated AUTISTE schedule, not the prescolaire one).
  AUTISTE: { gradeLevel: "prescolaire_2", academicLevel: "primaire", gradeYear: 0 },
};

/**
 * Resolve the EXACT grade from the CLASSE column, falling back to the broad
 * NIVEAU mapping when the class code is unknown (e.g. NV3/NV4 special
 * tracks, or the "Non assignée" default).
 */
export function resolveGradeFromClasse(classe: unknown, niveau: unknown): NiveauMapping {
  const code = String(classe ?? "").trim().toUpperCase();
  if (code && code !== "NON ASSIGNEE" && CLASSE_CODE_MAP[code]) {
    return CLASSE_CODE_MAP[code];
  }
  return mapNiveauCode(niveau);
}

/** True when the row is on the AUTISTE integration track. */
export function isAutisteTrack(classe: unknown, option: unknown): boolean {
  const c = String(classe ?? "").trim().toUpperCase();
  const o = String(option ?? "").trim().toUpperCase();
  return c === "AUTISTE" || o === "AUTISTE";
}

/**
 * Map a raw `niveau` code to a canonical `GradeLevel` + `AcademicLevel` +
 * `gradeYear` triple. The input is normalized (trimmed, uppercased) before
 * lookup. Unknown codes return `DEFAULT_NIVEAU_MAPPING` rather than throwing.
 */
export function mapNiveauCode(rawCode: unknown): NiveauMapping {
  if (rawCode === null || rawCode === undefined) return DEFAULT_NIVEAU_MAPPING;
  const code = String(rawCode).trim().toUpperCase();
  if (!code) return DEFAULT_NIVEAU_MAPPING;
  return NIVEAU_MAP[code] ?? DEFAULT_NIVEAU_MAPPING;
}

/** Returns true when the code is in the canonical map (used for warnings). */
export function isKnownNiveauCode(rawCode: unknown): boolean {
  if (rawCode === null || rawCode === undefined) return false;
  const code = String(rawCode).trim().toUpperCase();
  return code in NIVEAU_MAP;
}

/** Enumerate all recognized codes — used by tests + schema documentation. */
export function listKnownNiveauCodes(): readonly string[] {
  return Object.freeze(Object.keys(NIVEAU_MAP));
}
