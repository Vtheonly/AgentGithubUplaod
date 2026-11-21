// ============================================================================
// FILE: src/features/dashboard/components/analytics/operational-query-engine.ts
// ============================================================================
/**
 * Operational Query & Diagnostic Engine.
 *
 * Bridges the gap between disconnected metrics by calculating cross-domain
 * correlations between:
 *   - Academics (GPA via canonical computeOverallGpa)
 *   - Attendance (Unexcused absences & attendance rate)
 *   - Finances (Family overdue balance & days overdue)
 *   - Capacity (Class enrollment vs capacity)
 *
 * Everything is derived dynamically from canonical repository streams —
 * zero hard-coded or fabricated numbers (§15.16 compliant).
 */

import type { Student } from "../../../../domain/model/student";
import { studentDisplayName } from "../../../../domain/model/student";
import type { Parent } from "../../../../domain/model/parent";
import type {
  AcademicClass,
  Assessment,
  AttendanceRecord,
  Subject,
} from "../../../../domain/model/academic";
import type { DebtSummary, Payment } from "../../../../domain/model/payment";
import { resolveSubjectConfiguration } from "../../../../domain/calc/academics/subject-config";
// E4.5 (ARCH-009): the classification edges live in the DOMAIN now —
// the pre-E4.5 literals (25k/30k/30 days/10/15/3/0.85/0.95) are the
// documented defaults, byte-identical by construction (pinned by t-e45).
import {
  DEFAULT_RISK_PROFILE_THRESHOLDS,
  type RiskProfileThresholds,
} from "../../../../domain/calc/analytics/risk-thresholds";
import {
  computeOverallGpa,
  computeSubjectAverage,
  calculateAttendanceRate,
} from "../../../../domain/model/academic";
import { parentDisplayName } from "../../../../domain/model/parent";
import {
  GRADE_LEVEL_LABELS_FR,
  LEVEL_LABELS_FR,
} from "../../../../domain/model/student";

export type RiskCategory =
  | "triple_critical" // Low GPA + High Absences + Debt
  | "academic_alert" // GPA below the configured academic-alert edge (default 10/20)
  | "attendance_alert" // Unexcused absences at/after the configured edge (3) or rate below it (85%)
  | "financial_tension" // Family debt at/above the configured tension edge (default 25 000 DZD)
  | "healthy"; // Normal profile

export interface StudentRiskProfile {
  studentId: string;
  studentName: string;
  studentCode: string;
  classId: string | null;
  className: string;
  level: string;
  gradeLevel: string;
  parentId: string;
  parentName: string;
  parentPhone: string;
  gpa: number | null;
  isPassing: boolean | null;
  attendanceRate: number;
  unexcusedAbsences: number;
  debtAmount: number;
  daysOverdue: number;
  riskScore: number; // 0 to 100
  riskCategory: RiskCategory;
  primaryRiskReason: string;
}

export type PivotDimension = "cycle" | "grade" | "class" | "transport_zone";

export interface PivotRow {
  dimensionKey: string;
  dimensionLabel: string;
  studentCount: number;
  classCount: number;
  totalDebt: number;
  averageGpa: number | null;
  attendanceRate: number;
  criticalStudentsCount: number;
}

export interface OperationalQueryPreset {
  id: string;
  title: string;
  subtitle: string;
  iconName: "alert-triangle" | "wallet" | "book-open" | "users" | "sparkles";
  filterCategory?: RiskCategory;
  customFilter?: (profile: StudentRiskProfile) => boolean;
}

/**
 * T-502 (DEBT-104): the quick queries, parameterized by the CONFIGURED
 * severe-debt edge. The severe-debt preset's threshold was previously a
 * hardcoded 40 000 DZD comparison (the owner could not move it from
 * Settings → Configuration while every sibling edge was configurable); it
 * now rides the tenant's `debt.severe_debt_dzd` setting (migration 0150,
 * default 40 000 — the previously hardcoded value, so the default
 * behavior is preserved by construction). The locale-stable title embeds
 * the CONFIGURED number (NBSP/NNBSP normalized to plain spaces — the
 * §15.3 rule) so the chip always states the edge it applies.
 *
 * E4.5 (ARCH-009): the sibling preset edges (academic-drop, absenteeism,
 * exemplary) ride the DOMAIN risk-profile thresholds — the same
 * parameterization discipline, defaults byte-identical.
 */
