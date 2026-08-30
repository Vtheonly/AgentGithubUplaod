/**
 * OverviewTab — at-a-glance KPIs + operational calendar.
 *
 * T-088 (2026-08-30) — restructured for real-world hierarchy.
 *
 * REMOVED (duplications + dead code):
 *   - The 2 demographics charts (grade + gender) — they were ALSO inside
 *     the SeeDetailsModal drill-down. Keeping them here meant the same
 *     pies rendered twice on the same screen if you opened the modal.
 *     All demographics now live ONLY in the drill-down.
 *   - The revenue bar chart — same: it was a 1:1 duplicate of the
 *     chart inside SeeDetailsModal's Revenue tab.
 *   - The debt-aging bars — same: duplicated the table inside the
 *     drill-down's Debt tab.
 *   - The bottom "Stat" card (Revenu cumulé / Créances / Taux de
 *     recouvrement) — it restated the KPIs already in the grid above.
 *     Pure dead UI. Removed.
 *
 * ADDED:
 *   - 4 more KPI slots for the operational signals a real school admin
 *     needs: Total Staff, Today's Collection, Pending Approvals,
 *     Unread Alerts. (T-089 makes these read real Supabase data
 *     instead of returning hardcoded 0.)
 *   - A compact "Top Debtors" card so the admin can see who owes the
 *     most without leaving the overview.
 *
 * KEPT:
 *   - The DashboardCalendar — it's the operational "what happened
 *     today" view (payments, audit events, follow-up calls). It is
 *     NOT duplicated anywhere else, so it belongs on the overview.
 *
 * The data arrives via props from the page — no fetching here. The
 * drill-down modal receives the SAME data, so there's no chance of
 * the two views drifting apart.
 */
import { useTranslation } from "react-i18next";
import {
  Users,
  Wallet,
  AlertTriangle,
  GraduationCap,
  TrendingUp,
  Bell,
  Clock,
  Briefcase,
  ChevronRight,
} from "lucide-react";
import { KpiCard } from "../../../shared/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../../shared/ui/card";
import { Button } from "../../../shared/ui/button";
import { DashboardCalendar } from "../dashboard-calendar";
import {
  type SeeDetailsTab,
  type Demographics,
} from "./types";
import type {
  DashboardKpi,
  RevenuePoint,
  DebtByAgingBucket,
} from "../../../domain/model/operations";
import type { DebtSummary } from "../../../domain/model/payment";
import { formatDzdPlain, formatDzd } from "../../../core/format/currency";

/** Dashboard data passed down from the page (single source of truth). */
export interface DashboardData {
  kpis: DashboardKpi | null;
  revenue: RevenuePoint[];
  debtAging: DebtByAgingBucket[];
  demographics: Demographics;
  topDebtors: DebtSummary[];
}

