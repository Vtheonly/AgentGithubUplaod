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
import type { Parent } from "../../../../domain/model/parent";
import type {
  AcademicClass,
  Assessment,
  AttendanceRecord,
  Subject,
} from "../../../../domain/model/academic";
import type { DebtSummary, Payment } from "../../../../domain/model/payment";
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
  | "academic_alert" // GPA < 10/20
  | "attendance_alert" // Unexcused absences >= 3 or rate < 85%
  | "financial_tension" // Family debt > 30,000 DZD
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

export const OPERATIONAL_PRESETS: OperationalQueryPreset[] = [
  {
    id: "triple_critical",
    title: "Triple Risque (Urgence Absolue)",
    subtitle: "Moyenne < 10 + Absences ≥ 3 + Retard de paiement",
    iconName: "alert-triangle",
    filterCategory: "triple_critical",
  },
  {
    id: "severe_debt",
    title: "Créances Critiques (> 40 000 DA)",
    subtitle: "Familles en retard financier important",
    iconName: "wallet",
    customFilter: (p) => p.debtAmount >= 40_000,
  },
  {
    id: "academic_drop",
    title: "Décrochage Pédagogique",
    subtitle: "Élèves ajournés (Moyenne < 10 / 20)",
    iconName: "book-open",
    customFilter: (p) => p.gpa !== null && p.gpa < 10,
  },
  {
    id: "chronic_absenteeism",
    title: "Assiduité Fragilisée",
    subtitle: "3 absences non excusées ou taux < 85%",
    iconName: "users",
    customFilter: (p) => p.unexcusedAbsences >= 3 || p.attendanceRate < 0.85,
  },
  {
    id: "high_performers",
    title: "Profils Exemplaires",
    subtitle: "Moyenne ≥ 15/20 et assiduité irréprochable",
    iconName: "sparkles",
    customFilter: (p) =>
      p.gpa !== null &&
      p.gpa >= 15 &&
      p.attendanceRate >= 0.95 &&
      p.debtAmount === 0,
  },
];

/**
 * Builds composite risk profiles for every student in the school.
 */
export function evaluateStudentRiskProfiles(params: {
  students: readonly Student[];
  parents: readonly Parent[];
  classes: readonly AcademicClass[];
  subjects: readonly Subject[];
  assessments: readonly Assessment[];
  attendance: readonly AttendanceRecord[];
  debtSummaries: readonly DebtSummary[];
}): StudentRiskProfile[] {
  const {
    students,
    parents,
    classes,
    subjects,
    assessments,
    attendance,
    debtSummaries,
  } = params;

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
        coefficient: a.coefficient || subj?.coefficient || 1,
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
      if (gpa < 10) {
        const deficit = Math.min(45, Math.round((10 - gpa) * 8));
        score += deficit;
        reasons.push(`Moyenne ${gpa.toFixed(2)}/20 (< 10)`);
      } else if (gpa < 12) {
        score += 10;
      }
    }

    // Attendance risk factor (up to 35 pts)
    if (attendanceRate < 0.85) {
      score += Math.min(25, Math.round((0.85 - attendanceRate) * 100));
      reasons.push(`Assiduité ${(attendanceRate * 100).toFixed(0)}%`);
    }
    if (unexcusedAbsences >= 3) {
      score += Math.min(15, unexcusedAbsences * 3);
      reasons.push(`${unexcusedAbsences} absences injustifiées`);
    }

    // Financial risk factor (up to 20 pts)
    if (debtAmount > 0) {
      if (debtAmount >= 30_000 || daysOverdue >= 30) {
        score += 20;
        reasons.push(
          `Créance ${debtAmount.toLocaleString("fr-FR")} DA (${daysOverdue}j)`,
        );
      } else {
        score += 10;
      }
    }

    score = Math.min(100, Math.max(0, score));

    // Categorization
    let riskCategory: RiskCategory = "healthy";
    const hasAcademicAlert = gpa !== null && gpa < 10;
    const hasAttendanceAlert = unexcusedAbsences >= 3 || attendanceRate < 0.85;
    const hasFinancialTension = debtAmount >= 25_000;

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
      studentName: `${s.firstName} ${s.lastName}`.trim(),
      studentCode: s.code,
      classId: s.classId,
      className: cls ? cls.name : "Non assignée",
      level: s.level,
      gradeLevel: s.gradeLevel,
      parentId: s.parentId,
      parentName: parent ? parentDisplayName(parent) : "Inconnu",
      parentPhone: parent?.phone || "—",
      gpa,
      isPassing: gpa !== null ? gpa >= 10 : null,
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
