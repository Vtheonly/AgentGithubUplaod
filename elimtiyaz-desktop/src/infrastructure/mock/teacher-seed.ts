/**
 * Teacher seed data — normalized Account → Person → Teacher → Subject.
 *
 * Links existing Personnel records (per-001 through per-006, all
 * staffCategory="teacher") to Teacher entities scoped per academic year.
 *
 * Also seeds TeacherSubjectAssignment records (teacher ↔ subject links)
 * and a few TimetableEntry records (Emploi du Temps).
 *
 * Academic Year scoping: all teacher records are scoped to ay-2025-2026
 * (the current year). Historical years would have their own Teacher records.
 */
import { SEED_NOW, TENANT_ID } from "./seed-data";
import type {
  Teacher,
  TeacherSubjectAssignment,
  TimetableEntry,
} from "../../domain/model/teacher";

const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => iso(new Date(SEED_NOW.getTime() - n * 86_400_000));

// ============================================================================
// Teachers — one per personnel, scoped to ay-2025-2026
// ============================================================================

export const seedTeachers: Teacher[] = [
  {
    id: "tch-001",
    tenantId: TENANT_ID,
    personnelId: "per-001",
    firstName: "Aïcha",
    lastName: "Bouhenni",
    code: "ENS-2026-001",
    academicYearId: "ay-2025-2026",
    academicYearCode: "2025-2026",
    status: "active",
    maxWeeklyHours: 24,
    qualifiedSubjectIds: ["sub-001", "sub-002", "sub-003"],
    createdAt: daysAgo(30),
    updatedAt: daysAgo(7),
  },
  {
    id: "tch-002",
    tenantId: TENANT_ID,
    personnelId: "per-002",
    firstName: "Sofiane",
    lastName: "Larbi",
    code: "ENS-2026-002",
    academicYearId: "ay-2025-2026",
    academicYearCode: "2025-2026",
    status: "active",
    maxWeeklyHours: 22,
    qualifiedSubjectIds: ["sub-001", "sub-003", "sub-011"],
    createdAt: daysAgo(30),
    updatedAt: daysAgo(7),
  },
  {
    id: "tch-003",
    tenantId: TENANT_ID,
    personnelId: "per-003",
    firstName: "Nadia",
    lastName: "Hamidi",
    code: "ENS-2026-003",
    academicYearId: "ay-2025-2026",
    academicYearCode: "2025-2026",
    status: "active",
    maxWeeklyHours: 26,
    qualifiedSubjectIds: ["sub-004", "sub-005", "sub-006", "sub-010"],
    createdAt: daysAgo(30),
    updatedAt: daysAgo(5),
  },
  {
    id: "tch-004",
    tenantId: TENANT_ID,
    personnelId: "per-004",
    firstName: "Karim",
    lastName: "Zidane",
    code: "ENS-2026-004",
    academicYearId: "ay-2025-2026",
    academicYearCode: "2025-2026",
    status: "active",
    maxWeeklyHours: 20,
    qualifiedSubjectIds: ["sub-004", "sub-005", "sub-012"],
    createdAt: daysAgo(30),
    updatedAt: daysAgo(3),
  },
  {
    id: "tch-005",
    tenantId: TENANT_ID,
    personnelId: "per-005",
    firstName: "Samira",
    lastName: "Belmiloud",
    code: "ENS-2026-005",
    academicYearId: "ay-2025-2026",
    academicYearCode: "2025-2026",
    status: "active",
    maxWeeklyHours: 24,
    qualifiedSubjectIds: ["sub-004", "sub-005", "sub-007"],
    createdAt: daysAgo(30),
    updatedAt: daysAgo(3),
  },
  {
    id: "tch-006",
    tenantId: TENANT_ID,
    personnelId: "per-006",
    firstName: "Hocine",
    lastName: "Rebai",
    code: "ENS-2026-006",
    academicYearId: "ay-2025-2026",
    academicYearCode: "2025-2026",
    status: "on_leave",
    maxWeeklyHours: 18,
    qualifiedSubjectIds: ["sub-006", "sub-007", "sub-008"],
    createdAt: daysAgo(30),
    updatedAt: daysAgo(10),
  },
];

// ============================================================================
// Teacher ↔ Subject assignments (primary + secondary)
// ============================================================================

