/**
 * Student fixture factory — parent-first invariant preserved.
 */
import type { Student, AcademicLevel, GradeLevel } from "../../../domain/model/student";
import { gradeLevelFromLevelYear } from "../../../domain/model/student";
import type { Parent } from "../../../domain/model/parent";
import { makeRng, pad, type Rng } from "./rng";

const FIRST_NAMES_M = ["Yacine", "Mohamed", "Bilal", "Adam", "Omar", "Anis", "Sami", "Reda", "Yasmine", "Rayan"];
const FIRST_NAMES_F = ["Sara", "Lina", "Maya", "Inès", "Nour", "Rania", "Aya", "Lina", "Sabrina", "Manel"];

interface GradeBucket {
  level: AcademicLevel;
  year: number;
  gradeLevel: GradeLevel;
}

const ALL_GRADE_BUCKETS: GradeBucket[] = [
  { level: "primaire", year: 1, gradeLevel: "1ap" },
  { level: "primaire", year: 2, gradeLevel: "2ap" },
  { level: "primaire", year: 3, gradeLevel: "3ap" },
  { level: "primaire", year: 4, gradeLevel: "4ap" },
  { level: "primaire", year: 5, gradeLevel: "5ap" },
  { level: "cem", year: 1, gradeLevel: "1am" },
  { level: "cem", year: 2, gradeLevel: "2am" },
  { level: "cem", year: 3, gradeLevel: "3am" },
  { level: "cem", year: 4, gradeLevel: "4am" },
  { level: "lycee", year: 1, gradeLevel: "1ere_annee" },
  { level: "lycee", year: 2, gradeLevel: "2eme_annee" },
  { level: "lycee", year: 3, gradeLevel: "3eme_annee" },
];

export interface StudentFixtureOptions {
  tenantId: string;
  parents: Parent[];
  countPerParent?: number;
  classIds?: string[];
  seed?: number;
}

export function buildStudent(rng: Rng, idx: number, parent: Parent, opts: StudentFixtureOptions): Student {
  const gender = rng.maybe(0.5) ? "male" : "female";
  const first = gender === "male" ? rng.pick(FIRST_NAMES_M) : rng.pick(FIRST_NAMES_F);
  const last = parent.lastName;
  const bucket = rng.pick(ALL_GRADE_BUCKETS);
  const birthYear = new Date().getFullYear() - (4 + bucket.year + (bucket.level === "lycee" ? 9 : bucket.level === "cem" ? 5 : 0));
  const birthMonth = rng.int(1, 13);
  const birthDay = rng.int(1, 29);
  const now = new Date("2025-09-15T10:00:00Z").toISOString();
  const classId = opts.classIds && opts.classIds.length > 0 ? rng.pick(opts.classIds) : null;
  return {
    id: `stu-${pad(idx + 1, 3)}`,
    tenantId: opts.tenantId,
    code: `ELV-2025-${pad(idx + 1, 6)}`,
    parentId: parent.id,
    firstName: first,
    lastName: last,
    displayName: null,
    gender,
    birthDate: `${birthYear}-${pad(birthMonth, 2)}-${pad(birthDay, 2)}`,
    enrollmentDate: now,
    level: bucket.level,
    gradeYear: bucket.year,
    gradeLevel: bucket.gradeLevel,
    classId,
    photoUrl: null,
    medicalNotes: rng.maybe(0.15) ? "Asthme léger" : null,
    transportTier: bucket.level === "primaire" ? "t1" : null,
    status: "active",
    paymentPlan: "tranches",
    createdAt: now,
    updatedAt: now,
  };
}

export function buildStudents(opts: StudentFixtureOptions): Student[] {
  const rng = makeRng(opts.seed ?? 99);
  const perParent = opts.countPerParent ?? 2;
  const out: Student[] = [];
  let idx = 0;
  for (const parent of opts.parents) {
    const n = rng.maybe(0.3) ? perParent + 1 : perParent;
    for (let i = 0; i < n; i++) {
      out.push(buildStudent(rng, idx++, parent, opts));
    }
  }
  return out;
}

export function buildOneStudent(parent: Parent, tenantId: string, idx = 0): Student {
  const rng = makeRng(1000 + idx);
  return buildStudent(rng, idx, parent, { tenantId, parents: [parent] });
}
