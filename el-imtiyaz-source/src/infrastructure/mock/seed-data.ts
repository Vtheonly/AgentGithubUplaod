/**
 * Seed data for the mock repository implementation.
 *
 * Realistic-but-fictional Algerian private school data:
 *   - 8 parents
 *   - 15 students
 *   - 6 classes (2 per cycle)
 *   - 12 subjects (mix of Scolarité + extracurricular)
 *   - 30 payments across the last 12 months
 *   - 5 expenses (mixed statuses)
 *   - 10 personnel
 *   - 15 audit entries
 *
 * IDs are deterministic so cross-references are stable. Currency = DZD.
 *
 * Iteration 5: ALL financial amounts are derived from the PricingConfig
 * (the single source of truth). The `seedInstallments` array is now
 * derived from the ledger via `ledger-seed.ts` (see `installmentsFromLedger()`).
 *
 * Iteration 6:
 *   - Each parent now carries an explicit `transportDestination` (canonical)
 *     alongside the legacy `cityTier`. New code prefers `transportDestination`.
 *   - Each student now carries an explicit `gradeLevel` (canonical) alongside
 *     the legacy `level`+`gradeYear` pair.
 *   - Tuition is now keyed by `GradeLevel` (14 grades) and payments derive
 *     amounts from the granular per-grade pricing.
 *
 * No hardcoded DZD amounts in seed data except as PricingConfig-derived
 * values (in `pricing-seed.ts`) or as illustrative expense amounts.
 */

import {
  tuitionForLevel,
  tuitionForGradeLevel,
  tuitionTranches,
  tuitionTranchesForGrade,
} from "../../domain/model/pricing";
import {
  gradeLevelFromLevelYear,
  type GradeLevel,
} from "../../domain/model/student";
import {
  cityTierToDestination,
  type TransportDestination,
} from "../../domain/model/parent";
import { defaultPricingConfig } from "./pricing-seed";

const NOW = new Date("2025-09-15T10:00:00Z");
const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => iso(new Date(NOW.getTime() - n * 86_400_000));
const daysFromNow = (n: number) => iso(new Date(NOW.getTime() + n * 86_400_000));

export const SEED_NOW = NOW;

export const TENANT_ID = "tenant-el-imtiyaz-oran-001";
export const ACADEMIC_YEAR = "2025-2026";

export const seedParents = [
  { id: "par-001", code: "PAR-2025-A4F9", firstName: "Karim", lastName: "Benali", gender: "male" as const, phone: "+213 555 12 34 56", whatsapp: "+213 555 12 34 56", email: "k.benali@example.dz", occupation: "Ingénieur", address: "12 rue des Frères Bouadou, Oran", cityTier: "t1" as const, preferredLanguage: "fr" as const },
  { id: "par-002", code: "PAR-2025-B7H2", firstName: "Amina", lastName: "Cherif", gender: "female" as const, phone: "+213 661 23 45 67", whatsapp: null, email: "a.cherif@example.dz", occupation: "Médecin", address: "8 boulevard de la Soummam, Oran", cityTier: "t1" as const, preferredLanguage: "fr" as const },
  { id: "par-003", code: "PAR-2025-C3K9", firstName: "Yacine", lastName: "Mansouri", gender: "male" as const, phone: "+213 770 34 56 78", whatsapp: "+213 770 34 56 78", email: null, occupation: "Commerçant", address: "45 cité Es-Salem, Bir El Djir", cityTier: "t2" as const, preferredLanguage: "ar" as const },
  { id: "par-004", code: "PAR-2025-D8L5", firstName: "Fatima", lastName: "Belkacem", gender: "female" as const, phone: "+213 559 45 67 89", whatsapp: "+213 559 45 67 89", email: "f.belkacem@example.dz", occupation: "Enseignante", address: "3 rue Larbi Ben M'hidi, Oran", cityTier: "t1" as const, preferredLanguage: "fr" as const },
  { id: "par-005", code: "PAR-2025-E2M7", firstName: "Sofiane", lastName: "Khelifi", gender: "male" as const, phone: "+213 661 56 78 90", whatsapp: null, email: null, occupation: "Chauffeur", address: "17 village Aïn El Türck", cityTier: "t3" as const, preferredLanguage: "ar" as const },
  { id: "par-006", code: "PAR-2025-F6N4", firstName: "Nadia", lastName: "Bouzid", gender: "female" as const, phone: "+213 555 67 89 01", whatsapp: "+213 555 67 89 01", email: "n.bouzid@example.dz", occupation: "Pharmacienne", address: "25 rue Mostaganem, Oran", cityTier: "t1" as const, preferredLanguage: "fr" as const },
  { id: "par-007", code: "PAR-2025-G9P1", firstName: "Rachid", lastName: "Saïdi", gender: "male" as const, phone: "+213 770 78 90 12", whatsapp: "+213 770 78 90 12", email: null, occupation: "Avocat", address: "9 rue des Frères Bencheman, Oran", cityTier: "t2" as const, preferredLanguage: "fr" as const },
  { id: "par-008", code: "PAR-2025-H4Q8", firstName: "Leila", lastName: "Touati", gender: "female" as const, phone: "+213 661 89 01 23", whatsapp: null, email: "l.touati@example.dz", occupation: "Architecte", address: "31 boulevard Millénium, Es-Sénia", cityTier: "t2" as const, preferredLanguage: "fr" as const },
].map((p) => ({
  ...p,
  tenantId: TENANT_ID,
  transportDestination: cityTierToDestination(p.cityTier) as TransportDestination,
  avatarUrl: null,
  createdAt: daysAgo(180),
  updatedAt: daysAgo(7),
}));

