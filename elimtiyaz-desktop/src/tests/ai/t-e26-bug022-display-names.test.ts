/**
 * E2.6 / BUG-022 — the person-name resolvers + the weighted grade baseline
 * in the AI insights layer.
 *
 * WHAT THIS SUITE PINS (the Session-45 fix):
 *
 *   1. THE DISPLAY-NAME FALLBACK (insights.ts ×2): `displayName ??
 *      first + last` missed EMPTY-STRING displayNames — an anomaly row for
 *      a student with displayName "" rendered an EMPTY label. Both sites
 *      now go through the canonical studentDisplayName (trim → composed
 *      join-trim → fallback).
 *   2. THE TEACHER RESOLVER (visualization-tools.ts): the class diagram
 *      hand-composed `${firstName} ${lastName}` — the new teacherDisplayName
 *      (the ONE person resolver) replaces it.
 *   3. THE WEIGHTED BASELINE (detectGradeAnomalies): the "moyenne
 *      personnelle" was a PLAIN mean over subject averages — a coef-1
 *      module dragged the baseline as much as a coef-4 one. It is now
 *      Σ(value×coef)/Σcoef (snapshot coefficient, null → 1).
 *
 * The discriminator for (3): averages 10 (coef 1) / 10 (coef 1) / 16
 * (coef 4). Weighted baseline = (10+10+64)/6 = 14 → the 10s sit −4 →
 * FLAGGED. The old plain mean = 12 → gap −2 → nothing flagged.
 *
 * Run:
 *   npx vitest run src/tests/ai/t-e26-bug022-display-names.test.ts
 */
import { describe, it, expect } from "vitest";

import {
  detectAttendanceAnomalies,
  detectGradeAnomalies,
  scoreInterventionRisk,
} from "../../core/ai/analysis/insights";
import { teacherDisplayName } from "../../domain/model/teacher";
import type { AttendanceRecord } from "../../domain/model/academic";

/* ------------------------------------------------------------------ */
/* Fixtures.                                                           */
/* ------------------------------------------------------------------ */

/** displayName "" — the exact case the `??` fallback missed. */
const EMPTY_DN_STUDENT = {
  id: "stu-bug022",
  firstName: "Yasmine",
  lastName: "Hamdi",
  displayName: "",
  classId: "cls-001",
};

function attendance(status: AttendanceRecord["status"], i: number): AttendanceRecord {
  return {
    id: `att-bug022-${i}`,
    studentId: EMPTY_DN_STUDENT.id,
    classId: "cls-001",
    date: `2025-11-0${i + 1}`,
    status,
    justified: status !== "absent_unexcused",
    createdAt: `2025-11-0${i + 1}T00:00:00.000Z`,
  } as unknown as AttendanceRecord;
}

const FLAGGED_RECORDS: AttendanceRecord[] = [
  attendance("present", 0),
  attendance("present", 1),
  attendance("absent_unexcused", 2),
  attendance("absent_unexcused", 3),
];

/* ================================================================== */
/* 1 + 2. The display-name resolvers.                                  */
/* ================================================================== */

describe("E2.6 / BUG-022 — the canonical name resolvers", () => {
  it("an EMPTY-STRING displayName falls through to the composed name (attendance anomalies)", () => {
    const out = detectAttendanceAnomalies([
      { student: EMPTY_DN_STUDENT, records: FLAGGED_RECORDS },
      {
        // A healthy twin so the cohort has a mean.
        student: { ...EMPTY_DN_STUDENT, id: "stu-bug022-b", displayName: "Nadia Belkacem" },
        records: [attendance("present", 4), attendance("present", 5)],
      },
    ]);
    const row = out.find((a) => a.studentId === EMPTY_DN_STUDENT.id);
    expect(row).toBeDefined();
    // The `??` bug rendered "" here; the canonical resolver composes.
    expect(row?.studentName).toBe("Yasmine Hamdi");
  });

  it("an EMPTY-STRING displayName falls through to the composed name (intervention candidates)", () => {
    const out = scoreInterventionRisk([
      {
        student: EMPTY_DN_STUDENT,
        gpa: 8,
        isPassing: false,
        attendanceRate: 0.5,
        unexcusedAbsences: 2,
        missingAssessments: 0,
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].studentName).toBe("Yasmine Hamdi");
  });

  it("teacherDisplayName composes, trims, and falls back — the ONE resolver", () => {
    expect(teacherDisplayName({ firstName: "Amina", lastName: "Cherif" })).toBe("Amina Cherif");
    // Whitespace-only parts do not leak into the label.
    expect(teacherDisplayName({ firstName: "  ", lastName: "Cherif" })).toBe("Cherif");
    expect(teacherDisplayName({ firstName: "Karim", lastName: "" })).toBe("Karim");
    // Both parts empty → the canonical sentinel, never an empty label.
    expect(teacherDisplayName({ firstName: "", lastName: "" })).toBe("—");
  });
});

/* ================================================================== */
/* 3. The coefficient-weighted baseline.                               */
/* ================================================================== */

describe("E2.6 / BUG-022 — detectGradeAnomalies' coefficient-weighted baseline", () => {
  const SUBJECTS = [
    { id: "sub-a", name: "Mathématiques" },
    { id: "sub-b", name: "Arabe" },
    { id: "sub-c", name: "Sciences" },
  ];

  it("weighs the baseline by coefficient (10/10/16 with coefs 1/1/4 → baseline 14, the 10s FLAGGED at −4)", () => {
    const out = detectGradeAnomalies(
      [
        {
          studentId: "stu-bug022",
          assessments: [
            { subjectId: "sub-a", subjectAverage: 10, coefficient: 1 },
            { subjectId: "sub-b", subjectAverage: 10, coefficient: 1 },
            { subjectId: "sub-c", subjectAverage: 16, coefficient: 4 },
          ],
        },
      ],
      SUBJECTS,
    );
    // The OLD plain mean (12) would flag NOTHING here (gap −2 > −4).
    expect(out).toHaveLength(2);
    for (const a of out) {
      expect(a.studentBaseline).toBe(14);
      expect(a.gap).toBe(-4);
    }
  });

  it("a NULL coefficient is the neutral weight (1) — the strong profile stays unflagged", () => {
    const out = detectGradeAnomalies(
      [
        {
          studentId: "stu-bug022",
          assessments: [
            // coefficient null at RUNTIME (loose rows) — the type says
            // number, so cast: the ?? 1 in the detector must treat it as
            // the neutral weight, not 0 (which would exclude it).
            { subjectId: "sub-a", subjectAverage: 14, coefficient: null as unknown as number },
            { subjectId: "sub-b", subjectAverage: 14, coefficient: null as unknown as number },
            { subjectId: "sub-c", subjectAverage: 18, coefficient: null as unknown as number },
          ],
        },
      ],
      SUBJECTS,
    );
    // Baseline (14+14+18)/3 = 15.33; the 14s sit −1.33 — below the −4 bar.
    expect(out).toHaveLength(0);
  });
});
