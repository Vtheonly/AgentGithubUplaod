import type { Result } from "../../core/result";
import type { Observable } from "./repository";
import type {
  AcademicClass,
  Subject,
  SubjectConfiguration,
  ClassSubject,
  Assessment,
  AttendanceRecord,
  AttendanceSession,
  AttendanceStatus,
  Homework,
  AcademicYear,
  AcademicLevelModel,
} from "../model/academic";
import type { Student, AcademicLevel, GradeLevel } from "../model/student";
import type { PromotionCandidate } from "../calc/academics/promotion";
import type {
  CreateSchoolYearInput,
  UpdateSchoolYearInput,
} from "../calc/academics/school-year";

/**
 * Academic Year repository — full lifecycle management (plan §05.05).
 *
 * Operations:
 *   - create / update / archive / restore / delete
 *   - set current year (only one current at a time)
 *
 * CRITICAL FINANCE ISOLATION:
 *   School year operations MUST NOT recalculate, modify, or otherwise touch
 *   financial records. The only finance-visible side effect of changing the
 *   current year is via the enrollment repository (tuition pricing reads the
 *   current year for default installment template) — and that is the
 *   enrollment repository's responsibility, not the school year repository's.
 */
export interface AcademicYearRepository {
  observeAll(): Observable<AcademicYear[]>;
  observeById(id: string): Observable<AcademicYear | null>;
  getCurrentYear(): Promise<Result<AcademicYear>>;
  getYearByCode(code: string): Promise<Result<AcademicYear | null>>;
  setCurrentYear(id: string, actorId: string, actorName: string): Promise<Result<AcademicYear>>;
  createAcademicYear(input: CreateSchoolYearInput, actorId: string, actorName: string): Promise<Result<AcademicYear>>;
  updateAcademicYear(id: string, input: UpdateSchoolYearInput, actorId: string, actorName: string): Promise<Result<AcademicYear>>;
  archiveAcademicYear(id: string, actorId: string, actorName: string): Promise<Result<AcademicYear>>;
  restoreAcademicYear(id: string, actorId: string, actorName: string): Promise<Result<AcademicYear>>;
  /**
   * Hard-delete a school year. Only allowed when:
   *   - It is not the current year
   *   - It has no classes (active or archived)
   *   - It has no students enrolled
   */
  deleteAcademicYear(id: string, actorId: string, actorName: string): Promise<Result<void>>;
}

export interface AcademicLevelRepository {
  observeAll(): Observable<AcademicLevelModel[]>;
  getByGradeCode(gradeCode: GradeLevel): Promise<Result<AcademicLevelModel | null>>;
}

export interface ClassRepository {
  observe(): Observable<AcademicClass[]>;
  observeByLevel(level: AcademicLevel): Observable<AcademicClass[]>;
  observeById(id: string): Observable<AcademicClass | null>;
  createClass(input: Omit<AcademicClass, "id" | "tenantId" | "enrolledCount" | "isActive">): Promise<Result<AcademicClass>>;
  updateClass(id: string, updates: Partial<AcademicClass>): Promise<Result<AcademicClass>>;
  deleteClass(id: string): Promise<Result<void>>;
}

export interface SubjectRepository {
  observe(): Observable<Subject[]>;
  observeByLevel(level: AcademicLevel): Observable<Subject[]>;
  observeByClass(classId: string): Observable<ClassSubject[]>;
  assignSubjectToClass(input: Omit<ClassSubject, "id">): Promise<Result<ClassSubject>>;
  removeSubjectFromClass(id: string): Promise<Result<void>>;
  createSubject(input: Omit<Subject, "id" | "tenantId">): Promise<Result<Subject>>;
  updateSubject(id: string, updates: Partial<Omit<Subject, "id" | "tenantId">>): Promise<Result<Subject>>;
  archiveSubject(id: string): Promise<Result<void>>;
  /**
   * T-345 (MATIERE-500 / ADR-018): the context-specific subject
   * configurations (subject × year × level × direction). The single
   * source every surface resolves coefficients/recipes through —
   * `resolveSubjectConfiguration` (domain/calc/academics/subject-config).
   */
  observeConfigurations(): Observable<SubjectConfiguration[]>;
  /**
   * Create or update ONE configuration row. Coefficient changes are
   * NON-RETROACTIVE: assessment rows keep their entry-time snapshots
   * (ADR-018 §3).
   */
  upsertSubjectConfiguration(
    input: Omit<SubjectConfiguration, "id" | "tenantId"> & { id?: string },
  ): Promise<Result<SubjectConfiguration>>;
}

