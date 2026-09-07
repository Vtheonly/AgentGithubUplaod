/**
 * Permissions — fine-grained capabilities, grouped by domain.
 *
 * Permissions are granted to roles via the FeatureRegistry; the FeatureGate
 * evaluates whether a session has permission to access a given feature node.
 *
 * Iteration 8 adds a new "Workforce" group covering departments, tasks,
 * schedules, attendance, internal chat, and onboarding — turning Personnel
 * into a full workforce management system (plan §09 expansion).
 *
 * Source: Android Permission.kt + plan §02.07 + iteration 8 spec.
 */
import { Role } from "./roles";

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

  // Academic — School Year lifecycle (plan §05.05)
  /** Create / edit / archive / restore / delete school years. */
  ManageSchoolYears = "manage_school_years",

  // Academic — Clubs (plan §05.07)
  /** View the club catalog + memberships + activities. */
  ViewClubs = "view_clubs",
  /** Create / edit / archive / delete clubs. */
  ManageClubs = "manage_clubs",
  /** Enroll / withdraw students from clubs. */
  EnrollClubMembers = "enroll_club_members",
  /** Log club activities (sessions, meetings, events). */
  LogClubActivities = "log_club_activities",

  // Therapy — Psychology (Psyc) — RESTRICTED (plan §05.07)
  /** View psychological follow-ups / sessions / reports. Restricted by confidentiality. */
  ViewPsychology = "view_psychology",
  /** Create / edit / close psychological follow-ups. Designated psychologists + admins only. */
  ManagePsychology = "manage_psychology",
  /** Conduct psychological sessions. Designated psychologists only. */
  ConductPsychologySession = "conduct_psychology_session",
  /** Create psychological reports. Designated psychologists only. */
  CreatePsychologyReport = "create_psychology_report",

  // Therapy — Speech Therapy (Orthophonie) — RESTRICTED (plan §05.07)
  /** View speech therapy follow-ups / evaluations / sessions. */
  ViewOrthophonie = "view_orthophonie",
  /** Create / edit / close speech therapy follow-ups. Designated therapists + admins only. */
  ManageOrthophonie = "manage_orthophonie",
  /** Conduct speech therapy sessions + evaluations. Designated therapists only. */
  ConductOrthophonieSession = "conduct_orthophonie_session",

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

  // HR (original)
  ViewPersonnel = "view_personnel",
  ManagePersonnel = "manage_personnel",
  ViewAuditLog = "view_audit_log",
  ViewReleve = "view_releve",

  // Routing (driver mode — legacy routing/OSRM)
  AccessDriverMode = "access_driver_mode",

  // Settings
  ManageSettings = "manage_settings",
  ManageTenants = "manage_tenants",
  ManagePricing = "manage_pricing",

  // Iteration 7 — Workflow automation (plan §10)
  ManageWorkflows = "manage_workflows",
  ViewWorkflowRuns = "view_workflow_runs",

  // Iteration 7 — Backup & recovery (plan §13)
  ManageBackups = "manage_backups",

  // Iteration 7 — AI integration (plan §11)
  UseAI = "use_ai",
  ManageAIConfig = "manage_ai_config",

  // ---------------------------------------------------------------
  // Iteration 8 — Workforce management (plan §09 expansion)
  // ---------------------------------------------------------------
  /** View the department directory and org chart. */
  ViewDepartments = "view_departments",
  /** Create / edit / archive departments. */
  ManageDepartments = "manage_departments",
  /** Assign roles & departments to employees, change salaries, archive. */
  ManageEmployeeProfiles = "manage_employee_profiles",
  /** View an employee's salary details. */
  ViewSalary = "view_salary",
  /** Configure work schedules, shifts, working hours. */
  ManageSchedules = "manage_schedules",
  /** View attendance records (self + subordinates). */
  ViewAttendance = "view_attendance",
  /** Clock in / clock out (self). */
  ClockInOut = "clock_in_out",
  /** Approve leave / absence / overtime requests. */
  ApproveRequests = "approve_requests",
  /** Submit leave / absence / overtime requests. */
  SubmitRequests = "submit_requests",
  /** Create / edit / reassign / delete tasks. */
  ManageTasks = "manage_tasks",
  /** View tasks assigned to me or my team. */
  ViewTasks = "view_tasks",
  /** Update task status (start, progress, complete). */
  UpdateTaskStatus = "update_task_status",
  /** View performance reviews & analytics. */
  ViewPerformance = "view_performance",
  /** Conduct performance reviews. */
  ManagePerformance = "manage_performance",
  /** Use internal chat (DM + groups). */
  UseChat = "use_chat",
  /** Manage chat channels (create, archive, rename). */
  ManageChatChannels = "manage_chat_channels",
  /** Manage purchase requests (create, assign, approve). */
  ManagePurchaseRequests = "manage_purchase_requests",
  /** Manage suppliers (CRUD). */
  ManageSuppliers = "manage_suppliers",
  /** Manage deliveries (assign, update status, confirm). */
  ManageDeliveries = "manage_deliveries",
  /** Manage warehouse inventory (receive, dispatch, scan). */
  ManageInventory = "manage_inventory",
  /** Run / replay the company onboarding wizard. */
  ManageOnboarding = "manage_onboarding",
  /** View workforce reports & analytics. */
  ViewWorkforceReports = "view_workforce_reports",
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
  [Permission.ManageSchoolYears]: "Gérer les années scolaires",
  [Permission.ViewClubs]: "Consulter les clubs",
  [Permission.ManageClubs]: "Gérer les clubs",
  [Permission.EnrollClubMembers]: "Inscrire aux clubs",
  [Permission.LogClubActivities]: "Pointer les activités de club",
  [Permission.ViewPsychology]: "Consulter le suivi psychologique",
  [Permission.ManagePsychology]: "Gérer le suivi psychologique",
  [Permission.ConductPsychologySession]: "Mener une séance de psychologie",
  [Permission.CreatePsychologyReport]: "Rédiger un rapport psychologique",
  [Permission.ViewOrthophonie]: "Consulter l'orthophonie",
  [Permission.ManageOrthophonie]: "Gérer l'orthophonie",
  [Permission.ConductOrthophonieSession]: "Mener une séance d'orthophonie",
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
  [Permission.ManageWorkflows]: "Gérer les workflows",
  [Permission.ViewWorkflowRuns]: "Consulter les exécutions",
  [Permission.ManageBackups]: "Gérer les sauvegardes",
  [Permission.UseAI]: "Utiliser l'IA",
  [Permission.ManageAIConfig]: "Configurer l'IA",
  // Iteration 8 — Workforce
  [Permission.ViewDepartments]: "Consulter les départements",
  [Permission.ManageDepartments]: "Gérer les départements",
  [Permission.ManageEmployeeProfiles]: "Gérer les fiches employés",
  [Permission.ViewSalary]: "Consulter les salaires",
  [Permission.ManageSchedules]: "Gérer les plannings",
  [Permission.ViewAttendance]: "Consulter l'assiduité",
  [Permission.ClockInOut]: "Pointer (arrivée/départ)",
  [Permission.ApproveRequests]: "Approuver les demandes",
  [Permission.SubmitRequests]: "Soumettre des demandes",
  [Permission.ManageTasks]: "Gérer les tâches",
  [Permission.ViewTasks]: "Consulter les tâches",
  [Permission.UpdateTaskStatus]: "Mettre à jour les tâches",
  [Permission.ViewPerformance]: "Consulter la performance",
  [Permission.ManagePerformance]: "Gérer la performance",
  [Permission.UseChat]: "Utiliser la messagerie",
  [Permission.ManageChatChannels]: "Gérer les canaux",
  [Permission.ManagePurchaseRequests]: "Gérer les demandes d'achat",
  [Permission.ManageSuppliers]: "Gérer les fournisseurs",
  [Permission.ManageDeliveries]: "Gérer les livraisons",
  [Permission.ManageInventory]: "Gérer l'inventaire",
  [Permission.ManageOnboarding]: "Gérer l'onboarding",
  [Permission.ViewWorkforceReports]: "Consulter les rapports RH",
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

