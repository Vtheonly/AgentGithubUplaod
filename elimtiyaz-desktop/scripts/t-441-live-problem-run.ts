// t-441-live-problem-run.ts — run the v1.3.0 solver against the LIVE problem
// shape (exported by t-441-live-problem-export.py) and report the verdict.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getTimetableSolver, GREEDY_SOLVER_ID } from "../src/domain/calc/timetable/solver";
import "../src/domain/calc/timetable/solver";
import { validateTimetable, coverageGaps } from "../src/domain/calc/timetable/constraints";
import { analyzeTimetableFeasibility } from "../src/domain/calc/timetable/feasibility";
import type {
  Room,
  TimetableConfiguration,
  TimetableConstraint,
  TimetableDay,
  TimetableProblem,
  TimetableRequirement,
} from "../src/domain/model/timetable";

interface LiveExport {
  configuration: any;
  rooms: any[];
  constraints: any[];
  classes: any[];
  class_subjects: any[];
  personnel: any[];
}

const raw: LiveExport = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "t-441-live-problem.json"), "utf8"),
);

const configuration: TimetableConfiguration = {
  id: raw.configuration.id,
  tenantId: raw.configuration.tenant_id,
  academicYearId: raw.configuration.academic_year_id,
  label: raw.configuration.label,
  schoolDays: (raw.configuration.school_days ?? []).map(
    (d: string) => d as TimetableDay,
  ),
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

const rooms: Room[] = raw.rooms.map((r) => ({
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

const constraints: TimetableConstraint[] = raw.constraints.map((c) => ({
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

const nameOf = (p: any) => `${p.first_name} ${p.last_name}`;
const teachers = raw.personnel.map((p) => ({ id: p.id, name: nameOf(p) }));
const teacherName = new Map(teachers.map((t) => [t.id, t.name]));

const requirements: TimetableRequirement[] = raw.class_subjects.map((r) => ({
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

const problem: TimetableProblem = {
  configuration,
  classes: raw.classes.map((c) => ({
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

// ── Feasibility ────────────────────────────────────────────────────────────
const feasibility = analyzeTimetableFeasibility(problem);
console.log("feasibility issues:", feasibility.length);
for (const f of feasibility) console.log("  -", f.kind, ":", f.message);

// ── Solve ──────────────────────────────────────────────────────────────────
const events: Array<{ stage: string; message: string }> = [];
const solver = getTimetableSolver(GREEDY_SOLVER_ID)!;
const solution = solver.solve(problem, {
  onProgress: (p) => events.push({ stage: p.stage, message: p.message }),
});
const repairRan = events.some(
  (e) =>
    e.stage === "repairing" &&
    /Réparation \/ optimisation — [1-9]/.test(e.message),
);
console.log("solver build:", solver.build);
console.log("status:", solution.status);
console.log("placed/required:", solution.statistics.placedPeriods, "/", solution.statistics.requiredPeriods);
console.log("unplaced:", solution.unplaced.length, "hard:", solution.statistics.hardViolationCount, "repair-ran:", repairRan);
for (const u of solution.unplaced.slice(0, 8)) {
  console.log("  UNPLACED:", u.requirement.subjectName, "—", u.requirement.className, ":", u.reason);
}
const hard = validateTimetable(problem, solution.entries).filter((v) => v.severity === "hard");
console.log("post-validate hard violations:", hard.length);
for (const v of hard.slice(0, 5)) console.log("  HARD:", v.kind, v.message);
const gaps = coverageGaps(problem, solution.entries);
console.log("coverage gaps:", gaps.length);
for (const g of gaps.slice(0, 5)) {
  console.log("  GAP:", g.requirement.subjectName, "—", g.requirement.className, `${g.placedPeriods}/${g.requiredPeriods}`);
}
// Per-class verdicts
for (const report of solution.statistics.perClass ?? []) {
  console.log(
    `  class ${report.classCode}: ${report.status} ${report.placedPeriods}/${report.requiredPeriods} hard=${report.hardIssueCount} gaps=${report.gapPeriods}`,
  );
}
