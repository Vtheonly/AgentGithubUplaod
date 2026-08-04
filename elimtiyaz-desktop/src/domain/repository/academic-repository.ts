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

export interface AcademicYearRepository {
  observeAll(): Observable<AcademicYear[]>;
  getCurrentYear(): Promise<Result<AcademicYear>>;
  getYearByCode(code: string): Promise<Result<AcademicYear | null>>;
  setCurrentYear(id: string): Promise<Result<AcademicYear>>;
  createAcademicYear(input: Omit<AcademicYear, "id" | "tenantId">): Promise<Result<AcademicYear>>;
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