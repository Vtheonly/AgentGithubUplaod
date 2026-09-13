import { describe, it, expect } from "vitest";
import {
  resolveSubjectConfiguration,
  computeSubjectAverageFromRecipe,
} from "../../../domain/calc/academics/subject-config";
import {
  DEFAULT_GRADING_RECIPE,
  computeSubjectAverage,
  type Subject,
  type SubjectConfiguration,
} from "../../../domain/model/academic";

/**
 * T-345 (MATIERE-500 / ADR-018): the canonical subject-configuration
 * resolver + the recipe-aware subject average. These tests pin the ONE
 * resolution rule that replaces the fourteen scattered
 * `a.coefficient || subject?.coefficient || 1` fallback chains.
 */

const SUBJECT: Subject = {
  id: "subj-ar",
  tenantId: "t1",
  code: "AR",
  name: "Arabe",
  nameAr: "العربية",
  cycle: "primaire",
  level: "primaire",
  coefficient: 3,
  passingGrade: 10,
  isExtracurricular: false,
  isActive: true,
  teacherId: null,
  teacherName: null,
  academicYearId: "ay-1",
  academicYearCode: "2026-2027",
};

function config(over: Partial<SubjectConfiguration> = {}): SubjectConfiguration {
  return {
    id: "cfg-1",
    tenantId: "t1",
    subjectId: SUBJECT.id,
    academicYearId: "ay-1",
    academicLevelId: "al-4am",
    direction: "general",
    coefficient: 4,
    subjectCode: null,
    passingGrade: 10,
    isExtracurricular: false,
    gradingRecipe: { devoir1: 1, devoir2: 1, examen: 2, cc: 0 },
    weeklyHours: null,
    isActive: true,
    ...over,
  };
}

describe("resolveSubjectConfiguration (the ONE canonical rule)", () => {
  it("layer 2 — the configuration row wins when the context matches", () => {
    const r = resolveSubjectConfiguration({
      subject: SUBJECT,
      configurations: [config({ coefficient: 4, academicLevelId: "al-4am" })],
      academicLevelId: "al-4am",
      academicYearId: "ay-1",
    });
    expect(r.coefficient).toBe(4);
    expect(r.source).toBe("configuration");
    expect(r.subjectCode).toBe("AR");
  });

  it("falls through to legacy-subject when no configuration matches the context", () => {
    const r = resolveSubjectConfiguration({
      subject: SUBJECT,
      configurations: [config({ academicLevelId: "al-4am" })],
      academicLevelId: "al-1ap", // a DIFFERENT level — no config row
      academicYearId: "ay-1",
    });
    expect(r.coefficient).toBe(3); // subjects.default_coefficient
    expect(r.source).toBe("legacy-subject");
  });

  it("falls to the hard default when neither subject nor configuration exists", () => {
    const r = resolveSubjectConfiguration({
      subject: undefined,
      configurations: [],
    });
    expect(r.coefficient).toBe(1);
    expect(r.passingGrade).toBe(10);
    expect(r.source).toBe("default");
  });

  it("exact direction beats the 'general' row; 'general' beats nothing", () => {
    const rExact = resolveSubjectConfiguration({
      subject: SUBJECT,
      configurations: [
        config({ direction: "sciences", coefficient: 5 }),
        config({ direction: "general", coefficient: 4 }),
      ],
      academicLevelId: "al-4am",
      academicYearId: "ay-1",
      direction: "sciences",
    });
    expect(rExact.coefficient).toBe(5);

    const rGeneral = resolveSubjectConfiguration({
      subject: SUBJECT,
      configurations: [
        config({ direction: "sciences", coefficient: 5 }),
        config({ direction: "general", coefficient: 4 }),
      ],
      academicLevelId: "al-4am",
      academicYearId: "ay-1",
      direction: "lettres", // no exact row → 'general' fallback
    });
    expect(rGeneral.coefficient).toBe(4);
  });

  it("the subject_code of the configuration overrides the directory code", () => {
    const r = resolveSubjectConfiguration({
      subject: SUBJECT,
      configurations: [config({ subjectCode: "ARB-4AM" })],
      academicLevelId: "al-4am",
      academicYearId: "ay-1",
    });
    expect(r.subjectCode).toBe("ARB-4AM");
  });

  it("layer 1 — the assessment SNAPSHOT wins over the configuration (non-retroactive)", () => {
    const r = resolveSubjectConfiguration({
      subject: SUBJECT,
      configurations: [config({ coefficient: 4 })],
      academicLevelId: "al-4am",
      academicYearId: "ay-1",
      snapshot: {
        coefficient: 3, // entered when the config said 3
        coefficientDevoir1: 1,
        coefficientDevoir2: 1,
        coefficientExamen: 2,
        coefficientCc: 0,
      },
    });
    expect(r.coefficient).toBe(3); // history keeps its entry-time value
    expect(r.source).toBe("configuration"); // the context layer still answers
  });

  it("inactive configuration rows are ignored", () => {
    const r = resolveSubjectConfiguration({
      subject: SUBJECT,
      configurations: [config({ isActive: false, coefficient: 9 })],
      academicLevelId: "al-4am",
      academicYearId: "ay-1",
    });
    expect(r.coefficient).toBe(3); // legacy subject
    expect(r.source).toBe("legacy-subject");
  });
});

