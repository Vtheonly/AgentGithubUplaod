/**
 * FeatureRegistry — canonical tree of every feature/page/action in the app.
 *
 * Every node carries an AccessRequirement. The FeatureGate evaluates the
 * node against the current Session. UI components consume nodes via
 * <GatedContent node={...}> so the gating rules are defined in ONE file.
 *
 * Structure: Section → Option → Page/Action. (Mirrors Android FeatureRegistry.)
 *
 * This is the single source of truth — to change a permission rule, edit
 * this file, not the component.
 */
import { Permission as P } from "./permissions";
import { Role as R } from "./roles";
import type { AccessRequirement } from "./access-requirement";
import {
  empty,
  permanent,
  requiresAnyOf,
  requiresPermission,
  requiresRole,
} from "./access-requirement";

export interface FeatureNode {
  readonly id: string;
  readonly label: string;
  readonly requirement: AccessRequirement;
  readonly children?: readonly FeatureNode[];
}

const t1 = "T1";
const t2 = "T2";

// === Top-level sections (sidebar entries) ===

/**
 * Iteration 9 — Dashboard access control (spec §1.1).
 *
 * Teachers and non-administrative staff (Buyer, Driver, WarehouseWorker,
 * Worker) are completely restricted from accessing the main
 * administrative/financial dashboard. Only administrative roles
 * (SuperAdmin, FinancialOfficer, SupportStaff, Manager) can view
 * sensitive organizational or financial data.
 *
 * Per spec: "Teachers and non-administrative staff must be completely
 * restricted from accessing the main administrative/financial dashboard."
 */
export const Dashboard: FeatureNode = {
  id: "section.dashboard",
  label: "Tableau de bord",
  requirement: requiresRole([
    R.SuperAdmin,
    R.FinancialOfficer,
    R.SupportStaff,
    R.Manager,
  ]),
};

export const Crm: FeatureNode = {
  id: "section.crm",
  label: "Élèves & Parents",
  requirement: requiresPermission(P.ViewRoster),
  children: [
    { id: "crm.roster", label: "Annuaire", requirement: requiresPermission(P.ViewRoster) },
    { id: "crm.batch_register", label: "Inscription groupée", requirement: requiresAnyOf([P.CreateParent, P.CreateStudent]) },
    { id: "crm.parent_detail", label: "Détail parent", requirement: requiresPermission(P.ViewRoster) },
    { id: "crm.student_detail", label: "Détail élève", requirement: requiresPermission(P.ViewRoster) },
    { id: "crm.adjust_account", label: "Ajustement de compte", requirement: requiresPermission(P.AdjustAccount) },
  ],
};

export const Academics: FeatureNode = {
  id: "section.academics",
  label: "Pédagogie",
  requirement: requiresPermission(P.ViewAcademics),
  children: [
    { id: "academics.school_years", label: "Années scolaires", requirement: requiresPermission(P.ViewAcademics) },
    { id: "academics.classes", label: "Classes", requirement: requiresPermission(P.ViewAcademics) },
    { id: "academics.subjects", label: "Matières", requirement: requiresPermission(P.ViewAcademics) },
    { id: "academics.roll_call", label: "Appel", requirement: requiresPermission(P.RollCall) },
    { id: "academics.grade_entry", label: "Saisie des notes", requirement: requiresPermission(P.EnterGrades) },
    { id: "academics.homework", label: "Devoirs", requirement: requiresPermission(P.AssignHomework) },
    { id: "academics.clubs", label: "Clubs", requirement: requiresPermission(P.ViewClubs) },
    {
      id: "academics.psychology",
      label: "Psychologie",
      requirement: requiresAnyOf([P.ViewPsychology, P.ManagePsychology, P.ConductPsychologySession]),
    },
    {
      id: "academics.orthophonie",
      label: "Orthophonie",
      requirement: requiresAnyOf([P.ViewOrthophonie, P.ManageOrthophonie, P.ConductOrthophonieSession]),
    },
  ],
};

