/**
 * Shared in-memory store + helpers for the mock repository layer.
 *
 * All mock repositories share a single `MockStore` instance so cross-entity
 * queries (e.g. ParentFinancialProfile joining parents + payments + ledger)
 * see consistent state.
 *
 * Extracted from `mock-repositories.ts` in iteration 2 of the platform-wide
 * refactor. The store shape, seed wiring, and `appendAudit` behavior are
 * preserved verbatim — this is a pure extraction.
 */
import { SubjectBehavior } from "../subject-behavior";
import { logger } from "../../../core/logger";
import { AuditActions } from "../../../core/audit-actions";
import { TENANT_ID } from "../seed-data";
import {
  seedParents,
  seedStudents,
  seedClasses,
  seedSubjects,
  seedPayments,
  seedInstallments,
  seedExpenses,
  seedPersonnel,
  seedAudit,
  seedNotifications,
  seedCalendarEvents,
  seedAccounts,
} from "../seed-data";
import {
  seedClassSubjects,
  seedAssessments,
  seedAttendance,
  seedHomework,
  seedReleve,
} from "../academic-seed";
import { seedLedger } from "../ledger-seed";
import { seedWorkflows, seedWorkflowRuns } from "../workflow-seed";
import {
  seedAcademicYears,
  seedClubs,
  seedClubMemberships,
  seedClubActivities,
  seedPsychologicalFollowUps,
  seedPsychologicalSessions,
  seedPsychologicalReports,
  seedSpeechTherapyFollowUps,
  seedSpeechTherapyEvaluations,
  seedSpeechTherapySessions,
} from "../pedagogy-seed";
import {
  seedTeachers,
  seedTeacherSubjectAssignments,
  seedTimetableEntries,
} from "../teacher-seed";
import type { Parent } from "../../../domain/model/parent";
import type { Student } from "../../../domain/model/student";
import type {
  AcademicClass,
  AcademicYear,
  Subject,
  ClassSubject,
  Assessment,
  AttendanceRecord,
  Homework,
} from "../../../domain/model/academic";
import type {
  Club,
  ClubMembership,
  ClubActivity,
} from "../../../domain/model/club";
import type {
  PsychologicalFollowUp,
  PsychologicalSession,
  PsychologicalReport,
  SpeechTherapyFollowUp,
  SpeechTherapyEvaluation,
  SpeechTherapySession,
} from "../../../domain/model/therapy";
import type {
  Teacher,
  TeacherSubjectAssignment,
  TimetableEntry,
} from "../../../domain/model/teacher";
import type { Payment, Installment } from "../../../domain/model/payment";
import type { Expense } from "../../../domain/model/expense";
import type { Personnel, ReleveEntry } from "../../../domain/model/personnel";
import type { AuditEntry } from "../../../domain/model/audit";
import type { AppNotification } from "../../../domain/model/operations";
import type { CalendarEvent } from "../../../domain/model/calendar";
import type { LedgerEntry } from "../../../domain/model/ledger";
import type { Workflow, WorkflowRun } from "../../../domain/model/workflow";

/** Current ISO timestamp — preserved from original inline arrow. */
export const nowIso = (): string => new Date().toISOString();

/**
 * Mutable in-memory store. Mock repositories share this store so cross-entity
 * queries (e.g. ParentFinancialProfile) see consistent state.
 *
 * Iteration 6: Added classSubjects, assessments, attendance, homework, releve
 * collections (previously these read paths returned empty arrays). This makes
 * the class detail tabs, homework history tab, and personnel relevé tab
 * show realistic data out of the box.
 */
export class MockStore {
  parents: Parent[] = [...seedParents];
  students: Student[] = [...seedStudents];
  classes: AcademicClass[] = [...seedClasses];
  subjects: Subject[] = [...seedSubjects];
  classSubjects: ClassSubject[] = [...seedClassSubjects];
  assessments: Assessment[] = [...seedAssessments];
  attendance: AttendanceRecord[] = [...seedAttendance];
  homework: Homework[] = [...seedHomework];
  payments: Payment[] = [...seedPayments];
  installments: Installment[] = [...seedInstallments];
  expenses: Expense[] = [...seedExpenses];
  personnel: Personnel[] = [...seedPersonnel];
  releve: ReleveEntry[] = [...seedReleve];
  audit: AuditEntry[] = [...seedAudit];
  notifications: AppNotification[] = [...seedNotifications];
  ledger: LedgerEntry[] = [...seedLedger];
  workflows: Workflow[] = [...seedWorkflows];
  workflowRuns: WorkflowRun[] = [...seedWorkflowRuns];
  // Iteration 9: manually scheduled calendar events (follow-up calls, reminders, meetings).
  calendarEvents: CalendarEvent[] = [...seedCalendarEvents] as CalendarEvent[];