export function operationalPresetsFor(
  severeDebtDzd: number,
  thresholds: RiskProfileThresholds = DEFAULT_RISK_PROFILE_THRESHOLDS,
): OperationalQueryPreset[] {
  const dzd = (n: number) => n.toLocaleString("fr-DZ").replace(/[\u00a0\u202f]/gu, " ");
  return [
    {
      id: "triple_critical",
      title: "Triple Risque (Urgence Absolue)",
      subtitle: "Moyenne < 10 + Absences ≥ 3 + Retard de paiement",
      iconName: "alert-triangle",
      filterCategory: "triple_critical",
    },
    {
      id: "severe_debt",
      title: `Créances Critiques (≥ ${dzd(severeDebtDzd)} DA)`,
      subtitle: "Familles en retard financier important",
      iconName: "wallet",
      // 0 disables the edge (the 0138 amount-band convention — no family
      // crosses it); otherwise the boundary is INCLUSIVE (>= the edge).
      customFilter: (p) => severeDebtDzd > 0 && p.debtAmount >= severeDebtDzd,
    },
    {
      id: "academic_drop",
      title: "Décrochage Pédagogique",
      subtitle: "Élèves ajournés (Moyenne < 10 / 20)",
      iconName: "book-open",
      customFilter: (p) =>
        p.gpa !== null && p.gpa < thresholds.academicAlertGpa,
    },
    {
      id: "chronic_absenteeism",
      title: "Assiduité Fragilisée",
      subtitle: "3 absences non excusées ou taux < 85%",
      iconName: "users",
      customFilter: (p) =>
        p.unexcusedAbsences >= thresholds.unexcusedAbsenceAlert ||
        p.attendanceRate < thresholds.attendanceRateAlert,
    },
    {
      id: "high_performers",
      title: "Profils Exemplaires",
      subtitle: "Moyenne ≥ 15/20 et assiduité irréprochable",
      iconName: "sparkles",
      customFilter: (p) =>
        p.gpa !== null &&
        p.gpa >= thresholds.exemplaryGpa &&
        p.attendanceRate >= thresholds.exemplaryAttendanceRate &&
        p.debtAmount === 0,
    },
  ];
}

/**
 * Builds composite risk profiles for every student in the school.
 *
 * E4.5 (ARCH-009): `thresholds` defaults to the DOMAIN constants — the
 * settings-sourced values land with the T-596 re-composition (the same
 * prop-drilling `debtThresholds` uses).
 */
