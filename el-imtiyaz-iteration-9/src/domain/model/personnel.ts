/**
 * Personnel / HR domain — plan §09 + iteration 8 workforce expansion.
 *
 * 4 staff categories drive default permission templates and reporting breakdowns.
 * ReleveEntry = append-only teacher activity ledger (grades entered, homework,
 * attendance submitted, hours taught). Audit basis for payroll.
 *
 * Iteration 8 adds:
 *   - roleId: links a personnel record to an RBAC role (plan §02.07 + new roles)
 *   - departmentId: links to the Department entity
 *   - supervisorId: links to the employee's direct manager
 *   - position: free-form job title (e.g. "Professeur de Mathématiques")
 *   - paymentMethod, bankAccount, bonuses, deductions: payroll details
 *   - documents: uploaded attachments (contract, ID, diplomas)
 *   - notes: internal HR notes
 */
import type { Role } from "../../core/rbac/roles";

export type StaffCategory = "teacher" | "administration" | "support" | "maintenance" | "driver" | "buyer" | "warehouse" | "worker";
export type PersonnelStatus = "active" | "on_leave" | "suspended" | "terminated" | "archived";
export type ReleveActivity = "course" | "meeting" | "supervision" | "correction" | "task" | "delivery" | "warehouse" | "other";

/** Payroll payment method (distinct from student PaymentMethod in payment.ts). */
export type PayrollMethod = "cash" | "bank_transfer" | "check" | "mobile_money";

export const PAYROLL_METHOD_LABELS_FR: Record<PayrollMethod, string> = {
  cash: "Espèces",
  bank_transfer: "Virement bancaire",
  check: "Chèque",
  mobile_money: "Mobile Money",
};

export interface PersonnelDocument {
  readonly id: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly uploadedAt: string;
  readonly uploadedBy: string;
  readonly category: "contract" | "id" | "diploma" | "medical" | "other";
  readonly url: string;
}

export interface BonusAdjustment {
  readonly id: string;
  readonly type: "bonus" | "deduction";
  readonly label: string;
  readonly amount: number;
  readonly date: string;
  readonly note: string | null;
}

export interface Personnel {
  readonly id: string;
  readonly tenantId: string;
  /** Iteration 9: links the personnel record to the auth user account. */
  readonly userId: string | null;
  readonly firstName: string;
  readonly lastName: string;
  readonly staffCategory: StaffCategory;
  /** RBAC role (links to core/rbac/roles). */
  readonly roleId: Role;
  /** Department ID (links to Department entity). */
  readonly departmentId: string | null;
  /** Direct supervisor (personnelId). */
  readonly supervisorId: string | null;
  readonly position: string;
  readonly phone: string;
  readonly email: string | null;
  readonly address: string | null;
  readonly hireDate: string;
  readonly terminationDate: string | null;
  readonly salary: number | null;
  readonly paymentMethod: PayrollMethod | null;
  readonly bankAccount: string | null;
  readonly weeklyHoursTarget: number;
  readonly weeklyHoursLogged: number;
  readonly avatarUrl: string | null;
  readonly status: PersonnelStatus;
  readonly bonuses: readonly BonusAdjustment[];
  readonly documents: readonly PersonnelDocument[];
  readonly notes: readonly { id: string; authorId: string; authorName: string; body: string; createdAt: string }[];
  readonly emergencyContact: { name: string; phone: string; relation: string } | null;
  readonly dateOfBirth: string | null;
  readonly nationalId: string | null;
}

export interface ReleveEntry {
  readonly id: string;
  readonly personnelId: string;
  readonly personnelName: string;
  readonly date: string;
  readonly hoursIn: number;
  readonly hoursOut: number | null;
  readonly activity: ReleveActivity;
  readonly classId: string | null;
  readonly subjectId: string | null;
  /** Optional link to the workforce Task that generated this entry. */
  readonly taskId?: string | null;
  readonly recordedAt: string;
}

export const STAFF_CATEGORY_LABELS_FR: Record<StaffCategory, string> = {
  teacher: "Enseignant",
  administration: "Administration",
  support: "Soutien",
  maintenance: "Maintenance",
  driver: "Chauffeur",
  buyer: "Acheteur",
  warehouse: "Magasinier",
  worker: "Ouvrier",
};

export const PERSONNEL_STATUS_LABELS_FR: Record<PersonnelStatus, string> = {
  active: "Actif",
  on_leave: "En congé",
  suspended: "Suspendu",
  terminated: "Licencié",
  archived: "Archivé",
};

export const RELEVE_ACTIVITY_LABELS_FR: Record<ReleveActivity, string> = {
  course: "Cours",
  meeting: "Réunion",
  supervision: "Surveillance",
  correction: "Correction",
  task: "Tâche",
  delivery: "Livraison",
  warehouse: "Magasin",
  other: "Autre",
};

/** Map an RBAC role to the default staff category (used when seeding / onboarding). */
export function staffCategoryForRole(role: Role): StaffCategory {
  switch (role) {
    case "teacher": return "teacher";
    case "super_admin":
    case "financial_officer":
    case "manager": return "administration";
    case "support_staff": return "support";
    case "buyer": return "buyer";
    case "driver": return "driver";
    case "warehouse_worker": return "warehouse";
    case "worker": return "worker";
    default: return "support";
  }
}
