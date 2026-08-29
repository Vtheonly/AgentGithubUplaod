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
  AuthLoginFailed: "auth.login_failed",
  AuthPasswordReset: "auth.password_reset",
  /** Self-service password change (plan §12.04). Matches Android's AuditActions.AUTH_PASSWORD_CHANGE. */
  AuthPasswordChange: "auth.password_change",
  AuthSessionRevoked: "auth.session_revoked",
  /** VAULT §12.01 — system exports (PDF / XLSX / CSV) are tracked events. */
  SystemExport: "system.export",
  /** VAULT §12.01 — sensitive record views (data access requests) are tracked. */
  SensitiveRecordView: "record.sensitive_view",

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
  ClassArchive: "class.archive",
  ClassRestore: "class.restore",
  ClassDelete: "class.delete",
  SubjectCreate: "subject.create",
  SubjectUpdate: "subject.update",
  SubjectArchive: "subject.archive",
  SubjectAssign: "subject.assign",
  GradeEnter: "grade.enter",
  AttendanceSubmit: "attendance.submit",
  HomeworkPush: "homework.push",

  // School Year (lifecycle)
  SchoolYearCreate: "school_year.create",
  SchoolYearUpdate: "school_year.update",
  SchoolYearArchive: "school_year.archive",
  SchoolYearRestore: "school_year.restore",
  SchoolYearDelete: "school_year.delete",
  SchoolYearSetCurrent: "school_year.set_current",

  // Clubs (plan §05.07)
  ClubCreate: "club.create",
  ClubUpdate: "club.update",
  ClubArchive: "club.archive",
  ClubRestore: "club.restore",
  ClubDelete: "club.delete",
  ClubMemberEnroll: "club.member_enroll",
  ClubMemberWithdraw: "club.member_withdraw",
  ClubActivityLog: "club.activity_log",
  ClubActivityDelete: "club.activity_delete",

  // Psychology (Psyc) — restricted audit trail
  PsychologyFollowUpCreate: "psychology.followup_create",
  PsychologyFollowUpUpdate: "psychology.followup_update",
  PsychologyFollowUpClose: "psychology.followup_close",
  PsychologyFollowUpDelete: "psychology.followup_delete",
  PsychologySessionConduct: "psychology.session_conduct",
  PsychologySessionDelete: "psychology.session_delete",
  PsychologyReportCreate: "psychology.report_create",
  PsychologyReportDelete: "psychology.report_delete",

  // Speech Therapy (Orthophonie) — restricted audit trail
  OrthophonieFollowUpCreate: "orthophonie.followup_create",
  OrthophonieFollowUpUpdate: "orthophonie.followup_update",
  OrthophonieFollowUpClose: "orthophonie.followup_close",
  OrthophonieFollowUpDelete: "orthophonie.followup_delete",
  OrthophonieEvaluationConduct: "orthophonie.evaluation_conduct",
  OrthophonieEvaluationDelete: "orthophonie.evaluation_delete",
  OrthophonieSessionConduct: "orthophonie.session_conduct",
  OrthophonieSessionDelete: "orthophonie.session_delete",

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
  AiNarrativeApproved: "ai.narrative_approved",
  AiNarrativeRejected: "ai.narrative_rejected",
  AiDraftGenerated: "ai.draft_generated",
  AiDraftSent: "ai.draft_sent",
  AiAnomalyFlagged: "ai.anomaly_flagged",
  AiAnomalyJustificationRequested: "ai.anomaly_justification_requested",
  AiConfigUpdate: "ai.config_update",
  AiConfigTest: "ai.config_test",

  // Excel Import Engine (plan §14) — iteration 11
  ImportRunStarted: "import.run_started",
  ImportRunCompleted: "import.run_completed",
  ImportRowInserted: "import.row_inserted",
  ImportRowUpdated: "import.row_updated",
  ImportRowSkipped: "import.row_skipped",
  ImportRowRejected: "import.row_rejected",
} as const;

export type AuditAction = (typeof AuditActions)[keyof typeof AuditActions];
