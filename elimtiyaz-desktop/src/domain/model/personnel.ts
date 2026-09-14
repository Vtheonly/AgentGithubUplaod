// ============================================================================
// FILE: src/domain/model/personnel.ts
// ============================================================================
/**
 * Personnel & HR Domain Model.
 *
 * Defines the core employee profile, compensation structures, salary adjustments,
 * payment logs, and activity records.
 *
 * BACKEND / SUPABASE MAPPING REFERENCE:
 *   - Table `personnel`: id, tenant_id, user_id, first_name, last_name, staff_category,
 *     role_id, department_id, supervisor_id, position, phone, email, address,
 *     hire_date, termination_date, salary, payment_method, bank_account,
 *     weekly_hours_target, status, emergency_contact, date_of_birth, national_id.
 *   - Table `salary_adjustments`: id, personnel_id, type, amount_before, amount_after,
 *     delta, reason, approved_by, approved_at.
 *   - Table `salary_payments`: id, personnel_id, period, amount, status, payment_date,
 *     method, receipt_number, notes, paid_by.
 *   - Table `releve_entries`: id, personnel_id, date, hours_in, hours_out, activity,
 *     class_id, subject_id, task_id, auto_kind, note, recorded_at.
 */

import type { Role } from "../../core/rbac/roles";

export type StaffCategory =
  | "teacher"
  | "administration"
  | "support"
  | "maintenance"
  | "driver"
  | "buyer"
  | "warehouse"
  | "worker"
  | "medical";

export type PersonnelStatus =
  | "active"
  | "on_leave"
  | "suspended"
  | "terminated"
  | "archived";
export type ReleveActivity =
  | "course"
  | "meeting"
  | "supervision"
  | "correction"
  | "task"
  | "delivery"
  | "warehouse"
  | "other";
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

/**
 * Salary Adjustment Record.
 * Represents an audited change to an employee's base salary or one-off bonus/deduction.
 * MANDATORY: Every adjustment must carry a non-empty `reason`.
 */
export type SalaryAdjustmentType = "raise" | "cut" | "bonus" | "deduction";

export const SALARY_ADJUSTMENT_TYPE_LABELS_FR: Record<
  SalaryAdjustmentType,
  string
> = {
  raise: "Augmentation de salaire",
  cut: "Réduction de salaire",
  bonus: "Prime exceptionnelle",
  deduction: "Retenue / Déduction",
};

export interface SalaryAdjustment {
  readonly id: string;
  readonly personnelId: string;
  readonly type: SalaryAdjustmentType;
  readonly amountBefore: number;
  readonly amountAfter: number;
  readonly delta: number; // Positive for raise/bonus, negative for cut/deduction
  readonly reason: string; // Mandatory justification
  readonly effectiveDate: string; // ISO date
  readonly approvedBy: string; // Actor user ID
  readonly approvedByName: string;
  readonly createdAt: string; // ISO datetime
}

/**
 * Monthly Salary Payment Record.
 * Tracks salary disbursement lifecycle for an employee for a specific billing period (e.g., "2026-03").
 */
export type SalaryPaymentStatus = "paid" | "unpaid" | "pending";

export const SALARY_PAYMENT_STATUS_LABELS_FR: Record<
  SalaryPaymentStatus,
  string
> = {
  paid: "Versé / Payé",
  unpaid: "Non versé",
  pending: "En cours de virement",
};

export interface SalaryPaymentRecord {
  readonly id: string;
  readonly personnelId: string;
  readonly period: string; // YYYY-MM (e.g., "2026-03")
  readonly baseSalary: number;
  readonly bonusesTotal: number;
  readonly deductionsTotal: number;
  readonly netPaid: number;
  readonly status: SalaryPaymentStatus;
  readonly paymentDate: string | null; // ISO date when settled
  readonly method: PayrollMethod;
  readonly referenceNumber: string | null; // Receipt or bank transfer ref
  readonly notes: string | null;
  readonly paidBy: string | null;
  readonly paidByName: string | null;
}

export interface Personnel {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string | null; // Bound user account
  readonly firstName: string;
  readonly lastName: string;
  readonly staffCategory: StaffCategory;
  readonly roleId: Role;
  readonly departmentId: string | null;
  readonly supervisorId: string | null;
  readonly position: string;
  readonly phone: string;
  readonly email: string | null;
  readonly address: string | null;
  readonly hireDate: string;
  readonly terminationDate: string | null;
  readonly salary: number | null; // Base monthly salary in DZD
  readonly paymentMethod: PayrollMethod | null;
  readonly bankAccount: string | null;
  readonly weeklyHoursTarget: number;
  readonly weeklyHoursLogged: number;
  readonly avatarUrl: string | null;
  readonly status: PersonnelStatus;
  readonly salaryAdjustments?: readonly SalaryAdjustment[];
  readonly salaryPayments?: readonly SalaryPaymentRecord[];
  readonly documents: readonly PersonnelDocument[];
  readonly notes: readonly {
    id: string;
    authorId: string;
    authorName: string;
    body: string;
    createdAt: string;
  }[];
  readonly emergencyContact: {
    name: string;
    phone: string;
    relation: string;
  } | null;
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
  readonly taskId?: string | null;
  readonly autoKind?: "grade_entry" | "homework_push" | "roll_call" | null;
  readonly note?: string | null;
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
  medical: "Médical / Thérapie",
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

export function staffCategoryForRole(role: Role): StaffCategory {
  switch (role) {
    case "teacher":
      return "teacher";
    case "super_admin":
    case "financial_officer":
    case "manager":
      return "administration";
    case "support_staff":
      return "support";
    case "buyer":
      return "buyer";
    case "driver":
      return "driver";
    case "warehouse_worker":
      return "warehouse";
    case "worker":
      return "worker";
    default:
      return "support";
  }
}
