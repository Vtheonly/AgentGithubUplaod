// ============================================================================
// FILE: src/domain/calc/academics/algerian-curriculum.ts
// ============================================================================
/**
 * The Algerian national curriculum catalog — T-408 (ACAD-508).
 *
 * DATA, NOT CODE — the TypeScript mirror of migration 0113 §2/§3 (the
 * `subjects` identity rows + the `subject_configurations` context rows
 * seeded for the tenant's CURRENT academic year). This module exists for
 * mock mode, unit tests and documentation; the LIVE catalog lives in the
 * database (ADR-018: subjects = IDENTITY, subject_configurations = CONTEXT
 * per year × level × direction — one "Arabe" identity configured at every
 * level it is taught, never a duplicate row per cycle).
 *
 * Sources (the owner's "modules and subjects handled according to the
 * Algerian system" mandate, resolved against the official Ministry
 * programs):
 *   - The national matières (identities) are the ministry curriculum
 *     subjects, préscolaire → secondaire.
 *   - CEM (4AM) coefficients are the OFFICIAL BEM scale: Arabe 5,
 *     Mathématiques 4, Sciences physiques 2, SVT 2, Histoire-Géo 2,
 *     Français 3, Anglais 2, Éducation islamique 2 (moyenne /22).
 *   - Primaire / lycée 'general' weights are standard editable defaults
 *     (the per-filière BAC coefficients at 2AS/3AS are configured per
 *     direction in the SubjectConfigurationsPanel — data, not code).
 *   - weekly_hours stay NULL at the directory level: weekly hours belong to
 *     the per-class curriculum (class_subjects.weekly_hours — the Emploi du
 *     temps tab), never to the subject directory.
 */

/** An Algerian national-catalog matière identity (ADR-018 decision 1). */
export interface AlgerianSubjectIdentity {
  /** Stable catalog code (uppercase, unique per tenant). */
  readonly code: string;
  readonly nameFr: string;
  readonly nameAr: string;
  readonly nameEn: string;
  /** scolarite | club | therapy | auxiliary — the 0004 CHECK family. */
  readonly domain: "scolarite" | "club" | "therapy" | "auxiliary";
}

/** A per-level context configuration (ADR-018 decision 2). */
export interface AlgerianLevelConfiguration {
  /** The academic_levels.grade_code the configuration applies to. */
  readonly gradeCode: string;
  readonly subjectCode: string;
  /** The coefficient in THIS level's bulletin (official BEM at 4AM). */
  readonly coefficient: number;
}

/** The national matières — IDENTITY rows (no cycle: identity ≠ context). */
export const ALGERIAN_SUBJECTS: readonly AlgerianSubjectIdentity[] = [
  { code: "ARABE", nameFr: "Langue arabe", nameAr: "اللغة العربية", nameEn: "Arabic", domain: "scolarite" },
  { code: "MATHS", nameFr: "Mathématiques", nameAr: "الرياضيات", nameEn: "Mathematics", domain: "scolarite" },
  { code: "FRANCAIS", nameFr: "Langue française", nameAr: "اللغة الفرنسية", nameEn: "French", domain: "scolarite" },
  { code: "ANGLAIS", nameFr: "Langue anglaise", nameAr: "اللغة الإنجليزية", nameEn: "English", domain: "scolarite" },
  { code: "TAMAZIGHT", nameFr: "Langue amazighe", nameAr: "الأمازيغية", nameEn: "Tamazight", domain: "scolarite" },
  { code: "PHYSIQUE", nameFr: "Sciences physiques et technologiques", nameAr: "العلوم الفيزيائية والتكنولوجيا", nameEn: "Physical sciences & technology", domain: "scolarite" },
  { code: "SVT", nameFr: "Sciences de la nature et de la vie", nameAr: "علوم الطبيعة والحياة", nameEn: "Natural & life sciences", domain: "scolarite" },
  { code: "EVEIL_SCI", nameFr: "Éveil scientifique et technologique", nameAr: "التفتح العلمي والتكنولوجي", nameEn: "Scientific & technological awakening", domain: "scolarite" },
  { code: "HIST_GEO", nameFr: "Histoire et géographie", nameAr: "التاريخ والجغرافيا", nameEn: "History & geography", domain: "scolarite" },
  { code: "EDU_ISLAM", nameFr: "Éducation islamique", nameAr: "التربية الإسلامية", nameEn: "Islamic education", domain: "scolarite" },
  { code: "PHILO", nameFr: "Philosophie", nameAr: "الفلسفة", nameEn: "Philosophy", domain: "scolarite" },
  { code: "INFORMATIQUE", nameFr: "Informatique", nameAr: "الإعلام الآلي", nameEn: "Computer science", domain: "scolarite" },
  { code: "EPS", nameFr: "Éducation physique et sportive", nameAr: "التربية البدنية والرياضية", nameEn: "Physical education", domain: "scolarite" },
  { code: "EDU_ARTISTIQUE", nameFr: "Éducation artistique", nameAr: "التربية الفنية", nameEn: "Arts education", domain: "scolarite" },
];