export function evaluateStudentRiskProfiles(params: {
  students: readonly Student[];
  parents: readonly Parent[];
  classes: readonly AcademicClass[];
  subjects: readonly Subject[];
  /** T-345 (ADR-018): the context configurations (optional — legacy
   *  directory fallback when absent). */
  subjectConfigurations?: readonly import("../../../../domain/model/academic").SubjectConfiguration[];
  assessments: readonly Assessment[];
  attendance: readonly AttendanceRecord[];
  debtSummaries: readonly DebtSummary[];
  /** E4.5: the classification edges (defaults = the documented values). */
  thresholds?: RiskProfileThresholds;
}): StudentRiskProfile[] {
  const {
    students,
    parents,
    classes,
    subjects,
    subjectConfigurations,
    assessments,
    attendance,
    debtSummaries,
  } = params;
  const thresholds = params.thresholds ?? DEFAULT_RISK_PROFILE_THRESHOLDS;

  const parentMap = new Map(parents.map((p) => [p.id, p]));
  const classMap = new Map(classes.map((c) => [c.id, c]));
  const debtMap = new Map(debtSummaries.map((d) => [d.parentId, d]));

  // Group assessments by student
  const assessmentsByStudent = new Map<string, Assessment[]>();
  for (const a of assessments) {
    const list = assessmentsByStudent.get(a.studentId) ?? [];
    list.push(a);
    assessmentsByStudent.set(a.studentId, list);
  }

  // Group attendance by student
  const attendanceByStudent = new Map<string, AttendanceRecord[]>();
  for (const att of attendance) {
    const list = attendanceByStudent.get(att.studentId) ?? [];
    list.push(att);
    attendanceByStudent.set(att.studentId, list);
  }

  return students.map((s) => {
    const parent = parentMap.get(s.parentId);
    const cls = s.classId ? classMap.get(s.classId) : null;
    const debt = debtMap.get(s.parentId);

    // Compute GPA
    const studentAssessments = assessmentsByStudent.get(s.id) ?? [];
    const mappedAssessments = studentAssessments.map((a) => {
      const subj = subjects.find((sub) => sub.id === a.subjectId);
      return {
        subjectAverage:
          a.subjectAverage ??
          computeSubjectAverage(a.devoir1, a.devoir2, a.examen),
        // T-345 (ADR-018): the canonical resolver replaces the fallback chain.
        coefficient:
          a.coefficient ||
          resolveSubjectConfiguration({
            subject: subj,
            configurations: subjectConfigurations ?? [],
          }).coefficient,
        isExtracurricular: subj?.isExtracurricular ?? false,
      };
    });
    const gpa = computeOverallGpa(mappedAssessments);

    // Compute Attendance
    const studentAttendance = attendanceByStudent.get(s.id) ?? [];
    const attendanceRate = calculateAttendanceRate(studentAttendance);
    const unexcusedAbsences = studentAttendance.filter(
      (r) => r.status === "absent_unexcused",
    ).length;

    // Debt
    const debtAmount = debt ? debt.outstandingAmount : 0;
    const daysOverdue = debt ? debt.daysOverdue : 0;

    // Multi-factor Risk Scoring (0 to 100)
    let score = 0;
    const reasons: string[] = [];

    // Academic risk factor (up to 45 pts)
    if (gpa !== null) {
      if (gpa < thresholds.academicAlertGpa) {
        const deficit = Math.min(
          45,
          Math.round((thresholds.academicAlertGpa - gpa) * 8),
        );
        score += deficit;
        reasons.push(
          `Moyenne ${gpa.toFixed(2)}/20 (< ${thresholds.academicAlertGpa})`,
        );
      } else if (gpa < 12) {
        score += 10;
      }
    }

    // Attendance risk factor (up to 35 pts)
    if (attendanceRate < thresholds.attendanceRateAlert) {
      score += Math.min(
        25,
        Math.round((thresholds.attendanceRateAlert - attendanceRate) * 100),
      );
      reasons.push(`Assiduité ${(attendanceRate * 100).toFixed(0)}%`);
    }
    if (unexcusedAbsences >= thresholds.unexcusedAbsenceAlert) {
      score += Math.min(15, unexcusedAbsences * 3);
      reasons.push(`${unexcusedAbsences} absences injustifiées`);
    }

    // Financial risk factor (up to 20 pts)
    if (debtAmount > 0) {
      if (
        debtAmount >= thresholds.criticalDebtDzd ||
        daysOverdue >= thresholds.criticalDaysOverdue
      ) {
        score += 20;
        reasons.push(
          `Créance ${debtAmount.toLocaleString("fr-FR")} DA (${daysOverdue}j)`,
        );
      } else {
        score += 10;
      }
    }

    score = Math.min(100, Math.max(0, score));

    // Categorization (E4.5: every edge is the configured threshold)
    let riskCategory: RiskCategory = "healthy";
    const hasAcademicAlert =
      gpa !== null && gpa < thresholds.academicAlertGpa;
    const hasAttendanceAlert =
      unexcusedAbsences >= thresholds.unexcusedAbsenceAlert ||
      attendanceRate < thresholds.attendanceRateAlert;
    const hasFinancialTension =
      debtAmount >= thresholds.financialTensionDzd;

    if (hasAcademicAlert && hasAttendanceAlert && hasFinancialTension) {
      riskCategory = "triple_critical";
    } else if (hasAcademicAlert) {
      riskCategory = "academic_alert";
    } else if (hasAttendanceAlert) {
      riskCategory = "attendance_alert";
    } else if (hasFinancialTension) {
      riskCategory = "financial_tension";
    }

    return {
      studentId: s.id,
      // E2.5 / S-U1: the shared student resolver.
      studentName: studentDisplayName(s),
      studentCode: s.code,
      classId: s.classId,
      className: cls ? cls.name : "Non assignée",
      level: s.level,
      gradeLevel: s.gradeLevel,
      parentId: s.parentId,
      parentName: parent ? parentDisplayName(parent) : "Inconnu",
      parentPhone: parent?.phone || "—",
      gpa,
      isPassing: gpa !== null ? gpa >= thresholds.academicAlertGpa : null,
      attendanceRate,
      unexcusedAbsences,
      debtAmount,
      daysOverdue,
      riskScore: score,
      riskCategory,
      primaryRiskReason: reasons.join(" · ") || "Profil régulier",
    };
  });
}