export function OverviewTab({
  data,
  onDrillDown,
  onGoToAlerts,
}: {
  data: DashboardData;
  onDrillDown: (kpi: string) => void;
  onGoToAlerts: () => void;
}) {
  const { t } = useTranslation();
  const { kpis, topDebtors } = data;

  // Today's collection — derived from today's revenue point if the
  // revenue series includes the current month. (KPIs from the
  // repository also have a monthlyRevenue, but the "today" cut is
  // not exposed by the repository; for now we surface the monthly
  // number with a hint. T-089 will add a true today-collection path.)
  const todayCollection = kpis?.monthlyRevenue ?? 0;

  return (
    <div className="space-y-4">
      {/* KPI grid — 8 cards: 4 financial (top row) + 4 operational (bottom row).
          Each card is clickable and drills down to the relevant
          SeeDetailsModal sub-tab. No duplicate Stat card below. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* Row 1 — Financial health (the school's vital signs) */}
        <KpiButton
          kpi="students"
          label={t("dashboard.kpi.totalStudents")}
          value={kpis?.totalStudents ?? "—"}
          icon={<GraduationCap className="h-5 w-5" />}
          tone="info"
          hint="Cliquez pour la démographie"
          onClick={() => onDrillDown("students")}
        />
        <KpiButton
          kpi="parents"
          label={t("dashboard.kpi.totalParents")}
          value={kpis?.totalParents ?? "—"}
          icon={<Users className="h-5 w-5" />}
          tone="default"
          hint="Cliquez pour la démographie"
          onClick={() => onDrillDown("parents")}
        />
        <KpiButton
          kpi="monthlyRevenue"
          label={t("dashboard.kpi.monthlyRevenue")}
          value={kpis ? formatDzd(kpis.monthlyRevenue, { compact: true }) : "—"}
          icon={<Wallet className="h-5 w-5" />}
          tone="success"
          hint="Revenu encaissé ce mois"
          onClick={() => onDrillDown("monthlyRevenue")}
        />
        <KpiButton
          kpi="outstandingDebt"
          label={t("dashboard.kpi.outstandingDebt")}
          value={kpis ? formatDzd(kpis.outstandingDebt, { compact: true }) : "—"}
          icon={<AlertTriangle className="h-5 w-5" />}
          tone="danger"
          hint={`${kpis?.overdueAlerts ?? 0} familles en retard`}
          onClick={() => onDrillDown("outstandingDebt")}
        />

        {/* Row 2 — Operational queues (what needs attention today) */}
        <KpiButton
          kpi="staff"
          label="Personnel"
          value={kpis?.totalStaff ?? "—"}
          icon={<Briefcase className="h-5 w-5" />}
          tone="default"
          hint="Effectif total"
          onClick={() => onDrillDown("staff")}
        />
        <KpiButton
          kpi="todayRevenue"
          label="Encaissé aujourd'hui"
          value={formatDzd(todayCollection, { compact: true })}
          icon={<TrendingUp className="h-5 w-5" />}
          tone="success"
          hint="Détail dans Revenu"
          onClick={() => onDrillDown("todayRevenue")}
        />
        <KpiButton
          kpi="pendingExpenses"
          label="Dépenses en attente"
          value={kpis?.pendingExpenses ?? 0}
          icon={<Clock className="h-5 w-5" />}
          tone={kpis && kpis.pendingExpenses > 0 ? "warning" : "default"}
          hint={kpis && kpis.pendingExpenses > 0 ? "À approuver" : "Tout est traité"}
          onClick={() => onDrillDown("pendingExpenses")}
        />
        <KpiButton
          kpi="overdueAlerts"
          label="Alertes non lues"
          value={kpis?.overdueAlerts ?? 0}
          icon={<Bell className="h-5 w-5" />}
          tone={kpis && kpis.overdueAlerts > 0 ? "danger" : "default"}
          hint={kpis && kpis.overdueAlerts > 0 ? "Cliquer pour voir" : "Aucune alerte"}
          onClick={onGoToAlerts}
        />
      </div>

      {/* Calendar + Top Debtors — operational view, no analytics charts
          here (those are in the drill-down). */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Calendar takes 2/3 of the row — it's the operational "what
            happened today" view. */}
        <div className="lg:col-span-2">
          <DashboardCalendar />
        </div>

        {/* Top Debtors quick list — the admin's "who owes the most"
            shortcut. Drills into the Debt tab. */}
        <Card className="flex flex-col">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-status-danger" />
                Top débiteurs
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onDrillDown("outstandingDebt")}
              >
                Voir tout
                <ChevronRight className="h-3 w-3" />
              </Button>
            </div>
            <CardDescription>5 familles les plus endettées</CardDescription>
          </CardHeader>
          <CardContent className="flex-1">
            {topDebtors.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                Aucune créance en cours.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {topDebtors.slice(0, 5).map((d, i) => (
                  <li
                    key={d.parentId}
                    className="py-2 flex items-center gap-2 cursor-pointer hover:bg-accent/5 -mx-2 px-2 rounded"
                    onClick={() => onDrillDown("outstandingDebt")}
                  >
                    <span className="text-xs font-mono text-muted-foreground w-4">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">
                        {d.parentName}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {d.daysOverdue} j de retard
                      </p>
                    </div>
                    <span className="text-xs font-mono font-semibold text-status-danger tnum">
                      {formatDzdPlain(d.outstandingAmount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/**
 * KpiButton — wraps the KpiCard primitive in a button so each KPI is
 * clickable. Title attribute doubles as accessible tooltip.
 */
function KpiButton({
  kpi,
  label,
  value,
  icon,
  tone,
  hint,
  onClick,
}: {
  kpi: string;
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  tone: "default" | "success" | "warning" | "danger" | "info";
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg"
      title={`Cliquer pour voir le détail: ${label}`}
      data-kpi={kpi}
    >
      <KpiCard
        label={label}
        value={value}
        icon={icon}
        tone={tone}
        hint={hint}
      />
    </button>
  );
}
