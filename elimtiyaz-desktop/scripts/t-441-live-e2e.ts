// t-441-live-e2e.ts — THE ONE-COMMAND LIVE END-TO-END VERIFICATION (T-441).
//
// Reproduces the SupabaseTimetableRepository.generateTimetable contract
// end-to-end against the LIVE database through the data gateway
// (PostgREST + the service key), including the T-441 gates:
//
//   DB-1  purge state (0 timetable versions/entries after the T-441 cleanup)
//   DB-2  export the live problem (configuration/classes/subjects/teachers/
//         rooms/constraints) — the REAL data, never a fixture
//   DB-3  GATE 1 — feasibility pre-analysis (fail-closed with precise
//         French reasons BEFORE anything is persisted)
//   DB-4  solve (ts-greedy v1.3.0: eviction repair + pinned-coverage
//         subtraction + preferred-slot continuity)
//   DB-5  canonical validation of the in-memory solution (0 hard violations,
//         0 coverage gaps, 0 coverage EXCESSES — no duplicates)
//   DB-6  insert the version row + entry rows exactly as the repository
//         does (same columns, same chunking, draft status)
//   DB-7  re-read the PERSISTED rows from the database (never trust the
//         generator's memory)
//   DB-8  GATE 3 — independent validation of the re-read rows + row-count
//         + duplicate-key check; ANY failure ROLLS BACK the version
//   DB-9  final verdict report (PERIOD/COUNT/conflict census)
//
// Without SUPABASE_SERVICE_KEY the script runs the OFFLINE leg only
// (DB-2 from the cached export, DB-3..DB-5, DB-9) and prints the exact
// one-liner to re-run with the key for the live legs.
//
// Usage:
//   SUPABASE_SERVICE_KEY=sb_secret_... npx tsx scripts/t-441-live-e2e.ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getTimetableSolver, GREEDY_SOLVER_ID } from "../src/domain/calc/timetable/solver";
import {
  coverageExcesses,
  coverageGaps,
  validateTimetable,
} from "../src/domain/calc/timetable/constraints";
import { analyzeTimetableFeasibility } from "../src/domain/calc/timetable/feasibility";
import type {
  Room,
  TimetableConfiguration,
  TimetableConstraint,
  TimetableDay,
  TimetableProblem,
  TimetableRequirement,
  TimetableSlotAssignment,
} from "../src/domain/model/timetable";

const SUPABASE_URL = "https://vebfehrpzajhstyhinnw.supabase.co";
const YEAR = "e90b43f6-17d7-47f6-bd80-25a93b553d8a";
const KEY = process.env.SUPABASE_SERVICE_KEY ?? "";
const HERE = dirname(fileURLToPath(import.meta.url));

// ── The data-gateway helper (same headers the app's client sends) ──────────
async function rest<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: init?.method ?? "GET",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: init?.method === "POST" ? "return=representation" : "count=exact",
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`PostgREST ${res.status} on ${path}: ${text.slice(0, 300)}`);
  }
  return text ? (JSON.parse(text) as T[]) : [];
}

