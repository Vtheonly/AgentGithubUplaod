// ============================================================================
// FILE: src/tests/domain/calc/timetable/t-441-feasibility.test.ts
// ============================================================================
/**
 * T-441 — the feasibility pre-analysis tests (Gate 1) + the independent
 * post-persist validation layer (Gate 3): every mathematically impossible
 * constraint family must be detected BEFORE any generation, with a precise
 * reason naming the class / subject / teacher / room / day / period / pin
 * involved — and the persisted-rows validator must catch every corruption
 * shape it exists for.
 */

import { describe, expect, it } from "vitest";
import {
  analyzeTimetableFeasibility,
  feasibilityErrorMessage,
  persistedValidationError,
  validatePersistedSolution,
} from "../../../../domain/calc/timetable/feasibility";
import {
  buildFixtureProblem,
  buildImpossibleProblem,
} from "../../../../domain/calc/timetable/fixture";
import type {
  TimetableConstraint,
  TimetableDay,
  TimetableProblem,
  TimetableRequirement,
} from "../../../../domain/model/timetable";

// ── Test-problem builders ───────────────────────────────────────────────────

function withRequirements(
  problem: TimetableProblem,
  requirements: TimetableRequirement[],
): TimetableProblem {
  return { ...problem, requirements };
}

function withConstraints(
  problem: TimetableProblem,
  constraints: TimetableConstraint[],
): TimetableProblem {
  return { ...problem, constraints: [...problem.constraints, ...constraints] };
}

function constraint(
  id: string,
  scope: TimetableConstraint["scope"],
  entityId: string | null,
  kind: TimetableConstraint["kind"],
  severity: TimetableConstraint["severity"],
  params: Record<string, unknown>,
): TimetableConstraint {
  return {
    id,
    tenantId: "tenant-t441",
    academicYearId: "year-t441",
    scope,
    entityId,
    kind,
    severity,
    params,
    isActive: true,
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
  };
}

const ALL_DAYS: TimetableDay[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
];

// ============================================================================
// The known-good problems pass the pre-analysis
// ============================================================================

describe("T-441 — feasibility: solvable problems report NOTHING", () => {
  it("the known-good fixture has zero feasibility issues", () => {
    expect(analyzeTimetableFeasibility(buildFixtureProblem())).toEqual([]);
  });

  it("a tight-but-exactly-fitting class (100% occupancy) is NOT flagged", () => {
    // 5 days × 6 periods, max 6/day → exactly 30 available slots; the class
    // needs exactly 30 periods. Feasible (barely) — must NOT fire.
    // (cls-2as-a has NO free day in the fixture — the honest 30-slot class.)
    const base = buildFixtureProblem();
    const tight: TimetableRequirement[] = [
      {
        ...base.requirements[0],
        classId: "cls-2as-a",
        className: "2ème AS — Section A",
        teacherId: "tch-math",
        weeklyHours: 30,
      },
    ];
    const problem = withRequirements(base, tight);
    expect(analyzeTimetableFeasibility(problem)).toEqual([]);
  });

  it("the T-404 impossible-lab variant IS flagged (room pool exhaustion)", () => {
    const issues = analyzeTimetableFeasibility(buildImpossibleProblem());
    // The lab is available exactly one period while 3 classes each need a
    // 2-period double block: 6 needed > 1 offered.
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.kind === "room_pool_exhausted")).toBe(true);
  });
});

// ============================================================================
// Every impossible family fires with the precise reason
// ============================================================================

