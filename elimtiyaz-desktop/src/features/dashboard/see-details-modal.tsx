// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/see-details-modal.tsx
// ============================================================================

import { useTranslation } from "react-i18next";
import { useMemo } from "react";
import {
  AlertCircle,
  BarChart3,
  Building2,
  TrendingUp,
  Users,
  GraduationCap,
  Bus,
  Stethoscope,
  Trophy,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  ComposedChart,
  Line,
} from "recharts";
import type {
  DashboardKpi,
  RevenuePoint,
  DebtByAgingBucket,
} from "../../domain/model/operations";
import type { Payment } from "../../domain/model/payment";
import { formatDzd, formatDzdPlain } from "../../core/format/currency";
import {
  AGING_BUCKET_LABELS_FR,
  paymentCategoryLabelFr,
  PAYMENT_CATEGORY_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
  PAYMENT_METHOD_LABELS_FR,
  type PaymentCategory,
  type DebtSummary,
  type AgingBucket,
} from "../../domain/model/payment";
import { UnifiedModal } from "../../shared/ui/unified-modal";
import { Badge } from "../../shared/ui/badge";
import { StatusChip } from "../../shared/ui/status-chip";
import {
  PageTabs,
  PageTabList,
  PageTab,
  PageTabContent,
} from "../../shared/layout/page-tabs";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../shared/ui/card";
import { DASHBOARD_THEME, chartPalette } from "../../shared/ui/dashboard-theme";
import type { Demographics } from "./tabs/types";

const OPERATIONAL_UNITS: readonly {
  key: string;
  label: string;
  categories: readonly PaymentCategory[];
  color: string;
  icon: typeof GraduationCap;
}[] = [
  {
    key: "scolarite",
    label: "Scolarité & Pédagogie",
    categories: ["tuition", "books", "uniform", "second_apron"],
    color: "#349bd4",
    icon: GraduationCap,
  },
  {
    key: "therapy",
    label: "Accompagnement & Thérapie",
    categories: ["therapy_psychology", "therapy_speech"],
    color: "#eab308",
    icon: Stethoscope,
  },
  {
    key: "clubs",
    label: "Activités & Clubs",
    categories: ["extracurricular"],
    color: "#f43f5e",
    icon: Trophy,
  },
  {
    key: "auxiliary",
    label: "Services de Vie Scolaire",
    categories: ["transport", "canteen"],
    color: "#10b981",
    icon: Bus,
  },
];

const TRANCHE_PROJECTION_MONTHS: ReadonlyArray<{
  label: string;
  share: number;
}> = [
  { label: "Sep", share: 0.4 },
  { label: "Déc", share: 0.3 },
  { label: "Mar", share: 0.3 },
];

export function deriveTrancheProjection(
  revenue: readonly RevenuePoint[],
  totalExpected: number,
): Array<{ label: string; amount: number; targetProjection: number }> {
  return revenue.map((r) => {
    const rule = TRANCHE_PROJECTION_MONTHS.find((m) => m.label === r.label);
    return {
      label: r.label,
      amount: r.amount,
      targetProjection: rule ? Math.round(totalExpected * rule.share) : 0,
    };
  });
}

function agingSeverity(bucket: AgingBucket): {
  label: string;
  className: string;
} {
  if (bucket === "0_30") {
    return {
      label: "Courant",
      className: "bg-status-success/15 text-status-success border-status-success/30",
    };
  }
  if (bucket === "31_60") {
    return {
      label: "À surveiller",
      className: "bg-status-warning/15 text-status-warning border-status-warning/30",
    };
  }
  return {
    label: "Critique",
    className: "bg-status-danger/15 text-status-danger border-status-danger/30",
  };
}

export interface DashboardData {
  kpis: DashboardKpi | null;
  revenue: RevenuePoint[];
  debtAging: DebtByAgingBucket[];
  demographics: Demographics;
  topDebtors: DebtSummary[];
}

function formatPaymentDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-DZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function MetricSummaryTile({
  label,
  value,
  subtext,
  tone = "default",
}: {
  label: string;
  value: string;
  subtext?: string;
  tone?: "default" | "success" | "danger" | "warning";
}) {
  const toneClasses = {
    default: "text-foreground",
    success: "text-status-success",
    danger: "text-status-danger",
    warning: "text-status-warning",
  };

  return (
    <div className="rounded-xl border border-border/70 bg-surface-elevated/40 p-3.5 space-y-1">
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block truncate">
        {label}
      </span>
      <p className={`text-xl font-mono font-bold ${toneClasses[tone]} tabular-nums truncate`}>
        {value}
      </p>
      {subtext && (
        <p className="text-[11px] text-muted-foreground truncate">{subtext}</p>
      )}
    </div>
  );
}

export function SeeDetailsModal({
  open,
  onOpenChange,
  initialTab = "revenue",
  data,
  payments = [],
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialTab?: "revenue" | "departments" | "demographics" | "debt";
  data: DashboardData;
  payments?: readonly Payment[];
}) {
  const { t } = useTranslation();

  const annualRevenue = useMemo(
    () => data.revenue.reduce((s, r) => s + r.amount, 0),
    [data.revenue],
  );
  const outstanding = data.kpis?.outstandingDebt ?? 0;
  const totalExpected = annualRevenue + outstanding;
  const collectionRate =
    totalExpected > 0 ? Math.round((annualRevenue / totalExpected) * 100) : 0;

  const projection = useMemo(
    () =>
      data.kpis
        ? deriveTrancheProjection(data.revenue, totalExpected)
        : data.revenue.map((r) => ({ ...r, targetProjection: 0 })),
    [data.revenue, data.kpis, totalExpected],
  );

  const genderTotal = useMemo(
    () => data.demographics.gender.reduce((s, g) => s + g.count, 0),
    [data.demographics.gender],
  );

  const recentPayments = useMemo(
    () =>
      [...payments]
        .sort(
          (a, b) =>
            new Date(b.collectedAt).getTime() -
            new Date(a.collectedAt).getTime(),
        )
        .slice(0, 15),
    [payments],
  );

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      size="2xl"
      variant="dialog"
      icon={BarChart3}
      iconTone="primary"
      title={t("dashboard.seeDetails")}
      description="Synthèse analytique globale — performances financières, effectifs et créances"
      hideFooter
    >
      <PageTabs defaultValue={initialTab} variant="elevated">
        <PageTabList className="mb-4">
          <PageTab
            value="revenue"
            label={t("dashboard.sections.revenue")}
            icon={TrendingUp}
          />
          <PageTab
            value="departments"
            label={t("dashboard.sections.departments")}
            icon={Building2}
          />
          <PageTab
            value="demographics"
            label={t("dashboard.sections.demographics")}
            icon={Users}
          />
          <PageTab
            value="debt"
            label={t("dashboard.sections.debt")}
            icon={AlertCircle}
          />
        </PageTabList>

        {/* ────────── TAB 1: REVENUS ────────── */}
        <PageTabContent value="revenue">
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MetricSummaryTile
                label="Encaissé Annuel"
                value={formatDzd(annualRevenue, { compact: true })}
                subtext={`${collectionRate}% du budget attendu`}
                tone="success"
              />
              <MetricSummaryTile
                label="Créances Restantes"
                value={formatDzd(outstanding, { compact: true })}
                subtext={`${data.debtAging.reduce((s, b) => s + b.debtorCount, 0)} familles concernées`}
                tone={outstanding > 0 ? "danger" : "default"}
              />
              <MetricSummaryTile
                label="Budget Engagé Global"
                value={formatDzd(totalExpected, { compact: true })}
                subtext="Total annuel consolidé"
              />
              <MetricSummaryTile
                label="Règlements Reçus"
                value={String(payments.length)}
                subtext="Reçus de caisse validés"
                tone="default"
              />
            </div>

            <Card className="border-border/70 bg-surface-panel shadow-sm">
              <CardHeader className="border-b border-border/50 px-4 py-3">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Échéancier Trimestriel Prévisionnel vs Réalisé (40% · 30% · 30%)
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Comparaison des encaissements par rapport aux jalons de rentrée
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4">
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={projection}
                      margin={{ top: 10, right: 10, bottom: 0, left: -10 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={DASHBOARD_THEME.gridStroke}
                        vertical={false}
                      />
                      <XAxis
                        dataKey="label"
                        {...DASHBOARD_THEME.axisTick}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        {...DASHBOARD_THEME.axisTick}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`}
                      />
                      <RTooltip
                        contentStyle={DASHBOARD_THEME.tooltipStyle}
                        formatter={(v: number, name: string) => [
                          `${formatDzdPlain(v)} DZD`,
                          name === "amount" ? "Encaissé" : "Jalon cible",
                        ]}
                      />
                      <Bar
                        dataKey="amount"
                        name="amount"
                        fill={chartPalette.primary}
                        radius={[4, 4, 0, 0]}
                        barSize={24}
                      />
                      {data.kpis && (
                        <Line
                          type="monotone"
                          dataKey="targetProjection"
                          name="targetProjection"
                          stroke={chartPalette.gold}
                          strokeWidth={2}
                          strokeDasharray="4 4"
                          dot={{ r: 3, fill: chartPalette.gold }}
                        />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/70 bg-surface-panel shadow-sm">
              <CardHeader className="border-b border-border/50 px-4 py-3 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Derniers Règlements Encaissés
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground">
                    Journal chronologique des encaissements enregistrés
                  </CardDescription>
                </div>
                <Badge variant="outline" className="font-mono text-xs">
                  {payments.length} transactions
                </Badge>
              </CardHeader>
              <CardContent className="p-0">
                {recentPayments.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                    Aucun versement n'a été enregistré pour cette période.
                  </div>
                ) : (
                  <div className="max-h-[300px] overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-surface-panel text-muted-foreground z-10">
                        <tr className="border-b border-border/60">
                          <th className="px-4 py-2.5 text-left font-medium">N° Reçu</th>
                          <th className="px-4 py-2.5 text-left font-medium">Date & Heure</th>
                          <th className="px-4 py-2.5 text-left font-medium">Prestation</th>
                          <th className="px-4 py-2.5 text-left font-medium">Mode</th>
                          <th className="px-4 py-2.5 text-left font-medium">Statut</th>
                          <th className="px-4 py-2.5 text-right font-medium">Montant</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {recentPayments.map((payment) => (
                          <tr key={payment.id} className="hover:bg-accent/5">
                            <td className="px-4 py-2 font-mono font-medium text-foreground">
                              {payment.receiptNumber}
                            </td>
                            <td className="px-4 py-2 text-muted-foreground">
                              {formatPaymentDate(payment.collectedAt)}
                            </td>
                            <td className="px-4 py-2 text-foreground font-medium">
                              {paymentCategoryLabelFr(payment.category)}
                            </td>
                            <td className="px-4 py-2 text-muted-foreground">
                              {PAYMENT_METHOD_LABELS_FR[payment.method]}
                            </td>
                            <td className="px-4 py-2">
                              <StatusChip
                                label={PAYMENT_STATUS_LABELS_FR[payment.status]}
                                tone={payment.status === "paid" ? "success" : "warning"}
                              />
                            </td>
                            <td className="px-4 py-2 text-right font-mono font-bold">
                              {formatDzdPlain(payment.amount)} DA
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </PageTabContent>

        {/* ────────── TAB 2: PÔLES OPÉRATIONNELS ────────── */}
        <PageTabContent value="departments">
          <DepartmentsTab payments={payments} />
        </PageTabContent>

        {/* ────────── TAB 3: DÉMOGRAPHIE ────────── */}
        <PageTabContent value="demographics">
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MetricSummaryTile
                label="Effectif Total Inscrits"
                value={String(genderTotal)}
                subtext="Élèves scolarisés actifs"
                tone="default"
              />
              <MetricSummaryTile
                label="Garçons / Filles"
                value={
                  data.demographics.gender.length >= 2
                    ? `${data.demographics.gender[0].count} / ${data.demographics.gender[1].count}`
                    : "—"
                }
                subtext="Répartition par genre"
                tone="default"
              />
              <MetricSummaryTile
                label="Paliers Représentés"
                value={String(data.demographics.grade.length)}
                subtext="Niveaux pédagogiques"
              />
              <MetricSummaryTile
                label="Âge Médian"
                value={
                  data.demographics.age.length > 0
                    ? `${data.demographics.age[Math.floor(data.demographics.age.length / 2)].label} ans`
                    : "—"
                }
                subtext="Cohorte centrale"
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-7">
                <Card className="border-border/70 bg-surface-panel shadow-sm h-full">
                  <CardHeader className="border-b border-border/50 px-4 py-3">
                    <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Distribution des Effectifs par Niveau
                    </CardTitle>
                    <CardDescription className="text-xs text-muted-foreground">
                      Nombre d'élèves par niveau scolaire
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-4">
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data.demographics.grade}>
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke={DASHBOARD_THEME.gridStroke}
                            vertical={false}
                          />
                          <XAxis
                            dataKey="label"
                            {...DASHBOARD_THEME.axisTick}
                            axisLine={false}
                            tickLine={false}
                            angle={-25}
                            textAnchor="end"
                            height={45}
                          />
                          <YAxis
                            {...DASHBOARD_THEME.axisTick}
                            axisLine={false}
                            tickLine={false}
                            allowDecimals={false}
                          />
                          <RTooltip
                            contentStyle={DASHBOARD_THEME.tooltipStyle}
                            formatter={(v: number) => [`${v} élèves`, "Inscrits"]}
                          />
                          <Bar
                            dataKey="count"
                            fill={chartPalette.primary}
                            radius={[4, 4, 0, 0]}
                            barSize={20}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="lg:col-span-5 space-y-4">
                <Card className="border-border/70 bg-surface-panel shadow-sm">
                  <CardHeader className="border-b border-border/50 px-4 py-3">
                    <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Répartition par Genre
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="relative flex h-[130px] w-[130px] items-center justify-center shrink-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={data.demographics.gender}
                            dataKey="count"
                            nameKey="label"
                            innerRadius={42}
                            outerRadius={58}
                            paddingAngle={3}
                            stroke="none"
                          >
                            {data.demographics.gender.map((_, i) => (
                              <Cell
                                key={i}
                                fill={
                                  [chartPalette.primary, chartPalette.gold, chartPalette.cyan][i % 3]
                                }
                              />
                            ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-lg font-bold font-mono text-foreground">
                          {genderTotal}
                        </span>
                        <span className="text-[9px] uppercase text-muted-foreground">élèves</span>
                      </div>
                    </div>

                    <div className="space-y-2 text-xs flex-1 pl-4">
                      {data.demographics.gender.map((g, i) => (
                        <div key={g.label} className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5">
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{
                                backgroundColor: [chartPalette.primary, chartPalette.gold, chartPalette.cyan][i % 3],
                              }}
                            />
                            <span className="text-foreground font-medium">{g.label}</span>
                          </span>
                          <span className="font-mono font-bold text-foreground">
                            {g.count} ({g.percent}%)
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border/70 bg-surface-panel shadow-sm">
                  <CardHeader className="border-b border-border/50 px-4 py-3">
                    <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Pyramide des Âges
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4">
                    <div className="h-[120px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data.demographics.age} margin={{ top: 5, right: 0, bottom: 0, left: -20 }}>
                          <XAxis
                            dataKey="label"
                            {...DASHBOARD_THEME.axisTick}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis
                            {...DASHBOARD_THEME.axisTick}
                            axisLine={false}
                            tickLine={false}
                            allowDecimals={false}
                          />
                          <RTooltip contentStyle={DASHBOARD_THEME.tooltipStyle} />
                          <Bar
                            dataKey="count"
                            fill={chartPalette.cyan}
                            radius={[3, 3, 0, 0]}
                            barSize={16}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </PageTabContent>

        {/* ────────── TAB 4: CRÉANCES ────────── */}
        <PageTabContent value="debt">
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MetricSummaryTile
                label="Encours Global des Créances"
                value={formatDzd(
                  data.debtAging.reduce((s, b) => s + b.amount, 0),
                  { compact: true },
                )}
                subtext="Total des échéances échues"
                tone="danger"
              />
              <MetricSummaryTile
                label="Familles Débitrices"
                value={String(data.debtAging.reduce((s, b) => s + b.debtorCount, 0))}
                subtext="Foyers avec solde impayé"
                tone="warning"
              />
              <MetricSummaryTile
                label="Retards Critiques (> 60j)"
                value={String(
                  (data.debtAging.find((b) => b.bucket === "61_90")?.debtorCount ?? 0) +
                  (data.debtAging.find((b) => b.bucket === "91_180")?.debtorCount ?? 0) +
                  (data.debtAging.find((b) => b.bucket === "180_plus")?.debtorCount ?? 0)
                )}
                subtext="Dossiers en phase d'arbitrage"
                tone="danger"
              />
              <MetricSummaryTile
                label="Retard Moyen"
                value={
                  data.topDebtors.length > 0
                    ? `${Math.round(data.topDebtors.reduce((s, d) => s + d.daysOverdue, 0) / data.topDebtors.length)} jours`
                    : "—"
                }
                subtext="Sur les débiteurs principaux"
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-5">
                <Card className="border-border/70 bg-surface-panel shadow-sm h-full">
                  <CardHeader className="border-b border-border/50 px-4 py-3">
                    <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Structure par Ancienneté
                    </CardTitle>
                    <CardDescription className="text-xs text-muted-foreground">
                      Ventilation des impayés selon l'âge du retard
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/30 text-left text-muted-foreground">
                        <tr className="border-b border-border/60">
                          <th className="px-3.5 py-2.5 font-medium">Tranche</th>
                          <th className="px-3 py-2.5 text-right font-medium">Encours</th>
                          <th className="px-3 py-2.5 text-right font-medium">Foyers</th>
                          <th className="px-3.5 py-2.5 text-right font-medium">Niveau</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {data.debtAging.map((b) => {
                          const sev = agingSeverity(b.bucket);
                          return (
                            <tr key={b.bucket} className="hover:bg-accent/5">
                              <td className="px-3.5 py-2.5 font-medium">
                                {AGING_BUCKET_LABELS_FR[b.bucket]}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono font-bold text-foreground">
                                {formatDzdPlain(b.amount)} DA
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono">{b.debtorCount}</td>
                              <td className="px-3.5 py-2.5 text-right">
                                <span
                                  className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${sev.className}`}
                                >
                                  {sev.label}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </div>

              <div className="lg:col-span-7">
                <Card className="border-border/70 bg-surface-panel shadow-sm h-full">
                  <CardHeader className="border-b border-border/50 px-4 py-3">
                    <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Top 10 Débiteurs Prioritaires
                    </CardTitle>
                    <CardDescription className="text-xs text-muted-foreground">
                      Dossiers nécessitant une relance active de trésorerie
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    {data.topDebtors.length === 0 ? (
                      <p className="py-8 text-center text-xs text-muted-foreground">
                        Aucun dossier débiteur enregistré.
                      </p>
                    ) : (
                      <div className="max-h-[340px] overflow-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-muted/30 text-left text-muted-foreground sticky top-0 bg-surface-panel z-10">
                            <tr className="border-b border-border/60">
                              <th className="px-3 py-2.5 font-medium w-10">#</th>
                              <th className="px-3 py-2.5 font-medium">Famille</th>
                              <th className="px-3 py-2.5 font-medium">Contact</th>
                              <th className="px-3 py-2.5 text-right font-medium">Retard</th>
                              <th className="px-3 py-2.5 text-right font-medium">Créance</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/40">
                            {data.topDebtors.map((d, i) => (
                              <tr key={d.parentId} className="hover:bg-accent/5">
                                <td className="px-3 py-2 font-mono text-muted-foreground">
                                  #{i + 1}
                                </td>
                                <td className="px-3 py-2 font-medium text-foreground truncate max-w-[150px]">
                                  {d.parentName}
                                </td>
                                <td className="px-3 py-2 text-muted-foreground font-mono">
                                  {d.parentPhone || "—"}
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                                  {d.daysOverdue} j
                                </td>
                                <td className="px-3 py-2 text-right font-mono font-bold text-status-danger">
                                  {formatDzdPlain(d.outstandingAmount)} DA
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </PageTabContent>
      </PageTabs>
    </UnifiedModal>
  );
}

function DepartmentsTab({ payments }: { payments: readonly Payment[] }) {
  const unitsWithTotals = OPERATIONAL_UNITS.map((u) => {
    const matchingPayments = payments.filter(
      (p) => p.category !== null && u.categories.includes(p.category),
    );
    const amount = matchingPayments.reduce((s, p) => s + p.amount, 0);
    const count = matchingPayments.length;
    return { ...u, amount, count };
  });

  const claimed = new Set(OPERATIONAL_UNITS.flatMap((u) => u.categories));
  const otherPayments = payments.filter(
    (p) => p.category === null || !claimed.has(p.category),
  );
  const otherAmount = otherPayments.reduce((s, p) => s + p.amount, 0);
  const grandTotal =
    unitsWithTotals.reduce((s, u) => s + u.amount, 0) + otherAmount;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricSummaryTile
          label="Total Recettes Pôles"
          value={formatDzd(grandTotal, { compact: true })}
          subtext={`${payments.length} transactions globales`}
          tone="success"
        />
        <MetricSummaryTile
          label="Pôle Scolarité"
          value={formatDzd(unitsWithTotals[0]?.amount ?? 0, { compact: true })}
          subtext={`${grandTotal > 0 ? Math.round(((unitsWithTotals[0]?.amount ?? 0) / grandTotal) * 100) : 0}% des recettes`}
        />
        <MetricSummaryTile
          label="Services de Vie Scolaire"
          value={formatDzd(unitsWithTotals[3]?.amount ?? 0, { compact: true })}
          subtext="Transport & Cantine"
        />
        <MetricSummaryTile
          label="Pôles Spécialisés"
          value={formatDzd(
            (unitsWithTotals[1]?.amount ?? 0) + (unitsWithTotals[2]?.amount ?? 0),
            { compact: true },
          )}
          subtext="Thérapie & Parascolaire"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        {unitsWithTotals.map((u) => {
          const Icon = u.icon;
          const pct = grandTotal > 0 ? Math.round((u.amount / grandTotal) * 100) : 0;
          return (
            <Card key={u.key} className="border-border/70 bg-surface-panel shadow-sm">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${u.color}15`, color: u.color }}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-foreground">{u.label}</h4>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {u.count} transaction(s) enregistrée(s)
                      </span>
                    </div>
                  </div>
                  <span
                    className="text-xs font-mono font-bold px-2 py-0.5 rounded-full border"
                    style={{
                      color: u.color,
                      borderColor: `${u.color}30`,
                      backgroundColor: `${u.color}10`,
                    }}
                  >
                    {pct}%
                  </span>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Volume Encaissé</span>
                    <span className="font-mono font-bold text-foreground">
                      {formatDzdPlain(u.amount)} DA
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, backgroundColor: u.color }}
                    />
                  </div>
                </div>

                <div className="pt-2 border-t border-border/40 text-[11px] text-muted-foreground">
                  <span className="font-semibold text-foreground mr-1">Comprend :</span>
                  {u.categories.map((c) => PAYMENT_CATEGORY_LABELS_FR[c] ?? c).join(", ")}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}