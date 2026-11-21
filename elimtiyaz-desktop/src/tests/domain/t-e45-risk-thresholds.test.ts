/**
 * E4.5 (ARCH-009, L-6) — the domain relocation of the operational
 * risk-profile thresholds: the domain-engine half of the T-596 one-engine
 * mandate (D-U2).
 *
 * BEFORE E4.5 the classification edges were literals inside the dashboard's
 * operational-query-engine (the registered offenders: 25k tension / 30k
 * critical debt / 30 days overdue / GPA 10 / exemplary 15 + 0.95 /
 * absences 3 / rate 0.85). They now live in
 * `domain/calc/analytics/risk-thresholds.ts` with the SAME values as the
 * documented defaults, and every engine entry point is parameterized.
 *
 * This suite pins:
 *   1. THE PINNED-OUTPUT COMPARISON (the card's Verify): the DEFAULT
 *      thresholds reproduce the pre-E4.5 literal behavior BYTE-IDENTICALLY
 *      on a fixture exercising every classification branch + every boundary
 *      (10/20, 25 000, 30 000, 30 days, 3 absences, 85%).
 *   2. THE PARAMETERIZATION (RED control): configured thresholds actually
 *      MOVE the classifications, the scores, the reasons and the preset
 *      filters — the settings-sourced contract the T-596 re-composition
 *      rides.
 *   3. THE SOURCE GUARDS: no classification literals remain in the engine;
 *      the domain module is the ONE home of the edges.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateStudentRiskProfiles,
  operationalPresetsFor,
} from "../../features/dashboard/components/analytics/operational-query-engine";
import {
  DEFAULT_RISK_PROFILE_THRESHOLDS,
  type RiskProfileThresholds,
} from "../../domain/calc/analytics/risk-thresholds";
import type { Student } from "../../domain/model/student";
import type { Parent } from "../../domain/model/parent";
import type {
  AcademicClass,
  Assessment,
  AttendanceRecord,
  Subject,
} from "../../domain/model/academic";
import type { DebtSummary } from "../../domain/model/payment";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, "../..");

function readModule(rel: string): string {
  return readFileSync(join(APP, rel), "utf-8");
}

/* ----------------------------- fixtures ----------------------------- */

const ACADEMIC_YEAR = "2026-2027";

function makeStudent(overrides: Partial<Student> = {}): Student {
  return {
    id: "stu-1",
    tenantId: "tenant-1",
    code: "ELV-2026-000001",
    parentId: "p-1",
    firstName: "Sara",
    lastName: "BENALI",
    displayName: "BENALI Sara",
    gender: "female",
    birthDate: "2015-04-02",
    enrollmentDate: "2026-09-01",
    level: "primaire",
    gradeYear: 3,
    gradeLevel: "3ap",
    classId: null,
    photoUrl: null,
    medicalNotes: null,
    transportTier: null,
    status: "active",
    paymentPlan: "tranches",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  } as unknown as Student;
}

function makeParent(id: string): Parent {
  return {
    id,
    tenantId: "tenant-1",
    code: `PAR-2026-${id}`,
    firstName: "Famille",
    lastName: `PARENT-${id}`,
    displayName: `Parent ${id}`,
    phone: "0550000000",
    email: null,
    address: null,
    cityTier: null,
    authUserId: null,
    activationCode: null,
    status: "active",
    notes: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  } as unknown as Parent;
}

function makeAssessment(
  studentId: string,
  average: number,
): Assessment {
  return {
    id: `asm-${studentId}-${average}`,
    studentId,
    classId: null,
    subjectId: "sub-math",
    term: "T1",
    academicYear: ACADEMIC_YEAR,
    devoir1: average,
    devoir2: average,
    examen: average,
    cc: null,
    subjectAverage: average,
    coefficient: 2,
    coefficientDevoir1: 1,
    coefficientDevoir2: 1,
    coefficientExamen: 2,
    coefficientCc: 0,
    enteredBy: "usr-teacher",
    enteredAt: "2026-11-01T00:00:00.000Z",
  } as unknown as Assessment;
}

function makeAttendance(
  studentId: string,
  status: "present" | "absent_unexcused",
  n: number,
): AttendanceRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `att-${studentId}-${status}-${i}`,
    studentId,
    classId: null,
    date: "2026-11-10",
    session: "morning",
    status,
    justificationId: null,
    recordedBy: "usr-teacher",
    recordedAt: "2026-11-10T08:00:00.000Z",
  })) as unknown as AttendanceRecord[];
}