  /**
   * IDEMPOTENCY GUARD (vault §07.08): payment ids that have already been run
   * through the waterfall allocator. Prevents double-allocation when a
   * payment collected atomically (which allocates internally) is explicitly
   * allocated again by a caller.
   */
  allocatedPaymentIds = new Set<string>();

  // Pédagogie redesign — new collections
  academicYears: AcademicYear[] = [...seedAcademicYears];
  clubs: Club[] = [...seedClubs];
  clubMemberships: ClubMembership[] = [...seedClubMemberships];
  clubActivities: ClubActivity[] = [...seedClubActivities];
  psychologicalFollowUps: PsychologicalFollowUp[] = [...seedPsychologicalFollowUps];
  psychologicalSessions: PsychologicalSession[] = [...seedPsychologicalSessions];
  psychologicalReports: PsychologicalReport[] = [...seedPsychologicalReports];
  speechTherapyFollowUps: SpeechTherapyFollowUp[] = [...seedSpeechTherapyFollowUps];
  speechTherapyEvaluations: SpeechTherapyEvaluation[] = [...seedSpeechTherapyEvaluations];
  speechTherapySessions: SpeechTherapySession[] = [...seedSpeechTherapySessions];

  // Teacher normalization — Account → Person → Teacher → Subject
  teachers: Teacher[] = [...seedTeachers];
  teacherSubjectAssignments: TeacherSubjectAssignment[] = [...seedTeacherSubjectAssignments];
  timetableEntries: TimetableEntry[] = [...seedTimetableEntries];

  parents$ = new SubjectBehavior<Parent[]>(this.parents);
  students$ = new SubjectBehavior<Student[]>(this.students);
  classes$ = new SubjectBehavior<AcademicClass[]>(this.classes);
  subjects$ = new SubjectBehavior<Subject[]>(this.subjects);
  classSubjects$ = new SubjectBehavior<ClassSubject[]>(this.classSubjects);
  assessments$ = new SubjectBehavior<Assessment[]>(this.assessments);
  attendance$ = new SubjectBehavior<AttendanceRecord[]>(this.attendance);
  homework$ = new SubjectBehavior<Homework[]>(this.homework);
  payments$ = new SubjectBehavior<Payment[]>(this.payments);
  installments$ = new SubjectBehavior<Installment[]>(this.installments);
  expenses$ = new SubjectBehavior<Expense[]>(this.expenses);
  personnel$ = new SubjectBehavior<Personnel[]>(this.personnel);
  releve$ = new SubjectBehavior<ReleveEntry[]>(this.releve);
  audit$ = new SubjectBehavior<AuditEntry[]>(this.audit);
  notifications$ = new SubjectBehavior<AppNotification[]>(this.notifications);
  ledger$ = new SubjectBehavior<LedgerEntry[]>(this.ledger);
  workflows$ = new SubjectBehavior<Workflow[]>(this.workflows);
  workflowRuns$ = new SubjectBehavior<WorkflowRun[]>(this.workflowRuns);
  calendarEvents$ = new SubjectBehavior<CalendarEvent[]>(this.calendarEvents);

  // Pédagogie redesign — reactive streams for new collections
  academicYears$ = new SubjectBehavior<AcademicYear[]>(this.academicYears);
  clubs$ = new SubjectBehavior<Club[]>(this.clubs);
  clubMemberships$ = new SubjectBehavior<ClubMembership[]>(this.clubMemberships);
  clubActivities$ = new SubjectBehavior<ClubActivity[]>(this.clubActivities);
  psychologicalFollowUps$ = new SubjectBehavior<PsychologicalFollowUp[]>(this.psychologicalFollowUps);
  psychologicalSessions$ = new SubjectBehavior<PsychologicalSession[]>(this.psychologicalSessions);
  psychologicalReports$ = new SubjectBehavior<PsychologicalReport[]>(this.psychologicalReports);
  speechTherapyFollowUps$ = new SubjectBehavior<SpeechTherapyFollowUp[]>(this.speechTherapyFollowUps);
  speechTherapyEvaluations$ = new SubjectBehavior<SpeechTherapyEvaluation[]>(this.speechTherapyEvaluations);
  speechTherapySessions$ = new SubjectBehavior<SpeechTherapySession[]>(this.speechTherapySessions);