// Helper: derive gradeLevel from level + gradeYear (used for seed students
// whose data was authored before the GradeLevel type was introduced).
function gradeLevelFor(level: "primaire" | "cem" | "lycee", gradeYear: number): GradeLevel {
  return gradeLevelFromLevelYear(level, gradeYear);
}

export const seedStudents = [
  { id: "stu-001", code: "ELV-2025-000001", parentId: "par-001", firstName: "Yacine", lastName: "Benali", gender: "male" as const, birthDate: "2014-03-12", level: "primaire" as const, gradeYear: 3, classId: "cls-001", medicalNotes: null },
  { id: "stu-002", code: "ELV-2025-000002", parentId: "par-001", firstName: "Sara", lastName: "Benali", gender: "female" as const, birthDate: "2016-07-22", level: "primaire" as const, gradeYear: 1, classId: "cls-002", medicalNotes: "Asthme léger" },
  { id: "stu-003", code: "ELV-2025-000003", parentId: "par-002", firstName: "Mohamed", lastName: "Cherif", gender: "male" as const, birthDate: "2011-09-05", level: "cem" as const, gradeYear: 2, classId: "cls-003", medicalNotes: null },
  { id: "stu-004", code: "ELV-2025-000004", parentId: "par-002", firstName: "Lina", lastName: "Cherif", gender: "female" as const, birthDate: "2009-11-18", level: "cem" as const, gradeYear: 4, classId: "cls-004", medicalNotes: null },
  { id: "stu-005", code: "ELV-2025-000005", parentId: "par-003", firstName: "Bilal", lastName: "Mansouri", gender: "male" as const, birthDate: "2008-02-28", level: "lycee" as const, gradeYear: 1, classId: "cls-005", medicalNotes: null },
  { id: "stu-006", code: "ELV-2025-000006", parentId: "par-003", firstName: "Maya", lastName: "Mansouri", gender: "female" as const, birthDate: "2013-06-14", level: "primaire" as const, gradeYear: 4, classId: "cls-001", medicalNotes: null },
  { id: "stu-007", code: "ELV-2025-000007", parentId: "par-004", firstName: "Adam", lastName: "Belkacem", gender: "male" as const, birthDate: "2010-08-03", level: "cem" as const, gradeYear: 3, classId: "cls-003", medicalNotes: "Allergie aux arachides" },
  { id: "stu-008", code: "ELV-2025-000008", parentId: "par-004", firstName: "Inès", lastName: "Belkacem", gender: "female" as const, birthDate: "2007-12-21", level: "lycee" as const, gradeYear: 2, classId: "cls-006", medicalNotes: null },
  { id: "stu-009", code: "ELV-2025-000009", parentId: "par-005", firstName: "Omar", lastName: "Khelifi", gender: "male" as const, birthDate: "2015-04-09", level: "primaire" as const, gradeYear: 2, classId: "cls-002", medicalNotes: null },
  { id: "stu-010", code: "ELV-2025-000010", parentId: "par-006", firstName: "Rania", lastName: "Bouzid", gender: "female" as const, birthDate: "2012-10-30", level: "cem" as const, gradeYear: 1, classId: "cls-004", medicalNotes: null },
  { id: "stu-011", code: "ELV-2025-000011", parentId: "par-006", firstName: "Anis", lastName: "Bouzid", gender: "male" as const, birthDate: "2009-03-17", level: "cem" as const, gradeYear: 4, classId: "cls-004", medicalNotes: null },
  { id: "stu-012", code: "ELV-2025-000012", parentId: "par-007", firstName: "Sami", lastName: "Saïdi", gender: "male" as const, birthDate: "2013-08-25", level: "primaire" as const, gradeYear: 4, classId: "cls-001", medicalNotes: null },
  { id: "stu-013", code: "ELV-2025-000013", parentId: "par-007", firstName: "Nour", lastName: "Saïdi", gender: "female" as const, birthDate: "2011-01-14", level: "cem" as const, gradeYear: 2, classId: "cls-003", medicalNotes: null },
  { id: "stu-014", code: "ELV-2025-000014", parentId: "par-008", firstName: "Yasmine", lastName: "Touati", gender: "female" as const, birthDate: "2008-06-19", level: "lycee" as const, gradeYear: 1, classId: "cls-005", medicalNotes: null },
  { id: "stu-015", code: "ELV-2025-000015", parentId: "par-008", firstName: "Reda", lastName: "Touati", gender: "male" as const, birthDate: "2016-11-02", level: "primaire" as const, gradeYear: 1, classId: "cls-002", medicalNotes: null },
].map((s) => ({
  ...s,
  tenantId: TENANT_ID,
  gradeLevel: gradeLevelFor(s.level, s.gradeYear),
  enrollmentDate: daysAgo(120),
  photoUrl: null,
  transportTier: s.level === "primaire" ? "t1" : null,
  status: "active" as const,
  createdAt: daysAgo(120),
  updatedAt: daysAgo(2),
}));

