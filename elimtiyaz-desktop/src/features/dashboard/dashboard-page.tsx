/**
 * Dashboard hub — Hub 1.
 *
 * Iteration 9 — completely rebuilt per the comprehensive requirements list:
 *
 *   1. Header cleanup: removed AI Drafting Assistant button, removed static
 *      Export button, replaced static "Année 2025-2026" with an interactive
 *      AcademicYearSelector that supports month/quarter/custom date ranges.
 *
 *   2. Tab merge: Analytics + Demographics are now embedded directly into
 *      the Overview tab (per spec §2.2). The Overview shows interactive,
 *      actionable deep-dive metrics — clicking any KPI or chart opens the
 *      SeeDetailsModal drill-down with the relevant sub-tab pre-selected.
 *
 *   3. Department streamlining: department financial breakdowns are no
 *      longer on the main overview. They live only inside the SeeDetails
 *      modal → Departments sub-tab (per spec §2.3).
 *
 *   4. Calendar integration: the new DashboardCalendar component is
 *      embedded directly in the Overview tab (per spec §3.1).
 *
 *   5. Alerts cleanup: the Overview tab no longer shows an alerts widget.
 *      Alerts live ONLY in the dedicated Alerts tab + Topbar bell (per
 *      spec §4.1). Clicking any alert (in Topbar or Alerts tab) opens the
 *      AlertDetailModal drawer with full context (per spec §4.2).
 *
 *   6. Reports restructuring: the global Reports tab now contains ONLY
 *      macro / organization-level aggregate reports (per spec §5.1).
 *      Entity-specific reports (bulletins, relevés, fiches de paie) live
 *      in their respective profile drawers (per spec §5.2).
 *
 * Tabs: Overview / Alerts / Reports.
 * (Analytics tab is gone — merged into Overview per spec §2.2.)
 *
 * Task 2-a — the three sub-tab components (OverviewTab, AlertsTab,
 * ReportsTab) were extracted into `./tabs/` to keep this file a thin
 * orchestrator. Behavior is preserved exactly.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronRight,
  LayoutDashboard,
  FileText,
  Bell,
} from "lucide-react";
import { useRepositories } from "../../app/providers/repository-provider";
import type { DashboardKpi, RevenuePoint, DebtByAgingBucket } from "../../domain/model/operations";
import { PageHeader } from "../../shared/layout/page-header";
import { PageTabs, PageTabList, PageTab, PageTabContent } from "../../shared/layout/page-tabs";
import { Button } from "../../shared/ui/button";
import { SeeDetailsModal } from "./see-details-modal";
import { AcademicYearSelector, type AcademicYearRange, computeDateRange } from "./academic-year-selector";
import { OverviewTab } from "./tabs/overview-tab";
import { AlertsTab } from "./tabs/alerts-tab";
import { ReportsTab } from "./tabs/reports-tab";
import {
  type SeeDetailsTab,
  type Demographics,
  AVAILABLE_ACADEMIC_YEARS,
} from "./tabs/types";

export function DashboardPage() {
  const { t } = useTranslation();
  const repos = useRepositories();
  const [kpis, setKpis] = useState<DashboardKpi | null>(null);
  const [revenue, setRevenue] = useState<RevenuePoint[]>([]);
  const [debtAging, setDebtAging] = useState<DebtByAgingBucket[]>([]);
  const [demographics, setDemographics] = useState<Demographics>({ grade: [], gender: [], age: [], capacity: [] });
  const [seeDetailsOpen, setSeeDetailsOpen] = useState(false);
  const [seeDetailsTab, setSeeDetailsTab] = useState<SeeDetailsTab>("revenue");

  // Iteration 9 — academic year + date range filter.
  const [yearRange, setYearRange] = useState<AcademicYearRange>(() => ({
    academicYear: "2025-2026",
    range: computeDateRange("2025-2026", "ytd"),
    preset: "ytd",
  }));

  // Reload dashboard data whenever the year/range changes.
  useEffect(() => {
    void (async () => {
      const [k, rev, debt, demo] = await Promise.all([
        repos.dashboard.kpisForRange(yearRange.academicYear, yearRange.range),
        repos.dashboard.revenueForRange(yearRange.academicYear, yearRange.range),
        repos.dashboard.debtByAgingForRange(yearRange.academicYear, yearRange.range),
        repos.dashboard.demographics(),
      ]);
      if (k.ok) setKpis(k.value);
      if (rev.ok) setRevenue(rev.value);
      if (debt.ok) setDebtAging(debt.value);
      if (demo.ok) setDemographics(demo.value);
    })();
  }, [repos.dashboard, yearRange]);

  // Iteration 9 — run the overdue alert generator once on mount so the
  // alerts tab + topbar bell are up-to-date without manual user action.
  useEffect(() => {
    void repos.overdueAlerts.run();
  }, [repos.overdueAlerts]);

  function openSeeDetails(tab: SeeDetailsTab = "revenue") {
    setSeeDetailsTab(tab);
    setSeeDetailsOpen(true);
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={t("dashboard.title")}
        description="Vue d'ensemble de l'activité de l'établissement"
        actions={
          <>
            {/* Iteration 9: replaced static "Année 2025-2026" button with interactive selector.
                Removed AI Drafting Assistant button + static Export button per spec §2.1. */}
            <AcademicYearSelector
              value={yearRange}
              onChange={setYearRange}
              availableYears={AVAILABLE_ACADEMIC_YEARS}
            />
            <Button size="sm" onClick={() => openSeeDetails("revenue")}>
              {t("dashboard.seeDetails")} <ChevronRight className="h-4 w-4" />
            </Button>
          </>
        }
      />

      <PageTabs defaultValue="overview" className="flex-1 flex flex-col px-6 pb-6 min-h-0">
        <PageTabList>
          <PageTab value="overview" label={t("dashboard.overview")} icon={LayoutDashboard} />
          <PageTab
            value="alerts"
            label={t("dashboard.alerts")}
            icon={Bell}
          />
          <PageTab value="reports" label={t("dashboard.reports")} icon={FileText} />
          {/* Iteration 9: Analytics tab removed — merged into Overview per spec §2.2 */}
        </PageTabList>

        <PageTabContent value="overview">
          <OverviewTab
            kpis={kpis}
            revenue={revenue}
            debtAging={debtAging}
            demographics={demographics}
            onDrillDown={openSeeDetails}
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
      />
    </div>
  );
}
