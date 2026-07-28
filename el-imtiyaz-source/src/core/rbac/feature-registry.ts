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

export const Dashboard: FeatureNode = {
  id: "section.dashboard",
  label: "Tableau de bord",
  requirement: empty,
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
    { id: "academics.classes", label: "Classes", requirement: requiresPermission(P.ViewAcademics) },
    { id: "academics.subjects", label: "Matières", requirement: requiresPermission(P.ViewAcademics) },
    { id: "academics.roll_call", label: "Appel", requirement: requiresPermission(P.RollCall) },
    { id: "academics.grade_entry", label: "Saisie des notes", requirement: requiresPermission(P.EnterGrades) },
    { id: "academics.homework", label: "Devoirs", requirement: requiresPermission(P.AssignHomework) },
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
    { id: "pers.workflows", label: "Workflows", requirement: requiresRole([R.SuperAdmin]) },
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
  requirement: requiresAnyOf([P.ManageSettings, P.ViewAuditLog]),
};

/** Top-level navigation — order matters (sidebar order). */
export const SIDEBAR_SECTIONS: readonly FeatureNode[] = [
  Dashboard,
  Crm,
  Academics,
  Financials,
  Personnel,
  Routing,
  Settings,
];

/**
 * Permanently disabled features — surfaced in the Settings → Locked features
 * card so users see what's intentionally removed / desktop-only / future.
 */
export interface PermanentlyDisabledFeature {
  readonly id: string;
  readonly label: string;
  readonly state: "removed" | "not_yet_available" | "desktop_only" | "plan_upgrade_required";
}

export const PERMANENTLY_DISABLED: readonly PermanentlyDisabledFeature[] = [
  { id: "ai.assistant", label: "Assistant IA", state: "removed" },
  { id: "ai.report_narrative", label: "Narratif de bulletin", state: "not_yet_available" },
  { id: "ai.expense_anomaly", label: "Détection d'anomalies", state: "not_yet_available" },
  { id: "workflows.dag_editor", label: "Éditeur de workflows (DAG)", state: "not_yet_available" },
  { id: "data.excel_import", label: "Import Excel en masse", state: "not_yet_available" },
  { id: "system.backup", label: "Sauvegarde locale", state: "not_yet_available" },
  { id: "system.restore", label: "Restauration point-in-time", state: "not_yet_available" },
];