export const seedClasses = [
  { id: "cls-001", name: "4ème A", level: "primaire" as const, gradeYear: 4, homeroomTeacherId: "per-001", homeroomTeacherName: "Mme Aïcha Bouhenni", room: "B12", capacity: 30, enrolledCount: 28 },
  { id: "cls-002", name: "1ère B", level: "primaire" as const, gradeYear: 1, homeroomTeacherId: "per-002", homeroomTeacherName: "M. Sofiane Larbi", room: "A05", capacity: 25, enrolledCount: 22 },
  { id: "cls-003", name: "2ème CEM A", level: "cem" as const, gradeYear: 2, homeroomTeacherId: "per-003", homeroomTeacherName: "Mme Nadia Hamidi", room: "C08", capacity: 35, enrolledCount: 30 },
  { id: "cls-004", name: "4ème CEM B", level: "cem" as const, gradeYear: 4, homeroomTeacherId: "per-004", homeroomTeacherName: "M. Karim Zidane", room: "C14", capacity: 35, enrolledCount: 33 },
  { id: "cls-005", name: "1ère Lycée S", level: "lycee" as const, gradeYear: 1, homeroomTeacherId: "per-005", homeroomTeacherName: "Mme Samira Belmiloud", room: "D03", capacity: 30, enrolledCount: 27 },
  { id: "cls-006", name: "2ème Lycée L", level: "lycee" as const, gradeYear: 2, homeroomTeacherId: "per-006", homeroomTeacherName: "M. Hocine Rebai", room: "D07", capacity: 28, enrolledCount: 24 },
].map((c) => ({ ...c, tenantId: TENANT_ID, academicYear: ACADEMIC_YEAR }));