/**
 * T-345 (ADR-018): the grade-entry write input. The cc mark and the
 * component-weight snapshots are OPTIONAL so every pre-0094 caller keeps
 * compiling byte-identically (defaults: cc null, weights 1/1/2/0 — the
 * historical recipe). The UI resolves them through
 * `resolveSubjectConfiguration` before writing, so new rows snapshot the
 * configuration in force at entry.
 */
export type GradeEntryInput = Omit<
  Assessment,
  "id" | "subjectAverage" | "enteredAt" |
  "cc" | "coefficientDevoir1" | "coefficientDevoir2" |
  "coefficientExamen" | "coefficientCc"
> & {
  cc?: number | null;
  coefficientDevoir1?: number;
  coefficientDevoir2?: number;
  coefficientExamen?: number;
  coefficientCc?: number;
};

export interface GradeRepository {
  observeForStudent(studentId: string): Observable<Assessment[]>;
  observeForClass(classId: string, academicYear?: string, term?: string): Observable<Assessment[]>;
  /**
   * T-352 (DASH-402): school-wide assessment stream (tenant-scoped) —
   * mirrors repository.ts's GradeRepository.observeAll (the contract is
   * declared in both modules; keep them in lockstep).
   */
  observeAll(academicYear?: string, term?: string): Observable<Assessment[]>;
  enterGrade(input: GradeEntryInput): Promise<Result<Assessment>>;
  enterGradesBatch(inputs: ReadonlyArray<GradeEntryInput>): Promise<Result<Assessment[]>>;
}

export interface AttendanceRepository {
  observeByClass(classId: string, date: string): Observable<AttendanceRecord[]>;
  /**
   * Observe attendance for a class over a date range [from, to] (inclusive).
   * FIX: the class attendance tab claimed "7 derniers jours" but only ever
   * queried a single day.
   */
  observeByClassRange(classId: string, from: string, to: string): Observable<AttendanceRecord[]>;
  observeByStudent(studentId: string, fromDate: string, toDate: string): Observable<AttendanceRecord[]>;
  /**
   * T-352 (DASH-402): school-wide attendance stream over [from, to]
   * (tenant-scoped) — mirrors repository.ts's AttendanceRepository.observeAll.
   */
  observeAll(from: string, to: string): Observable<AttendanceRecord[]>;
  recordRollCall(input: {
    classId: string;
    date: string; // YYYY-MM-DD
    session: AttendanceSession;
    statuses: ReadonlyMap<string, AttendanceStatus>;
    recordedBy: string;
  }): Promise<Result<AttendanceRecord[]>>;
  alertAbsences(studentIds: string[]): Promise<Result<void>>;
  /**
   * T-040 (ATT-101): observe records whose justification is in the given
   * workflow state (default: 'submitted' — the staff review queue). The
   * closed feedback loop: parent submits (portal) → staff reviews here →
   * parent sees the outcome.
   */
  observeJustifications(status?: "submitted" | "accepted" | "rejected"): Observable<AttendanceRecord[]>;
  /**
   * T-040 (ATT-101): staff decision on a submitted justification — writes
   * justification_status + justification_reviewed_by/at. Records with NO
   * justification ('none') cannot be reviewed (Err). A previous decision may
   * be overturned (correction path — reviewed_by/at are updated).
   */
  reviewJustification(input: {
    recordId: string;
    decision: "accepted" | "rejected";
    reviewedBy: string;
  }): Promise<Result<AttendanceRecord>>;
}

export interface HomeworkRepository {
  observeForClass(classId: string): Observable<Homework[]>;
  observeByTeacher(teacherId: string): Observable<Homework[]>;
  push(input: {
    classId: string;
    subjectId: string;
    teacherId: string;
    teacherName: string;
    title: string;
    description: string;
    dueDate: string;
    attachments: readonly string[];
  }): Promise<Result<Homework>>;
}

