/**
 * MockReEnrollmentRepository — T-437 (migration 0128 / ADR-031) — the mock
 * twin of `SupabaseReEnrollmentRepository`, built on the SAME store the
 * other mock repositories use (mock/production parity, pinned by the
 * t-437 repository suite).
 *
 * The mock implements the SAME contract semantics as the 0128 RPCs:
 *  - candidates from the ACTIVE roster + the FINALIZED at-school histories
 *    (INV-22 — the mock reads the students' embedded `academicHistory`,
 *    never recomputing results);
 *  - the (student, target year) uniqueness + idempotent regeneration
 *    (waiting rows refresh their snapshot; decided rows are frozen facts);
 *  - the decision state machine + the freeze guards (INV-23);
 *  - the composite re-enrollment: the placement update on the EXISTING
 *    student + the client-derived billing legs (INV-25).
 */
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import type {
  GenerateCandidatesResult,
  ReEnrollmentCandidate,
  ReEnrollmentDecisionInput,
  ReEnrollmentList,
  ReEnrollStudentInput,
  ReEnrollStudentResult,
} from "../../../domain/model/re-enrollment";
import {
  reEnrollmentListFromCandidates,
  type ReEnrollmentStatus,
} from "../../../domain/model/re-enrollment";
import type { ReEnrollmentRepository } from "../../../domain/repository/academic-repository";
import type { AcademicLevel, GradeLevel } from "../../../domain/model/student";
import { GRADE_LEVELS } from "../../../domain/model/student";
import { getNextGradeProgression } from "../../../domain/calc/academics/promotion";
import { store, appendAudit, nowIso } from "./mock-store";

/** The mock store's re-enrollment rows (the singleton session state). */
interface MockReEnrollmentRow {
  reEnrollmentId: string;
  studentId: string;
  sourceAcademicYearId: string;
  targetAcademicYearId: string;
  sourceGradeLevelCode: string | null;
  sourceClassId: string | null;
  sourceClassName: string | null;
  finalDecision: ReEnrollmentCandidate["finalDecision"];
  finalAverage: number | null;
  expectedGradeLevelCode: string | null;
  status: ReEnrollmentStatus;
  targetClassId: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
  reEnrolledAt: string | null;
  installmentsWritten: number | null;
  notes: string | null;
  frozenAt: string | null;
  createdAt: string;
}

/** One shared in-memory collection per mock session (the mock-store pattern). */
const rows: MockReEnrollmentRow[] = [];

export function resetMockReEnrollments(): void {
  rows.length = 0;
}

export class MockReEnrollmentRepository implements ReEnrollmentRepository {
  async generateCandidates(input: {
    sourceAcademicYearId: string;
    targetAcademicYearId: string;
    performedBy: string;
    performedByName: string;
  }): Promise<Result<GenerateCandidatesResult>> {
    const source = store.academicYears.find((y) => y.id === input.sourceAcademicYearId);
    const target = store.academicYears.find((y) => y.id === input.targetAcademicYearId);
    if (!source || !target) {
      return Err(Errors.validation("L'année source et l'année cible doivent exister."));
    }
    if (source.id === target.id) {
      return Err(Errors.validation("L'année cible doit différer de l'année source."));
    }
    // The freeze guard (INV-23b): a frozen list is FINAL.
    if (rows.some((r) => r.targetAcademicYearId === target.id && r.frozenAt)) {
      return Err(
        Errors.validation(
          `La liste ${target.code} est FIGÉE — aucune génération possible.`,
        ),
      );
    }

    let written = 0;
    for (const student of store.students) {
      if (student.status !== "active") continue; // the domain StudentStatus (the DB-only 'enrolled' value maps to active on read)
      // INV-22a: the FINALIZED source-year result from the at-school history
      // (the promotion flow's writer — never recomputed here).
      const hist = (student.academicHistory ?? []).find(
        (h) => h.academicYear === source.code,
      );
      const existing = rows.find(
        (r) => r.studentId === student.id && r.targetAcademicYearId === target.id,
      );
      // INV-22c: expected level — promoted → the CURRENT grade (the mock
      // promotion advances it), repeated → the source grade, no history →
      // the canonical progression.
      const expected =
        hist?.decision === "repeated"
          ? (hist.gradeCode as GradeLevel)
          : hist
            ? student.gradeLevel
            : getNextGradeProgression(student.gradeLevel).nextGradeCode;
      const snapshot = {
        sourceGradeLevelCode: hist?.gradeCode ?? student.gradeLevel,
        sourceClassId: student.classId,
        sourceClassName:
          store.classes.find((c) => c.id === student.classId)?.name ?? null,
        finalDecision: hist?.decision ?? null,
        finalAverage: hist?.gpa ?? null,
        expectedGradeLevelCode: expected,
      };
      if (existing) {
        // Idempotent regeneration: refresh ONLY the waiting rows' snapshot.
        if (existing.status === "waiting") {
          Object.assign(existing, snapshot);
          written += 1;
        }
        continue;
      }
      rows.push({
        reEnrollmentId: `re-${student.id}-${target.id}`,
        studentId: student.id,
        sourceAcademicYearId: source.id,
        targetAcademicYearId: target.id,
        ...snapshot,
        status: "waiting",
        targetClassId: null,
        decidedAt: null,
        decidedByName: null,
        reEnrolledAt: null,
        installmentsWritten: null,
        notes: null,
        frozenAt: null,
        createdAt: nowIso(),
      });
      written += 1;
    }

    appendAudit({
      action: "re_enrollment.candidates_generated",
      entityType: "re_enrollment",
      entityId: "—",
      actorId: input.performedBy || "usr-current",
      actorName: input.performedByName || "Session courante",
      diff: {
        before: null,
        after: { source: source.code, target: target.code, written },
      },
      note: `Candidats de réinscription générés pour ${source.code} → ${target.code}`,
    });

    return Ok({
      sourceAcademicYear: source.code,
      targetAcademicYear: target.code,
      candidatesWritten: written,
      totalRows: rows.filter((r) => r.targetAcademicYearId === target.id).length,
    });
  }

