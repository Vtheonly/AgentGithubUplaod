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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../shared/ui/tabs";
import { Button } from "../../shared/ui/button";
import { Badge } from "../../shared/ui/badge";
import { ScrollArea } from "../../shared/ui/scroll-area";
import { SeeDetailsModal } from "./see-details-modal";

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

      <Tabs defaultValue="overview" className="flex-1 flex flex-col px-6 pb-6 min-h-0">
        <TabsList>
          <TabsTrigger value="overview">{t("dashboard.overview")}</TabsTrigger>
          <TabsTrigger
            value="alerts"
            count={notifications.filter((n) => !n.readAt).length}
            countTone="danger"
          >
            {t("dashboard.alerts")}
          </TabsTrigger>
          <TabsTrigger value="reports">{t("dashboard.reports")}</TabsTrigger>
          <TabsTrigger value="analytics">{t("dashboard.analytics")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex-1 overflow-y-auto mt-4">
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
        </TabsContent>

        <TabsContent value="alerts" className="flex-1 overflow-y-auto mt-4">
          <AlertsTab />
        </TabsContent>

        <TabsContent value="reports" className="flex-1 overflow-y-auto mt-4">
          <ReportsTab />
        </TabsContent>

        <TabsContent value="analytics" className="flex-1 overflow-y-auto mt-4">
          <AnalyticsTab
            revenue={revenue}
            debtAging={debtAging}
            demographics={demographics}
            onSeeDetails={() => setSeeDetailsOpen(true)}
          />
        </TabsContent>
      </Tabs>

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
// Reports tab — catalog
// ============================================================
function ReportsTab() {
  const reports = [
    { code: "revenu-mensuel", title: "Revenu mensuel", desc: "Excel multi-feuilles: encaissements par méthode, ventilation par service." },
    { code: "creances-agees", title: "Créances par tranche d'âge", desc: "CSV / XLSX: famille, élève, montant, tranche 0-30/31-60/61-90+." },
    { code: "effectifs-niveau", title: "Effectifs par niveau", desc: "XLSX: répartition Primaire / CEM / Lycée, classe par classe." },
    { code: "releve-enseignant", title: "Relevé enseignant", desc: "PDF: notes saisies, devoirs diffusés, appels effectués, heures." },
    { code: "journal-audit", title: "Journal d'audit", desc: "CSV / XLSX: filtrable par acteur, action, entité, plage de dates." },
    { code: "paiements-jour", title: "Paiements du jour", desc: "PDF: encaissements de la journée par agent comptable." },
    { code: "depenses-categorie", title: "Dépenses par catégorie", desc: "XLSX: agrégat mensuel par catégorie contrôlée." },
    { code: "annuaire-personnel", title: "Annuaire du personnel", desc: "XLSX: nom, catégorie, contact, statut." },
    { code: "releve-notes", title: "Relevé de notes", desc: "PDF: par classe et par matière, T1/T2/T3." },
    { code: "bulletins-trimestriels", title: "Bulletins trimestriels", desc: "PDF: par élève, avec moyennes et narratif (validation enseignant requise)." },
  ];

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {reports.map((r) => (
        <Card key={r.code} className="hover:border-primary/50 transition-colors">
          <CardContent className="flex items-start justify-between p-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">{r.title}</p>
              <p className="text-xs text-muted-foreground">{r.desc}</p>
            </div>
            <Button variant="ghost" size="icon" title="Bientôt disponible" disabled>
              <Download className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      ))}
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
