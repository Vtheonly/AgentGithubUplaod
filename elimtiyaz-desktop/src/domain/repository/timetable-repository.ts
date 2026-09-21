// ============================================================================
// FILE: src/domain/repository/timetable-repository.ts
// ============================================================================
/**
 * The canonical Timetable repository contract — T-404 (ADR-020).
 *
 * ONE persistence path for the Automatic Timetable feature: configuration,
 * rooms, constraints, versioned generation trials, the review → approve →
 * publish workflow, and live-validated manual adjustments. The Supabase
 * implementation (migrations 0109/0110) is the production store; the mock
 * implementation mirrors the same contract for development/tests.
 *
 * The repository CONSUMES the canonical domain (model/timetable.ts) and the
 * solver registry (calc/timetable/solver) — it never reimplements
 * constraint logic (the validator in calc/timetable/constraints.ts is THE
 * engine) and never talks to solver-specific APIs.
 */

import type { Observable } from "./repository";
import type { Result } from "../../core/result";
import type {
  Room,
  RoomType,
  TimetableConfiguration,
  TimetableConstraint,
  TimetableConstraintKind,
  TimetableConstraintScope,
  TimetableConstraintSeverity,
  TimetableDay,
  TimetableScheduleEntry,
  TimetableVersion,
  TimetableVersionStatus,
} from "../model/timetable";
import { canTransitionTimetableVersion } from "../model/timetable";

// ============================================================================
// Inputs
// ============================================================================

export interface SaveTimetableConfigurationInput {
  readonly academicYearId: string;
  readonly label: string;
  readonly schoolDays: readonly TimetableDay[];
  readonly periods: readonly {
    index: number;
    label: string;
    startMinutes: number;
    endMinutes: number;
  }[];
  readonly breaks: readonly {
    afterPeriodIndex: number;
    label: string;
    startMinutes: number;
    endMinutes: number;
  }[];
  readonly defaultLessonMinutes: number;
  readonly maxPeriodsPerDay: number;
  readonly isActive?: boolean;
}

export interface CreateRoomInput {
  readonly code: string;
  readonly name: string;
  readonly roomType: RoomType;
  readonly capacity?: number | null;
  readonly building?: string | null;
  readonly floorLabel?: string | null;
  readonly notes?: string | null;
}

export interface UpdateRoomInput {
  readonly name?: string;
  readonly roomType?: RoomType;
  readonly capacity?: number | null;
  readonly building?: string | null;
  readonly floorLabel?: string | null;
  readonly isActive?: boolean;
  readonly notes?: string | null;
}

export interface CreateTimetableConstraintInput {
  readonly academicYearId: string;
  readonly scope: TimetableConstraintScope;
  readonly entityId?: string | null;
  readonly kind: TimetableConstraintKind;
  readonly severity?: TimetableConstraintSeverity;
  readonly params?: Record<string, unknown>;
}

export interface UpdateTimetableConstraintInput {
  readonly severity?: TimetableConstraintSeverity;
  readonly params?: Record<string, unknown>;
  readonly isActive?: boolean;
}

export interface GenerateTimetableOptions {
  readonly academicYearId: string;
  /** Solver registry id (default: the native ts-greedy-v1). */
  readonly solverId?: string;
  /** Optional label for the generated trial version. */
  readonly label?: string | null;
  /**
   * Regenerate FROM an existing version: its `is_locked` entries are kept
   * as manual pins (T-404: manual adjustments survive regeneration).
   */
  readonly fromVersionId?: string | null;
}

export interface MoveTimetableEntryInput {
  readonly day?: TimetableDay;
  readonly periodIndex?: number;
  readonly roomId?: string | null;
  readonly teacherId?: string | null;
  readonly notes?: string | null;
}

export interface ActorContext {
  readonly actorId: string;
  readonly actorName: string;
}

// ============================================================================
// The contract
// ============================================================================

