/**
 * Academic seed data — provides realistic data for the previously-stubbed
 * repository read paths (subjects by class, grades, attendance, homework, releve).
 *
 * Iteration 6: This file eliminates the empty-state issue where ClassGradesTab,
 * ClassAttendanceTab, HomeworkHistoryTab, and ReleveTab always showed empty
 * data even though the corresponding write paths (enterGrade, recordRollCall,
 * push, logEntry) worked correctly.
 *
 * Seed dates are anchored to SEED_NOW (2025-09-15) defined in seed-data.ts.
 */

import { SEED_NOW } from "./seed-data";

const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => iso(new Date(SEED_NOW.getTime() - n * 86_400_000));
const daysFromNow = (n: number) => iso(new Date(SEED_NOW.getTime() + n * 86_400_000));

// ---------------------------------------------------------------------------
// Class-Subject mappings — assigns subjects to classes with teacher + coefficient
// ---------------------------------------------------------------------------

export const seedClassSubjects = [
  // cls-001 (4ème A Primaire) — taught by per-001 (Mme Aïcha Bouhenni)
  { id: "csj-001", classId: "cls-001", subjectId: "sub-001", teacherId: "per-001", teacherName: "Mme Aïcha Bouhenni", weeklyHours: 6, coefficient: 3 },
  { id: "csj-002", classId: "cls-001", subjectId: "sub-002", teacherId: "per-001", teacherName: "Mme Aïcha Bouhenni", weeklyHours: 5, coefficient: 3 },
  { id: "csj-003", classId: "cls-001", subjectId: "sub-003", teacherId: "per-001", teacherName: "Mme Aïcha Bouhenni", weeklyHours: 5, coefficient: 4 },
  { id: "csj-004", classId: "cls-001", subjectId: "sub-009", teacherId: "per-002", teacherName: "M. Sofiane Larbi", weeklyHours: 2, coefficient: 1 },
  // cls-002 (1ère B Primaire) — taught by per-002 (M. Sofiane Larbi)
  { id: "csj-005", classId: "cls-002", subjectId: "sub-001", teacherId: "per-002", teacherName: "M. Sofiane Larbi", weeklyHours: 6, coefficient: 3 },
  { id: "csj-006", classId: "cls-002", subjectId: "sub-002", teacherId: "per-002", teacherName: "M. Sofiane Larbi", weeklyHours: 5, coefficient: 3 },
  { id: "csj-007", classId: "cls-002", subjectId: "sub-003", teacherId: "per-002", teacherName: "M. Sofiane Larbi", weeklyHours: 5, coefficient: 4 },
  { id: "csj-008", classId: "cls-002", subjectId: "sub-011", teacherId: "per-003", teacherName: "Mme Nadia Hamidi", weeklyHours: 2, coefficient: 1 },
  // cls-003 (2ème CEM A) — taught by per-003 (Mme Nadia Hamidi)
  { id: "csj-009", classId: "cls-003", subjectId: "sub-004", teacherId: "per-003", teacherName: "Mme Nadia Hamidi", weeklyHours: 4, coefficient: 2 },
  { id: "csj-010", classId: "cls-003", subjectId: "sub-005", teacherId: "per-003", teacherName: "Mme Nadia Hamidi", weeklyHours: 4, coefficient: 3 },
  { id: "csj-011", classId: "cls-003", subjectId: "sub-006", teacherId: "per-003", teacherName: "Mme Nadia Hamidi", weeklyHours: 3, coefficient: 2 },
  { id: "csj-012", classId: "cls-003", subjectId: "sub-010", teacherId: "per-002", teacherName: "M. Sofiane Larbi", weeklyHours: 2, coefficient: 1 },
  // cls-004 (4ème CEM B) — taught by per-004 (M. Karim Zidane)
  { id: "csj-013", classId: "cls-004", subjectId: "sub-004", teacherId: "per-004", teacherName: "M. Karim Zidane", weeklyHours: 4, coefficient: 2 },
  { id: "csj-014", classId: "cls-004", subjectId: "sub-005", teacherId: "per-004", teacherName: "M. Karim Zidane", weeklyHours: 4, coefficient: 3 },
  { id: "csj-015", classId: "cls-004", subjectId: "sub-006", teacherId: "per-004", teacherName: "M. Karim Zidane", weeklyHours: 3, coefficient: 2 },
  { id: "csj-016", classId: "cls-004", subjectId: "sub-012", teacherId: "per-001", teacherName: "Mme Aïcha Bouhenni", weeklyHours: 2, coefficient: 1 },
  // cls-005 (1ère Lycée S) — taught by per-005 (Mme Samira Belmiloud)
  { id: "csj-017", classId: "cls-005", subjectId: "sub-004", teacherId: "per-005", teacherName: "Mme Samira Belmiloud", weeklyHours: 4, coefficient: 2 },
  { id: "csj-018", classId: "cls-005", subjectId: "sub-005", teacherId: "per-005", teacherName: "Mme Samira Belmiloud", weeklyHours: 4, coefficient: 3 },
  { id: "csj-019", classId: "cls-005", subjectId: "sub-007", teacherId: "per-005", teacherName: "Mme Samira Belmiloud", weeklyHours: 4, coefficient: 3 },
  // cls-006 (2ème Lycée L) — taught by per-006 (M. Hocine Rebai)
  { id: "csj-020", classId: "cls-006", subjectId: "sub-006", teacherId: "per-006", teacherName: "M. Hocine Rebai", weeklyHours: 4, coefficient: 2 },
  { id: "csj-021", classId: "cls-006", subjectId: "sub-008", teacherId: "per-006", teacherName: "M. Hocine Rebai", weeklyHours: 3, coefficient: 2 },
  { id: "csj-022", classId: "cls-006", subjectId: "sub-007", teacherId: "per-006", teacherName: "M. Hocine Rebai", weeklyHours: 4, coefficient: 3 },
];

