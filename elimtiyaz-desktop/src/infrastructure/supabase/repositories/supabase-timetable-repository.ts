// ============================================================================
// FILE: src/infrastructure/supabase/repositories/supabase-timetable-repository.ts
// ============================================================================
/**
 * The Supabase TimetableRepository — T-404 (ADR-020, migrations 0109/0110).
 *
 * Persistence for: timetable_configurations, rooms, timetable_constraints,
 * timetable_versions, timetable_entries. Generation consumes the canonical
 * domain + the solver registry; manual adjustments run the canonical
 * validator (calc/timetable/constraints.ts) BEFORE any write — the DB
 * unique indexes are the final backstop (0109 §5b).
 *
 * Publish goes through the canonical fn_timetable_publish RPC (0109 §7);
 * every mutation writes an audit entry via write_audit_log (0014).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { supabaseErrorToAppError } from "../supabase-client";
import { SubjectBehavior } from "../../mock/subject-behavior";
import { getTenantId, isUuid } from "./supabase-shared-repositories";
import type { Observable } from "../../../domain/repository/repository";
import type {
  ActorContext,
  CreateRoomInput,
  CreateTimetableConstraintInput,
  GenerateTimetableOptions,
  MoveTimetableEntryInput,
  SaveTimetableConfigurationInput,
  TimetableRepository,
  UpdateRoomInput,
  UpdateTimetableConstraintInput,
} from "../../../domain/repository/timetable-repository";
import { assertTransitionAllowed } from "../../../domain/repository/timetable-repository";
import type {
  Room,
  RoomType,
  TimetableConfiguration,
  TimetableConstraint,
  TimetableDay,
  TimetablePeriod,
  TimetableBreak,
  TimetableProblem,
  TimetableRequirement,
  TimetableScheduleEntry,
  TimetableSlotAssignment,
  TimetableVersion,
  TimetableVersionStatus,
} from "../../../domain/model/timetable";
import {
  parseTimetableDay,
  ROOM_TYPES,
  slotAssignmentFromEntry,
  TIMETABLE_CONSTRAINT_KINDS,
} from "../../../domain/model/timetable";
import { validateTimetable } from "../../../domain/calc/timetable/constraints";
import {
  getTimetableSolver,
  GREEDY_SOLVER_ID,
} from "../../../domain/calc/timetable/solver";

// ============================================================================
// Row mappers (0109 wire shapes → canonical domain)
// ============================================================================

function mapConfigurationRow(row: Record<string, any>): TimetableConfiguration {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    academicYearId: row.academic_year_id,
    label: row.label,
    schoolDays: (row.school_days ?? []).map(
      (d: string) => parseTimetableDay(d) ?? "monday",
    ),
    periods: (row.periods ?? []).map((p: Record<string, any>) => ({
      index: Number(p.index),
      label: String(p.label ?? `S${p.index}`),
      startMinutes: Number(p.startMinutes),
      endMinutes: Number(p.endMinutes),
    })),
    breaks: (row.breaks ?? []).map((b: Record<string, any>) => ({
      afterPeriodIndex: Number(b.afterPeriodIndex),
      label: String(b.label ?? "Pause"),
      startMinutes: Number(b.startMinutes),
      endMinutes: Number(b.endMinutes),
    })),
    defaultLessonMinutes: Number(row.default_lesson_minutes ?? 60),
    maxPeriodsPerDay: Number(row.max_periods_per_day ?? 8),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRoomRow(row: Record<string, any>): Room {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    roomType: (ROOM_TYPES as readonly string[]).includes(row.room_type)
      ? (row.room_type as RoomType)
      : "other",
    capacity: row.capacity != null ? Number(row.capacity) : null,
    building: row.building ?? null,
    floorLabel: row.floor_label ?? null,
    isActive: Boolean(row.is_active),
    notes: row.notes ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapConstraintRow(row: Record<string, any>): TimetableConstraint {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    academicYearId: row.academic_year_id,
    scope: row.scope,
    entityId: row.entity_id ?? null,
    kind: (TIMETABLE_CONSTRAINT_KINDS as readonly string[]).includes(row.kind)
      ? (row.kind as TimetableConstraint["kind"])
      : "free_day",
    severity: row.severity === "soft" ? "soft" : "hard",
    params: row.params ?? {},
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapVersionRow(row: Record<string, any>): TimetableVersion {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    academicYearId: row.academic_year_id,
    versionNumber: Number(row.version_number),
    status: row.status as TimetableVersionStatus,
    label: row.label ?? null,
    solverId: row.solver_id,
    solverBuild: row.solver_build ?? null,
    generationParams: row.generation_params ?? {},
    statistics: row.statistics ?? {},
    hardViolationCount: Number(row.hard_violation_count ?? 0),
    softViolationCount: Number(row.soft_violation_count ?? 0),
    unplacedCount: Number(row.unplaced_count ?? 0),
    createdBy: row.created_by ?? null,
    createdByName: row.created_by_name ?? null,
    reviewedBy: row.reviewed_by ?? null,
    reviewedAt: row.reviewed_at ?? null,
    reviewNote: row.review_note ?? null,
    approvedBy: row.approved_by ?? null,
    approvedAt: row.approved_at ?? null,
    publishedBy: row.published_by ?? null,
    publishedAt: row.published_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEntryRow(row: Record<string, any>): TimetableScheduleEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    academicYearId: row.academic_year_id,
    versionId: row.version_id,
    classId: row.class_id,
    subjectId: row.subject_id,
    teacherId: row.teacher_id ?? null,
    roomId: row.room_id ?? null,
    day: parseTimetableDay(row.day) ?? "monday",
    periodIndex: Number(row.period_index),
    startMinutes: Number(row.start_minutes),
    endMinutes: Number(row.end_minutes),
    lessonGroup: Number(row.lesson_group ?? 1),
    isLocked: Boolean(row.is_locked),
    source: row.source === "manual" ? "manual" : "generated",
    notes: row.notes ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================================
// The repository
// ============================================================================

export class SupabaseTimetableRepository implements TimetableRepository {
  private readonly configSubject =
    new SubjectBehavior<Map<string, TimetableConfiguration | null>>(new Map());
  private readonly roomsSubject = new SubjectBehavior<Room[]>([]);
  private readonly constraintsSubject =
    new SubjectBehavior<Map<string, TimetableConstraint[]>>(new Map());
  private readonly versionsSubject =
    new SubjectBehavior<Map<string, TimetableVersion[]>>(new Map());
  private readonly entriesSubject =
    new SubjectBehavior<Map<string, TimetableScheduleEntry[]>>(new Map());
  private readonly publishedSubject =
    new SubjectBehavior<Map<string, TimetableScheduleEntry[]>>(new Map());

  constructor(private readonly client: SupabaseClient) {
    void this.refreshRooms();
  }

  // ── Refresh helpers ─────────────────────────────────────────────────────

  private async refreshConfiguration(academicYearId: string): Promise<void> {
    const { data } = await this.client
      .from("timetable_configurations")
      .select("*")
      .eq("academic_year_id", academicYearId)
      .eq("is_active", true)
      .maybeSingle();
    const map = new Map(this.configSubject.get());
    map.set(academicYearId, data ? mapConfigurationRow(data) : null);
    this.configSubject.set(map);
  }

  private async refreshRooms(): Promise<void> {
    const { data } = await this.client
      .from("rooms")
      .select("*")
      .order("code");
    this.roomsSubject.set((data ?? []).map(mapRoomRow));
  }

  private async refreshConstraints(academicYearId: string): Promise<void> {
    const { data } = await this.client
      .from("timetable_constraints")
      .select("*")
      .eq("academic_year_id", academicYearId)
      .order("created_at");
    const map = new Map(this.constraintsSubject.get());
    map.set(academicYearId, (data ?? []).map(mapConstraintRow));
    this.constraintsSubject.set(map);
  }

  private async refreshVersions(academicYearId: string): Promise<void> {
    const { data } = await this.client
      .from("timetable_versions")
      .select("*")
      .eq("academic_year_id", academicYearId)
      .order("version_number", { ascending: false });
    const map = new Map(this.versionsSubject.get());
    map.set(academicYearId, (data ?? []).map(mapVersionRow));
    this.versionsSubject.set(map);
  }

  private async refreshEntries(versionIds: string[]): Promise<void> {
    if (versionIds.length === 0) return;
    const { data } = await this.client
      .from("timetable_entries")
      .select("*")
      .in("version_id", versionIds)
      .order("period_index");
    const map = new Map(this.entriesSubject.get());
    for (const vid of versionIds) {
      map.set(vid, (data ?? []).filter((r) => r.version_id === vid).map(mapEntryRow));
    }
    this.entriesSubject.set(map);
  }

  private async audit(
    action: string,
    entityType: string,
    entityId: string | null,
    actor: ActorContext,
    after: Record<string, unknown> | null,
    note: string,
  ): Promise<void> {
    const tenantId = getTenantId();
    if (!tenantId) return;
    await this.client.rpc("write_audit_log", {
      p_tenant_id: tenantId,
      p_action: action,
      p_entity_type: entityType,
      p_entity_id: isUuid(entityId ?? "") ? entityId : null,
      p_actor_id: isUuid(actor.actorId) ? actor.actorId : null,
      p_actor_name: actor.actorName,
      p_after_json: after,
      p_note: note,
    });
  }

  // ========================================================================
  // Configuration
  // ========================================================================

  observeConfiguration(
    academicYearId: string,
  ): Observable<TimetableConfiguration | null> {
    const sub = new SubjectBehavior<TimetableConfiguration | null>(
      this.configSubject.get().get(academicYearId) ?? null,
    );
    this.configSubject.subscribe((map) => {
      sub.set(map.get(academicYearId) ?? null);
    });
    void this.refreshConfiguration(academicYearId);
    return sub;
  }

  async saveConfiguration(
    input: SaveTimetableConfigurationInput,
    actor: ActorContext,
  ): Promise<Result<TimetableConfiguration>> {
    const tenantId = getTenantId();
    if (!tenantId) {
      return Err(Errors.validation("saveConfiguration: no active tenant context"));
    }
    if (input.periods.length === 0) {
      return Err(Errors.validation("La configuration doit définir au moins une période."));
    }
    const periods = [...input.periods]
      .sort((a, b) => a.index - b.index)
      .map((p) => ({
        index: p.index,
        label: p.label,
        startMinutes: p.startMinutes,
        endMinutes: p.endMinutes,
      }));
    const breaks = input.breaks.map((b) => ({
      afterPeriodIndex: b.afterPeriodIndex,
      label: b.label,
      startMinutes: b.startMinutes,
      endMinutes: b.endMinutes,
    }));

    const { data: existing } = await this.client
      .from("timetable_configurations")
      .select("id")
      .eq("academic_year_id", input.academicYearId)
      .eq("is_active", true)
      .maybeSingle();

    const payload = {
      label: input.label,
      school_days: [...input.schoolDays],
      periods,
      breaks,
      default_lesson_minutes: input.defaultLessonMinutes,
      max_periods_per_day: input.maxPeriodsPerDay,
      is_active: input.isActive ?? true,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = existing
      ? await this.client
          .from("timetable_configurations")
          .update(payload)
          .eq("id", existing.id)
          .select()
          .single()
      : await this.client
          .from("timetable_configurations")
          .insert({
            tenant_id: tenantId,
            academic_year_id: input.academicYearId,
            ...payload,
          })
          .select()
          .single();

    if (error) return Err(supabaseErrorToAppError(error));
    await this.refreshConfiguration(input.academicYearId);
    const saved = mapConfigurationRow(data);
    await this.audit(
      "timetable.configuration_save",
      "timetable_configuration",
      saved.id,
      actor,
      { label: saved.label, schoolDays: saved.schoolDays.length },
      `Configuration d'emploi du temps enregistrée (${saved.label}).`,
    );
    return Ok(saved);
  }

  // ========================================================================
  // Rooms
  // ========================================================================

  observeRooms(): Observable<Room[]> {
    void this.refreshRooms();
    return this.roomsSubject;
  }

  async createRoom(input: CreateRoomInput, actor: ActorContext): Promise<Result<Room>> {
    const tenantId = getTenantId();
    if (!tenantId) return Err(Errors.validation("createRoom: no active tenant context"));
    const { data, error } = await this.client
      .from("rooms")
      .insert({
        tenant_id: tenantId,
        code: input.code,
        name: input.name,
        room_type: input.roomType,
        capacity: input.capacity ?? null,
        building: input.building ?? null,
        floor_label: input.floorLabel ?? null,
        notes: input.notes ?? null,
      })
      .select()
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    await this.refreshRooms();
    const room = mapRoomRow(data);
    await this.audit(
      "timetable.room_create",
      "room",
      room.id,
      actor,
      { code: room.code, roomType: room.roomType },
      `Salle créée : ${room.code} — ${room.name}.`,
    );
    return Ok(room);
  }

  async updateRoom(
    id: string,
    input: UpdateRoomInput,
    actor: ActorContext,
  ): Promise<Result<Room>> {
    const { data, error } = await this.client
      .from("rooms")
      .update({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.roomType !== undefined ? { room_type: input.roomType } : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
        ...(input.building !== undefined ? { building: input.building } : {}),
        ...(input.floorLabel !== undefined ? { floor_label: input.floorLabel } : {}),
        ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    await this.refreshRooms();
    const room = mapRoomRow(data);
    await this.audit(
      "timetable.room_update",
      "room",
      room.id,
      actor,
      { code: room.code },
      `Salle modifiée : ${room.code}.`,
    );
    return Ok(room);
  }

  async deleteRoom(id: string, actor: ActorContext): Promise<Result<void>> {
    const { error } = await this.client.from("rooms").delete().eq("id", id);
    if (error) return Err(supabaseErrorToAppError(error));
    await this.refreshRooms();
    await this.audit("timetable.room_delete", "room", id, actor, null, "Salle supprimée.");
    return Ok(undefined);
  }

  // ========================================================================
  // Constraints
  // ========================================================================

  observeConstraints(
    academicYearId: string,
  ): Observable<TimetableConstraint[]> {
    const sub = new SubjectBehavior<TimetableConstraint[]>(
      this.constraintsSubject.get().get(academicYearId) ?? [],
    );
    this.constraintsSubject.subscribe((map) => {
      sub.set(map.get(academicYearId) ?? []);
    });
    void this.refreshConstraints(academicYearId);
    return sub;
  }

  async createConstraint(
    input: CreateTimetableConstraintInput,
    actor: ActorContext,
  ): Promise<Result<TimetableConstraint>> {
    const tenantId = getTenantId();
    if (!tenantId) return Err(Errors.validation("createConstraint: no active tenant context"));
    const { data, error } = await this.client
      .from("timetable_constraints")
      .insert({
        tenant_id: tenantId,
        academic_year_id: input.academicYearId,
        scope: input.scope,
        entity_id: input.entityId ?? null,
        kind: input.kind,
        severity: input.severity ?? "hard",
        params: input.params ?? {},
      })
      .select()
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    await this.refreshConstraints(input.academicYearId);
    const constraint = mapConstraintRow(data);
    await this.audit(
      "timetable.constraint_create",
      "timetable_constraint",
      constraint.id,
      actor,
      { kind: constraint.kind, scope: constraint.scope },
      `Contrainte ${constraint.kind} (${constraint.severity}) créée.`,
    );
    return Ok(constraint);
  }

  async updateConstraint(
    id: string,
    input: UpdateTimetableConstraintInput,
    actor: ActorContext,
  ): Promise<Result<TimetableConstraint>> {
    const { data, error } = await this.client
      .from("timetable_constraints")
      .update({
        ...(input.severity !== undefined ? { severity: input.severity } : {}),
        ...(input.params !== undefined ? { params: input.params } : {}),
        ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    await this.refreshConstraints(mapConstraintRow(data).academicYearId);
    const constraint = mapConstraintRow(data);
    await this.audit(
      "timetable.constraint_update",
      "timetable_constraint",
      constraint.id,
      actor,
      { kind: constraint.kind },
      `Contrainte ${constraint.kind} modifiée.`,
    );
    return Ok(constraint);
  }

  async deleteConstraint(id: string, actor: ActorContext): Promise<Result<void>> {
    const { error } = await this.client
      .from("timetable_constraints")
      .delete()
      .eq("id", id);
    if (error) return Err(supabaseErrorToAppError(error));
    await this.audit(
      "timetable.constraint_delete",
      "timetable_constraint",
      id,
      actor,
      null,
      "Contrainte supprimée.",
    );
    return Ok(undefined);
  }

  // ========================================================================
  // Versions + entries
  // ========================================================================

  observeVersions(academicYearId: string): Observable<TimetableVersion[]> {
    const sub = new SubjectBehavior<TimetableVersion[]>(
      this.versionsSubject.get().get(academicYearId) ?? [],
    );
    this.versionsSubject.subscribe((map) => {
      sub.set(map.get(academicYearId) ?? []);
    });
    void this.refreshVersions(academicYearId);
    return sub;
  }

  observeEntries(versionId: string): Observable<TimetableScheduleEntry[]> {
    const sub = new SubjectBehavior<TimetableScheduleEntry[]>(
      this.entriesSubject.get().get(versionId) ?? [],
    );
    this.entriesSubject.subscribe((map) => {
      sub.set(map.get(versionId) ?? []);
    });
    void this.refreshEntries([versionId]);
    return sub;
  }

  observePublishedEntries(
    academicYearId: string,
  ): Observable<TimetableScheduleEntry[]> {
    const sub = new SubjectBehavior<TimetableScheduleEntry[]>(
      this.publishedSubject.get().get(academicYearId) ?? [],
    );
    const refresh = async (): Promise<void> => {
      const { data: version } = await this.client
        .from("timetable_versions")
        .select("id")
        .eq("academic_year_id", academicYearId)
        .eq("status", "published")
        .maybeSingle();
      if (!version) {
        const map = new Map(this.publishedSubject.get());
        map.set(academicYearId, []);
        this.publishedSubject.set(map);
        return;
      }
      const { data } = await this.client
        .from("timetable_entries")
        .select("*")
        .eq("version_id", version.id)
        .order("period_index");
      const map = new Map(this.publishedSubject.get());
      map.set(academicYearId, (data ?? []).map(mapEntryRow));
      this.publishedSubject.set(map);
    };
    this.versionsSubject.subscribe(() => {
      void refresh();
    });
    void refresh();
    return sub;
  }

  // ========================================================================
  // Problem assembly (the canonical academic tables → TimetableProblem)
  // ========================================================================

  private async loadProblem(
    academicYearId: string,
  ): Promise<Result<TimetableProblem>> {
    const tenantId = getTenantId();
    if (!tenantId) {
      return Err(Errors.validation("loadProblem: no active tenant context"));
    }

    const [{ data: cfgRow }, { data: roomRows }, { data: constraintRows }] =
      await Promise.all([
        this.client
          .from("timetable_configurations")
          .select("*")
          .eq("academic_year_id", academicYearId)
          .eq("is_active", true)
          .maybeSingle(),
        this.client.from("rooms").select("*").eq("is_active", true).order("code"),
        this.client
          .from("timetable_constraints")
          .select("*")
          .eq("academic_year_id", academicYearId)
          .eq("is_active", true),
      ]);

    if (!cfgRow) {
      return Err(
        Errors.validation(
          "Aucune configuration d'emploi du temps active pour cette année scolaire — configurez jours et périodes d'abord.",
        ),
      );
    }
    const configuration = mapConfigurationRow(cfgRow);
    const rooms = (roomRows ?? []).map(mapRoomRow);
    const constraints = (constraintRows ?? []).map(mapConstraintRow);

    // Classes of the year (with capacity for room-fit checks).
    const { data: classRows } = await this.client
      .from("classes")
      .select("id, code, name, capacity")
      .eq("academic_year_id", academicYearId)
      .eq("is_active", true)
      .order("code");
    const classes = (classRows ?? []).map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name ?? c.code,
      capacity: c.capacity != null ? Number(c.capacity) : null,
    }));

    // Curriculum: class_subjects joined with subjects (+ classes!inner for
    // the year filter). SCHED-103 (2026-09-22, live-reproduced): NO
    // `personnel!left` embed here — class_subjects.teacher_id has been a
    // BARE uuid since 0004 (its "FK to personnel(id), filled in 0009"
    // comment was never honoured), and PostgREST embeds require a real FK
    // constraint (PGRST200 → HTTP 400). Until migration 0112 lands, teacher
    // names are resolved from the personnel fetch below — the same rows
    // already power the `teachers` list (zero extra round-trips).
    const { data: csRows, error: csError } = await this.client
      .from("class_subjects")
      .select(
        "class_id, subject_id, teacher_id, weekly_hours, consecutive_periods, required_room_type, subjects(code, name_fr), classes!inner(code, name, capacity, academic_year_id)",
      )
      .eq("classes.academic_year_id", academicYearId)
      .eq("is_active", true);
    if (csError) return Err(supabaseErrorToAppError(csError));

    // Teachers referenced by requirements (deduplicated personnel) —
    // fetched ONCE, reused both for the problem's teachers list and for
    // each requirement's teacherName.
    const rawRows = csRows ?? [];
    const teacherIds = [
      ...new Set(rawRows.map((r: any) => r.teacher_id).filter((t): t is string => !!t)),
    ];
    const teacherNameById = new Map<string, string>();
    const teachers: Array<{ id: string; name: string }> = [];
    if (teacherIds.length > 0) {
      const { data: personRows } = await this.client
        .from("personnel")
        .select("id, first_name, last_name")
        .in("id", teacherIds);
      for (const p of personRows ?? []) {
        const name = `${p.first_name} ${p.last_name}`;
        teacherNameById.set(p.id, name);
        teachers.push({ id: p.id, name });
      }
    }

    const requirements: TimetableRequirement[] = rawRows.map((r: any) => ({
      classId: r.class_id,
      subjectId: r.subject_id,
      teacherId: r.teacher_id ?? null,
      weeklyHours: Number(r.weekly_hours ?? 2),
      consecutivePeriods: Math.max(1, Math.min(4, Number(r.consecutive_periods ?? 1))),
      requiredRoomType:
        r.required_room_type && (ROOM_TYPES as readonly string[]).includes(r.required_room_type)
          ? (r.required_room_type as RoomType)
          : null,
      className: r.classes?.name ?? r.classes?.code ?? r.class_id,
      subjectName: r.subjects?.name_fr ?? r.subject_id,
      teacherName: r.teacher_id ? (teacherNameById.get(r.teacher_id) ?? null) : null,
      classSize: r.classes?.capacity != null ? Number(r.classes.capacity) : null,
    }));

    return Ok({
      configuration,
      classes,
      teachers,
      rooms,
      requirements,
      constraints,
      lockedEntries: [],
    });
  }

  // ========================================================================
  // Generation
  // ========================================================================

  async generateTimetable(
    options: GenerateTimetableOptions,
    actor: ActorContext,
  ): Promise<Result<TimetableVersion>> {
    const tenantId = getTenantId();
    if (!tenantId) {
      return Err(Errors.validation("generateTimetable: no active tenant context"));
    }
    const problemResult = await this.loadProblem(options.academicYearId);
    if (!problemResult.ok) return problemResult;
    const baseProblem = problemResult.value;

    const solver = getTimetableSolver(options.solverId ?? GREEDY_SOLVER_ID);
    if (!solver) {
      return Err(
        Errors.notFound("TimetableSolver", options.solverId ?? GREEDY_SOLVER_ID),
      );
    }

    // Locked pins from the source version (manual adjustments survive).
    let locked: TimetableSlotAssignment[] = [];
    if (options.fromVersionId) {
      const { data: lockedRows } = await this.client
        .from("timetable_entries")
        .select("*")
        .eq("version_id", options.fromVersionId)
        .eq("is_locked", true);
      locked = (lockedRows ?? []).map((r) => slotAssignmentFromEntry(mapEntryRow(r)));
    }

    const problem: TimetableProblem = { ...baseProblem, lockedEntries: locked };
    const solution = solver.solve(problem);

    // Version number: max + 1 for the year.
    const { data: maxRow } = await this.client
      .from("timetable_versions")
      .select("version_number")
      .eq("academic_year_id", options.academicYearId)
      .order("version_number", { ascending: false })
      .limit(1);
    const versionNumber = (maxRow && maxRow.length > 0 ? Number(maxRow[0].version_number) : 0) + 1;

    const now = new Date().toISOString();
    const { data: versionRow, error: versionError } = await this.client
      .from("timetable_versions")
      .insert({
        tenant_id: tenantId,
        academic_year_id: options.academicYearId,
        version_number: versionNumber,
        status: "draft",
        label: options.label ?? `Essai ${versionNumber}`,
        solver_id: solver.id,
        solver_build: solver.build,
        generation_params: {
          fromVersionId: options.fromVersionId ?? null,
          lockedEntries: locked.length,
          unplacedReasons: solution.unplaced.map((u) => ({
            classId: u.requirement.classId,
            subjectId: u.requirement.subjectId,
            reason: u.reason,
          })),
        },
        statistics: {
          ...solution.statistics,
          violations: solution.violations.map((v) => ({
            severity: v.severity,
            kind: v.kind,
            message: v.message,
          })),
        },
        hard_violation_count: solution.statistics.hardViolationCount,
        soft_violation_count: solution.statistics.softViolationCount,
        unplaced_count: solution.statistics.unplacedCount,
        created_by: isUuid(actor.actorId) ? actor.actorId : null,
        created_by_name: actor.actorName,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();
    if (versionError) return Err(supabaseErrorToAppError(versionError));
    const version = mapVersionRow(versionRow);

    // Entries (batched insert).
    const periodByIndex = new Map(
      problem.configuration.periods.map((p) => [p.index, p]),
    );
    const rows = solution.entries.map((slot) => {
      const period = periodByIndex.get(slot.periodIndex);
      const isLockedPin = locked.some(
        (l) =>
          l.classId === slot.classId &&
          l.subjectId === slot.subjectId &&
          l.day === slot.day &&
          l.periodIndex === slot.periodIndex,
      );
      return {
        tenant_id: tenantId,
        academic_year_id: options.academicYearId,
        version_id: version.id,
        class_id: slot.classId,
        subject_id: slot.subjectId,
        teacher_id: slot.teacherId,
        room_id: slot.roomId,
        day: slot.day,
        period_index: slot.periodIndex,
        start_minutes: period?.startMinutes ?? 0,
        end_minutes: period?.endMinutes ?? 0,
        lesson_group: slot.lessonGroup,
        is_locked: isLockedPin,
        source: isLockedPin ? "manual" : "generated",
      };
    });
    // Insert in chunks (PostgREST payload limits).
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error: entryError } = await this.client
        .from("timetable_entries")
        .insert(rows.slice(i, i + CHUNK));
      if (entryError) return Err(supabaseErrorToAppError(entryError));
    }

    await this.refreshVersions(options.academicYearId);
    await this.refreshEntries([version.id]);
    await this.audit(
      "timetable.version_generate",
      "timetable_version",
      version.id,
      actor,
      {
        versionNumber,
        solverId: solver.id,
        placed: solution.statistics.placedPeriods,
        unplaced: solution.statistics.unplacedCount,
        hardViolations: solution.statistics.hardViolationCount,
      },
      `Génération d'emploi du temps (essai ${versionNumber}, solveur ${solver.id}) : ${solution.statistics.placedPeriods} périodes placées, ${solution.statistics.unplacedCount} non placées.`,
    );
    return Ok(version);
  }

  // ========================================================================
  // Workflow
  // ========================================================================

  private async transition(
    versionId: string,
    to: TimetableVersionStatus,
    actor: ActorContext,
    note?: string | null,
    action: string = "timetable.version_transition",
  ): Promise<Result<TimetableVersion>> {
    const { data: row, error } = await this.client
      .from("timetable_versions")
      .select("*")
      .eq("id", versionId)
      .maybeSingle();
    if (error) return Err(supabaseErrorToAppError(error));
    if (!row) return Err(Errors.notFound("TimetableVersion", versionId));
    const current = mapVersionRow(row);
    const guard = assertTransitionAllowed(current.status, to);
    if (guard) return Err(Errors.validation(guard));

    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await this.client
      .from("timetable_versions")
      .update({
        status: to,
        ...(to === "in_review" || to === "rejected"
          ? {
              reviewed_by: isUuid(actor.actorId) ? actor.actorId : null,
              reviewed_at: now,
              review_note: note ?? null,
            }
          : {}),
        ...(to === "approved"
          ? {
              approved_by: isUuid(actor.actorId) ? actor.actorId : null,
              approved_at: now,
            }
          : {}),
        updated_at: now,
      })
      .eq("id", versionId)
      .select()
      .single();
    if (updateError) return Err(supabaseErrorToAppError(updateError));
    await this.refreshVersions(current.academicYearId);
    const version = mapVersionRow(updated);
    await this.audit(
      action,
      "timetable_version",
      version.id,
      actor,
      { from: current.status, to },
      `Version ${version.versionNumber} : ${current.status} → ${to}.`,
    );
    return Ok(version);
  }

  async submitForReview(
    versionId: string,
    actor: ActorContext,
    note?: string | null,
  ): Promise<Result<TimetableVersion>> {
    return this.transition(versionId, "in_review", actor, note, "timetable.version_submit_review");
  }

  async approveVersion(
    versionId: string,
    actor: ActorContext,
    note?: string | null,
  ): Promise<Result<TimetableVersion>> {
    return this.transition(versionId, "approved", actor, note, "timetable.version_approve");
  }

  async rejectVersion(
    versionId: string,
    actor: ActorContext,
    note?: string | null,
  ): Promise<Result<TimetableVersion>> {
    return this.transition(versionId, "rejected", actor, note, "timetable.version_reject");
  }

  async publishVersion(
    versionId: string,
    actor: ActorContext,
  ): Promise<Result<TimetableVersion>> {
    // The canonical RPC (0109 §7): atomic approved→published + archive.
    const { data, error } = await this.client.rpc("fn_timetable_publish", {
      p_version_id: versionId,
      p_actor_profile_id: isUuid(actor.actorId) ? actor.actorId : null,
      p_actor_name: actor.actorName,
    });
    if (error) return Err(supabaseErrorToAppError(error));
    const res = data as { ok?: boolean; message?: string };
    if (!res || res.ok !== true) {
      return Err(
        Errors.validation(res?.message ?? "La publication a échoué."),
      );
    }
    const { data: row } = await this.client
      .from("timetable_versions")
      .select("*")
      .eq("id", versionId)
      .maybeSingle();
    if (!row) return Err(Errors.notFound("TimetableVersion", versionId));
    const version = mapVersionRow(row);
    await this.refreshVersions(version.academicYearId);
    return Ok(version);
  }

  async duplicateVersionToDraft(
    versionId: string,
    actor: ActorContext,
    label?: string | null,
  ): Promise<Result<TimetableVersion>> {
    const problemResult = await this.loadProblemForCopy(versionId);
    if (!problemResult.ok) return problemResult;
    const { source, entries } = problemResult.value;

    const tenantId = getTenantId();
    if (!tenantId) return Err(Errors.validation("duplicateVersionToDraft: no active tenant context"));

    const { data: maxRow } = await this.client
      .from("timetable_versions")
      .select("version_number")
      .eq("academic_year_id", source.academicYearId)
      .order("version_number", { ascending: false })
      .limit(1);
    const versionNumber =
      (maxRow && maxRow.length > 0 ? Number(maxRow[0].version_number) : 0) + 1;
    const now = new Date().toISOString();

    const { data: versionRow, error: versionError } = await this.client
      .from("timetable_versions")
      .insert({
        tenant_id: tenantId,
        academic_year_id: source.academicYearId,
        version_number: versionNumber,
        status: "draft",
        label: label ?? `Copie de ${source.label ?? `v${source.versionNumber}`}`,
        solver_id: source.solverId,
        solver_build: source.solverBuild,
        generation_params: { duplicatedFrom: source.id },
        statistics: source.statistics,
        hard_violation_count: source.hardViolationCount,
        soft_violation_count: source.softViolationCount,
        unplaced_count: source.unplacedCount,
        created_by: isUuid(actor.actorId) ? actor.actorId : null,
        created_by_name: actor.actorName,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();
    if (versionError) return Err(supabaseErrorToAppError(versionError));
    const copy = mapVersionRow(versionRow);

    const rows = entries.map((e) => ({
      tenant_id: tenantId,
      academic_year_id: e.academicYearId,
      version_id: copy.id,
      class_id: e.classId,
      subject_id: e.subjectId,
      teacher_id: e.teacherId,
      room_id: e.roomId,
      day: e.day,
      period_index: e.periodIndex,
      start_minutes: e.startMinutes,
      end_minutes: e.endMinutes,
      lesson_group: e.lessonGroup,
      is_locked: e.isLocked,
      source: e.source,
      notes: e.notes,
    }));
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error: entryError } = await this.client
        .from("timetable_entries")
        .insert(rows.slice(i, i + CHUNK));
      if (entryError) return Err(supabaseErrorToAppError(entryError));
    }

    await this.refreshVersions(source.academicYearId);
    await this.refreshEntries([copy.id]);
    await this.audit(
      "timetable.version_duplicate",
      "timetable_version",
      copy.id,
      actor,
      { fromVersionId: source.id, entries: rows.length },
      `Version ${source.versionNumber} dupliquée en brouillon ${versionNumber}.`,
    );
    return Ok(copy);
  }

  private async loadProblemForCopy(
    versionId: string,
  ): Promise<Result<{ source: TimetableVersion; entries: TimetableScheduleEntry[] }>> {
    const { data: row } = await this.client
      .from("timetable_versions")
      .select("*")
      .eq("id", versionId)
      .maybeSingle();
    if (!row) return Err(Errors.notFound("TimetableVersion", versionId));
    const source = mapVersionRow(row);
    const { data: entryRows } = await this.client
      .from("timetable_entries")
      .select("*")
      .eq("version_id", versionId)
      .order("period_index");
    return Ok({ source, entries: (entryRows ?? []).map(mapEntryRow) });
  }

  // ========================================================================
  // Manual adjustment (live validation)
  // ========================================================================

  private async loadProblemForValidation(
    academicYearId: string,
  ): Promise<Result<TimetableProblem>> {
    // The SAME problem assembly as generation — one canonical read model.
    return this.loadProblem(academicYearId);
  }

  async moveEntry(
    entryId: string,
    input: MoveTimetableEntryInput,
    actor: ActorContext,
  ): Promise<Result<TimetableScheduleEntry>> {
    const { data: row } = await this.client
      .from("timetable_entries")
      .select("*")
      .eq("id", entryId)
      .maybeSingle();
    if (!row) return Err(Errors.notFound("TimetableEntry", entryId));
    const before = mapEntryRow(row);

    const { data: versionRow } = await this.client
      .from("timetable_versions")
      .select("id, academic_year_id, status")
      .eq("id", before.versionId)
      .maybeSingle();
    if (!versionRow) return Err(Errors.notFound("TimetableVersion", before.versionId));
    if (versionRow.status === "published" || versionRow.status === "archived") {
      return Err(
        Errors.validation(
          "Les versions publiées/archivées sont figées — dupliquez la version en brouillon pour l'ajuster.",
        ),
      );
    }

    const after: TimetableScheduleEntry = {
      ...before,
      ...(input.day !== undefined ? { day: input.day } : {}),
      ...(input.periodIndex !== undefined ? { periodIndex: input.periodIndex } : {}),
      ...(input.roomId !== undefined ? { roomId: input.roomId } : {}),
      ...(input.teacherId !== undefined ? { teacherId: input.teacherId } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    };

    // LIVE VALIDATION — the canonical engine over the candidate schedule.
    const problemResult = await this.loadProblemForValidation(
      versionRow.academic_year_id,
    );
    if (problemResult.ok) {
      const { data: siblings } = await this.client
        .from("timetable_entries")
        .select("*")
        .eq("version_id", before.versionId);
      const candidate = (siblings ?? [])
        .filter((r) => r.id !== entryId)
        .map((r) => slotAssignmentFromEntry(mapEntryRow(r)));
      candidate.push(slotAssignmentFromEntry(after));
      const hard = validateTimetable(problemResult.value, candidate).filter(
        (v) => v.severity === "hard",
      );
      if (hard.length > 0) {
        return Err(Errors.validation(hard.map((v) => v.message).join(" ")));
      }
    }

    const period = problemResult.ok
      ? problemResult.value.configuration.periods.find(
          (p) => p.index === after.periodIndex,
        )
      : undefined;

    const { data: updated, error } = await this.client
      .from("timetable_entries")
      .update({
        day: after.day,
        period_index: after.periodIndex,
        ...(period ? { start_minutes: period.startMinutes, end_minutes: period.endMinutes } : {}),
        room_id: after.roomId,
        teacher_id: after.teacherId,
        notes: after.notes,
        is_locked: true,
        source: "manual",
        updated_at: new Date().toISOString(),
      })
      .eq("id", entryId)
      .select()
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    const entry = mapEntryRow(updated);
    await this.refreshEntries([before.versionId]);
    await this.audit(
      "timetable.entry_move",
      "timetable_entry",
      entry.id,
      actor,
      { from: `${before.day}#p${before.periodIndex}`, to: `${after.day}#p${after.periodIndex}` },
      `Cours déplacé (${before.day} p${before.periodIndex} → ${after.day} p${after.periodIndex}).`,
    );
    return Ok(entry);
  }

  async createEntry(
    versionId: string,
    input: {
      classId: string;
      subjectId: string;
      teacherId?: string | null;
      roomId?: string | null;
      day: TimetableDay;
      periodIndex: number;
      notes?: string | null;
    },
    actor: ActorContext,
  ): Promise<Result<TimetableScheduleEntry>> {
    const tenantId = getTenantId();
    if (!tenantId) return Err(Errors.validation("createEntry: no active tenant context"));
    const { data: versionRow } = await this.client
      .from("timetable_versions")
      .select("id, academic_year_id, status")
      .eq("id", versionId)
      .maybeSingle();
    if (!versionRow) return Err(Errors.notFound("TimetableVersion", versionId));
    if (versionRow.status === "published" || versionRow.status === "archived") {
      return Err(
        Errors.validation(
          "Les versions publiées/archivées sont figées — dupliquez la version en brouillon pour l'ajuster.",
        ),
      );
    }

    const problemResult = await this.loadProblemForValidation(
      versionRow.academic_year_id,
    );
    const period = problemResult.ok
      ? problemResult.value.configuration.periods.find(
          (p) => p.index === input.periodIndex,
        )
      : undefined;

    if (problemResult.ok) {
      const { data: siblings } = await this.client
        .from("timetable_entries")
        .select("*")
        .eq("version_id", versionId);
      const candidate = (siblings ?? []).map((r) =>
        slotAssignmentFromEntry(mapEntryRow(r)),
      );
      candidate.push({
        classId: input.classId,
        subjectId: input.subjectId,
        teacherId: input.teacherId ?? null,
        roomId: input.roomId ?? null,
        day: input.day,
        periodIndex: input.periodIndex,
        lessonGroup: 0,
      });
      const hard = validateTimetable(problemResult.value, candidate).filter(
        (v) => v.severity === "hard",
      );
      if (hard.length > 0) {
        return Err(Errors.validation(hard.map((v) => v.message).join(" ")));
      }
    }

    const now = new Date().toISOString();
    const { data, error } = await this.client
      .from("timetable_entries")
      .insert({
        tenant_id: tenantId,
        academic_year_id: versionRow.academic_year_id,
        version_id: versionId,
        class_id: input.classId,
        subject_id: input.subjectId,
        teacher_id: input.teacherId ?? null,
        room_id: input.roomId ?? null,
        day: input.day,
        period_index: input.periodIndex,
        start_minutes: period?.startMinutes ?? 0,
        end_minutes: period?.endMinutes ?? 0,
        lesson_group: 0,
        is_locked: true,
        source: "manual",
        notes: input.notes ?? null,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    const entry = mapEntryRow(data);
    await this.refreshEntries([versionId]);
    await this.audit(
      "timetable.entry_create",
      "timetable_entry",
      entry.id,
      actor,
      { day: entry.day, periodIndex: entry.periodIndex },
      `Cours ajouté manuellement (${entry.day} p${entry.periodIndex}).`,
    );
    return Ok(entry);
  }

  async setEntryLocked(
    entryId: string,
    locked: boolean,
    actor: ActorContext,
  ): Promise<Result<TimetableScheduleEntry>> {
    const { data, error } = await this.client
      .from("timetable_entries")
      .update({ is_locked: locked, updated_at: new Date().toISOString() })
      .eq("id", entryId)
      .select()
      .single();
    if (error) return Err(supabaseErrorToAppError(error));
    const entry = mapEntryRow(data);
    await this.refreshEntries([entry.versionId]);
    await this.audit(
      "timetable.entry_lock",
      "timetable_entry",
      entry.id,
      actor,
      { locked },
      locked ? "Cours épinglé (conservé à la régénération)." : "Épingle retirée.",
    );
    return Ok(entry);
  }

  async deleteEntry(entryId: string, actor: ActorContext): Promise<Result<void>> {
    const { data: row } = await this.client
      .from("timetable_entries")
      .select("id, version_id")
      .eq("id", entryId)
      .maybeSingle();
    if (!row) return Err(Errors.notFound("TimetableEntry", entryId));
    const { data: versionRow } = await this.client
      .from("timetable_versions")
      .select("status")
      .eq("id", row.version_id)
      .maybeSingle();
    if (versionRow && (versionRow.status === "published" || versionRow.status === "archived")) {
      return Err(
        Errors.validation(
          "Les versions publiées/archivées sont figées — dupliquez la version en brouillon pour l'ajuster.",
        ),
      );
    }
    const { error } = await this.client
      .from("timetable_entries")
      .delete()
      .eq("id", entryId);
    if (error) return Err(supabaseErrorToAppError(error));
    await this.refreshEntries([row.version_id]);
    await this.audit(
      "timetable.entry_delete",
      "timetable_entry",
      entryId,
      actor,
      null,
      "Cours supprimé manuellement.",
    );
    return Ok(undefined);
  }
}