// SuperAdmin: unrestricted
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
  Permission.UseAI,
  Permission.ViewWorkflowRuns,
  Permission.ManageBackups,
  // Iteration 8 — financial officers see workforce reports + approve purchases
  Permission.ViewDepartments,
  Permission.ViewPersonnel,
  Permission.ViewAttendance,
  Permission.ViewPerformance,
  Permission.ViewTasks,
  Permission.ViewSalary,
  Permission.ApproveRequests,
  Permission.ManagePurchaseRequests,
  Permission.ViewWorkforceReports,
  Permission.UseChat,
  // Pédagogie redesign — financial officers can VIEW clubs/academics for billing
  // context, but CANNOT manage therapy records (restricted).
  Permission.ViewClubs,
]);

DEFAULT_ROLE_PERMISSIONS[Role.Teacher] = new Set<Permission>([
  // T-234 / RBAC-300 (35th session): ViewRoster and ViewAcademics were
  // REMOVED from the teacher role. They were the module-ENTRY permissions:
  // holding them rendered the CRM (Élèves & Parents) and Pédagogie sidebar
  // sections ENABLED (no padlock) for every teacher and exposed the full
  // school directory + parents' contact data. Teachers keep the ACTION
  // permissions (EnterGrades / RollCall / AssignHomework) and exercise
  // them strictly inside their Personnel workspace (T-235); class rosters
  // for roll-call/grades are loaded per-class, not via the CRM module.
  Permission.EnterGrades,
  Permission.AssignHomework,
  Permission.RollCall,
  Permission.SubmitExpense,
  Permission.ViewPersonnel,
  Permission.ViewReleve,
  Permission.UseAI,
  // Iteration 8 — teachers manage their classes from Personnel
  Permission.ViewTasks,
  Permission.UpdateTaskStatus,
  Permission.ViewAttendance,
  Permission.ClockInOut,
  Permission.SubmitRequests,
  Permission.UseChat,
  // Pédagogie redesign — teachers can view clubs + log activities for
  // clubs they supervise
  Permission.ViewClubs,
  Permission.LogClubActivities,
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
  // T-234 / RBAC-300 (35th session): the clerk/front-office grants. The
  // clerk desk handles enrollment, class assignment, year-end promotions
  // and payment-log lookups — without ViewFinancials the Finances tab
  // showed a padlock while CollectPayment was already held; without
  // ManageClasses/PromoteStudent the clerk could not assign students to
  // classes or run batch promotions (the audit's Part 2 finding #1).
  Permission.ViewFinancials,
  Permission.ManageClasses,
  Permission.PromoteStudent,
  // Iteration 8
  Permission.ViewDepartments,
  Permission.ViewTasks,
  Permission.UpdateTaskStatus,
  Permission.ClockInOut,
  Permission.SubmitRequests,
  Permission.UseChat,
  // Pédagogie redesign — support staff can enroll students in clubs
  Permission.ViewClubs,
  Permission.EnrollClubMembers,
]);