// ---------------------------------------------------------------------------
// Grade assessments — Term 1 (T1) grades for the first few students
// Each entry is (devoir1, devoir2, examen) out of 20.
// ---------------------------------------------------------------------------

import type { Assessment, AcademicTerm } from "../../domain/model/academic";

const TENANT_ID = "tenant-el-imtiyaz-oran-001";

function makeAssessment(
  id: string,
  studentId: string,
  classId: string,
  subjectId: string,
  teacherId: string,
  term: AcademicTerm,
  coefficient: number,
  d1: number,
  d2: number,
  ex: number,
  enteredAtDaysAgo: number,
): Assessment {
  const subjectAverage = (d1 + d2 + 2 * ex) / 4;
  return {
    id,
    studentId,
    classId,
    subjectId,
    term,
    academicYear: "2025-2026",
    devoir1: d1,
    devoir2: d2,
    examen: ex,
    subjectAverage,
    coefficient,
    enteredBy: teacherId,
    enteredAt: daysAgo(enteredAtDaysAgo),
  };
}

export const seedAssessments: Assessment[] = [
  // cls-001 — sub-003 (Math, coef 4) — T1 grades for 3 students
  makeAssessment("asm-001", "stu-001", "cls-001", "sub-003", "per-001", "T1", 4, 14.5, 13.0, 16.0, 8),
  makeAssessment("asm-002", "stu-006", "cls-001", "sub-003", "per-001", "T1", 4, 17.0, 15.5, 18.0, 8),
  makeAssessment("asm-003", "stu-012", "cls-001", "sub-003", "per-001", "T1", 4, 12.0, 11.5, 13.5, 8),
  // cls-001 — sub-002 (Français, coef 3) — T1
  makeAssessment("asm-004", "stu-001", "cls-001", "sub-002", "per-001", "T1", 3, 15.0, 14.0, 15.5, 9),
  makeAssessment("asm-005", "stu-006", "cls-001", "sub-002", "per-001", "T1", 3, 13.5, 12.0, 14.0, 9),
  // cls-002 — sub-003 (Math, coef 4) — T1
  makeAssessment("asm-006", "stu-002", "cls-002", "sub-003", "per-002", "T1", 4, 16.5, 17.0, 18.5, 7),
  makeAssessment("asm-007", "stu-009", "cls-002", "sub-003", "per-002", "T1", 4, 11.0, 12.5, 13.0, 7),
  makeAssessment("asm-008", "stu-015", "cls-002", "sub-003", "per-002", "T1", 4, 14.0, 13.5, 15.0, 7),
  // cls-003 — sub-005 (Sciences, coef 3) — T1
  makeAssessment("asm-009", "stu-003", "cls-003", "sub-005", "per-003", "T1", 3, 13.5, 14.0, 15.5, 6),
  makeAssessment("asm-010", "stu-007", "cls-003", "sub-005", "per-003", "T1", 3, 16.0, 15.5, 17.0, 6),
  makeAssessment("asm-011", "stu-013", "cls-003", "sub-005", "per-003", "T1", 3, 12.5, 11.0, 13.0, 6),
  // cls-004 — sub-005 (Sciences, coef 3) — T1
  makeAssessment("asm-012", "stu-004", "cls-004", "sub-005", "per-004", "T1", 3, 14.5, 13.5, 15.0, 5),
  makeAssessment("asm-013", "stu-010", "cls-004", "sub-005", "per-004", "T1", 3, 15.5, 14.0, 16.0, 5),
  makeAssessment("asm-014", "stu-011", "cls-004", "sub-005", "per-004", "T1", 3, 11.5, 12.0, 13.5, 5),
  // cls-005 — sub-007 (Physique, coef 3) — T1
  makeAssessment("asm-015", "stu-005", "cls-005", "sub-007", "per-005", "T1", 3, 16.0, 15.0, 17.5, 4),
  makeAssessment("asm-016", "stu-014", "cls-005", "sub-007", "per-005", "T1", 3, 14.0, 13.5, 15.0, 4),
  // cls-006 — sub-008 (Philosophie, coef 2) — T1
  makeAssessment("asm-017", "stu-008", "cls-006", "sub-008", "per-006", "T1", 2, 13.0, 14.5, 14.0, 3),
];

