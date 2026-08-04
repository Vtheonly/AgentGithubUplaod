/**
 * Roles — defined in the plan (§02.07 RBAC) plus iteration 8 workforce expansion.
 *
 * The original 6 roles (SuperAdmin, FinancialOfficer, Teacher, SupportStaff,
 * Parent, Student) cover the school's pedagogical & financial core.
 *
 * Iteration 8 introduces 5 additional staff roles to turn the Personnel module
 * into a full workforce management system (plan §09 expansion):
 *   - Manager          — supervises one or more teams / departments
 *   - Buyer            — handles purchase requests, suppliers, purchase orders
 *   - Driver           — handles deliveries, routes, confirmations
 *   - WarehouseWorker  — receives/dispatches goods, scans, updates inventory
 *   - Worker           — general staff who clock in/out and accept assigned tasks
 *
 * Wire-protocol keys are stable strings — never rename without a migration.
 */
export enum Role {
  // Original 6 roles (plan §02.07)
  SuperAdmin = "super_admin",
  FinancialOfficer = "financial_officer",
  Teacher = "teacher",
  SupportStaff = "support_staff",
  Parent = "parent",
  Student = "student",

  // Iteration 8 — workforce expansion (plan §09)
  Manager = "manager",
  Buyer = "buyer",
  Driver = "driver",
  WarehouseWorker = "warehouse_worker",
  Worker = "worker",
}

export const ROLE_LABELS_FR: Record<Role, string> = {
  [Role.SuperAdmin]: "Super Administrateur",
  [Role.FinancialOfficer]: "Agent Financier",
  [Role.Teacher]: "Enseignant",
  [Role.SupportStaff]: "Personnel de Soutien",
  [Role.Parent]: "Parent",
  [Role.Student]: "Élève",
  [Role.Manager]: "Responsable",
  [Role.Buyer]: "Acheteur",
  [Role.Driver]: "Chauffeur",
  [Role.WarehouseWorker]: "Magasinier",
  [Role.Worker]: "Ouvrier",
};

export const ROLE_LABELS_AR: Record<Role, string> = {
  [Role.SuperAdmin]: "مدير عام",
  [Role.FinancialOfficer]: "مسؤول مالي",
  [Role.Teacher]: "معلم",
  [Role.SupportStaff]: "موظف دعم",
  [Role.Parent]: "ولي أمر",
  [Role.Student]: "تلميذ",
  [Role.Manager]: "مشرف",
  [Role.Buyer]: "مشتري",
  [Role.Driver]: "سائق",
  [Role.WarehouseWorker]: "عامل مخزن",
  [Role.Worker]: "عامل",
};

/** Short French description shown in role pickers and the onboarding wizard. */
export const ROLE_DESCRIPTIONS_FR: Record<Role, string> = {
  [Role.SuperAdmin]: "Accès complet à toute la plateforme. Gère l'organisation, le personnel, les paramètres et la sécurité.",
  [Role.FinancialOfficer]: "Gère les paiements, les dépenses, les créances et la comptabilité.",
  [Role.Teacher]: "Effectue tout son travail pédagogique depuis le module Personnel : classes, devoirs, notes, appel, bulletins.",
  [Role.SupportStaff]: "Inscrit les parents/élèves, encaisse les paiements à l'accueil, saisit les dépenses.",
  [Role.Parent]: "Portail web — consulte les relevés, paie en ligne, suit la scolarité.",
  [Role.Student]: "Portail web — consulte les notes, devoirs et relevés.",
  [Role.Manager]: "Supervise une ou plusieurs équipes. Affecte le travail, approuve les demandes, suit l'assiduité et la performance.",
  [Role.Buyer]: "Gère les demandes d'achat, les fournisseurs, les bons de commande et les réceptions.",
  [Role.Driver]: "Effectue les livraisons, suit les tournées, met à jour les statuts et confirme les remises.",
  [Role.WarehouseWorker]: "Reçoit et expédie les marchandises, scanne les produits, met à jour l'inventaire, signale les avaries.",
  [Role.Worker]: "Ouvrier polyvalent : voit ses tâches, pointe à l'arrivée/départ, demande des congés, communique avec son superviseur.",
};

/**
 * Staff roles = roles that can sign into the desktop terminal.
 * Parents & students are redirected to the web portal.
 */
export const STAFF_ROLES: ReadonlySet<Role> = new Set([
  Role.SuperAdmin,
  Role.FinancialOfficer,
  Role.Teacher,
  Role.SupportStaff,
  Role.Manager,
  Role.Buyer,
  Role.Driver,
  Role.WarehouseWorker,
  Role.Worker,
]);

export function isStaff(role: Role): boolean {
  return STAFF_ROLES.has(role);
}

export function roleLabelFr(role: Role): string {
  return ROLE_LABELS_FR[role];
}

/**
 * Roles that should be offered in the onboarding wizard as candidates for
 * "Who are the administrators?" and "Who manages each department?".
 */
export const ADMINISTRATIVE_ROLES: ReadonlySet<Role> = new Set([
  Role.SuperAdmin,
  Role.Manager,
]);

/** Roles that can be assigned as a supervisor/manager of a department. */
export const SUPERVISORY_ROLES: ReadonlySet<Role> = new Set([
  Role.SuperAdmin,
  Role.Manager,
]);

/** Roles that perform operational work (vs administrative). */
export const OPERATIONAL_ROLES: ReadonlySet<Role> = new Set([
  Role.Teacher,
  Role.Buyer,
  Role.Driver,
  Role.WarehouseWorker,
  Role.Worker,
  Role.SupportStaff,
]);
