import type { Result } from "../../core/result";
import type { Observable } from "./repository";
import type {
  AcademicClass,
  Subject,
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
}

export interface GradeRepository {
  observeForStudent(studentId: string): Observable<Assessment[]>;
  observeForClass(classId: string, academicYear?: string, term?: string): Observable<Assessment[]>;
  enterGrade(input: Omit<Assessment, "id" | "subjectAverage" | "enteredAt">): Promise<Result<Assessment>>;
  enterGradesBatch(inputs: ReadonlyArray<Omit<Assessment, "id" | "subjectAverage" | "enteredAt">>): Promise<Result<Assessment[]>>;
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
  recordRollCall(input: {
    classId: string;
    date: string; // YYYY-MM-DD
    session: AttendanceSession;
    statuses: ReadonlyMap<string, AttendanceStatus>;
    recordedBy: string;
  }): Promise<Result<AttendanceRecord[]>>;
  alertAbsences(studentIds: string[]): Promise<Result<void>>;
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