export const seedSubjects = [
  { id: "sub-001", name: "Arabe", nameAr: "العربية", code: "AR", level: "primaire" as const, coefficient: 3, isExtracurricular: false, passingGrade: 10 },
  { id: "sub-002", name: "Français", nameAr: "الفرنسية", code: "FR", level: "primaire" as const, coefficient: 3, isExtracurricular: false, passingGrade: 10 },
  { id: "sub-003", name: "Mathématiques", nameAr: "الرياضيات", code: "MATH", level: "primaire" as const, coefficient: 4, isExtracurricular: false, passingGrade: 10 },
  { id: "sub-004", name: "Anglais", nameAr: "الإنجليزية", code: "EN", level: "cem" as const, coefficient: 2, isExtracurricular: false, passingGrade: 10 },
  { id: "sub-005", name: "Sciences", nameAr: "العلوم", code: "SCI", level: "cem" as const, coefficient: 3, isExtracurricular: false, passingGrade: 10 },
  { id: "sub-006", name: "Histoire-Géographie", nameAr: "التاريخ والجغرافيا", code: "HG", level: "cem" as const, coefficient: 2, isExtracurricular: false, passingGrade: 10 },
  { id: "sub-007", name: "Physique", nameAr: "الفيزياء", code: "PHY", level: "lycee" as const, coefficient: 3, isExtracurricular: false, passingGrade: 10 },
  { id: "sub-008", name: "Philosophie", nameAr: "الفلسفة", code: "PHILO", level: "lycee" as const, coefficient: 2, isExtracurricular: false, passingGrade: 10 },
  { id: "sub-009", name: "Échecs", nameAr: "الشطرنج", code: "CHESS", level: "primaire" as const, coefficient: 1, isExtracurricular: true, passingGrade: 10 },
  { id: "sub-010", name: "Informatique", nameAr: "المعلوماتية", code: "IT", level: "cem" as const, coefficient: 1, isExtracurricular: true, passingGrade: 10 },
  { id: "sub-011", name: "Orthophonie", nameAr: "التخاطب", code: "SPEECH", level: "primaire" as const, coefficient: 1, isExtracurricular: true, passingGrade: 10 },
  { id: "sub-012", name: "Sport & Arts", nameAr: "الرياضة والفنون", code: "SPORT", level: "cem" as const, coefficient: 1, isExtracurricular: true, passingGrade: 10 },
].map((s) => ({ ...s, tenantId: TENANT_ID }));

const methods = ["cash", "check", "transfer"] as const;
const statuses = ["paid", "paid", "paid", "paid", "partial", "pending", "overdue"] as const;
const categories = ["tuition", "transport", "canteen", "extracurricular"] as const;

export const seedPayments = Array.from({ length: 30 }, (_, i) => {
  const parent = seedParents[i % seedParents.length];
  const student = seedStudents.find((s) => s.parentId === parent.id) ?? null;
  const d = new Date(NOW.getTime() - (i * 11) * 86_400_000);
  const method = methods[i % methods.length];
  const status = statuses[i % statuses.length];
  const category = categories[i % categories.length];
  // Use the same source IDs as the ledger so cross-checks pass.
  const installmentId = i % 3 === 0 && student ? `ins-${parent.id}-${student.id}-t${(i % 3) + 1}` : null;
  // Derive tuition amount from the granular grade-level 3-tranche schedule.
  // Iteration 6: prefers per-grade-level pricing; falls back to legacy if needed.
  const tuitionTrancheAmount = student
    ? tuitionTranchesForGrade(defaultPricingConfig, student.gradeLevel)[i % 3].amountDue
    : tuitionTranches(tuitionForLevel(defaultPricingConfig, "cem"))[i % 3].amountDue;
  return {
    id: `pay-${String(i + 1).padStart(3, "0")}`,
    tenantId: TENANT_ID,
    receiptNumber: `REC-2025-${String(i + 1).padStart(6, "0")}`,
    parentId: parent.id,
    studentId: student?.id ?? null,
    amount: category === "tuition"
      ? tuitionTrancheAmount
      : [8000, 3500, 5000, 6000, 4200][i % 5],
    method,
    status,
    category,
    installmentId,
    proofUrl: method !== "cash" ? "mock://proof/scan.jpg" : null,
    notes: method !== "cash" ? "Chèque en attente de compensation" : null,
    collectedBy: "usr-fin-001",
    collectedAt: iso(d),
    createdAt: iso(d),
    updatedAt: iso(d),
  };
});

