import type { SupabaseClient } from "@supabase/supabase-js";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { AuditActions } from "../../../core/audit-actions";
import { supabaseErrorToAppError } from "../supabase-client";
import { SubjectBehavior } from "../../mock/subject-behavior";
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

  async setCurrentYear(id: string): Promise<Result<AcademicYear>> {
    // Unset current for all
    await this.client
      .from("academic_years")
      .update({ is_current: false })
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
    input: Omit<AcademicYear, "id" | "tenantId">,
  ): Promise<Result<AcademicYear>> {
    const { data, error } = await this.client
      .from("academic_years")
      .insert({
        code: input.code,
        label: input.label,
        start_date: input.startDate,
        end_date: input.endDate,
        term_structure: input.termStructure,
        is_current: input.isCurrent,
        is_archived: input.isArchived,
      })
      .select()
      .single();

    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(mapAcademicYearRow(data));
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

  constructor(private readonly client: SupabaseClient) {
    this.refresh();
  }

  private async refresh(): Promise<void> {
    const { data } = await this.client
      .from("classes")
      .select(
        `
        *,
        academic_years!inner(code)
      `,
      )
      .eq("is_active", true)
      .order("code", { ascending: true });

    if (data) {
      this.subject.set(data.map(mapClassRow));
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
        capacity: input.capacity,
        homeroom_teacher_id: input.homeroomTeacherId,
        homeroom_teacher_name: input.homeroomTeacherName,
      })
      .select(`*, academic_years!inner(code)`)
      .single();

    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(mapClassRow(data));
  }

  async updateClass(
    id: string,
    updates: Partial<AcademicClass>,
  ): Promise<Result<AcademicClass>> {
    const patch: Record<string, unknown> = {};
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.code !== undefined) patch.code = updates.code;
    if (updates.room !== undefined) patch.room = updates.room;
    if (updates.capacity !== undefined) patch.capacity = updates.capacity;
    if (updates.homeroomTeacherId !== undefined)
      patch.homeroom_teacher_id = updates.homeroomTeacherId;
    if (updates.homeroomTeacherName !== undefined)
      patch.homeroom_teacher_name = updates.homeroomTeacherName;
    patch.updated_at = new Date().toISOString();

    const { data, error } = await this.client
      .from("classes")
      .update(patch)
      .eq("id", id)
      .select(`*, academic_years!inner(code)`)
      .single();

    if (error) return Err(supabaseErrorToAppError(error));
    await this.refresh();
    return Ok(mapClassRow(data));
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

  constructor(private readonly client: SupabaseClient) {
    this.refresh();
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
    const sub = new SubjectBehavior<ClassSubject[]>([]);
    const fetchClassSubjects = async () => {
      const { data } = await this.client
        .from("class_subjects")
        .select("*")
        .eq("class_id", classId);

      if (data) {
        sub.set(data.map(mapClassSubjectRow));
      }
    };
    fetchClassSubjects();
    return sub;
  }

  async assignSubjectToClass(
    input: Omit<ClassSubject, "id">,
  ): Promise<Result<ClassSubject>> {
    const { data, error } = await this.client
      .from("class_subjects")
      .insert({
        class_id: input.classId,
        subject_id: input.subjectId,
        teacher_id: input.teacherId,
        teacher_name: input.teacherName,
        weekly_hours: input.weeklyHours,
        coefficient: input.coefficient,
      })
      .select()
      .single();

    if (error) return Err(supabaseErrorToAppError(error));
    return Ok(mapClassSubjectRow(data));
  }

  async removeSubjectFromClass(id: string): Promise<Result<void>> {
    const { error } = await this.client
      .from("class_subjects")
      .delete()
      .eq("id", id);
    if (error) return Err(supabaseErrorToAppError(error));
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
    await this.refresh();
    return Ok(mapSubjectRow(data));
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
    const payload = Array.from(input.statuses.entries()).map(
      ([studentId, status]) => ({
        student_id: studentId,
        class_id: input.classId,
        record_date: input.date,
        session: input.session,
        status,
        recorded_by: input.recordedBy,
        recorded_at: new Date().toISOString(),
        synced_at: new Date().toISOString(),
      }),
    );

    const { data, error } = await this.client
      .from("attendance_records")
      .upsert(payload, { onConflict: "student_id,record_date,session" })
      .select();

    if (error) return Err(supabaseErrorToAppError(error));
    return Ok(data.map(mapAttendanceRow));
  }

  async alertAbsences(studentIds: string[]): Promise<Result<void>> {
    // Triggers automated absence alert push to parent portal
    const { error } = await this.client.functions.invoke(
      "dispatch-absence-alerts",
      {
        body: { student_ids: studentIds },
      },
    );

    if (error) return Err(supabaseErrorToAppError(error));
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
    const { data, error } = await this.client
      .from("homework")
      .insert({
        class_id: input.classId,
        subject_id: input.subjectId,
        subject_name: "Matière",
        teacher_id: input.teacherId,
        teacher_name: input.teacherName,
        title: input.title,
        description: input.description,
        due_date: input.dueDate,
        attachments: input.attachments,
        academic_year: "2025-2026",
        pushed_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) return Err(supabaseErrorToAppError(error));

    // Trigger push notification to student/parent portal
    await this.client.functions.invoke("push-homework-notification", {
      body: { homework_id: data.id },
    });

    return Ok(mapHomeworkRow(data));
  }
}

