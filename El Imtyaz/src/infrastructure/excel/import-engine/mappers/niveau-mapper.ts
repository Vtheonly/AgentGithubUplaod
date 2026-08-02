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