/**
 * Installment records — view onto ledger charge entries.
 *
 * Iteration 5: installments are now derived from the ledger. The
 * `seedInstallments` array is kept as a backward-compat shim for code
 * that consumes `Installment` objects directly. The amounts come from
 * `defaultPricingConfig.tuitionByGradeLevel` (the single source of truth).
 *
 * Iteration 6: uses per-grade-level tuition (granular 3-tranche schedule)
 * instead of the legacy 3-way equal split.
 */
export const seedInstallments = seedParents.slice(0, 6).flatMap((parent, idx) => {
  const student = seedStudents.find((s) => s.parentId === parent.id);
  if (!student) return [];
  const tranches = tuitionTranchesForGrade(defaultPricingConfig, student.gradeLevel);
  return [1, 2, 3].map((t) => {
    const due = new Date(NOW.getTime() + (t - 2) * 30 * 86_400_000);
    const amountDue = tranches[t - 1].amountDue;
    const paid = t < 3 || (t === 3 && idx % 2 === 0);
    return {
      id: `ins-${parent.id}-${student.id}-t${t}`,
      parentId: parent.id,
      studentId: student.id,
      category: "tuition" as const,
      label: `Tranche ${t}`,
      amountDue,
      amountPaid: paid ? amountDue : t === 2 ? Math.round(amountDue / 2) : 0,
      dueDate: iso(due),
      paidDate: paid ? iso(due) : null,
      status: paid ? "paid" as const : t === 2 ? "partial" as const : "pending" as const,
    };
  });
});

export const seedExpenses = [
  { id: "exp-001", requestCode: "EXP-2025-001", title: "Réparation climatisation salle B12", description: "Fuite de gaz réfrigérant", amount: 28000, category: "maintenance" as const, payee: "Climat Oran Services", status: "settled" as const, submittedBy: "usr-sup-001", submittedAt: daysAgo(40), approvedBy: "usr-adm-001", approvedAt: daysAgo(38), approvalNote: "OK urgence pédagogique", disbursedBy: "usr-fin-001", disbursedAt: daysAgo(35), proofUrl: "mock://proof/exp-001.jpg", proofUploadedBy: "usr-sup-001", proofUploadedAt: daysAgo(30), anomalyScore: 0.1, anomalyNote: null },
  { id: "exp-002", requestCode: "EXP-2025-002", title: "Fournitures bureau trimestre 1", description: "Stylos, cahiers, papier A4", amount: 45000, category: "supplies" as const, payee: "Papeterie El Baraka", status: "disbursed" as const, submittedBy: "usr-sup-002", submittedAt: daysAgo(15), approvedBy: "usr-adm-001", approvedAt: daysAgo(13), approvalNote: "Conforme budget", disbursedBy: "usr-fin-001", disbursedAt: daysAgo(10), proofUrl: null, proofUploadedBy: null, proofUploadedAt: null, anomalyScore: null, anomalyNote: null },
  { id: "exp-003", requestCode: "EXP-2025-003", title: "Facture électricité septembre", description: "SONELGAZ — bâtiment principal", amount: 68000, category: "utilities" as const, payee: "SONELGAZ", status: "submitted" as const, submittedBy: "usr-sup-001", submittedAt: daysAgo(5), approvedBy: null, approvedAt: null, approvalNote: null, disbursedBy: null, disbursedAt: null, proofUrl: null, proofUploadedBy: null, proofUploadedAt: null, anomalyScore: 0.72, anomalyNote: "Anomalie: 3.2× moyenne mensuelle catégorie utilities" },
  { id: "exp-004", requestCode: "EXP-2025-004", title: "Organisation gala fin d'année", description: "Location salle + traiteur", amount: 180000, category: "event" as const, payee: "Salle des Fêtes Le Prestige", status: "submitted" as const, submittedBy: "usr-sup-002", submittedAt: daysAgo(2), approvedBy: null, approvedAt: null, approvalNote: null, disbursedBy: null, disbursedAt: null, proofUrl: null, proofUploadedBy: null, proofUploadedAt: null, anomalyScore: 0.45, anomalyNote: "Budget élevé — vérifier contre budget événementiel" },
  { id: "exp-005", requestCode: "EXP-2025-005", title: "Carburant bus scolaire octobre", description: "Plein diesel hebdomadaire × 4", amount: 32000, category: "transport" as const, payee: "Naftal", status: "rejected" as const, submittedBy: "usr-sup-001", submittedAt: daysAgo(8), approvedBy: "usr-adm-001", approvedAt: daysAgo(7), approvalNote: "Rejet: justificatif manquant, refaire la demande", disbursedBy: null, disbursedAt: null, proofUrl: null, proofUploadedBy: null, proofUploadedAt: null, anomalyScore: null, anomalyNote: null },
].map((e) => ({ ...e, tenantId: TENANT_ID }));