// ============================================================================
// 8. PROMOTION REPOSITORY (Decoupled Batch Execution)
// ============================================================================
export class SupabasePromotionRepository implements PromotionRepository {
  constructor(private readonly client: SupabaseClient) {}

  async executeBatchPromotion(input: {
    candidates: readonly {
      candidate: PromotionCandidate;
      finalDecision: import("../../../domain/model/academic").PromotionDecision;
    }[];
    targetAcademicYear: string;
    performedBy: string;
    performedByName: string;
  }): Promise<Result<{ promotedStudents: Student[]; updatedCount: number }>> {
    const historyPayloads: Record<string, unknown>[] = [];
    const studentUpdates: {
      id: string;
      gradeLevel: GradeLevel;
      level: AcademicLevel;
      gradeYear: number;
    }[] = [];

    for (const item of input.candidates) {
      const { candidate, finalDecision } = item;
      const history = createAcademicHistoryEntry(
        candidate,
        input.targetAcademicYear,
        null,
        finalDecision,
      );

      historyPayloads.push({
        student_id: history.studentId,
        academic_year: history.academicYear,
        cycle: history.cycle,
        grade_code: history.gradeCode,
        grade_year: history.gradeYear,
        gpa: history.gpa,
        decision: history.decision,
        narrative: history.narrative,
        recorded_at: new Date().toISOString(),
      });

      if (
        finalDecision === "promoted" &&
        candidate.nextGradeLevel &&
        candidate.nextAcademicLevel &&
        candidate.nextGradeYear
      ) {
        studentUpdates.push({
          id: candidate.student.id,
          gradeLevel: candidate.nextGradeLevel,
          level: candidate.nextAcademicLevel,
          gradeYear: candidate.nextGradeYear,
        });
      }
    }

    // 1. Insert permanent academic history entries
    const { error: historyErr } = await this.client
      .from("student_academic_histories")
      .upsert(historyPayloads, { onConflict: "student_id,academic_year" });

    if (historyErr) return Err(supabaseErrorToAppError(historyErr));

    // 2. Execute RPC stored procedure for atomic student level advancement
    const { data: updatedStudents, error: updateErr } = await this.client.rpc(
      "execute_batch_promotion",
      {
        p_student_updates: studentUpdates,
        p_actor_id: input.performedBy,
      },
    );

    if (updateErr) return Err(supabaseErrorToAppError(updateErr));

    return Ok({
      promotedStudents: (updatedStudents ?? []).map(mapStudentRow),
      updatedCount: studentUpdates.length,
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
    code: row.code,
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

function mapClassRow(row: Record<string, any>): AcademicClass {
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
    capacity: row.capacity,
    enrolledCount: row.enrolled_count ?? 0,
    homeroomTeacherId: row.homeroom_teacher_id,
    homeroomTeacherName: row.homeroom_teacher_name,
    academicYear: row.academic_years?.code ?? "2025-2026",
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
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.student_code,
    parentId: row.parent_id,
    firstName: row.first_name,
    lastName: row.last_name,
    gender: row.gender,
    birthDate: row.date_of_birth,
    enrollmentDate: row.enrollment_date,
    level: row.level,
    gradeYear: row.grade_year,
    gradeLevel: row.grade_level,
    classId: row.class_id,
    photoUrl: null,
    medicalNotes: row.medical_notes,
    transportTier: null,
    status: row.is_active ? "active" : "suspended",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
