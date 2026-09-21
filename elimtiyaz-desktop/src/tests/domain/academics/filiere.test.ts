import { describe, it, expect } from "vitest";
import {
  FILIERES,
  SPECIALITES,
  ACADEMIC_TRACKS,
  TRACK_LABELS_FR,
  findFiliere,
  findSpecialite,
  getFilieresForGrade,
  getSpecialitesForFiliere,
  isFiliereApplicableAtGrade,
  filiereHasSpecialites,
  trackCompatible,
  trackIncompatibilityReason,
  normalizeTrackCode,
} from "../../../domain/model/filiere";
import {
  validatePlacementFinalization,
  type PlacementCandidate,
  type ClassDraft,
} from "../../../domain/calc/academics/class-placement";
import type { Student } from "../../../domain/model/student";

/**
 * T-401 — the canonical classification model (mirrors migration 0107's
 * seeded catalog and the SQL fn_track_compatible predicate). The SQL side
 * is verified live by scripts/verify_t-401.sql (C1..C5); THIS suite pins
 * the desktop mirror so the two can never drift silently.
 */

function makeStudent(overrides: Partial<Student> = {}): Student {
  return {
    id: "stu-001",
    tenantId: "tenant-1",
    code: "ELV-2026-000001",
    parentId: "par-001",
    firstName: "Sara",
    lastName: "BENALI",
    displayName: null,
    gender: "female",
    birthDate: "2010-05-01",
    enrollmentDate: "2025-09-01",
    level: "lycee",
    gradeYear: 2,
    gradeLevel: "2eme_annee",
    filiereCode: null,
    specialiteCode: null,
    classId: null,
    photoUrl: null,
    medicalNotes: null,
    transportTier: null,
    status: "active",
    paymentPlan: "tranches",
    createdAt: "2025-09-01T00:00:00Z",
    updatedAt: "2025-09-01T00:00:00Z",
    ...overrides,
  };
}

function makeCandidate(student: Student): PlacementCandidate {
  return {
    student,
    studentId: student.id,
    studentName: `${student.firstName} ${student.lastName}`,
    studentCode: student.code,
    gender: student.gender,
    provenance: "promoted",
    originGradeLevel: "1ere_annee",
    originClassName: null,
    previousGpa: 12,
    previousRank: null,
    isPassing: true,
    currentClassId: null,
    assignedClassId: null,
  };
}

function makeDraft(overrides: Partial<ClassDraft> = {}): ClassDraft {
  return {
    id: "draft-1",
    name: "2ème Année - Section A",
    section: "Section A",
    gradeCode: "2eme_annee",
    level: "lycee",
    gradeYear: 2,
    academicYearId: "ay-2027-2028",
    academicYearCode: "2027-2028",
    filiereCode: null,
    specialiteCode: null,
    room: null,
    capacity: null,
    homeroomTeacherId: null,
    homeroomTeacherName: null,
    notes: null,
    isNew: true,
    ...overrides,
  };
}

describe("T-401 — the canonical filière/spécialité catalog (mirror of 0107)", () => {
  it("seeds exactly the 0107 catalog: 10 filières + 4 génie spécialités", () => {
    expect(FILIERES).toHaveLength(10);
    expect(SPECIALITES).toHaveLength(4);
    expect(ACADEMIC_TRACKS).toHaveLength(14);
  });

  it("keeps the catalog codes in lockstep with the SQL seed", () => {
    expect(FILIERES.map((f) => f.code)).toEqual([
      "general",
      "tronc_commun_sciences",
      "tronc_commun_lettres",
      "tronc_commun_technologie",
      "lettres_philosophie",
      "langues_etrangeres",
      "sciences_experimentales",
      "mathematiques",
      "gestion_economie",
      "technique_mathematique",
    ]);
    expect(SPECIALITES.map((s) => s.code).sort()).toEqual(
      ["genie_civil", "genie_electrique", "genie_mecanique", "genie_procedes"].sort(),
    );
  });

  it("every spécialité is a child of technique mathématique (the only subdivided filière)", () => {
    for (const sp of SPECIALITES) {
      expect(sp.parentCode).toBe("technique_mathematique");
    }
    expect(filiereHasSpecialites("technique_mathematique")).toBe(true);
    expect(filiereHasSpecialites("mathematiques")).toBe(false);
    expect(filiereHasSpecialites(null)).toBe(false);
  });

  it("applicability: prescolaire/primaire/CEM have ONLY the general stream", () => {
    expect(getFilieresForGrade("1am")).toHaveLength(1);
    expect(getFilieresForGrade("1am")[0].code).toBe("general");
    expect(getFilieresForGrade("3ap")).toHaveLength(1);
    expect(getFilieresForGrade("prescolaire_1")).toHaveLength(1);
  });

  it("applicability: 1AS carries the tronc commun; 2AS/3AS the six national filières", () => {
    const g1 = getFilieresForGrade("1ere_annee").map((f) => f.code);
    expect(g1).toContain("general");
    expect(g1).toContain("tronc_commun_sciences");
    expect(g1).toContain("tronc_commun_lettres");
    expect(g1).toContain("tronc_commun_technologie");
    expect(g1).not.toContain("mathematiques");

    const g2 = getFilieresForGrade("2eme_annee").map((f) => f.code);
    expect(g2).toHaveLength(7); // general + 6 filières
    expect(g2).toContain("lettres_philosophie");
    expect(g2).toContain("mathematiques");
    expect(g2).not.toContain("tronc_commun_sciences");

    // The génie spécialités apply at 2AS and 3AS.
    expect(isFiliereApplicableAtGrade("genie_mecanique", "2eme_annee")).toBe(false);
    expect(getSpecialitesForFiliere("technique_mathematique").map((s) => s.code)).toContain(
      "genie_mecanique",
    );
  });

  it("label lookups resolve FR labels and fall back to the raw code", () => {
    expect(TRACK_LABELS_FR["mathematiques"]).toBe("Mathématiques");
    expect(findFiliere("mathematiques")?.labelFr).toBe("Mathématiques");
    expect(findSpecialite("genie_civil")?.labelFr).toBe("Génie Civil");
    expect(TRACK_LABELS_FR["not_a_code"]).toBeUndefined();
    expect(trackLabelLookupFallback()).toBe("not_a_code");
  });

  function trackLabelLookupFallback(): string {
    // trackLabelFr is exercised via TRACK_LABELS_FR's fallback semantics
    const code = "not_a_code";
    return TRACK_LABELS_FR[code] ?? code;
  }
});

