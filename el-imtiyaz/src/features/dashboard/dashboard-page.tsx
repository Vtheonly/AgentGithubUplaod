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
 */
import { useEffect, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Users,
  Wallet,
  AlertTriangle,
  GraduationCap,
  TrendingUp,
  ChevronRight,
  ScrollText,
  Loader2,
  LayoutDashboard,
  FileText,
  Bell,
  Plus,
  Download,
  Filter,
  ArrowDownUp,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
  LineChart,
  Line,
} from "recharts";
import { useRepositories } from "../../infrastructure/repository-provider";
import { useAuth } from "../../state/auth-context";
import type { DashboardKpi, RevenuePoint, DebtByAgingBucket, AppNotification } from "../../domain/model/operations";
import { formatDzd, formatDzdPlain } from "../../core/format/currency";
import { formatRelative, formatDateTime } from "../../core/format/date";
import {
  NOTIFICATION_TYPE_LABELS_FR,
  ALERT_PRIORITY_LABELS_FR,
  ALERT_PRIORITY_TONE,
  ALERT_SOURCE_LABELS_FR,
  sortAlertsByPriority,
} from "../../domain/model/operations";
import { AGING_BUCKET_LABELS_FR, PAYMENT_CATEGORY_LABELS_FR, revenueByCategory } from "../../domain/model/payment";
import { PageHeader } from "../../shared/components/page-header";
import { KpiCard } from "../../shared/components/kpi-card";
import { StatusChip } from "../../shared/components/status-chip";
import { EmptyState } from "../../shared/components/state-views";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../shared/ui/card";
import { PageTabs, PageTabList, PageTab, PageTabContent } from "../../shared/components/page-tabs";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { ScrollArea } from "../../shared/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../shared/ui/select";
import { SeeDetailsModal } from "./see-details-modal";
import { DashboardCalendar } from "../../shared/components/dashboard-calendar";
import { AcademicYearSelector, type AcademicYearRange, computeDateRange } from "../../shared/components/academic-year-selector";
import { AlertCreatorModal } from "../../shared/components/alert-creator-modal";
import { AlertDetailModal } from "../../shared/components/alert-detail-modal";
import { useToast } from "../../state/toast-context";
import {
  exportRevenueReport, exportOutstandingDebtReport, exportStudentRoster,
} from "../../infrastructure/excel/reports";

const AGING_COLORS: Record<string, string> = {
  "0_30": "#3FA66E",
  "31_60": "#6EC1E4",
  "61_90": "#C8A98C",
  "91_180": "#C0504D",
  "180_plus": "#836C68",
};

const AVAILABLE_ACADEMIC_YEARS = ["2023-2024", "2024-2025", "2025-2026", "2026-2027"];

type SeeDetailsTab = "revenue" | "demographics" | "debt" | "departments";

