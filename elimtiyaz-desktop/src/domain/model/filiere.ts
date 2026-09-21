/**
 * The canonical academic classification: Niveau → Filière → Spécialité →
 * Classe/Section (T-401 / ADR-019).
 *
 * SOURCE OF TRUTH: the `filieres` database catalog (migration 0107) — a
 * tenant-scoped DATA table the school can extend. THIS FILE is its desktop
 * mirror (the same mirroring convention as `GRADE_LEVELS` vs the
 * `academic_levels` table): the reference catalog for UI options,
 * validation and compatibility checks when the catalog table is not
 * consulted directly (mock mode, offline).
 *
 * Rules (docs/domain/academic-rules.md §9):
 *  - A filière is the secondary-school academic stream; a spécialité is a
 *    further subdivision where the Algerian structure requires one.
 *  - A classe/section is the concrete student group — distinct from the
 *    filière.
 *  - Class formation must reject incompatible student → class assignments
 *    (see {@link trackCompatible} — the mirror of the SQL
 *    `fn_track_compatible`).
 *  - The catalog belongs to canonical configuration data, never to
 *    individual UI components.
 */

import type { GradeLevel } from "./student";

/** A catalog row: a filière or (when `parentCode` is set) a spécialité. */
export interface AcademicTrack {
  readonly code: string;
  readonly labelFr: string;
  readonly labelAr: string | null;
  /** Canonical grade codes this track applies to. */
  readonly applicableGrades: readonly GradeLevel[];
  /** NULL for a filière; the parent filière code for a spécialité. */
  readonly parentCode: string | null;
}

const ALL_GRADES: readonly GradeLevel[] = [
  "prescolaire_1",
  "prescolaire_2",
  "1ap",
  "2ap",
  "3ap",
  "4ap",
  "5ap",
  "1am",
  "2am",
  "3am",
  "4am",
  "1ere_annee",
  "2eme_annee",
  "3eme_annee",
];

const LYCEE_FILIERE_GRADES: readonly GradeLevel[] = ["2eme_annee", "3eme_annee"];
const TRONC_COMMUN_GRADES: readonly GradeLevel[] = ["1ere_annee"];

/**
 * The filières (mirrors the 0107 seed — keep in lockstep).
 * 'general' means "no stream / tronc commun indifférencié" and applies to
 * the whole ladder (it is the pre-0107 state of every student and class).
 */
export const FILIERES: readonly AcademicTrack[] = [
  { code: "general", labelFr: "Générale", labelAr: "عامة", applicableGrades: ALL_GRADES, parentCode: null },
  { code: "tronc_commun_sciences", labelFr: "Tronc Commun Sciences", labelAr: "جذع مشترك علوم", applicableGrades: TRONC_COMMUN_GRADES, parentCode: null },
  { code: "tronc_commun_lettres", labelFr: "Tronc Commun Lettres", labelAr: "جذع مشترك آداب", applicableGrades: TRONC_COMMUN_GRADES, parentCode: null },
  { code: "tronc_commun_technologie", labelFr: "Tronc Commun Technologie", labelAr: "جذع مشترك تكنولوجيا", applicableGrades: TRONC_COMMUN_GRADES, parentCode: null },
  { code: "lettres_philosophie", labelFr: "Lettres et Philosophie", labelAr: "آداب وفلسفة", applicableGrades: LYCEE_FILIERE_GRADES, parentCode: null },
  { code: "langues_etrangeres", labelFr: "Langues Étrangères", labelAr: "لغات أجنبية", applicableGrades: LYCEE_FILIERE_GRADES, parentCode: null },
  { code: "sciences_experimentales", labelFr: "Sciences Expérimentales", labelAr: "علوم تجريبية", applicableGrades: LYCEE_FILIERE_GRADES, parentCode: null },
  { code: "mathematiques", labelFr: "Mathématiques", labelAr: "رياضيات", applicableGrades: LYCEE_FILIERE_GRADES, parentCode: null },
  { code: "gestion_economie", labelFr: "Gestion et Économie", labelAr: "تسيير واقتصاد", applicableGrades: LYCEE_FILIERE_GRADES, parentCode: null },
  { code: "technique_mathematique", labelFr: "Technique Mathématique", labelAr: "تقني رياضي", applicableGrades: LYCEE_FILIERE_GRADES, parentCode: null },
];

/** The génie spécialités (children of Technique Mathématique — mirrors 0107). */
export const SPECIALITES: readonly AcademicTrack[] = [
  { code: "genie_mecanique", labelFr: "Génie Mécanique", labelAr: "هندسة ميكانيكية", applicableGrades: LYCEE_FILIERE_GRADES, parentCode: "technique_mathematique" },
  { code: "genie_civil", labelFr: "Génie Civil", labelAr: "هندسة مدنية", applicableGrades: LYCEE_FILIERE_GRADES, parentCode: "technique_mathematique" },
  { code: "genie_electrique", labelFr: "Génie Électrique", labelAr: "هندسة كهربائية", applicableGrades: LYCEE_FILIERE_GRADES, parentCode: "technique_mathematique" },
  { code: "genie_procedes", labelFr: "Génie des Procédés", labelAr: "هندسة الطرائق", applicableGrades: LYCEE_FILIERE_GRADES, parentCode: "technique_mathematique" },
];