function makeDebt(
  parentId: string,
  outstandingAmount: number,
  daysOverdue: number,
): DebtSummary {
  return {
    parentId,
    studentId: null,
    outstandingAmount,
    totalDue: outstandingAmount,
    totalPaid: 0,
    daysOverdue,
    oldestDueDate: null,
    lastPaymentDate: null,
    installments: [],
  } as unknown as DebtSummary;
}

const SUBJECTS: readonly Subject[] = [];
const CLASSES: readonly AcademicClass[] = [];

/** The five-branch fixture: healthy / academic / attendance / tension /
 *  triple-critical + the boundary lanes. */
function buildFixture() {
  const students: Student[] = [
    // A: academic alert only — GPA 8 → deficit min(45, round((10-8)*8)) = 16.
    makeStudent({ id: "stu-a", parentId: "p-a" }),
    // B: attendance alert — GPA 12 (no factor), rate 0.75 → min(25, 10) = 10.
    makeStudent({ id: "stu-b", parentId: "p-b" }),
    // C: financial tension only — debt 26 000 (< 30k, 10d < 30d) → +10.
    makeStudent({ id: "stu-c", parentId: "p-c" }),
    // D: TRIPLE critical — GPA 5 (40) + rate 0.5 (25) + 4 unexcused (12) +
    //    debt 50k/45d (20) = 97.
    makeStudent({ id: "stu-d", parentId: "p-d" }),
    // E: healthy — GPA 14, full attendance, no debt.
    makeStudent({ id: "stu-e", parentId: "p-e" }),
    // F: the 10/20 boundary — exactly 10 is NOT an alert (isPassing true).
    makeStudent({ id: "stu-f", parentId: "p-f" }),
    // G: the 25 000 boundary — exactly 25 000 IS financial_tension (>=).
    makeStudent({ id: "stu-g", parentId: "p-g" }),
    // H: the 30-day boundary — debt 5 000 but 30 days overdue → critical
    //    financial factor (+20), below the tension edge → attendance-free
    //    healthy CATEGORY with score 20 (score and category are separate).
    makeStudent({ id: "stu-h", parentId: "p-h" }),
  ];
  const parents = ["a", "b", "c", "d", "e", "f", "g", "h"].map((k) =>
    makeParent(`p-${k}`),
  );
  const assessments: Assessment[] = [
    makeAssessment("stu-a", 8),
    makeAssessment("stu-b", 12),
    makeAssessment("stu-c", 14),
    makeAssessment("stu-d", 5),
    makeAssessment("stu-e", 14),
    makeAssessment("stu-f", 10),
    makeAssessment("stu-g", 14),
    makeAssessment("stu-h", 14),
  ];
  const attendance: AttendanceRecord[] = [
    ...makeAttendance("stu-a", "present", 4),
    // B: 3 present + 1 unexcused = 0.75 rate, 1 unexcused (< 3 — no factor).
    ...makeAttendance("stu-b", "present", 3),
    ...makeAttendance("stu-b", "absent_unexcused", 1),
    ...makeAttendance("stu-c", "present", 4),
    // D: 4 present + 4 unexcused = 0.50 rate, 4 unexcused (>= 3 → +12).
    ...makeAttendance("stu-d", "present", 4),
    ...makeAttendance("stu-d", "absent_unexcused", 4),
    ...makeAttendance("stu-e", "present", 4),
    ...makeAttendance("stu-f", "present", 4),
    ...makeAttendance("stu-g", "present", 4),
    ...makeAttendance("stu-h", "present", 4),
  ];
  const debtSummaries: DebtSummary[] = [
    makeDebt("p-c", 26_000, 10),
    makeDebt("p-d", 50_000, 45),
    makeDebt("p-g", 25_000, 5),
    makeDebt("p-h", 5_000, 30),
  ];
  return { students, parents, classes: CLASSES, subjects: SUBJECTS, assessments, attendance, debtSummaries };
}

function profilesByStudent(thresholds?: RiskProfileThresholds) {
  const fixture = buildFixture();
  const profiles = evaluateStudentRiskProfiles({ ...fixture, thresholds });
  return new Map(profiles.map((p) => [p.studentId, p]));
}

/* ------------------------------- pins ------------------------------- */