function toProblem(raw: any): TimetableProblem {
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
  const teachers = raw.personnel.map((p: any) => ({
    id: p.id,
    name: `${p.first_name} ${p.last_name}`,
  }));
  const teacherName = new Map(teachers.map((t: any) => [t.id, t.name]));
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
  return {
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
}

async function main(): Promise<void> {
  const live = KEY.length > 0;

  // ── DB-2: the problem (live export or the cached export) ──────────────
  let raw: any;
  if (live) {
    console.log("[DB-2] exporting the LIVE problem…");
    const cfg = await rest<any>(
      `timetable_configurations?select=*&academic_year_id=eq.${YEAR}&is_active=eq.true`,
    );
    const rooms = await rest<any>("rooms?select=*&is_active=eq.true&order=code");
    const constraints = await rest<any>(
      `timetable_constraints?select=*&academic_year_id=eq.${YEAR}&is_active=eq.true`,
    );
    const classes = await rest<any>(
      `classes?select=id,code,name,capacity&academic_year_id=eq.${YEAR}&is_active=eq.true&order=code`,
    );
    const cs = await rest<any>(
      `class_subjects?select=class_id,subject_id,teacher_id,weekly_hours,consecutive_periods,required_room_type,` +
        `subjects(code,name_fr),classes!inner(code,name,capacity)` +
        `&classes.academic_year_id=eq.${YEAR}&is_active=eq.true`,
    );
    const personnel = await rest<any>(
      "personnel?select=id,first_name,last_name&order=last_name",
    );
    raw = {
      configuration: cfg[0],
      rooms,
      constraints,
      classes,
      class_subjects: cs,
      personnel,
    };
  } else {
    console.log("[DB-2] no SUPABASE_SERVICE_KEY — using the cached live export");
    raw = JSON.parse(readFileSync(join(HERE, "t-441-live-problem.json"), "utf8"));
  }
  const problem = toProblem(raw);
  console.log(
    `      ${problem.classes.length} classes, ${problem.requirements.length} requirements, ` +
      `${problem.teachers.length} teachers, ${problem.rooms.length} rooms, ${problem.constraints.length} constraints`,
  );

  if (live) {
    // ── DB-1: the purge state ───────────────────────────────────────────
    const versions = await rest<any>(
      `timetable_versions?select=id,version_number,status,label&academic_year_id=eq.${YEAR}`,
    );
    const entries = await rest<any>(`timetable_entries?select=id&academic_year_id=eq.${YEAR}`);
    console.log(
      `[DB-1] purge state: ${versions.length} version(s), ${entries.length} entr(ies) ` +
        (versions.length === 0
          ? "— CLEAN SLATE ✓"
          : `— existing: ${versions.map((v) => `#${v.version_number}(${v.status})`).join(", ")}`),
    );
  }

  // ── DB-3: GATE 1 — feasibility ───────────────────────────────────────────
  const issues = analyzeTimetableFeasibility(problem);
  if (issues.length > 0) {
    console.log(`[DB-3] GATE 1 REJECTED the problem — ${issues.length} impossibilit(ies):`);
    for (const i of issues) console.log(`      - ${i.message}`);
    process.exit(1);
  }
  console.log("[DB-3] GATE 1 feasibility: 0 issue ✓");

  // ── DB-4: solve ──────────────────────────────────────────────────────────
  const solver = getTimetableSolver(GREEDY_SOLVER_ID)!;
  const solution = solver.solve(problem);
  console.log(
    `[DB-4] solved with ${solver.id} ${solver.build}: ` +
      `${solution.statistics.placedPeriods}/${solution.statistics.requiredPeriods} periods, ` +
      `${solution.unplaced.length} unplaced`,
  );

  // ── DB-5: canonical validation of the in-memory solution ────────────────
  const hard = validateTimetable(problem, solution.entries).filter(
    (v) => v.severity === "hard",
  );
  const gaps = coverageGaps(problem, solution.entries);
  const excesses = coverageExcesses(problem, solution.entries);
  if (solution.unplaced.length > 0 || hard.length > 0 || gaps.length > 0 || excesses.length > 0) {
    console.log("[DB-5] FAILED the in-memory validation:");
    for (const v of hard) console.log(`      HARD ${v.message}`);
    for (const g of gaps) console.log(`      GAP ${g.requirement.subjectName} — ${g.requirement.className} ${g.placedPeriods}/${g.requiredPeriods}`);
    for (const x of excesses) console.log(`      EXCESS ${x.requirement.subjectName} — ${x.requirement.className} ${x.placedPeriods}/${x.requiredPeriods}`);
    process.exit(1);
  }
  console.log("[DB-5] in-memory validation: 0 hard violation, 0 gap, 0 excess ✓");

  if (!live) {
    console.log("\nOFFLINE VERDICT: the live problem solves COMPLETELY.");
    console.log("For the live legs (DB-1, DB-6..DB-9) re-run with:");
    console.log("  SUPABASE_SERVICE_KEY=sb_secret_... npx tsx scripts/t-441-live-e2e.ts");
    return;
  }

  // ── DB-6: insert the version + entries (the repository's exact contract) ─
  const tenantId = problem.configuration.tenantId;
  const existing = await rest<any>(
    `timetable_versions?select=version_number&academic_year_id=eq.${YEAR}&order=version_number.desc&limit=1`,
  );
  const versionNumber =
    (existing.length > 0 ? Number(existing[0].version_number) : 0) + 1;
  const now = new Date().toISOString();
  const [versionRow] = await rest<any>("timetable_versions", {
    method: "POST",
    body: {
      tenant_id: tenantId,
      academic_year_id: YEAR,
      version_number: versionNumber,
      status: "draft",
      label: `T-441 vérification E2E ${new Date().toISOString().slice(0, 10)}`,
      solver_id: solver.id,
      solver_build: solver.build,
      generation_params: {
        fromVersionId: null,
        referenceVersionId: null,
        classIds: null,
        carriedEntries: 0,
        lockedEntries: 0,
        feasibilityChecked: true,
        liveE2eVerification: true,
      },
      statistics: {
        ...solution.statistics,
        violations: [],
      },
      hard_violation_count: solution.statistics.hardViolationCount,
      soft_violation_count: solution.statistics.softViolationCount,
      unplaced_count: solution.statistics.unplacedCount,
      created_by: null,
      created_by_name: "T-441 live E2E verification",
      created_at: now,
      updated_at: now,
    },
  });
  const versionId = versionRow.id;
  console.log(`[DB-6] version #${versionNumber} created (${versionId})`);

  const periodByIndex = new Map(
    problem.configuration.periods.map((p: any) => [p.index, p]),
  );
  const rows = solution.entries.map((slot) => {
    const period = periodByIndex.get(slot.periodIndex);
    return {
      tenant_id: tenantId,
      academic_year_id: YEAR,
      version_id: versionId,
      class_id: slot.classId,
      subject_id: slot.subjectId,
      teacher_id: slot.teacherId,
      room_id: slot.roomId,
      day: slot.day,
      period_index: slot.periodIndex,
      start_minutes: period?.startMinutes ?? 0,
      end_minutes: period?.endMinutes ?? 0,
      lesson_group: slot.lessonGroup,
      is_locked: false,
      source: "generated",
    };
  });
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await rest("timetable_entries", { method: "POST", body: rows.slice(i, i + CHUNK) });
  }
  console.log(`[DB-6] ${rows.length} entry rows inserted (chunks of ${CHUNK})`);

  // ── DB-7 + DB-8: re-read the persisted rows, validate INDEPENDENTLY ────
  const persistedRows = await rest<any>(
    `timetable_entries?select=*&version_id=eq.${versionId}&order=period_index`,
  );
  const slots: TimetableSlotAssignment[] = persistedRows.map((r) => ({
    classId: r.class_id,
    subjectId: r.subject_id,
    teacherId: r.teacher_id ?? null,
    roomId: r.room_id ?? null,
    day: r.day as TimetableDay,
    periodIndex: Number(r.period_index),
    lessonGroup: Number(r.lesson_group),
  }));
  console.log(`[DB-7] re-read ${slots.length} persisted rows`);

  const errors: string[] = [];
  if (slots.length !== solution.entries.length) {
    errors.push(
      `row count: ${slots.length} persisted for ${solution.entries.length} generated`,
    );
  }
  const seen = new Set<string>();
  for (const s of slots) {
    const k = `${s.classId}|${s.subjectId}|${s.day}|${s.periodIndex}`;
    if (seen.has(k)) errors.push(`duplicate row (${k})`);
    seen.add(k);
  }
  for (const v of validateTimetable(problem, slots)) {
    if (v.severity === "hard") errors.push(`[Conflit] ${v.message}`);
  }
  for (const g of coverageGaps(problem, slots)) {
    errors.push(
      `${g.requirement.subjectName} — ${g.requirement.className}: ${g.placedPeriods}/${g.requiredPeriods} persistées`,
    );
  }
  for (const x of coverageExcesses(problem, slots)) {
    errors.push(
      `EXCESS ${x.requirement.subjectName} — ${x.requirement.className}: ${x.placedPeriods}/${x.requiredPeriods} persistées (cours en double)`,
    );
  }
  if (errors.length > 0) {
    console.log(`[DB-8] GATE 3 FAILED — rolling back (${errors.length} error(s)):`);
    for (const e of errors) console.log(`      - ${e}`);
    await rest(`timetable_entries?version_id=eq.${versionId}`, { method: "DELETE" });
    await rest(`timetable_versions?id=eq.${versionId}`, { method: "DELETE" });
    console.log("      version rolled back — the live DB stays clean");
    process.exit(1);
  }
  console.log("[DB-8] GATE 3 independent validation of the persisted rows: PASS ✓");

  // ── DB-9: the final census ───────────────────────────────────────────────
  const teacherClashes = new Map<string, number>();
  const slotOf = (s: TimetableSlotAssignment) => `${s.day}#${s.periodIndex}`;
  for (const s of slots) {
    if (s.teacherId) {
      const k = `${s.teacherId}|${slotOf(s)}`;
      teacherClashes.set(k, (teacherClashes.get(k) ?? 0) + 1);
    }
  }
  const clashes = [...teacherClashes.values()].filter((n) => n > 1).length;
  console.log(`[DB-9] FINAL: ${slots.length} periods, ${clashes} teacher clash(es), ` +
    `0 duplicates, 0 unmet hours, 0 out-of-bounds — the draft version #${versionNumber} ` +
    `is a COMPLETE, conflict-free school timetable ✓`);
  console.log(`      verify in the app: Academic → Timetable → trial #${versionNumber} (draft)`);
  console.log("      (delete this draft in the app, or keep it as the new baseline schedule)");
}

main().catch((e) => {
  console.error("E2E FAILURE:", e instanceof Error ? e.message : e);
  process.exit(1);
});