DEFAULT_ROLE_PERMISSIONS[Role.Parent] = new Set<Permission>();
DEFAULT_ROLE_PERMISSIONS[Role.Student] = new Set<Permission>();

// -----------------------------------------------------------------
// Iteration 8 — new workforce roles
// -----------------------------------------------------------------

DEFAULT_ROLE_PERMISSIONS[Role.Manager] = new Set<Permission>([
  Permission.ViewRoster,
  Permission.ViewAcademics,
  Permission.ViewPersonnel,
  Permission.ViewDepartments,
  Permission.ViewAttendance,
  Permission.ViewPerformance,
  Permission.ViewTasks,
  Permission.ManageTasks,
  Permission.UpdateTaskStatus,
  Permission.ViewSalary,
  Permission.ManageSchedules,
  Permission.ApproveRequests,
  Permission.SubmitExpense,
  Permission.ApproveExpense,
  Permission.ViewWorkforceReports,
  Permission.UseChat,
  Permission.ManageChatChannels,
  Permission.ViewReleve,
  Permission.UseAI,
  Permission.ClockInOut,
  // Pédagogie redesign — managers have full oversight of clubs + therapy
  // (program oversight, not direct clinical access — that's for designated staff)
  Permission.ManageSchoolYears,
  Permission.ViewClubs,
  Permission.ManageClubs,
  Permission.EnrollClubMembers,
  Permission.LogClubActivities,
  Permission.ViewPsychology,
  Permission.ViewOrthophonie,
]);

DEFAULT_ROLE_PERMISSIONS[Role.Buyer] = new Set<Permission>([
  Permission.ViewPersonnel,
  Permission.ViewDepartments,
  Permission.ViewTasks,
  Permission.UpdateTaskStatus,
  Permission.ManagePurchaseRequests,
  Permission.ManageSuppliers,
  Permission.UseChat,
  Permission.ClockInOut,
  Permission.SubmitRequests,
  Permission.SubmitExpense,
]);

DEFAULT_ROLE_PERMISSIONS[Role.Driver] = new Set<Permission>([
  Permission.ViewPersonnel,
  Permission.ViewDepartments,
  Permission.ViewTasks,
  Permission.UpdateTaskStatus,
  Permission.ManageDeliveries,
  Permission.AccessDriverMode,
  Permission.UseChat,
  Permission.ClockInOut,
  Permission.SubmitRequests,
]);

DEFAULT_ROLE_PERMISSIONS[Role.WarehouseWorker] = new Set<Permission>([
  Permission.ViewPersonnel,
  Permission.ViewDepartments,
  Permission.ViewTasks,
  Permission.UpdateTaskStatus,
  Permission.ManageInventory,
  Permission.UseChat,
  Permission.ClockInOut,
  Permission.SubmitRequests,
]);

DEFAULT_ROLE_PERMISSIONS[Role.Worker] = new Set<Permission>([
  Permission.ViewPersonnel,
  Permission.ViewDepartments,
  Permission.ViewTasks,
  Permission.UpdateTaskStatus,
  Permission.UseChat,
  Permission.ClockInOut,
  Permission.SubmitRequests,
]);
