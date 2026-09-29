import { buildFixtureProblem } from "../src/domain/calc/timetable/fixture";
import { getTimetableSolver, GREEDY_SOLVER_ID } from "../src/domain/calc/timetable/solver";
import "../src/domain/calc/timetable/solver";
import type {
  TimetableConstraint,
  TimetableProblem,
  TimetableRequirement,
} from "../src/domain/model/timetable";

const solver = getTimetableSolver(GREEDY_SOLVER_ID)!;
const base = buildFixtureProblem();

function constraint(
  id: string,
  scope: TimetableConstraint["scope"],
  entityId: string | null,
  kind: TimetableConstraint["kind"],
  params: Record<string, unknown>,
): TimetableConstraint {
  return {
    id,
    tenantId: "t",
    academicYearId: "y",
    scope,
    entityId,
    kind,
    severity: "hard",
    params,
    isActive: true,
    createdAt: "",
    updatedAt: "",
  };
}

function req(
  classId: string,
  subjectId: string,
  teacherId: string,
  hours: number,
  consecutive: number,
): TimetableRequirement {
  return {
    classId,
    subjectId,
    teacherId,
    weeklyHours: hours,
    consecutivePeriods: consecutive,
    requiredRoomType: null,
    className: classId,
    subjectName: subjectId,
    teacherName: null,
    classSize: 30,
  };
}

// Search space: 3 classes; T teaches in all three; one class may carry a free
// day; one filler may use double blocks. The corner subject X@cls-z (teacher
// T) sorts LAST. We want: repair pass RUNS (unplaced existed) and final
// status VALID (eviction rescued it).
let found = 0;
for (const freeDayB of [null, "monday", "wednesday"] as const) {
  for (const a of [0, 1, 2, 3, 4]) {
    for (const w of [18, 20, 21, 22, 23, 24, 25, 26]) {
      for (const zfill of [20, 24, 25, 26, 27, 28]) {
        for (const zConsecutive of [1, 2]) {
          const tLoad = a + w + 2;
          if (tLoad > 30) continue;
          const clsBDays = 5 - (freeDayB ? 1 : 0);
          if (w + 2 > clsBDays * 6) continue; // cls-b's own capacity (W + Z=2)
          const requirements = [
            req("cls-a", "sub-a", "tch-math", a, 1),
            req("cls-a", "sub-y", "tch-fr", 29 - a, 1),
            req("cls-b", "sub-w", "tch-math", w, 1),
            req("cls-b", "sub-z", "tch-arab", 2, 1),
            req("cls-z", "sub-v", "tch-phys", zfill, zConsecutive),
            req("cls-z", "sub-x", "tch-math", 2, 1),
          ].filter((r) => r.weeklyHours > 0);
          const constraints = base.constraints.filter(
            (c) => c.id !== "c-free-1as-wed",
          );
          if (freeDayB) {
            constraints.push(
              constraint("c-free-b", "class", "cls-b", "free_day", { day: freeDayB }),
            );
          }
          const problem: TimetableProblem = {
            ...base,
            requirements,
            constraints,
          };
          const events: string[] = [];
          const solution = solver.solve(problem, {
            onProgress: (p) => events.push(p.message),
          });
          const repairRan = events.some((m) =>
            /Réparation \/ optimisation — [1-9]/.test(m),
          );
          if (repairRan && solution.status === "valid") {
            console.log(
              `RESCUED: freeB=${freeDayB} a=${a} w=${w} zfill=${zfill} zc=${zConsecutive} tLoad=${tLoad}`,
            );
            found++;
            if (found > 5) process.exit(0);
          }
        }
      }
    }
  }
}
console.log("done, found =", found);
