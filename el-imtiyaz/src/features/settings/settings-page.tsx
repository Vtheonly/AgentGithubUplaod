/**
 * Settings hub — uses the SAME elevated tab navigation as every other Hub
 * page (CRM, Financials, Academics, Dashboard, Personnel, Workflow).
 *
 * Iteration 16 redesign:
 *   - Switched from `variant="rail"` (left vertical rail) to the DEFAULT
 *     `variant="elevated"` (segmented control) so Settings matches the
 *     navigation pattern, layout, and design language used everywhere
 *     else in the application.
 *   - Added `scrollable` to the PageTabList so the 10 tabs scroll
 *     horizontally on narrower windows (instead of forcing a rail).
 *   - Each Settings tab now lives in its own file under
 *     `features/settings/` — this file is just the shell that wires them
 *     into the tab navigation. This matches the structure of every other
 *     feature module.
 *
 * Tabs: Général / Tarification / Journal d'audit / Matrice RBAC /
 *       Inscriptions / Configuration / Synchronisation / IA /
 *       Sauvegardes / Fonctionnalités verrouillées
 *
 * Deep-linking: the `?tab=<id>` query param auto-selects a tab. The
 * Topbar quick-backup button uses this to navigate to /settings?tab=backup.
 *
 * RBAC: the Audit tab is restricted to SuperAdmin + FinancialOfficer
 * (plan §12). The Pricing tab requires ManagePricing or ViewFinancials.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import {
  Settings as SettingsIcon,
  Shield,
  Bot,
  Database,
  Lock,
  ScrollText,
  Tag,
  UserCheck,
  SlidersHorizontal,
  RefreshCw,
} from "lucide-react";
import { useAuth } from "../../app/providers/auth-provider";
import { Role } from "../../core/rbac/roles";
import { Permission } from "../../core/rbac/permissions";
import { PageHeader } from "../../shared/layout/page-header";
import { PageTabs, PageTabList, PageTab, PageTabContent } from "../../shared/layout/page-tabs";

import { GeneralTab } from "./general-tab";
import { PricingTab } from "./pricing-tab";
import { AuditLogTab, AccessDeniedCard } from "./audit-log-tab";
import { RbacMatrixEditor } from "./rbac-matrix-editor";
import { ApprovalsTab } from "./approvals-tab";
import { ConfigurationTab } from "./configuration-tab";
import { SyncTab } from "./sync-tab";
import { AIConfigTab } from "./ai-config-tab";
import { BackupTab as BackupTabImpl } from "./backup-tab";
import { LockedFeaturesTab } from "./locked-features-tab";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** All valid Settings tab IDs. Used to validate the ?tab= query param. */
const VALID_TABS = [
  "general", "pricing", "audit", "rbac", "approvals",
  "config", "sync", "ai", "backup", "locked",
] as const;

type SettingsTabId = (typeof VALID_TABS)[number];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function SettingsPage() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const [searchParams] = useSearchParams();

  // RBAC gates
  const canViewAudit =
    session?.role === Role.SuperAdmin || session?.role === Role.FinancialOfficer;
  const canViewPricing =
    !!session &&
    (session.permissions.has(Permission.ManagePricing) ||
      session.permissions.has(Permission.ViewFinancials));

  // Read the ?tab= query param so the Topbar quick-backup button
  // (which navigates to /settings?tab=backup) auto-selects the Backup tab.
  const tabParam = searchParams.get("tab");
  const initialTab: SettingsTabId =
    tabParam && (VALID_TABS as readonly string[]).includes(tabParam)
      ? (tabParam as SettingsTabId)
      : "general";
  const [activeTab, setActiveTab] = useState<string>(initialTab);

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={t("nav.settings")}
        description="Configuration système, tarification, journal d'audit, RBAC, IA, sauvegardes"
      />
      {/*
        Same elevated segmented control used by every other Hub page
        (CRM, Financials, Academics, Dashboard, Personnel, Workflow).
        The `scrollable` prop lets the 10-tab list scroll horizontally
        on narrower windows instead of overflowing.
      */}
      <PageTabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 flex flex-col px-6 pb-6 min-h-0"
      >
        <PageTabList scrollable>
          <PageTab value="general" label={t("settings.general")} icon={SettingsIcon} />
          <PageTab value="pricing" label="Tarification" icon={Tag} disabled={!canViewPricing} />
          <PageTab value="audit" label={t("settings.audit")} icon={ScrollText} disabled={!canViewAudit} />
          <PageTab value="rbac" label={t("settings.rbac")} icon={Shield} />
          <PageTab value="approvals" label="Inscriptions" icon={UserCheck} />
          <PageTab value="config" label="Configuration" icon={SlidersHorizontal} />
          <PageTab value="sync" label="Synchronisation" icon={RefreshCw} />
          <PageTab value="ai" label={t("settings.ai")} icon={Bot} />
          <PageTab value="backup" label={t("settings.backup")} icon={Database} />
          <PageTab value="locked" label={t("settings.locked")} icon={Lock} />
        </PageTabList>

        <PageTabContent value="general">
          <GeneralTab />
        </PageTabContent>

        <PageTabContent value="pricing">
          {canViewPricing ? <PricingTab /> : <AccessDeniedCard />}
        </PageTabContent>

        <PageTabContent value="audit" scrollable={false}>
          {canViewAudit ? <AuditLogTab /> : <AccessDeniedCard />}
        </PageTabContent>

        <PageTabContent value="rbac">
          <RbacMatrixEditor />
        </PageTabContent>

        <PageTabContent value="approvals" scrollable>
          <ApprovalsTab />
        </PageTabContent>

        <PageTabContent value="config" scrollable>
          <ConfigurationTab />
        </PageTabContent>

        <PageTabContent value="sync" scrollable>
          <SyncTab />
        </PageTabContent>

        <PageTabContent value="ai">
          <AIConfigTab />
        </PageTabContent>

        <PageTabContent value="backup">
          <BackupTabImpl />
        </PageTabContent>

        <PageTabContent value="locked">
          <LockedFeaturesTab />
        </PageTabContent>
      </PageTabs>
    </div>
  );
}