export const seedTeacherSubjectAssignments: TeacherSubjectAssignment[] = [
  // Math (sub-003) — primary: tch-001 (Aïcha), secondary: tch-002 (Sofiane)
  { id: "tsa-001", tenantId: TENANT_ID, teacherId: "tch-001", subjectId: "sub-003", academicYearId: "ay-2025-2026", isPrimary: true, createdAt: daysAgo(25) },
  { id: "tsa-002", tenantId: TENANT_ID, teacherId: "tch-002", subjectId: "sub-003", academicYearId: "ay-2025-2026", isPrimary: false, createdAt: daysAgo(25) },
  // Arabe (sub-001) — primary: tch-001, secondary: tch-002
  { id: "tsa-003", tenantId: TENANT_ID, teacherId: "tch-001", subjectId: "sub-001", academicYearId: "ay-2025-2026", isPrimary: true, createdAt: daysAgo(25) },
  { id: "tsa-004", tenantId: TENANT_ID, teacherId: "tch-002", subjectId: "sub-001", academicYearId: "ay-2025-2026", isPrimary: false, createdAt: daysAgo(25) },
  // Français (sub-002) — primary: tch-001
  { id: "tsa-005", tenantId: TENANT_ID, teacherId: "tch-001", subjectId: "sub-002", academicYearId: "ay-2025-2026", isPrimary: true, createdAt: daysAgo(25) },
  // Anglais (sub-004) — primary: tch-003, secondary: tch-004, tch-005
  { id: "tsa-006", tenantId: TENANT_ID, teacherId: "tch-003", subjectId: "sub-004", academicYearId: "ay-2025-2026", isPrimary: true, createdAt: daysAgo(25) },
  { id: "tsa-007", tenantId: TENANT_ID, teacherId: "tch-004", subjectId: "sub-004", academicYearId: "ay-2025-2026", isPrimary: false, createdAt: daysAgo(25) },
  { id: "tsa-008", tenantId: TENANT_ID, teacherId: "tch-005", subjectId: "sub-004", academicYearId: "ay-2025-2026", isPrimary: false, createdAt: daysAgo(25) },
  // Sciences (sub-005) — primary: tch-003, secondary: tch-004, tch-005
  { id: "tsa-009", tenantId: TENANT_ID, teacherId: "tch-003", subjectId: "sub-005", academicYearId: "ay-2025-2026", isPrimary: true, createdAt: daysAgo(25) },
  { id: "tsa-010", tenantId: TENANT_ID, teacherId: "tch-004", subjectId: "sub-005", academicYearId: "ay-2025-2026", isPrimary: false, createdAt: daysAgo(25) },
  { id: "tsa-011", tenantId: TENANT_ID, teacherId: "tch-005", subjectId: "sub-005", academicYearId: "ay-2025-2026", isPrimary: false, createdAt: daysAgo(25) },
  // Histoire-Géo (sub-006) — primary: tch-003, secondary: tch-006
  { id: "tsa-012", tenantId: TENANT_ID, teacherId: "tch-003", subjectId: "sub-006", academicYearId: "ay-2025-2026", isPrimary: true, createdAt: daysAgo(25) },
  { id: "tsa-013", tenantId: TENANT_ID, teacherId: "tch-006", subjectId: "sub-006", academicYearId: "ay-2025-2026", isPrimary: false, createdAt: daysAgo(25) },
  // Physique (sub-007) — primary: tch-005, secondary: tch-006
  { id: "tsa-014", tenantId: TENANT_ID, teacherId: "tch-005", subjectId: "sub-007", academicYearId: "ay-2025-2026", isPrimary: true, createdAt: daysAgo(25) },
  { id: "tsa-015", tenantId: TENANT_ID, teacherId: "tch-006", subjectId: "sub-007", academicYearId: "ay-2025-2026", isPrimary: false, createdAt: daysAgo(25) },
  // Philosophie (sub-008) — primary: tch-006
  { id: "tsa-016", tenantId: TENANT_ID, teacherId: "tch-006", subjectId: "sub-008", academicYearId: "ay-2025-2026", isPrimary: true, createdAt: daysAgo(25) },
  // Informatique (sub-011) — primary: tch-002
  { id: "tsa-017", tenantId: TENANT_ID, teacherId: "tch-002", subjectId: "sub-011", academicYearId: "ay-2025-2026", isPrimary: true, createdAt: daysAgo(25) },
  // EPS (sub-010) — primary: tch-003
  { id: "tsa-018", tenantId: TENANT_ID, teacherId: "tch-003", subjectId: "sub-010", academicYearId: "ay-2025-2026", isPrimary: true, createdAt: daysAgo(25) },
  // Arts (sub-012) — primary: tch-004
  { id: "tsa-019", tenantId: TENANT_ID, teacherId: "tch-004", subjectId: "sub-012", academicYearId: "ay-2025-2026", isPrimary: true, createdAt: daysAgo(25) },
];

