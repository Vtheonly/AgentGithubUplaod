/**
 * Permissions — 28 fine-grained capabilities, grouped by domain.
 *
 * Permissions are granted to roles via the FeatureRegistry; the FeatureGate
 * evaluates whether a session has permission to access a given feature node.
 *
 * Source: Android Permission.kt + plan §02.07.
 */
export enum Permission {
  // CRM
  ViewRoster = "view_roster",
  CreateParent = "create_parent",
  EditParent = "edit_parent",
  DeleteParent = "delete_parent",
  CreateStudent = "create_student",
  EditStudent = "edit_student",
  PromoteStudent = "promote_student",

  // Academic
  ViewAcademics = "view_academics",
  EnterGrades = "enter_grades",
  ManageSubjects = "manage_subjects",
  ManageClasses = "manage_classes",
  AssignHomework = "assign_homework",
  RollCall = "roll_call",

  // Financial
  ViewFinancials = "view_financials",
  CollectPayment = "collect_payment",
  RefundPayment = "refund_payment",
  AdjustAccount = "adjust_account",
  GenerateReceipt = "generate_receipt",
  ViewDebt = "view_debt",
  SendReminder = "send_reminder",

  // Expenses
  SubmitExpense = "submit_expense",
  ApproveExpense = "approve_expense",
  DisburseExpense = "disburse_expense",
  SettleExpenseProof = "settle_expense_proof",

  // HR
  ViewPersonnel = "view_personnel",
  ManagePersonnel = "manage_personnel",
  ViewAuditLog = "view_audit_log",
  ViewReleve = "view_releve",

  // Routing (driver mode)
  AccessDriverMode = "access_driver_mode",

  // Settings
  ManageSettings = "manage_settings",
  ManageTenants = "manage_tenants",
  ManagePricing = "manage_pricing",
}

export const PERMISSION_LABELS_FR: Record<Permission, string> = {
  [Permission.ViewRoster]: "Consulter l'annuaire",
  [Permission.CreateParent]: "Créer un parent",
  [Permission.EditParent]: "Modifier un parent",
  [Permission.DeleteParent]: "Supprimer un parent",
  [Permission.CreateStudent]: "Créer un élève",
  [Permission.EditStudent]: "Modifier un élève",
  [Permission.PromoteStudent]: "Promouvoir un élève",
  [Permission.ViewAcademics]: "Consulter la pédagogie",
  [Permission.EnterGrades]: "Saisir des notes",
  [Permission.ManageSubjects]: "Gérer les matières",
  [Permission.ManageClasses]: "Gérer les classes",
  [Permission.AssignHomework]: "Diffuser un devoir",
  [Permission.RollCall]: "Faire l'appel",
  [Permission.ViewFinancials]: "Consulter les finances",
  [Permission.CollectPayment]: "Encaisser un paiement",
  [Permission.RefundPayment]: "Rembourser un paiement",
  [Permission.AdjustAccount]: "Ajuster un compte",
  [Permission.GenerateReceipt]: "Générer un reçu",
  [Permission.ViewDebt]: "Consulter les créances",
  [Permission.SendReminder]: "Envoyer un rappel",
  [Permission.SubmitExpense]: "Soumettre une dépense",
  [Permission.ApproveExpense]: "Approuver une dépense",
  [Permission.DisburseExpense]: "Décaisser une dépense",
  [Permission.SettleExpenseProof]: "Téléverser un justificatif",
  [Permission.ViewPersonnel]: "Consulter le personnel",
  [Permission.ManagePersonnel]: "Gérer le personnel",
  [Permission.ViewAuditLog]: "Consulter le journal d'audit",
  [Permission.ViewReleve]: "Consulter le relevé",
  [Permission.AccessDriverMode]: "Mode conducteur",
  [Permission.ManageSettings]: "Gérer les paramètres",
  [Permission.ManageTenants]: "Gérer les tenants",
  [Permission.ManagePricing]: "Gérer la tarification",
};

/**
 * Default role → permissions mapping.
 *
 * This is a reasonable baseline; the actual production mapping is
 * configurable through the RBAC matrix in Settings (Desktop-only).
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {} as Record<
  Role,
  ReadonlySet<Permission>
>;

import { Role } from "./roles";

DEFAULT_ROLE_PERMISSIONS[Role.SuperAdmin] = new Set(Object.values(Permission));
DEFAULT_ROLE_PERMISSIONS[Role.FinancialOfficer] = new Set<Permission>([
  Permission.ViewRoster,
  Permission.ViewAcademics,
  Permission.ViewFinancials,
  Permission.CollectPayment,
  Permission.RefundPayment,
  Permission.AdjustAccount,
  Permission.GenerateReceipt,
  Permission.ViewDebt,
  Permission.SendReminder,
  Permission.SubmitExpense,
  Permission.ApproveExpense,
  Permission.DisburseExpense,
  Permission.SettleExpenseProof,
  Permission.ViewPersonnel,
  Permission.ViewAuditLog,
  Permission.ViewReleve,
  Permission.ManageSettings,
]);
DEFAULT_ROLE_PERMISSIONS[Role.Teacher] = new Set<Permission>([
  Permission.ViewRoster,
  Permission.ViewAcademics,
  Permission.EnterGrades,
  Permission.AssignHomework,
  Permission.RollCall,
  Permission.SubmitExpense,
  Permission.ViewPersonnel,
  Permission.ViewReleve,
]);
DEFAULT_ROLE_PERMISSIONS[Role.SupportStaff] = new Set<Permission>([
  Permission.ViewRoster,
  Permission.CreateParent,
  Permission.EditParent,
  Permission.CreateStudent,
  Permission.EditStudent,
  Permission.ViewAcademics,
  Permission.CollectPayment,
  Permission.GenerateReceipt,
  Permission.SubmitExpense,
  Permission.ViewPersonnel,
]);
DEFAULT_ROLE_PERMISSIONS[Role.Parent] = new Set<Permission>();
DEFAULT_ROLE_PERMISSIONS[Role.Student] = new Set<Permission>();