  // Teacher normalization — reactive streams
  teachers$ = new SubjectBehavior<Teacher[]>(this.teachers);
  teacherSubjectAssignments$ = new SubjectBehavior<TeacherSubjectAssignment[]>(this.teacherSubjectAssignments);
  timetableEntries$ = new SubjectBehavior<TimetableEntry[]>(this.timetableEntries);

  notifyParents() { this.stageAndNotify("parent", this.parents as unknown as StagedRow[], () => this.parents$.set([...this.parents])); }
  notifyStudents() { this.stageAndNotify("student", this.students as unknown as StagedRow[], () => this.students$.set([...this.students])); }
  notifyPayments() { this.stageAndNotify("payment", this.payments as unknown as StagedRow[], () => this.payments$.set([...this.payments])); }
  notifyInstallments() { this.stageAndNotify("installment", this.installments as unknown as StagedRow[], () => this.installments$.set([...this.installments])); }
  notifyExpenses() { this.expenses$.set([...this.expenses]); }
  notifyPersonnel() { this.personnel$.set([...this.personnel]); }
  notifyAudit() { this.audit$.set([...this.audit]); }
  notifyNotifications() { this.notifications$.set([...this.notifications]); }
  notifyLedger() { this.stageAndNotify("ledger_entry", this.ledger as unknown as StagedRow[], () => this.ledger$.set([...this.ledger])); }
  notifyClassSubjects() { this.classSubjects$.set([...this.classSubjects]); }
  notifyAssessments() { this.assessments$.set([...this.assessments]); }
  notifyAttendance() { this.attendance$.set([...this.attendance]); }
  notifyHomework() { this.homework$.set([...this.homework]); }
  notifyReleve() { this.releve$.set([...this.releve]); }
  notifyWorkflows() { this.workflows$.set([...this.workflows]); }
  notifyWorkflowRuns() { this.workflowRuns$.set([...this.workflowRuns]); }
  notifyCalendarEvents() { this.calendarEvents$.set([...this.calendarEvents]); }

  // Pédagogie redesign — notify methods for new collections
  notifyAcademicYears() { this.academicYears$.set([...this.academicYears]); }
  notifyClubs() { this.clubs$.set([...this.clubs]); }
  notifyClubMemberships() { this.clubMemberships$.set([...this.clubMemberships]); }
  notifyClubActivities() { this.clubActivities$.set([...this.clubActivities]); }
  notifyPsychologicalFollowUps() { this.psychologicalFollowUps$.set([...this.psychologicalFollowUps]); }
  notifyPsychologicalSessions() { this.psychologicalSessions$.set([...this.psychologicalSessions]); }
  notifyPsychologicalReports() { this.psychologicalReports$.set([...this.psychologicalReports]); }
  notifySpeechTherapyFollowUps() { this.speechTherapyFollowUps$.set([...this.speechTherapyFollowUps]); }
  notifySpeechTherapyEvaluations() { this.speechTherapyEvaluations$.set([...this.speechTherapyEvaluations]); }
  notifySpeechTherapySessions() { this.speechTherapySessions$.set([...this.speechTherapySessions]); }
  notifyTeachers() { this.teachers$.set([...this.teachers]); }
  notifyTeacherSubjectAssignments() { this.teacherSubjectAssignments$.set([...this.teacherSubjectAssignments]); }
  notifyTimetableEntries() { this.timetableEntries$.set([...this.timetableEntries]); }