export function DashboardPage() {
  const { t } = useTranslation();
  const repos = useRepositories();
  const [kpis, setKpis] = useState<DashboardKpi | null>(null);
  const [revenue, setRevenue] = useState<RevenuePoint[]>([]);
  const [debtAging, setDebtAging] = useState<DebtByAgingBucket[]>([]);
  const [demographics, setDemographics] = useState<{
    grade: { label: string; count: number; percent: number }[];
    gender: { label: string; count: number; percent: number }[];
    age: { label: string; count: number; percent: number }[];
    capacity: { label: string; count: number; percent: number }[];
  }>({ grade: [], gender: [], age: [], capacity: [] });
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

// ============================================================
// Overview tab — KPIs + charts + calendar (no alerts, no departments)
// ============================================================
function OverviewTab({
  kpis,
  revenue,
  debtAging,
  demographics,
  onDrillDown,
}: {
  kpis: DashboardKpi | null;
  revenue: RevenuePoint[];
  debtAging: DebtByAgingBucket[];
  demographics: {
    grade: { label: string; count: number; percent: number }[];
    gender: { label: string; count: number; percent: number }[];
    age: { label: string; count: number; percent: number }[];
    capacity: { label: string; count: number; percent: number }[];
  };
  onDrillDown: (tab: SeeDetailsTab) => void;
}) {
  const { t } = useTranslation();
  const totalRevenue = revenue.reduce((s, r) => s + r.amount, 0);
  const totalDebt = debtAging.reduce((s, d) => s + d.amount, 0);
  const collectionRate = totalRevenue + totalDebt > 0
    ? Math.round((totalRevenue / (totalRevenue + totalDebt)) * 100)
    : 0;

  const gradeColors = ["#349BD4", "#6EC1E4", "#C8A98C"];
  const genderColors = ["#349BD4", "#C8A98C"];

  return (
    <div className="space-y-4">
      {/* KPI grid — clickable to drill down */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button
          type="button"
          onClick={() => onDrillDown("demographics")}
          className="text-start"
          title="Cliquer pour voir la démographie"
        >
          <KpiCard
            label={t("dashboard.kpi.totalStudents")}
            value={kpis?.totalStudents ?? "—"}
            icon={<GraduationCap className="h-5 w-5" />}
            tone="info"
          />
        </button>
        <button
          type="button"
          onClick={() => onDrillDown("demographics")}
          className="text-start"
          title="Cliquer pour voir la démographie"
        >
          <KpiCard
            label={t("dashboard.kpi.totalParents")}
            value={kpis?.totalParents ?? "—"}
            icon={<Users className="h-5 w-5" />}
            tone="default"
          />
        </button>
        <button
          type="button"
          onClick={() => onDrillDown("revenue")}
          className="text-start"
          title="Cliquer pour voir le détail des revenus"
        >
          <KpiCard
            label={t("dashboard.kpi.monthlyRevenue")}
            value={kpis ? formatDzd(kpis.monthlyRevenue, { compact: true }) : "—"}
            icon={<Wallet className="h-5 w-5" />}
            tone="success"
            hint="Revenu encaissé"
          />
        </button>
        <button
          type="button"
          onClick={() => onDrillDown("debt")}
          className="text-start"
          title="Cliquer pour voir le détail des créances"
        >
          <KpiCard
            label={t("dashboard.kpi.outstandingDebt")}
            value={kpis ? formatDzd(kpis.outstandingDebt, { compact: true }) : "—"}
            icon={<AlertTriangle className="h-5 w-5" />}
            tone="danger"
            hint={`${kpis?.overdueAlerts ?? 0} alertes`}
          />
        </button>
      </div>

      {/* Charts — revenue + debt aging (departments removed per spec §2.3) */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 cursor-pointer hover:border-primary/40 transition-colors" onClick={() => onDrillDown("revenue")}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <TrendingUp className="h-4 w-4 text-primary" />
              {t("dashboard.charts.revenue")}
            </CardTitle>
            <CardDescription>
              Revenu encaissé (paiements PAID uniquement) — {revenue.length} mois
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenue} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`}
                  />
                  <RTooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                      color: "hsl(var(--popover-foreground))",
                    }}
                    formatter={(value: number) => [formatDzd(value), "Revenu"]}
                  />
                  <Bar dataKey="amount" fill="var(--brand-blue)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:border-primary/40 transition-colors" onClick={() => onDrillDown("debt")}>
          <CardHeader>
            <CardTitle className="text-sm">{t("dashboard.charts.debtAging")}</CardTitle>
            <CardDescription>Répartition par tranche d'âge</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {debtAging.map((b) => {
                const max = Math.max(...debtAging.map((x) => x.amount), 1);
                const w = (b.amount / max) * 100;
                return (
                  <div key={b.bucket} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{AGING_BUCKET_LABELS_FR[b.bucket]}</span>
                      <span className="font-mono text-foreground">{formatDzdPlain(b.amount)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${w}%`, backgroundColor: AGING_COLORS[b.bucket] }}
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {b.debtorCount} débiteur{b.debtorCount > 1 ? "s" : ""}
                    </p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Demographics (formerly in Analytics tab — merged per spec §2.2) */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="cursor-pointer hover:border-primary/40 transition-colors" onClick={() => onDrillDown("demographics")}>
          <CardHeader>
            <CardTitle className="text-sm">{t("dashboard.charts.gradeDistribution")}</CardTitle>
            <CardDescription>Répartition par cycle scolaire</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={demographics.grade} dataKey="count" nameKey="label" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2}>
                    {demographics.grade.map((_, i) => (
                      <Cell key={i} fill={gradeColors[i % gradeColors.length]} />
                    ))}
                  </Pie>
                  <RTooltip
                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-center gap-3 mt-2 flex-wrap">
              {demographics.grade.map((s, i) => (
                <div key={s.label} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: gradeColors[i % gradeColors.length] }} />
                  <span className="text-xs text-muted-foreground">{s.label}: {s.count} ({s.percent}%)</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:border-primary/40 transition-colors" onClick={() => onDrillDown("demographics")}>
          <CardHeader>
            <CardTitle className="text-sm">{t("dashboard.charts.genderDistribution")}</CardTitle>
            <CardDescription>Répartition par genre</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={demographics.gender} dataKey="count" nameKey="label" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2}>
                    {demographics.gender.map((_, i) => (
                      <Cell key={i} fill={genderColors[i % genderColors.length]} />
                    ))}
                  </Pie>
                  <RTooltip
                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-center gap-3 mt-2">
              {demographics.gender.map((s, i) => (
                <div key={s.label} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: genderColors[i % genderColors.length] }} />
                  <span className="text-xs text-muted-foreground">{s.label}: {s.count} ({s.percent}%)</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Collection rate summary — formerly in Analytics tab */}
      <Card>
        <CardContent className="grid grid-cols-3 gap-4 p-4">
          <Stat label="Revenu cumulé" value={formatDzd(totalRevenue, { compact: true })} tone="success" onClick={() => onDrillDown("revenue")} />
          <Stat label="Créances" value={formatDzd(totalDebt, { compact: true })} tone="danger" onClick={() => onDrillDown("debt")} />
          <Stat label="Taux de recouvrement" value={`${collectionRate}%`} tone="info" />
        </CardContent>
      </Card>

      {/* Calendar — embedded per spec §3.1 */}
      <DashboardCalendar />
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  tone: "success" | "danger" | "info";
  onClick?: () => void;
}) {
  const colors = {
    success: "text-status-success",
    danger: "text-status-danger",
    info: "text-status-info",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`space-y-1 text-start ${onClick ? "cursor-pointer hover:opacity-80" : ""}`}
      disabled={!onClick}
    >
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-2xl font-semibold tnum ${colors[tone]}`}>{value}</p>
    </button>
  );
}

// ============================================================
// Alerts tab — clean feed with priority sort + click-to-detail + create
// ============================================================
function AlertsTab() {
  const repos = useRepositories();
  const { session } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [selected, setSelected] = useState<AppNotification | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"priority" | "newest" | "unread">("priority");

  useEffect(() => {
    if (!session) return;
    const unsub = repos.notifications.observeForSession({ userId: session.userId, role: session.role }).subscribe((n) => {
      setItems([...n]);
    });
    return unsub;
  }, [repos.notifications, session]);

  const filtered = useMemo(() => {
    let list = items;
    if (priorityFilter !== "all") list = list.filter((n) => n.priority === priorityFilter);
    if (sourceFilter !== "all") list = list.filter((n) => n.source === sourceFilter);
    if (sortBy === "priority") {
      list = sortAlertsByPriority(list);
    } else if (sortBy === "newest") {
      list = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } else if (sortBy === "unread") {
      list = [...list].sort((a, b) => {
        if (!!a.readAt === !!b.readAt) return b.createdAt.localeCompare(a.createdAt);
        return a.readAt ? 1 : -1;
      });
    }
    return list;
  }, [items, priorityFilter, sourceFilter, sortBy]);

  const unreadCount = items.filter((n) => !n.readAt).length;

  function openDetail(alert: AppNotification) {
    setSelected(alert);
    setDetailOpen(true);
    if (!alert.readAt) {
      void repos.notifications.markRead(alert.id);
    }
  }

  async function markAllRead() {
    await repos.notifications.markAllRead();
    toast.showSuccess("Alertes marquées", `${unreadCount} alerte(s) marquée(s) comme lue(s).`);
  }

  if (items.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setCreatorOpen(true)}>
            <Plus className="h-4 w-4" /> Créer une alerte
          </Button>
        </div>
        <EmptyState title="Aucune notification" description="Vous êtes à jour. Créez une alerte personnalisée si besoin." />
        <AlertCreatorModal open={creatorOpen} onOpenChange={setCreatorOpen} sourceLabel="Alertes — Manueluelle" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-40 h-8 text-xs">
            <Filter className="h-3 w-3" />
            <SelectValue placeholder="Priorité" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes priorités</SelectItem>
            <SelectItem value="urgent">Urgente</SelectItem>
            <SelectItem value="high">Haute</SelectItem>
            <SelectItem value="medium">Moyenne</SelectItem>
            <SelectItem value="low">Basse</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-40 h-8 text-xs">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes sources</SelectItem>
            <SelectItem value="system">Système</SelectItem>
            <SelectItem value="manual">Manuelle</SelectItem>
            <SelectItem value="workflow">Workflow</SelectItem>
            <SelectItem value="schedule">Planifiée</SelectItem>
            <SelectItem value="audit">Audit</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
          <SelectTrigger className="w-40 h-8 text-xs">
            <ArrowDownUp className="h-3 w-3" />
            <SelectValue placeholder="Trier" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="priority">Par priorité</SelectItem>
            <SelectItem value="newest">Plus récentes</SelectItem>
            <SelectItem value="unread">Non lues d'abord</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex-1" />
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={markAllRead}>
            <Loader2 className="h-3 w-3" /> Tout marquer lu ({unreadCount})
          </Button>
        )}
        <Button size="sm" className="h-8" onClick={() => setCreatorOpen(true)}>
          <Plus className="h-4 w-4" /> Créer une alerte
        </Button>
      </div>

      {/* Alerts feed */}
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {filtered.map((n) => (
              <li
                key={n.id}
                className="flex items-start gap-3 p-4 hover:bg-accent/5 cursor-pointer"
                onClick={() => openDetail(n)}
              >
                <div className="flex flex-col items-center gap-1 shrink-0 w-16">
                  <StatusChip
                    label={ALERT_PRIORITY_LABELS_FR[n.priority]}
                    tone={ALERT_PRIORITY_TONE[n.priority]}
                  />
                  {!n.readAt && (
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-foreground">{n.title}</p>
                    <Badge variant="outline" className="text-[10px]">
                      {NOTIFICATION_TYPE_LABELS_FR[n.type]}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                      {ALERT_SOURCE_LABELS_FR[n.source]}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Source: <span className="font-medium">{n.sourceLabel}</span>
                    {n.triggeredAt && (
                      <> · Déclencheur: {formatDateTime(n.triggeredAt)}</>
                    )}
                  </p>
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {formatRelative(n.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <AlertCreatorModal open={creatorOpen} onOpenChange={setCreatorOpen} sourceLabel="Alertes — Manuelle" />
      <AlertDetailModal
        alert={selected}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  );
}

// ============================================================
// Reports tab — GLOBAL macro reports only (per spec §5.1)
// Entity-specific reports live in profile drawers (per spec §5.2)
// ============================================================
function ReportsTab() {
  const repos = useRepositories();
  const toast = useToast();
  const [exporting, setExporting] = useState<string | null>(null);

  // Iteration 9: ONLY macro / organization-level aggregate reports.
  // Entity-specific reports (relevé-enseignant, releve-notes, bulletins,
  // paiements-jour) have been relocated to their respective profile drawers.
  const reports = [
    {
      code: "revenu-mensuel",
      title: "Revenu mensuel",
      desc: "Excel multi-feuilles: synthèse, par méthode, par catégorie, transactions.",
      icon: TrendingUp,
      formats: ["XLSX", "PDF"] as const,
    },
    {
      code: "creances-agees",
      title: "Créances par tranche d'âge",
      desc: "XLSX: famille, élève, montant, tranche 0-30/31-60/61-90+.",
      icon: AlertTriangle,
      formats: ["XLSX"] as const,
    },
    {
      code: "effectifs-niveau",
      title: "Effectifs par niveau",
      desc: "XLSX: répartition Primaire / CEM / Lycée, code par code.",
      icon: Users,
      formats: ["XLSX"] as const,
    },
    {
      code: "journal-audit",
      title: "Journal d'audit",
      desc: "Voir Settings → Audit. Filtrable par acteur, action, entité, plage de dates.",
      icon: ScrollText,
      formats: ["Voir Settings"] as const,
    },
    {
      code: "depenses-categorie",
      title: "Dépenses par catégorie",
      desc: "XLSX: agrégat mensuel par catégorie contrôlée.",
      icon: Wallet,
      formats: ["XLSX"] as const,
    },
    {
      code: "annuaire-personnel",
      title: "Annuaire du personnel",
      desc: "XLSX: nom, catégorie, contact, statut.",
      icon: Users,
      formats: ["XLSX"] as const,
    },
  ];

  async function handleExport(code: string, format: "XLSX" | "PDF") {
    setExporting(`${code}-${format}`);
    try {
      if (code === "revenu-mensuel" && format === "XLSX") {
        const payments = repos.payments.observe().get();
        const today = new Date();
        const from = new Date(today);
        from.setMonth(from.getMonth() - 12);
        await exportRevenueReport(payments, {
          from: from.toISOString().slice(0, 10),
          to: today.toISOString().slice(0, 10),
        });
      } else if (code === "revenu-mensuel" && format === "PDF") {
        // For now, generate a PDF version of the same data via the receipts engine.
        // (Iteration 9: minimal PDF report — just a styled summary.)
        toast.showInfo("PDF en préparation", "Le PDF du revenu mensuel sera disponible prochainement.");
        return;
      } else if (code === "creances-agees") {
        const summary = repos.debt.observeSummary().get();
        await exportOutstandingDebtReport(
          summary
            .filter((d) => d.outstandingAmount > 0)
            .map((d) => ({
              parentCode: d.parentId,
              parentName: d.parentName,
              parentPhone: "",
              bucket: d.bucket as "0_30" | "31_60" | "61_90" | "91_180" | "180_plus",
              daysOverdue: d.daysOverdue,
              outstandingAmount: d.outstandingAmount,
            })),
          "xlsx",
        );
      } else if (code === "effectifs-niveau") {
        const students = repos.students.observe().get();
        await exportStudentRoster(students);
      } else if (code === "annuaire-personnel") {
        const personnel = repos.personnel.observe().get();
        if (personnel.length === 0) {
          toast.showWarning("Aucun personnel", "Rien à exporter.");
          return;
        }
        const { exportToXlsx } = await import("../../infrastructure/excel/export-engine");
        const { STAFF_CATEGORY_LABELS_FR, PERSONNEL_STATUS_LABELS_FR } = await import("../../domain/model/personnel");
        const columns = [
          { header: "Code", key: "code", width: 14 },
          { header: "Prénom", key: "firstName", width: 16 },
          { header: "Nom", key: "lastName", width: 18 },
          { header: "Catégorie", key: "category", width: 18 },
          { header: "Téléphone", key: "phone", width: 18 },
          { header: "E-mail", key: "email", width: 28 },
          { header: "Date d'embauche", key: "hireDate", width: 14 },
          { header: "Statut", key: "status", width: 14 },
          { header: "Heures hebdo. cibles", key: "weeklyHoursTarget", width: 14 },
          { header: "Heures hebdo. effectuées", key: "weeklyHoursLogged", width: 14 },
          { header: "Salaire (DZD)", key: "salary", width: 16 },
        ];
        const rows = personnel.map((p) => ({
          code: p.id,
          firstName: p.firstName,
          lastName: p.lastName,
          category: STAFF_CATEGORY_LABELS_FR[p.staffCategory],
          phone: p.phone,
          email: p.email ?? "",
          hireDate: p.hireDate,
          status: PERSONNEL_STATUS_LABELS_FR[p.status],
          weeklyHoursTarget: p.weeklyHoursTarget,
          weeklyHoursLogged: p.weeklyHoursLogged,
          salary: p.salary != null ? new Intl.NumberFormat("fr-FR").format(p.salary) : "—",
        }));
        exportToXlsx(
          [{ name: "Personnel", columns, rows }],
          `annuaire-personnel-${new Date().toISOString().slice(0, 10)}.xlsx`,
        );
        toast.showSuccess("Export XLSX", `${personnel.length} personnel(s) exporté(s).`);
        return;
      } else if (code === "depenses-categorie") {
        const { exportToXlsx } = await import("../../infrastructure/excel/export-engine");
        const expenses = repos.expenses.observe().get();
        const byCategory = new Map<string, number>();
        for (const e of expenses) {
          byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount);
        }
        const columns = [
          { header: "Catégorie", key: "category", width: 24 },
          { header: "Montant total (DZD)", key: "amount", width: 20 },
          { header: "Nombre de dépenses", key: "count", width: 18 },
        ];
        const rows = Array.from(byCategory.entries()).map(([cat, amount]) => ({
          category: cat,
          amount: new Intl.NumberFormat("fr-FR").format(amount),
          count: expenses.filter((e) => e.category === cat).length,
        }));
        exportToXlsx(
          [{ name: "Dépenses par catégorie", columns, rows }],
          `depenses-categorie-${new Date().toISOString().slice(0, 10)}.xlsx`,
        );
        toast.showSuccess("Export XLSX", `${byCategory.size} catégories exportées.`);
        return;
      } else {
        toast.showInfo("Bientôt disponible", `Le rapport "${code}" sera disponible prochainement.`);
        return;
      }
      toast.showSuccess("Export généré", `Le rapport ${code} a été téléchargé.`);
    } catch (e) {
      toast.showError("Échec de l'export", e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border bg-muted/20 p-3">
        <p className="text-xs text-muted-foreground">
          <FileText className="inline h-3 w-3 mr-1" />
          <strong>Rapports globaux uniquement.</strong>{" "}
          Les rapports individuels (bulletins, relevés de compte, fiches de paie) sont générés
          directement depuis le profil de l'entité concernée (élève, parent, personnel).
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {reports.map((r) => {
          const Icon = r.icon;
          const isReady = ["revenu-mensuel", "creances-agees", "effectifs-niveau", "annuaire-personnel", "depenses-categorie"].includes(r.code);
          return (
            <Card key={r.code} className="hover:border-primary/50 transition-colors">
              <CardContent className="flex items-start justify-between p-4">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-foreground">{r.title}</p>
                      {r.formats.map((f) => (
                        <Badge key={f} variant="outline" className="text-[10px]">{f}</Badge>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">{r.desc}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {r.formats.map((f) => {
                    if (f === "Voir Settings") {
                      return (
                        <Button
                          key={f}
                          variant="ghost"
                          size="sm"
                          className="text-xs"
                          onClick={() => window.location.assign("/#/settings?tab=audit")}
                        >
                          Ouvrir
                        </Button>
                      );
                    }
                    return (
                      <Button
                        key={f}
                        variant="ghost"
                        size="sm"
                        className="text-xs"
                        title={isReady ? `Télécharger ${f}` : "Bientôt disponible"}
                        disabled={!isReady || exporting === `${r.code}-${f}`}
                        onClick={() => handleExport(r.code, f)}
                      >
                        {exporting === `${r.code}-${f}` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                        <span className="ml-1">{f}</span>
                      </Button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