// ---------------------------------------------------------------------------
// Attendance records — last 7 days for cls-001 and cls-002
// ---------------------------------------------------------------------------

import type { AttendanceRecord, AttendanceSession, AttendanceStatus } from "../../domain/model/academic";

function makeAttendance(
  id: string,
  studentId: string,
  classId: string,
  date: string,
  session: AttendanceSession,
  status: AttendanceStatus,
  recordedBy: string,
): AttendanceRecord {
  return {
    id,
    studentId,
    classId,
    date,
    session,
    status,
    note: null,
    recordedBy,
    recordedAt: date,
    syncedAt: date,
  };
}

function dateForDaysAgo(n: number): string {
  return new Date(SEED_NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);
}

const cls001StudentIds = ["stu-001", "stu-006", "stu-012"]; // Students in cls-001 from seed data
const cls002StudentIds = ["stu-002", "stu-009", "stu-015"]; // Students in cls-002

// Generate attendance for last 5 school days for cls-001 and cls-002
const attendanceRecords: AttendanceRecord[] = [];
let attendanceIdCounter = 1;
for (let dayOffset = 1; dayOffset <= 5; dayOffset++) {
  const date = dateForDaysAgo(dayOffset);
  // cls-001 morning session — most students present
  for (const studentId of cls001StudentIds) {
    // stu-001 has 3 absences pattern (per seed notification)
    const status: AttendanceStatus =
      studentId === "stu-001" && (dayOffset === 1 || dayOffset === 3 || dayOffset === 5)
        ? "absent_unexcused"
        : studentId === "stu-006" && dayOffset === 2
          ? "late"
          : "present";
    attendanceRecords.push(
      makeAttendance(
        `att-${String(attendanceIdCounter++).padStart(4, "0")}`,
        studentId,
        "cls-001",
        date,
        "morning",
        status,
        "per-001",
      ),
    );
  }
  // cls-002 morning session
  for (const studentId of cls002StudentIds) {
    const status: AttendanceStatus =
      studentId === "stu-009" && dayOffset === 4 ? "absent_excused" : "present";
    attendanceRecords.push(
      makeAttendance(
        `att-${String(attendanceIdCounter++).padStart(4, "0")}`,
        studentId,
        "cls-002",
        date,
        "morning",
        status,
        "per-002",
      ),
    );
  }
}

export const seedAttendance: AttendanceRecord[] = attendanceRecords;

// ---------------------------------------------------------------------------
// Homework assignments
// ---------------------------------------------------------------------------

import type { Homework } from "../../domain/model/academic";