  // ── T-300 (OFFLINE-400): the offline operating mode ─────────────────
  //
  // RESTORE: replaceOperationalState swaps the snapshot collections in
  // place and notifies every stream — the app instantly runs ON the
  // restored archive (the mock layer IS the offline operating mode).
  //
  // STAGING: armStaging binds a sink (the EXISTING SyncService.enqueue —
  // injected by the backup service; the store never imports the sync
  // layer, no parallel queue). Once armed, the five staged collections'
  // notify methods diff their rows against the last checkpoint and enqueue
  // insert/update/delete entries for every post-restore mutation. The
  // staged kinds are exactly the ones with a canonical push path in the
  // dispatcher (defaultPushHandler): parent, student, payment, installment,
  // ledger_entry. Expenses / personnel / workflows are restored but NOT
  // staged (their push port does not exist yet — documented in the T-300
  // registry entry; staging them would create permanently-failing entries,
  // the exact noise class T-171 eliminated).

  private stagingSink: StagingSink | null = null;
  private stagingCheckpoints = new Map<string, Map<string, string>>();

  get stagingArmed(): boolean {
    return this.stagingSink !== null;
  }

  /** Replace the operational state from a restored backup snapshot. */
  replaceOperationalState(snapshot: Record<string, unknown>): void {
    const arr = (key: string): unknown[] =>
      Array.isArray(snapshot[key]) ? (snapshot[key] as unknown[]) : [];
    this.parents = arr("parents") as typeof this.parents;
    this.students = arr("students") as typeof this.students;
    this.payments = arr("payments") as typeof this.payments;
    this.installments = arr("installments") as typeof this.installments;
    this.ledger = arr("ledger") as typeof this.ledger;
    this.expenses = arr("expenses") as typeof this.expenses;
    this.personnel = arr("personnel") as typeof this.personnel;
    this.workflows = arr("workflows") as typeof this.workflows;
    // Notify every replaced stream so open screens re-render on the
    // restored state.
    this.parents$.set([...this.parents]);
    this.students$.set([...this.students]);
    this.payments$.set([...this.payments]);
    this.installments$.set([...this.installments]);
    this.ledger$.set([...this.ledger]);
    this.expenses$.set([...this.expenses]);
    this.personnel$.set([...this.personnel]);
    this.workflows$.set([...this.workflows]);
    // RBAC matrix overrides ride inside the snapshot (vault §13.01).
    const rbac = snapshot["rbacMatrixOverrides"];
    try {
      if (rbac != null) {
        localStorage.setItem("el-imtiyaz:rbac-matrix-overrides", JSON.stringify(rbac));
      } else {
        localStorage.removeItem("el-imtiyaz:rbac-matrix-overrides");
      }
    } catch {
      /* localStorage unavailable — the data collections still restored. */
    }
  }

  /** Arm post-restore mutation staging (idempotent re-arm refreshes checkpoints). */
  armStaging(sink: StagingSink): void {
    this.stagingSink = sink;
    this.refreshCheckpoint("parent", this.parents as unknown as StagedRow[]);
    this.refreshCheckpoint("student", this.students as unknown as StagedRow[]);
    this.refreshCheckpoint("payment", this.payments as unknown as StagedRow[]);
    this.refreshCheckpoint("installment", this.installments as unknown as StagedRow[]);
    this.refreshCheckpoint("ledger_entry", this.ledger as unknown as StagedRow[]);
    logger.info("store.staging.armed", { collections: 5 });
  }

  /** Disarm staging (tests / explicit mode close). */
  disarmStaging(): void {
    this.stagingSink = null;
    this.stagingCheckpoints.clear();
  }

  private refreshCheckpoint(entity: string, rows: StagedRow[]): void {
    const next = new Map<string, string>();
    for (const row of rows) next.set(row.id, JSON.stringify(row));
    this.stagingCheckpoints.set(entity, next);
  }

