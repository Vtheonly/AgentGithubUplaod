/**
 * Audit Action constants — every state-changing operation in the system
 * has a stable string identifier that gets written to the audit_log table.
 *
 * These values are wire-protocol — never rename without a migration.
 *
 * Source: Android AuditActions + plan §12.
 */
export const AuditActions = {
  // Auth
  AuthLogin: "auth.login",
  AuthLogout: "auth.logout",
  AuthPasswordReset: "auth.password_reset",
  AuthSessionRevoked: "auth.session_revoked",

  // CRM
  ParentCreate: "parent.create",
  ParentUpdate: "parent.update",
  ParentDelete: "parent.delete",
  StudentCreate: "student.create",
  StudentUpdate: "student.update",
  StudentPromote: "student.promote",
  BatchRegister: "crm.batch_register",

  // Academic
  ClassCreate: "class.create",
  ClassUpdate: "class.update",
  SubjectAssign: "subject.assign",
  GradeEnter: "grade.enter",
  AttendanceSubmit: "attendance.submit",
  HomeworkPush: "homework.push",

  // Financial
  PaymentCreate: "payment.create",
  PaymentRefund: "payment.refund",
  PaymentAdjust: "payment.adjust",
  ReceiptGenerate: "receipt.generate",
  InstallmentCreate: "installment.create",
  InstallmentMarkPaid: "installment.mark_paid",
  DebtReminderSent: "debt.reminder_sent",

  // Expense
  ExpenseSubmit: "expense.submit",
  ExpenseApprove: "expense.approve",
  ExpenseReject: "expense.reject",
  ExpenseDisburse: "expense.disburse",
  ExpenseSettle: "expense.settle",

  // Personnel
  PersonnelCreate: "personnel.create",
  PersonnelUpdate: "personnel.update",
  ReleveCreate: "releve.create",

  // Settings / System
  SettingsUpdate: "settings.update",
  RbacMatrixUpdate: "rbac.matrix_update",
  BackupCreated: "backup.created",
  BackupRestored: "backup.restored",
  WorkflowPublished: "workflow.published",
  WorkflowTriggered: "workflow.triggered",

  // AI
  AiNarrativeDrafted: "ai.narrative_drafted",
  AiAnomalyFlagged: "ai.anomaly_flagged",
} as const;

export type AuditAction = (typeof AuditActions)[keyof typeof AuditActions];