export const seedHomework: Homework[] = [
  {
    id: "hw-001",
    classId: "cls-001",
    subjectId: "sub-003",
    subjectName: "Mathématiques",
    teacherId: "per-001",
    teacherName: "Mme Aïcha Bouhenni",
    title: "Exercices page 42 — multiplication",
    description: "Faire les exercices 1 à 5 page 42. Bien présenter les calculs.",
    dueDate: daysFromNow(3),
    attachments: [],
    academicYear: "2025-2026",
    createdAt: daysAgo(2),
    pushedAt: daysAgo(2),
    acknowledgedCount: 22,
  },
  {
    id: "hw-002",
    classId: "cls-001",
    subjectId: "sub-002",
    subjectName: "Français",
    teacherId: "per-001",
    teacherName: "Mme Aïcha Bouhenni",
    title: "Lecture chapitre 3 — questions",
    description: "Lire le chapitre 3 et répondre aux questions 1 à 4 page 28.",
    dueDate: daysFromNow(5),
    attachments: [],
    academicYear: "2025-2026",
    createdAt: daysAgo(1),
    pushedAt: daysAgo(1),
    acknowledgedCount: 18,
  },
  {
    id: "hw-003",
    classId: "cls-002",
    subjectId: "sub-003",
    subjectName: "Mathématiques",
    teacherId: "per-002",
    teacherName: "M. Sofiane Larbi",
    title: "Problèmes d'addition",
    description: "Résoudre les 3 problèmes de la fiche distribuée en classe.",
    dueDate: daysAgo(1), // past-due homework for the history tab
    attachments: [],
    academicYear: "2025-2026",
    createdAt: daysAgo(7),
    pushedAt: daysAgo(7),
    acknowledgedCount: 20,
  },
  {
    id: "hw-004",
    classId: "cls-003",
    subjectId: "sub-005",
    subjectName: "Sciences",
    teacherId: "per-003",
    teacherName: "Mme Nadia Hamidi",
    title: "Rapport de TP — photosynthèse",
    description: "Rédiger un rapport de 2 pages sur la manipulation de la semaine dernière.",
    dueDate: daysFromNow(7),
    attachments: [],
    academicYear: "2025-2026",
    createdAt: daysAgo(3),
    pushedAt: daysAgo(3),
    acknowledgedCount: 25,
  },
];

// ---------------------------------------------------------------------------
// Relevé entries (teacher activity ledger) — last 7 days for per-001
// ---------------------------------------------------------------------------

import type { ReleveEntry } from "../../domain/model/personnel";

export const seedReleve: ReleveEntry[] = [
  {
    id: "rel-001",
    personnelId: "per-001",
    personnelName: "Mme Aïcha Bouhenni",
    date: dateForDaysAgo(1),
    hoursIn: 8,
    hoursOut: 14,
    activity: "course",
    classId: "cls-001",
    subjectId: "sub-003",
    recordedAt: daysAgo(1),
  },
  {
    id: "rel-002",
    personnelId: "per-001",
    personnelName: "Mme Aïcha Bouhenni",
    date: dateForDaysAgo(2),
    hoursIn: 8,
    hoursOut: 12,
    activity: "correction",
    classId: "cls-001",
    subjectId: "sub-003",
    recordedAt: daysAgo(2),
  },
  {
    id: "rel-003",
    personnelId: "per-001",
    personnelName: "Mme Aïcha Bouhenni",
    date: dateForDaysAgo(3),
    hoursIn: 9,
    hoursOut: 11,
    activity: "meeting",
    classId: null,
    subjectId: null,
    recordedAt: daysAgo(3),
  },
  {
    id: "rel-004",
    personnelId: "per-001",
    personnelName: "Mme Aïcha Bouhenni",
    date: dateForDaysAgo(4),
    hoursIn: 8,
    hoursOut: 13,
    activity: "course",
    classId: "cls-001",
    subjectId: "sub-002",
    recordedAt: daysAgo(4),
  },
  {
    id: "rel-005",
    personnelId: "per-001",
    personnelName: "Mme Aïcha Bouhenni",
    date: dateForDaysAgo(5),
    hoursIn: 10,
    hoursOut: 12,
    activity: "supervision",
    classId: null,
    subjectId: null,
    recordedAt: daysAgo(5),
  },
  // per-002 entries
  {
    id: "rel-006",
    personnelId: "per-002",
    personnelName: "M. Sofiane Larbi",
    date: dateForDaysAgo(1),
    hoursIn: 8,
    hoursOut: 13,
    activity: "course",
    classId: "cls-002",
    subjectId: "sub-003",
    recordedAt: daysAgo(1),
  },
  {
    id: "rel-007",
    personnelId: "per-002",
    personnelName: "M. Sofiane Larbi",
    date: dateForDaysAgo(2),
    hoursIn: 8,
    hoursOut: 11,
    activity: "course",
    classId: "cls-002",
    subjectId: "sub-001",
    recordedAt: daysAgo(2),
  },
  // per-003 entries
  {
    id: "rel-008",
    personnelId: "per-003",
    personnelName: "Mme Nadia Hamidi",
    date: dateForDaysAgo(1),
    hoursIn: 9,
    hoursOut: 15,
    activity: "course",
    classId: "cls-003",
    subjectId: "sub-005",
    recordedAt: daysAgo(1),
  },
  {
    id: "rel-009",
    personnelId: "per-003",
    personnelName: "Mme Nadia Hamidi",
    date: dateForDaysAgo(3),
    hoursIn: 9,
    hoursOut: 12,
    activity: "correction",
    classId: "cls-003",
    subjectId: "sub-005",
    recordedAt: daysAgo(3),
  },
];