  /**
   * Diff the collection against its staging checkpoint and enqueue the
   * mutations, then notify the stream. Rows are keyed by `id`; a changed
   * row is one whose serialized JSON differs (field-level drift inside a
   * row is an update — the sync push sends the full row, matching the
   * upsert-RPC contract).
   */
  private stageAndNotify(entity: StagedMutation["entity"], rows: StagedRow[], notify: () => void): void {
    const sink = this.stagingSink;
    if (!sink) {
      notify();
      return;
    }
    const prev = this.stagingCheckpoints.get(entity) ?? new Map<string, string>();
    const next = new Map<string, string>();
    for (const row of rows) next.set(row.id, JSON.stringify(row));
    for (const [id, json] of next) {
      const before = prev.get(id);
      if (before === undefined) {
        sink.enqueue({ entity, operation: "insert", payload: JSON.parse(json) as Record<string, unknown> });
      } else if (before !== json) {
        // T-305: the UPDATE carries its pre-edit snapshot (the 3-way base) —
        // the drain's conflict guard can then detect a field BOTH sides
        // changed and park the entry for resolution instead of silently
        // overwriting the server row.
        sink.enqueue({
          entity,
          operation: "update",
          payload: JSON.parse(json) as Record<string, unknown>,
          basePayload: JSON.parse(before) as Record<string, unknown>,
        });
      }
    }
    for (const id of prev.keys()) {
      if (!next.has(id)) {
        sink.enqueue({ entity, operation: "delete", payload: { id } });
      }
    }
    this.stagingCheckpoints.set(entity, next);
    notify();
  }
}

/** Singleton store instance — shared by all mock repositories. */
export const store = new MockStore();

/** Re-export seed accounts so the Auth repository can use them. */
export { seedAccounts };

/** Re-export TENANT_ID for convenient access in repository files. */
export { TENANT_ID };

/** Re-export AuditActions so repository files don't need a separate import. */
export { AuditActions };

/** Re-export logger so repository files don't need a separate import. */
export { logger };

export interface AppendAuditInput {
  action: string;
  entityType: string;
  entityId: string;
  actorId: string;
  actorName: string;
  /** T-296 (OFFLINE-400): the actor's role (VAULT §12.02 — rendered in the diff drawer). */
  actorRole?: string | null;
  diff?: { before?: unknown; after?: unknown } | null;
  note?: string | null;
}

/**
 * Append an audit log entry to the in-memory store + log it.
 *
 * Preserved verbatim from `mock-repositories.ts`. The audit log is
 * prepend-only (newest first via `unshift`).
 */
export function appendAudit(input: AppendAuditInput): void {
  const entry: AuditEntry = {
    id: `aud-${String(store.audit.length + 1).padStart(3, "0")}-${Date.now()}`,
    tenantId: TENANT_ID,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    actorId: input.actorId,
    actorName: input.actorName,
    actorRole: input.actorRole ?? null,
    diff: input.diff ? JSON.stringify(input.diff) : null,
    note: input.note ?? null,
    ipAddress: "10.0.1.42",
    userAgent: "El-Imtiyaz-Desktop/0.1.0",
    at: nowIso(),
  };
  store.audit.unshift(entry);
  store.notifyAudit();
  logger.info("audit.log", { action: entry.action, entity: entry.entityType, id: entry.entityId });
}

/**
 * Promise-based delay — used to simulate network latency in mock repositories.
 * Preserved verbatim from the inline `delay` function.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


/* ------------------------------------------------------------------ */
/*  T-300 (OFFLINE-400) — the offline operating mode's staging types   */
/* ------------------------------------------------------------------ */

/** One staged mutation (the sync-queue entry shape — no parallel queue). */
export interface StagedMutation {
  readonly entity: "parent" | "student" | "payment" | "installment" | "ledger_entry";
  readonly operation: "insert" | "update" | "delete";
  readonly payload: Record<string, unknown>;
  /**
   * T-305 (47th session): the pre-edit row snapshot for `update` mutations —
   * the 3-way BASE the drain's conflict guard needs. The producer arms the
   * no-silent-overwrite guard for production offline edit traffic by passing
   * the checkpoint row the local edit started from.
   */
  readonly basePayload?: Record<string, unknown> | null;
}

/**
 * The staging sink — injected by the backup service at restore time (it
 * binds the EXISTING SyncService.enqueue; the store never imports the
 * sync layer). The five staged collections are exactly the ones with a
 * canonical push path in the dispatcher (defaultPushHandler); expenses /
 * personnel / workflows stay restored-but-not-staged until their ports
 * land (documented in the T-300 registry entry — staging them would
 * create permanently-failing entries, the exact noise class T-171
 * eliminated).
 */
export interface StagingSink {
  enqueue(mutation: StagedMutation): void;
}

/** Minimal id + row-shape access for the staged collections. */
interface StagedRow {
  readonly id: string;
  [key: string]: unknown;
}