/**
 * The per-level context weights. The 4AM column is the OFFICIAL BEM scale;
 * other levels carry the standard editable bulletin weighting. Subjects NOT
 * listed for a level are not taught there in the national program
 * (TAMAZIGHT is identity-only: it is configured where the school teaches
 * it — the panel is the tool for that, per ADR-018).
 */
export const ALGERIAN_LEVEL_CONFIGURATIONS: readonly AlgerianLevelConfiguration[] =
  [
    // ---- Préscolaire (éveil / activities weighting) ----
    { gradeCode: "prescolaire_1", subjectCode: "ARABE", coefficient: 1 },
    { gradeCode: "prescolaire_1", subjectCode: "MATHS", coefficient: 1 },
    { gradeCode: "prescolaire_1", subjectCode: "EVEIL_SCI", coefficient: 1 },
    { gradeCode: "prescolaire_1", subjectCode: "EDU_ISLAM", coefficient: 1 },
    { gradeCode: "prescolaire_1", subjectCode: "EPS", coefficient: 1 },
    { gradeCode: "prescolaire_1", subjectCode: "EDU_ARTISTIQUE", coefficient: 1 },
    { gradeCode: "prescolaire_2", subjectCode: "ARABE", coefficient: 1 },
    { gradeCode: "prescolaire_2", subjectCode: "MATHS", coefficient: 1 },
    { gradeCode: "prescolaire_2", subjectCode: "EVEIL_SCI", coefficient: 1 },
    { gradeCode: "prescolaire_2", subjectCode: "EDU_ISLAM", coefficient: 1 },
    { gradeCode: "prescolaire_2", subjectCode: "EPS", coefficient: 1 },
    { gradeCode: "prescolaire_2", subjectCode: "EDU_ARTISTIQUE", coefficient: 1 },

    // ---- Primaire (1AP/2AP: the national core; 3AP+: + FR/EN/HG) ----
    { gradeCode: "1ap", subjectCode: "ARABE", coefficient: 4 },
    { gradeCode: "1ap", subjectCode: "MATHS", coefficient: 4 },
    { gradeCode: "1ap", subjectCode: "EVEIL_SCI", coefficient: 2 },
    { gradeCode: "1ap", subjectCode: "EDU_ISLAM", coefficient: 2 },
    { gradeCode: "1ap", subjectCode: "EPS", coefficient: 1 },
    { gradeCode: "1ap", subjectCode: "EDU_ARTISTIQUE", coefficient: 1 },
    { gradeCode: "2ap", subjectCode: "ARABE", coefficient: 4 },
    { gradeCode: "2ap", subjectCode: "MATHS", coefficient: 4 },
    { gradeCode: "2ap", subjectCode: "EVEIL_SCI", coefficient: 2 },
    { gradeCode: "2ap", subjectCode: "EDU_ISLAM", coefficient: 2 },
    { gradeCode: "2ap", subjectCode: "EPS", coefficient: 1 },
    { gradeCode: "2ap", subjectCode: "EDU_ARTISTIQUE", coefficient: 1 },
    { gradeCode: "3ap", subjectCode: "ARABE", coefficient: 4 },
    { gradeCode: "3ap", subjectCode: "MATHS", coefficient: 4 },
    { gradeCode: "3ap", subjectCode: "EVEIL_SCI", coefficient: 2 },
    { gradeCode: "3ap", subjectCode: "EDU_ISLAM", coefficient: 2 },
    { gradeCode: "3ap", subjectCode: "FRANCAIS", coefficient: 2 },
    { gradeCode: "3ap", subjectCode: "ANGLAIS", coefficient: 2 },
    { gradeCode: "3ap", subjectCode: "HIST_GEO", coefficient: 2 },
    { gradeCode: "3ap", subjectCode: "EPS", coefficient: 1 },
    { gradeCode: "3ap", subjectCode: "EDU_ARTISTIQUE", coefficient: 1 },
    { gradeCode: "4ap", subjectCode: "ARABE", coefficient: 4 },
    { gradeCode: "4ap", subjectCode: "MATHS", coefficient: 4 },
    { gradeCode: "4ap", subjectCode: "EVEIL_SCI", coefficient: 2 },
    { gradeCode: "4ap", subjectCode: "EDU_ISLAM", coefficient: 2 },
    { gradeCode: "4ap", subjectCode: "FRANCAIS", coefficient: 2 },
    { gradeCode: "4ap", subjectCode: "ANGLAIS", coefficient: 2 },
    { gradeCode: "4ap", subjectCode: "HIST_GEO", coefficient: 2 },
    { gradeCode: "4ap", subjectCode: "EPS", coefficient: 1 },
    { gradeCode: "4ap", subjectCode: "EDU_ARTISTIQUE", coefficient: 1 },
    { gradeCode: "5ap", subjectCode: "ARABE", coefficient: 4 },
    { gradeCode: "5ap", subjectCode: "MATHS", coefficient: 4 },
    { gradeCode: "5ap", subjectCode: "EVEIL_SCI", coefficient: 2 },
    { gradeCode: "5ap", subjectCode: "EDU_ISLAM", coefficient: 2 },
    { gradeCode: "5ap", subjectCode: "FRANCAIS", coefficient: 2 },
    { gradeCode: "5ap", subjectCode: "ANGLAIS", coefficient: 2 },
    { gradeCode: "5ap", subjectCode: "HIST_GEO", coefficient: 2 },
    { gradeCode: "5ap", subjectCode: "EPS", coefficient: 1 },
    { gradeCode: "5ap", subjectCode: "EDU_ARTISTIQUE", coefficient: 1 },

    // ---- CEM — the OFFICIAL BEM scale (applied 1AM..4AM) ----
    { gradeCode: "1am", subjectCode: "ARABE", coefficient: 5 },
    { gradeCode: "1am", subjectCode: "MATHS", coefficient: 4 },
    { gradeCode: "1am", subjectCode: "PHYSIQUE", coefficient: 2 },
    { gradeCode: "1am", subjectCode: "SVT", coefficient: 2 },
    { gradeCode: "1am", subjectCode: "HIST_GEO", coefficient: 2 },
    { gradeCode: "1am", subjectCode: "FRANCAIS", coefficient: 3 },
    { gradeCode: "1am", subjectCode: "ANGLAIS", coefficient: 2 },
    { gradeCode: "1am", subjectCode: "EDU_ISLAM", coefficient: 2 },
    { gradeCode: "1am", subjectCode: "INFORMATIQUE", coefficient: 1 },
    { gradeCode: "1am", subjectCode: "EPS", coefficient: 1 },
    { gradeCode: "1am", subjectCode: "EDU_ARTISTIQUE", coefficient: 1 },
    { gradeCode: "2am", subjectCode: "ARABE", coefficient: 5 },
    { gradeCode: "2am", subjectCode: "MATHS", coefficient: 4 },
    { gradeCode: "2am", subjectCode: "PHYSIQUE", coefficient: 2 },
    { gradeCode: "2am", subjectCode: "SVT", coefficient: 2 },
    { gradeCode: "2am", subjectCode: "HIST_GEO", coefficient: 2 },
    { gradeCode: "2am", subjectCode: "FRANCAIS", coefficient: 3 },
    { gradeCode: "2am", subjectCode: "ANGLAIS", coefficient: 2 },
    { gradeCode: "2am", subjectCode: "EDU_ISLAM", coefficient: 2 },
    { gradeCode: "2am", subjectCode: "INFORMATIQUE", coefficient: 1 },
    { gradeCode: "2am", subjectCode: "EPS", coefficient: 1 },
    { gradeCode: "2am", subjectCode: "EDU_ARTISTIQUE", coefficient: 1 },
    { gradeCode: "3am", subjectCode: "ARABE", coefficient: 5 },
    { gradeCode: "3am", subjectCode: "MATHS", coefficient: 4 },
    { gradeCode: "3am", subjectCode: "PHYSIQUE", coefficient: 2 },
    { gradeCode: "3am", subjectCode: "SVT", coefficient: 2 },
    { gradeCode: "3am", subjectCode: "HIST_GEO", coefficient: 2 },
    { gradeCode: "3am", subjectCode: "FRANCAIS", coefficient: 3 },
    { gradeCode: "3am", subjectCode: "ANGLAIS", coefficient: 2 },
    { gradeCode: "3am", subjectCode: "EDU_ISLAM", coefficient: 2 },
    { gradeCode: "3am", subjectCode: "INFORMATIQUE", coefficient: 1 },
    { gradeCode: "3am", subjectCode: "EPS", coefficient: 1 },
    { gradeCode: "3am", subjectCode: "EDU_ARTISTIQUE", coefficient: 1 },
    // 4AM — the OFFICIAL BEM coefficients (moyenne /22).
    { gradeCode: "4am", subjectCode: "ARABE", coefficient: 5 },
    { gradeCode: "4am", subjectCode: "MATHS", coefficient: 4 },
    { gradeCode: "4am", subjectCode: "PHYSIQUE", coefficient: 2 },
    { gradeCode: "4am", subjectCode: "SVT", coefficient: 2 },
    { gradeCode: "4am", subjectCode: "HIST_GEO", coefficient: 2 },
    { gradeCode: "4am", subjectCode: "FRANCAIS", coefficient: 3 },
    { gradeCode: "4am", subjectCode: "ANGLAIS", coefficient: 2 },
    { gradeCode: "4am", subjectCode: "EDU_ISLAM", coefficient: 2 },
    { gradeCode: "4am", subjectCode: "INFORMATIQUE", coefficient: 1 },
    { gradeCode: "4am", subjectCode: "EPS", coefficient: 1 },
    { gradeCode: "4am", subjectCode: "EDU_ARTISTIQUE", coefficient: 1 },

    // ---- Lycée 1AS (tronc commun — editable defaults; the per-filière
    //      differentiation is configured per direction in the panel) ----
    { gradeCode: "1ere_annee", subjectCode: "ARABE", coefficient: 3 },
    { gradeCode: "1ere_annee", subjectCode: "MATHS", coefficient: 4 },
    { gradeCode: "1ere_annee", subjectCode: "PHYSIQUE", coefficient: 3 },
    { gradeCode: "1ere_annee", subjectCode: "SVT", coefficient: 2 },
    { gradeCode: "1ere_annee", subjectCode: "HIST_GEO", coefficient: 2 },
    { gradeCode: "1ere_annee", subjectCode: "FRANCAIS", coefficient: 2 },
    { gradeCode: "1ere_annee", subjectCode: "ANGLAIS", coefficient: 2 },
    { gradeCode: "1ere_annee", subjectCode: "EDU_ISLAM", coefficient: 2 },
    { gradeCode: "1ere_annee", subjectCode: "INFORMATIQUE", coefficient: 1 },
    { gradeCode: "1ere_annee", subjectCode: "EPS", coefficient: 1 },

    // ---- Lycée 2AS/3AS (general direction — the BAC per-stream scale is
    //      owner-configurable per filière in the SubjectConfigurationsPanel;
    //      these are the standard editable defaults) ----
    { gradeCode: "2eme_annee", subjectCode: "ARABE", coefficient: 3 },
    { gradeCode: "2eme_annee", subjectCode: "MATHS", coefficient: 5 },
    { gradeCode: "2eme_annee", subjectCode: "PHYSIQUE", coefficient: 4 },
    { gradeCode: "2eme_annee", subjectCode: "SVT", coefficient: 4 },
    { gradeCode: "2eme_annee", subjectCode: "HIST_GEO", coefficient: 2 },
    { gradeCode: "2eme_annee", subjectCode: "FRANCAIS", coefficient: 2 },
    { gradeCode: "2eme_annee", subjectCode: "ANGLAIS", coefficient: 2 },
    { gradeCode: "2eme_annee", subjectCode: "EDU_ISLAM", coefficient: 2 },
    { gradeCode: "2eme_annee", subjectCode: "PHILO", coefficient: 2 },
    { gradeCode: "2eme_annee", subjectCode: "INFORMATIQUE", coefficient: 1 },
    { gradeCode: "2eme_annee", subjectCode: "EPS", coefficient: 1 },
    { gradeCode: "3eme_annee", subjectCode: "ARABE", coefficient: 3 },
    { gradeCode: "3eme_annee", subjectCode: "MATHS", coefficient: 5 },
    { gradeCode: "3eme_annee", subjectCode: "PHYSIQUE", coefficient: 4 },
    { gradeCode: "3eme_annee", subjectCode: "SVT", coefficient: 4 },
    { gradeCode: "3eme_annee", subjectCode: "HIST_GEO", coefficient: 2 },
    { gradeCode: "3eme_annee", subjectCode: "FRANCAIS", coefficient: 2 },
    { gradeCode: "3eme_annee", subjectCode: "ANGLAIS", coefficient: 2 },
    { gradeCode: "3eme_annee", subjectCode: "EDU_ISLAM", coefficient: 2 },
    { gradeCode: "3eme_annee", subjectCode: "PHILO", coefficient: 2 },
    { gradeCode: "3eme_annee", subjectCode: "INFORMATIQUE", coefficient: 1 },
    { gradeCode: "3eme_annee", subjectCode: "EPS", coefficient: 1 },
  ];

/** The official BEM (4AM) scale — pinned by tests, verbatim. */
export const OFFICIAL_BEM_COEFFICIENTS: Readonly<
  Record<string, number>
> = Object.freeze({
  ARABE: 5,
  MATHS: 4,
  PHYSIQUE: 2,
  SVT: 2,
  HIST_GEO: 2,
  FRANCAIS: 3,
  ANGLAIS: 2,
  EDU_ISLAM: 2,
});

/** Subject codes the catalog registers as identity-only (no context rows). */
export const IDENTITY_ONLY_SUBJECTS: readonly string[] = ["TAMAZIGHT"];

/** The contexts configured for a given grade code. */
export function configurationsForGrade(
  gradeCode: string,
): AlgerianLevelConfiguration[] {
  return ALGERIAN_LEVEL_CONFIGURATIONS.filter(
    (c) => c.gradeCode === gradeCode,
  );
}

/** The identity rows applicable to a grade (identities referenced by its
 *  configurations, plus the identity-only subjects). */
export function subjectIdentitiesForGrade(gradeCode: string): string[] {
  const configured = configurationsForGrade(gradeCode).map(
    (c) => c.subjectCode,
  );
  return [...new Set([...configured, ...IDENTITY_ONLY_SUBJECTS])];
}