  async listCandidates(targetAcademicYearId: string): Promise<Result<ReEnrollmentList>> {
    const target = store.academicYears.find((y) => y.id === targetAcademicYearId);
    const sourceById = new Map(store.academicYears.map((y) => [y.id, y.code]));
    const candidates: ReEnrollmentCandidate[] = [];
    for (const r of rows) {
      if (r.targetAcademicYearId !== targetAcademicYearId) continue;
      const student = store.students.find((s) => s.id === r.studentId);
      const parent = student ? store.parents.find((p) => p.id === student.parentId) : undefined;
      if (!student || !parent) continue; // the live join drops orphaned rows
      const targetClassName =
        store.classes.find((c) => c.id === r.targetClassId)?.name ?? null;
      candidates.push({
        reEnrollmentId: r.reEnrollmentId,
        studentId: student.id,
        studentCode: student.code,
        studentFirstName: student.firstName,
        studentLastName: student.lastName,
        studentGradeLevel: student.gradeLevel,
        studentClassId: student.classId,
        parentId: parent.id,
        parentCode: parent.code,
        parentDisplayName:
          parent.displayName ?? `${parent.firstName} ${parent.lastName}`.trim(),
        parentPhone: parent.phone,
        sourceAcademicYear: sourceById.get(r.sourceAcademicYearId) ?? "",
        targetAcademicYear: target?.code ?? "",
        sourceGradeLevelCode: r.sourceGradeLevelCode,
        sourceClassName: r.sourceClassName,
        finalDecision: r.finalDecision,
        finalAverage: r.finalAverage,
        expectedGradeLevelCode: r.expectedGradeLevelCode,
        status: r.status,
        targetClassId: r.targetClassId,
        targetClassName,
        decidedAt: r.decidedAt,
        decidedByName: r.decidedByName,
        reEnrolledAt: r.reEnrolledAt,
        installmentsWritten: r.installmentsWritten,
        notes: r.notes,
        frozenAt: r.frozenAt,
        createdAt: r.createdAt,
      });
    }
    // The waiting-first ordering (the 0128 worklist convention).
    candidates.sort((a, b) => {
      const rank = (s: ReEnrollmentStatus) => (s === "waiting" ? 0 : 1);
      return (
        rank(a.status) - rank(b.status) ||
        a.studentLastName.localeCompare(b.studentLastName, "fr")
      );
    });
    return Ok(reEnrollmentListFromCandidates(candidates));
  }

  async setDecision(input: {
    reEnrollmentId: string;
    decision: ReEnrollmentDecisionInput;
    notes: string | null;
    performedBy: string;
    performedByName: string;
  }): Promise<Result<void>> {
    const row = rows.find((r) => r.reEnrollmentId === input.reEnrollmentId);
    if (!row) return Err(Errors.notFound("ReEnrollment", input.reEnrollmentId));
    if (row.frozenAt) {
      return Err(
        Errors.validation("La liste est FIGÉE — aucune modification possible."),
      );
    }
    if (row.status === "re_enrolled") {
      return Err(
        Errors.validation("L'élève est déjà réinscrit — décision terminale."),
      );
    }
    const before = row.status;
    row.status = input.decision;
    row.decidedAt = input.decision === "waiting" ? null : nowIso();
    row.decidedByName = input.decision === "waiting" ? null : input.performedByName;
    if (input.notes) row.notes = input.notes;
    appendAudit({
      action: "re_enrollment.decision",
      entityType: "re_enrollment",
      entityId: row.reEnrollmentId,
      actorId: input.performedBy || "usr-current",
      actorName: input.performedByName || "Session courante",
      diff: { before: { status: before }, after: { status: input.decision } },
    });
    return Ok(undefined);
  }

