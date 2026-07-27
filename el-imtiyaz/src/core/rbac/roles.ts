/**
 * Roles — six roles defined in the plan (§02.07 RBAC).
 *
 * First four use the desktop terminal; Parent & Student are redirected to
 * the web portal. Wire-protocol keys are stable strings.
 */
export enum Role {
  SuperAdmin = "super_admin",
  FinancialOfficer = "financial_officer",
  Teacher = "teacher",
  SupportStaff = "support_staff",
  Parent = "parent",
  Student = "student",
}

export const ROLE_LABELS_FR: Record<Role, string> = {
  [Role.SuperAdmin]: "Super Administrateur",
  [Role.FinancialOfficer]: "Agent Financier",
  [Role.Teacher]: "Enseignant",
  [Role.SupportStaff]: "Personnel de Soutien",
  [Role.Parent]: "Parent",
  [Role.Student]: "Élève",
};

export const ROLE_LABELS_AR: Record<Role, string> = {
  [Role.SuperAdmin]: "مدير عام",
  [Role.FinancialOfficer]: "مسؤول مالي",
  [Role.Teacher]: "معلم",
  [Role.SupportStaff]: "موظف دعم",
  [Role.Parent]: "ولي أمر",
  [Role.Student]: "تلميذ",
};

export const STAFF_ROLES: ReadonlySet<Role> = new Set([
  Role.SuperAdmin,
  Role.FinancialOfficer,
  Role.Teacher,
  Role.SupportStaff,
]);

export function isStaff(role: Role): boolean {
  return STAFF_ROLES.has(role);
}

export function roleLabelFr(role: Role): string {
  return ROLE_LABELS_FR[role];
}
