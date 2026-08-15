/**
 * Academic fixture factory — classes, subjects, class-subjects, homework.
 */
import type {
  AcademicClass, Subject, ClassSubject, Homework, Assessment, AttendanceRecord, AttendanceStatus,
} from "../../../domain/model/academic";
import type { AcademicCycle } from "../../../domain/model/payment";
import { makeRng, pad, type Rng } from "./rng";

const NOW = new Date("2025-09-15T10:00:00Z");
const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => iso(new Date(NOW.getTime() - n * 86_400_000));

interface SubjectSpec {
  code: string;
  name: string;
  nameAr: string | null;
  level: "primaire" | "cem" | "lycee";
  coefficient: number;
  weeklyHours: number;
}

const SUBJECT_SPECS: SubjectSpec[] = [
  { code: "MATH", name: "Mathématiques", nameAr: "رياضيات", level: "primaire", coefficient: 4, weeklyHours: 6 },
  { code: "FR", name: "Français", nameAr: "فرنسية", level: "primaire", coefficient: 4, weeklyHours: 5 },
  { code: "AR", name: "Arabe", nameAr: "عربية", level: "primaire", coefficient: 3, weeklyHours: 5 },
  { code: "MATH_CEM", name: "Mathématiques", nameAr: "رياضيات", level: "cem", coefficient: 4, weeklyHours: 4 },
  { code: "PC", name: "Sciences Physiques", nameAr: "علوم فيزيائية", level: "cem", coefficient: 3, weeklyHours: 4 },
  { code: "SVT", name: "Sciences Naturelles", nameAr: "علوم الطبيعة", level: "cem", coefficient: 2, weeklyHours: 3 },
  { code: "HIST", name: "Histoire-Géo", nameAr: "تاريخ وجغرافيا", level: "cem", coefficient: 2, weeklyHours: 2 },
  { code: "EPS", name: "EPS", nameAr: "تربية بدنية", level: "primaire", coefficient: 1, weeklyHours: 2 },
  { code: "MATH_LYC", name: "Mathématiques", nameAr: "رياضيات", level: "lycee", coefficient: 5, weeklyHours: 5 },
  { code: "PHY", name: "Physique", nameAr: "فيزياء", level: "lycee", coefficient: 4, weeklyHours: 4 },
];

const SECTIONS = ["Section A", "Section B"];

export interface AcademicFixtureOptions {
  tenantId: string;
  academicYearId: string;
  academicYearCode: string;
  teacherPersonnelIds?: { id: string; name: string }[];
  seed?: number;
}