export interface PromotionRepository {
  executeBatchPromotion(input: {
    candidates: readonly { candidate: PromotionCandidate; finalDecision: import("../model/academic").PromotionDecision }[];
    targetAcademicYear: string;
    performedBy: string;
    performedByName: string;
  }): Promise<Result<{ promotedStudents: Student[]; updatedCount: number }>>;
}

// ============================================================================
// Class Formation & Student Placement (T-370 / ACAD-500 — the 9ddde68
// "Constitution des Classes & Répartition des Élèves" workflow)
//
// The contract mirrors the canonical server RPC `fn_finalize_class_placements`
// (migration 0096): ONE atomic call that (A) creates the newly drafted
// sections, (B) applies patches to existing sections of the target year,
// (C) assigns students to their target sections, and (D) writes ONE
// `class.placement_finalize` audit entry. The client NEVER creates classes
// or moves students one-by-one on this path — the sequential loop the
// 08f7f13 follow-up shipped was the ACAD-500 defect (draft-ID pointer
// corruption, silent Result swallowing, dropped class patches).
// ============================================================================

/** A new class section drafted in the studio, to be created by the finalize. */
export interface ClassPlacementNewClass {
  /**
   * The studio's temporary draft id (e.g. "draft-cls-…"). The RPC maps it to
   * the real UUID it creates, so student assignments may reference the draft
   * id as their target — the mapping is resolved server-side INSIDE the same
   * transaction (INV-1 of the 9ddde68 spec §7: no orphaned pointers).
   */
  readonly clientDraftId: string;
  /** Deterministic class code, unique within (tenant, academic_year). */
  readonly code: string;
  /** Display name, e.g. "3ème AP - Section B". */
  readonly name: string;
  /** Grade level code, e.g. "3ap" — resolves the academic_level FK. */
  readonly gradeCode: GradeLevel;
  /** Section label, e.g. "Section B" (fallback "A"). */
  readonly section: string;
  /** T-401: the drafted section's academic stream (filières.code; null = untagged/general). */
  readonly filiereCode: string | null;
  /** T-401: the drafted section's spécialité (null = none). */
  readonly specialiteCode: string | null;
  readonly room: string | null;
  readonly capacity: number | null;
  readonly homeroomTeacherId: string | null;
  readonly homeroomTeacherName: string | null;
}

/** A patch to an EXISTING class of the target academic year. */
export interface ClassPlacementClassPatch {
  /** The existing class id (repository id — never a draft id). */
  readonly id: string;
  readonly room?: string | null;
  readonly capacity?: number | null;
  readonly homeroomTeacherId?: string | null;
  readonly homeroomTeacherName?: string | null;
}

/** One student → target-section assignment. */
export interface ClassPlacementStudentAssignment {
  readonly studentId: string;
  /** Target class id — a real id OR a `clientDraftId` of a new class above. */
  readonly targetClassId: string;
  /** The grade the student is placed into (integrity-checked vs the class). */
  readonly gradeLevel: GradeLevel;
  readonly level: AcademicLevel;
  readonly gradeYear: number;
}

export interface FinalizeClassPlacementsInput {
  /** Target year id when known (the RPC also resolves by code). */
  readonly targetAcademicYearId: string | null;
  /** Target year code, e.g. "2026-2027". */
  readonly targetAcademicYearCode: string;
  readonly newClasses: readonly ClassPlacementNewClass[];
  readonly classesToUpdate: readonly ClassPlacementClassPatch[];
  readonly studentAssignments: readonly ClassPlacementStudentAssignment[];
  readonly performedBy: string;
  readonly performedByName: string;
}

export interface FinalizeClassPlacementsResult {
  readonly targetYearId: string;
  readonly createdClassesCount: number;
  readonly updatedClassesCount: number;
  readonly assignedStudentsCount: number;
}

export interface ClassPlacementRepository {
  /**
   * Atomically finalize a placement session: create the new sections, apply
   * the existing-section patches, assign the students, and write ONE audit
   * entry — the whole batch commits or rolls back together. Historical
   * records (academic histories, assessments, attendance) are never touched
   * (INV-1 of the 9ddde68 spec).
   */
  finalizePlacements(
    input: FinalizeClassPlacementsInput,
  ): Promise<Result<FinalizeClassPlacementsResult>>;
}