// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/dashboard-page.tsx
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import {
  ChevronRight,
  LayoutDashboard,
  FileText,
  Bell,
  BarChart3,
  Settings2,
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import { useAuth } from "../../app/providers/auth-provider";
import { useObservable } from "../../shared/hooks/use-observable";
// T-514 (UI-342): the Pareto bar-click navigation — the app-shell's global
// person-navigation drawer (openParent), reused (never re-implemented).
import { usePersonNavigation } from "../../shared/navigation/person-navigation-context";
import type { AcademicYear } from "../../domain/model/academic";
import { PageHeader } from "../../shared/layout/page-header";
import {
  PageTabs,
  PageTabList,
  PageTab,
  PageTabContent,
} from "../../shared/layout/page-tabs";
import { Button } from "../../shared/ui/button";
import { SeeDetailsModal } from "./see-details-modal";
import {
  AcademicYearSelector,
  type AcademicYearRange,
  computeDateRange,
  getLatestAcademicYear,
} from "./academic-year-selector";
import { OverviewTab } from "./tabs/overview-tab";
import { AnalyticsTab } from "./tabs/analytics-tab";
import { AlertsTab } from "./tabs/alerts-tab";
import { ReportsTab } from "./tabs/reports-tab";
import type { SeeDetailsTab } from "./tabs/types";
// T-443 (DEBT-101): the ACTIVE debt-aging thresholds feeding both tabs.
import {
  DEFAULT_DEBT_AGING_THRESHOLDS,
  type DebtAgingThresholds,
} from "../../domain/calc/ledger/debt-aging";
// T-507 (UI-338): the CONTEXTUAL thresholds configuration host — the ONE
// draft/hold state + the ONE modal for both dashboard tabs; the trigger
// rides the tabs' CardHeaderActions surfaces (the effective value flows
// through the EXISTING debtThresholds prop plumbing — the live preview).
import {
  useThresholdsConfigHost,
  canEditThresholds,
} from "../settings/contextual-thresholds-config";
// E6.9 (DUP-029, D-U1): the view-model hooks — the page's data acquisition
// lives in the hooks; this component is the pure composition/layout root.
import { useOverviewData } from "./use-overview-data";
import { useAnalyticsData } from "./use-analytics-data";

type DashboardTab = "overview" | "analytics" | "alerts" | "reports";

/** Stable empty default — keeps hook dependencies referentially stable. */
const NO_YEARS: readonly AcademicYear[] = [];

export function DashboardPage() {
  const { t } = useTranslation();
  const repos = useRepositories();
  const { session } = useAuth();
  // T-514 (UI-342): the Pareto bar-click target — the global drawer.
  const { openParent } = usePersonNavigation();

  // T-408 (ACAD-509): the selectable academic years derive from the
  // CANONICAL academic_years repository — the previous hardcoded
  // four-year list (2023-2024…2026-2027) was fake selector data: years
  // the live database never contained. The default is the CURRENT year
  // (the school's operating year), falling back to the latest configured
  // year, then to the date-derived school-year window.
  const academicYears =
    useObservable(() => repos.academicYears.observeAll(), []) ?? NO_YEARS;
  const availableYears = useMemo(
    () => academicYears.map((y) => y.code).filter((c): c is string => !!c),
    [academicYears],
  );

  const [seeDetailsOpen, setSeeDetailsOpen] = useState(false);
  const [seeDetailsTab, setSeeDetailsTab] = useState<SeeDetailsTab>("revenue");
  const [tab, setTab] = useState<DashboardTab>("overview");
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [layoutEditing, setLayoutEditing] = useState(false);

  // T-412: `/?tab=<dashboardTab>` routes cross-page links to a specific
  // dashboard tab (the Personnel payroll-forecast section links to the
  // Statistics analytics view). Mount-time only — it never fights the
  // operator's own tab switches afterwards.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const wanted = searchParams.get("tab");
    if (
      wanted === "overview" ||
      wanted === "analytics" ||
      wanted === "alerts" ||
      wanted === "reports"
    ) {
      setTab(wanted);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("tab");
          return next;
        },
        { replace: true },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [yearRange, setYearRange] = useState<AcademicYearRange>(() => ({
    academicYear: "",
    range: undefined,
    preset: "ytd",
  }));

  // T-408 (ACAD-509): resolve the default year from the CANONICAL years —
  // current year first, then the latest configured year, then the
  // date-derived school-year window (getLatestAcademicYear's fallback for
  // an empty/unresolved repository — a DATE computation, never a fabricated
  // academic record). Runs once years settle; keeps a valid selection.
  useEffect(() => {
    if (yearRange.academicYear && availableYears.includes(yearRange.academicYear)) {
      return;
    }
    const current = academicYears.find((y) => y.isCurrent && !y.isArchived);
    const next = current?.code ?? getLatestAcademicYear(availableYears);
    if (!next || next === yearRange.academicYear) return;
    setYearRange({
      academicYear: next,
      range: computeDateRange(next, "ytd"),
      preset: "ytd",
    });
  }, [availableYears, academicYears, yearRange.academicYear]);

  // E6.9 (D-U1): the view-models — the aggregation fetch, the bounded
  // payment/installment slices, the debt-summary stream and the top-debtors
  // derivation live in use-overview-data; the previous-year comparison
  // lane lives in use-analytics-data.
  const overview = useOverviewData(yearRange);
  const analytics = useAnalyticsData(yearRange, availableYears);

  // T-443 (DEBT-101, INV-16f): the tenant's ACTIVE debt-aging thresholds —
  // ONE subscription feeding BOTH dashboard tabs (the Overview triage + the
  // Analytics triage render through it), so Statistiques classifies debt
  // with the SAME edges the Finances « Suivi des Dettes » statuses use. The
  // subject's seed value is the documented DEFAULTS until the light reader
  // (`read_debt_aging_thresholds`, migration 0133) lands on the server.
  const [debtThresholds, setDebtThresholds] = useState<DebtAgingThresholds>(DEFAULT_DEBT_AGING_THRESHOLDS);
  useEffect(() => {
    const unsub = repos.debt.observeThresholds().subscribe(setDebtThresholds);
    return unsub;
  }, [repos.debt]);
  // T-507 (UI-338): the contextual-config host — `effective` is what BOTH
  // tabs derive with (active + the live draft/hold overrides; the preview),
  // `config` drives the per-card triggers (null for a non-SuperAdmin session
  // — the system_settings RLS write gate), and `modal` is the ONE editor
  // instance for the whole page.
  const thresholdsCfg = useThresholdsConfigHost(debtThresholds, {
    enabled: canEditThresholds(session),
  });

  useEffect(() => {
    if (!session) return;
    const unsub = repos.notifications
      .observeForSession({ userId: session.userId, role: session.role })
      .subscribe((n) => {
        setUnreadAlerts(n.filter((x) => !x.readAt).length);
      });
    return unsub;
  }, [repos.notifications, session]);

  function openSeeDetails(tabName: SeeDetailsTab = "revenue") {
    setSeeDetailsTab(tabName);
    setSeeDetailsOpen(true);
  }

  const drillByKpi: Record<string, SeeDetailsTab> = {
    students: "demographics",
    parents: "demographics",
    staff: "demographics",
    monthlyRevenue: "revenue",
    todayRevenue: "revenue",
    outstandingDebt: "debt",
    overdueAlerts: "debt",
    pendingExpenses: "debt",
  };

  const handleKpiClick = (kpi: string) => {
    const target = drillByKpi[kpi];
    if (target) openSeeDetails(target);
  };

  const layoutSupported = tab === "overview" || tab === "analytics";

  const handleTabChange = (nextValue: string) => {
    const nextTab = nextValue as DashboardTab;
    setTab(nextTab);
    if (nextTab === "alerts" || nextTab === "reports") {
      setLayoutEditing(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-surface-background">
      <PageHeader
        title={
          <div className="flex items-center gap-3">
            <span>{t("dashboard.title")}</span>
            <span className="text-xs font-mono font-normal px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
              Session {yearRange.academicYear}
            </span>
          </div>
        }
        description="Cockpit institutionnel — pilotage académique, logistique et financier"
        actions={
          <div className="flex items-center gap-2">
            {layoutSupported && (
              <Button
                size="sm"
                variant={layoutEditing ? "default" : "outline"}
                className="gap-1 shadow-sm text-xs"
                aria-pressed={layoutEditing}
                onClick={() => setLayoutEditing((value) => !value)}
              >
                <Settings2 className="h-3.5 w-3.5" />
                {layoutEditing
                  ? "Terminer la personnalisation"
                  : "Personnaliser le tableau de bord"}
              </Button>
            )}
            <AcademicYearSelector
              value={yearRange}
              onChange={setYearRange}
              availableYears={availableYears}
            />
            {tab === "overview" && (
              <Button
                size="sm"
                variant="default"
                className="gap-1 shadow-sm text-xs"
                onClick={() => openSeeDetails("revenue")}
              >
                {t("dashboard.seeDetails")}
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        }
      />

      <PageTabs
        value={tab}
        onValueChange={handleTabChange}
        className="flex-1 flex flex-col px-6 pb-6 min-h-0"
      >
        <PageTabList className="mb-2">
          <PageTab
            value="overview"
            label={t("dashboard.overview")}
            icon={LayoutDashboard}
          />
          <PageTab
            value="analytics"
            label="Analytique & Pilotage"
            icon={BarChart3}
          />
          <PageTab
            value="alerts"
            label={t("dashboard.alerts")}
            icon={Bell}
            count={unreadAlerts}
            countTone="danger"
          />
          <PageTab
            value="reports"
            label={t("dashboard.reports")}
            icon={FileText}
          />
        </PageTabList>

        <PageTabContent value="overview">
          <OverviewTab
            data={overview.data}
            payments={overview.payments}
            installments={overview.installments}
            range={yearRange.range}
            onDrillDown={handleKpiClick}
            onGoToAlerts={() => setTab("alerts")}
            editing={layoutEditing}
            debtThresholds={thresholdsCfg.effective}
            thresholdsConfig={thresholdsCfg.config}
          />
        </PageTabContent>

        <PageTabContent value="analytics">
          <AnalyticsTab
            revenue={overview.data.revenue}
            prevRevenue={analytics.prevRevenue}
            onOpenParent={openParent}
            academicYear={yearRange.academicYear}
            prevAcademicYear={analytics.prevAcademicYear}
            debtAging={overview.data.debtAging}
            topDebtors={overview.topDebtors}
            debtSummaries={overview.debtSummaries}
            payments={overview.payments}
            installments={overview.installments}
            range={yearRange.range}
            editing={layoutEditing}
            debtThresholds={thresholdsCfg.effective}
            thresholdsConfig={thresholdsCfg.config}
          />
        </PageTabContent>

        <PageTabContent value="alerts">
          <AlertsTab />
        </PageTabContent>

        <PageTabContent value="reports">
          <ReportsTab />
        </PageTabContent>
      </PageTabs>

      <SeeDetailsModal
        open={seeDetailsOpen}
        onOpenChange={setSeeDetailsOpen}
        initialTab={seeDetailsTab}
        data={overview.data}
        payments={overview.rangePayments}
      />

      {/* T-507 (UI-338): the ONE contextual thresholds editor for the page. */}
      {thresholdsCfg.modal}
    </div>
  );
}