  async reEnroll(input: ReEnrollStudentInput): Promise<Result<ReEnrollStudentResult>> {
    const row = rows.find((r) => r.reEnrollmentId === input.reEnrollmentId);
    if (!row) return Err(Errors.notFound("ReEnrollment", input.reEnrollmentId));
    if (row.frozenAt) {
      return Err(
        Errors.validation("La liste est FIGÉE — aucune réinscription possible."),
      );
    }
    if (row.status !== "waiting" && row.status !== "started") {
      return Err(Errors.validation(`Statut « ${row.status} » non réinscriptible.`));
    }
    const idx = store.students.findIndex((s) => s.id === row.studentId);
    if (idx < 0) return Err(Errors.notFound("Student", row.studentId));
    const student = store.students[idx];
    const target = store.academicYears.find((y) => y.id === row.targetAcademicYearId);
    if (!target) return Err(Errors.notFound("AcademicYear", row.targetAcademicYearId));

    // Snapshot for rollback (the mock's atomicity convention).
    const studentsSnapshot = [...store.students];
    const installmentsSnapshot = [...store.installments];
    const ledgerSnapshot = [...store.ledger];
    try {
      // INV-21a/21c: the EXISTING student row — placement only; identity,
      // parent, histories untouched.
      store.students[idx] = {
        ...student,
        gradeLevel: input.gradeLevelCode,
        level: academicLevelFromGrade(input.gradeLevelCode),
        classId: input.classId,
        paymentPlan: input.paymentPlan,
        transportTier: input.transportTier ?? student.transportTier,
        status: "active",
        updatedAt: nowIso(),
      };
      store.notifyStudents();

      // INV-25c: the billing legs stamped with the target year id.
      const stamped = input.installments.map((i) => ({
        ...i,
        academicYearId: target.id,
      })) as unknown as import("../../../domain/model/payment").Installment[];
      if (stamped.length > 0) {
        store.installments = [...stamped, ...store.installments];
        store.notifyInstallments();
      }
      const ledgerEntries = input.ledgerEntries as unknown as import(
        "../../../domain/model/ledger"
      ).LedgerEntry[];
      if (ledgerEntries.length > 0) {
        store.ledger = [...store.ledger, ...ledgerEntries];
        store.notifyLedger();
      }

      row.status = "re_enrolled";
      row.targetClassId = input.classId;
      row.decidedAt = nowIso();
      row.decidedByName = "Session courante";
      row.reEnrolledAt = nowIso();
      row.installmentsWritten = stamped.length;

      appendAudit({
        action: "student.re_enrolled",
        entityType: "student",
        entityId: student.id,
        actorId: "usr-current",
        actorName: "Session courante",
        diff: {
          before: { gradeLevel: student.gradeLevel, classId: student.classId },
          after: {
            targetAcademicYear: target.code,
            gradeLevel: input.gradeLevelCode,
            classId: input.classId,
            installmentsWritten: stamped.length,
          },
        },
        note: `Réinscription ${target.code} : ${student.firstName} ${student.lastName}`,
      });

      return Ok({
        reEnrollmentId: row.reEnrollmentId,
        studentId: student.id,
        studentCode: student.code,
        targetAcademicYear: target.code,
        installmentsWritten: stamped.length,
        ledgerWritten: ledgerEntries.length,
      });
    } catch (e) {
      store.students = studentsSnapshot;
      store.installments = installmentsSnapshot;
      store.ledger = ledgerSnapshot;
      store.notifyStudents();
      store.notifyInstallments();
      store.notifyLedger();
      return Err(Errors.unknown(e as Error));
    }
  }

  async freeze(
    targetAcademicYearId: string,
    performedBy: string,
    performedByName: string,
  ): Promise<Result<{ frozenCount: number }>> {
    const targetRows = rows.filter((r) => r.targetAcademicYearId === targetAcademicYearId);
    if (targetRows.length === 0) {
      return Err(Errors.validation("Aucun candidat généré pour cette année."));
    }
    if (targetRows.some((r) => r.frozenAt)) {
      return Err(Errors.validation("La liste est DÉJÀ figée."));
    }
    const waiting = targetRows.filter((r) => r.status === "waiting").length;
    if (waiting > 0) {
      return Err(
        Errors.validation(
          `${waiting} candidat(s) en attente de décision — décidez chaque élève avant de figer.`,
        ),
      );
    }
    const frozenAt = nowIso();
    for (const r of targetRows) r.frozenAt = frozenAt;
    appendAudit({
      action: "re_enrollment.frozen",
      entityType: "re_enrollment",
      entityId: "—",
      actorId: performedBy || "usr-current",
      actorName: performedByName || "Session courante",
      diff: { before: null, after: { total: targetRows.length } },
      note: `Liste de réinscription FIGÉE (${targetRows.length} candidat(s))`,
    });
    return Ok({ frozenCount: targetRows.length });
  }
}

/** The mock's grade-code → AcademicLevel derivation (mock parity helper). */
function academicLevelFromGrade(grade: GradeLevel): AcademicLevel {
  if (grade.startsWith("prescolaire")) return "primaire";
  if (grade.endsWith("ap")) return "primaire";
  if (grade.endsWith("am")) return "cem";
  return "lycee";
}

export const mockReEnrollmentRepository = new MockReEnrollmentRepository();

// Re-export for the provider wiring (the GRADE_LEVELS import keeps the
// model's canonical level list referenced — the mock validates grades
// against it in future extensions).
export const MOCK_GRADE_LEVELS = GRADE_LEVELS;