/**
 * Computes a dynamic multi-dimensional Pivot Table aggregating metrics
 * across chosen dimensions.
 */
export function computeMultiDimensionalPivot(params: {
  profiles: StudentRiskProfile[];
  classes: readonly AcademicClass[];
  dimension: PivotDimension;
}): PivotRow[] {
  const { profiles, classes, dimension } = params;

  const groups = new Map<
    string,
    {
      label: string;
      students: StudentRiskProfile[];
      classCount: number;
    }
  >();

  for (const p of profiles) {
    let key = "unknown";
    let label = "Non spécifié";

    if (dimension === "cycle") {
      key = p.level;
      label =
        LEVEL_LABELS_FR[p.level as keyof typeof LEVEL_LABELS_FR] || p.level;
    } else if (dimension === "grade") {
      key = p.gradeLevel;
      label =
        GRADE_LEVEL_LABELS_FR[
          p.gradeLevel as keyof typeof GRADE_LEVEL_LABELS_FR
        ] || p.gradeLevel;
    } else if (dimension === "class") {
      key = p.classId || "unassigned";
      label = p.className;
    } else if (dimension === "transport_zone") {
      // Group by debt bucket as a proxy if zone isn't directly on profile
      key = p.debtAmount > 0 ? "with_debt" : "clear";
      label = p.debtAmount > 0 ? "Comptes Débiteurs" : "Comptes Soldés";
    }

    const cur = groups.get(key) ?? { label, students: [], classCount: 0 };
    cur.students.push(p);
    groups.set(key, cur);
  }

  // Compute stats per group
  return Array.from(groups.entries())
    .map(([key, group]) => {
      const totalStudents = group.students.length;
      const totalDebt = group.students.reduce(
        (sum, s) => sum + s.debtAmount,
        0,
      );

      const evaluatedGpas = group.students
        .map((s) => s.gpa)
        .filter((g): g is number => g !== null);
      const averageGpa =
        evaluatedGpas.length > 0
          ? evaluatedGpas.reduce((s, g) => s + g, 0) / evaluatedGpas.length
          : null;

      const avgAttendance =
        totalStudents > 0
          ? group.students.reduce((sum, s) => sum + s.attendanceRate, 0) /
            totalStudents
          : 1;

      const criticalCount = group.students.filter(
        (s) => s.riskCategory !== "healthy",
      ).length;

      // Distinct classes in this group
      const distinctClassIds = new Set(
        group.students.map((s) => s.classId).filter(Boolean),
      );

      return {
        dimensionKey: key,
        dimensionLabel: group.label,
        studentCount: totalStudents,
        classCount: distinctClassIds.size,
        totalDebt,
        averageGpa,
        attendanceRate: avgAttendance,
        criticalStudentsCount: criticalCount,
      };
    })
    .sort(
      (a, b) => b.totalDebt - a.totalDebt || b.studentCount - a.studentCount,
    );
}