/** The full catalog (filières + spécialités). */
export const ACADEMIC_TRACKS: readonly AcademicTrack[] = [...FILIERES, ...SPECIALITES];

/** FR label lookup for any track code (filière or spécialité). */
export const TRACK_LABELS_FR: Readonly<Record<string, string>> = Object.fromEntries(
  ACADEMIC_TRACKS.map((t) => [t.code, t.labelFr]),
);

/** FR label of a track code; falls back to the raw code when unknown. */
export function trackLabelFr(code: string | null | undefined): string {
  if (!code) return "—";
  return TRACK_LABELS_FR[code] ?? code;
}

/** Find a filière by code. */
export function findFiliere(code: string | null | undefined): AcademicTrack | undefined {
  if (!code) return undefined;
  return FILIERES.find((f) => f.code === code);
}

/** Find a spécialité by code. */
export function findSpecialite(code: string | null | undefined): AcademicTrack | undefined {
  if (!code) return undefined;
  return SPECIALITES.find((s) => s.code === code);
}

/**
 * Is this filière applicable at the given grade? (Mirrors the SQL
 * `applicable_grades` containment test.)
 */
export function isFiliereApplicableAtGrade(code: string | null | undefined, grade: GradeLevel): boolean {
  const f = findFiliere(code);
  if (!f) return false;
  return f.applicableGrades.includes(grade);
}

/** The filières available for a grade (the form/filter option list). */
export function getFilieresForGrade(grade: GradeLevel): readonly AcademicTrack[] {
  return FILIERES.filter((f) => f.applicableGrades.includes(grade));
}

/**
 * The spécialités of a filière, when the Algerian structure requires one
 * (empty list = the filière has no spécialité subdivision).
 */
export function getSpecialitesForFiliere(filiereCode: string | null | undefined): readonly AcademicTrack[] {
  if (!filiereCode) return [];
  return SPECIALITES.filter((s) => s.parentCode === filiereCode);
}

/** True when the filière has at least one spécialité (UI hint). */
export function filiereHasSpecialites(filiereCode: string | null | undefined): boolean {
  return getSpecialitesForFiliere(filiereCode).length > 0;
}

/**
 * The canonical compatibility predicate (mirror of the SQL
 * `fn_track_compatible`, migration 0107 §3 — keep in lockstep):
 *
 *  - untagged class (null / "general")          → always compatible;
 *  - tagged class, untagged student             → compatible (the
 *    assignment tags the student with the class's stream);
 *  - same filière                               → compatible;
 *  - different filière that does NOT apply at the target grade (e.g. a
 *    1AS tronc-commun stream entering a 2AS filière) → compatible
 *    (re-streaming is the point of year-end class formation);
 *  - different filière that DOES apply at the target grade → CONFLICT;
 *  - a class tagged with a spécialité requires an equal student
 *    spécialité (untagged student spécialité passes — assignment tags).
 */
export function trackCompatible(
  studentFiliere: string | null | undefined,
  studentSpecialite: string | null | undefined,
  classFiliere: string | null | undefined,
  classSpecialite: string | null | undefined,
  targetGrade: GradeLevel,
): boolean {
  const sf = (studentFiliere ?? "").trim().toLowerCase() || "general";
  const cf = (classFiliere ?? "").trim().toLowerCase() || "general";
  const ss = (studentSpecialite ?? "").trim().toLowerCase() || "";
  const cs = (classSpecialite ?? "").trim().toLowerCase() || "";

  // Untagged class: always compatible (the pre-0107 behavior).
  if (!classFiliere || cf === "general") return true;

  // Spécialité integrity: a class spécialité requires an equal student
  // spécialité (an untagged student spécialité passes).
  if (cs !== "" && ss !== "" && ss !== cs) return false;

  // Untagged student: can enter any tagged class (the assignment tags
  // them).
  if (!studentFiliere || sf === "general") return true;

  // Same stream.
  if (sf === cf) return true;

  // Different stream: compatible only when the student's stream does not
  // apply at the target grade (re-streaming promotion), else a conflict.
  return !isFiliereApplicableAtGrade(sf, targetGrade);
}

/** Human-readable incompatibility explanation (UI warning text). */
export function trackIncompatibilityReason(
  studentFiliere: string | null | undefined,
  classFiliere: string | null | undefined,
  targetGrade: GradeLevel,
): string | null {
  if (trackCompatible(studentFiliere, null, classFiliere, null, targetGrade)) return null;
  return `Filière « ${trackLabelFr(studentFiliere)} » incompatible avec la classe « ${trackLabelFr(classFiliere)} » (${targetGrade})`;
}

/**
 * Normalize a classification code to its canonical storage form —
 * trimmed/lowercased, with "general" and "" mapping to NULL (the untagged
 * pre-0107 state). Mirrors the SQL side's normalization (0107 §5).
 */
export function normalizeTrackCode(code: string | null | undefined): string | null {
  const c = (code ?? "").trim().toLowerCase();
  if (!c || c === "general") return null;
  return c;
}