export const seedPersonnel = [
  { id: "per-001", firstName: "Aïcha", lastName: "Bouhenni", staffCategory: "teacher" as const, phone: "+213 555 11 22 33", email: "a.bouhenni@elimtiyaz.dz", hireDate: "2020-09-01", salary: 65000, weeklyHoursTarget: 30, weeklyHoursLogged: 28, status: "active" as const },
  { id: "per-002", firstName: "Sofiane", lastName: "Larbi", staffCategory: "teacher" as const, phone: "+213 661 22 33 44", email: "s.larbi@elimtiyaz.dz", hireDate: "2022-09-15", salary: 58000, weeklyHoursTarget: 30, weeklyHoursLogged: 32, status: "active" as const },
  { id: "per-003", firstName: "Nadia", lastName: "Hamidi", staffCategory: "teacher" as const, phone: "+213 770 33 44 55", email: "n.hamidi@elimtiyaz.dz", hireDate: "2019-09-01", salary: 72000, weeklyHoursTarget: 30, weeklyHoursLogged: 25, status: "active" as const },
  { id: "per-004", firstName: "Karim", lastName: "Zidane", staffCategory: "teacher" as const, phone: "+213 555 44 55 66", email: "k.zidane@elimtiyaz.dz", hireDate: "2021-09-01", salary: 70000, weeklyHoursTarget: 30, weeklyHoursLogged: 30, status: "active" as const },
  { id: "per-005", firstName: "Samira", lastName: "Belmiloud", staffCategory: "teacher" as const, phone: "+213 661 55 66 77", email: "s.belmiloud@elimtiyaz.dz", hireDate: "2018-09-01", salary: 78000, weeklyHoursTarget: 30, weeklyHoursLogged: 27, status: "active" as const },
  { id: "per-006", firstName: "Hocine", lastName: "Rebai", staffCategory: "teacher" as const, phone: "+213 770 66 77 88", email: "h.rebai@elimtiyaz.dz", hireDate: "2023-02-01", salary: 62000, weeklyHoursTarget: 30, weeklyHoursLogged: 29, status: "active" as const },
  { id: "per-007", firstName: "Brahim", lastName: "Souilah", staffCategory: "administration" as const, phone: "+213 555 77 88 99", email: "b.souilah@elimtiyaz.dz", hireDate: "2017-09-01", salary: 85000, weeklyHoursTarget: 40, weeklyHoursLogged: 38, status: "active" as const },
  { id: "per-008", firstName: "Toufik", lastName: "Ammar", staffCategory: "support" as const, phone: "+213 661 88 99 00", email: "t.ammar@elimtiyaz.dz", hireDate: "2022-01-15", salary: 42000, weeklyHoursTarget: 40, weeklyHoursLogged: 40, status: "active" as const },
  { id: "per-009", firstName: "Said", lastName: "Bouzid", staffCategory: "maintenance" as const, phone: "+213 770 99 00 11", email: null, hireDate: "2020-03-01", salary: 38000, weeklyHoursTarget: 40, weeklyHoursLogged: 36, status: "active" as const },
  { id: "per-010", firstName: "Messaoud", lastName: "Khalfaoui", staffCategory: "driver" as const, phone: "+213 555 00 11 22", email: null, hireDate: "2021-09-01", salary: 45000, weeklyHoursTarget: 35, weeklyHoursLogged: 33, status: "on_leave" as const },
].map((p) => ({ ...p, id: p.id, tenantId: TENANT_ID, avatarUrl: null }));