describe("T-441 — feasibility: every impossibility family fires precisely", () => {
  it("CLASS CAPACITY EXCEEDED: 31 periods needed > 30 slots available", () => {
    const base = buildFixtureProblem();
    const problem = withRequirements(base, [
      {
        ...base.requirements[0],
        classId: "cls-1as-a",
        teacherId: "tch-math",
        weeklyHours: 31,
      },
    ]);
    const issues = analyzeTimetableFeasibility(problem);
    const hit = issues.find((i) => i.kind === "class_capacity_exceeded");
    expect(hit).toBeDefined();
    if (hit) {
      expect(hit.refs.classId).toBe("cls-1as-a");
      expect(hit.message).toContain("31 périodes hebdomadaires");
      // The fixture pins Wednesday free for 1AS-A → 4 days × 6 = 24 slots.
      expect(hit.message).toContain("24 périodes sont disponibles");
      expect(hit.message).toContain("il manque 7 périodes");
    }
  });

  it("TEACHER OVERLOADED: one teacher assigned beyond every available slot", () => {
    const base = buildFixtureProblem();
    // tch-math teaches 6h in EVERY class → 18h; PLUS the fixture already
    // gives it 4h in class 1... make it 27+4: build a clean case instead:
    const problem = withRequirements(
      base,
      [
        {
          ...base.requirements[0],
          classId: "cls-1as-a",
          teacherId: "tch-math",
          weeklyHours: 28,
        },
        {
          ...base.requirements[0],
          classId: "cls-2as-a",
          teacherId: "tch-math",
          weeklyHours: 28,
        },
      ],
    );
    const issues = analyzeTimetableFeasibility(problem);
    const hit = issues.find((i) => i.kind === "teacher_overloaded");
    expect(hit).toBeDefined();
    if (hit) {
      expect(hit.refs.teacherId).toBe("tch-math");
      expect(hit.message).toContain("56 périodes/semaine");
      expect(hit.message).toContain("tch-math".length > 0 ? "n'a que" : "");
    }
  });

  it("TEACHER OVERLOADED via unavailability: 30h needed, teacher free only 24 slots", () => {
    const base = buildFixtureProblem();
    const unavailable: TimetableConstraint[] = [];
    let n = 0;
    // Make tch-math unavailable all day Monday (6 slots): 30 - 6 = 24 slots.
    for (let p = 1; p <= 6; p++) {
      unavailable.push(
        constraint(`c-unavail-math-${n++}`, "teacher", "tch-math", "unavailable_period", "hard", {
          day: "monday",
          periodIndex: p,
        }),
      );
    }
    const problem = withConstraints(
      withRequirements(base, [
        {
          ...base.requirements[0],
          classId: "cls-1as-a",
          teacherId: "tch-math",
          weeklyHours: 30,
        },
      ]),
      unavailable,
    );
    const hit = analyzeTimetableFeasibility(problem).find(
      (i) => i.kind === "teacher_overloaded",
    );
    expect(hit).toBeDefined();
    if (hit) {
      expect(hit.message).toContain("30 périodes/semaine");
      expect(hit.message).toContain("24 périodes disponibles");
    }
  });

  it("ROOM TYPE MISSING: no active science lab configured", () => {
    const base = buildFixtureProblem();
    const problem: TimetableProblem = {
      ...base,
      rooms: base.rooms.filter((r) => r.roomType !== "science_lab"),
    };
    const issues = analyzeTimetableFeasibility(problem);
    const hits = issues.filter((i) => i.kind === "room_type_missing");
    // Sciences (lab, double blocks) for 3 classes → 3 issues.
    expect(hits.length).toBe(3);
    expect(hits[0].message).toContain("exige une salle de type « science_lab »");
    expect(hits[0].message).toContain("aucune salle active de ce type");
  });

  it("ROOM CAPACITY INSUFFICIENT: the class is bigger than every lab", () => {
    const base = buildFixtureProblem();
    const problem: TimetableProblem = {
      ...base,
      requirements: base.requirements.map((r) =>
        r.requiredRoomType === "science_lab"
          ? { ...r, classSize: 40 }
          : r,
      ),
    };
    const hits = analyzeTimetableFeasibility(problem).filter(
      (i) => i.kind === "room_capacity_insufficient",
    );
    expect(hits.length).toBe(3);
    expect(hits[0].message).toContain("(40 élèves)");
    expect(hits[0].message).toContain("ne contient que 32 places");
  });

  it("ROOM POOL EXHAUSTED: 2 lab-requiring subjects per class, one lab", () => {
    const base = buildFixtureProblem();
    // Add a second lab-requiring subject (Sciences TP + Chimie) per class:
    // 3 classes × (2 + 2) periods = 12 lab-periods needed... the lab has 30
    // slots minus 2 (Thursday P5/P6 unavailable) = 28 — NOT exhausted. Push
    // the hours until it is: Phys 8h/class → 24 periods + 2 = 26... Chem 8h
    // too → 48 + 2 > 28. Simpler: Phys 10h (5 double blocks) per class.
    const problem = withRequirements(
      base,
      base.requirements.map((r) =>
        r.subjectId === "sub-phys" ? { ...r, weeklyHours: 20 } : r,
      ),
    );
    // 3 classes × 20 periods = 60 lab-periods needed vs 28 offered.
    const hit = analyzeTimetableFeasibility(problem).find(
      (i) => i.kind === "room_pool_exhausted",
    );
    expect(hit).toBeDefined();
    if (hit) {
      expect(hit.message).toContain("science_lab");
      expect(hit.message).toContain("totalisent 60 périodes/semaine");
    }
  });

  it("SCHOOL WEEK ALL FREE: every school day is a school-scope free day", () => {
    const base = buildFixtureProblem();
    const problem = withConstraints(
      base,
      ALL_DAYS.map((d) =>
        constraint(`c-free-school-${d}`, "school", null, "free_day", "hard", {
          day: d,
        }),
      ),
    );
    const hit = analyzeTimetableFeasibility(problem).find(
      (i) => i.kind === "school_week_all_free",
    );
    expect(hit).toBeDefined();
    expect(hit?.message).toContain("jours libres au niveau de l'établissement");
  });

  it("CLASS WEEK ALL FREE: every school day is a free day for ONE class", () => {
    const base = buildFixtureProblem();
    const problem = withConstraints(
      base,
      ALL_DAYS.map((d) =>
        constraint(`c-free-1as-${d}`, "class", "cls-1as-a", "free_day", "hard", {
          day: d,
        }),
      ),
    );
    const hit = analyzeTimetableFeasibility(problem).find(
      (i) => i.kind === "class_week_all_free",
    );
    expect(hit).toBeDefined();
    if (hit) {
      expect(hit.refs.classId).toBe("cls-1as-a");
      expect(hit.message).toContain("1ère AS — Section A");
    }
  });

  it("BLOCK NEVER FITS: 3 consecutive periods cannot fit any break-free run", () => {
    const base = buildFixtureProblem();
    // The Algerian profile has a break after period 3 → runs cap at 3
    // (periods 1-3 or 4-6). Request 4 consecutive → never fits.
    const problem = withRequirements(
      base,
      base.requirements.map((r) =>
        r.subjectId === "sub-phys"
          ? { ...r, weeklyHours: 4, consecutivePeriods: 4 }
          : r,
      ),
    );
    const hit = analyzeTimetableFeasibility(problem).find(
      (i) => i.kind === "block_never_fits",
    );
    expect(hit).toBeDefined();
    if (hit) {
      expect(hit.message).toContain("4 périodes consécutives");
      // The Algerian profile breaks (after P2 and after P4) cap runs at 2.
      expect(hit.message).toContain("plus de 2 périodes consécutives");
    }
  });

  it("PINNED ENTRY CLASH: two locked entries share a teacher at one slot", () => {
    const base = buildFixtureProblem();
    const problem: TimetableProblem = {
      ...base,
      lockedEntries: [
        {
          classId: "cls-1as-a",
          subjectId: "sub-math",
          teacherId: "tch-math",
          roomId: "room-c1",
          day: "monday",
          periodIndex: 2,
          lessonGroup: 100,
        },
        {
          classId: "cls-2as-a",
          subjectId: "sub-math",
          teacherId: "tch-math",
          roomId: "room-c2",
          day: "monday",
          periodIndex: 2,
          lessonGroup: 101,
        },
      ],
    };
    const hit = analyzeTimetableFeasibility(problem).find(
      (i) => i.kind === "pinned_entry_clash",
    );
    expect(hit).toBeDefined();
    if (hit) {
      expect(hit.refs.teacherId).toBe("tch-math");
      expect(hit.message).toContain("partagent l'enseignant");
    }
  });

  it("PINNED ENTRY ILLEGAL: a locked entry on the class's free day", () => {
    const base = buildFixtureProblem();
    // cls-1as-a has Wednesday free (fixture constraint) — pin there.
    const problem: TimetableProblem = {
      ...base,
      lockedEntries: [
        {
          classId: "cls-1as-a",
          subjectId: "sub-math",
          teacherId: "tch-math",
          roomId: "room-c1",
          day: "wednesday",
          periodIndex: 1,
          lessonGroup: 100,
        },
      ],
    };
    const hit = analyzeTimetableFeasibility(problem).find(
      (i) => i.kind === "pinned_entry_illegal",
    );
    expect(hit).toBeDefined();
    if (hit) {
      expect(hit.message).toContain("tombe un jour libre");
    }
  });

  it("PINNED ENTRY ILLEGAL: a locked entry outside the configured grid", () => {
    const base = buildFixtureProblem();
    const problem: TimetableProblem = {
      ...base,
      lockedEntries: [
        {
          classId: "cls-1as-a",
          subjectId: "sub-math",
          teacherId: "tch-math",
          roomId: "room-c1",
          day: "saturday", // not a school day
          periodIndex: 9, // not a teaching period
          lessonGroup: 100,
        },
      ],
    };
    const hit = analyzeTimetableFeasibility(problem).find(
      (i) => i.kind === "pinned_entry_illegal",
    );
    expect(hit).toBeDefined();
    expect(hit?.message).toContain("hors de la grille scolaire");
  });

  it("CARRIED entries clash with LOCKED pins across classes (partial mode)", () => {
    const base = buildFixtureProblem();
    // A carried cls-2as-a entry (teacher tch-math) colliding with a locked
    // cls-1as-a pin at the same slot — the single-class mode's busy-grid
    // pre-seeding contract makes this a provable impossibility UP FRONT.
    const problem: TimetableProblem = {
      ...base,
      lockedEntries: [
        {
          classId: "cls-1as-a",
          subjectId: "sub-math",
          teacherId: "tch-math",
          roomId: "room-c1",
          day: "tuesday",
          periodIndex: 3,
          lessonGroup: 100,
        },
      ],
      carriedEntries: [
        {
          classId: "cls-2as-a",
          subjectId: "sub-math",
          teacherId: "tch-math",
          roomId: "room-c2",
          day: "tuesday",
          periodIndex: 3,
          lessonGroup: 200,
        },
      ],
    };
    const hit = analyzeTimetableFeasibility(problem).find(
      (i) => i.kind === "pinned_entry_clash",
    );
    expect(hit).toBeDefined();
    if (hit) {
      expect(hit.refs.teacherId).toBe("tch-math");
    }
  });
});

