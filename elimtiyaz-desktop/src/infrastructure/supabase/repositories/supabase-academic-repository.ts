import type { SupabaseClient } from "@supabase/supabase-js";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { AuditActions } from "../../../core/audit-actions";
import { supabaseErrorToAppError } from "../supabase-client";
import { SubjectBehavior } from "../../mock/subject-behavior";
import { getTenantId, isUuid } from "./supabase-shared-repositories";
import type { Observable } from "../../../domain/repository/repository";
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
  AcademicTerm,
} from "../../../domain/model/academic";
import type {
  Student,
  AcademicLevel,
  GradeLevel,
} from "../../../domain/model/student";
import {
  academicLevelFromGradeLevel,
  gradeYearFromGradeLevel,
} from "../../../domain/model/student";
import type {
  AcademicYearRepository,
  AcademicLevelRepository,
  ClassRepository,
  SubjectRepository,
  GradeRepository,
  AttendanceRepository,
  HomeworkRepository,
  PromotionRepository,
} from "../../../domain/repository/academic-repository";
import type { PromotionCandidate } from "../../../domain/calc/academics/promotion";
import { createAcademicHistoryEntry } from "../../../domain/calc/academics/promotion";
import type {
  CreateSchoolYearInput,
  UpdateSchoolYearInput,
} from "../../../domain/calc/academics/school-year";

// ============================================================================
// 1. ACADEMIC YEAR REPOSITORY
// ============================================================================
export class SupabaseAcademicYearRepository implements AcademicYearRepository {
  private readonly subject = new SubjectBehavior<AcademicYear[]>([]);

  constructor(private readonly client: SupabaseClient) {
    this.refresh();
  }

  private async refresh(): Promise<void> {
    const { data } = await this.client
      .from("academic_years")
      .select("*")
      .order("start_date", { ascending: false });

    if (data) {
      this.subject.set(data.map(mapAcademicYearRow));
    }
  }

  observeAll(): Observable<AcademicYear[]> {
    return this.subject;
  }

  observeById(id: string): Observable<AcademicYear | null> {
    const sub = new SubjectBehavior<AcademicYear | null>(null);
    this.subject.subscribe((years) => {
      sub.set(years.find((y) => y.id === id) ?? null);
    });
    return sub;
  }

  async getCurrentYear(): Promise<Result<AcademicYear>> {
    const { data, error } = await this.client
      .from("academic_years")
      .select("*")
      .eq("is_current", true)
      .single();

    if (error) return Err(supabaseErrorToAppError(error));
    return Ok(mapAcademicYearRow(data));
  }

  async getYearByCode(code: string): Promise<Result<AcademicYear | null>> {
    const { data, error } = await this.client
      .from("academic_years")
      .select("*")
      .eq("code", code)
      .maybeSingle();

    if (error) return Err(supabaseErrorToAppError(error));
    return Ok(data ? mapAcademicYearRow(data) : null);
  }