export const seedAudit = [
  { id: "aud-001", action: "auth.login", entityType: "session", entityId: "sess-001", actorId: "usr-adm-001", actorName: "Brahim Souilah", diff: null, note: "Connexion réussie", at: daysAgo(0) },
  { id: "aud-002", action: "payment.create", entityType: "payment", entityId: "pay-001", actorId: "usr-fin-001", actorName: "Fatima Belkacem (Fin)", diff: JSON.stringify({ before: null, after: { amount: 12500, method: "cash", status: "paid" } }), note: null, at: daysAgo(1) },
  { id: "aud-003", action: "expense.submit", entityType: "expense", entityId: "exp-003", actorId: "usr-sup-001", actorName: "Toufik Ammar", diff: JSON.stringify({ before: null, after: { amount: 68000, category: "utilities" } }), note: null, at: daysAgo(5) },
  { id: "aud-004", action: "expense.approve", entityType: "expense", entityId: "exp-001", actorId: "usr-adm-001", actorName: "Brahim Souilah", diff: JSON.stringify({ before: { status: "submitted" }, after: { status: "approved" } }), note: "OK urgence pédagogique", at: daysAgo(38) },
  { id: "aud-005", action: "student.create", entityType: "student", entityId: "stu-015", actorId: "usr-sup-002", actorName: "Sarah Mansouri", diff: JSON.stringify({ before: null, after: { code: "ELV-2025-000015", firstName: "Reda" } }), note: "Inscription nouvelle année", at: daysAgo(15) },
  { id: "aud-006", action: "parent.create", entityType: "parent", entityId: "par-008", actorId: "usr-sup-002", actorName: "Sarah Mansouri", diff: JSON.stringify({ before: null, after: { code: "PAR-2025-H4Q8", name: "Leila Touati" } }), note: null, at: daysAgo(20) },
  { id: "aud-007", action: "attendance.submit", entityType: "attendance", entityId: "att-batch-001", actorId: "usr-tea-001", actorName: "Aïcha Bouhenni", diff: JSON.stringify({ before: null, after: { classId: "cls-001", present: 26, absent: 2 } }), note: null, at: daysAgo(2) },
  { id: "aud-008", action: "expense.reject", entityType: "expense", entityId: "exp-005", actorId: "usr-adm-001", actorName: "Brahim Souilah", diff: JSON.stringify({ before: { status: "submitted" }, after: { status: "rejected" } }), note: "Justificatif manquant", at: daysAgo(7) },
  { id: "aud-009", action: "expense.disburse", entityType: "expense", entityId: "exp-001", actorId: "usr-fin-001", actorName: "Fatima Belkacem (Fin)", diff: JSON.stringify({ before: { status: "approved" }, after: { status: "disbursed" } }), note: null, at: daysAgo(35) },
  { id: "aud-010", action: "expense.settle", entityType: "expense", entityId: "exp-001", actorId: "usr-sup-001", actorName: "Toufik Ammar", diff: JSON.stringify({ before: { status: "disbursed" }, after: { status: "settled", proofUrl: "mock://proof/exp-001.jpg" } }), note: null, at: daysAgo(30) },
  { id: "aud-011", action: "homework.push", entityType: "homework", entityId: "hw-001", actorId: "usr-tea-002", actorName: "Sofiane Larbi", diff: JSON.stringify({ before: null, after: { classId: "cls-002", subjectId: "sub-002" } }), note: null, at: daysAgo(3) },
  { id: "aud-012", action: "debt.reminder_sent", entityType: "parent", entityId: "par-003", actorId: "usr-fin-001", actorName: "Fatima Belkacem (Fin)", diff: JSON.stringify({ before: { outstanding: 18000 }, after: { outstanding: 18000 } }), note: "WhatsApp reminder sent", at: daysAgo(4) },
  { id: "aud-013", action: "settings.update", entityType: "settings", entityId: "set-passing-grade", actorId: "usr-adm-001", actorName: "Brahim Souilah", diff: JSON.stringify({ before: { passingGrade: 9.5 }, after: { passingGrade: 10 } }), note: null, at: daysAgo(60) },
  { id: "aud-014", action: "auth.password_reset", entityType: "user", entityId: "usr-tea-003", actorId: "usr-tea-003", actorName: "Nadia Hamidi", diff: JSON.stringify({ before: { password: "***" }, after: { password: "***" } }), note: "Self-service reset", at: daysAgo(45) },
  { id: "aud-015", action: "grade.enter", entityType: "assessment", entityId: "asm-batch-001", actorId: "usr-tea-001", actorName: "Aïcha Bouhenni", diff: JSON.stringify({ before: null, after: { classId: "cls-001", subjectId: "sub-003", count: 28 } }), note: "T1 Math exam", at: daysAgo(8) },
].map((a) => ({ ...a, tenantId: TENANT_ID, ipAddress: "10.0.1.42", userAgent: "El-Imtiyaz-Desktop/0.1.0" }));