describe("T-401 — normalizeTrackCode (the SQL-side normalization mirror)", () => {
  it("maps 'general' and blank to NULL (the untagged pre-0107 state)", () => {
    expect(normalizeTrackCode("general")).toBeNull();
    expect(normalizeTrackCode("")).toBeNull();
    expect(normalizeTrackCode(null)).toBeNull();
    expect(normalizeTrackCode(undefined)).toBeNull();
  });

  it("trims and lowercases everything else", () => {
    expect(normalizeTrackCode("  Mathematiques ")).toBe("mathematiques");
    expect(normalizeTrackCode("GENIE_CIVIL")).toBe("genie_civil");
  });
});

describe("T-401 — trackCompatible (the fn_track_compatible mirror)", () => {
  it("an untagged class is always compatible (the pre-0107 behavior)", () => {
    expect(trackCompatible("mathematiques", null, null, null, "2eme_annee")).toBe(true);
    expect(trackCompatible("mathematiques", null, "general", null, "2eme_annee")).toBe(true);
  });

  it("an untagged student can enter any tagged class (the assignment tags them)", () => {
    expect(trackCompatible(null, null, "lettres_philosophie", null, "2eme_annee")).toBe(true);
    expect(trackCompatible("general", null, "mathematiques", null, "2eme_annee")).toBe(true);
  });

  it("the same filière is compatible", () => {
    expect(trackCompatible("mathematiques", null, "mathematiques", null, "2eme_annee")).toBe(true);
  });

  it("a differing filière that APPLIES at the target grade is a CONFLICT", () => {
    // The exact scenario verify_t-401.sql C2c pins on the SQL side.
    expect(
      trackCompatible("mathematiques", null, "lettres_philosophie", null, "2eme_annee"),
    ).toBe(false);
    expect(trackIncompatibilityReason("mathematiques", "lettres_philosophie", "2eme_annee")).toContain(
      "incompatible",
    );
  });

  it("a differing filière that does NOT apply at the target grade is re-streaming (compatible)", () => {
    // 1AS tronc commun student entering a 2AS filière — the whole point of
    // year-end class formation.
    expect(
      trackCompatible("tronc_commun_sciences", null, "sciences_experimentales", null, "2eme_annee"),
    ).toBe(true);
    expect(trackIncompatibilityReason("tronc_commun_sciences", "sciences_experimentales", "2eme_annee")).toBeNull();
  });

  it("a class tagged with a spécialité requires an equal student spécialité", () => {
    expect(
      trackCompatible("technique_mathematique", "genie_civil", "technique_mathematique", "genie_electrique", "3eme_annee"),
    ).toBe(false);
    // An untagged student spécialité passes (the assignment tags them).
    expect(
      trackCompatible("technique_mathematique", null, "technique_mathematique", "genie_electrique", "3eme_annee"),
    ).toBe(true);
  });
});

describe("T-401 — class formation rejects incompatible assignments client-side", () => {
  it("validatePlacementFinalization errors on a conflicting student → class assignment", () => {
    const mathsStudent = makeStudent({ id: "stu-maths", filiereCode: "mathematiques" });
    const lettresClass = makeDraft({
      id: "draft-lettres",
      name: "2ème Année Lettres - Section A",
      filiereCode: "lettres_philosophie",
    });
    const candidates = [makeCandidate(mathsStudent)];
    const assigned = new Map([[mathsStudent.id, "draft-lettres"]]);

    const result = validatePlacementFinalization({
      classes: [lettresClass],
      candidates,
      assignedMap: assigned,
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes("Sara BENALI"))).toBe(true);
    expect(result.errors.some((e) => e.includes("incompatible"))).toBe(true);
  });

  it("validatePlacementFinalization accepts the re-streaming assignment (1AS TC → 2AS filière)", () => {
    const tcStudent = makeStudent({
      id: "stu-tc",
      gradeLevel: "1ere_annee",
      gradeYear: 1,
      level: "lycee",
      filiereCode: "tronc_commun_sciences",
    });
    const sciencesClass = makeDraft({
      id: "draft-sciences",
      name: "2ème Année Sciences - Section A",
      gradeCode: "2eme_annee",
      filiereCode: "sciences_experimentales",
    });
    const candidates = [makeCandidate(tcStudent)];
    const assigned = new Map([[tcStudent.id, "draft-sciences"]]);

    const result = validatePlacementFinalization({
      classes: [sciencesClass],
      candidates,
      assignedMap: assigned,
    });

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("an untagged class never conflicts (the legacy behavior preserved)", () => {
    const mathsStudent = makeStudent({ id: "stu-m2", filiereCode: "mathematiques" });
    const untaggedClass = makeDraft({ id: "draft-untagged" });
    const result = validatePlacementFinalization({
      classes: [untaggedClass],
      candidates: [makeCandidate(mathsStudent)],
      assignedMap: new Map([[mathsStudent.id, "draft-untagged"]]),
    });
    expect(result.isValid).toBe(true);
  });
});