export const Financials: FeatureNode = {
  id: "section.financials",
  label: "Finances",
  requirement: requiresPermission(P.ViewFinancials),
  children: [
    { id: "fin.payments", label: "Paiements", requirement: requiresPermission(P.ViewFinancials) },
    { id: "fin.counter_payment", label: "Encaissement", requirement: requiresPermission(P.CollectPayment) },
    { id: "fin.installments", label: "Tranches", requirement: requiresPermission(P.ViewFinancials) },
    { id: "fin.debt", label: "Créances", requirement: requiresPermission(P.ViewDebt) },
    { id: "fin.expenses", label: "Dépenses", requirement: requiresPermission(P.ViewFinancials) },
    { id: "fin.receipts", label: "Reçus", requirement: requiresPermission(P.GenerateReceipt) },
  ],
};

export const Personnel: FeatureNode = {
  id: "section.personnel",
  label: "Personnel",
  requirement: requiresPermission(P.ViewPersonnel),
  children: [
    { id: "pers.directory", label: "Annuaire", requirement: requiresPermission(P.ViewPersonnel) },
    { id: "pers.releve", label: "Relevé", requirement: requiresPermission(P.ViewReleve) },
    { id: "pers.audit_log", label: "Journal d'audit", requirement: requiresPermission(P.ViewAuditLog) },
    { id: "pers.workflows", label: "Workflows", requirement: requiresPermission(P.ViewWorkflowRuns) },
  ],
};

/**
 * Iteration 7 — Workflow Automation section (plan §10).
 *
 * Visual DAG editor + workflow runs monitor. Desktop-only per plan §10.02
 * (touchscreen DnD is impractical on mobile). The canvas is gated to
 * SuperAdmin (manage_workflows); the runs monitor is visible to anyone
 * with view_workflow_runs (SuperAdmin + FinancialOfficer).
 */
export const WorkflowAutomation: FeatureNode = {
  id: "section.workflow_automation",
  label: "Automatisations",
  requirement: requiresAnyOf([P.ManageWorkflows, P.ViewWorkflowRuns]),
  children: [
    { id: "wf.editor", label: "Éditeur", requirement: requiresPermission(P.ManageWorkflows) },
    { id: "wf.runs", label: "Exécutions", requirement: requiresPermission(P.ViewWorkflowRuns) },
  ],
};

export const Routing: FeatureNode = {
  id: "section.routing",
  label: "Tournées",
  requirement: requiresPermission(P.AccessDriverMode),
};

export const Settings: FeatureNode = {
  id: "section.settings",
  label: "Paramètres",
  requirement: requiresAnyOf([P.ManageSettings, P.ViewAuditLog, P.ManageBackups, P.ManageAIConfig]),
};

/** Top-level navigation — order matters (sidebar order). */
export const SIDEBAR_SECTIONS: readonly FeatureNode[] = [
  Dashboard,
  Crm,
  Academics,
  Financials,
  Personnel,
  WorkflowAutomation,
  Routing,
  Settings,
];

/**
 * Permanently disabled features — surfaced in the Settings → Locked features
 * card so users see what's intentionally removed / desktop-only / future.
 *
 * Iteration 7: the AI / workflow / backup features are now UNLOCKED (built
 * in this iteration). Only the Supabase adapter + mobile-only items remain
 * locked because they require a real backend / mobile app to function.
 */
export interface PermanentlyDisabledFeature {
  readonly id: string;
  readonly label: string;
  readonly state: "removed" | "not_yet_available" | "desktop_only" | "plan_upgrade_required";
}

export const PERMANENTLY_DISABLED: readonly PermanentlyDisabledFeature[] = [
  { id: "supabase.realtime", label: "Synchronisation temps réel Supabase", state: "not_yet_available" },
  { id: "supabase.edge_functions", label: "Déploiement Edge Functions", state: "not_yet_available" },
  { id: "supabase.rls", label: "Row-Level Security (RLS) policies", state: "not_yet_available" },
  { id: "mobile.android_parity", label: "Parité mobile Android", state: "desktop_only" },
];