export const seedNotifications = [
  { id: "ntf-001", type: "payment_overdue" as const, title: "Créance en retard", body: "Famille Mansouri — 18 000 DZD en retard (61-90 j)", entityType: "parent", entityId: "par-003", readAt: null, createdAt: daysAgo(1) },
  { id: "ntf-002", type: "expense_pending" as const, title: "Dépense en attente d'approbation", body: "EXP-2025-003 — 68 000 DZD (Facture électricité)", entityType: "expense", entityId: "exp-003", readAt: null, createdAt: daysAgo(2) },
  { id: "ntf-003", type: "attendance_alert" as const, title: "Alerte absence", body: "Yacine Benali — 3 absences ce trimestre", entityType: "student", entityId: "stu-001", readAt: daysAgo(1), createdAt: daysAgo(3) },
  { id: "ntf-004", type: "expense_pending" as const, title: "Anomalie détectée", body: "EXP-2025-003 — 3.2× moyenne catégorie utilities", entityType: "expense", entityId: "exp-003", readAt: daysAgo(2), createdAt: daysAgo(5) },
  { id: "ntf-005", type: "homework" as const, title: "Nouveau devoir", body: "Classe 1ère B — Français: Lecture chapitre 3", entityType: "homework", entityId: "hw-001", readAt: null, createdAt: daysAgo(3) },
  { id: "ntf-006", type: "system" as const, title: "Sauvegarde automatique", body: "Backup quotidien créé avec succès (02:00)", entityType: "backup", entityId: "bak-2025-09-15", readAt: daysAgo(1), createdAt: daysAgo(1) },
];

// Demo accounts for the mock auth layer.
export const seedAccounts = [
  { email: "admin@elimtiyaz.dz", password: "admin123", userId: "usr-adm-001", displayName: "Brahim Souilah", role: "super_admin" as const },
  { email: "financial@elimtiyaz.dz", password: "fin123", userId: "usr-fin-001", displayName: "Fatima Belkacem (Fin)", role: "financial_officer" as const },
  { email: "teacher@elimtiyaz.dz", password: "teach123", userId: "usr-tea-001", displayName: "Aïcha Bouhenni", role: "teacher" as const },
  { email: "support@elimtiyaz.dz", password: "support123", userId: "usr-sup-001", displayName: "Toufik Ammar", role: "support_staff" as const },
];
