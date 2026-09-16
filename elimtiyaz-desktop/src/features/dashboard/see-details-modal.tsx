// ============================================================================
// FILE: elimtiyaz-desktop/src/features/dashboard/see-details-modal.tsx
// ============================================================================

import { useTranslation } from "react-i18next";
import { useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  Building2,
  CheckCircle2,
  Database,
  Plus,
  Trash2,
  TrendingUp,
  Users,
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
  PAYMENT_CATEGORY_LABELS_FR,
  PAYMENT_STATUS_LABELS_FR,
  type PaymentCategory,
  type DebtSummary,
  type AgingBucket,
} from "../../domain/model/payment";
import { UnifiedModal } from "../../shared/ui/unified-modal";
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
}[] = [
  {
    key: "scolarite",
    label: "Scolarité (académique)",
    categories: ["tuition", "books", "uniform", "second_apron"],
    color: "#349bd4",
  },
  {
    key: "therapy",
    label: "Thérapie & Accompagnement (Orthophonie / Psy)",
    categories: ["therapy_psychology", "therapy_speech"],
    color: "#eab308",
  },
  {
    key: "clubs",
    label: "Activités & Clubs Parascolaires",
    categories: ["extracurricular"],
    color: "#f43f5e",
  },
  {
    key: "auxiliary",
    label: "Services Auxiliaires (Transport / Cantine)",
    categories: ["transport", "canteen"],
    color: "#10b981",
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

type ManualPaymentEntry = {
  id: string;
  name: string;
  dateTime: string;
  amount: string;
};

function createManualEntry(): ManualPaymentEntry {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);

  return {
    id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: "",
    dateTime: localDate,
    amount: "",
  };
}

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
      className:
        "bg-status-success/15 text-status-success border-status-success/30",
    };
  }
  if (bucket === "31_60") {
    return {
      label: "Relance",
      className:
        "bg-status-warning/15 text-status-warning border-status-warning/30",
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

function formatManualDate(value: string): string {
  if (!value) return "—";
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
  const [manualEntries, setManualEntries] = useState<ManualPaymentEntry[]>([]);

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

  const livePaymentTotal = useMemo(
    () => payments.reduce((sum, payment) => sum + payment.amount, 0),
    [payments],
  );
  const revenueReconciliationDifference = livePaymentTotal - annualRevenue;
  const recentPayments = useMemo(
    () =>
      [...payments]
        .sort(
          (a, b) =>
            new Date(b.collectedAt).getTime() -
            new Date(a.collectedAt).getTime(),
        )
        .slice(0, 12),
    [payments],
  );

  const manualTotal = useMemo(
    () =>
      manualEntries.reduce((sum, entry) => {
        const amount = Number(entry.amount);
        return sum + (Number.isFinite(amount) && amount > 0 ? amount : 0);
      }, 0),
    [manualEntries],
  );

  const addManualEntry = () => {
    setManualEntries((current) => [...current, createManualEntry()]);
  };

  const updateManualEntry = (
    id: string,
    patch: Partial<Omit<ManualPaymentEntry, "id">>,
  ) => {
    setManualEntries((current) =>
      current.map((entry) =>
        entry.id === id ? { ...entry, ...patch } : entry,
      ),
    );
  };

  const removeManualEntry = (id: string) => {
    setManualEntries((current) => current.filter((entry) => entry.id !== id));
  };

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      size="2xl"
      variant="dialog"
      icon={BarChart3}
      iconTone="primary"
      title={t("dashboard.seeDetails")}
      description="Détails pratiques des encaissements, des personnes saisies et des indicateurs du dashboard"
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

        <PageTabContent value="revenue">
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1 rounded-xl border border-border/70 bg-surface-elevated/40 p-3.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Encaissé effectif (PAID)
                </span>
                <p className="text-xl font-mono font-bold text-status-success">
                  {formatDzd(annualRevenue)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Agrégat du dashboard repository
                </p>
              </div>

              <div className="space-y-1 rounded-xl border border-border/70 bg-surface-elevated/40 p-3.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Créances restantes
                </span>
                <p className="text-xl font-mono font-bold text-status-danger">
                  {data.kpis ? formatDzd(outstanding) : "—"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Agrégat du dashboard repository
                </p>
              </div>

              <div className="space-y-1 rounded-xl border border-border/70 bg-surface-elevated/40 p-3.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Taux d'Atteinte Annuel
                </span>
                <p className="text-xl font-mono font-bold text-primary">
                  {data.kpis ? `${collectionRate}%` : "—"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Encaissé sur total attendu
                </p>
              </div>
            </div>

            <Card className="border-border/70 bg-surface-panel shadow-sm">
              <CardHeader className="border-b border-border/50 px-4 py-3">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Encaissements vs Échéancier Théorique (40% · 30% · 30%)
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Barres pleines : agrégat réel · Ligne pointillée : jalon théorique calculé
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4">
                <div className="h-[260px]">
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
              <CardHeader className="border-b border-border/50 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Versements réels
                    </CardTitle>
                    <CardDescription className="mt-1 text-xs text-muted-foreground">
                      {payments.length} enregistrement(s) reçu(s) du flux de paiements pour cette période
                    </CardDescription>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Flux payments
                    </div>
                    <div className="font-mono text-sm font-bold text-foreground">
                      {formatDzdPlain(livePaymentTotal)} DA
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {recentPayments.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                    Aucun versement réel n'est disponible dans le flux pour la période sélectionnée.
                  </div>
                ) : (
                  <div className="max-h-[320px] overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-surface-panel text-muted-foreground">
                        <tr className="border-b border-border/60">
                          <th className="px-4 py-2.5 text-left font-medium">Reçu</th>
                          <th className="px-4 py-2.5 text-left font-medium">Date</th>
                          <th className="px-4 py-2.5 text-left font-medium">Service</th>
                          <th className="px-4 py-2.5 text-left font-medium">Statut</th>
                          <th className="px-4 py-2.5 text-right font-medium">Montant</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {recentPayments.map((payment) => (
                          <tr key={payment.id} className="hover:bg-accent/5">
                            <td className="px-4 py-2.5 font-mono text-foreground">
                              {payment.receiptNumber}
                            </td>
                            <td className="px-4 py-2.5 text-muted-foreground">
                              {formatPaymentDate(payment.collectedAt)}
                            </td>
                            <td className="px-4 py-2.5 text-foreground">
                              {PAYMENT_CATEGORY_LABELS_FR[payment.category]}
                            </td>
                            <td className="px-4 py-2.5 text-muted-foreground">
                              {PAYMENT_STATUS_LABELS_FR[payment.status]}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-semibold">
                              {formatDzdPlain(payment.amount)} DA
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="border-t border-border/60 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <span className="text-muted-foreground">
                      Comparaison agrégat dashboard ↔ flux payments
                    </span>
                    {Math.abs(revenueReconciliationDifference) < 0.5 ? (
                      <span className="inline-flex items-center gap-1.5 font-semibold text-status-success">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Réconciliation exacte
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 font-semibold text-status-warning">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Écart : {formatDzdPlain(Math.abs(revenueReconciliationDifference))} DA
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap justify-between gap-2 font-mono text-[10px] text-muted-foreground">
                    <span>Dashboard: {formatDzdPlain(annualRevenue)} DA</span>
                    <span>Payments: {formatDzdPlain(livePaymentTotal)} DA</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/70 bg-surface-panel shadow-sm">
              <CardHeader className="border-b border-border/50 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Saisie manuelle
                    </CardTitle>
                    <CardDescription className="mt-1 max-w-2xl text-xs text-muted-foreground">
                      Ajoutez plusieurs personnes avec leur propre nom, date/heure et montant. Ces lignes restent locales à cette vue et ne modifient pas les données du dépôt.
                    </CardDescription>
                  </div>
                  <button
                    type="button"
                    onClick={addManualEntry}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/15"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Ajouter une personne
                  </button>
                </div>
              </CardHeader>
              <CardContent className="p-4">
                {manualEntries.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border/70 bg-muted/10 px-4 py-7 text-center">
                    <p className="text-xs font-medium text-foreground">
                      Aucune saisie manuelle
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Cliquez sur « Ajouter une personne » pour créer une première ligne.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {manualEntries.map((entry, index) => (
                      <div
                        key={entry.id}
                        className="rounded-xl border border-border/70 bg-surface-elevated/30 p-3"
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Personne {index + 1}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeManualEntry(entry.id)}
                            aria-label={`Supprimer la personne ${index + 1}`}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-status-danger/10 hover:text-status-danger"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1.35fr)_minmax(180px,0.9fr)_minmax(130px,0.65fr)]">
                          <label className="space-y-1">
                            <span className="text-[10px] font-medium text-muted-foreground">
                              Nom
                            </span>
                            <input
                              value={entry.name}
                              onChange={(event) =>
                                updateManualEntry(entry.id, {
                                  name: event.target.value,
                                })
                              }
                              placeholder="Nom de la personne"
                              className="h-9 w-full rounded-md border border-border/70 bg-background px-2.5 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary/20"
                            />
                          </label>

                          <label className="space-y-1">
                            <span className="text-[10px] font-medium text-muted-foreground">
                              Date / heure
                            </span>
                            <input
                              type="datetime-local"
                              value={entry.dateTime}
                              onChange={(event) =>
                                updateManualEntry(entry.id, {
                                  dateTime: event.target.value,
                                })
                              }
                              className="h-9 w-full rounded-md border border-border/70 bg-background px-2.5 text-xs text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20"
                            />
                          </label>

                          <label className="space-y-1">
                            <span className="text-[10px] font-medium text-muted-foreground">
                              Montant (DA)
                            </span>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              inputMode="decimal"
                              value={entry.amount}
                              onChange={(event) =>
                                updateManualEntry(entry.id, {
                                  amount: event.target.value,
                                })
                              }
                              placeholder="0"
                              className="h-9 w-full rounded-md border border-border/70 bg-background px-2.5 text-right font-mono text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary/20"
                            />
                          </label>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2 text-[10px]">
                          <span className="text-muted-foreground">
                            {entry.name.trim() || "Nom non renseigné"} · {formatManualDate(entry.dateTime)}
                          </span>
                          <span className="font-mono font-semibold text-foreground">
                            {formatDzdPlain(Number(entry.amount) || 0)} DA
                          </span>
                        </div>
                      </div>
                    ))}

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
                      <div>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Total des saisies manuelles
                        </span>
                        <p className="text-sm font-mono font-bold text-foreground">
                          {formatDzdPlain(manualTotal)} DA
                        </p>
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        {manualEntries.length} personne(s) saisie(s)
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="rounded-lg border border-primary/15 bg-primary/5 px-3 py-2.5 text-[10px] leading-relaxed text-muted-foreground">
              <div className="flex items-start gap-2">
                <Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <span>
                  Les versements réels ci-dessus viennent du flux repository. Les lignes de saisie manuelle servent uniquement à préparer/tester des entrées dans l'interface et sont volontairement exclues de la réconciliation du dashboard. Le branchement Supabase pourra être ajouté plus tard sans changer cette séparation UI.
                </span>
              </div>
            </div>
          </div>
        </PageTabContent>

        <PageTabContent value="departments">
          <DepartmentsTab payments={payments} />
        </PageTabContent>

        <PageTabContent value="demographics">
          <div className="space-y-4">
            <Card className="border-border/70 bg-surface-panel shadow-sm">
              <CardHeader className="border-b border-border/50 px-4 py-3">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Distribution des Effectifs par Niveau
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Agrégats fournis par le repository dashboard.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4">
                <div className="h-[220px]">
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

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Card className="border-border/70 bg-surface-panel shadow-sm">
                <CardHeader className="border-b border-border/50 px-4 py-3">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Répartition par Genre
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col items-center justify-center p-4">
                  <div className="relative flex h-[180px] w-full items-center justify-center">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={data.demographics.gender}
                          dataKey="count"
                          nameKey="label"
                          innerRadius={54}
                          outerRadius={74}
                          paddingAngle={3}
                          stroke="none"
                        >
                          {data.demographics.gender.map((_, i) => (
                            <Cell
                              key={i}
                              fill={
                                [
                                  chartPalette.primary,
                                  chartPalette.gold,
                                  chartPalette.cyan,
                                ][i % 3]
                              }
                            />
                          ))}
                        </Pie>
                        <RTooltip contentStyle={DASHBOARD_THEME.tooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl font-bold font-mono text-foreground">
                        {genderTotal}
                      </span>
                      <span className="text-[10px] uppercase text-muted-foreground">
                        élèves
                      </span>
                    </div>
                  </div>

                  <div className="mt-2 flex justify-center gap-6 text-xs">
                    {data.demographics.gender.map((g, i) => (
                      <div key={g.label} className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{
                            backgroundColor: [
                              chartPalette.primary,
                              chartPalette.gold,
                              chartPalette.cyan,
                            ][i % 3],
                          }}
                        />
                        <span className="text-muted-foreground">{g.label}:</span>
                        <strong className="font-mono text-foreground">{g.count}</strong>
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
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.demographics.age}>
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
                          allowDecimals={false}
                        />
                        <RTooltip contentStyle={DASHBOARD_THEME.tooltipStyle} />
                        <Bar
                          dataKey="count"
                          fill={chartPalette.cyan}
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </PageTabContent>

        <PageTabContent value="debt">
          <div className="space-y-4">
            <Card className="border-border/70 bg-surface-panel shadow-sm">
              <CardHeader className="border-b border-border/50 px-4 py-3">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Structure des Retards par Ancienneté
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Agrégats du repository dashboard pour la période sélectionnée.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30 text-left text-muted-foreground">
                    <tr className="border-b border-border/60">
                      <th className="px-4 py-2.5 font-medium">Tranche</th>
                      <th className="px-4 py-2.5 text-right font-medium">Encours</th>
                      <th className="px-4 py-2.5 text-right font-medium">Familles</th>
                      <th className="px-4 py-2.5 text-right font-medium">Sévérité</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {data.debtAging.map((b) => {
                      const sev = agingSeverity(b.bucket);
                      return (
                        <tr key={b.bucket} className="hover:bg-accent/5">
                          <td className="px-4 py-2.5 font-medium">
                            {AGING_BUCKET_LABELS_FR[b.bucket]}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono font-bold text-foreground">
                            {formatDzdPlain(b.amount)} DA
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono">{b.debtorCount}</td>
                          <td className="px-4 py-2.5 text-right">
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

            <Card className="border-border/70 bg-surface-panel shadow-sm">
              <CardHeader className="border-b border-border/50 px-4 py-3">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Top Débiteurs Prioritaires (10 Plus Fortes Créances)
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Enregistrements issus du flux de dettes observé par le dashboard.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {data.topDebtors.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    Aucune créance enregistrée.
                  </p>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="bg-muted/30 text-left text-muted-foreground">
                      <tr className="border-b border-border/60">
                        <th className="px-4 py-2.5 font-medium">Rang</th>
                        <th className="px-4 py-2.5 font-medium">Famille</th>
                        <th className="px-4 py-2.5 text-right font-medium">Retard</th>
                        <th className="px-4 py-2.5 text-right font-medium">Créance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {data.topDebtors.map((d, i) => (
                        <tr key={d.parentId} className="hover:bg-accent/5">
                          <td className="px-4 py-2 font-mono text-muted-foreground">#{i + 1}</td>
                          <td className="px-4 py-2 font-medium text-foreground">{d.parentName}</td>
                          <td className="px-4 py-2 text-right font-mono text-muted-foreground">
                            {d.daysOverdue} j
                          </td>
                          <td className="px-4 py-2 text-right font-mono font-bold text-status-danger">
                            {formatDzdPlain(d.outstandingAmount)} DA
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </div>
        </PageTabContent>
      </PageTabs>
    </UnifiedModal>
  );
}

function DepartmentsTab({ payments }: { payments: readonly Payment[] }) {
  const unitsWithTotals = OPERATIONAL_UNITS.map((u) => {
    const amount = payments
      .filter((p) => u.categories.includes(p.category))
      .reduce((s, p) => s + p.amount, 0);
    return { ...u, amount };
  });

  const claimed = new Set(OPERATIONAL_UNITS.flatMap((u) => u.categories));
  const otherAmount = payments
    .filter((p) => !claimed.has(p.category))
    .reduce((s, p) => s + p.amount, 0);
  const grandTotal =
    unitsWithTotals.reduce((s, u) => s + u.amount, 0) + otherAmount;

  return (
    <Card className="border-border/70 bg-surface-panel shadow-sm">
      <CardHeader className="border-b border-border/50 px-4 py-3">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Ventilation par Pôle Opérationnel
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          Répartition des encaissements effectifs par activité, calculée sur les versements du flux live.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        {grandTotal === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            Aucun encaissement sur cette période.
          </p>
        ) : (
          <>
            <div className="space-y-3">
              {unitsWithTotals.map((u) => {
                const pct = grandTotal > 0 ? Math.round((u.amount / grandTotal) * 100) : 0;
                return (
                  <div key={u.key} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="flex items-center gap-1.5 font-medium">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: u.color }}
                        />
                        {u.label}
                      </span>
                      <span className="font-mono font-bold text-foreground">
                        {formatDzd(u.amount)}{" "}
                        <span className="font-normal text-muted-foreground">({pct}%)</span>
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${pct}%`, backgroundColor: u.color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between border-t border-border/60 pt-3">
              <span className="text-xs font-bold text-foreground">
                Total Encaissé ({payments.length} versements)
              </span>
              <span className="font-mono text-base font-bold text-status-success">
                {formatDzdPlain(grandTotal)} DA
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