describe("computeSubjectAverageFromRecipe (the generalized canonical engine)", () => {
  it("the DEFAULT recipe is bit-identical to the historical engine", () => {
    const vectors: Array<[number, number, number]> = [
      [14, 16, 18],
      [11, 11, 11],
      [7, 7, 20],
      [12.5, 13.25, 14.125],
      [0, 20, 10],
    ];
    for (const [d1, d2, ex] of vectors) {
      expect(computeSubjectAverageFromRecipe(d1, d2, ex, null, DEFAULT_GRADING_RECIPE)).toBe(
        computeSubjectAverage(d1, d2, ex),
      );
    }
  });

  it("a positive-weight component is REQUIRED — missing → null (T-336 honesty rule)", () => {
    expect(computeSubjectAverageFromRecipe(12, null, 16, null)).toBeNull();
    expect(computeSubjectAverageFromRecipe(12, 14, null, null)).toBeNull();
    // cc enabled (weight 1) but not entered → not computable
    expect(
      computeSubjectAverageFromRecipe(12, 14, 16, null, { devoir1: 1, devoir2: 1, examen: 2, cc: 1 }),
    ).toBeNull();
  });

  it("no marks at all → null", () => {
    expect(computeSubjectAverageFromRecipe(null, null, null, null)).toBeNull();
  });

  it("the contrôle-continu recipe: (cc×1 + ex×2) / 3 when devoirs have weight 0", () => {
    const r = { devoir1: 0, devoir2: 0, examen: 2, cc: 1 };
    // (15×1 + 12×2) / 3 = 39/3 = 13 — the migration-0094 C4 probe value
    expect(computeSubjectAverageFromRecipe(null, null, 12, 15, r)).toBe(13);
  });

  it("cc with weight 0 is IGNORED — legacy behavior preserved", () => {
    // (12+14+2×16)/4 = 14.5 — the migration-0094 C5 probe value
    expect(computeSubjectAverageFromRecipe(12, 14, 16, 18, DEFAULT_GRADING_RECIPE)).toBe(14.5);
  });

  it("the full four-component recipe: (D1×1 + D2×1 + Ex×2 + CC×1) / 5", () => {
    const r = { devoir1: 1, devoir2: 1, examen: 2, cc: 1 };
    // (10+10+20+12)/5 = 52/5 = 10.4 — the migration-0094 D1 probe value
    expect(computeSubjectAverageFromRecipe(10, 10, 10, 12, r)).toBe(10.4);
  });

  it("zero-sum recipe → null (not computable)", () => {
    expect(
      computeSubjectAverageFromRecipe(10, 10, 10, 10, { devoir1: 0, devoir2: 0, examen: 0, cc: 0 }),
    ).toBeNull();
  });

  it("decimal weights compute exactly (centi-scaled integer math)", () => {
    const r = { devoir1: 1.5, devoir2: 1, examen: 2.5, cc: 0 };
    // (12×1.5 + 10×1 + 14×2.5)/5 = (18+10+35)/5 = 63/5 = 12.6
    expect(computeSubjectAverageFromRecipe(12, 10, 14, null, r)).toBe(12.6);
  });
});