export function buildAcademic(opts: AcademicFixtureOptions): {
  classes: AcademicClass[];
  subjects: Subject[];
  classSubjects: ClassSubject[];
  homework: Homework[];
} {
  const rng = makeRng(opts.seed ?? 333);
  const classSpecs = [
    { level: "primaire" as const, year: 4, gradeCode: "4ap" as const },
    { level: "primaire" as const, year: 1, gradeCode: "1ap" as const },
    { level: "cem" as const, year: 2, gradeCode: "2am" as const },
    { level: "cem" as const, year: 4, gradeCode: "4am" as const },
    { level: "lycee" as const, year: 1, gradeCode: "1ere_annee" as const },
    { level: "lycee" as const, year: 2, gradeCode: "2eme_annee" as const },
  ];

  const classes: AcademicClass[] = classSpecs.map((spec, i) => {
    const section = SECTIONS[i % SECTIONS.length];
    return {
      id: `cls-${pad(i + 1, 3)}`, tenantId: opts.tenantId,
      academicYearId: opts.academicYearId, academicLevelId: `lvl-${spec.level}`,
      code: `CLS-${spec.gradeCode.toUpperCase()}-${String.fromCharCode(65 + (i % 2))}`,
      name: `${spec.year}ème ${spec.level === "primaire" ? "AP" : spec.level === "cem" ? "CEM" : "Année"} - ${section}`,
      gradeCode: spec.gradeCode, level: spec.level, gradeYear: spec.year, section,
      room: `Salle ${100 + i}`, capacity: 30, enrolledCount: 0,
      homeroomTeacherId: opts.teacherPersonnelIds?.[i % (opts.teacherPersonnelIds.length || 1)]?.id ?? null,
      homeroomTeacherName: opts.teacherPersonnelIds?.[i % (opts.teacherPersonnelIds.length || 1)]?.name ?? null,
      notes: null, academicYear: opts.academicYearCode, isActive: true,
    };
  });

  const subjects: Subject[] = SUBJECT_SPECS.map((spec, i) => {
    const teacher = opts.teacherPersonnelIds?.[i % (opts.teacherPersonnelIds.length || 1)];
    return {
      id: `sub-${pad(i + 1, 3)}`, tenantId: opts.tenantId, code: spec.code,
      name: spec.name, nameAr: spec.nameAr,
      cycle: spec.level as AcademicCycle, level: spec.level,
      coefficient: spec.coefficient, passingGrade: 10, isExtracurricular: false, isActive: true,
      teacherId: teacher?.id ?? null, teacherName: teacher?.name ?? null,
      academicYearId: opts.academicYearId, academicYearCode: opts.academicYearCode,
    };
  });

  const classSubjects: ClassSubject[] = [];
  classes.forEach((cls, ci) => {
    const matching = subjects.filter((s) => s.level === cls.level).slice(0, 4);
    matching.forEach((subj, si) => {
      const teacher = opts.teacherPersonnelIds?.[(ci + si) % (opts.teacherPersonnelIds.length || 1)];
      classSubjects.push({
        id: `csj-${pad(classSubjects.length + 1, 3)}`, classId: cls.id, subjectId: subj.id,
        teacherId: teacher?.id ?? null, teacherName: teacher?.name ?? null,
        weeklyHours: subj.coefficient + 1, coefficient: subj.coefficient,
      });
    });
  });

  const homework: Homework[] = classSubjects.slice(0, 6).map((cs, i) => ({
    id: `hw-${pad(i + 1, 3)}`, classId: cs.classId, subjectId: cs.subjectId,
    subjectName: subjects.find((s) => s.id === cs.subjectId)?.name ?? "—",
    teacherId: cs.teacherId ?? "per-001", teacherName: cs.teacherName ?? "Enseignant",
    title: `Devoir ${i + 1}`, description: `Exercices pages ${10 + i}-${15 + i}`,
    dueDate: iso(new Date(NOW.getTime() + (i + 1) * 7 * 86_400_000)),
    attachments: [], academicYear: opts.academicYearCode,
    createdAt: daysAgo(i + 1), pushedAt: daysAgo(i), acknowledgedCount: 0,
  }));

  return { classes, subjects, classSubjects, homework };
}

export function buildAttendance(
  classIds: string[],
  studentIdsByClass: Record<string, string[]>,
  seed = 555,
): AttendanceRecord[] {
  const rng = makeRng(seed);
  const out: AttendanceRecord[] = [];
  let idx = 0;
  const statuses: AttendanceStatus[] = ["present", "present", "present", "absent_excused", "late"];
  for (const classId of classIds) {
    const students = studentIdsByClass[classId] ?? [];
    for (let day = 0; day < 5; day++) {
      const date = iso(new Date(NOW.getTime() - day * 86_400_000)).slice(0, 10);
      for (const studentId of students.slice(0, 5)) {
        out.push({
          id: `att-${pad(++idx, 4)}`, studentId, classId, date,
          session: "morning", status: rng.pick(statuses), note: null,
          recordedBy: "usr-tea-001",
          recordedAt: iso(new Date(NOW.getTime() - day * 86_400_000)),
          syncedAt: null,
        });
      }
    }
  }
  return out;
}