  async setCurrentYear(id: string, _actorId: string, _actorName: string): Promise<Result<AcademicYear>> {
    // Unset current for all other years of the tenant (explicit tenant scope —
    // see createAcademicYear).
    await this.client
      .from("academic_years")
      .update({ is_current: false })
      .eq("tenant_id", getTenantId())
      .filter("id", "neq", id);

    const { data, error } = await this.client
      .from("academic_years")
      .update({ is_current: true, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(mapAcademicYearRow(data));
  }

  async createAcademicYear(
    input: CreateSchoolYearInput,
    _actorId: string,
    _actorName: string,
  ): Promise<Result<AcademicYear>> {
    // Only one current year at a time — unset the flag on every other year
    // of the tenant first (same semantics as the mock implementation). The
    // explicit tenant filter keeps the UPDATE scoped (PostgREST PATCH without
    // a filter would touch every tenant's rows).
    if (input.isCurrent) {
      await this.client
        .from("academic_years")
        .update({ is_current: false })
        .eq("tenant_id", getTenantId());
    }

    const { data, error } = await this.client
      .from("academic_years")
      .insert({
        code: input.code,
        label: input.label,
        start_date: input.startDate,
        end_date: input.endDate,
        term_structure: input.termStructure,
        is_current: input.isCurrent ?? false,
        is_archived: false,
      })
      .select()
      .single();

    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(mapAcademicYearRow(data));
  }

  async updateAcademicYear(
    id: string,
    input: UpdateSchoolYearInput,
    _actorId: string,
    _actorName: string,
  ): Promise<Result<AcademicYear>> {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.label !== undefined) patch.label = input.label;
    if (input.startDate !== undefined) patch.start_date = input.startDate;
    if (input.endDate !== undefined) patch.end_date = input.endDate;
    if (input.termStructure !== undefined) patch.term_structure = input.termStructure;

    const { data, error } = await this.client
      .from("academic_years")
      .update(patch)
      .eq("id", id)
      .select()
      .single();

    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(mapAcademicYearRow(data));
  }

  async archiveAcademicYear(id: string, _actorId: string, _actorName: string): Promise<Result<AcademicYear>> {
    const { data, error } = await this.client
      .from("academic_years")
      .update({ is_archived: true, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(mapAcademicYearRow(data));
  }

  async restoreAcademicYear(id: string, _actorId: string, _actorName: string): Promise<Result<AcademicYear>> {
    const { data, error } = await this.client
      .from("academic_years")
      .update({ is_archived: false, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(mapAcademicYearRow(data));
  }

  async deleteAcademicYear(id: string, _actorId: string, _actorName: string): Promise<Result<void>> {
    const { error } = await this.client
      .from("academic_years")
      .delete()
      .eq("id", id);

    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(undefined);
  }
}

// ============================================================================
// 2. ACADEMIC LEVEL REPOSITORY
// ============================================================================
export class SupabaseAcademicLevelRepository implements AcademicLevelRepository {
  private readonly subject = new SubjectBehavior<AcademicLevelModel[]>([]);

  constructor(private readonly client: SupabaseClient) {
    this.refresh();
  }

  private async refresh(): Promise<void> {
    const { data } = await this.client
      .from("academic_levels")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (data) {
      this.subject.set(data.map(mapAcademicLevelRow));
    }
  }

  observeAll(): Observable<AcademicLevelModel[]> {
    return this.subject;
  }

  async getByGradeCode(
    gradeCode: GradeLevel,
  ): Promise<Result<AcademicLevelModel | null>> {
    const { data, error } = await this.client
      .from("academic_levels")
      .select("*")
      .eq("grade_code", gradeCode)
      .maybeSingle();

    if (error) return Err(supabaseErrorToAppError(error));
    return Ok(data ? mapAcademicLevelRow(data) : null);
  }
}

// ============================================================================
// 3. CLASS REPOSITORY
// ============================================================================
export class SupabaseClassRepository implements ClassRepository {
  private readonly subject = new SubjectBehavior<AcademicClass[]>([]);
  /** Per-class enrolled-student counts (students.class_id histogram). */
  private enrolledByClass = new Map<string, number>();

  constructor(private readonly client: SupabaseClient) {
    this.refresh();
  }

  private async refresh(): Promise<void> {
    try {
      const [{ data, error }, enrolled] = await Promise.all([
        this.client
          .from("classes")
          .select(
            `
            *,
            academic_years!inner(code, label)
          `,
          )
          .eq("is_active", true)
          .order("code", { ascending: true }),
        // enrolledCount is derived from the students table (the classes table
        // has no enrolled_count column) — one histogram query per refresh.
        this.client
          .from("students")
          .select("class_id")
          .not("class_id", "is", null),
      ] as const);

      if (error) throw error;

      this.enrolledByClass = new Map<string, number>();
      for (const row of (enrolled.data ?? []) as { class_id: string | null }[]) {
        if (row.class_id) {
          this.enrolledByClass.set(
            row.class_id,
            (this.enrolledByClass.get(row.class_id) ?? 0) + 1,
          );
        }
      }

      if (data) {
        this.subject.set(
          data.map((row) => mapClassRow(row, this.enrolledByClass.get(row.id) ?? 0)),
        );
      }
    } catch {
      // Silently degrade to the current cache — the UI shows "no classes".
    }
  }

  observe(): Observable<AcademicClass[]> {
    return this.subject;
  }

  observeByLevel(level: AcademicLevel): Observable<AcademicClass[]> {
    const sub = new SubjectBehavior<AcademicClass[]>([]);
    this.subject.subscribe((classes) => {
      sub.set(classes.filter((c) => c.level === level));
    });
    return sub;
  }

  observeById(id: string): Observable<AcademicClass | null> {
    const sub = new SubjectBehavior<AcademicClass | null>(null);
    this.subject.subscribe((classes) => {
      sub.set(classes.find((c) => c.id === id) ?? null);
    });
    return sub;
  }

  async createClass(
    input: Omit<
      AcademicClass,
      "id" | "tenantId" | "enrolledCount" | "isActive"
    >,
  ): Promise<Result<AcademicClass>> {
    const { data, error } = await this.client
      .from("classes")
      .insert({
        academic_year_id: input.academicYearId,
        academic_level_id: input.academicLevelId,
        code: input.code,
        name: input.name,
        grade_code: input.gradeCode,
        section: input.section || "A",
        room: input.room,
        capacity: input.capacity ?? 30,
        // Mock-era ids ("per-001") are not UUIDs — never send them to the
        // uuid column.
        homeroom_teacher_id: isUuid(input.homeroomTeacherId)
          ? input.homeroomTeacherId
          : null,
        homeroom_teacher_name: input.homeroomTeacherName,
      })
      .select(`*, academic_years!inner(code, label)`)
      .single();

    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(mapClassRow(data, this.enrolledByClass.get(data.id) ?? 0));
  }

  async updateClass(
    id: string,
    updates: Partial<AcademicClass>,
  ): Promise<Result<AcademicClass>> {
    const patch: Record<string, unknown> = {};
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.code !== undefined) patch.code = updates.code;
    if (updates.room !== undefined) patch.room = updates.room;
    if (updates.capacity !== undefined)
      patch.capacity = updates.capacity ?? 30;
    if (updates.homeroomTeacherId !== undefined)
      patch.homeroom_teacher_id = isUuid(updates.homeroomTeacherId)
        ? updates.homeroomTeacherId
        : null;
    if (updates.homeroomTeacherName !== undefined)
      patch.homeroom_teacher_name = updates.homeroomTeacherName;
    patch.updated_at = new Date().toISOString();

    const { data, error } = await this.client
      .from("classes")
      .update(patch)
      .eq("id", id)
      .select(`*, academic_years!inner(code, label)`)
      .single();

    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(mapClassRow(data, this.enrolledByClass.get(data.id) ?? 0));
  }

  async deleteClass(id: string): Promise<Result<void>> {
    const { error } = await this.client
      .from("classes")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(undefined);
  }
}

// ============================================================================
// 4. SUBJECT REPOSITORY
// ============================================================================
export class SupabaseSubjectRepository implements SubjectRepository {
  private readonly subject = new SubjectBehavior<Subject[]>([]);
  /** All class-subject assignments — kept reactive for `observeByClass`. */
  private readonly classSubjects = new SubjectBehavior<ClassSubject[]>([]);

  constructor(private readonly client: SupabaseClient) {
    this.refresh();
    this.refreshClassSubjects();
  }

  private async refresh(): Promise<void> {
    const { data } = await this.client
      .from("subjects")
      .select("*")
      .eq("is_active", true)
      .order("code", { ascending: true });

    if (data) {
      this.subject.set(data.map(mapSubjectRow));
    }
  }

  private async refreshClassSubjects(): Promise<void> {
    const { data } = await this.client
      .from("class_subjects")
      .select("*")
      .order("created_at", { ascending: true });

    if (data) {
      this.classSubjects.set(data.map(mapClassSubjectRow));
    }
  }

  observe(): Observable<Subject[]> {
    return this.subject;
  }

  observeByLevel(level: AcademicLevel): Observable<Subject[]> {
    const sub = new SubjectBehavior<Subject[]>([]);
    this.subject.subscribe((subjects) => {
      sub.set(subjects.filter((s) => s.level === level));
    });
    return sub;
  }

  observeByClass(classId: string): Observable<ClassSubject[]> {
    // Derived from the shared assignments cache so assign/remove mutations
    // propagate to every open class-subjects tab.
    const sub = new SubjectBehavior<ClassSubject[]>([]);
    this.classSubjects.subscribe((all) => {
      sub.set(all.filter((cs) => cs.classId === classId));
    });
    return sub;
  }

  async assignSubjectToClass(
    input: Omit<ClassSubject, "id">,
  ): Promise<Result<ClassSubject>> {
    if (!isUuid(input.classId) || !isUuid(input.subjectId)) {
      return Err(
        Errors.validation(
          "L'assignation matière-classe nécessite des identifiants Supabase valides.",
        ),
      );
    }

    const { data, error } = await this.client
      .from("class_subjects")
      .insert({
        class_id: input.classId,
        subject_id: input.subjectId,
        // Mock-era personnel ids ("per-001") are not UUIDs.
        teacher_id: isUuid(input.teacherId) ? input.teacherId : null,
        teacher_name: input.teacherName,
        weekly_hours: input.weeklyHours,
        coefficient: input.coefficient,
      })
      .select()
      .single();

    if (error) return Err(supabaseErrorToAppError(error));
    await this.refreshClassSubjects();
    return Ok(mapClassSubjectRow(data));
  }

  async removeSubjectFromClass(id: string): Promise<Result<void>> {
    const { error } = await this.client
      .from("class_subjects")
      .delete()
      .eq("id", id);
    if (error) return Err(supabaseErrorToAppError(error));
    await this.refreshClassSubjects();
    return Ok(undefined);
  }

  async createSubject(
    input: Omit<Subject, "id" | "tenantId">,
  ): Promise<Result<Subject>> {
    const { data, error } = await this.client
      .from("subjects")
      .insert({
        code: input.code,
        name_fr: input.name,
        name_ar: input.nameAr,
        cycle: input.cycle,
        default_coefficient: input.coefficient,
        passing_grade: input.passingGrade,
        is_extracurricular: input.isExtracurricular,
      })
      .select()
      .single();

    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(mapSubjectRow(data));
  }

  async updateSubject(
    id: string,
    updates: Partial<Omit<Subject, "id" | "tenantId">>,
  ): Promise<Result<Subject>> {
    const patch: Record<string, unknown> = {};
    if (updates.name !== undefined) patch.name_fr = updates.name;
    if (updates.nameAr !== undefined) patch.name_ar = updates.nameAr;
    if (updates.code !== undefined) patch.code = updates.code;
    if (updates.coefficient !== undefined)
      patch.default_coefficient = updates.coefficient;
    if (updates.passingGrade !== undefined)
      patch.passing_grade = updates.passingGrade;
    if (updates.isExtracurricular !== undefined)
      patch.is_extracurricular = updates.isExtracurricular;
    patch.updated_at = new Date().toISOString();

    const { data, error } = await this.client
      .from("subjects")
      .update(patch)
      .eq("id", id)
      .select()
      .single();

    if (error) return Err(supabaseErrorToAppError(error));

    // FIX (vault §05.06 — coefficient edits trigger an automatic GPA
    // recompute): the canonical GPA (SQL `fn_calculate_student_term_gpa`,
    // Android engine, desktop drawers) reads the coefficient SNAPSHOT stored
    // on each assessment row. When the subject's default coefficient changes,
    // re-weight the stored snapshots for NON-ARCHIVED academic years so every
    // affected student's GPA recomputes. Archived years stay untouched
    // (append-only history, §04.07). This keeps desktop / mobile / backend
    // bit-identical because all three read `assessments.coefficient`.
    if (updates.coefficient !== undefined) {
      const archivedCodes = await this.archivedYearCodes();
      let query = this.client
        .from("assessments")
        .update({ coefficient: updates.coefficient })
        .eq("subject_id", id);
      if (archivedCodes.length > 0) {
        // Exclude archived years from the re-weight (append-only history).
        // PostgREST `in` filter takes a parenthesized, quoted list.
        query = query.not(
          "academic_year",
          "in",
          `(${archivedCodes.map((c) => `"${c}"`).join(",")})`,
        );
      }
      const { error: reweightError } = await query;
      if (reweightError) {
        // Non-fatal: the subject row itself was updated successfully. Surface
        // the re-weight failure so operators know GPAs may be stale.
        console.warn(
          "[supabase-subject-repo] coefficient re-weight failed:",
          reweightError.message,
        );
      }
    }

    await this.refresh();
    return Ok(mapSubjectRow(data));
  }

  /**
   * Codes of all archived academic years — used to keep archived-year
   * assessments untouched when re-weighting coefficients (append-only rule).
   */
  private async archivedYearCodes(): Promise<string[]> {
    const { data } = await this.client
      .from("academic_years")
      .select("code")
      .eq("is_archived", true);
    return (data ?? []).map((r: { code: string }) => r.code);
  }

  async archiveSubject(id: string): Promise<Result<void>> {
    const { error } = await this.client
      .from("subjects")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(undefined);
  }
}

// ============================================================================
// 5. GRADE REPOSITORY
// ============================================================================
export class SupabaseGradeRepository implements GradeRepository {
  constructor(private readonly client: SupabaseClient) {}

  observeForStudent(studentId: string): Observable<Assessment[]> {
    const sub = new SubjectBehavior<Assessment[]>([]);
    const fetchGrades = async () => {
      const { data } = await this.client
        .from("assessments")
        .select("*")
        .eq("student_id", studentId)
        .order("entered_at", { ascending: false });

      if (data) sub.set(data.map(mapAssessmentRow));
    };
    fetchGrades();
    return sub;
  }

  observeForClass(
    classId: string,
    academicYear?: string,
    term?: string,
  ): Observable<Assessment[]> {
    const sub = new SubjectBehavior<Assessment[]>([]);
    const fetchClassGrades = async () => {
      let query = this.client
        .from("assessments")
        .select("*")
        .eq("class_id", classId);
      if (academicYear) query = query.eq("academic_year", academicYear);
      if (term) query = query.eq("term", term);

      const { data } = await query.order("entered_at", { ascending: false });
      if (data) sub.set(data.map(mapAssessmentRow));
    };
    fetchClassGrades();
    return sub;
  }

  async enterGrade(
    input: Omit<Assessment, "id" | "subjectAverage" | "enteredAt">,
  ): Promise<Result<Assessment>> {
    // FIX (vault §04.07 — append-only history): refuse writes to archived
    // academic years, mirroring the mock repository and the backend rule.
    const archived = await this.isArchivedYear(input.academicYear);
    if (archived) {
      const msg =
        `Année scolaire ${input.academicYear} archivée — lecture seule ` +
        `(append-only, plan §04.07).`;
      return Err(Errors.validation(msg, msg));
    }
    const { data, error } = await this.client
      .from("assessments")
      .upsert(
        {
          student_id: input.studentId,
          class_id: input.classId,
          subject_id: input.subjectId,
          term: input.term,
          academic_year: input.academicYear,
          devoir1: input.devoir1,
          devoir2: input.devoir2,
          examen: input.examen,
          coefficient: input.coefficient,
          entered_by: input.enteredBy,
          entered_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "student_id,subject_id,term,academic_year" },
      )
      .select()
      .single();

    if (error) return Err(supabaseErrorToAppError(error));
    return Ok(mapAssessmentRow(data));
  }

  async enterGradesBatch(
    inputs: ReadonlyArray<
      Omit<Assessment, "id" | "subjectAverage" | "enteredAt">
    >,
  ): Promise<Result<Assessment[]>> {
    // FIX (vault §04.07 — append-only history): all-or-nothing rejection of
    // batches targeting archived years (mirrors the mock repository).
    const yearSet = new Set(inputs.map((i) => i.academicYear));
    for (const year of yearSet) {
      const archived = await this.isArchivedYear(year);
      if (archived) {
        const msg =
          `Année scolaire ${year} archivée — lecture seule ` +
          `(append-only, plan §04.07).`;
        return Err(Errors.validation(msg, msg));
      }
    }
    const payload = inputs.map((input) => ({
      student_id: input.studentId,
      class_id: input.classId,
      subject_id: input.subjectId,
      term: input.term,
      academic_year: input.academicYear,
      devoir1: input.devoir1,
      devoir2: input.devoir2,
      examen: input.examen,
      coefficient: input.coefficient,
      entered_by: input.enteredBy,
      entered_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    const { data, error } = await this.client
      .from("assessments")
      .upsert(payload, {
        onConflict: "student_id,subject_id,term,academic_year",
      })
      .select();

    if (error) return Err(supabaseErrorToAppError(error));
    return Ok(data.map(mapAssessmentRow));
  }

  /** True when `academicYear` maps to an archived academic_years row. */
  private async isArchivedYear(academicYear: string): Promise<boolean> {
    const { data } = await this.client
      .from("academic_years")
      .select("is_archived")
      .eq("code", academicYear)
      .maybeSingle();
    return data?.is_archived === true;
  }
}

// ============================================================================
// 6. ATTENDANCE REPOSITORY
// ============================================================================
export class SupabaseAttendanceRepository implements AttendanceRepository {
  constructor(private readonly client: SupabaseClient) {}

  observeByClass(
    classId: string,
    date: string,
  ): Observable<AttendanceRecord[]> {
    const sub = new SubjectBehavior<AttendanceRecord[]>([]);
    const fetchAttendance = async () => {
      const { data } = await this.client
        .from("attendance_records")
        .select("*")
        .eq("class_id", classId)
        .eq("record_date", date);

      if (data) sub.set(data.map(mapAttendanceRow));
    };
    fetchAttendance();
    return sub;
  }

  observeByClassRange(
    classId: string,
    from: string,
    to: string,
  ): Observable<AttendanceRecord[]> {
    // FIX (7-day claim): range query used by the class attendance tab —
    // previously the tab claimed "7 derniers jours" but only queried today.
    const sub = new SubjectBehavior<AttendanceRecord[]>([]);
    const fetchRange = async () => {
      const { data } = await this.client
        .from("attendance_records")
        .select("*")
        .eq("class_id", classId)
        .gte("record_date", from)
        .lte("record_date", to)
        .order("record_date", { ascending: false });

      if (data) sub.set(data.map(mapAttendanceRow));
    };
    fetchRange();
    return sub;
  }

  observeByStudent(
    studentId: string,
    fromDate: string,
    toDate: string,
  ): Observable<AttendanceRecord[]> {
    const sub = new SubjectBehavior<AttendanceRecord[]>([]);
    const fetchStudentAttendance = async () => {
      const { data } = await this.client
        .from("attendance_records")
        .select("*")
        .eq("student_id", studentId)
        .gte("record_date", fromDate)
        .lte("record_date", toDate)
        .order("record_date", { ascending: false });

      if (data) sub.set(data.map(mapAttendanceRow));
    };
    fetchStudentAttendance();
    return sub;
  }

  async recordRollCall(input: {
    classId: string;
    date: string;
    session: AttendanceSession;
    statuses: ReadonlyMap<string, AttendanceStatus>;
    recordedBy: string;
  }): Promise<Result<AttendanceRecord[]>> {
    if (!isUuid(input.classId)) {
      return Err(
        Errors.validation(
          "L'appel nécessite une classe Supabase valide (identifiant non-UUID reçu).",
        ),
      );
    }

    const payload = Array.from(input.statuses.entries())
      .filter(([studentId]) => isUuid(studentId))
      .map(([studentId, status]) => ({
        student_id: studentId,
        class_id: input.classId,
        record_date: input.date,
        session: input.session,
        status,
        recorded_by: isUuid(input.recordedBy) ? input.recordedBy : null,
        recorded_at: new Date().toISOString(),
        synced_at: new Date().toISOString(),
      }));

    if (payload.length === 0) return Ok([]);

    const { data, error } = await this.client
      .from("attendance_records")
      .upsert(payload, { onConflict: "student_id,record_date,session" })
      .select();

    if (error) return Err(supabaseErrorToAppError(error));
    return Ok(data.map(mapAttendanceRow));
  }

  /**
   * Absence alert dispatch (plan §05.04 — parents notified after 3+ absences).
   *
   * The `dispatch-absence-alerts` Edge Function is NOT deployed in this
   * project (see supabase/functions/). Rather than failing the roll-call
   * flow with a 404, we mirror the mock implementation: append an audit
   * entry via the `write_audit_log` RPC (migration 0014) so the alert intent
   * is traceable, and return Ok. When the Edge Function is deployed, this
   * method should be switched to `client.functions.invoke`.
   */
  async alertAbsences(studentIds: string[]): Promise<Result<void>> {
    try {
      await this.client.rpc("write_audit_log", {
        p_tenant_id: getTenantId(),
        p_action: "attendance.alert_absences",
        p_entity_type: "student",
        p_entity_id: null,
        p_actor_id: null,
        p_actor_name: "Système",
        p_note: `Seuil 3+ absences atteint pour ${studentIds.length} élève(s)`,
      });
    } catch {
      // The audit entry is best-effort — never fail the alert call on it.
    }
    return Ok(undefined);
  }
}

// ============================================================================
// 7. HOMEWORK REPOSITORY
// ============================================================================
export class SupabaseHomeworkRepository implements HomeworkRepository {
  constructor(private readonly client: SupabaseClient) {}

  observeForClass(classId: string): Observable<Homework[]> {
    const sub = new SubjectBehavior<Homework[]>([]);
    const fetchHomework = async () => {
      const { data } = await this.client
        .from("homework")
        .select("*")
        .eq("class_id", classId)
        .order("created_at", { ascending: false });

      if (data) sub.set(data.map(mapHomeworkRow));
    };
    fetchHomework();
    return sub;
  }

  observeByTeacher(teacherId: string): Observable<Homework[]> {
    const sub = new SubjectBehavior<Homework[]>([]);
    const fetchTeacherHomework = async () => {
      const { data } = await this.client
        .from("homework")
        .select("*")
        .eq("teacher_id", teacherId)
        .order("created_at", { ascending: false });

      if (data) sub.set(data.map(mapHomeworkRow));
    };
    fetchTeacherHomework();
    return sub;
  }

  async push(input: {
    classId: string;
    subjectId: string;
    teacherId: string;
    teacherName: string;
    title: string;
    description: string;
    dueDate: string;
    attachments: readonly string[];
  }): Promise<Result<Homework>> {
    if (!isUuid(input.classId) || !isUuid(input.subjectId) || !isUuid(input.teacherId)) {
      return Err(
        Errors.validation(
          "La publication de devoirs nécessite des identifiants Supabase valides (classe / matière / enseignant).",
        ),
      );
    }

    // Resolve the subject display name and the current academic year code
    // (previously both were hardcoded — "Matière" / "2025-2026").
    const [subjectRes, yearRes] = await Promise.all([
      this.client
        .from("subjects")
        .select("name_fr")
        .eq("id", input.subjectId)
        .maybeSingle(),
      this.client
        .from("academic_years")
        .select("code, label")
        .eq("is_current", true)
        .maybeSingle(),
    ]);
    const subjectName =
      (subjectRes.data as { name_fr?: string } | null)?.name_fr ?? "Matière";
    const yearRow = yearRes.data as { code?: string | null; label?: string | null } | null;
    const academicYear = yearRow?.code ?? yearRow?.label ?? "2025-2026";

    const { data, error } = await this.client
      .from("homework")
      .insert({
        class_id: input.classId,
        subject_id: input.subjectId,
        subject_name: subjectName,
        teacher_id: input.teacherId,
        teacher_name: input.teacherName,
        title: input.title,
        description: input.description,
        due_date: input.dueDate,
        attachments: input.attachments,
        academic_year: academicYear,
        pushed_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) return Err(supabaseErrorToAppError(error));

    // Best-effort portal push notification. The `push-homework-notification`
    // Edge Function is optional (not currently deployed in supabase/functions)
    // — functions.invoke resolves with { error } instead of throwing, and the
    // result is intentionally ignored so the homework insert stays the source
    // of truth.
    void this.client
      .functions.invoke("push-homework-notification", {
        body: { homework_id: data.id },
      })
      .catch(() => undefined);

    return Ok(mapHomeworkRow(data));
  }
}

// ============================================================================
// 8. PROMOTION REPOSITORY (Decoupled Batch Execution)
// ============================================================================
/**
 * Derive the academic year label that just completed, given the target year
 * of the promotion (e.g. "2026-2027" → "2025-2026"). Mirrors the mock
 * implementation so the history entry records the COMPLETED year.
 */
function derivePreviousAcademicYear(targetAcademicYear: string): string {
  const m = /^(\d{4})-(\d{4})$/.exec(targetAcademicYear.trim());
  if (m) {
    const start = Number(m[1]) - 1;
    return `${start}-${start + 1}`;
  }
  return targetAcademicYear;
}

export class SupabasePromotionRepository implements PromotionRepository {
  constructor(private readonly client: SupabaseClient) {}

  /**
   * Batch promotion — direct table operations:
   *
   *   1. Upsert the permanent academic history entries into
   *      `student_academic_histories` (migration 0029) for the year the
   *      student just COMPLETED.
   *   2. Advance promoted students: `students.grade_level_code` ← next grade
   *      level (level / gradeYear are derived from the code via the canonical
   *      helpers, exactly like the shared student repository), and clear
   *      `class_id` — the old class assignment no longer applies.
   *   3. Graduated students (3ème année) get `enrollment_status = 'graduated'`.
   *   4. Best-effort audit entry via the `write_audit_log` RPC (0014).
   *
   * NOTE: the original implementation called an `execute_batch_promotion` RPC
   * that does NOT exist in any migration — it would have failed with
   * PGRST202 at runtime. The student updates are therefore issued directly.
   */
  async executeBatchPromotion(input: {
    candidates: readonly {
      candidate: PromotionCandidate;
      finalDecision: import("../../../domain/model/academic").PromotionDecision;
    }[];
    targetAcademicYear: string;
    performedBy: string;
    performedByName: string;
  }): Promise<Result<{ promotedStudents: Student[]; updatedCount: number }>> {
    const completedYear = derivePreviousAcademicYear(input.targetAcademicYear);
    const historyPayloads: Record<string, unknown>[] = [];
    const studentUpdates: {
      id: string;
      gradeLevel: GradeLevel;
    }[] = [];
    const graduatedIds: string[] = [];

    for (const item of input.candidates) {
      const { candidate, finalDecision } = item;
      const history = createAcademicHistoryEntry(
        candidate,
        completedYear,
        null,
        finalDecision,
      );

      historyPayloads.push({
        student_id: history.studentId,
        academic_year: history.academicYear,
        cycle: history.cycle,
        grade_code: history.gradeCode,
        grade_year: history.gradeYear,
        class_id: isUuid(history.classId) ? history.classId : null,
        class_name: history.className,
        gpa: history.gpa,
        decision: history.decision,
        narrative: history.narrative,
        recorded_at: new Date().toISOString(),
      });

      if (!isUuid(candidate.student.id)) continue; // mock-era id — not in Supabase

      if (
        finalDecision === "promoted" &&
        candidate.nextGradeLevel
      ) {
        studentUpdates.push({
          id: candidate.student.id,
          gradeLevel: candidate.nextGradeLevel,
        });
      } else if (finalDecision === "graduated") {
        graduatedIds.push(candidate.student.id);
      }
    }

    // 1. Permanent academic history (append-only, idempotent per student+year).
    // Only rows with Supabase uuid student ids can be persisted.
    const persistableHistory = historyPayloads.filter((p) =>
      isUuid(p.student_id as string),
    );
    if (persistableHistory.length > 0) {
      const { error: historyErr } = await this.client
        .from("student_academic_histories")
        .upsert(persistableHistory, {
          onConflict: "student_id,academic_year",
        });
      if (historyErr) return Err(supabaseErrorToAppError(historyErr));
    }

    // 2. Advance promoted students to the next grade level + clear class.
    const now = new Date().toISOString();
    for (const upd of studentUpdates) {
      const { error } = await this.client
        .from("students")
        .update({
          grade_level_code: upd.gradeLevel,
          class_id: null,
          updated_at: now,
        })
        .eq("id", upd.id);
      if (error) return Err(supabaseErrorToAppError(error));
    }

    // 3. Graduations.
    for (const id of graduatedIds) {
      const { error } = await this.client
        .from("students")
        .update({
          enrollment_status: "graduated",
          class_id: null,
          updated_at: now,
        })
        .eq("id", id);
      if (error) return Err(supabaseErrorToAppError(error));
    }

    const updatedIds = [
      ...studentUpdates.map((u) => u.id),
      ...graduatedIds,
    ];

    // 4. Best-effort audit entry (canonical write_audit_log RPC, migration 0014).
    try {
      await this.client.rpc("write_audit_log", {
        p_tenant_id: getTenantId(),
        p_action: "student.promote",
        p_entity_type: "student",
        p_entity_id: null,
        p_actor_id: isUuid(input.performedBy) ? input.performedBy : null,
        p_actor_name: input.performedByName,
        p_before_json: null,
        p_after_json: {
          count: updatedIds.length,
          targetYear: input.targetAcademicYear,
        },
        p_note: `Promotion de classe exécutée vers l'année ${input.targetAcademicYear}`,
      });
    } catch {
      // Audit is best-effort — the promotion itself already succeeded.
    }

    // 5. Re-read the updated students for the return payload.
    if (updatedIds.length === 0) {
      return Ok({ promotedStudents: [], updatedCount: 0 });
    }
    const { data: rows, error: fetchErr } = await this.client
      .from("students")
      .select("*")
      .in("id", updatedIds);
    if (fetchErr) return Err(supabaseErrorToAppError(fetchErr));

    return Ok({
      promotedStudents: (rows ?? []).map(mapStudentRow),
      updatedCount: updatedIds.length,
    });
  }
}

// ============================================================================
// DB ROW MAPPERS (Snake_case DB -> CamelCase Domain)
// ============================================================================
function mapAcademicYearRow(row: Record<string, any>): AcademicYear {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    // The `code` column (migration 0029) is NULL on the live seeded year —
    // fall back to the label ("2026-2027") so the domain contract
    // (`code: string`) and the UI never see null.
    code: row.code ?? row.label,
    label: row.label,
    startDate: row.start_date,
    endDate: row.end_date,
    termStructure: row.term_structure,
    isCurrent: row.is_current,
    isArchived: row.is_archived,
  };
}

function mapAcademicLevelRow(row: Record<string, any>): AcademicLevelModel {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    cycle: row.cycle,
    gradeCode: row.grade_code,
    labelFr: row.label_fr,
    labelAr: row.label_ar,
    yearNumber: row.year_number,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}

function mapClassRow(
  row: Record<string, any>,
  enrolledCount?: number,
): AcademicClass {
  const cycleMap: Record<string, AcademicLevel> = {
    prescolaire_1: "primaire",
    prescolaire_2: "primaire",
    "1ap": "primaire",
    "2ap": "primaire",
    "3ap": "primaire",
    "4ap": "primaire",
    "5ap": "primaire",
    "1am": "cem",
    "2am": "cem",
    "3am": "cem",
    "4am": "cem",
    "1ere_annee": "lycee",
    "2eme_annee": "lycee",
    "3eme_annee": "lycee",
  };

  return {
    id: row.id,
    tenantId: row.tenant_id,
    academicYearId: row.academic_year_id,
    academicLevelId: row.academic_level_id,
    code: row.code,
    name: row.name,
    gradeCode: row.grade_code as GradeLevel,
    level: cycleMap[row.grade_code] ?? "primaire",
    gradeYear: row.grade_code?.includes("ap") ? parseInt(row.grade_code) : 1,
    section: row.section,
    room: row.room,
    capacity: row.capacity ?? null,
    enrolledCount: enrolledCount ?? row.enrolled_count ?? 0,
    homeroomTeacherId: row.homeroom_teacher_id,
    homeroomTeacherName: row.homeroom_teacher_name,
    notes: row.notes ?? null,
    // The joined year's `code` is NULL on the live seeded year (0029 column) —
    // fall back to its label before the static mock default.
    academicYear:
      row.academic_years?.code ??
      row.academic_years?.label ??
      "2025-2026",
    isActive: row.is_active,
  };
}

function mapSubjectRow(row: Record<string, any>): Subject {
  const cycleToLevel: Record<string, AcademicLevel> = {
    prescolaire: "primaire",
    primaire: "primaire",
    cem: "cem",
    lycee: "lycee",
  };

  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name_fr,
    nameAr: row.name_ar,
    cycle: row.cycle,
    level: cycleToLevel[row.cycle] ?? "primaire",
    coefficient: Number(row.default_coefficient),
    passingGrade: Number(row.passing_grade),
    isExtracurricular: row.is_extracurricular,
    isActive: row.is_active,
    teacherId: row.teacher_id ?? null,
    teacherName: row.teacher_name ?? null,
    academicYearId: row.academic_year_id ?? "ay-2025-2026",
    academicYearCode: row.academic_year_code ?? "2025-2026",
  };
}

function mapClassSubjectRow(row: Record<string, any>): ClassSubject {
  return {
    id: row.id,
    classId: row.class_id,
    subjectId: row.subject_id,
    teacherId: row.teacher_id,
    teacherName: row.teacher_name,
    weeklyHours: Number(row.weekly_hours),
    coefficient: Number(row.coefficient),
  };
}

function mapAssessmentRow(row: Record<string, any>): Assessment {
  return {
    id: row.id,
    studentId: row.student_id,
    classId: row.class_id,
    subjectId: row.subject_id,
    term: row.term as AcademicTerm,
    academicYear: row.academic_year,
    devoir1: row.devoir1 != null ? Number(row.devoir1) : null,
    devoir2: row.devoir2 != null ? Number(row.devoir2) : null,
    examen: row.examen != null ? Number(row.examen) : null,
    subjectAverage:
      row.subject_average != null ? Number(row.subject_average) : null,
    coefficient: Number(row.coefficient),
    enteredBy: row.entered_by,
    enteredAt: row.entered_at,
  };
}

function mapAttendanceRow(row: Record<string, any>): AttendanceRecord {
  return {
    id: row.id,
    studentId: row.student_id,
    classId: row.class_id,
    date: row.record_date,
    session: row.session,
    status: row.status,
    note: row.note,
    recordedBy: row.recorded_by,
    recordedAt: row.recorded_at,
    syncedAt: row.synced_at,
  };
}

function mapHomeworkRow(row: Record<string, any>): Homework {
  return {
    id: row.id,
    classId: row.class_id,
    subjectId: row.subject_id,
    subjectName: row.subject_name,
    teacherId: row.teacher_id,
    teacherName: row.teacher_name,
    title: row.title,
    description: row.description,
    dueDate: row.due_date,
    attachments: row.attachments ?? [],
    academicYear: row.academic_year,
    createdAt: row.created_at,
    pushedAt: row.pushed_at,
    acknowledgedCount: row.acknowledged_count ?? 0,
  };
}

function mapStudentRow(row: Record<string, any>): Student {
  // students table has no level / grade_year / grade_level columns — the
  // canonical source is `grade_level_code` (migration 0028), from which
  // level + gradeYear are derived via the domain helpers (same routine as
  // the shared SupabaseStudentRepository).
  const gradeLevel = (row.grade_level_code ?? "1ap") as GradeLevel;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.student_code,
    parentId: row.parent_id,
    firstName: row.first_name,
    lastName: row.last_name,
    displayName: row.display_name ?? null,
    gender: row.gender ?? "unspecified",
    birthDate: row.date_of_birth,
    enrollmentDate: row.enrollment_date,
    level: academicLevelFromGradeLevel(gradeLevel),
    gradeYear: gradeYearFromGradeLevel(gradeLevel),
    gradeLevel,
    classId: row.class_id,
    photoUrl: null,
    medicalNotes: row.medical_notes,
    transportTier: null,
    status: (row.enrollment_status === "withdrawn"
      ? "withdrawn"
      : row.enrollment_status === "graduated"
        ? "graduated"
        : row.is_active
          ? "active"
          : "suspended") as Student["status"],
    paymentPlan: (row.payment_plan as Student["paymentPlan"]) ?? "tranches",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