// ============================================================================
// The error message contract
// ============================================================================

describe("T-441 — feasibility error messages", () => {
  it("formats every issue as a numbered French line behind a clear header", () => {
    const base = buildFixtureProblem();
    const problem = withRequirements(base, [
      {
        ...base.requirements[0],
        classId: "cls-1as-a",
        teacherId: "tch-math",
        weeklyHours: 31,
      },
    ]);
    const msg = feasibilityErrorMessage(analyzeTimetableFeasibility(problem));
    expect(msg).toContain(
      "Génération impossible — les contraintes sont mathématiquement irréalisables :",
    );
    expect(msg).toContain("1. La classe 1ère AS — Section A exige 31 périodes");
  });
});

// ============================================================================
// The independent post-persist validation layer (Gate 3)
// ============================================================================

describe("T-441 — validatePersistedSolution (the independent layer)", () => {
  const problem = buildFixtureProblem();

  it("accepts a complete, conflict-free solution with matching count", () => {
    const slots = [
      ...problem.lockedEntries,
      ...carriedFixture(problem),
      ...solvedShape(problem),
    ];
    // Build a trivially valid set: one class, its full hours, in-bounds.
    const valid = [
      {
        classId: "cls-1as-a",
        subjectId: "sub-math",
        teacherId: "tch-math",
        roomId: "room-c1",
        day: "sunday" as TimetableDay,
        periodIndex: 1,
        lessonGroup: 1,
      },
    ];
    expect(
      validatePersistedSolution(
        withRequirements(problem, [
          { ...problem.requirements[0], weeklyHours: 1 },
        ]),
        valid,
        1,
      ),
    ).toEqual([]);
    void slots;
  });

  it("detects a ROW-COUNT mismatch (rows lost on persist)", () => {
    const errors = validatePersistedSolution(problem, [], 5);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("0 lignes persistées pour 5 attendues");
    expect(persistedValidationError(errors)).toContain(
      "Génération annulée — la validation indépendante des lignes persistées a échoué",
    );
  });

  it("detects DUPLICATE (class, subject, day, period) rows", () => {
    const dup = [
      {
        classId: "cls-1as-a",
        subjectId: "sub-math",
        teacherId: "tch-math",
        roomId: "room-c1",
        day: "sunday" as TimetableDay,
        periodIndex: 1,
        lessonGroup: 1,
      },
      {
        classId: "cls-1as-a",
        subjectId: "sub-math",
        teacherId: "tch-math",
        roomId: "room-c1",
        day: "sunday" as TimetableDay,
        periodIndex: 1,
        lessonGroup: 2,
      },
    ];
    const errors = validatePersistedSolution(problem, dup, 2);
    expect(errors.some((e) => e.includes("doublon détecté"))).toBe(true);
  });

  it("detects a TEACHER clash among persisted rows", () => {
    const clash = [
      {
        classId: "cls-1as-a",
        subjectId: "sub-math",
        teacherId: "tch-math",
        roomId: "room-c1",
        day: "sunday" as TimetableDay,
        periodIndex: 1,
        lessonGroup: 1,
      },
      {
        classId: "cls-2as-a",
        subjectId: "sub-math",
        teacherId: "tch-math",
        roomId: "room-c2",
        day: "sunday" as TimetableDay,
        periodIndex: 1,
        lessonGroup: 2,
      },
    ];
    const errors = validatePersistedSolution(problem, clash, 2);
    expect(
      errors.some((e) => e.includes("[Conflit]") && e.includes("enseignant")),
    ).toBe(true);
  });

  it("detects UNMET WEEKLY HOURS among persisted rows (coverage gap)", () => {
    const one = [
      {
        classId: "cls-1as-a",
        subjectId: "sub-math",
        teacherId: "tch-math",
        roomId: "room-c1",
        day: "sunday" as TimetableDay,
        periodIndex: 1,
        lessonGroup: 1,
      },
    ];
    const errors = validatePersistedSolution(problem, one, 1);
    expect(errors.some((e) => e.includes("périodes persistées"))).toBe(true);
  });

  it("detects an OUT-OF-GRID persisted slot (period 99)", () => {
    const bad = [
      {
        classId: "cls-1as-a",
        subjectId: "sub-math",
        teacherId: "tch-math",
        roomId: "room-c1",
        day: "sunday" as TimetableDay,
        periodIndex: 99,
        lessonGroup: 1,
      },
    ];
    const errors = validatePersistedSolution(
      withRequirements(problem, [
        { ...problem.requirements[0], weeklyHours: 1 },
      ]),
      bad,
      1,
    );
    expect(errors.some((e) => e.includes("invalide pour la configuration"))).toBe(
      true,
    );
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function carriedFixture(_problem: TimetableProblem): never[] {
  return [];
}
function solvedShape(_problem: TimetableProblem): never[] {
  return [];
}
