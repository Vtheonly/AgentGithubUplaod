/**
 * Dashboard hub — Hub 1.
 *
 * Tabs: Overview / Alerts / Reports / Analytics.
 * KPIs come from DashboardRepository.kpis().
 * Charts (revenue / debt aging / demographics) render with Recharts.
 * The "See Details" modal (plan §15) overlays the dashboard with 4 sub-tabs.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Users,
  Wallet,
  AlertTriangle,
  GraduationCap,
  TrendingUp,
  Calendar,
  Download,
  ChevronRight,
  Receipt,
  ScrollText,
  Loader2,
  LayoutDashboard,
  FileText,
  BarChart3,
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
} from "recharts";
import { useRepositories } from "../../infrastructure/repository-provider";
import type { DashboardKpi, RevenuePoint, DebtByAgingBucket } from "../../domain/model/operations";
import { Ok } from "../../core/result/result";
import { formatDzd, formatDzdPlain } from "../../core/format/currency";
import { formatRelative } from "../../core/format/date";
import { NOTIFICATION_TYPE_LABELS_FR } from "../../domain/model/operations";
import { AGING_BUCKET_LABELS_FR } from "../../domain/model/payment";
import { PageHeader } from "../../shared/components/page-header";
import { KpiCard } from "../../shared/components/kpi-card";
import { StatusChip } from "../../shared/components/status-chip";
import { EmptyState } from "../../shared/components/state-views";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../shared/ui/card";
import { PageTabs, PageTabList, PageTab, PageTabContent } from "../../shared/components/page-tabs";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { ScrollArea } from "../../shared/ui/scroll-area";
import { SeeDetailsModal } from "./see-details-modal";
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

export function DashboardPage() {
  const { t } = useTranslation();
  const repos = useRepositories();
  const [kpis, setKpis] = useState<DashboardKpi | null>(null);
  const [revenue, setRevenue] = useState<RevenuePoint[]>([]);
  const [debtAging, setDebtAging] = useState<DebtByAgingBucket[]>([]);
  const [demographics, setDemographics] = useState<{ grade: { label: string; count: number; percent: number }[]; gender: { label: string; count: number; percent: number }[] }>({ grade: [], gender: [] });
  const [notifications, setNotifications] = useState<{ id: string; type: string; title: string; body: string; readAt: string | null; createdAt: string }[]>([]);
  const [seeDetailsOpen, setSeeDetailsOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      const [k, rev, debt, demo] = await Promise.all([
        repos.dashboard.kpis(),
        repos.dashboard.revenueLast12Months(),
        repos.dashboard.debtByAging(),
        repos.dashboard.demographics(),
      ]);
      if (k.ok) setKpis(k.value);
      if (rev.ok) setRevenue(rev.value);
      if (debt.ok) setDebtAging(debt.value);
      if (demo.ok) setDemographics(demo.value);
    })();
  }, [repos.dashboard]);

  useEffect(() => {
    const unsub = repos.notifications.observe().subscribe((items) => {
      setNotifications([...items].slice(0, 10));
    });
    return unsub;
  }, [repos.notifications]);

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={t("dashboard.title")}
        description="Vue d'ensemble de l'activité de l'établissement"
        actions={
          <>
            <Button variant="outline" size="sm">
              <Calendar className="h-4 w-4" /> Année 2025-2026
            </Button>
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4" /> {t("common.export")}
            </Button>
            <Button size="sm" onClick={() => setSeeDetailsOpen(true)}>
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
            icon={AlertTriangle}
            count={notifications.filter((n) => !n.readAt).length}
            countTone="danger"
          />
          <PageTab value="reports" label={t("dashboard.reports")} icon={FileText} />
          <PageTab value="analytics" label={t("dashboard.analytics")} icon={BarChart3} />
        </PageTabList>

        <PageTabContent value="overview">
          <div className="space-y-4">
            {/* KPI grid */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard
                label={t("dashboard.kpi.totalStudents")}
                value={kpis?.totalStudents ?? "—"}
                icon={<GraduationCap className="h-5 w-5" />}
                tone="info"
              />
              <KpiCard
                label={t("dashboard.kpi.totalParents")}
                value={kpis?.totalParents ?? "—"}
                icon={<Users className="h-5 w-5" />}
                tone="default"
              />
              <KpiCard
                label={t("dashboard.kpi.monthlyRevenue")}
                value={kpis ? formatDzd(kpis.monthlyRevenue, { compact: true }) : "—"}
                icon={<Wallet className="h-5 w-5" />}
                tone="success"
                hint="Cumul ce mois"
              />
              <KpiCard
                label={t("dashboard.kpi.outstandingDebt")}
                value={kpis ? formatDzd(kpis.outstandingDebt, { compact: true }) : "—"}
                icon={<AlertTriangle className="h-5 w-5" />}
                tone="danger"
                hint={`${kpis?.overdueAlerts ?? 0} alertes`}
              />
            </div>

            {/* Charts */}
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    {t("dashboard.charts.revenue")}
                  </CardTitle>
                  <CardDescription>Revenu encaissé (paiements PAID uniquement)</CardDescription>
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

              <Card>
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

            {/* Recent alerts */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t("dashboard.alerts")}</CardTitle>
                <CardDescription>Notifications récentes du système</CardDescription>
              </CardHeader>
              <CardContent>
                {notifications.length === 0 ? (
                  <EmptyState title="Aucune alerte" description="Le système n'a rien à signaler pour le moment." />
                ) : (
                  <ScrollArea className="h-[200px]">
                    <ul className="space-y-2">
                      {notifications.map((n) => (
                        <li
                          key={n.id}
                          className="flex items-start gap-3 rounded-md border border-border p-3"
                        >
                          <StatusChip
                            label={NOTIFICATION_TYPE_LABELS_FR[n.type as keyof typeof NOTIFICATION_TYPE_LABELS_FR] ?? n.type}
                            tone={notifTone(n.type)}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground">{n.title}</p>
                            <p className="text-xs text-muted-foreground line-clamp-2">{n.body}</p>
                          </div>
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {formatRelative(n.createdAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </div>
        </PageTabContent>

        <PageTabContent value="alerts">
          <AlertsTab />
        </PageTabContent>

        <PageTabContent value="reports">
          <ReportsTab />
        </PageTabContent>

        <PageTabContent value="analytics">
          <AnalyticsTab
            revenue={revenue}
            debtAging={debtAging}
            demographics={demographics}
            onSeeDetails={() => setSeeDetailsOpen(true)}
          />
        </PageTabContent>
      </PageTabs>

      <SeeDetailsModal open={seeDetailsOpen} onOpenChange={setSeeDetailsOpen} />
    </div>
  );
}

function notifTone(type: string): "success" | "warning" | "danger" | "info" | "neutral" {
  if (type === "payment_overdue") return "danger";
  if (type === "expense_pending") return "warning";
  if (type === "attendance_alert") return "warning";
  if (type === "homework") return "info";
  if (type === "system") return "neutral";
  if (type === "audit") return "info";
  return "neutral";
}

// ============================================================
// Alerts tab
// ============================================================
function AlertsTab() {
  const repos = useRepositories();
  const [items, setItems] = useState<{ id: string; type: string; title: string; body: string; readAt: string | null; createdAt: string; entityType: string | null; entityId: string | null }[]>([]);

  useEffect(() => {
    const unsub = repos.notifications.observe().subscribe((n) => setItems([...n]));
    return unsub;
  }, [repos.notifications]);

  if (items.length === 0) {
    return <EmptyState title="Aucune notification" description="Vous êtes à jour." />;
  }

  return (
    <Card>
      <CardContent className="p-0">
        <ul className="divide-y divide-border">
          {items.map((n) => (
            <li key={n.id} className="flex items-start gap-3 p-4">
              <StatusChip
                label={NOTIFICATION_TYPE_LABELS_FR[n.type as keyof typeof NOTIFICATION_TYPE_LABELS_FR] ?? n.type}
                tone={notifTone(n.type)}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{n.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{n.body}</p>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="text-[10px] text-muted-foreground">{formatRelative(n.createdAt)}</span>
                {!n.readAt && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => repos.notifications.markRead(n.id)}
                  >
                    Marquer lue
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ============================================================
// Reports tab — catalog with real exports
// ============================================================
function ReportsTab() {
  const repos = useRepositories();
  const toast = useToast();
  const [exporting, setExporting] = useState<string | null>(null);

  const reports = [
    {
      code: "revenu-mensuel",
      title: "Revenu mensuel",
      desc: "Excel multi-feuilles: synthèse, par méthode, par catégorie, transactions.",
      icon: TrendingUp,
      format: "XLSX" as const,
    },
    {
      code: "creances-agees",
      title: "Créances par tranche d'âge",
      desc: "CSV / XLSX: famille, élève, montant, tranche 0-30/31-60/61-90+.",
      icon: AlertTriangle,
      format: "XLSX" as const,
    },
    {
      code: "effectifs-niveau",
      title: "Effectifs par niveau",
      desc: "XLSX: répartition Primaire / CEM / Lycée, code par code.",
      icon: Users,
      format: "XLSX" as const,
    },
    {
      code: "releve-enseignant",
      title: "Relevé enseignant",
      desc: "PDF: notes saisies, devoirs diffusés, appels effectués, heures.",
      icon: GraduationCap,
      format: "PDF" as const,
    },
    {
      code: "journal-audit",
      title: "Journal d'audit",
      desc: "CSV / XLSX: filtrable par acteur, action, entité, plage de dates.",
      icon: ScrollText,
      format: "Voir Settings → Audit" as const,
    },
    {
      code: "paiements-jour",
      title: "Paiements du jour",
      desc: "PDF: encaissements de la journée par agent comptable.",
      icon: Wallet,
      format: "PDF" as const,
    },
    {
      code: "depenses-categorie",
      title: "Dépenses par catégorie",
      desc: "XLSX: agrégat mensuel par catégorie contrôlée.",
      icon: Receipt,
      format: "XLSX" as const,
    },
    {
      code: "annuaire-personnel",
      title: "Annuaire du personnel",
      desc: "XLSX: nom, catégorie, contact, statut.",
      icon: Users,
      format: "XLSX" as const,
    },
    {
      code: "releve-notes",
      title: "Relevé de notes",
      desc: "PDF: par classe et par matière, T1/T2/T3.",
      icon: GraduationCap,
      format: "PDF" as const,
    },
    {
      code: "bulletins-trimestriels",
      title: "Bulletins trimestriels",
      desc: "PDF: par élève, avec moyennes et narratif (validation enseignant requise).",
      icon: GraduationCap,
      format: "PDF" as const,
    },
  ];

  async function handleExport(code: string) {
    setExporting(code);
    try {
      if (code === "revenu-mensuel") {
        const paymentsResult = await repos.payments.observe();
        const payments = paymentsResult.get();
        const today = new Date();
        const from = new Date(today);
        from.setMonth(from.getMonth() - 12);
        await exportRevenueReport(payments, {
          from: from.toISOString().slice(0, 10),
          to: today.toISOString().slice(0, 10),
        });
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
        // Iteration 6: implement personnel export via the shared exportToXlsx helper.
        // Reuses the same export pattern as the PersonnelPage directory tab.
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
    <div className="grid gap-3 md:grid-cols-2">
      {reports.map((r) => {
        const Icon = r.icon;
        const isReady = ["revenu-mensuel", "creances-agees", "effectifs-niveau"].includes(r.code);
        return (
          <Card key={r.code} className="hover:border-primary/50 transition-colors">
            <CardContent className="flex items-start justify-between p-4">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="space-y-1 flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{r.title}</p>
                    <Badge variant="outline" className="text-[10px]">{r.format}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{r.desc}</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                title={isReady ? "Télécharger" : "Bientôt disponible"}
                disabled={!isReady || exporting === r.code}
                onClick={() => handleExport(r.code)}
              >
                {exporting === r.code ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ============================================================
// Analytics tab
// ============================================================
function AnalyticsTab({
  revenue,
  debtAging,
  demographics,
  onSeeDetails,
}: {
  revenue: RevenuePoint[];
  debtAging: DebtByAgingBucket[];
  demographics: { grade: { label: string; count: number; percent: number }[]; gender: { label: string; count: number; percent: number }[] };
  onSeeDetails: () => void;
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
      <Card>
        <CardContent className="grid grid-cols-3 gap-4 p-4">
          <Stat label="Revenu (12 mois)" value={formatDzd(totalRevenue, { compact: true })} tone="success" />
          <Stat label="Créances" value={formatDzd(totalDebt, { compact: true })} tone="danger" />
          <Stat label="Taux de recouvrement" value={`${collectionRate}%`} tone="info" />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("dashboard.charts.gradeDistribution")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={demographics.grade} dataKey="count" nameKey="label" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2}>
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
            <div className="flex justify-center gap-3 mt-2">
              {demographics.grade.map((s, i) => (
                <div key={s.label} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: gradeColors[i % gradeColors.length] }} />
                  <span className="text-xs text-muted-foreground">{s.label}: {s.count} ({s.percent}%)</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("dashboard.charts.genderDistribution")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={demographics.gender} dataKey="count" nameKey="label" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2}>
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

      <div className="flex justify-center">
        <Button variant="outline" onClick={onSeeDetails}>
          {t("dashboard.seeDetails")} <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "success" | "danger" | "info" }) {
  const colors = {
    success: "text-status-success",
    danger: "text-status-danger",
    info: "text-status-info",
  };
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-2xl font-semibold tnum ${colors[tone]}`}>{value}</p>
    </div>
  );
}

// Re-export Ok to satisfy unused import (kept for future use).
void Ok;