describe("E4.5 — the pinned-output comparison: DEFAULT thresholds = the pre-E4.5 literals, byte-identical", () => {
  it("every classification branch, score, reason and boundary reproduces the hardcoded behavior", () => {
    const p = profilesByStudent();

    // A: academic alert — score 16, the exact reason string.
    const a = p.get("stu-a")!;
    expect(a.riskCategory).toBe("academic_alert");
    expect(a.riskScore).toBe(16);
    expect(a.primaryRiskReason).toBe("Moyenne 8.00/20 (< 10)");
    expect(a.isPassing).toBe(false);

    // B: attendance alert — score 10, the rate reason.
    const b = p.get("stu-b")!;
    expect(b.riskCategory).toBe("attendance_alert");
    expect(b.riskScore).toBe(10);
    expect(b.primaryRiskReason).toBe("Assiduité 75%");
    expect(b.unexcusedAbsences).toBe(1);

    // C: financial tension — 26 000 ≥ 25 000; score 10 (below the critical
    //    edges). NOTE the pre-E4.5 quirk preserved byte-identically: the
    //    non-critical +10 branch pushes NO reason, so the reason line stays
    //    "Profil régulier" even though the CATEGORY is financial_tension.
    const c = p.get("stu-c")!;
    expect(c.riskCategory).toBe("financial_tension");
    expect(c.riskScore).toBe(10);
    expect(c.primaryRiskReason).toBe("Profil régulier");

    // D: TRIPLE critical — 40 + 25 + 12 + 20 = 97. (The debt reason formats
    //    through toLocaleString("fr-FR") — the NBSP grouping, built the same
    //    way the engine builds it.)
    const d = p.get("stu-d")!;
    expect(d.riskCategory).toBe("triple_critical");
    expect(d.riskScore).toBe(97);
    expect(d.primaryRiskReason).toBe(
      `Moyenne 5.00/20 (< 10) · Assiduité 50% · 4 absences injustifiées · Créance ${(50_000).toLocaleString("fr-FR")} DA (45j)`,
    );

    // E: healthy — zero score, the regular-profile reason.
    const e = p.get("stu-e")!;
    expect(e.riskCategory).toBe("healthy");
    expect(e.riskScore).toBe(0);
    expect(e.primaryRiskReason).toBe("Profil régulier");
    expect(e.isPassing).toBe(true);

    // F: the 10/20 boundary — exactly 10 passes (no alert, healthy), but the
    //    pre-E4.5 WATCH BAND (10 ≤ gpa < 12) still adds its +10 score (the
    //    scoring model's internal soft signal, NOT a classification edge —
    //    deliberately not parameterized).
    const f = p.get("stu-f")!;
    expect(f.riskCategory).toBe("healthy");
    expect(f.isPassing).toBe(true);
    expect(f.riskScore).toBe(10);

    // G: the 25 000 boundary — INCLUSIVE tension edge.
    const g = p.get("stu-g")!;
    expect(g.riskCategory).toBe("financial_tension");
    expect(g.riskScore).toBe(10);

    // H: the 30-day boundary — the OR-branch fires the critical factor
    //    (+20) while the CATEGORY stays healthy (5 000 < 25 000).
    const h = p.get("stu-h")!;
    expect(h.riskCategory).toBe("healthy");
    expect(h.riskScore).toBe(20);
  });

  it("the DEFAULT_RISK_PROFILE_THRESHOLDS carry the exact pre-E4.5 literal values", () => {
    expect(DEFAULT_RISK_PROFILE_THRESHOLDS).toEqual({
      academicAlertGpa: 10,
      exemplaryGpa: 15,
      exemplaryAttendanceRate: 0.95,
      unexcusedAbsenceAlert: 3,
      attendanceRateAlert: 0.85,
      financialTensionDzd: 25_000,
      criticalDebtDzd: 30_000,
      criticalDaysOverdue: 30,
    });
  });
});

