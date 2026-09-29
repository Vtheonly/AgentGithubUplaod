// t-441-reproduce-17.ts — REPRODUCE THE OWNER'S SYMPTOM deterministically:
// regenerate the LIVE problem WITH LOCKED PINS (the state the owner's 8 old
// versions created — regeneration from a source version keeps is_locked rows
// as immovable pins). Compare OLD solver behavior (partial result persisted,
// "N bloc(s) non placé(s)") vs NEW (eviction repair → complete, or fail-closed
// with precise reasons). Runs both solver builds via git worktrees.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getTimetableSolver, GREEDY_SOLVER_ID } from "../src/domain/calc/timetable/solver";
import type {
  Room,
  TimetableConfiguration,
  TimetableConstraint,
  TimetableDay,
  TimetableProblem,
  TimetableRequirement,
  TimetableSlotAssignment,
} from "../src/domain/model/timetable";

const raw = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "t-441-live-problem.json"), "utf8"),
) as any;

const configuration: TimetableConfiguration = {
  id: raw.configuration.id,
  tenantId: raw.configuration.tenant_id,
  academicYearId: raw.configuration.academic_year_id,
  label: raw.configuration.label,
  schoolDays: (raw.configuration.school_days ?? []).map((d: string) => d as TimetableDay),
  periods: (raw.configuration.periods ?? []).map((p: any) => ({
    index: Number(p.index),
    label: String(p.label ?? `S${p.index}`),
    startMinutes: Number(p.startMinutes),
    endMinutes: Number(p.endMinutes),
  })),
  breaks: (raw.configuration.breaks ?? []).map((b: any) => ({
    afterPeriodIndex: Number(b.afterPeriodIndex),
    label: String(b.label ?? "Pause"),
    startMinutes: Number(b.startMinutes),
    endMinutes: Number(b.endMinutes),
  })),
  defaultLessonMinutes: Number(raw.configuration.default_lesson_minutes ?? 60),
  maxPeriodsPerDay: Number(raw.configuration.max_periods_per_day ?? 8),
  isActive: true,
  createdAt: raw.configuration.created_at,
  updatedAt: raw.configuration.updated_at,
};

const rooms: Room[] = raw.rooms.map((r: any) => ({
  id: r.id,
  tenantId: r.tenant_id,
  code: r.code,
  name: r.name,
  roomType: r.room_type,
  capacity: r.capacity != null ? Number(r.capacity) : null,
  building: r.building,
  floorLabel: r.floor_label,
  isActive: r.is_active,
  notes: null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
}));

const constraints: TimetableConstraint[] = raw.constraints.map((c: any) => ({
  id: c.id,
  tenantId: c.tenant_id,
  academicYearId: c.academic_year_id,
  scope: c.scope,
  entityId: c.entity_id,
  kind: c.kind,
  severity: c.severity,
  params: c.params,
  isActive: c.is_active,
  createdAt: c.created_at,
  updatedAt: c.updated_at,
}));

const teachers = raw.personnel.map((p: any) => ({ id: p.id, name: `${p.first_name} ${p.last_name}` }));
const teacherName = new Map(teachers.map((t) => [t.id, t.name]));

const requirements: TimetableRequirement[] = raw.class_subjects.map((r: any) => ({
  classId: r.class_id,
  subjectId: r.subject_id,
  teacherId: r.teacher_id ?? null,
  weeklyHours: Number(r.weekly_hours ?? 2),
  consecutivePeriods: Math.max(1, Math.min(4, Number(r.consecutive_periods ?? 1))),
  requiredRoomType: r.required_room_type ?? null,
  className: r.classes?.name ?? r.classes?.code ?? r.class_id,
  subjectName: r.subjects?.name_fr ?? r.subject_id,
  teacherName: r.teacher_id ? teacherName.get(r.teacher_id) ?? null : null,
  classSize: r.classes?.capacity != null ? Number(r.classes.capacity) : null,
}));

const baseProblem: TimetableProblem = {
  configuration,
  classes: raw.classes.map((c: any) => ({
    id: c.id,
    code: c.code,
    name: c.name ?? c.code,
    capacity: c.capacity != null ? Number(c.capacity) : null,
  })),
  teachers,
  rooms,
  requirements,
  constraints,
  lockedEntries: [],
};

// ── Density sweep: 0% → 50% locked pins (the owner's regeneration reality:
// manually adjusted rows are is_locked and survive as immovable pins).
const solver = getTimetableSolver(GREEDY_SOLVER_ID)!;
const first = solver.solve(baseProblem);
console.log(`live problem: ${requirements.length} requirements, ${first.entries.length} periods`);
console.log(`solver build: ${solver.build}\n`);
console.log("lock% | placed/required | unplaced | hard | verdict");
console.log("------+-----------------+----------+------+---------------------------");
for (const pct of [0, 5, 10, 15, 20, 30, 50]) {
  const locked: TimetableSlotAssignment[] =
    pct === 0 ? [] : first.entries.filter((_, i) => (i * pct) % 100 < pct);
  // T-441 preferred-slot hint: the source version's full schedule is offered
  // as placement preferences (exactly what the repository passes with
  // fromVersionId) — the solver keeps historical slots where they still fit.
  const problem: TimetableProblem = {
    ...baseProblem,
    lockedEntries: locked,
    preferredEntries: pct === 0 ? [] : first.entries,
  };
  const solution = solver.solve(problem);
  const verdict =
    solution.unplaced.length === 0 && solution.statistics.hardViolationCount === 0
      ? "COMPLETE — persisted"
      : "FAIL-CLOSED (no version persisted, numbered reasons)";
  console.log(
    `${String(pct).padStart(3)}%  | ${String(solution.statistics.placedPeriods).padStart(3)}/${String(solution.statistics.requiredPeriods).padEnd(3)}        | ${String(solution.unplaced.length).padStart(8)} | ${String(solution.statistics.hardViolationCount).padStart(4)} | ${verdict}`,
  );
}
