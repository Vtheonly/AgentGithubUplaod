// ============================================================================
// FILE: src/infrastructure/mock/repositories/timetable-repository.ts
// ============================================================================
/**
 * The in-memory TimetableRepository — T-404 (ADR-020).
 *
 * Mirrors the Supabase contract exactly (same workflow guards, same live
 * validation via the canonical engine) for mock-mode development and unit
 * tests. The generation path CONSUMES the real solver registry — mock mode
 * exercises the SAME algorithm as production, only the persistence differs.
 */

import type { Observable } from "../../../domain/repository/repository";
import type { Result } from "../../../core/result";
import { Ok, Err } from "../../../core/result";
import { Errors } from "../../../core/app-error";
import { SubjectBehavior } from "../subject-behavior";
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
  TimetableConfiguration,
  TimetableConstraint,
  TimetableDay,
  TimetableProblem,
  TimetableRequirement,
  TimetableScheduleEntry,
  TimetableSolution,
  TimetableVersion,
} from "../../../domain/model/timetable";
import {
  parseTimetableDay,
  slotAssignmentFromEntry,
} from "../../../domain/model/timetable";
import { validateTimetable } from "../../../domain/calc/timetable/constraints";
import {
  getTimetableSolver,
  GREEDY_SOLVER_ID,
} from "../../../domain/calc/timetable/solver";
import { algerianDefaultConfiguration } from "../../../domain/calc/timetable/algerian-profile";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-mock-${idCounter}`;
}

interface MockStore {
  configurations: TimetableConfiguration[];
  rooms: Room[];
  constraints: TimetableConstraint[];
  versions: TimetableVersion[];
  entries: TimetableScheduleEntry[];
}

const store: MockStore = {
  configurations: [],
  rooms: [],
  constraints: [],
  versions: [],
  entries: [],
};

export class MockTimetableRepository implements TimetableRepository {
  private readonly configSubject =
    new SubjectBehavior<Map<string, TimetableConfiguration | null>>(new Map());
  private readonly roomsSubject = new SubjectBehavior<Room[]>([]);
  private readonly constraintsSubject =
    new SubjectBehavior<Map<string, TimetableConstraint[]>>(new Map());
  private readonly versionsSubject =
    new SubjectBehavior<Map<string, TimetableVersion[]>>(new Map());
  private readonly entriesSubject =
    new SubjectBehavior<Map<string, TimetableScheduleEntry[]>>(new Map());

  // Seed the Algerian default per academic year on first observe (mirrors
  // the 0109 §10 live seed).
  private ensureSeededConfig(academicYearId: string): void {
    if (
      !store.configurations.some(
        (c) => c.academicYearId === academicYearId && c.isActive,
      )
    ) {
      store.configurations.push(
        algerianDefaultConfiguration(TENANT_ID, academicYearId),
      );
    }
  }

  private notifyConfig(academicYearId: string): void {
    this.ensureSeededConfig(academicYearId);
    const active = store.configurations.find(
      (c) => c.academicYearId === academicYearId && c.isActive,
    );
    const map = new Map(this.configSubject.get());
    map.set(academicYearId, active ?? null);
    this.configSubject.set(map);
  }
  private notifyRooms(): void {
    this.roomsSubject.set([...store.rooms]);
  }
  private notifyConstraints(academicYearId: string): void {
    const map = new Map(this.constraintsSubject.get());
    map.set(
      academicYearId,
      store.constraints.filter((c) => c.academicYearId === academicYearId),
    );
    this.constraintsSubject.set(map);
  }
  private notifyVersions(academicYearId: string): void {
    const map = new Map(this.versionsSubject.get());
    map.set(
      academicYearId,
      store.versions
        .filter((v) => v.academicYearId === academicYearId)
        .sort((a, b) => b.versionNumber - a.versionNumber),
    );
    this.versionsSubject.set(map);
  }
  private notifyEntries(): void {
    const byVersion = new Map<string, TimetableScheduleEntry[]>();
    for (const e of store.entries) {
      byVersion.set(e.versionId, [...(byVersion.get(e.versionId) ?? []), e]);
    }
    this.entriesSubject.set(byVersion);
  }

  // ========================================================================
  // Configuration
  // ========================================================================

  observeConfiguration(
    academicYearId: string,
  ): Observable<TimetableConfiguration | null> {
    const sub = new SubjectBehavior<TimetableConfiguration | null>(
      (() => {
        this.ensureSeededConfig(academicYearId);
        return store.configurations.find(
          (c) => c.academicYearId === academicYearId && c.isActive,
        ) ?? null;
      })(),
    );
    this.configSubject.subscribe((map) => {
      sub.set(map.get(academicYearId) ?? null);
    });
    this.notifyConfig(academicYearId);
    return sub;
  }

  async saveConfiguration(
    input: SaveTimetableConfigurationInput,
    _actor: ActorContext,
  ): Promise<Result<TimetableConfiguration>> {
    if (input.periods.length === 0) {
      return Err(Errors.validation("La configuration doit définir au moins une période."));
    }
    const existing = store.configurations.find(
      (c) => c.academicYearId === input.academicYearId && c.isActive,
    );
    const now = new Date().toISOString();
    const saved: TimetableConfiguration = {
      id: existing?.id ?? nextId("tt-cfg"),
      tenantId: TENANT_ID,
      academicYearId: input.academicYearId,
      label: input.label,
      schoolDays: [...input.schoolDays],
      periods: input.periods.map((p) => ({ ...p })),
      breaks: input.breaks.map((b) => ({ ...b })),
      defaultLessonMinutes: input.defaultLessonMinutes,
      maxPeriodsPerDay: input.maxPeriodsPerDay,
      isActive: input.isActive ?? true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (existing) {
      const idx = store.configurations.indexOf(existing);
      store.configurations[idx] = saved;
    } else {
      store.configurations.push(saved);
    }
    this.notifyConfig(input.academicYearId);
    return Ok(saved);
  }

  // ========================================================================
  // Rooms
  // ========================================================================

  observeRooms(): Observable<Room[]> {
    this.notifyRooms();
    return this.roomsSubject;
  }

  async createRoom(
    input: CreateRoomInput,
    _actor: ActorContext,
  ): Promise<Result<Room>> {
    if (store.rooms.some((r) => r.code === input.code)) {
      return Err(Errors.validation(`Le code salle « ${input.code} » existe déjà.`));
    }
    const now = new Date().toISOString();
    const room: Room = {
      id: nextId("tt-room"),
      tenantId: TENANT_ID,
      code: input.code,
      name: input.name,
      roomType: input.roomType,
      capacity: input.capacity ?? null,
      building: input.building ?? null,
      floorLabel: input.floorLabel ?? null,
      isActive: true,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    store.rooms.push(room);
    this.notifyRooms();
    return Ok(room);
  }

  async updateRoom(
    id: string,
    input: UpdateRoomInput,
    _actor: ActorContext,
  ): Promise<Result<Room>> {
    const idx = store.rooms.findIndex((r) => r.id === id);
    if (idx < 0) return Err(Errors.notFound("Room", id));
    const before = store.rooms[idx];
    store.rooms[idx] = {
      ...before,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.roomType !== undefined ? { roomType: input.roomType } : {}),
      ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
      ...(input.building !== undefined ? { building: input.building } : {}),
      ...(input.floorLabel !== undefined ? { floorLabel: input.floorLabel } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      updatedAt: new Date().toISOString(),
    };
    this.notifyRooms();
    return Ok(store.rooms[idx]);
  }

  async deleteRoom(id: string, _actor: ActorContext): Promise<Result<void>> {
    store.rooms = store.rooms.filter((r) => r.id !== id);
    this.notifyRooms();
    return Ok(undefined);
  }

  // ========================================================================
  // Constraints
  // ========================================================================

  observeConstraints(
    academicYearId: string,
  ): Observable<TimetableConstraint[]> {
    const sub = new SubjectBehavior<TimetableConstraint[]>(
      store.constraints.filter((c) => c.academicYearId === academicYearId),
    );
    this.constraintsSubject.subscribe((map) => {
      sub.set(map.get(academicYearId) ?? []);
    });
    this.notifyConstraints(academicYearId);
    return sub;
  }

  async createConstraint(
    input: CreateTimetableConstraintInput,
    _actor: ActorContext,
  ): Promise<Result<TimetableConstraint>> {
    const now = new Date().toISOString();
    const constraint: TimetableConstraint = {
      id: nextId("tt-ctr"),
      tenantId: TENANT_ID,
      academicYearId: input.academicYearId,
      scope: input.scope,
      entityId: input.entityId ?? null,
      kind: input.kind,
      severity: input.severity ?? "hard",
      params: input.params ?? {},
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    store.constraints.push(constraint);
    this.notifyConstraints(input.academicYearId);
    return Ok(constraint);
  }

  async updateConstraint(
    id: string,
    input: UpdateTimetableConstraintInput,
    _actor: ActorContext,
  ): Promise<Result<TimetableConstraint>> {
    const idx = store.constraints.findIndex((c) => c.id === id);
    if (idx < 0) return Err(Errors.notFound("TimetableConstraint", id));
    store.constraints[idx] = {
      ...store.constraints[idx],
      ...(input.severity !== undefined ? { severity: input.severity } : {}),
      ...(input.params !== undefined ? { params: input.params } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      updatedAt: new Date().toISOString(),
    };
    this.notifyConstraints(store.constraints[idx].academicYearId);
    return Ok(store.constraints[idx]);
  }

  async deleteConstraint(id: string, _actor: ActorContext): Promise<Result<void>> {
    const removed = store.constraints.find((c) => c.id === id);
    store.constraints = store.constraints.filter((c) => c.id !== id);
    if (removed) this.notifyConstraints(removed.academicYearId);
    return Ok(undefined);
  }

  // ========================================================================
  // Versions + entries
  // ========================================================================

  observeVersions(academicYearId: string): Observable<TimetableVersion[]> {
    const sub = new SubjectBehavior<TimetableVersion[]>(
      store.versions
        .filter((v) => v.academicYearId === academicYearId)
        .sort((a, b) => b.versionNumber - a.versionNumber),
    );
    this.versionsSubject.subscribe((map) => {
      sub.set(map.get(academicYearId) ?? []);
    });
    this.notifyVersions(academicYearId);
    return sub;
  }

  observeEntries(versionId: string): Observable<TimetableScheduleEntry[]> {
    const sub = new SubjectBehavior<TimetableScheduleEntry[]>(
      store.entries.filter((e) => e.versionId === versionId),
    );
    this.entriesSubject.subscribe((map) => {
      sub.set(map.get(versionId) ?? []);
    });
    this.notifyEntries();
    return sub;
  }

  observePublishedEntries(
    academicYearId: string,
  ): Observable<TimetableScheduleEntry[]> {
    const sub = new SubjectBehavior<TimetableScheduleEntry[]>(
      this.publishedEntriesOf(academicYearId),
    );
    this.entriesSubject.subscribe(() => {
      sub.set(this.publishedEntriesOf(academicYearId));
    });
    this.notifyEntries();
    return sub;
  }

  private publishedEntriesOf(academicYearId: string): TimetableScheduleEntry[] {
    const published = store.versions.find(
      (v) => v.academicYearId === academicYearId && v.status === "published",
    );
    if (!published) return [];
    return store.entries.filter((e) => e.versionId === published.id);
  }

  // ========================================================================
  // Problem assembly (shared by generation + live validation)
  // ========================================================================

  /**
   * MOCK MODE: the problem is assembled from explicit test-provided data
   * (the mock store has no classes/subjects/teachers of its own). The
   * Supabase repository builds it from the canonical academic tables.
   */
  buildProblem(
    academicYearId: string,
    problem: Omit<TimetableProblem, "configuration" | "constraints" | "rooms">,
  ): TimetableProblem {
    this.ensureSeededConfig(academicYearId);
    const config =
      store.configurations.find(
        (c) => c.academicYearId === academicYearId && c.isActive,
      ) ?? null;
    if (!config) {
      throw new Error("No active timetable configuration (mock).");
    }
    return {
      configuration: config,
      constraints: store.constraints.filter(
        (c) => c.academicYearId === academicYearId && c.isActive,
      ),
      rooms: store.rooms,
      ...problem,
    };
  }

  // ========================================================================
  // Generation
  // ========================================================================

  async generateTimetable(
    options: GenerateTimetableOptions,
    actor: ActorContext,
    problem?: TimetableProblem,
  ): Promise<Result<TimetableVersion>> {
    if (!problem) {
      return Err(
        Errors.validation(
          "Le dépôt mock exige un problème explicite (buildProblem) pour la génération.",
        ),
      );
    }
    const solver = getTimetableSolver(options.solverId ?? GREEDY_SOLVER_ID);
    if (!solver) {
      return Err(Errors.notFound("TimetableSolver", options.solverId ?? GREEDY_SOLVER_ID));
    }

    const lockedSource = options.fromVersionId
      ? store.entries.filter(
          (e) => e.versionId === options.fromVersionId && e.isLocked,
        )
      : [];
    const locked = lockedSource.map((e) => slotAssignmentFromEntry(e));

    const solution: TimetableSolution = solver.solve({
      ...problem,
      lockedEntries: locked,
    });

    const now = new Date().toISOString();
    const versionNumber =
      Math.max(
        0,
        ...store.versions
          .filter((v) => v.academicYearId === options.academicYearId)
          .map((v) => v.versionNumber),
      ) + 1;

    const version: TimetableVersion = {
      id: nextId("tt-ver"),
      tenantId: TENANT_ID,
      academicYearId: options.academicYearId,
      versionNumber,
      status: "draft",
      label: options.label ?? `Essai ${versionNumber}`,
      solverId: solver.id,
      solverBuild: solver.build,
      generationParams: {
        fromVersionId: options.fromVersionId ?? null,
        lockedEntries: locked.length,
      },
      statistics: solution.statistics as unknown as Record<string, unknown>,
      hardViolationCount: solution.statistics.hardViolationCount,
      softViolationCount: solution.statistics.softViolationCount,
      unplacedCount: solution.statistics.unplacedCount,
      createdBy: actor.actorId,
      createdByName: actor.actorName,
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
      approvedBy: null,
      approvedAt: null,
      publishedBy: null,
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    store.versions.push(version);

    const periodByIndex = new Map(
      problem.configuration.periods.map((p) => [p.index, p]),
    );
    for (const slot of solution.entries) {
      const period = periodByIndex.get(slot.periodIndex);
      const isLockedPin = locked.some(
        (l) =>
          l.classId === slot.classId &&
          l.subjectId === slot.subjectId &&
          l.day === slot.day &&
          l.periodIndex === slot.periodIndex,
      );
      store.entries.push({
        id: nextId("tt-ent"),
        tenantId: TENANT_ID,
        academicYearId: options.academicYearId,
        versionId: version.id,
        classId: slot.classId,
        subjectId: slot.subjectId,
        teacherId: slot.teacherId,
        roomId: slot.roomId,
        day: slot.day,
        periodIndex: slot.periodIndex,
        startMinutes: period?.startMinutes ?? 0,
        endMinutes: period?.endMinutes ?? 0,
        lessonGroup: slot.lessonGroup,
        isLocked: isLockedPin,
        source: isLockedPin ? "manual" : "generated",
        notes: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    this.notifyVersions(options.academicYearId);
    this.notifyEntries();
    return Ok(version);
  }

  // ========================================================================
  // Workflow
  // ========================================================================

  private async transition(
    versionId: string,
    to: TimetableVersion["status"],
    actor: ActorContext,
    note?: string | null,
  ): Promise<Result<TimetableVersion>> {
    const idx = store.versions.findIndex((v) => v.id === versionId);
    if (idx < 0) return Err(Errors.notFound("TimetableVersion", versionId));
    const version = store.versions[idx];
    const guard = assertTransitionAllowed(version.status, to);
    if (guard) return Err(Errors.validation(guard));
    const now = new Date().toISOString();
    store.versions[idx] = {
      ...version,
      status: to,
      ...(to === "in_review" || to === "rejected"
        ? { reviewedBy: actor.actorId, reviewedAt: now, reviewNote: note ?? null }
        : {}),
      ...(to === "approved" ? { approvedBy: actor.actorId, approvedAt: now } : {}),
      ...(to === "published" ? { publishedBy: actor.actorId, publishedAt: now } : {}),
      updatedAt: now,
    };
    this.notifyVersions(version.academicYearId);
    return Ok(store.versions[idx]);
  }

  async submitForReview(
    versionId: string,
    actor: ActorContext,
    note?: string | null,
  ): Promise<Result<TimetableVersion>> {
    return this.transition(versionId, "in_review", actor, note);
  }

  async approveVersion(
    versionId: string,
    actor: ActorContext,
    note?: string | null,
  ): Promise<Result<TimetableVersion>> {
    return this.transition(versionId, "approved", actor, note);
  }

  async rejectVersion(
    versionId: string,
    actor: ActorContext,
    note?: string | null,
  ): Promise<Result<TimetableVersion>> {
    return this.transition(versionId, "rejected", actor, note);
  }

  async publishVersion(
    versionId: string,
    actor: ActorContext,
  ): Promise<Result<TimetableVersion>> {
    const idx = store.versions.findIndex((v) => v.id === versionId);
    if (idx < 0) return Err(Errors.notFound("TimetableVersion", versionId));
    const version = store.versions[idx];
    if (version.status !== "approved") {
      return Err(
        Errors.validation(
          `Seule une version approuvée peut être publiée (statut actuel : ${version.status}).`,
        ),
      );
    }
    // Archive the currently published version (the fn_timetable_publish
    // semantics, mirrored in mock mode).
    for (let i = 0; i < store.versions.length; i++) {
      const v = store.versions[i];
      if (
        v.academicYearId === version.academicYearId &&
        v.status === "published"
      ) {
        store.versions[i] = { ...v, status: "archived", updatedAt: new Date().toISOString() };
      }
    }
    return this.transition(versionId, "published", actor);
  }

  async duplicateVersionToDraft(
    versionId: string,
    actor: ActorContext,
    label?: string | null,
  ): Promise<Result<TimetableVersion>> {
    const source = store.versions.find((v) => v.id === versionId);
    if (!source) return Err(Errors.notFound("TimetableVersion", versionId));
    const now = new Date().toISOString();
    const versionNumber =
      Math.max(
        0,
        ...store.versions
          .filter((v) => v.academicYearId === source.academicYearId)
          .map((v) => v.versionNumber),
      ) + 1;
    const copy: TimetableVersion = {
      ...source,
      id: nextId("tt-ver"),
      versionNumber,
      status: "draft",
      label: label ?? `Copie de ${source.label ?? `v${source.versionNumber}`}`,
      createdBy: actor.actorId,
      createdByName: actor.actorName,
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
      approvedBy: null,
      approvedAt: null,
      publishedBy: null,
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    store.versions.push(copy);
    const sourceEntries = store.entries.filter((e) => e.versionId === versionId);
    for (const e of sourceEntries) {
      store.entries.push({
        ...e,
        id: nextId("tt-ent"),
        versionId: copy.id,
        createdAt: now,
        updatedAt: now,
      });
    }
    this.notifyVersions(source.academicYearId);
    this.notifyEntries();
    return Ok(copy);
  }

  // ========================================================================
  // Manual adjustment (live validation)
  // ========================================================================

  private problemForLiveValidation(
    version: TimetableVersion,
    extra?: { classes?: TimetableProblem["classes"]; requirements?: TimetableRequirement[]; teachers?: TimetableProblem["teachers"] },
  ): TimetableProblem | null {
    // Live validation needs the SAME problem shape as generation. In mock
    // mode the UI registers the last-generated problem per year.
    const cached = mockProblemCache.get(version.academicYearId);
    if (cached) return cached;
    if (extra?.classes && extra?.requirements) {
      return {
        configuration:
          store.configurations.find(
            (c) => c.academicYearId === version.academicYearId && c.isActive,
          ) ?? algerianDefaultConfiguration(TENANT_ID, version.academicYearId),
        constraints: store.constraints.filter(
          (c) => c.academicYearId === version.academicYearId,
        ),
        rooms: store.rooms,
        classes: extra.classes,
        teachers: extra.teachers ?? [],
        requirements: extra.requirements,
        lockedEntries: [],
      };
    }
    return null;
  }

  async moveEntry(
    entryId: string,
    input: MoveTimetableEntryInput,
    _actor: ActorContext,
    problemOverride?: TimetableProblem,
  ): Promise<Result<TimetableScheduleEntry>> {
    const idx = store.entries.findIndex((e) => e.id === entryId);
    if (idx < 0) return Err(Errors.notFound("TimetableEntry", entryId));
    const before = store.entries[idx];
    const version = store.versions.find((v) => v.id === before.versionId);
    if (!version) return Err(Errors.notFound("TimetableVersion", before.versionId));
    if (version.status === "published" || version.status === "archived") {
      return Err(
        Errors.validation(
          "Les versions publiées/archivées sont figées — dupliquez la version en brouillon pour l'ajuster.",
        ),
      );
    }
    if (input.day !== undefined) {
      const parsed = parseTimetableDay(input.day);
      if (!parsed) return Err(Errors.validation("Jour invalide."));
    }

    const after: TimetableScheduleEntry = {
      ...before,
      ...(input.day !== undefined ? { day: input.day } : {}),
      ...(input.periodIndex !== undefined ? { periodIndex: input.periodIndex } : {}),
      ...(input.roomId !== undefined ? { roomId: input.roomId } : {}),
      ...(input.teacherId !== undefined ? { teacherId: input.teacherId } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      updatedAt: new Date().toISOString(),
    };

    // LIVE VALIDATION: the canonical engine over the candidate schedule.
    const problem = problemOverride ?? this.problemForLiveValidation(version);
    if (problem) {
      const candidate = store.entries
        .filter((e) => e.versionId === version.id && e.id !== entryId)
        .map(slotAssignmentFromEntry);
      candidate.push(slotAssignmentFromEntry(after));
      const violations = validateTimetable(problem, candidate).filter(
        (v) => v.severity === "hard",
      );
      if (violations.length > 0) {
        return Err(
          Errors.validation(
            violations.map((v) => v.message).join(" "),
          ),
        );
      }
    }

    store.entries[idx] = { ...after, isLocked: true, source: "manual" };
    this.notifyEntries();
    return Ok(store.entries[idx]);
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
    _actor: ActorContext,
    problemOverride?: TimetableProblem,
  ): Promise<Result<TimetableScheduleEntry>> {
    const version = store.versions.find((v) => v.id === versionId);
    if (!version) return Err(Errors.notFound("TimetableVersion", versionId));
    if (version.status === "published" || version.status === "archived") {
      return Err(
        Errors.validation(
          "Les versions publiées/archivées sont figées — dupliquez la version en brouillon pour l'ajuster.",
        ),
      );
    }
    const now = new Date().toISOString();
    const entry: TimetableScheduleEntry = {
      id: nextId("tt-ent"),
      tenantId: TENANT_ID,
      academicYearId: version.academicYearId,
      versionId,
      classId: input.classId,
      subjectId: input.subjectId,
      teacherId: input.teacherId ?? null,
      roomId: input.roomId ?? null,
      day: input.day,
      periodIndex: input.periodIndex,
      startMinutes: 0,
      endMinutes: 0,
      lessonGroup: 0,
      isLocked: true,
      source: "manual",
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    const problem = problemOverride ?? this.problemForLiveValidation(version);
    if (problem) {
      const candidate = store.entries
        .filter((e) => e.versionId === versionId)
        .map(slotAssignmentFromEntry);
      candidate.push(slotAssignmentFromEntry(entry));
      const violations = validateTimetable(problem, candidate).filter(
        (v) => v.severity === "hard",
      );
      if (violations.length > 0) {
        return Err(Errors.validation(violations.map((v) => v.message).join(" ")));
      }
    }
    store.entries.push(entry);
    this.notifyEntries();
    return Ok(entry);
  }

  async setEntryLocked(
    entryId: string,
    locked: boolean,
    _actor: ActorContext,
  ): Promise<Result<TimetableScheduleEntry>> {
    const idx = store.entries.findIndex((e) => e.id === entryId);
    if (idx < 0) return Err(Errors.notFound("TimetableEntry", entryId));
    store.entries[idx] = {
      ...store.entries[idx],
      isLocked: locked,
      updatedAt: new Date().toISOString(),
    };
    this.notifyEntries();
    return Ok(store.entries[idx]);
  }

  async deleteEntry(entryId: string, _actor: ActorContext): Promise<Result<void>> {
    const entry = store.entries.find((e) => e.id === entryId);
    if (!entry) return Err(Errors.notFound("TimetableEntry", entryId));
    const version = store.versions.find((v) => v.id === entry.versionId);
    if (version && (version.status === "published" || version.status === "archived")) {
      return Err(
        Errors.validation(
          "Les versions publiées/archivées sont figées — dupliquez la version en brouillon pour l'ajuster.",
        ),
      );
    }
    store.entries = store.entries.filter((e) => e.id !== entryId);
    this.notifyEntries();
    return Ok(undefined);
  }
}

/** The last-generated problem per academic year (mock live validation). */
export const mockProblemCache = new Map<string, TimetableProblem>();

export const mockTimetableRepository = new MockTimetableRepository();