describe("E4.5 — the parameterization contract (the settings-sourced interface T-596 rides)", () => {
  it("configured thresholds MOVE the classifications (RED control)", () => {
    // With the alert GPA at 7, student A (GPA 8) is no longer an alert.
    const relaxed = profilesByStudent({
      ...DEFAULT_RISK_PROFILE_THRESHOLDS,
      academicAlertGpa: 7,
    });
    expect(relaxed.get("stu-a")!.riskCategory).toBe("healthy");
    expect(relaxed.get("stu-a")!.isPassing).toBe(true);

    // With the tension edge at 30 000, student C (26 000) drops to healthy
    // and the 25 000-boundary student G too.
    const tightened = profilesByStudent({
      ...DEFAULT_RISK_PROFILE_THRESHOLDS,
      financialTensionDzd: 30_000,
    });
    expect(tightened.get("stu-c")!.riskCategory).toBe("healthy");
    expect(tightened.get("stu-g")!.riskCategory).toBe("healthy");

    // With the absence alert at 5, student B (1 unexcused, rate 0.75)
    // keeps the alert ONLY through the rate branch; D (4 unexcused) loses
    // the absence factor (12 pts) from its score.
    const absenceRelaxed = profilesByStudent({
      ...DEFAULT_RISK_PROFILE_THRESHOLDS,
      unexcusedAbsenceAlert: 5,
    });
    expect(absenceRelaxed.get("stu-b")!.riskCategory).toBe("attendance_alert");
    expect(absenceRelaxed.get("stu-d")!.riskScore).toBe(85); // 97 − 12
  });

  it("the operational presets consume the configured thresholds (academic/absenteeism/exemplary)", () => {
    const profiles = [...profilesByStudent().values()];
    const pick = (id: string, presets: ReturnType<typeof operationalPresetsFor>) => {
      const preset = presets.find((x) => x.id === id)!;
      return profiles.filter((p) => preset.customFilter!(p)).map((p) => p.studentId);
    };

    // DEFAULT: academic_drop = GPA < 10 → A (8) + D (5).
    expect(pick("academic_drop", operationalPresetsFor(40_000))).toEqual(["stu-a", "stu-d"]);
    // Relaxed to 6: only D (5).
    expect(
      pick(
        "academic_drop",
        operationalPresetsFor(40_000, {
          ...DEFAULT_RISK_PROFILE_THRESHOLDS,
          academicAlertGpa: 6,
        }),
      ),
    ).toEqual(["stu-d"]);

    // DEFAULT: chronic_absenteeism = ≥3 unexcused OR rate < 0.85 → B + D.
    expect(pick("chronic_absenteeism", operationalPresetsFor(40_000))).toEqual(["stu-b", "stu-d"]);
    // Rate alert at 0.4: B (0.75) drops? No — 0.75 ≥ 0.4 and 1 < 3 → drops.
    expect(
      pick(
        "chronic_absenteeism",
        operationalPresetsFor(40_000, {
          ...DEFAULT_RISK_PROFILE_THRESHOLDS,
          attendanceRateAlert: 0.4,
        }),
      ),
    ).toEqual(["stu-d"]);

    // DEFAULT: high_performers = GPA ≥ 15 AND rate ≥ 0.95 AND zero debt →
    // nobody in the fixture (best GPA is 14).
    expect(pick("high_performers", operationalPresetsFor(40_000))).toEqual([]);
    // Exemplary GPA at 13 → C (14, clean attendance, debt ≠ 0 → NO) and
    // E (14, full attendance, no debt → YES) and F (10 → no) — only E.
    expect(
      pick(
        "high_performers",
        operationalPresetsFor(40_000, {
          ...DEFAULT_RISK_PROFILE_THRESHOLDS,
          exemplaryGpa: 13,
        }),
      ),
    ).toEqual(["stu-e"]);

    // The severe-debt preset keeps its own parameter (T-502's lane).
    expect(pick("severe_debt", operationalPresetsFor(40_000))).toEqual(["stu-d"]);
    expect(pick("severe_debt", operationalPresetsFor(26_000))).toEqual(["stu-c", "stu-d"]);
  });
});

describe("E4.5 — the source guards: the ONE home of the edges", () => {
  it("the engine carries no classification literals and consumes the domain module", () => {
    const engine = readModule("features/dashboard/components/analytics/operational-query-engine.ts");
    expect(engine).toContain('from "../../../../domain/calc/analytics/risk-thresholds"');
    expect(engine).toContain("DEFAULT_RISK_PROFILE_THRESHOLDS");
    // The registered offenders are dead as literals.
    expect(engine).not.toContain(">= 30_000");
    expect(engine).not.toContain(">= 25_000");
    expect(engine).not.toContain(">= 30)");
    expect(engine).not.toContain("gpa < 10");
    expect(engine).not.toContain(">= 0.95");
  });

  it("the domain module documents the defaults as the pre-E4.5 values", () => {
    const domain = readModule("domain/calc/analytics/risk-thresholds.ts");
    expect(domain).toContain("export interface RiskProfileThresholds");
    expect(domain).toContain("export const DEFAULT_RISK_PROFILE_THRESHOLDS");
    expect(domain).toContain("financialTensionDzd: 25_000");
    expect(domain).toContain("criticalDebtDzd: 30_000");
    expect(domain).toContain("criticalDaysOverdue: 30");
  });
});