export interface TimetableRepository {
  // ---- Configuration (one active per academic year, 0109 §2) ----
  observeConfiguration(
    academicYearId: string,
  ): Observable<TimetableConfiguration | null>;
  saveConfiguration(
    input: SaveTimetableConfigurationInput,
    actor: ActorContext,
  ): Promise<Result<TimetableConfiguration>>;

  // ---- Rooms (0109 §1) ----
  observeRooms(): Observable<Room[]>;
  createRoom(input: CreateRoomInput, actor: ActorContext): Promise<Result<Room>>;
  updateRoom(
    id: string,
    input: UpdateRoomInput,
    actor: ActorContext,
  ): Promise<Result<Room>>;
  deleteRoom(id: string, actor: ActorContext): Promise<Result<void>>;

  // ---- Constraints (0109 §3) ----
  observeConstraints(
    academicYearId: string,
  ): Observable<TimetableConstraint[]>;
  createConstraint(
    input: CreateTimetableConstraintInput,
    actor: ActorContext,
  ): Promise<Result<TimetableConstraint>>;
  updateConstraint(
    id: string,
    input: UpdateTimetableConstraintInput,
    actor: ActorContext,
  ): Promise<Result<TimetableConstraint>>;
  deleteConstraint(id: string, actor: ActorContext): Promise<Result<void>>;

  // ---- Versions + entries (0109 §4/§5) ----
  observeVersions(academicYearId: string): Observable<TimetableVersion[]>;
  observeEntries(versionId: string): Observable<TimetableScheduleEntry[]>;
  /** The PUBLISHED schedule of an academic year (the canonical live EDT). */
  observePublishedEntries(
    academicYearId: string,
  ): Observable<TimetableScheduleEntry[]>;

  // ---- Generation (solver registry behind the adapter contract) ----
  generateTimetable(
    options: GenerateTimetableOptions,
    actor: ActorContext,
  ): Promise<Result<TimetableVersion>>;

  // ---- Review → approve → publish workflow ----
  submitForReview(
    versionId: string,
    actor: ActorContext,
    note?: string | null,
  ): Promise<Result<TimetableVersion>>;
  approveVersion(
    versionId: string,
    actor: ActorContext,
    note?: string | null,
  ): Promise<Result<TimetableVersion>>;
  rejectVersion(
    versionId: string,
    actor: ActorContext,
    note?: string | null,
  ): Promise<Result<TimetableVersion>>;
  /** Publishes via the canonical fn_timetable_publish RPC (0109 §7). */
  publishVersion(
    versionId: string,
    actor: ActorContext,
  ): Promise<Result<TimetableVersion>>;
  /** Copies a version (e.g. the published one) to a fresh editable draft. */
  duplicateVersionToDraft(
    versionId: string,
    actor: ActorContext,
    label?: string | null,
  ): Promise<Result<TimetableVersion>>;

  // ---- Manual adjustment with live validation (T-404) ----
  /** Moves/edits one entry — validated against the canonical engine first. */
  moveEntry(
    entryId: string,
    input: MoveTimetableEntryInput,
    actor: ActorContext,
  ): Promise<Result<TimetableScheduleEntry>>;
  /** Adds a manual entry to a draft version — live-validated. */
  createEntry(
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
  ): Promise<Result<TimetableScheduleEntry>>;
  setEntryLocked(
    entryId: string,
    locked: boolean,
    actor: ActorContext,
  ): Promise<Result<TimetableScheduleEntry>>;
  deleteEntry(
    entryId: string,
    actor: ActorContext,
  ): Promise<Result<void>>;
}

/** The status a transition targets (repository-level guard helper). */
export function assertTransitionAllowed(
  from: TimetableVersionStatus,
  to: TimetableVersionStatus,
): string | null {
  if (!canTransitionTimetableVersion(from, to)) {
    return `Transition de statut interdite : ${from} → ${to}.`;
  }
  return null;
}