// ============================================================================
// Timetable entries (Emploi du Temps) — sample for cls-001
// ============================================================================

export const seedTimetableEntries: TimetableEntry[] = [
  // cls-001 Monday
  { id: "tt-001", tenantId: TENANT_ID, academicYearId: "ay-2025-2026", classId: "cls-001", teacherId: "tch-001", subjectId: "sub-003", day: "monday", startMinutes: 480, endMinutes: 540, room: "B12", notes: null, createdAt: daysAgo(20), updatedAt: daysAgo(20) },
  { id: "tt-002", tenantId: TENANT_ID, academicYearId: "ay-2025-2026", classId: "cls-001", teacherId: "tch-001", subjectId: "sub-002", day: "monday", startMinutes: 540, endMinutes: 600, room: "B12", notes: null, createdAt: daysAgo(20), updatedAt: daysAgo(20) },
  { id: "tt-003", tenantId: TENANT_ID, academicYearId: "ay-2025-2026", classId: "cls-001", teacherId: "tch-001", subjectId: "sub-001", day: "monday", startMinutes: 600, endMinutes: 660, room: "B12", notes: null, createdAt: daysAgo(20), updatedAt: daysAgo(20) },
  // cls-001 Tuesday
  { id: "tt-004", tenantId: TENANT_ID, academicYearId: "ay-2025-2026", classId: "cls-001", teacherId: "tch-001", subjectId: "sub-003", day: "tuesday", startMinutes: 480, endMinutes: 540, room: "B12", notes: null, createdAt: daysAgo(20), updatedAt: daysAgo(20) },
  { id: "tt-005", tenantId: TENANT_ID, academicYearId: "ay-2025-2026", classId: "cls-001", teacherId: "tch-002", subjectId: "sub-011", day: "tuesday", startMinutes: 540, endMinutes: 600, room: "Lab-1", notes: "Salle informatique", createdAt: daysAgo(20), updatedAt: daysAgo(20) },
  // cls-001 Wednesday
  { id: "tt-006", tenantId: TENANT_ID, academicYearId: "ay-2025-2026", classId: "cls-001", teacherId: "tch-001", subjectId: "sub-002", day: "wednesday", startMinutes: 480, endMinutes: 540, room: "B12", notes: null, createdAt: daysAgo(20), updatedAt: daysAgo(20) },
  { id: "tt-007", tenantId: TENANT_ID, academicYearId: "ay-2025-2026", classId: "cls-001", teacherId: "tch-001", subjectId: "sub-001", day: "wednesday", startMinutes: 540, endMinutes: 600, room: "B12", notes: null, createdAt: daysAgo(20), updatedAt: daysAgo(20) },
  // cls-001 Thursday
  { id: "tt-008", tenantId: TENANT_ID, academicYearId: "ay-2025-2026", classId: "cls-001", teacherId: "tch-001", subjectId: "sub-003", day: "thursday", startMinutes: 480, endMinutes: 540, room: "B12", notes: null, createdAt: daysAgo(20), updatedAt: daysAgo(20) },
  // cls-001 Friday
  { id: "tt-009", tenantId: TENANT_ID, academicYearId: "ay-2025-2026", classId: "cls-001", teacherId: "tch-001", subjectId: "sub-002", day: "friday", startMinutes: 480, endMinutes: 540, room: "B12", notes: null, createdAt: daysAgo(20), updatedAt: daysAgo(20) },
  // cls-002 Tuesday (different class, same teacher — no conflict, different day/time)
  { id: "tt-010", tenantId: TENANT_ID, academicYearId: "ay-2025-2026", classId: "cls-002", teacherId: "tch-002", subjectId: "sub-003", day: "monday", startMinutes: 480, endMinutes: 540, room: "A05", notes: null, createdAt: daysAgo(20), updatedAt: daysAgo(20) },
  { id: "tt-011", tenantId: TENANT_ID, academicYearId: "ay-2025-2026", classId: "cls-002", teacherId: "tch-002", subjectId: "sub-001", day: "monday", startMinutes: 540, endMinutes: 600, room: "A05", notes: null, createdAt: daysAgo(20), updatedAt: daysAgo(20) },
];
